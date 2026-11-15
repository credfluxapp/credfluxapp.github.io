import { abrirStore, configurado } from './store.js';
import * as C from './calc.js';
import { pixCopiaECola } from './pix.js';

const { moeda, hoje, parseISO, toISO, addDias, r2 } = C;

// Utilidades -----------------------------------------------------------------
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dataBR = s => (s ? s.split('-').reverse().join('/') : '');
const dataCurta = s => (s ? s.slice(8, 10) + '/' + s.slice(5, 7) : '');
const DSEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESL = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const diaSem = s => DSEM[parseISO(s).getDay()];
const mesRot = ym => MESL[+ym.slice(5, 7) - 1] + ' de ' + ym.slice(0, 4);
const mesCurto = ym => MES[+ym.slice(5, 7) - 1] + '/' + ym.slice(2, 4);
const soma = (arr, f) => r2(arr.reduce((s, x) => s + (Number(f(x)) || 0), 0));
const inicioMes = (s, k = 0) => { const d = parseISO(s); return toISO(new Date(d.getFullYear(), d.getMonth() + k, 1)); };
const fimMes = (s, k = 0) => { const d = parseISO(s); return toISO(new Date(d.getFullYear(), d.getMonth() + k + 1, 0)); };
const fmtTaxa = a => `${C.num(Number(a.taxa), 2)}% a.${a.taxa_periodo === 'ano' ? 'a.' : 'm.'}`;
const soDigitos = s => String(s || '').replace(/\D/g, '');

function toast(msg, tipo = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + tipo; t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), tipo === 'erro' ? 6000 : 3000);
}

const dlg = () => $('#dlg');
function abrir(html, larga = false) {
  $('#dlg-corpo').innerHTML = html;
  dlg().classList.toggle('larga', larga);
  if (!dlg().open) dlg().showModal();
  const f = $('#dlg-corpo [autofocus]'); if (f) f.focus();
}
const fechar = () => dlg().open && dlg().close();

async function tentar(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg, 'ok'); return r; }
  catch (e) { console.error(e); toast(e.message || 'Erro', 'erro'); throw e; }
}

// Ícones Lucide (lucide.dev, licença ISC), traço fino.
const ICON = {
  inicio: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  agenda: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  clientes: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  aportes: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  mais: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  grafico: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
};
const icone = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
// Marca do CredFlux: um "C" que termina em seta (o crédito que volta).
const MARCA_ICONE = '<svg class="marca-ic" viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="112" fill="currentColor"/><g fill="none" stroke="var(--marca-traco, #fff)" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"><path d="M352 160A136 136 0 1 0 256 392H400"/><path d="M356 348l44 44-44 44"/></g></svg>';
const MARCA = `<span class="logo">${MARCA_ICONE}<b>CredFlux</b></span>`;

// Estado ------------------------------------------------------------------------
const S = {
  store: null, user: null, perfil: null, publica: {},
  dados: { clientes: [], aportes: [], parcelas: [] },
  cli: new Map(), ap: new Map(), parcPorAp: new Map(),
  view: 'inicio', grafico: 'meses',
  f: { periodo: 'p30', de: '', ate: '', cliente: '', situacao: 'pendente', agrupar: 'dia' },
  fCli: '', fAp: { status: 'ativos', cliente: '', busca: '' },
  form: null,
};
const demo = () => S.store?.modo === 'demo';
const leitura = () => !demo() && S.perfil?.conta && S.perfil.conta.assinatura_ate < hoje();
const ehDono = () => S.perfil?.membro?.papel === 'dono';

function indexar() {
  S.cli = new Map(S.dados.clientes.map(c => [c.id, c]));
  S.ap = new Map(S.dados.aportes.map(a => [a.id, a]));
  S.parcPorAp = new Map();
  for (const p of S.dados.parcelas) {
    p.valor = Number(p.valor); p.juros = Number(p.juros); p.amortizacao = Number(p.amortizacao);
    if (p.valor_recebido != null) p.valor_recebido = Number(p.valor_recebido);
    if (!S.parcPorAp.has(p.aporte_id)) S.parcPorAp.set(p.aporte_id, []);
    S.parcPorAp.get(p.aporte_id).push(p);
  }
  for (const l of S.parcPorAp.values()) l.sort((a, b) => a.num - b.num);
  for (const a of S.dados.aportes) { a.valor = Number(a.valor); a.taxa = Number(a.taxa); }
  S.dados.clientes.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

async function recarregar() {
  S.dados = await S.store.carregar();
  indexar();
  render();
}

const clienteDe = p => S.cli.get(S.ap.get(p.aporte_id)?.cliente_id);
const pendentes = () => S.dados.parcelas.filter(p => !p.recebido_em);

function resumoAporte(a) {
  const ps = S.parcPorAp.get(a.id) || [];
  const pend = ps.filter(p => !p.recebido_em);
  const h = hoje();
  return {
    ps, pend,
    pagas: ps.length - pend.length,
    total: soma(ps, p => p.valor),
    recebido: soma(ps, p => p.recebido_em ? p.valor_recebido : 0),
    aReceber: soma(pend, p => p.valor),
    capital: soma(pend, p => p.amortizacao),
    lucro: r2(soma(ps, p => p.valor) - a.valor),
    proxima: pend[0],
    atrasadas: pend.filter(p => p.vencimento < h),
    quitado: ps.length > 0 && pend.length === 0,
  };
}

function resumoCliente(c) {
  const aps = S.dados.aportes.filter(a => a.cliente_id === c.id);
  const rs = aps.map(resumoAporte);
  return {
    aps,
    ativos: rs.filter(r => !r.quitado).length,
    investido: soma(aps, a => a.valor),
    aReceber: soma(rs, r => r.aReceber),
    capital: soma(rs, r => r.capital),
    atraso: soma(rs, r => soma(r.atrasadas, p => p.valor)),
  };
}

const ST_ROT = { recebida: 'Recebida', atrasada: 'Em atraso', hoje: 'Vence hoje', pendente: 'A receber' };

// Telas de acesso ----------------------------------------------------------------
function telaAcesso(modo = 'entrar', aviso = '') {
  const pub = S.publica || {};
  const preco = pub.preco_mensal ? moeda(Number(pub.preco_mensal)) : '';
  const abas = [['entrar', 'Entrar'], ['criar', 'Criar acesso'], ['esqueci', 'Esqueci a senha']]
    .map(([m, t]) => `<button type="button" class="aba ${m === modo ? 'on' : ''}" data-a="acesso" data-m="${m}">${t}</button>`).join('');
  const botao = { entrar: 'Entrar', criar: 'Criar acesso', esqueci: 'Enviar link para nova senha' }[modo];
  const recursos = [
    ['agenda', 'Agenda de vencimentos', 'O que vence hoje, nos próximos dias e o que está em atraso, com filtro por período e cliente.'],
    ['aportes', 'Crédito com a sua regra', 'Pagamento único, só juros, parcelas iguais (Price), SAC ou parcelas definidas por você. Juros simples ou compostos.'],
    ['grafico', 'Previsão de recebimentos', 'Quanto entra em cada dia dos próximos 30 dias e em cada um dos próximos 12 meses.'],
    ['clientes', 'Acesso para a equipe', 'Mais de uma pessoa na mesma conta, no celular ou no computador.'],
  ].map(([i, t, d]) => `<li><span class="ini-ic">${icone(i)}</span><div><b>${t}</b><span>${d}</span></div></li>`).join('');
  document.body.className = 'fora';
  $('#app').innerHTML = `
  <header class="ini-topo">
    ${MARCA}
    <a href="?demo" class="btn sec peq">Ver demonstração</a>
  </header>
  <main class="acesso inicial">
    <section class="ini-texto">
      <p class="ini-rot">Gestão de crédito para quem empresta dinheiro</p>
      <h1>Clientes, créditos e parcelas em um só lugar</h1>
      <p class="ini-desc">Cadastre cada crédito com o valor, a taxa e a forma de pagamento. O CredFlux gera as parcelas, mostra o que vence e o que está em atraso e calcula quanto você vai receber por dia e por mês.</p>
      <ul class="ini-lista">${recursos}</ul>
    </section>
    <div class="ini-lado">
      <div class="cartao">
        <h2>Acesse sua conta</h2>
        <div class="abas">${abas}</div>
        ${aviso ? `<p class="aviso">${esc(aviso)}</p>` : ''}
        <form data-f="acesso" data-m="${modo}">
          <label>E-mail<input name="email" type="email" autocomplete="email" required autofocus></label>
          ${modo !== 'esqueci' ? `<label>Senha<input name="senha" type="password" minlength="6" autocomplete="${modo === 'criar' ? 'new-password' : 'current-password'}" required></label>` : ''}
          ${modo === 'criar' ? '<p class="dica">Use o e-mail que vai acessar o sistema. Se alguém incluiu você numa conta, use o mesmo e-mail que essa pessoa cadastrou.</p>' : ''}
          <button class="btn pri largo">${botao}</button>
        </form>
      </div>
      ${preco ? `<div class="preco"><div><b>${preco}</b><span>por mês, pago por Pix</span></div>${pub.dias_teste ? `<span class="chip">${pub.dias_teste} dias de teste sem custo</span>` : ''}</div>` : ''}
      <p class="centro dica">Quer ver antes? <a href="?demo" class="link">Abrir a demonstração com dados de exemplo</a></p>
    </div>
  </main>
  <footer class="ini-pe"><span>CredFlux</span>${pub.contato ? `<span>Contato: ${esc(pub.contato)}</span>` : ''}</footer>`;
}

function telaNovaSenha() {
  document.body.className = 'fora';
  $('#app').innerHTML = `
  <main class="acesso"><div class="acesso-cab">${MARCA}</div><div class="cartao">
    <h2>Nova senha</h2>
    <form data-f="nova-senha">
      <label>Nova senha<input name="senha" type="password" minlength="6" autocomplete="new-password" required autofocus></label>
      <button class="btn pri largo">Gravar senha</button>
    </form>
  </div></main>`;
}

function telaCriarConta() {
  const pub = S.perfil.config || {};
  document.body.className = 'fora';
  $('#app').innerHTML = `
  <main class="acesso"><div class="acesso-cab">${MARCA}</div><div class="cartao">
    <h2>Criar sua conta</h2>
    <p>Você entrou como <b>${esc(S.perfil.email)}</b>. Crie a conta onde ficam seus clientes e créditos.
    ${pub.dias_teste ? `Os primeiros ${pub.dias_teste} dias são de teste, sem custo.` : ''}</p>
    <form data-f="criar-conta">
      <label>Nome da conta<input name="nome" required autofocus placeholder="Ex.: Créditos João Silva"></label>
      <label>Seu nome<input name="seu" autocomplete="name"></label>
      <button class="btn pri largo">Criar conta</button>
    </form>
    <p class="dica">Foi convidado para a conta de outra pessoa? Peça que ela inclua o e-mail ${esc(S.perfil.email)} em Mais › Pessoas com acesso e entre de novo.</p>
    ${S.perfil.admin ? '<button class="btn largo" data-a="nav" data-v="admin">Painel do administrador</button>' : ''}
    <button class="btn sec largo" data-a="sair">Sair</button>
  </div></main>`;
}

function telaSemConfig() {
  document.body.className = 'fora';
  $('#app').innerHTML = `
  <main class="acesso"><div class="acesso-cab">${MARCA}</div><div class="cartao">
    <h2>Sistema ainda não configurado</h2>
    <p>Preencha <code>config.js</code> com o endereço e a chave pública do Supabase (veja LEIAME.md).</p>
    <a class="btn pri largo" href="?demo">Ver demonstração</a>
  </div></main>`;
}

// Estrutura principal ------------------------------------------------------------
const NAV = [['inicio', 'Início'], ['agenda', 'Agenda'], ['clientes', 'Clientes'], ['aportes', 'Créditos'], ['mais', 'Mais']];

function render() {
  if (!S.perfil?.membro) { if (S.view === 'admin' && S.perfil?.admin) return renderAdminSolto(); return telaCriarConta(); }
  document.body.className = 'dentro';
  const conta = S.perfil.conta;
  const nav = NAV.map(([v, t]) => `<button class="nav-it ${S.view === v || (v === 'mais' && ['assinatura', 'admin'].includes(S.view)) ? 'on' : ''}" data-a="nav" data-v="${v}">${icone(v)}<span>${t}</span></button>`).join('');
  $('#app').innerHTML = `
  <header class="topo">
    <div class="topo-nome">${MARCA_ICONE}<b>${esc(conta?.nome || 'CredFlux')}</b>${chipAssinatura()}</div>
    ${['inicio', 'agenda'].includes(S.view) && !leitura() ? `<button class="btn pri peq" data-a="ap-novo">+ Crédito</button>` : ''}
  </header>
  <nav class="nav">${nav}</nav>
  <main class="conteudo">${avisos()}${VIEWS[S.view]()}</main>`;
  window.scrollTo(0, 0);
}

function chipAssinatura() {
  if (demo()) return '<span class="chip info">Demonstração</span>';
  const ate = S.perfil.conta?.assinatura_ate; if (!ate) return '';
  const d = C.diffDias(hoje(), ate);
  if (d < 0) return '<span class="chip ruim" data-a="nav" data-v="assinatura">Vencida</span>';
  if (d <= 5) return `<span class="chip alerta" data-a="nav" data-v="assinatura">Vence em ${d} d</span>`;
  return '';
}

function avisos() {
  const out = [];
  if (demo()) out.push(`<div class="banner info">Demonstração: dados de exemplo guardados só neste navegador. <a href="./" data-a="sair-demo" class="link">Criar conta de verdade</a></div>`);
  else if (leitura()) out.push(`<div class="banner ruim">A assinatura venceu em ${dataBR(S.perfil.conta.assinatura_ate)}. Seus dados estão guardados e visíveis, mas só voltam a ser editáveis após o pagamento. <button class="btn peq" data-a="nav" data-v="assinatura">Pagar com Pix</button></div>`);
  else if (S.perfil.conta) {
    const d = C.diffDias(hoje(), S.perfil.conta.assinatura_ate);
    if (d <= 5) out.push(`<div class="banner alerta">A assinatura vence em ${dataBR(S.perfil.conta.assinatura_ate)}. <button class="btn peq" data-a="nav" data-v="assinatura">Renovar com Pix</button></div>`);
  }
  return out.join('');
}

// Início --------------------------------------------------------------------------
function viewInicio() {
  const h = hoje(); const pend = pendentes();
  const entre = (a, b) => pend.filter(p => p.vencimento >= a && p.vencimento <= b);
  const atraso = pend.filter(p => p.vencimento < h);
  const ini = inicioMes(h), fim = fimMes(h);
  const recMes = S.dados.parcelas.filter(p => p.recebido_em && p.recebido_em >= ini && p.recebido_em <= fim);
  const cards = [
    ['Hoje', entre(h, h), 'hoje', ''],
    ['Próximos 7 dias', entre(h, addDias(h, 7)), 'p7', ''],
    ['Próximos 30 dias', entre(h, addDias(h, 30)), 'p30', ''],
    ['Em atraso', atraso, 'atraso', atraso.length ? 'ruim' : ''],
  ].map(([t, ps, per, cls]) => `
    <button class="kpi ${cls}" data-a="agenda-ir" data-periodo="${per}">
      <span class="kpi-t">${t}</span><b>${moeda(soma(ps, p => p.valor))}</b><span class="kpi-s">${ps.length} parcela${ps.length === 1 ? '' : 's'}</span>
    </button>`).join('');
  const sem = !S.dados.aportes.length;
  return `
  ${sem ? `<div class="vazio"><h2>Comece cadastrando um cliente e um crédito</h2><p>Depois de cadastrar, aqui aparece quanto você vai receber em cada dia e em cada mês.</p>
    ${leitura() ? '' : '<button class="btn pri" data-a="cli-novo">Cadastrar cliente</button>'}</div>` : ''}
  <section class="kpis">${cards}</section>
  <section class="kpis dois">
    <button class="kpi" data-a="agenda-ir" data-periodo="mes" data-situacao="recebida"><span class="kpi-t">Recebido em ${MESL[parseISO(h).getMonth()]}</span><b>${moeda(soma(recMes, p => p.valor_recebido))}</b><span class="kpi-s">${recMes.length} parcela${recMes.length === 1 ? '' : 's'}</span></button>
    <button class="kpi" data-a="nav" data-v="aportes"><span class="kpi-t">Capital emprestado em aberto</span><b>${moeda(soma(pend, p => p.amortizacao))}</b><span class="kpi-s">Total a receber ${moeda(soma(pend, p => p.valor))}</span></button>
  </section>
  <section class="painel">
    <div class="painel-cab"><h2>Previsão de recebimentos</h2>
      <div class="seg">
        <button class="${S.grafico === 'meses' ? 'on' : ''}" data-a="graf" data-m="meses">12 meses</button>
        <button class="${S.grafico === 'dias' ? 'on' : ''}" data-a="graf" data-m="dias">30 dias</button>
      </div></div>
    ${S.grafico === 'meses' ? graficoMeses(pend) : graficoDias(pend)}
  </section>
  <section class="painel">
    <div class="painel-cab"><h2>Próximos recebimentos</h2><button class="btn peq sec" data-a="nav" data-v="agenda">Ver agenda</button></div>
    ${listaParcelas(pend.slice().sort((a, b) => a.vencimento.localeCompare(b.vencimento)).slice(0, 8)) || '<p class="dica">Nenhuma parcela a receber.</p>'}
  </section>`;
}

function barras(linhas) {
  const max = Math.max(1, ...linhas.map(l => l.v));
  return `<div class="barras">${linhas.map(l => `
    <button class="barra" data-a="agenda-ir" data-periodo="custom" data-de="${l.de}" data-ate="${l.ate}">
      <span class="barra-r">${l.rot}</span>
      <span class="barra-t"><span style="width:${(l.v / max * 100).toFixed(1)}%"></span></span>
      <span class="barra-v">${l.v ? moeda(l.v) : '-'}</span>
    </button>`).join('')}</div>`;
}

function graficoMeses(pend) {
  const h = hoje(); const linhas = [];
  for (let k = 0; k < 12; k++) {
    const de = inicioMes(h, k), ate = fimMes(h, k);
    const ini = k === 0 ? h : de;
    linhas.push({ rot: mesCurto(de), de: ini, ate, v: soma(pend.filter(p => p.vencimento >= ini && p.vencimento <= ate), p => p.valor) });
  }
  const tot = soma(linhas, l => l.v);
  return barras(linhas) + `<p class="rodape-graf">Total em 12 meses: <b>${moeda(tot)}</b>. Mês atual a partir de hoje; atrasos ficam no quadro "Em atraso".</p>`;
}

function graficoDias(pend) {
  const h = hoje(); const linhas = [];
  for (let k = 0; k <= 30; k++) {
    const d = addDias(h, k);
    const v = soma(pend.filter(p => p.vencimento === d), p => p.valor);
    if (v) linhas.push({ rot: `${diaSem(d)} ${dataCurta(d)}`, de: d, ate: d, v });
  }
  if (!linhas.length) return '<p class="dica">Nada a receber nos próximos 30 dias.</p>';
  return barras(linhas) + `<p class="rodape-graf">Total em 30 dias: <b>${moeda(soma(linhas, l => l.v))}</b>. Só aparecem os dias com recebimento.</p>`;
}

function listaParcelas(ps, opts = {}) {
  if (!ps.length) return '';
  const h = hoje();
  return `<div class="lista">${ps.map(p => {
    const a = S.ap.get(p.aporte_id); const c = S.cli.get(a?.cliente_id);
    const st = C.statusParcela(p, h); const n = (S.parcPorAp.get(p.aporte_id) || []).length;
    const sub = [opts.semCliente ? null : `Parcela ${p.num}/${n}`,
      p.recebido_em ? `recebida em ${dataBR(p.recebido_em)}` : `vence ${diaSem(p.vencimento)} ${dataBR(p.vencimento)}`].filter(Boolean).join(' · ');
    const acao = leitura() ? '' : p.recebido_em
      ? `<button class="btn peq sec" data-a="desfazer" data-id="${p.id}">Desfazer</button>`
      : `<button class="btn peq ok" data-a="receber" data-id="${p.id}">Receber</button>`;
    return `<div class="item st-${st}">
      <button class="item-pr" data-a="ap-ver" data-id="${p.aporte_id}">
        <span class="item-tit">${opts.semCliente ? `Parcela ${p.num}/${n}` : esc(c?.nome || '?')}</span>
        <span class="item-sub">${sub}</span>
      </button>
      <div class="item-val"><b>${moeda(p.recebido_em ? p.valor_recebido : p.valor)}</b><span class="tag ${st}">${ST_ROT[st]}</span></div>
      <div class="item-ac">${acao}</div>
    </div>`;
  }).join('')}</div>`;
}

// Agenda ------------------------------------------------------------------------
const PERIODOS = [['atraso', 'Em atraso'], ['hoje', 'Hoje'], ['p7', 'Próximos 7 dias'], ['p15', 'Próximos 15 dias'],
  ['p30', 'Próximos 30 dias'], ['p60', 'Próximos 60 dias'], ['p90', 'Próximos 90 dias'], ['p180', 'Próximos 6 meses'],
  ['p365', 'Próximos 12 meses'], ['mes', 'Este mês'], ['proxmes', 'Próximo mês'], ['mesant', 'Mês passado'],
  ['u30', 'Últimos 30 dias'], ['tudo', 'Tudo'], ['custom', 'Escolher datas']];

function intervalo(f) {
  const h = hoje();
  switch (f.periodo) {
    case 'hoje': return [h, h];
    case 'atraso': return ['0000-01-01', addDias(h, -1)];
    case 'mes': return [inicioMes(h), fimMes(h)];
    case 'proxmes': return [inicioMes(h, 1), fimMes(h, 1)];
    case 'mesant': return [inicioMes(h, -1), fimMes(h, -1)];
    case 'u30': return [addDias(h, -30), h];
    case 'tudo': return ['0000-01-01', '9999-12-31'];
    case 'custom': return [f.de || '0000-01-01', f.ate || '9999-12-31'];
    default: return [h, addDias(h, Number(f.periodo.slice(1)))];
  }
}

function filtrarAgenda(f) {
  const [de, ate] = intervalo(f);
  const sit = f.periodo === 'atraso' ? 'pendente' : f.situacao;
  return S.dados.parcelas.filter(p => {
    if (f.cliente && S.ap.get(p.aporte_id)?.cliente_id !== f.cliente) return false;
    if (sit === 'pendente' && p.recebido_em) return false;
    if (sit === 'recebida' && !p.recebido_em) return false;
    const d = sit === 'recebida' ? p.recebido_em : p.vencimento;
    return d >= de && d <= ate;
  }).sort((a, b) => {
    const da = f.situacao === 'recebida' ? a.recebido_em : a.vencimento;
    const db = f.situacao === 'recebida' ? b.recebido_em : b.vencimento;
    return da.localeCompare(db);
  });
}

function viewAgenda() {
  const f = S.f;
  const ps = filtrarAgenda(f);
  const chave = p => { const d = f.situacao === 'recebida' ? p.recebido_em : p.vencimento; return f.agrupar === 'mes' ? d.slice(0, 7) : d; };
  const grupos = new Map();
  for (const p of ps) { const k = chave(p); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(p); }
  const val = p => p.recebido_em ? p.valor_recebido : p.valor;
  const opt = (v, t, sel) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${esc(t)}</option>`;
  return `
  <h1 class="tit">Agenda de recebimentos</h1>
  <form class="filtros" data-f="agenda">
    <label>Período<select name="periodo">${PERIODOS.map(([v, t]) => opt(v, t, f.periodo)).join('')}</select></label>
    ${f.periodo === 'custom' ? `<label>De<input type="date" name="de" value="${f.de}"></label><label>Até<input type="date" name="ate" value="${f.ate}"></label>` : ''}
    <label>Cliente<select name="cliente">${opt('', 'Todos', f.cliente)}${S.dados.clientes.map(c => opt(c.id, c.nome, f.cliente)).join('')}</select></label>
    <label>Situação<select name="situacao">${opt('pendente', 'A receber', f.situacao)}${opt('recebida', 'Recebidas', f.situacao)}${opt('todas', 'Todas', f.situacao)}</select></label>
    <label>Agrupar<select name="agrupar">${opt('dia', 'Por dia', f.agrupar)}${opt('mes', 'Por mês', f.agrupar)}</select></label>
  </form>
  <div class="total-agenda">
    <div><span>${ps.length} parcela${ps.length === 1 ? '' : 's'}</span><b>${moeda(soma(ps, val))}</b></div>
    <button class="btn peq sec" data-a="csv-agenda">Baixar planilha</button>
  </div>
  ${ps.length ? [...grupos].map(([k, l]) => `
    <section class="grupo">
      <div class="grupo-cab"><span>${f.agrupar === 'mes' ? mesRot(k) : `${diaSem(k)}, ${dataBR(k)}${k === hoje() ? ' (hoje)' : ''}`}</span><b>${moeda(soma(l, val))}</b></div>
      ${listaParcelas(l)}
    </section>`).join('') : '<p class="vazio-p">Nenhuma parcela neste filtro.</p>'}`;
}

// Clientes ------------------------------------------------------------------------
function viewClientes() {
  const busca = norm(S.fCli);
  const cs = S.dados.clientes.filter(c => !busca || norm(`${c.nome} ${c.documento || ''} ${c.telefone || ''}`).includes(busca));
  return `
  <div class="tit-linha"><h1 class="tit">Clientes</h1>${leitura() ? '' : '<button class="btn pri" data-a="cli-novo">+ Cliente</button>'}</div>
  <input class="busca" type="search" placeholder="Buscar por nome, documento ou telefone" value="${esc(S.fCli)}" data-in="busca-cli">
  <div class="lista" id="lista-cli">${cs.map(c => {
    const r = resumoCliente(c);
    return `<button class="item" data-a="cli-ver" data-id="${c.id}">
      <span class="item-pr"><span class="item-tit">${esc(c.nome)}</span>
        <span class="item-sub">${r.ativos} crédito${r.ativos === 1 ? '' : 's'} ativo${r.ativos === 1 ? '' : 's'}${c.telefone ? ' · ' + esc(c.telefone) : ''}</span></span>
      <span class="item-val"><b>${moeda(r.aReceber)}</b>${r.atraso ? `<span class="tag atrasada">${moeda(r.atraso)} em atraso</span>` : '<span class="tag cinza">a receber</span>'}</span>
    </button>`;
  }).join('') || '<p class="vazio-p">Nenhum cliente.</p>'}</div>`;
}
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function whatsapp(tel) {
  let d = soDigitos(tel); if (!d) return '';
  if (d.length <= 11) d = '55' + d;
  return `https://wa.me/${d}`;
}

function verCliente(id) {
  const c = S.cli.get(id); if (!c) return;
  const r = resumoCliente(c);
  abrir(`
  <div class="dlg-cab"><h2>${esc(c.nome)}</h2><button class="x" data-a="fechar" aria-label="Fechar">×</button></div>
  <div class="dados">
    ${c.documento ? `<div><span>CPF/CNPJ</span>${esc(c.documento)}</div>` : ''}
    ${c.telefone ? `<div><span>Telefone</span><a class="link" href="tel:${soDigitos(c.telefone)}">${esc(c.telefone)}</a> · <a class="link" target="_blank" rel="noopener" href="${whatsapp(c.telefone)}">WhatsApp</a></div>` : ''}
    ${c.email ? `<div><span>E-mail</span><a class="link" href="mailto:${esc(c.email)}">${esc(c.email)}</a></div>` : ''}
    ${c.obs ? `<div><span>Observações</span>${esc(c.obs)}</div>` : ''}
  </div>
  <div class="mini-kpis">
    <div><span>Total em crédito</span><b>${moeda(r.investido)}</b></div>
    <div><span>A receber</span><b>${moeda(r.aReceber)}</b></div>
    <div><span>Capital em aberto</span><b>${moeda(r.capital)}</b></div>
    <div class="${r.atraso ? 'ruim' : ''}"><span>Em atraso</span><b>${moeda(r.atraso)}</b></div>
  </div>
  ${leitura() ? '' : `<div class="acoes">
    <button class="btn pri" data-a="ap-novo" data-cliente="${c.id}">+ Crédito</button>
    <button class="btn sec" data-a="cli-editar" data-id="${c.id}">Editar</button>
    <button class="btn perigo" data-a="cli-excluir" data-id="${c.id}">Excluir</button></div>`}
  <h3>Créditos</h3>
  ${listaAportes(r.aps) || '<p class="dica">Nenhum crédito.</p>'}`);
}

function formCliente(id) {
  const c = id ? S.cli.get(id) : {};
  abrir(`
  <div class="dlg-cab"><h2>${id ? 'Editar cliente' : 'Novo cliente'}</h2><button class="x" data-a="fechar" aria-label="Fechar">×</button></div>
  <form data-f="cliente" data-id="${id || ''}" class="form">
    <label>Nome ou empresa<input name="nome" required value="${esc(c.nome)}" autofocus></label>
    <label>CPF/CNPJ<input name="documento" value="${esc(c.documento)}" inputmode="numeric"></label>
    <label>Telefone / WhatsApp<input name="telefone" type="tel" value="${esc(c.telefone)}"></label>
    <label>E-mail<input name="email" type="email" value="${esc(c.email)}"></label>
    <label>Observações<textarea name="obs" rows="3">${esc(c.obs)}</textarea></label>
    <div class="acoes"><button class="btn pri">Gravar</button><button type="button" class="btn sec" data-a="fechar">Cancelar</button></div>
  </form>`);
}

// Aportes -------------------------------------------------------------------------
function listaAportes(aps) {
  if (!aps.length) return '';
  return `<div class="lista">${aps.map(a => {
    const r = resumoAporte(a); const c = S.cli.get(a.cliente_id);
    const st = r.quitado ? '<span class="tag recebida">Quitado</span>'
      : r.atrasadas.length ? `<span class="tag atrasada">${r.atrasadas.length} em atraso</span>`
      : r.proxima ? `<span class="tag cinza">próx. ${dataCurta(r.proxima.vencimento)}</span>` : '';
    return `<button class="item" data-a="ap-ver" data-id="${a.id}">
      <span class="item-pr"><span class="item-tit">${esc(c?.nome || '?')} · ${moeda(a.valor)}</span>
        <span class="item-sub">${dataBR(a.data_aporte)} · ${fmtTaxa(a)} · ${C.MODALIDADES_CURTAS[a.modalidade]} · ${r.pagas}/${r.ps.length} recebidas</span></span>
      <span class="item-val"><b>${moeda(r.aReceber)}</b>${st}</span>
    </button>`;
  }).join('')}</div>`;
}

function viewAportes() {
  const f = S.fAp; const b = norm(f.busca);
  const aps = S.dados.aportes.filter(a => {
    if (f.cliente && a.cliente_id !== f.cliente) return false;
    const r = resumoAporte(a);
    if (f.status === 'ativos' && r.quitado) return false;
    if (f.status === 'quitados' && !r.quitado) return false;
    if (f.status === 'atraso' && !r.atrasadas.length) return false;
    return !b || norm(S.cli.get(a.cliente_id)?.nome).includes(b);
  }).sort((x, y) => y.data_aporte.localeCompare(x.data_aporte));
  const opt = (v, t, sel) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${esc(t)}</option>`;
  const rs = aps.map(resumoAporte);
  return `
  <div class="tit-linha"><h1 class="tit">Créditos</h1>${leitura() ? '' : '<button class="btn pri" data-a="ap-novo">+ Crédito</button>'}</div>
  <form class="filtros" data-f="aportes">
    <label>Situação<select name="status">${opt('ativos', 'Em andamento', f.status)}${opt('atraso', 'Com atraso', f.status)}${opt('quitados', 'Quitados', f.status)}${opt('todos', 'Todos', f.status)}</select></label>
    <label>Cliente<select name="cliente">${opt('', 'Todos', f.cliente)}${S.dados.clientes.map(c => opt(c.id, c.nome, f.cliente)).join('')}</select></label>
  </form>
  <div class="mini-kpis">
    <div><span>Concedido</span><b>${moeda(soma(aps, a => a.valor))}</b></div>
    <div><span>Já recebido</span><b>${moeda(soma(rs, r => r.recebido))}</b></div>
    <div><span>A receber</span><b>${moeda(soma(rs, r => r.aReceber))}</b></div>
    <div><span>Lucro previsto</span><b>${moeda(soma(rs, r => r.lucro))}</b></div>
  </div>
  ${listaAportes(aps) || '<p class="vazio-p">Nenhum crédito neste filtro.</p>'}`;
}

function verAporte(id) {
  const a = S.ap.get(id); if (!a) return;
  const r = resumoAporte(a); const c = S.cli.get(a.cliente_id);
  const per = C.PERIODICIDADES[a.periodicidade]?.nome || '';
  abrir(`
  <div class="dlg-cab"><h2>Crédito de ${moeda(a.valor)}</h2><button class="x" data-a="fechar" aria-label="Fechar">×</button></div>
  <p><button class="link" data-a="cli-ver" data-id="${c?.id}">${esc(c?.nome || '?')}</button> · ${dataBR(a.data_aporte)}</p>
  <div class="dados">
    <div><span>Taxa</span>${fmtTaxa(a)}, juros ${a.regime}</div>
    <div><span>Forma de pagamento</span>${C.MODALIDADES[a.modalidade]}${a.modalidade === 'unico' ? '' : ` · ${per}, ${a.n_parcelas} parcelas`}</div>
    ${a.obs ? `<div><span>Observações</span>${esc(a.obs)}</div>` : ''}
  </div>
  <div class="mini-kpis">
    <div><span>Total previsto</span><b>${moeda(r.total)}</b></div>
    <div><span>Lucro previsto</span><b>${moeda(r.lucro)}</b></div>
    <div><span>Recebido</span><b>${moeda(r.recebido)}</b></div>
    <div><span>A receber</span><b>${moeda(r.aReceber)}</b></div>
  </div>
  ${leitura() ? '' : `<div class="acoes">
    <button class="btn sec" data-a="ap-editar" data-id="${a.id}">Editar</button>
    <button class="btn perigo" data-a="ap-excluir" data-id="${a.id}">Excluir</button></div>`}
  <h3>Parcelas (${r.pagas}/${r.ps.length} recebidas)</h3>
  ${listaParcelas(r.ps, { semCliente: true })}`, true);
}

function camposForm(form) {
  const g = n => form.elements[n]?.value ?? '';
  return {
    cliente_id: g('cliente_id'), valor: C.parseNum(g('valor')), data_aporte: g('data_aporte'),
    taxa: C.parseNum(g('taxa')) || 0, taxa_periodo: g('taxa_periodo'), regime: g('regime'),
    modalidade: g('modalidade'), periodicidade: g('periodicidade'),
    n_parcelas: Math.max(1, parseInt(g('n_parcelas'), 10) || 1), primeiro_venc: g('primeiro_venc'), obs: g('obs'),
  };
}

function formAporte(id, clientePre) {
  if (!S.dados.clientes.length) { toast('Cadastre um cliente primeiro.'); return formCliente(); }
  const a = id ? S.ap.get(id) : null;
  const ps = a ? (S.parcPorAp.get(id) || []).map(p => ({ ...p })) : [];
  const h = hoje();
  const base = a ? { ...a, primeiro_venc: ps[0]?.vencimento || h }
    : { cliente_id: clientePre || '', valor: '', data_aporte: h, taxa: '', taxa_periodo: 'mes', regime: 'compostos', modalidade: 'juros', periodicidade: 'mensal', n_parcelas: 12, primeiro_venc: C.vencimentoPadrao(h, 'mensal'), obs: '' };
  S.form = { id, parcelas: ps, vencManual: Boolean(a) };
  const opt = (v, t, sel) => `<option value="${v}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(t)}</option>`;
  abrir(`
  <div class="dlg-cab"><h2>${id ? 'Editar crédito' : 'Novo crédito'}</h2><button class="x" data-a="fechar" aria-label="Fechar">×</button></div>
  <form data-f="aporte" class="form" id="f-aporte">
    <label>Cliente<select name="cliente_id" required>${opt('', 'Escolha', base.cliente_id)}${S.dados.clientes.map(c => opt(c.id, c.nome, base.cliente_id)).join('')}</select></label>
    <div class="col2">
      <label>Valor do crédito (R$)<input name="valor" inputmode="decimal" required value="${base.valor ? C.num(Number(base.valor)) : ''}" placeholder="10.000,00" autofocus></label>
      <label>Data do crédito<input name="data_aporte" type="date" required value="${base.data_aporte}"></label>
    </div>
    <div class="col3">
      <label>Taxa (%)<input name="taxa" inputmode="decimal" value="${base.taxa !== '' ? C.num(Number(base.taxa), 2) : ''}" placeholder="2,00"></label>
      <label>Por<select name="taxa_periodo">${opt('mes', 'mês', base.taxa_periodo)}${opt('ano', 'ano', base.taxa_periodo)}</select></label>
      <label>Juros<select name="regime">${opt('compostos', 'compostos', base.regime)}${opt('simples', 'simples', base.regime)}</select></label>
    </div>
    <label>Como vai receber<select name="modalidade">${Object.entries(C.MODALIDADES).map(([k, t]) => opt(k, t, base.modalidade)).join('')}</select></label>
    <div class="col3" id="linha-parc">
      <label class="so-parc">Frequência<select name="periodicidade">${Object.entries(C.PERIODICIDADES).map(([k, p]) => opt(k, p.nome, base.periodicidade)).join('')}</select></label>
      <label class="so-parc">Nº de parcelas<input name="n_parcelas" type="number" min="1" max="600" value="${base.n_parcelas}"></label>
      <label><span id="rot-venc">1º vencimento</span><input name="primeiro_venc" type="date" required value="${base.primeiro_venc}"></label>
    </div>
    <label>Observações<textarea name="obs" rows="2">${esc(base.obs)}</textarea></label>
    <div id="previa"></div>
    <div class="acoes fixas"><button class="btn pri">Gravar crédito</button><button type="button" class="btn sec" data-a="fechar">Cancelar</button></div>
  </form>`, true);
  ajustarFormAporte(!id);
}

function ajustarFormAporte(regerar) {
  const form = $('#f-aporte'); if (!form) return;
  const c = camposForm(form);
  const unico = c.modalidade === 'unico';
  form.querySelectorAll('.so-parc').forEach(el => { el.hidden = unico; });
  $('#rot-venc').textContent = unico ? 'Vencimento' : '1º vencimento';
  if (regerar) {
    const antigas = new Map(S.form.parcelas.map(p => [p.num, p]));
    S.form.parcelas = C.gerarParcelas(c).map(p => {
      const o = antigas.get(p.num);
      return o?.recebido_em ? { ...p, recebido_em: o.recebido_em, valor_recebido: o.valor_recebido, obs: o.obs } : p;
    });
  }
  previaAporte(c);
}

function previaAporte(c) {
  const ps = S.form.parcelas;
  const tot = soma(ps, p => p.valor);
  const lucro = c.valor > 0 ? r2(tot - c.valor) : 0;
  const efetiva = c.valor > 0 && ps.length ? (Math.pow(1 + C.taxaMensal(c), 12) - 1) * 100 : 0;
  $('#previa').innerHTML = `
    <div class="previa-cab">
      <div><span>Total a receber</span><b>${moeda(tot)}</b></div>
      <div><span>Lucro</span><b>${moeda(lucro)}</b></div>
      <div><span>Taxa equivalente</span><b>${C.num(efetiva, 2)}% a.a.</b></div>
    </div>
    ${S.form.id ? '<button type="button" class="btn peq sec" data-a="recalcular">Recalcular parcelas com os dados acima</button>' : ''}
    <p class="dica">Pode ajustar a data e o valor de cada parcela antes de gravar.</p>
    <div class="parc-tab">${ps.map((p, i) => `
      <div class="parc-lin ${p.recebido_em ? 'paga' : ''}">
        <span class="parc-n">${p.num}</span>
        <input type="date" value="${p.vencimento}" data-in="parc" data-i="${i}" data-k="vencimento" aria-label="Vencimento da parcela ${p.num}">
        <input inputmode="decimal" value="${C.num(p.valor)}" data-in="parc" data-i="${i}" data-k="valor" aria-label="Valor da parcela ${p.num}">
        ${p.recebido_em ? '<span class="tag recebida">recebida</span>' : ''}
      </div>`).join('')}</div>`;
}

// Mais, assinatura e administração ------------------------------------------------------
function viewMais() {
  const p = S.perfil; const conta = p.conta;
  const d = conta ? C.diffDias(hoje(), conta.assinatura_ate) : 0;
  return `
  <h1 class="tit">Mais</h1>
  <section class="painel">
    <h2>Conta</h2>
    <div class="dados">
      <div><span>Conta</span>${esc(conta?.nome)}</div>
      <div><span>Você</span>${esc(p.email)} (${ehDono() ? 'dono' : 'membro'})</div>
      ${demo() ? '' : `<div><span>Assinatura</span>${d < 0 ? `vencida em ${dataBR(conta.assinatura_ate)}` : `em dia até ${dataBR(conta.assinatura_ate)}`}</div>`}
    </div>
    <div class="acoes">
      <button class="btn pri" data-a="nav" data-v="assinatura">Assinatura e pagamento</button>
      ${p.admin ? '<button class="btn sec" data-a="nav" data-v="admin">Painel do administrador</button>' : ''}
    </div>
  </section>
  <section class="painel" id="painel-pessoas"><h2>Pessoas com acesso</h2><p class="dica">Carregando…</p></section>
  <section class="painel">
    <h2>Exportar</h2>
    <p class="dica">Cópia dos seus dados para guardar ou abrir no Excel.</p>
    <div class="acoes">
      <button class="btn sec" data-a="csv-tudo">Planilha de parcelas</button>
      <button class="btn sec" data-a="json-tudo">Cópia completa (JSON)</button>
    </div>
  </section>
  <section class="painel">
    <h2>Usar como aplicativo no celular</h2>
    <p class="dica">Android (Chrome): menu ⋮ › Adicionar à tela inicial. iPhone (Safari): botão Compartilhar › Adicionar à Tela de Início.</p>
  </section>
  <button class="btn sec largo" data-a="sair">Sair</button>`;
}

async function carregarPessoas() {
  const el = $('#painel-pessoas'); if (!el) return;
  const ms = await S.store.membros();
  const url = location.origin + location.pathname;
  el.innerHTML = `<h2>Pessoas com acesso</h2>
    <div class="lista">${ms.map(m => `<div class="item">
      <span class="item-pr"><span class="item-tit">${esc(m.nome || m.email)}</span><span class="item-sub">${esc(m.email)} · ${m.papel}</span></span>
      ${ehDono() && m.papel !== 'dono' && !leitura() ? `<button class="btn peq perigo" data-a="membro-tirar" data-email="${esc(m.email)}">Tirar</button>` : ''}
    </div>`).join('')}</div>
    ${ehDono() && !leitura() ? `
    <form data-f="membro" class="form linha">
      <input name="email" type="email" placeholder="e-mail da pessoa" required>
      <input name="nome" placeholder="nome">
      <button class="btn pri">Incluir</button>
    </form>
    <p class="dica">A pessoa vê e edita os mesmos dados que você. Depois de incluí-la, mande o endereço <b>${esc(url)}</b> e peça para usar "Criar acesso" com esse e-mail.</p>` : ''}`;
}

const txidConta = id => ('APT' + String(id).slice(0, 13).replace(/-/g, '')).toUpperCase();

function viewAssinatura() {
  const p = S.perfil; const cfg = p.config || {}; const conta = p.conta;
  const meses = S.mesesPix || 1;
  const valor = r2(Number(cfg.preco_mensal || 0) * meses);
  const pronto = cfg.chave_pix && cfg.nome_recebedor && Number(cfg.preco_mensal) > 0;
  const codigo = pronto ? pixCopiaECola({ chave: cfg.chave_pix, nome: cfg.nome_recebedor, cidade: cfg.cidade, valor, txid: txidConta(conta.id) }) : '';
  const d = C.diffDias(hoje(), conta.assinatura_ate);
  return `
  <h1 class="tit">Assinatura</h1>
  <section class="painel">
    <div class="dados">
      <div><span>Situação</span>${d < 0 ? `<b class="txt-ruim">Vencida em ${dataBR(conta.assinatura_ate)}</b> (modo leitura)` : `Em dia até <b>${dataBR(conta.assinatura_ate)}</b>`}</div>
      <div><span>Preço</span>${moeda(Number(cfg.preco_mensal || 0))} por mês</div>
    </div>
  </section>
  <section class="painel">
    <h2>Pagar com Pix</h2>
    ${!pronto ? `<p class="dica">O recebimento por Pix ainda não foi configurado pelo administrador.${cfg.contato ? ' Contato: ' + esc(cfg.contato) : ''}</p>` : `
    <div class="seg largo">${[1, 3, 6, 12].map(m => `<button class="${m === meses ? 'on' : ''}" data-a="meses-pix" data-m="${m}">${m} ${m === 1 ? 'mês' : 'meses'}</button>`).join('')}</div>
    <p class="valor-pix">${moeda(valor)}</p>
    <div class="qr" id="qr"></div>
    <label>Pix copia e cola<textarea readonly rows="3" id="pix-codigo">${esc(codigo)}</textarea></label>
    <div class="acoes"><button class="btn sec" data-a="copiar-pix">Copiar código</button>
      ${demo() ? '' : `<button class="btn pri" data-a="ja-paguei">Já paguei</button>`}</div>
    <p class="dica">Depois de pagar, toque em "Já paguei". A liberação é feita assim que o pagamento for conferido${cfg.contato ? ` (dúvidas: ${esc(cfg.contato)})` : ''}. Os meses pagos somam a partir do vencimento atual.</p>`}
  </section>
  <section class="painel" id="painel-pag"><h2>Pagamentos</h2><p class="dica">Carregando…</p></section>`;
}

async function posAssinatura() {
  const cod = $('#pix-codigo')?.value;
  if (cod && $('#qr')) {
    try {
      if (!window.qrcode) await carregarScript('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js');
      const qr = window.qrcode(0, 'M'); qr.addData(cod); qr.make();
      $('#qr').innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
    } catch { $('#qr').innerHTML = '<p class="dica">Não foi possível desenhar o QR Code; use o código abaixo.</p>'; }
  }
  const el = $('#painel-pag'); if (!el) return;
  const ps = await S.store.pagamentos();
  const ROT = { informado: 'aguardando conferência', confirmado: 'confirmado', recusado: 'não localizado' };
  el.innerHTML = `<h2>Pagamentos</h2>${ps.length ? `<div class="lista">${ps.map(p => `<div class="item">
    <span class="item-pr"><span class="item-tit">${moeda(Number(p.valor))} · ${p.meses} ${p.meses == 1 ? 'mês' : 'meses'}</span>
    <span class="item-sub">${new Date(p.criado_em).toLocaleDateString('pt-BR')} · código ${esc(p.txid)}</span></span>
    <span class="tag ${p.status === 'confirmado' ? 'recebida' : p.status === 'recusado' ? 'atrasada' : 'hoje'}">${ROT[p.status]}</span></div>`).join('')}</div>`
    : '<p class="dica">Nenhum pagamento ainda.</p>'}`;
}

function carregarScript(src) {
  return new Promise((ok, falha) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = falha; document.head.appendChild(s); });
}

function viewAdmin() {
  const cfg = S.perfil.config || {};
  return `
  <h1 class="tit">Painel do administrador</h1>
  <p class="dica">Você vê as contas e os pagamentos. Os clientes e créditos de cada investidor não aparecem aqui.</p>
  <section class="painel" id="adm-resumo"><p class="dica">Carregando…</p></section>
  <section class="painel" id="adm-pag"></section>
  <section class="painel" id="adm-contas"></section>
  <section class="painel">
    <h2>Preço e Pix</h2>
    <form data-f="config" class="form">
      <div class="col2">
        <label>Preço mensal (R$)<input name="preco_mensal" inputmode="decimal" value="${C.num(Number(cfg.preco_mensal || 0))}" required></label>
        <label>Dias de teste<input name="dias_teste" type="number" min="0" max="90" value="${cfg.dias_teste ?? 15}"></label>
      </div>
      <label>Chave Pix<input name="chave_pix" value="${esc(cfg.chave_pix)}" placeholder="CPF, CNPJ, e-mail, telefone (+55...) ou chave aleatória"></label>
      <div class="col2">
        <label>Nome do recebedor<input name="nome_recebedor" maxlength="25" value="${esc(cfg.nome_recebedor)}"></label>
        <label>Cidade<input name="cidade" maxlength="15" value="${esc(cfg.cidade)}"></label>
      </div>
      <label>Contato para os assinantes<input name="contato" value="${esc(cfg.contato)}" placeholder="WhatsApp ou e-mail"></label>
      <button class="btn pri">Gravar</button>
    </form>
  </section>`;
}

async function posAdmin() {
  const [contas, pags] = await Promise.all([S.store.adminContas(), S.store.adminPagamentos()]);
  const nomes = new Map(contas.map(c => [c.id, c.nome]));
  const h = hoje();
  const pagantes = new Set(pags.filter(p => p.status === 'confirmado').map(p => p.conta_id));
  const ativas = contas.filter(c => c.assinatura_ate >= h);
  const ativasPagas = ativas.filter(c => pagantes.has(c.id));
  const preco = Number(S.perfil.config?.preco_mensal || 0);
  const ini = inicioMes(h);
  const recMes = soma(pags.filter(p => p.status === 'confirmado' && p.confirmado_em?.slice(0, 10) >= ini), p => p.valor);
  $('#adm-resumo').innerHTML = `<div class="mini-kpis">
    <div><span>Contas</span><b>${contas.length}</b></div>
    <div><span>Em dia</span><b>${ativas.length}</b></div>
    <div><span>Em teste (nunca pagaram)</span><b>${ativas.length - ativasPagas.length}</b></div>
    <div><span>Recebido no mês</span><b>${moeda(recMes)}</b></div>
    <div><span>Receita mensal das contas pagantes em dia</span><b>${moeda(ativasPagas.length * preco)}</b></div>
  </div>`;
  const aguardando = pags.filter(p => p.status === 'informado');
  $('#adm-pag').innerHTML = `<h2>Pagamentos a conferir (${aguardando.length})</h2>
    <p class="dica">Procure no extrato do banco o valor e o código de identificação. Confirmar soma os meses à assinatura.</p>
    ${aguardando.length ? `<div class="lista">${aguardando.map(p => `<div class="item">
      <span class="item-pr"><span class="item-tit">${esc(nomes.get(p.conta_id) || '?')} · ${moeda(Number(p.valor))}</span>
      <span class="item-sub">${p.meses} ${p.meses == 1 ? 'mês' : 'meses'} · código ${esc(p.txid)} · ${esc(p.informado_por)} · ${new Date(p.criado_em).toLocaleString('pt-BR')}</span></span>
      <span class="item-ac"><button class="btn peq ok" data-a="pag-ok" data-id="${p.id}">Confirmar</button>
      <button class="btn peq perigo" data-a="pag-nao" data-id="${p.id}">Não localizei</button></span></div>`).join('')}</div>` : '<p class="dica">Nada aguardando.</p>'}`;
  $('#adm-contas').innerHTML = `<h2>Contas</h2><div class="lista">${contas.map(c => {
    const d = C.diffDias(h, c.assinatura_ate);
    const tag = d < 0 ? `<span class="tag atrasada">vencida ${dataCurta(c.assinatura_ate)}</span>` : d <= 5 ? `<span class="tag hoje">vence ${dataCurta(c.assinatura_ate)}</span>` : `<span class="tag recebida">até ${dataBR(c.assinatura_ate)}</span>`;
    return `<div class="item">
      <span class="item-pr"><span class="item-tit">${esc(c.nome)}${pagantes.has(c.id) ? '' : ' <small>(teste)</small>'}</span>
      <span class="item-sub">${esc(c.dono || '')} · ${c.membros} pessoa${c.membros == 1 ? '' : 's'} · desde ${new Date(c.criado_em).toLocaleDateString('pt-BR')}</span></span>
      <span class="item-val">${tag}</span>
      <span class="item-ac"><button class="btn peq sec" data-a="conta-validade" data-id="${c.id}" data-ate="${c.assinatura_ate}" data-nome="${esc(c.nome)}">Validade</button></span></div>`;
  }).join('') || '<p class="dica">Nenhuma conta.</p>'}</div>`;
}

function renderAdminSolto() {
  document.body.className = 'dentro';
  $('#app').innerHTML = `<header class="topo"><div class="topo-nome">${MARCA_ICONE}<b>Administração</b></div>
    <button class="btn peq sec" data-a="nav" data-v="inicio">Voltar</button></header>
    <main class="conteudo">${viewAdmin()}</main>`;
  posAdmin().catch(e => toast(e.message, 'erro'));
}

const VIEWS = { inicio: viewInicio, agenda: viewAgenda, clientes: viewClientes, aportes: viewAportes, mais: viewMais, assinatura: viewAssinatura, admin: viewAdmin };
const POS = { mais: carregarPessoas, assinatura: posAssinatura, admin: posAdmin };

function irPara(v) {
  S.view = v; history.replaceState(null, '', '#' + v);
  render();
  const pos = POS[v]; if (pos && S.perfil?.membro) pos().catch(e => toast(e.message, 'erro'));
}

// Exportação ------------------------------------------------------------------------
function baixar(nome, conteudo, tipo) {
  const blob = new Blob([conteudo], { type: tipo });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function csvParcelas(ps, nome) {
  const cel = v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const n = v => (v == null || v === '' ? '' : C.num(Number(v)));
  const linhas = [['Cliente', 'Data do crédito', 'Valor do crédito', 'Taxa', 'Parcela', 'Vencimento', 'Valor', 'Juros', 'Amortização', 'Situação', 'Recebido em', 'Valor recebido']];
  for (const p of ps) {
    const a = S.ap.get(p.aporte_id); const c = S.cli.get(a?.cliente_id);
    linhas.push([c?.nome, dataBR(a?.data_aporte), n(a?.valor), a ? fmtTaxa(a) : '', `${p.num}/${(S.parcPorAp.get(p.aporte_id) || []).length}`,
      dataBR(p.vencimento), n(p.valor), n(p.juros), n(p.amortizacao), ST_ROT[C.statusParcela(p)], dataBR(p.recebido_em), n(p.valor_recebido)]);
  }
  baixar(nome, '﻿' + linhas.map(l => l.map(cel).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
}

// Ações (cliques) -------------------------------------------------------------------
const ACOES = {
  nav: d => { fechar(); irPara(d.v); },
  fechar: () => fechar(),
  acesso: d => telaAcesso(d.m),
  sair: async () => { await S.store.sair(); if (!demo()) location.hash = ''; },
  'sair-demo': async (d, el, ev) => { ev.preventDefault(); localStorage.removeItem('aportes_demo_v1'); location.href = location.pathname; },
  graf: d => { S.grafico = d.m; render(); },
  'agenda-ir': d => {
    S.f = { ...S.f, periodo: d.periodo, de: d.de || '', ate: d.ate || '', situacao: d.situacao || 'pendente', cliente: '' };
    irPara('agenda');
  },
  receber: d => {
    const p = S.dados.parcelas.find(x => x.id === d.id); if (!p) return;
    const c = clienteDe(p);
    abrir(`<div class="dlg-cab"><h2>Registrar recebimento</h2><button class="x" data-a="fechar" aria-label="Fechar">×</button></div>
      <p>${esc(c?.nome)} · parcela ${p.num} · vencimento ${dataBR(p.vencimento)}</p>
      <form data-f="receber" data-id="${p.id}" class="form">
        <div class="col2">
          <label>Recebido em<input name="data" type="date" required value="${hoje()}"></label>
          <label>Valor recebido (R$)<input name="valor" inputmode="decimal" required value="${C.num(p.valor)}"></label>
        </div>
        <label>Observação<input name="obs" placeholder="opcional"></label>
        <div class="acoes"><button class="btn ok" autofocus>Confirmar recebimento</button><button type="button" class="btn sec" data-a="fechar">Cancelar</button></div>
      </form>`);
  },
  desfazer: async d => {
    if (!confirm('Desfazer o recebimento desta parcela?')) return;
    await tentar(() => S.store.desfazer(d.id), 'Recebimento desfeito');
    const aberto = dlg().open; await recarregar(); if (aberto) reabrirDetalhe(d.id);
  },
  'cli-novo': () => formCliente(),
  'cli-ver': d => verCliente(d.id),
  'cli-editar': d => formCliente(d.id),
  'cli-excluir': async d => {
    const c = S.cli.get(d.id);
    if (!confirm(`Excluir o cliente ${c?.nome}?`)) return;
    await tentar(() => S.store.excluirCliente(d.id), 'Cliente excluído');
    fechar(); await recarregar();
  },
  'ap-novo': d => formAporte(null, d.cliente),
  'ap-ver': d => verAporte(d.id),
  'ap-editar': d => formAporte(d.id),
  'ap-excluir': async d => {
    if (!confirm('Excluir este crédito e todas as parcelas dele?')) return;
    await tentar(() => S.store.excluirAporte(d.id), 'Crédito excluído');
    fechar(); await recarregar();
  },
  recalcular: () => {
    if (S.form.parcelas.some(p => p.recebido_em) && !confirm('As parcelas serão recalculadas. Os recebimentos já registrados ficam nas parcelas de mesmo número. Continuar?')) return;
    ajustarFormAporte(true);
  },
  'csv-agenda': () => csvParcelas(filtrarAgenda(S.f), `agenda_${hoje()}.csv`),
  'csv-tudo': () => csvParcelas(S.dados.parcelas.slice().sort((a, b) => a.vencimento.localeCompare(b.vencimento)), `parcelas_${hoje()}.csv`),
  'json-tudo': () => baixar(`credflux_${hoje()}.json`, JSON.stringify({ exportado_em: new Date().toISOString(), conta: S.perfil.conta?.nome, ...S.dados }, null, 2), 'application/json'),
  'membro-tirar': async d => {
    if (!confirm(`Tirar o acesso de ${d.email}?`)) return;
    await tentar(() => S.store.tirarMembro(d.email), 'Acesso retirado'); carregarPessoas();
  },
  'meses-pix': d => { S.mesesPix = Number(d.m); irPara('assinatura'); },
  'copiar-pix': async () => {
    const t = $('#pix-codigo'); if (!t) return;
    try { await navigator.clipboard.writeText(t.value); } catch { t.select(); document.execCommand('copy'); }
    toast('Código Pix copiado', 'ok');
  },
  'ja-paguei': async () => {
    await tentar(() => S.store.informarPagamento(S.mesesPix || 1), 'Pagamento informado. Aguarde a conferência.');
    posAssinatura();
  },
  'pag-ok': async d => { await tentar(() => S.store.confirmarPagamento(d.id, true), 'Pagamento confirmado'); posAdmin(); },
  'pag-nao': async d => {
    if (!confirm('Marcar como não localizado? O investidor poderá informar de novo.')) return;
    await tentar(() => S.store.confirmarPagamento(d.id, false), 'Marcado como não localizado'); posAdmin();
  },
  'conta-validade': d => abrir(`<div class="dlg-cab"><h2>Validade da assinatura</h2><button class="x" data-a="fechar" aria-label="Fechar">×</button></div>
    <p>${esc(d.nome)}</p>
    <form data-f="validade" data-id="${d.id}" class="form">
      <label>Em dia até<input name="ate" type="date" required value="${d.ate}"></label>
      <div class="acoes"><button class="btn pri">Gravar</button><button type="button" class="btn sec" data-a="fechar">Cancelar</button></div>
    </form>`),
};

function reabrirDetalhe(parcelaId) {
  const p = S.dados.parcelas.find(x => x.id === parcelaId);
  if (p) verAporte(p.aporte_id); else fechar();
}

// Formulários --------------------------------------------------------------------
const FORMS = {
  async acesso(fd, form) {
    const email = fd.get('email').trim(); const senha = fd.get('senha');
    const m = form.dataset.m;
    if (m === 'entrar') await tentar(() => S.store.entrar(email, senha));
    else if (m === 'criar') {
      const r = await tentar(() => S.store.criarAcesso(email, senha));
      if (r.precisaConfirmar) telaAcesso('entrar', `Enviamos um link de confirmação para ${email}. Abra o e-mail, confirme e depois entre aqui.`);
    } else {
      await tentar(() => S.store.esqueci(email));
      telaAcesso('entrar', `Se ${email} tiver acesso, chegará um link para criar uma nova senha.`);
    }
  },
  async 'nova-senha'(fd) {
    await tentar(() => S.store.novaSenha(fd.get('senha')), 'Senha alterada');
    S.recuperando = false;
    history.replaceState(null, '', location.pathname); await iniciarSessao();
  },
  async 'criar-conta'(fd) {
    await tentar(() => S.store.criarConta(fd.get('nome').trim(), fd.get('seu').trim()), 'Conta criada');
    await iniciarSessao();
  },
  agenda(fd) {
    S.f = { ...S.f, ...Object.fromEntries(fd) };
    render();
  },
  aportes(fd) { S.fAp = { ...S.fAp, ...Object.fromEntries(fd) }; render(); },
  async cliente(fd, form) {
    const c = Object.fromEntries([...fd].map(([k, v]) => [k, String(v).trim()]));
    if (form.dataset.id) c.id = form.dataset.id;
    const salvo = await tentar(() => S.store.salvarCliente(c), 'Cliente gravado');
    await recarregar();
    verCliente(salvo.id);
  },
  async aporte(fd, form) {
    const c = camposForm(form);
    if (!(c.valor > 0)) return toast('Informe o valor do crédito.', 'erro');
    if (!c.cliente_id) return toast('Escolha o cliente.', 'erro');
    const ps = S.form.parcelas;
    if (!ps.length) return toast('Nenhuma parcela gerada. Confira valor e vencimento.', 'erro');
    if (ps.some(p => !p.vencimento || !(p.valor >= 0))) return toast('Confira as datas e os valores das parcelas.', 'erro');
    const aporte = { ...c, id: S.form.id || '', n_parcelas: c.modalidade === 'unico' ? 1 : ps.length };
    delete aporte.primeiro_venc;
    const parcelas = ps.map((p, i) => ({
      num: i + 1, vencimento: p.vencimento, valor: r2(p.valor), amortizacao: r2(p.amortizacao), juros: r2(p.valor - p.amortizacao),
      recebido_em: p.recebido_em || null, valor_recebido: p.recebido_em ? p.valor_recebido : null, obs: p.obs || null,
    }));
    const id = await tentar(() => S.store.salvarAporte(aporte, parcelas), 'Crédito gravado');
    await recarregar();
    verAporte(id);
  },
  async receber(fd, form) {
    const v = C.parseNum(fd.get('valor'));
    if (!(v >= 0)) return toast('Valor inválido.', 'erro');
    await tentar(() => S.store.receber(form.dataset.id, fd.get('data'), r2(v), fd.get('obs')), 'Recebimento registrado');
    const id = form.dataset.id; fechar(); await recarregar();
    if (S.view !== 'inicio' && S.view !== 'agenda') reabrirDetalhe(id);
  },
  async membro(fd) {
    await tentar(() => S.store.incluirMembro(S.perfil.membro.conta_id, fd.get('email'), fd.get('nome').trim()), 'Pessoa incluída');
    carregarPessoas();
  },
  async config(fd) {
    const cfg = Object.fromEntries([...fd].map(([k, v]) => [k, String(v).trim()]));
    cfg.preco_mensal = C.parseNum(cfg.preco_mensal); cfg.dias_teste = parseInt(cfg.dias_teste, 10) || 0;
    if (!(cfg.preco_mensal > 0)) return toast('Preço inválido.', 'erro');
    await tentar(() => S.store.salvarConfig(cfg), 'Configuração gravada');
    S.perfil.config = { ...S.perfil.config, ...cfg };
  },
  async validade(fd, form) {
    await tentar(() => S.store.ajustarAssinatura(form.dataset.id, fd.get('ate')), 'Validade alterada');
    fechar(); posAdmin();
  },
};

// Eventos ------------------------------------------------------------------------
document.addEventListener('click', e => {
  if (e.target === dlg()) return fechar();
  const el = e.target.closest('[data-a]'); if (!el) return;
  const fn = ACOES[el.dataset.a]; if (!fn) return;
  if (el.tagName === 'A' && el.dataset.a !== 'sair-demo') e.preventDefault();
  Promise.resolve(fn(el.dataset, el, e)).catch(() => {});
});

document.addEventListener('submit', e => {
  const form = e.target.closest('form[data-f]'); if (!form) return;
  e.preventDefault();
  const btn = form.querySelector('button:not([type=button])');
  if (btn) btn.disabled = true;
  Promise.resolve(FORMS[form.dataset.f](new FormData(form), form)).catch(() => {}).finally(() => { if (btn?.isConnected) btn.disabled = false; });
});

document.addEventListener('change', e => {
  const form = e.target.closest('form[data-f="agenda"], form[data-f="aportes"]');
  if (form) return FORMS[form.dataset.f](new FormData(form), form);
  if (e.target.closest('#f-aporte') && !e.target.dataset.in) campoAporteMudou(e.target);
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.in === 'busca-cli') {
    S.fCli = t.value;
    const pos = t.selectionStart; render();
    const n = $('[data-in="busca-cli"]'); n.focus(); n.setSelectionRange(pos, pos);
    return;
  }
  if (t.dataset.in === 'parc') {
    const p = S.form.parcelas[+t.dataset.i];
    if (t.dataset.k === 'valor') { const v = C.parseNum(t.value); if (v >= 0) p.valor = r2(v); }
    else p.vencimento = t.value;
    const tot = soma(S.form.parcelas, x => x.valor); const c = camposForm($('#f-aporte'));
    const cab = $('#previa .previa-cab');
    if (cab) { cab.children[0].querySelector('b').textContent = moeda(tot); cab.children[1].querySelector('b').textContent = moeda(c.valor > 0 ? r2(tot - c.valor) : 0); }
    return;
  }
  if (t.closest('#f-aporte') && ['valor', 'taxa', 'n_parcelas'].includes(t.name)) campoAporteMudou(t);
});

function campoAporteMudou(t) {
  const form = $('#f-aporte');
  if (t.name === 'primeiro_venc') S.form.vencManual = true;
  if (!S.form.vencManual && ['data_aporte', 'periodicidade', 'modalidade'].includes(t.name)) {
    const c = camposForm(form);
    form.elements.primeiro_venc.value = c.modalidade === 'unico'
      ? C.addMeses(c.data_aporte, 6) : C.vencimentoPadrao(c.data_aporte, c.periodicidade);
  }
  if (t.name === 'cliente_id' || t.name === 'obs') return;
  ajustarFormAporte(!S.form.id);
}

window.addEventListener('hashchange', () => {
  const v = location.hash.slice(1);
  if (VIEWS[v] && v !== S.view && S.perfil?.membro) irPara(v);
});

// Início ---------------------------------------------------------------------------
async function iniciarSessao() {
  const user = await S.store.usuario();
  if (!user) return telaAcesso();
  S.user = user;
  S.perfil = await S.store.perfil(user);
  if (S.perfil.membro) { S.dados = await S.store.carregar(); indexar(); }
  const v = location.hash.slice(1);
  S.view = VIEWS[v] ? v : 'inicio';
  if (!S.perfil.membro && S.view !== 'admin') S.view = 'inicio';
  irPara(S.view);
}

async function iniciar() {
  const ehDemo = new URLSearchParams(location.search).has('demo');
  if (!configurado && !ehDemo) return telaSemConfig();
  try {
    S.store = await abrirStore(ehDemo);
  } catch (e) {
    $('#app').innerHTML = '<main class="acesso"><div class="cartao"><h2>Sem conexão</h2><p>Não foi possível carregar o sistema. Confira a internet e recarregue a página.</p></div></main>';
    return;
  }
  S.publica = await S.store.configPublica().catch(() => ({}));
  const recuperacao = /type=recovery/.test(location.hash);
  S.store.aoMudarAcesso((ev, user) => {
    if (ev === 'PASSWORD_RECOVERY') { S.recuperando = true; return telaNovaSenha(); }
    if (ev === 'SIGNED_IN' && !S.user && !S.recuperando && user) { S.user = user; setTimeout(() => iniciarSessao().catch(e => toast(e.message, 'erro'))); }
    if (ev === 'SIGNED_OUT') { S.user = null; S.perfil = null; telaAcesso(); }
  });
  if (recuperacao || S.recuperando) { S.recuperando = true; return telaNovaSenha(); }
  await iniciarSessao().catch(e => { toast(e.message, 'erro'); telaAcesso(); });
}

iniciar();
