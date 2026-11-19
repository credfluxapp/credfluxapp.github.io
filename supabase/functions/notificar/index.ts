// CredFlux: notificações no celular (Web Push), sem bibliotecas de fora.
//
// Publicar em Supabase › Edge Functions com o nome "notificar" e com "Verify JWT" desligado:
// o pg_cron chama esta função duas vezes por dia sem login (supabase/atualizacao_02.sql), e ela mesma
// confere o login quando o pedido vem do aplicativo.
//
// Pedidos (POST com JSON):
//   {acao:'rodar'}  às 9h (horário de Brasília), os vencimentos do dia e os atrasos; às 21h, os clientes
//                   de amanhã. O banco marca cada aviso antes do envio, então cada aparelho recebe cada um
//                   no máximo uma vez por dia, mesmo que a função rode de novo. Os horários ficam no
//                   agendamento (cron) e nas faixas de horário da função push_reservar, no atualizacao_02.sql.
//   {acao:'chave'}  com login: a chave pública VAPID (criada aqui na primeira vez e guardada no banco).
//   {acao:'teste'}  com login: uma notificação de teste para os aparelhos da pessoa.
//
// Criptografia: RFC 8291 (conteúdo aes128gcm) e RFC 8292 (VAPID), com a Web Crypto do próprio Deno.

const env = (k: string): string => (globalThis as any).Deno?.env.get(k) ?? '';
const CONTATO = 'mailto:credfluxapp@gmail.com';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Bytes e Base64 URL-safe ----------------------------------------------------------------
export function b64u(dados: ArrayBuffer | Uint8Array): string {
  const b = dados instanceof Uint8Array ? dados : new Uint8Array(dados);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function deB64u(s: string): Uint8Array {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '==='.slice((t.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function juntar(...partes: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of partes) { out.set(p, i); i += p.length; }
  return out;
}
const bytes = (s: string) => new TextEncoder().encode(s);

async function hkdf(sal: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: sal, info }, k, n * 8));
}

// VAPID: par de chaves P-256 do serviço e o cabeçalho Authorization assinado (ES256) ---------
export async function novasChaves(): Promise<{ publica: string; privada: JsonWebKey }> {
  const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return {
    publica: b64u(await crypto.subtle.exportKey('raw', par.publicKey)),
    privada: await crypto.subtle.exportKey('jwk', par.privateKey),
  };
}

export async function assinaturaVapid(endpoint: string, chaves: { publica: string; privada: JsonWebKey }, agora = Date.now()): Promise<string> {
  const cab = b64u(bytes(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const corpo = b64u(bytes(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(agora / 1000) + 12 * 3600, sub: CONTATO })));
  const { key_ops: _ops, ext: _ext, ...jwk } = chaves.privada as any;
  const k = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const ass = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, bytes(`${cab}.${corpo}`));
  return `vapid t=${cab}.${corpo}.${b64u(ass)}, k=${chaves.publica}`;
}

// Conteúdo cifrado para o aparelho (RFC 8291). "teste" fixa a chave efêmera e o sal (vetores da RFC).
export async function cifrar(p256dh: string, auth: string, mensagem: Uint8Array, teste?: { efemera: CryptoKeyPair; sal: Uint8Array }): Promise<Uint8Array> {
  const uaPub = deB64u(p256dh);
  const efemera = teste?.efemera ?? await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', efemera.publicKey));
  const uaChave = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaChave } as any, efemera.privateKey, 256));
  const ikm = await hkdf(deB64u(auth), ecdh, juntar(bytes('WebPush: info\0'), uaPub, asPub), 32);
  const sal = teste?.sal ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(sal, ikm, bytes('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(sal, ikm, bytes('Content-Encoding: nonce\0'), 12);
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // um registro só: a mensagem e o delimitador 0x02 (último registro)
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, juntar(mensagem, new Uint8Array([2]))));
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return juntar(sal, rs, new Uint8Array([asPub.length]), asPub, cifrado);
}

// Manda uma notificação. Devolve o código HTTP do serviço de push (201 = entregue ao serviço;
// 404 ou 410 = o aparelho cancelou e a inscrição deve sair do banco).
export async function enviar(insc: { endpoint: string; p256dh: string; auth: string }, msg: unknown, chaves: { publica: string; privada: JsonWebKey }): Promise<number> {
  const corpo = await cifrar(insc.p256dh, insc.auth, bytes(JSON.stringify(msg)));
  const r = await fetch(insc.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await assinaturaVapid(insc.endpoint, chaves),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '43200',
      Urgency: 'normal',
    },
    body: corpo,
  });
  await r.text().catch(() => '');
  return r.status;
}

// Textos das notificações ------------------------------------------------------------------
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const moeda = (v: unknown) => brl.format(Number(v) || 0).replace(/\s/g, ' ');
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

// l: uma linha de push_reservar (tipo 'hoje' ou 'amanha', itens por cliente e, de manhã, os atrasos).
export function mensagem(l: any): { titulo: string; texto: string; url: string; tag: string } | null {
  const itens = (l.itens || []).map((i: any) => ({ cliente: String(i.cliente || 'Cliente'), valor: Number(i.valor) || 0 }));
  const total = itens.reduce((s: number, i: any) => s + i.valor, 0);
  const lista = () => {
    const nomes = itens.slice(0, 3).map((i: any) => `${i.cliente} ${moeda(i.valor)}`);
    const resto = itens.length - nomes.length;
    return nomes.join(', ') + (resto > 0 ? ` e mais ${resto}` : '');
  };
  const url = `./?aviso=${l.tipo === 'amanha' ? 'amanha' : 'hoje'}`;
  if (l.tipo === 'amanha') {
    if (!itens.length) return null;
    return l.detalhes
      ? { titulo: `Amanhã: ${plural(itens.length, 'cliente', 'clientes')} · ${moeda(total)}`, texto: lista(), url, tag: 'credflux-amanha' }
      : { titulo: 'Vencimentos de amanhã', texto: `${plural(itens.length, 'cliente tem', 'clientes têm')} parcela amanhã. Toque para ver.`, url, tag: 'credflux-amanha' };
  }
  const atr = Number(l.atrasadas) || 0;
  if (!itens.length && !atr) return null;
  const atraso = atr ? `${plural(atr, 'parcela', 'parcelas')} em atraso${l.detalhes ? ` (${moeda(l.valor_atraso)})` : ''}` : '';
  if (!itens.length) return { titulo: 'Parcelas em atraso', texto: `${atraso[0].toUpperCase()}${atraso.slice(1)}. Toque para ver e cobrar.`, url, tag: 'credflux-hoje' };
  return l.detalhes
    ? { titulo: `Hoje: ${plural(itens.length, 'cliente', 'clientes')} · ${moeda(total)}`, texto: [lista(), atraso].filter(Boolean).join(' · '), url, tag: 'credflux-hoje' }
    : { titulo: 'Vencimentos de hoje', texto: `${plural(itens.length, 'cliente tem', 'clientes têm')} parcela hoje${atr ? ` e há ${atraso}` : ''}. Toque para ver.`, url, tag: 'credflux-hoje' };
}

// Banco: funções do atualizacao_02.sql pela API, com a chave de serviço (só aqui dentro) -----------
function chaveServico(): string {
  const k = env('CREDFLUX_CHAVE_SERVICO') || env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY');
  if (k) return k;
  try { const m = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}'); return String(m.default || Object.values(m)[0] || ''); } catch { return ''; }
}
async function rpc(nome: string, args: Record<string, unknown> = {}): Promise<any> {
  const chave = chaveServico();
  if (!chave) throw new Error('Sem a chave de serviço (SUPABASE_SERVICE_ROLE_KEY) nesta função.');
  const cab: Record<string, string> = { apikey: chave, 'Content-Type': 'application/json' };
  if (chave.startsWith('eyJ')) cab.Authorization = `Bearer ${chave}`;
  const r = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/${nome}`, { method: 'POST', headers: cab, body: JSON.stringify(args) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${nome}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}

let chavesGuardadas: { publica: string; privada: JsonWebKey } | null = null;
async function chaves() {
  if (chavesGuardadas) return chavesGuardadas;
  let c = await rpc('push_chave_obter');
  if (!c?.publica) { const n = await novasChaves(); c = await rpc('push_chave_criar', { p_publica: n.publica, p_privada: n.privada }); }
  chavesGuardadas = c;
  return c;
}

function erroHttp(msg: string, status: number) { return Object.assign(new Error(msg), { status }); }

async function emailDoLogin(req: Request): Promise<string> {
  const auth = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+eyJ/.test(auth)) throw erroHttp('Entre no CredFlux para usar as notificações.', 401);
  const r = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, { headers: { Authorization: auth, apikey: req.headers.get('apikey') || env('SUPABASE_ANON_KEY') } });
  if (!r.ok) throw erroHttp('Entre no CredFlux para usar as notificações.', 401);
  const u = await r.json();
  return String(u.email || '').toLowerCase();
}

async function mandarPara(lista: any[], montar: (l: any) => unknown) {
  if (!lista?.length) return { aparelhos: 0, enviados: 0, removidos: 0 };
  const k = await chaves();
  let enviados = 0, removidos = 0;
  for (const l of lista) {
    const msg = montar(l);
    if (!msg) continue;
    const st = await enviar(l, msg, k).catch((e) => { console.error('push', String(e)); return 0; });
    if (st === 404 || st === 410) { await rpc('push_remover', { p_endpoint: l.endpoint }); removidos++; }
    else if (st >= 200 && st < 300) enviados++;
    else console.error('push', st, new URL(l.endpoint).host);
  }
  return { aparelhos: lista.length, enviados, removidos };
}

export async function tratar(req: Request): Promise<Response> {
  const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  let corpo: any = {};
  try { corpo = await req.json(); } catch { /* sem corpo: rodar */ }
  try {
    const acao = corpo?.acao || 'rodar';
    if (acao === 'rodar') {
      const r = await mandarPara(await rpc('push_reservar', { p_agora: new Date().toISOString() }), mensagem);
      console.log('notificar', JSON.stringify(r));
      return resposta(r);
    }
    const email = await emailDoLogin(req);
    if (acao === 'chave') return resposta({ publica: (await chaves()).publica });
    if (acao === 'teste') {
      return resposta(await mandarPara(await rpc('push_do_email', { p_email: email }), () => ({
        titulo: 'Notificações do CredFlux ligadas',
        texto: 'Às 9h, os vencimentos do dia. Às 21h, os clientes de amanhã.',
        url: './?aviso=hoje', tag: 'credflux-teste',
      })));
    }
    return resposta({ erro: 'Pedido desconhecido.' }, 400);
  } catch (e: any) {
    console.error('notificar', String(e?.message || e));
    return resposta({ erro: String(e?.message || e) }, e?.status || 500);
  }
}

(globalThis as any).Deno?.serve(tratar);
