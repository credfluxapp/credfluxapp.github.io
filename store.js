// Acesso aos dados: Supabase (produção) ou navegador (demonstração).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { gerarParcelas, vencimentoPadrao, addDias, addMeses, hoje } from './calc.js';

export const configurado = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

function erro(e) {
  if (!e) return;
  const m = e.message || String(e);
  const traduz = [
    [/Invalid login credentials/i, 'E-mail ou senha incorretos.'],
    [/Email not confirmed/i, 'Confirme o e-mail pelo link que enviamos antes de entrar.'],
    [/User already registered/i, 'Este e-mail já tem acesso. Use "Entrar" ou "Esqueci a senha".'],
    [/Password should be at least/i, 'A senha precisa de pelo menos 6 caracteres.'],
    [/row-level security|violates row-level/i, 'Sem permissão para gravar (assinatura vencida ou acesso limitado).'],
    [/membros_pkey|duplicate key value.*membros/i, 'Este e-mail já participa de uma conta.'],
    [/aportes_cliente_id_fkey|violates foreign key.*aportes/i, 'Este cliente tem aportes. Exclua os aportes antes.'],
    [/rate limit/i, 'Muitas tentativas seguidas. Aguarde alguns minutos.'],
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
    async excluirCliente(id) { ok(await sb.from('clientes').delete().eq('id', id)); },
    async salvarAporte(a, parcelas) { return ok(await sb.rpc('salvar_aporte', { p_aporte: a, p_parcelas: parcelas })); },
    async excluirAporte(id) { ok(await sb.from('aportes').delete().eq('id', id)); },
    async receber(id, data, valor, obs) {
      ok(await sb.from('parcelas').update({ recebido_em: data, valor_recebido: valor, obs: obs || null }).eq('id', id));
    },
    async desfazer(id) { ok(await sb.from('parcelas').update({ recebido_em: null, valor_recebido: null }).eq('id', id)); },

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
const CHAVE_DEMO = 'aportes_demo_v1';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

function semente() {
  const h = hoje();
  const db = { clientes: [], aportes: [], parcelas: [], membros: [], pagamentos: [] };
  const conta = { id: 'demo', nome: 'Carteira de demonstração', assinatura_ate: addDias(h, 12) };
  db.conta = conta;
  db.membros.push({ email: 'voce@exemplo.com', conta_id: 'demo', nome: 'Você', papel: 'dono' });
  const cli = (nome, telefone, documento) => { const c = { id: uid(), nome, telefone, documento, email: '', obs: '' }; db.clientes.push(c); return c; };
  const a = cli('Padaria Pão Dourado', '(98) 99999-1001', '12.345.678/0001-90');
  const b = cli('Oficina Mecânica Silva', '(98) 99999-2002', '23.456.789/0001-01');
  const c = cli('Loja Moda Center', '(98) 99999-3003', '34.567.890/0001-12');
  const d = cli('Mercadinho Bom Preço', '(98) 99999-4004', '45.678.901/0001-23');
  const ap = (cliente, valor, diasAtras, taxa, modalidade, n, per = 'mensal', prazoMeses = 6) => {
    const data = addDias(h, -diasAtras);
    const x = { id: uid(), cliente_id: cliente.id, valor, data_aporte: data, taxa, taxa_periodo: 'mes', regime: 'compostos', modalidade, periodicidade: per, n_parcelas: n, obs: '' };
    const primeiro = modalidade === 'unico' ? addMeses(data, prazoMeses) : vencimentoPadrao(data, per);
    db.aportes.push(x);
    for (const p of gerarParcelas({ ...x, primeiro_venc: primeiro })) {
      const pp = { ...p, id: uid(), aporte_id: x.id, recebido_em: null, valor_recebido: null, obs: null };
      if (pp.vencimento < addDias(h, -3)) { pp.recebido_em = pp.vencimento; pp.valor_recebido = pp.valor; }
      db.parcelas.push(pp);
    }
  };
  ap(a, 30000, 95, 2.5, 'juros', 12);
  ap(b, 15000, 60, 3, 'price', 10);
  ap(c, 50000, 40, 2, 'unico', 1, 'mensal', 3);
  ap(d, 8000, 20, 1.5, 'price', 8, 'quinzenal');
  ap(a, 12000, 200, 2.2, 'sac', 9);
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
  const config = { preco_mensal: 49.9, dias_teste: 15, chave_pix: 'demonstracao@exemplo.com', nome_recebedor: 'CredFlux', cidade: 'Imperatriz', contato: '' };
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
      db.clientes = db.clientes.filter(c => c.id !== id); gravar();
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
    async receber(id, data, valor, obs) { Object.assign(db.parcelas.find(p => p.id === id), { recebido_em: data, valor_recebido: valor, obs: obs || null }); gravar(); },
    async desfazer(id) { Object.assign(db.parcelas.find(p => p.id === id), { recebido_em: null, valor_recebido: null }); gravar(); },
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
