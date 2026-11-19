// Teste das notificações no celular (função supabase/functions/notificar): criptografia da RFC 8291,
// assinatura VAPID (RFC 8292) e os textos. Roda no Node 24 (lê o TypeScript direto), sem instalar nada.
// Uso: node testes/teste_push.mjs [pasta com node_modules/web-push]  (opcional: confere com a biblioteca http_ece)
import { createECDH, createPublicKey, verify } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

const F = await import('../supabase/functions/notificar/index.ts');
const { b64u, deB64u, cifrar, assinaturaVapid, novasChaves, mensagem } = F;
const res = [];
const ok = (c, m) => res.push((c ? 'OK    ' : 'FALHA ') + m);
const txt = s => new TextEncoder().encode(s);

// 1. Exemplo completo da RFC 8291 (apêndice A): mesma chave efêmera e mesmo sal, mesma saída byte a byte.
const asPub = deB64u('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
const jwk = { kty: 'EC', crv: 'P-256', d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', x: b64u(asPub.slice(1, 33)), y: b64u(asPub.slice(33, 65)) };
const efemera = {
  privateKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']),
  publicKey: await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
};
const rfc = await cifrar('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg',
  txt('When I grow up, I want to be a watermelon'), { efemera, sal: deB64u('DGv6ra1nlYgDCS1FRnbzlw') });
ok(b64u(rfc) === 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  'Cifra igual ao exemplo da RFC 8291, byte a byte');

// 2. Mensagem com acentos decifrada por outra implementação (http_ece, a mesma do pacote web-push).
if (process.argv[2]) {
  const ece = createRequire(path.join(path.resolve(process.argv[2]), 'node_modules', 'x.js'))('http_ece');
  const ua = createECDH('prime256v1'); ua.generateKeys();
  const segredo = b64u(crypto.getRandomValues(new Uint8Array(16)));
  const claro = JSON.stringify({ titulo: 'Hoje: 2 clientes · R$ 1.234,56', texto: 'Padaria Pão Dourado R$ 750,00, Açaí da Praça R$ 484,56' });
  const c = await cifrar(b64u(ua.getPublicKey()), segredo, txt(claro));
  const volta = ece.decrypt(Buffer.from(c), { version: 'aes128gcm', privateKey: ua, authSecret: segredo }).toString('utf8');
  ok(volta === claro, 'http_ece decifra a notificação (acentos e R$ intactos)');
  ok(c.length < 4096, `Notificação dentro do limite de 4 KB dos serviços (${c.length} bytes)`);
}

// 3. VAPID: assinatura ES256 válida com a chave pública, para o serviço certo, com contato e validade de 12 h.
const k = await novasChaves();
const agora = Date.UTC(2026, 10, 19, 12);
const cab = await assinaturaVapid('https://fcm.googleapis.com/fcm/send/abc:123', k, agora);
const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(cab);
const pub = deB64u(k.publica);
const chavePub = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)) }, format: 'jwk' });
const valida = !!m && verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: chavePub, dsaEncoding: 'ieee-p1363' }, Buffer.from(deB64u(m[3])));
const claims = m ? JSON.parse(new TextDecoder().decode(deB64u(m[2]))) : {};
ok(valida && m[4] === k.publica && pub.length === 65, 'Assinatura VAPID confere com a chave pública');
ok(claims.aud === 'https://fcm.googleapis.com' && claims.sub === 'mailto:credfluxapp@gmail.com' && claims.exp === agora / 1000 + 43200,
  `VAPID para o serviço do aparelho, com contato e 12 h de validade (${claims.aud})`);
ok(k.privada.kty === 'EC' && k.privada.crv === 'P-256' && typeof k.privada.d === 'string' && !k.publica.includes(k.privada.d), 'Chave privada em JWK (P-256); a pública não leva a parte secreta');

// 4. Textos
const itens = [{ cliente: 'Padaria Pão Dourado', valor: 750 }, { cliente: 'Açaí da Praça', valor: '55.5' }, { cliente: 'Loja Moda Center', valor: 10 }, { cliente: 'Oficina', valor: 5 }];
const h1 = mensagem({ tipo: 'hoje', detalhes: true, itens, atrasadas: 2, valor_atraso: '1200' });
ok(h1.titulo === 'Hoje: 4 clientes · R$ 820,50' && h1.texto === 'Padaria Pão Dourado R$ 750,00, Açaí da Praça R$ 55,50, Loja Moda Center R$ 10,00 e mais 1 · 2 parcelas em atraso (R$ 1.200,00)'
  && h1.url === './?aviso=hoje' && h1.tag === 'credflux-hoje', `Manhã com nomes e valores: "${h1.titulo}" / "${h1.texto}"`);
const h2 = mensagem({ tipo: 'hoje', detalhes: false, itens: itens.slice(0, 1), atrasadas: 1, valor_atraso: 300 });
ok(h2.titulo === 'Vencimentos de hoje' && h2.texto === '1 cliente tem parcela hoje e há 1 parcela em atraso. Toque para ver.' && !/R\$|Padaria/.test(h2.texto), `Manhã discreta, sem nomes nem valores: "${h2.texto}"`);
const h3 = mensagem({ tipo: 'hoje', detalhes: true, itens: [], atrasadas: 3, valor_atraso: 90 });
ok(h3.titulo === 'Parcelas em atraso' && h3.texto === '3 parcelas em atraso (R$ 90,00). Toque para ver e cobrar.', `Só atrasos: "${h3.texto}"`);
ok(mensagem({ tipo: 'hoje', detalhes: true, itens: [], atrasadas: 0 }) === null && mensagem({ tipo: 'amanha', detalhes: true, itens: [] }) === null, 'Nada a avisar: nenhuma notificação');
const a1 = mensagem({ tipo: 'amanha', detalhes: true, itens: itens.slice(0, 2) });
ok(a1.titulo === 'Amanhã: 2 clientes · R$ 805,50' && a1.texto === 'Padaria Pão Dourado R$ 750,00, Açaí da Praça R$ 55,50' && a1.url === './?aviso=amanha' && a1.tag === 'credflux-amanha', `Noite: "${a1.titulo}" / "${a1.texto}"`);
const a2 = mensagem({ tipo: 'amanha', detalhes: false, itens: itens.slice(0, 1) });
ok(a2.titulo === 'Vencimentos de amanhã' && a2.texto === '1 cliente tem parcela amanhã. Toque para ver.', `Noite discreta: "${a2.texto}"`);

// 5. Pedido sem login para "chave" ou "teste" é recusado; OPTIONS (CORS) responde.
const r1 = await F.tratar(new Request('https://x/notificar', { method: 'OPTIONS' }));
ok(r1.status === 200 && r1.headers.get('Access-Control-Allow-Origin') === '*', 'Pré-voo (CORS) liberado para o aplicativo');
const r2 = await F.tratar(new Request('https://x/notificar', { method: 'POST', body: JSON.stringify({ acao: 'teste' }), headers: { Authorization: 'Bearer sb_publishable_x' } }));
ok(r2.status === 401, `Teste sem login recusado (${r2.status})`);

console.log(res.join('\n'));
process.exit(res.some(r => r.startsWith('FALHA')) ? 1 : 0);
