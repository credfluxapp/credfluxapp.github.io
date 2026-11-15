// Acesso aos dados: Supabase (produção) ou navegador (demonstração).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { gerarParcelas, vencimentoPadrao, addDias, addMeses, hoje } from './calc.js';

export const configurado = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

function erro(e) {
  if (!e) return;
  const m = e.message || String(e);
  const traduz = [
    [/Invalid login credentials/i, 'E-mail ou senha incorretos.'],
    [/Email not confirmed/i, 'Confirme o e-mail com o código que enviamos.'],
    [/Token has expired or is invalid|otp_expired|invalid.*(otp|token)/i, 'Código inválido ou vencido. Confira os números ou peça outro código.'],
    [/only request this after|security purposes/i, 'Aguarde um minuto para pedir outro código.'],
    [/User already registered/i, 'Este e-mail já tem acesso. Use "Entrar" ou "Esqueci a senha".'],
    [/Password should be at least/i, 'A senha precisa de pelo menos 6 caracteres.'],
    [/row-level security|violates row-level/i, 'Sem permissão para gravar (assinatura vencida ou acesso limitado).'],
    [/membros_pkey|duplicate key value.*membros/i, 'Este e-mail já participa de uma conta.'],
    [/aportes_cliente_id_fkey|violates foreign key.*aportes/i, 'Este cliente tem aportes. Exclua os aportes antes.'],
    [/rate limit/i, 'Muitas tentativas seguidas. Aguarde alguns minutos.'],
    [/Payload too large|exceeded the maximum allowed size|too large/i, 'Arquivo grande demais (limite de 10 MB).'],
    [/mime type|invalid_mime/i, 'Tipo de arquivo não aceito. Envie PDF ou foto (JPG, PNG, WEBP, HEIC).'],
    [/relation "?(public\.)?documentos"? does not exist|Bucket not found|salvar_dados_acordo|column .*mora|column .*prazo_dias/i, 'O banco ainda não recebeu a atualização 01 (supabase/atualizacao_01.sql).'],
    [/Failed to fetch|NetworkError/i, 'Sem conexão com o servidor. Confira a internet e tente de novo.'],
  ];
  for (const [re, txt] of traduz) if (re.test(m)) throw new Error(txt);
  throw new Error(m);
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------
async function criarRemoto() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  const ok = ({ data, error }) => { erro(error); return data; };

  async function todos(tabela, ordem) {
    const passo = 1000; let ini = 0; const out = [];
    for (;;) {
      const d = ok(await sb.from(tabela).select('*').order(ordem).range(ini, ini + passo - 1));
      out.push(...d);
      if (d.length < passo) return out;
      ini += passo;
    }
  }

  return {
    modo: 'online',
    async usuario() { const { data } = await sb.auth.getSession(); return data.session?.user || null; },
    aoMudarAcesso(cb) { sb.auth.onAuthStateChange((ev, s) => cb(ev, s?.user || null)); },
    async entrar(email, senha) { ok(await sb.auth.signInWithPassword({ email, password: senha })); },
    async criarAcesso(email, senha) {
      const d = ok(await sb.auth.signUp({ email, password: senha, options: { emailRedirectTo: location.origin + location.pathname } }));
      return { precisaConfirmar: !d.session };
    },
    async esqueci(email) { ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })); },
    // Confirmação do cadastro pelo código que chega no e-mail (modelo "Confirm signup" com {{ .Token }}).
    // Dá certo: a sessão começa e o aoMudarAcesso recebe SIGNED_IN.
    async confirmarCodigo(email, codigo) { ok(await sb.auth.verifyOtp({ email, token: codigo, type: 'email' })); },
    async reenviarCodigo(email) { ok(await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: location.origin + location.pathname } })); },
    async novaSenha(senha) { ok(await sb.auth.updateUser({ password: senha })); },
    async sair() { await sb.auth.signOut(); },
    async configPublica() {
      const { data } = await sb.from('config').select('preco_mensal,dias_teste,contato').eq('id', 1).maybeSingle();
      return data || {};
    },

    async perfil(user) {
      const email = user.email.toLowerCase();
      const [m, adm, cfg] = await Promise.all([
        sb.from('membros').select('*').eq('email', email).maybeSingle(),
        sb.from('administradores').select('email').eq('email', email).maybeSingle(),
        sb.from('config').select('*').eq('id', 1).maybeSingle(),
      ]);
      erro(m.error); erro(cfg.error);
      let conta = null;
      if (m.data) conta = ok(await sb.from('contas').select('*').eq('id', m.data.conta_id).maybeSingle());
      return { email, membro: m.data, conta, admin: Boolean(adm.data), config: cfg.data || {} };
    },
    async criarConta(nome, seuNome) { ok(await sb.rpc('criar_conta', { p_nome: nome, p_seu_nome: seuNome })); },

    async carregar() {
      const [clientes, aportes, parcelas] = await Promise.all([
        todos('clientes', 'nome'), todos('aportes', 'data_aporte'), todos('parcelas', 'vencimento'),
      ]);
      return { clientes, aportes, parcelas };
    },
    async salvarCliente(c) {
      const campos = { nome: c.nome, documento: c.documento, telefone: c.telefone, email: c.email, obs: c.obs };
      return c.id
        ? ok(await sb.from('clientes').update(campos).eq('id', c.id).select().single())
        : ok(await sb.from('clientes').insert(campos).select().single());
    },
    async excluirCliente(id) {
      const { count } = await sb.from('aportes').select('id', { count: 'exact', head: true }).eq('cliente_id', id);
      if (count) throw new Error('Este cliente tem aportes. Exclua os aportes antes.');
      const docs = (await sb.from('documentos').select('caminho').eq('cliente_id', id)).data || [];
      if (docs.length) await sb.storage.from('documentos').remove(docs.map(d => d.caminho));
      ok(await sb.from('clientes').delete().eq('id', id));
    },
    async salvarAporte(a, parcelas) { return ok(await sb.rpc('salvar_aporte', { p_aporte: a, p_parcelas: parcelas })); },
    async excluirAporte(id) { ok(await sb.from('aportes').delete().eq('id', id)); },
    async receber(id, data, valor, obs, mora = 0) {
      ok(await sb.from('parcelas').update({ recebido_em: data, valor_recebido: valor, mora, obs: obs || null }).eq('id', id));
    },
    async desfazer(id) { ok(await sb.from('parcelas').update({ recebido_em: null, valor_recebido: null, mora: 0 }).eq('id', id)); },
    async salvarDadosAcordo(d) { ok(await sb.rpc('salvar_dados_acordo', { p: d })); },

    // Documentos: arquivo no Storage (pasta <conta>/<cliente>/) e uma linha na tabela documentos.
    async documentos(clienteId) { return ok(await sb.from('documentos').select('*').eq('cliente_id', clienteId).order('criado_em', { ascending: false })); },
    async enviarDocumento(contaId, clienteId, arquivo, nome) {
      const limpo = (nome || arquivo.name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.\-]+/g, '_').slice(-80);
      const caminho = `${contaId}/${clienteId}/${Date.now()}_${limpo}`;
      ok(await sb.storage.from('documentos').upload(caminho, arquivo, { contentType: arquivo.type || 'application/octet-stream' }));
      const r = await sb.from('documentos').insert({ cliente_id: clienteId, nome: nome || arquivo.name, caminho, tipo: arquivo.type, tamanho: arquivo.size }).select().single();
      if (r.error) { await sb.storage.from('documentos').remove([caminho]); erro(r.error); }
      return r.data;
    },
    async abrirDocumento(doc) {
      const d = ok(await sb.storage.from('documentos').createSignedUrl(doc.caminho, 300));
      return d.signedUrl;
    },
    async excluirDocumento(doc) {
      ok(await sb.storage.from('documentos').remove([doc.caminho]));
      ok(await sb.from('documentos').delete().eq('id', doc.id));
    },

    async membros() { return ok(await sb.from('membros').select('*').order('criado_em')); },
    async incluirMembro(contaId, email, nome) {
      ok(await sb.from('membros').insert({ conta_id: contaId, email: email.toLowerCase().trim(), nome, papel: 'membro' }));
    },
    async tirarMembro(email) { ok(await sb.from('membros').delete().eq('email', email)); },

    async pagamentos() { return ok(await sb.from('pagamentos').select('*').order('criado_em', { ascending: false })); },
    async informarPagamento(meses) { ok(await sb.rpc('informar_pagamento', { p_meses: meses })); },

    async adminContas() { return ok(await sb.rpc('admin_contas')); },
    async adminPagamentos() { return ok(await sb.from('pagamentos').select('*').order('criado_em', { ascending: false }).limit(300)); },
    async confirmarPagamento(id, aprovado) { ok(await sb.rpc('confirmar_pagamento', { p_id: id, p_ok: aprovado })); },
    async ajustarAssinatura(contaId, data) { ok(await sb.from('contas').update({ assinatura_ate: data }).eq('id', contaId)); },
    async salvarConfig(cfg) { ok(await sb.from('config').update(cfg).eq('id', 1)); },
  };
}

// ---------------------------------------------------------------------------
// Demonstração (dados de exemplo guardados só neste navegador)
// ---------------------------------------------------------------------------
export const CHAVE_DEMO = 'credflux_demo_v2';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

function semente() {
  const h = hoje();
  const db = { clientes: [], aportes: [], parcelas: [], membros: [], pagamentos: [], documentos: [] };
  const conta = { id: 'demo', nome: 'Carteira de demonstração', assinatura_ate: addDias(h, 12), credor_nome: 'Você (demonstração)', credor_doc: '000.000.000-00', credor_cidade: 'Imperatriz/MA', credor_endereco: '' };
  db.conta = conta;
  db.membros.push({ email: 'voce@exemplo.com', conta_id: 'demo', nome: 'Você', papel: 'dono' });
  const cli = (nome, telefone, documento) => { const c = { id: uid(), nome, telefone, documento, email: '', obs: '' }; db.clientes.push(c); return c; };
  const a = cli('Padaria Pão Dourado', '(98) 99999-1001', '12.345.678/0001-90');
  const b = cli('Oficina Mecânica Silva', '(98) 99999-2002', '23.456.789/0001-01');
  const c = cli('Loja Moda Center', '(98) 99999-3003', '34.567.890/0001-12');
  const d = cli('Mercadinho Bom Preço', '(98) 99999-4004', '45.678.901/0001-23');
  const ap = (cliente, valor, diasAtras, taxa, modalidade, n, per = 'mensal', prazoMeses = 6, prazoDias = null) => {
    const data = addDias(h, -diasAtras);
    const x = { id: uid(), cliente_id: cliente.id, valor, data_aporte: data, taxa, taxa_periodo: 'mes', regime: modalidade === 'fixa' ? 'simples' : 'compostos', modalidade, periodicidade: per, n_parcelas: n, prazo_dias: prazoDias, obs: '' };
    const primeiro = modalidade === 'unico' ? addMeses(data, prazoMeses) : vencimentoPadrao(data, per);
    db.aportes.push(x);
    for (const p of gerarParcelas({ ...x, primeiro_venc: primeiro })) {
      const pp = { ...p, id: uid(), aporte_id: x.id, recebido_em: null, valor_recebido: null, mora: 0, obs: null };
      if (pp.vencimento < addDias(h, -3)) { pp.recebido_em = pp.vencimento; pp.valor_recebido = pp.valor; }
      db.parcelas.push(pp);
    }
  };
  ap(a, 30000, 95, 2.5, 'juros', 12);
  ap(b, 15000, 60, 3, 'price', 10);
  ap(c, 50000, 40, 2, 'unico', 1, 'mensal', 3);
  ap(d, 8000, 20, 1.5, 'price', 8, 'quinzenal');
  ap(a, 12000, 200, 2.2, 'sac', 9);
  const e = cli('Açaí da Praça', '(98) 99999-5005', '567.890.123-45');
  ap(e, 1000, 12, 10, 'fixa', 11, 'diaria', 0, 30);
  // uma parcela atrasada para a demonstração
  const atrasada = db.parcelas.find(p => p.vencimento < h && p.vencimento >= addDias(h, -3) && !p.recebido_em)
    || db.parcelas.filter(p => p.recebido_em).slice(-1)[0];
  if (atrasada) { atrasada.recebido_em = null; atrasada.valor_recebido = null; }
  return db;
}

function criarDemo() {
  let db = JSON.parse(localStorage.getItem(CHAVE_DEMO) || 'null') || semente();
  const gravar = () => localStorage.setItem(CHAVE_DEMO, JSON.stringify(db));
  gravar();
  const usuario = { email: 'voce@exemplo.com' };
  const config = { preco_mensal: 99.9, dias_teste: 30, chave_pix: 'demonstracao@exemplo.com', nome_recebedor: 'CredFlux', cidade: 'Imperatriz', contato: '' };
  return {
    modo: 'demo',
    async usuario() { return usuario; },
    aoMudarAcesso() {},
    async sair() { localStorage.removeItem(CHAVE_DEMO); location.href = location.pathname; },
    async configPublica() { return config; },
    async perfil() { return { email: usuario.email, membro: db.membros[0], conta: db.conta, admin: false, config }; },
    async carregar() { return structuredClone({ clientes: db.clientes, aportes: db.aportes, parcelas: db.parcelas }); },
    async salvarCliente(c) {
      if (c.id) { Object.assign(db.clientes.find(x => x.id === c.id), c); }
      else { c = { ...c, id: uid() }; db.clientes.push(c); }
      gravar(); return c;
    },
    async excluirCliente(id) {
      if (db.aportes.some(a => a.cliente_id === id)) throw new Error('Este cliente tem aportes. Exclua os aportes antes.');
      db.clientes = db.clientes.filter(c => c.id !== id);
      db.documentos = (db.documentos || []).filter(d => d.cliente_id !== id); gravar();
    },
    async salvarAporte(a, parcelas) {
      const id = a.id || uid();
      db.aportes = db.aportes.filter(x => x.id !== id).concat([{ ...a, id }]);
      db.parcelas = db.parcelas.filter(p => p.aporte_id !== id)
        .concat(parcelas.map(p => ({ ...p, id: uid(), aporte_id: id })));
      gravar(); return id;
    },
    async excluirAporte(id) {
      db.aportes = db.aportes.filter(a => a.id !== id);
      db.parcelas = db.parcelas.filter(p => p.aporte_id !== id); gravar();
    },
    async receber(id, data, valor, obs, mora = 0) { Object.assign(db.parcelas.find(p => p.id === id), { recebido_em: data, valor_recebido: valor, mora, obs: obs || null }); gravar(); },
    async desfazer(id) { Object.assign(db.parcelas.find(p => p.id === id), { recebido_em: null, valor_recebido: null, mora: 0 }); gravar(); },
    async salvarDadosAcordo(d) { Object.assign(db.conta, d); gravar(); },
    // Na demonstração, os arquivos ficam no navegador (até 2 MB cada).
    async documentos(clienteId) { return (db.documentos || []).filter(d => d.cliente_id === clienteId).sort((a, b) => b.criado_em.localeCompare(a.criado_em)); },
    async enviarDocumento(contaId, clienteId, arquivo, nome) {
      if (arquivo.size > 2 * 1024 * 1024) throw new Error('Na demonstração, o limite é 2 MB por arquivo.');
      const dados = await new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = falha; r.readAsDataURL(arquivo); });
      const d = { id: uid(), cliente_id: clienteId, nome: nome || arquivo.name, caminho: uid(), tipo: arquivo.type, tamanho: arquivo.size, criado_em: new Date().toISOString(), dados };
      db.documentos = db.documentos || []; db.documentos.push(d);
      try { gravar(); } catch { db.documentos.pop(); throw new Error('Sem espaço no navegador para este arquivo.'); }
      return d;
    },
    async abrirDocumento(doc) { const d = db.documentos.find(x => x.id === doc.id); return URL.createObjectURL(await (await fetch(d.dados)).blob()); },
    async excluirDocumento(doc) { db.documentos = db.documentos.filter(x => x.id !== doc.id); gravar(); },
    async membros() { return db.membros; },
    async incluirMembro(contaId, email, nome) {
      email = email.toLowerCase().trim();
      if (db.membros.some(m => m.email === email)) throw new Error('Este e-mail já participa de uma conta.');
      db.membros.push({ email, conta_id: contaId, nome, papel: 'membro' }); gravar();
    },
    async tirarMembro(email) { db.membros = db.membros.filter(m => m.email !== email); gravar(); },
    async pagamentos() { return db.pagamentos; },
    async informarPagamento(meses) {
      if (db.pagamentos.some(p => p.status === 'informado')) throw new Error('Já existe um pagamento aguardando confirmação');
      db.pagamentos.unshift({ id: uid(), valor: config.preco_mensal * meses, meses, status: 'informado', criado_em: new Date().toISOString(), txid: 'APTDEMO' });
      gravar();
    },
  };
}

export async function abrirStore(demo) {
  return demo ? criarDemo() : criarRemoto();
}
