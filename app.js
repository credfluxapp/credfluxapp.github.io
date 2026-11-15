import { abrirStore, configurado, CHAVE_DEMO } from './store.js';
import { gerarAcordoPDF, gerarReciboPDF, prepararPDF, valorPorExtenso, TERMOS_PADRAO } from './acordo.js';
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
const fmtTaxa = a => a.modalidade === 'fixa' ? `${C.num(Number(a.taxa), 2)}% em ${C.prazoDias(a)} dias` : `${C.num(Number(a.taxa), 2)}% a.${a.taxa_periodo === 'ano' ? 'a.' : 'm.'}`;
const tamanho = b => b >= 1048576 ? `${C.num(b / 1048576, 1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
const dataExtenso = s => { const d = parseISO(s); return `${d.getDate()} de ${MESL[d.getMonth()]} de ${d.getFullYear()}`; };
const soDigitos = s => String(s || '').replace(/\D/g, '');
const DSEML = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '');
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
// Valor curto para o gráfico: 4,2k; 1,5M; "-" quando não há nada.
const abrev = v => (!v ? '-' : v >= 1e6 ? `${C.num(v / 1e6, 1)}M` : v >= 1000 ? `${C.num(v / 1000, 1)}k` : C.num(v, 0));

// Tema: automático (segue o sistema), claro ou escuro. O index.html já marca data-tema antes da primeira pintura.
const CHAVE_TEMA = 'credflux_tema';
const temaPref = () => { try { return localStorage.getItem(CHAVE_TEMA) || 'auto'; } catch { return 'auto'; } };
const temaSistema = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
function aplicarTema(pref = temaPref()) {
  const escuro = pref === 'escuro' || (pref === 'auto' && Boolean(temaSistema?.matches));
  document.documentElement.dataset.tema = escuro ? 'escuro' : 'claro';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', escuro ? '#15171C' : '#FFFFFF');
}
function escolherTema(pref) {
  try { localStorage.setItem(CHAVE_TEMA, pref); } catch { /* sem armazenamento: vale só nesta visita */ }
  aplicarTema(pref);
  document.querySelectorAll('[data-a="tema"]').forEach(b => b.classList.toggle('on', b.dataset.t === pref));
}
temaSistema?.addEventListener?.('change', () => aplicarTema());
aplicarTema();

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
  ajustes: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  ajuda: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  grafico: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  documento: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  imagem: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  enviar: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  baixar: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  alerta: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  entrada: '<circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="m8 12 4 4 4-4"/>',
  lua: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  recibo: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
  desfazer: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  celular: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  dinheiro: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  escudo: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
};
const icone = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
// Marca do CredFlux: um "C" que termina em seta (o crédito que volta), num quadrado verde.
const MARCA_ICONE = '<span class="marca-ic" aria-hidden="true"><svg viewBox="0 0 512 512"><g fill="none" stroke="currentColor" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"><path d="M352 160A136 136 0 1 0 256 392H400"/><path d="M356 348l44 44-44 44"/></g></svg></span>';
const MARCA = `<span class="logo">${MARCA_ICONE}<b>CredFlux</b></span>`;

// Avatar do cliente: iniciais e uma cor fixa, tirada do id (oito cores no styles.css).
const LIGACOES = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);
function iniciais(nome) {
  const ps = String(nome || '').trim().split(/\s+/).filter(w => w && !LIGACOES.has(w.toLowerCase()));
  if (!ps.length) return '?';
  const a = ps[0][0];
  const b = ps.slice(1).map(w => w[0]).find(x => x.toLowerCase() !== a.toLowerCase()) || ps[1]?.[0] || ps[0][1] || '';
  return (a + b).toUpperCase();
}
const corDe = id => { let s = 0; for (const ch of String(id || '')) s = (s * 31 + ch.charCodeAt(0)) >>> 0; return `av${(s % 8) + 1}`; };
const avatar = c => `<span class="av ${corDe(c?.id)}" aria-hidden="true">${esc(iniciais(c?.nome))}</span>`;
const pill = (cor, t) => `<span class="pill${cor ? ' ' + cor : ''}">${t}</span>`;
const checkBtn = (p, vermelho, rotulo) => `<button class="ck${vermelho ? ' ruim' : ''}" data-a="receber" data-id="${p.id}" title="Registrar recebimento" aria-label="Receber ${rotulo}"><img src="img/check-${vermelho ? 'branco' : 'verde'}.svg" width="16" height="16" alt=""></button>`;

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
    p.mora = Number(p.mora || 0);
    if (!S.parcPorAp.has(p.aporte_id)) S.parcPorAp.set(p.aporte_id, []);
    S.parcPorAp.get(p.aporte_id).push(p);
  }
  for (const l of S.parcPorAp.values()) l.sort((a, b) => a.num - b.num);
  for (const a of S.dados.aportes) { a.valor = Number(a.valor); a.taxa = Number(a.taxa); if (a.prazo_dias != null) a.prazo_dias = Number(a.prazo_dias); }
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
    dias: C.diasAtraso(ps, h),
    mora: C.moraAte(a, ps, h),
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
    mora: soma(rs, r => r.mora),
  };
}

const ST_ROT = { recebida: 'Recebida', atrasada: 'Em atraso', hoje: 'Vence hoje', pendente: 'A receber' };
// Pílula de cada situação na tela (a planilha continua com ST_ROT).
const ST_PILL = { recebida: ['verde', 'Pago'], atrasada: ['vermelha', 'Em atraso'], hoje: ['', 'Vence hoje'], pendente: ['', 'A receber'] };

// Telas de acesso: painel escuro da marca à esquerda (no celular, em cima) e o formulário ao lado.
function molduraFora(lado, recursos = '') {
  const pub = S.publica || {};
  document.body.className = 'fora';
  $('#app').innerHTML = `
  <div class="ac${recursos ? '' : ' so-marca'}">
    <section class="ac-marca">
      ${MARCA}
      <p class="ac-rot">Gestão de crédito para quem empresta dinheiro</p>
      <h1>Clientes, créditos e parcelas em um só lugar</h1>
      <p class="ac-desc">Cadastre cada crédito com o valor, a taxa e a forma de pagamento. O CredFlux gera as parcelas, mostra o que vence e o que está em atraso e calcula quanto você vai receber por dia e por mês.</p>
      <p class="ac-selo">${icone('escudo')}<span>Todos os dados são protegidos por criptografia, com segurança, discrição e total sigilo.</span></p>
    </section>
    <main class="ac-lado">${lado}</main>
    ${recursos ? `<section class="ac-rec">
      <ul class="ac-lista">${recursos}</ul>
      <footer class="ac-pe"><span>CredFlux</span>${pub.contato ? `<span>Contato: ${esc(pub.contato)}</span>` : ''}</footer>
    </section>` : ''}
  </div>`;
}

// Confirmação do cadastro dentro do CredFlux: o código chega por e-mail (credfluxapp@gmail.com) e é digitado aqui.
function telaConfirmar(aviso = '') {
  const email = S.emailConfirmar || '';
  molduraFora(`
    <div class="ac-topo"><a href="?demo" class="btn sec peq">Ver demonstração</a></div>
    <div class="ac-caixa">
      <div class="cartao">
        <h2>Confirme seu e-mail</h2>
        ${aviso ? `<p class="aviso">${esc(aviso)}</p>` : ''}
        <p class="dica">${email ? `Enviamos um código de confirmação para <b>${esc(email)}</b>.` : 'Digite o e-mail cadastrado e o código de confirmação que chegou nele.'}
          O e-mail vem do CredFlux (credfluxapp@gmail.com); se não aparecer, confira o spam.</p>
        <form data-f="confirmar">
          <label>E-mail<input name="email" type="email" autocomplete="email" required value="${esc(email)}"></label>
          <label>Código de confirmação<input name="codigo" class="codigo" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" maxlength="10" required autofocus placeholder="000000"></label>
          <button class="btn pri largo">Confirmar e entrar</button>
        </form>
        <div class="ac-links">
          <button type="button" class="link" data-a="reenviar-codigo">Reenviar código</button>
          <button type="button" class="link" data-a="acesso" data-m="criar">Usar outro e-mail</button>
        </div>
        <p class="dica">Se este e-mail já tiver acesso, use <button type="button" class="link" data-a="acesso" data-m="entrar">Entrar</button> ou <button type="button" class="link" data-a="acesso" data-m="esqueci">Esqueci a senha</button>.</p>
      </div>
    </div>`, RECURSOS_ACESSO());
}

const RECURSOS_ACESSO = () => [
  ['agenda', 'Agenda e previsão de recebimentos', 'O que vence hoje, nos próximos dias e o que está em atraso, e quanto vai entrar em cada dia e em cada mês.'],
  ['aportes', 'Crédito com a sua regra', 'Pagamento único, só juros, parcelas iguais (Price), SAC ou parcelas definidas por você. Juros simples ou compostos.'],
  ['recibo', 'Recibos e acordos em PDF', 'Emita recibos e documentos de acordo em 1 clique.'],
  ['celular', 'Feito para o celular', 'Instale como aplicativo na tela inicial, use no tema claro ou escuro e divida o acesso com a sua equipe.'],
].map(([i, t, d]) => `<li><span class="ac-ic">${icone(i)}</span><div><b>${t}</b><span>${d}</span></div></li>`).join('');

function telaAcesso(modo = 'entrar', aviso = '') {
  if (modo === 'confirmar') return telaConfirmar(aviso);
  const pub = S.publica || {};
  const preco = pub.preco_mensal ? moeda(Number(pub.preco_mensal)) : '';
  const abas = [['entrar', 'Entrar'], ['criar', 'Criar acesso'], ['esqueci', 'Esqueci a senha']]
    .map(([m, t]) => `<button type="button" class="aba ${m === modo ? 'on' : ''}" data-a="acesso" data-m="${m}">${t}</button>`).join('');
  const botao = { entrar: 'Entrar', criar: 'Criar acesso', esqueci: 'Enviar link para nova senha' }[modo];
  const recursos = RECURSOS_ACESSO();
  molduraFora(`
    <div class="ac-topo"><a href="?demo" class="btn sec peq">Ver demonstração</a></div>
    <div class="ac-caixa">
      <div class="cartao">
        <h2>Acesse sua conta</h2>
        <div class="abas">${abas}</div>
        ${aviso ? `<p class="aviso">${esc(aviso)}</p>` : ''}
        <form data-f="acesso" data-m="${modo}">
          <label>E-mail<input name="email" type="email" autocomplete="email" required autofocus></label>
          ${modo !== 'esqueci' ? `<label>Senha<input name="senha" type="password" minlength="6" autocomplete="${modo === 'criar' ? 'new-password' : 'current-password'}" required></label>` : ''}
          ${modo === 'criar' ? '<p class="dica">Use o e-mail que vai acessar o sistema. Você vai receber nele um código de confirmação do CredFlux. Se alguém incluiu você numa conta, use o mesmo e-mail que essa pessoa cadastrou.</p>' : ''}
          <button class="btn pri largo">${botao}</button>
        </form>
        ${modo !== 'esqueci' ? '<p class="dica centro">Já recebeu o código? <button type="button" class="link" data-a="acesso" data-m="confirmar">Confirmar e-mail</button></p>' : ''}
      </div>
      ${preco ? `<div class="preco"><div><b>${preco}</b><span>por mês, pago por Pix</span></div>${pub.dias_teste ? pill('verde', `${pub.dias_teste} dias de teste sem custo`) : ''}</div>` : ''}
      <p class="centro dica">Quer ver antes? <a href="?demo" class="link">Abrir a demonstração com dados de exemplo</a></p>
    </div>`, recursos);
}

function telaNovaSenha() {
  molduraFora(`<div class="ac-caixa"><div class="cartao">
    <h2>Nova senha</h2>
    <form data-f="nova-senha">
      <label>Nova senha<input name="senha" type="password" minlength="6" autocomplete="new-password" required autofocus></label>
      <button class="btn pri largo">Gravar senha</button>
    </form>
  </div></div>`);
}

function telaCriarConta() {
  const pub = S.perfil.config || {};
  molduraFora(`<div class="ac-caixa"><div class="cartao">
    <h2>Criar sua conta</h2>
    <p>Você entrou como <b>${esc(S.perfil.email)}</b>. Crie a conta onde ficam seus clientes e créditos.
    ${pub.dias_teste ? `Os primeiros ${pub.dias_teste} dias são de teste, sem custo.` : ''}</p>
    <form data-f="criar-conta">
      <label>Nome da conta<input name="nome" required autofocus placeholder="Ex.: Créditos João Silva"></label>
      <label>Seu nome<input name="seu" autocomplete="name"></label>
      <button class="btn pri largo">Criar conta</button>
    </form>
    <p class="dica">Foi convidado para a conta de outra pessoa? Peça que ela inclua o e-mail ${esc(S.perfil.email)} em Configurações › Pessoas com acesso e entre de novo.</p>
    ${S.perfil.admin ? '<button class="btn largo" data-a="nav" data-v="admin">Painel do administrador</button>' : ''}
    <button class="btn sec largo" data-a="sair">Sair</button>
  </div></div>`);
}

function telaSemConfig() {
  molduraFora(`<div class="ac-caixa"><div class="cartao">
    <h2>Sistema ainda não configurado</h2>
    <p>Preencha <code>config.js</code> com o endereço e a chave pública do Supabase (veja LEIAME.md).</p>
    <a class="btn pri largo" href="?demo">Ver demonstração</a>
  </div></div>`);
}

// Estrutura principal: barra lateral escura (no celular, menu fixo embaixo) e o conteúdo.
const NAV = [['inicio', 'Início', 'inicio'], ['agenda', 'Agenda', 'agenda'], ['clientes', 'Clientes', 'clientes'], ['aportes', 'Créditos', 'aportes']];

function itemNav(v, ic, rotulo, extra = '') {
  const on = S.view === v || (v === 'mais' && ['assinatura', 'admin'].includes(S.view));
  return `<button class="nav-it${on ? ' on' : ''}" data-a="nav" data-v="${v}"${on ? ' aria-current="page"' : ''}>${icone(ic)}${rotulo}${extra}</button>`;
}

function render() {
  if (!S.perfil?.membro) { if (S.view === 'admin' && S.perfil?.admin) return renderAdminSolto(); return telaCriarConta(); }
  document.body.className = 'dentro';
  const h = hoje();
  const atrasos = pendentes().filter(p => p.vencimento < h).length;
  const cont = atrasos ? `<span class="nav-cont">${atrasos}<span class="sr"> em atraso</span></span>` : '';
  $('#app').innerHTML = `
  <div class="moldura">
    <aside class="lateral"><div class="lateral-in">
      <div class="lateral-marca">${MARCA_ICONE}<b>CredFlux</b></div>
      <nav class="nav" aria-label="Menu">
        <div class="nav-grupo"><p class="nav-rot">Menu</p>
          ${NAV.map(([v, t, ic]) => itemNav(v, ic, `<span class="nav-t">${t}</span>`, v === 'agenda' ? cont : '')).join('')}
        </div>
        <div class="nav-grupo"><p class="nav-rot">Conta</p>
          ${itemNav('mais', 'ajustes', '<span class="nav-t so-largo">Configurações</span><span class="nav-t so-movel">Ajustes</span>')}
          <button class="nav-it nav-ajuda" data-a="ajuda">${icone('ajuda')}<span class="nav-t">Ajuda</span></button>
          <button class="nav-it nav-tema" data-a="tema-alternar"><span class="so-claro">${icone('lua')}<span class="nav-t">Modo escuro</span></span><span class="so-escuro">${icone('sol')}<span class="nav-t">Modo claro</span></span></button>
          <button class="nav-it nav-sair" data-a="sair" title="${demo() ? 'Sair da demonstração' : 'Sair da conta'}">${icone('sair')}<span class="nav-t">Sair</span></button>
        </div>
      </nav>
      ${demo() ? '<div class="lateral-aviso"><p>Você está no modo demonstração. Os dados ficam só neste navegador.</p><a href="./" data-a="sair-demo">Criar conta de verdade →</a></div>' : ''}
    </div></aside>
    <main class="conteudo">${avisos()}${VIEWS[S.view]()}</main>
  </div>`;
  window.scrollTo(0, 0);
}

function avisos() {
  const out = [];
  if (demo()) out.push('<div class="banner demo so-movel"><span>Modo demonstração: os dados ficam só neste navegador.</span><a href="./" data-a="sair-demo" class="link">Criar conta de verdade →</a></div>');
  else if (leitura()) out.push(`<div class="banner ruim">A assinatura venceu em ${dataBR(S.perfil.conta.assinatura_ate)}. Seus dados estão guardados e visíveis, mas só voltam a ser editáveis após o pagamento. <button class="btn peq sec" data-a="nav" data-v="assinatura">Pagar com Pix</button></div>`);
  else if (S.perfil.conta) {
    const d = C.diffDias(hoje(), S.perfil.conta.assinatura_ate);
    if (d <= 5) out.push(`<div class="banner alerta">A assinatura vence em ${dataBR(S.perfil.conta.assinatura_ate)}. <button class="btn peq sec" data-a="nav" data-v="assinatura">Renovar com Pix</button></div>`);
  }
  return out.join('');
}

// Início --------------------------------------------------------------------------
function viewInicio() {
  const h = hoje(); const pend = pendentes();
  const entre = (a, b) => pend.filter(p => p.vencimento >= a && p.vencimento <= b);
  const atraso = pend.filter(p => p.vencimento < h).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  const moraTot = soma(S.dados.aportes, a => C.moraAte(a, S.parcPorAp.get(a.id) || [], h));
  const ini = inicioMes(h), fim = fimMes(h);
  const recMes = S.dados.parcelas.filter(p => p.recebido_em && p.recebido_em >= ini && p.recebido_em <= fim);
  const doMes = S.dados.parcelas.filter(p => p.vencimento >= ini && p.vencimento <= fim);
  const pagasMes = doMes.filter(p => p.recebido_em);
  const previsto = soma(doMes, p => p.valor);
  const pctMes = previsto ? Math.round(soma(pagasMes, p => p.valor_recebido) / previsto * 100) : 0;
  // Carteira em aberto: créditos com alguma parcela a receber. A barra é o recebido sobre (recebido + a receber).
  const aReceber = soma(pend, p => p.valor);
  const abertos = new Set(pend.map(p => p.aporte_id));
  const recebido = soma(S.dados.parcelas.filter(p => p.recebido_em && abertos.has(p.aporte_id)), p => p.valor_recebido);
  const pct = recebido + aReceber > 0 ? Math.round(recebido / (recebido + aReceber) * 100) : 0;
  // Cobrar: com um cliente só, abre o WhatsApp dele; com mais de um (ou sem telefone), abre a Agenda nos atrasos.
  const cliAtraso = [...new Set(atraso.map(p => S.ap.get(p.aporte_id)?.cliente_id))];
  const c1 = cliAtraso.length === 1 ? S.cli.get(cliAtraso[0]) : null;
  const wa = whatsapp(c1?.telefone);
  const cobrar = !atraso.length ? ''
    : wa ? `<a class="lnk ruim" href="${wa}" target="_blank" rel="noopener">Cobrar →</a>`
    : `<button class="lnk ruim" data-a="agenda-ir" data-periodo="atraso" data-cliente="${c1?.id || ''}">Cobrar →</button>`;
  const dias = atraso.length ? C.diffDias(atraso[0].vencimento, h) : 0;
  const hora = new Date().getHours();
  const nome = demo() ? '' : String(S.perfil.membro?.nome || '').trim().split(/\s+/)[0];
  const janela = (t, ps, per) => `
    <button class="janela" data-a="agenda-ir" data-periodo="${per}">
      <span class="jn-txt"><span class="jn-t">${t}</span><span class="jn-v">${moeda(soma(ps, p => p.valor))}</span></span>
      ${pill('', plural(ps.length, 'parcela', 'parcelas'))}
    </button>`;
  const prox = listaAgrupada(pend.slice().sort((a, b) => a.vencimento.localeCompare(b.vencimento)), { limite: 6, ate: fimMes(h, 1) });
  return `
  <header class="pag-cab">
    <div>
      <h1 class="tit">${hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'}${nome ? `, ${esc(nome)}` : ''}</h1>
      <p class="pag-sub">${cap(DSEML[parseISO(h).getDay()])}, ${dataExtenso(h)}${S.perfil.conta?.nome ? ` · ${esc(S.perfil.conta.nome)}` : ''}</p>
    </div>
    ${leitura() ? '' : `<div class="pag-acoes">
      <button class="btn sec" data-a="rec-lista">Registrar recebimento</button>
      <button class="btn pri" data-a="ap-novo">+ Novo crédito</button>
    </div>`}
  </header>
  ${S.dados.aportes.length ? '' : `<div class="vazio"><h2>Comece cadastrando um cliente e um crédito</h2><p>Depois de cadastrar, aqui aparece quanto você vai receber em cada dia e em cada mês.</p>
    ${leitura() ? '' : '<button class="btn pri" data-a="cli-novo">Cadastrar cliente</button>'}</div>`}
  <section class="destaques">
    <button class="destaque escuro" data-a="nav" data-v="aportes">
      <span class="dq-cab"><span class="dq-ic">${icone('aportes')}</span><span class="dq-tv">
        <span class="dq-t">Capital emprestado em aberto</span>
        <span class="dq-v">${moeda(soma(pend, p => p.amortizacao))}</span></span></span>
      <span class="dq-s">Total a receber com juros: ${moeda(aReceber)}</span>
      <span class="progresso" role="img" aria-label="${pct}% recebido"><span style="width:${pct}%"></span></span>
      <span class="dq-pe"><span>Recebido ${moeda(recebido)}</span><span>${pct}% do total</span></span>
    </button>
    <div class="destaque${atraso.length ? ' perigo' : ''}">
      <span class="dq-cab"><span class="dq-ic">${icone('alerta')}</span><span class="dq-tv">
        <span class="dq-t">Em atraso</span>
        <span class="dq-v">${moeda(soma(atraso, p => p.valor))}</span></span></span>
      <span class="dq-s">${atraso.length ? `${plural(atraso.length, 'parcela', 'parcelas')} · ${c1 ? esc(c1.nome) : plural(cliAtraso.length, 'cliente', 'clientes')}${moraTot ? ` · multa ${moeda(moraTot)}` : ''}` : 'Nenhuma parcela em atraso'}</span>
      <span class="dq-pe">${atraso.length ? pill('vermelha', `${plural(dias, 'dia', 'dias')} de atraso`) + cobrar : pill('', 'Tudo em dia')}</span>
    </div>
    <div class="destaque recebido">
      <span class="dq-cab"><span class="dq-ic">${icone('entrada')}</span><span class="dq-tv">
        <span class="dq-t">Recebido em ${MESL[parseISO(h).getMonth()]}</span>
        <span class="dq-v">${moeda(soma(recMes, p => p.valor_recebido))}</span></span></span>
      <span class="dq-s">${doMes.length ? `${pagasMes.length} de ${plural(doMes.length, 'parcela', 'parcelas')} do mês` : 'Nenhuma parcela vence neste mês'}</span>
      <span class="dq-pe">${doMes.length ? pill('verde', `${pctMes}% do previsto`) : '<span></span>'}<button class="lnk" data-a="agenda-ir" data-periodo="mes" data-situacao="recebida">Ver extrato →</button></span>
    </div>
  </section>
  <section class="janelas">
    ${janela('Hoje', entre(h, h), 'hoje')}
    ${janela('Próximos 7 dias', entre(h, addDias(h, 7)), 'p7')}
    ${janela('Próximos 30 dias', entre(h, addDias(h, 30)), 'p30')}
  </section>
  <section class="paineis">
    <div class="painel">
      <div class="painel-cab"><h2>Previsão de recebimentos</h2>
        <div class="seg" role="group" aria-label="Período do gráfico">
          <button class="${S.grafico === 'meses' ? 'on' : ''}" data-a="graf" data-m="meses">12 meses</button>
          <button class="${S.grafico === 'dias' ? 'on' : ''}" data-a="graf" data-m="dias">30 dias</button>
        </div>
      </div>
      ${S.grafico === 'meses' ? graficoMeses(pend) : graficoDias(pend)}
    </div>
    <div class="painel">
      <div class="painel-cab"><h2>Próximos recebimentos</h2><button class="lnk" data-a="nav" data-v="agenda">Ver agenda →</button></div>
      ${prox || `<p class="dica">Nada a receber até o fim de ${MESL[parseISO(fimMes(h, 1)).getMonth()]}.</p>`}
    </div>
  </section>`;
}

// Gráfico de colunas: mês (ou dia) atual em escuro, os dois maiores em verde e o resto em verde claro.
function grafico(linhas, rotTotal) {
  const max = Math.max(1, ...linhas.map(l => l.v));
  const ord = linhas.filter(l => l.v > 0).sort((a, b) => b.v - a.v);
  const picos = ord.slice(0, 2).filter(l => l.v > (ord[2]?.v || 0));
  const nomes = picos.slice().sort((a, b) => a.de.localeCompare(b.de)).map(l => l.nome);
  const cls = linhas.length > 20 ? ' muitas' : linhas.length > 12 ? ' varias' : '';
  return `<div class="graf${cls}">${linhas.map(l => `
    <button class="graf-col${l.atual ? ' atual' : picos.includes(l) ? ' pico' : ''}" data-a="agenda-ir" data-periodo="custom" data-de="${l.de}" data-ate="${l.ate}" title="${l.nome}: ${moeda(l.v)}" aria-label="${l.nome}: ${moeda(l.v)}">
      <span class="graf-v">${abrev(l.v)}</span>
      <span class="graf-b" style="--h:${(l.v / max).toFixed(3)}"></span>
      <span class="graf-m">${l.rot}</span>
    </button>`).join('')}</div>
  <div class="graf-pe"><span>${rotTotal}: <b>${moeda(soma(linhas, l => l.v))}</b></span>${nomes.length ? `<span>${nomes.length > 1 ? 'Picos' : 'Pico'} em ${nomes.join(' e ')}</span>` : ''}</div>`;
}

function graficoMeses(pend) {
  const h = hoje(); const linhas = [];
  for (let k = 0; k < 12; k++) {
    const de = inicioMes(h, k), ate = fimMes(h, k);
    const ini = k === 0 ? h : de; // mês atual a partir de hoje; os atrasos ficam no quadro "Em atraso"
    linhas.push({ rot: MES[parseISO(de).getMonth()], nome: mesCurto(de), de: ini, ate, atual: k === 0,
      v: soma(pend.filter(p => p.vencimento >= ini && p.vencimento <= ate), p => p.valor) });
  }
  return grafico(linhas, 'Total em 12 meses');
}

function graficoDias(pend) {
  const h = hoje(); const linhas = [];
  for (let k = 0; k <= 30; k++) {
    const d = addDias(h, k);
    const v = soma(pend.filter(p => p.vencimento === d), p => p.valor);
    if (v) linhas.push({ rot: `${d.slice(8, 10)}<span class="graf-mm">/${d.slice(5, 7)}</span>`, nome: `${diaSem(d)} ${dataCurta(d)}`, de: d, ate: d, atual: k === 0, v });
  }
  if (!linhas.length) return '<p class="dica">Nada a receber nos próximos 30 dias.</p>';
  return grafico(linhas, 'Total em 30 dias');
}

// Linha de parcela: avatar, cliente e parcela, valor, situação e o botão de receber.
// curto: sem pílula e sem os dias de atraso (Próximos recebimentos); semCliente: dentro do crédito.
function linhaParcela(p, o = {}) {
  const h = hoje(); const c = clienteDe(p);
  const st = C.statusParcela(p, h); const n = (S.parcPorAp.get(p.aporte_id) || []).length;
  const data = o.semCliente ? dataBR : dataCurta;
  const dias = st === 'atrasada' ? C.diffDias(p.vencimento, h) : 0;
  const quando = p.recebido_em ? `recebida em ${data(p.recebido_em)}${p.mora ? ` (multa ${moeda(p.mora)})` : ''}`
    : st === 'atrasada' ? `venceu ${data(p.vencimento)}${o.curto ? '' : ` · ${plural(dias, 'dia', 'dias')} de atraso`}`
    : st === 'hoje' ? 'vence hoje'
    : `${o.semCliente ? 'vence ' : ''}${diaSem(p.vencimento)} ${data(p.vencimento)}`;
  const parc = `Parcela ${p.num}/${n}`;
  if (p.recebido_em) preparoPDF();
  const acao = p.recebido_em
    ? `<button class="btn peq sec ic-movel" data-a="recibo" data-id="${p.id}" title="Recibo em PDF" aria-label="Recibo em PDF da parcela ${p.num}/${n}">${icone('recibo')}<span class="so-largo">Recibo</span></button>`
      + (leitura() ? '' : `<button class="btn peq sec ic-movel" data-a="desfazer" data-id="${p.id}" title="Desfazer recebimento" aria-label="Desfazer recebimento da parcela ${p.num}/${n}">${icone('desfazer')}<span class="so-largo">Desfazer</span></button>`)
    : leitura() ? '' : checkBtn(p, st === 'atrasada', `parcela ${p.num}/${n}${o.semCliente ? '' : ` de ${esc(c?.nome || '')}`}`);
  const [cor, rot] = ST_PILL[st];
  return `<div class="item st-${st}">
    ${o.semCliente ? `<span class="av av-num" aria-hidden="true">${p.num}</span>` : avatar(c)}
    <button class="item-pr" data-a="ap-ver" data-id="${p.aporte_id}">
      <span class="item-tit">${o.semCliente ? parc : esc(c?.nome || '?')}</span>
      <span class="item-sub">${o.semCliente ? quando : `${parc} · ${quando}`}</span>
    </button>
    <div class="item-val"><b>${moeda(p.recebido_em ? p.valor_recebido : p.valor)}</b>${o.curto ? '' : pill(cor, rot)}</div>
    <div class="item-ac">${acao}</div>
  </div>`;
}

function listaParcelas(ps, o = {}) {
  return ps.length ? `<div class="lista">${ps.map(p => linhaParcela(p, o)).join('')}</div>` : '';
}

// Parcelas em aberto, já em ordem de vencimento, agrupadas em Atrasado, Esta semana (até o sábado),
// Ainda em {mês}, {mês seguinte} e, depois dele, um grupo por mês.
function listaAgrupada(ps, { limite = Infinity, ate = '9999-12-31' } = {}) {
  const h = hoje(); const d = parseISO(h);
  const fimSemana = addDias(h, 6 - d.getDay()), fimM = fimMes(h), prox = inicioMes(h, 1).slice(0, 7);
  const grupo = v => v < h ? ['atraso', 'Atrasado']
    : v <= fimSemana ? ['semana', 'Esta semana']
    : v <= fimM ? ['mes', `Ainda em ${MESL[d.getMonth()]}`]
    : v.slice(0, 7) === prox ? [prox, cap(MESL[+prox.slice(5, 7) - 1])]
    : [v.slice(0, 7), cap(mesRot(v.slice(0, 7)))];
  let html = '', atual = '', n = 0;
  for (const p of ps) {
    if (p.vencimento > ate || n >= limite) break;
    const [k, t] = grupo(p.vencimento);
    if (k !== atual) { html += `<p class="gl-rot${k === 'atraso' ? ' ruim' : ''}">${t}</p>`; atual = k; }
    html += linhaParcela(p, { curto: true }); n++;
  }
  return html ? `<div class="lista-g">${html}</div>` : '';
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
  <div class="tit-linha"><h1 class="tit">Agenda de recebimentos</h1></div>
  <form class="filtros" data-f="agenda">
    <label>Período<select name="periodo">${PERIODOS.map(([v, t]) => opt(v, t, f.periodo)).join('')}</select></label>
    ${f.periodo === 'custom' ? `<label>De<input type="date" name="de" value="${f.de}"></label><label>Até<input type="date" name="ate" value="${f.ate}"></label>` : ''}
    <label>Cliente<select name="cliente">${opt('', 'Todos', f.cliente)}${S.dados.clientes.map(c => opt(c.id, c.nome, f.cliente)).join('')}</select></label>
    <label>Situação<select name="situacao">${opt('pendente', 'A receber', f.situacao)}${opt('recebida', 'Recebidas', f.situacao)}${opt('todas', 'Todas', f.situacao)}</select></label>
    <label>Agrupar<select name="agrupar">${opt('dia', 'Por dia', f.agrupar)}${opt('mes', 'Por mês', f.agrupar)}</select></label>
  </form>
  <div class="total-agenda">
    <div><span>${plural(ps.length, 'parcela', 'parcelas')}</span><b>${moeda(soma(ps, val))}</b></div>
    <button class="btn peq sec" data-a="csv-agenda">${icone('baixar')}Baixar planilha</button>
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
  <input class="busca" type="search" placeholder="Buscar por nome, documento ou telefone" value="${esc(S.fCli)}" data-in="busca-cli" aria-label="Buscar cliente">
  <div class="lista" id="lista-cli">${cs.map(c => {
    const r = resumoCliente(c);
    const st = r.atraso ? pill('vermelha', `${moeda(r.atraso)} em atraso`)
      : r.aReceber ? pill('', 'A receber') : r.aps.length ? pill('verde', 'Quitado') : pill('', 'Sem crédito');
    return `<button class="item" data-a="cli-ver" data-id="${c.id}">
      ${avatar(c)}
      <span class="item-pr"><span class="item-tit">${esc(c.nome)}</span>
        <span class="item-sub">${plural(r.ativos, 'crédito ativo', 'créditos ativos')}${c.telefone ? ' · ' + esc(c.telefone) : ''}</span></span>
      <span class="item-val"><b>${moeda(r.aReceber)}</b>${st}</span>
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
  <div class="dlg-cab"><h2 class="com-av">${avatar(c)}<span>${esc(c.nome)}</span></h2><button class="x" data-a="fechar" aria-label="Fechar">×</button></div>
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
    <div class="${r.atraso ? 'ruim' : ''}"><span>Em atraso${r.mora ? ` (+ multa ${moeda(r.mora)})` : ''}</span><b>${moeda(r.atraso)}</b></div>
  </div>
  ${leitura() ? '' : `<div class="acoes">
    <button class="btn pri" data-a="ap-novo" data-cliente="${c.id}">+ Crédito</button>
    <button class="btn sec" data-a="cli-editar" data-id="${c.id}">Editar</button>
    <button class="btn perigo" data-a="cli-excluir" data-id="${c.id}">Excluir</button></div>`}
  <h3>Créditos</h3>
  ${listaAportes(r.aps) || '<p class="dica">Nenhum crédito.</p>'}
  <div class="sec-cab"><h3>Documentos</h3>
    ${leitura() ? '' : `<label class="btn peq sec arquivo">${icone('enviar')}Enviar arquivo<input type="file" data-in="doc-arquivo" data-cliente="${c.id}" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif" multiple></label>`}</div>
  <div id="docs-cli" data-cliente="${c.id}"><p class="dica">Carregando…</p></div>
  <p class="dica">Contratos, recibos e documentos digitalizados. PDF ou foto, até ${demo() ? '2' : '10'} MB cada.</p>`);
  carregarDocs(c.id);
}

async function carregarDocs(clienteId) {
  const el = $('#docs-cli'); if (!el) return;
  let docs;
  try { docs = await S.store.documentos(clienteId); }
  catch (e) { el.innerHTML = `<div class="vazio-p erro">${esc(e.message)} <button class="btn peq sec" data-a="docs-tentar" data-cliente="${clienteId}">Tentar de novo</button></div>`; return; }
  if ($('#docs-cli')?.dataset.cliente !== clienteId) return;
  S.docs = new Map(docs.map(d => [d.id, d]));
  el.innerHTML = docs.length ? `<div class="lista">${docs.map(d => `<div class="item">
      <span class="av av-ic" aria-hidden="true">${icone(/^image\//.test(d.tipo) ? 'imagem' : 'documento')}</span>
      <span class="item-pr"><span class="item-tit">${esc(d.nome)}</span><span class="item-sub">${tamanho(Number(d.tamanho) || 0)} · ${new Date(d.criado_em).toLocaleDateString('pt-BR')}</span></span>
      <span class="item-ac"><button class="btn peq sec" data-a="doc-abrir" data-id="${d.id}">Abrir</button>
        ${leitura() ? '' : `<button class="btn peq perigo" data-a="doc-excluir" data-id="${d.id}">Excluir</button>`}</span>
    </div>`).join('')}</div>` : '<p class="vazio-p">Nenhum documento deste cliente.</p>';
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
    const st = r.quitado ? pill('verde', 'Quitado')
      : r.atrasadas.length ? pill('vermelha', `${r.atrasadas.length} em atraso`)
      : r.proxima ? pill('', `próx. ${dataCurta(r.proxima.vencimento)}`) : '';
    return `<button class="item" data-a="ap-ver" data-id="${a.id}">
      ${avatar(c)}
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
    <div><span>Taxa</span>${a.modalidade === 'fixa' ? `${fmtTaxa(a)} (juros de ${moeda(r2(a.valor * a.taxa / 100))})` : `${fmtTaxa(a)}, juros ${a.regime}`}</div>
    <div><span>Forma de pagamento</span>${C.MODALIDADES_CURTAS[a.modalidade]}${a.modalidade === 'unico' ? '' : a.modalidade === 'fixa' ? ` · ${r.ps.length} parcelas em ${C.prazoDias(a)} dias` : ` · ${per}, ${a.n_parcelas} parcelas`}</div>
    ${a.obs ? `<div><span>Observações</span>${esc(a.obs)}</div>` : ''}
  </div>
  <div class="mini-kpis">
    <div><span>Total previsto</span><b>${moeda(r.total)}</b></div>
    <div><span>Lucro previsto</span><b>${moeda(r.lucro)}</b></div>
    <div><span>Recebido</span><b>${moeda(r.recebido)}</b></div>
    <div><span>A receber</span><b>${moeda(r.aReceber)}</b></div>
  </div>
  ${r.dias ? `<div class="banner ruim">${icone('alerta')}<span>${r.dias} dia${r.dias === 1 ? '' : 's'} de atraso desde ${dataBR(r.atrasadas[0].vencimento)}. Multa até hoje: <b>${moeda(r.mora)}</b> (${moeda(r2(C.moraDiaria(a, r.ps)))} por dia).</span></div>` : ''}
  <div class="acoes">
    <button class="btn sec" data-a="acordo" data-id="${a.id}">${icone('documento')}Acordo em PDF</button>
    ${leitura() ? '' : `<button class="btn sec" data-a="ap-editar" data-id="${a.id}">Editar</button>
    <button class="btn perigo" data-a="ap-excluir" data-id="${a.id}">Excluir</button>`}</div>
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
    prazo_dias: g('modalidade') === 'fixa' ? Math.max(1, parseInt(g('prazo_dias'), 10) || 30) : null,
  };
}

function formAporte(id, clientePre) {
  if (!S.dados.clientes.length) { toast('Cadastre um cliente primeiro.'); return formCliente(); }
  const a = id ? S.ap.get(id) : null;
  const ps = a ? (S.parcPorAp.get(id) || []).map(p => ({ ...p })) : [];
  const h = hoje();
  const base = a ? { ...a, primeiro_venc: ps[0]?.vencimento || h }
    : { cliente_id: clientePre || '', valor: '', data_aporte: h, taxa: '', taxa_periodo: 'mes', regime: 'compostos', modalidade: 'juros', periodicidade: 'mensal', n_parcelas: 12, prazo_dias: 30, primeiro_venc: C.vencimentoPadrao(h, 'mensal'), obs: '' };
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
    <label>Como vai receber<select name="modalidade">${Object.entries(C.MODALIDADES).map(([k, t]) => opt(k, t, base.modalidade)).join('')}</select></label>
    <div class="col3">
      <label><span id="rot-taxa">Taxa (%)</span><input name="taxa" inputmode="decimal" value="${base.taxa !== '' ? C.num(Number(base.taxa), 2) : ''}" placeholder="2,00"></label>
      <label class="nao-fixa">Por<select name="taxa_periodo">${opt('mes', 'mês', base.taxa_periodo)}${opt('ano', 'ano', base.taxa_periodo)}</select></label>
      <label class="nao-fixa">Juros<select name="regime">${opt('compostos', 'compostos', base.regime)}${opt('simples', 'simples', base.regime)}</select></label>
      <label class="so-fixa">Prazo (dias)<input name="prazo_dias" type="number" min="1" max="3650" value="${base.prazo_dias || 30}"></label>
    </div>
    <div class="col3" id="linha-parc">
      <label class="so-parc nao-fixa">Frequência<select name="periodicidade">${Object.entries(C.PERIODICIDADES).map(([k, p]) => opt(k, p.nome, base.periodicidade)).join('')}</select></label>
      <label class="so-parc">Nº de parcelas<input name="n_parcelas" type="number" min="1" max="600" value="${base.n_parcelas}"></label>
      <label class="nao-fixa"><span id="rot-venc">1º vencimento</span><input name="primeiro_venc" type="date" required value="${base.primeiro_venc}"></label>
    </div>
    <p class="dica so-fixa" id="dica-fixa"></p>
    <label>Observações<textarea name="obs" rows="2">${esc(base.obs)}</textarea></label>
    <div id="previa"></div>
    <div class="acoes fixas"><button class="btn pri">Gravar crédito</button><button type="button" class="btn sec" data-a="fechar">Cancelar</button></div>
  </form>`, true);
  ajustarFormAporte(!id);
}

function ajustarFormAporte(regerar) {
  const form = $('#f-aporte'); if (!form) return;
  const c = camposForm(form);
  const unico = c.modalidade === 'unico', fixa = c.modalidade === 'fixa';
  form.querySelectorAll('.so-parc').forEach(el => { el.hidden = unico; });
  form.querySelectorAll('.nao-fixa').forEach(el => { if (fixa) el.hidden = true; else if (!el.classList.contains('so-parc') || !unico) el.hidden = false; });
  form.querySelectorAll('.so-fixa').forEach(el => { el.hidden = !fixa; });
  form.elements.primeiro_venc.required = !fixa;
  $('#rot-venc').textContent = unico ? 'Vencimento' : '1º vencimento';
  $('#rot-taxa').textContent = fixa ? 'Juros no prazo (%)' : 'Taxa (%)';
  if (fixa && c.valor > 0) $('#dica-fixa').textContent = `${moeda(c.valor)} + ${C.num(c.taxa, 2)}% = ${moeda(r2(c.valor * (1 + c.taxa / 100)))} em ${c.prazo_dias} dias, dividido em ${c.n_parcelas} parcela${c.n_parcelas === 1 ? '' : 's'} espalhadas no prazo. Em atraso, multa de ${moeda(r2(c.valor * c.taxa / 100 / 30))} por dia.`;
  else if (fixa) $('#dica-fixa').textContent = 'Exemplo: R$ 1.000 a 10% em 30 dias = R$ 1.100, em 11 parcelas de R$ 100 ou 20 de R$ 55.';
  if (regerar) {
    const antigas = new Map(S.form.parcelas.map(p => [p.num, p]));
    S.form.parcelas = C.gerarParcelas(c).map(p => {
      const o = antigas.get(p.num);
      return o?.recebido_em ? { ...p, recebido_em: o.recebido_em, valor_recebido: o.valor_recebido, mora: o.mora || 0, obs: o.obs } : p;
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
        ${p.recebido_em ? pill('verde', 'Pago') : ''}
      </div>`).join('')}</div>`;
}

// Mais, assinatura e administração ------------------------------------------------------
function viewMais() {
  const p = S.perfil; const conta = p.conta;
  const d = conta ? C.diffDias(hoje(), conta.assinatura_ate) : 0;
  return `
  <div class="tit-linha"><h1 class="tit">Configurações</h1><span class="tit-acoes so-movel">
    <button class="btn sec peq" data-a="ajuda">${icone('ajuda')}Ajuda</button>
    <button class="btn perigo peq" data-a="sair">${icone('sair')}Sair</button></span></div>
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
  <section class="painel">
    <h2>Aparência</h2>
    <p class="dica">Automático segue o tema do celular ou do computador.</p>
    <div class="seg" role="group" aria-label="Tema">${[['auto', 'Automático'], ['claro', 'Claro'], ['escuro', 'Escuro']]
      .map(([t, r]) => `<button class="${temaPref() === t ? 'on' : ''}" data-a="tema" data-t="${t}">${r}</button>`).join('')}</div>
  </section>
  <section class="painel" id="painel-pessoas"><h2>Pessoas com acesso</h2><p class="dica">Carregando…</p></section>
  ${painelAcordo()}
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

function painelAcordo() {
  const c = S.perfil.conta || {}; const pode = ehDono() && !leitura();
  const dis = pode ? '' : 'disabled';
  return `<section class="painel">
    <h2>Dados do acordo em PDF</h2>
    <p class="dica">Entram no acordo de pagamento gerado em cada crédito.${pode ? '' : ' Só o dono da conta altera.'}</p>
    <form data-f="acordo" class="form">
      <div class="col2">
        <label>Nome do credor<input name="credor_nome" value="${esc(c.credor_nome)}" placeholder="${esc(c.nome || '')}" ${dis}></label>
        <label>CPF/CNPJ do credor<input name="credor_doc" value="${esc(c.credor_doc)}" inputmode="numeric" ${dis}></label>
      </div>
      <div class="col2">
        <label>Endereço<input name="credor_endereco" value="${esc(c.credor_endereco)}" ${dis}></label>
        <label>Cidade do foro<input name="credor_cidade" value="${esc(c.credor_cidade)}" placeholder="Ex.: Imperatriz/MA" ${dis}></label>
      </div>
      <label>Termos do acordo (uma cláusula por linha; {cidade} vira a cidade do foro)<textarea name="termos_acordo" rows="8" ${dis}>${esc(c.termos_acordo || TERMOS_PADRAO)}</textarea></label>
      <p class="nota">${icone('alerta')}<span>Modelo de referência, não é orientação jurídica. Juros entre particulares têm limites legais (Lei de Usura, Decreto 22.626/1933, e Código Civil). Revise os termos com um advogado antes de usar.</span></p>
      ${pode ? '<div class="acoes"><button class="btn pri">Gravar dados do acordo</button><button type="button" class="btn sec" data-a="termos-padrao">Voltar ao texto padrão</button></div>' : ''}
    </form>
  </section>`;
}

async function carregarPessoas() {
  const el = $('#painel-pessoas'); if (!el) return;
  const ms = await S.store.membros();
  const url = location.origin + location.pathname;
  el.innerHTML = `<h2>Pessoas com acesso</h2>
    <div class="lista">${ms.map(m => `<div class="item">
      ${avatar({ id: m.email, nome: m.nome || m.email })}
      <span class="item-pr"><span class="item-tit">${esc(m.nome || m.email)}</span><span class="item-sub">${esc(m.email)} · ${m.papel}</span></span>
      ${ehDono() && m.papel !== 'dono' && !leitura() ? `<span class="item-ac"><button class="btn peq perigo" data-a="membro-tirar" data-email="${esc(m.email)}">Tirar</button></span>` : ''}
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
    <span class="item-val">${pill(p.status === 'confirmado' ? 'verde' : p.status === 'recusado' ? 'vermelha' : '', ROT[p.status])}</span></div>`).join('')}</div>`
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
    const tag = d < 0 ? pill('vermelha', `vencida ${dataCurta(c.assinatura_ate)}`) : d <= 5 ? pill('', `vence ${dataCurta(c.assinatura_ate)}`) : pill('verde', `até ${dataBR(c.assinatura_ate)}`);
    return `<div class="item">
      <span class="item-pr"><span class="item-tit">${esc(c.nome)}${pagantes.has(c.id) ? '' : ' <small>(teste)</small>'}</span>
      <span class="item-sub">${esc(c.dono || '')} · ${c.membros} pessoa${c.membros == 1 ? '' : 's'} · desde ${new Date(c.criado_em).toLocaleDateString('pt-BR')}</span></span>
      <span class="item-val">${tag}</span>
      <span class="item-ac"><button class="btn peq sec" data-a="conta-validade" data-id="${c.id}" data-ate="${c.assinatura_ate}" data-nome="${esc(c.nome)}">Validade</button></span></div>`;
  }).join('') || '<p class="dica">Nenhuma conta.</p>'}</div>`;
}

function renderAdminSolto() {
  document.body.className = 'dentro';
  $('#app').innerHTML = `<div class="solto"><header class="topo"><div class="topo-nome">${MARCA_ICONE}<b>Administração</b></div>
    <button class="btn peq sec" data-a="nav" data-v="inicio">Voltar</button></header>
    <main class="conteudo">${viewAdmin()}</main></div>`;
  posAdmin().catch(e => toast(e.message, 'erro'));
}

const VIEWS = { inicio: viewInicio, agenda: viewAgenda, clientes: viewClientes, aportes: viewAportes, mais: viewMais, assinatura: viewAssinatura, admin: viewAdmin };
const POS = { mais: carregarPessoas, assinatura: posAssinatura, admin: posAdmin };

function irPara(v) {
  S.view = v; history.replaceState(null, '', '#' + v);
  render();
  const pos = POS[v]; if (pos && S.perfil?.membro) pos().catch(e => toast(e.message, 'erro'));
}

// Acordo em PDF -----------------------------------------------------------------------
async function montarAcordo(id) {
  const a = S.ap.get(id); const c = S.cli.get(a.cliente_id) || {}; const conta = S.perfil.conta || {};
  const r = resumoAporte(a); const h = hoje();
  const per = C.PERIODICIDADES[a.periodicidade]?.nome?.toLowerCase() || '';
  const forma = a.modalidade === 'fixa' ? `${r.ps.length} parcela${r.ps.length === 1 ? '' : 's'} em ${C.prazoDias(a)} dias`
    : a.modalidade === 'unico' ? 'pagamento único no vencimento' : `${C.MODALIDADES[a.modalidade]}, ${per}, ${r.ps.length} parcelas`;
  const encargo = a.modalidade === 'fixa'
    ? `${moeda(r2(C.moraDiaria(a, r.ps)))} por dia (juros do contrato ÷ 30)`
    : `juros de um mês sobre o saldo devedor ÷ 30, por dia (hoje ${moeda(r2(C.moraDiaria(a, r.ps)))})`;
  const condicoes = [
    ['Valor do crédito', moeda(a.valor)], ['Data do crédito', dataBR(a.data_aporte)],
    ['Taxa de juros', a.modalidade === 'fixa' ? fmtTaxa(a) : `${fmtTaxa(a)}, juros ${a.regime}`], ['Forma de pagamento', forma],
    ['Total previsto', moeda(r.total)], ['Já recebido', moeda(r.recebido)], ['Saldo a receber', moeda(r.aReceber)],
    ['Encargo por atraso', encargo],
  ];
  if (r.mora) condicoes.push(['Multa em aberto hoje', `${moeda(r.mora)} (${r.dias} dia${r.dias === 1 ? '' : 's'} de atraso)`]);
  const sit = p => p.recebido_em ? `Recebida ${dataCurta(p.recebido_em)}` : p.vencimento < h ? 'Em atraso' : 'A vencer';
  const blob = await gerarAcordoPDF({
    numero: `${a.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`, emitido: dataBR(h),
    credor: { nome: conta.credor_nome || conta.nome, doc: conta.credor_doc, endereco: conta.credor_endereco },
    devedor: { nome: c.nome, doc: c.documento, telefone: c.telefone, email: c.email },
    condicoes,
    parcelas: r.ps.map(p => [String(p.num), dataBR(p.vencimento), moeda(p.valor), moeda(p.juros), moeda(p.amortizacao), sit(p)]),
    totais: ['', 'Total', moeda(r.total), moeda(soma(r.ps, p => p.juros)), moeda(soma(r.ps, p => p.amortizacao)), ''],
    termos: conta.termos_acordo || TERMOS_PADRAO, cidade: conta.credor_cidade, dataExtenso: dataExtenso(h),
  });
  const slug = norm(c.nome).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'cliente';
  return { blob, nome: `acordo_${slug}_${h}.pdf`, a };
}

// Recibo de pagamento em PDF ---------------------------------------------------------
async function montarRecibo(id) {
  const p = S.dados.parcelas.find(x => x.id === id);
  if (!p?.recebido_em) throw new Error('Esta parcela ainda não foi recebida.');
  const a = S.ap.get(p.aporte_id); const c = S.cli.get(a?.cliente_id) || {}; const conta = S.perfil.conta || {};
  const ps = S.parcPorAp.get(p.aporte_id) || [];
  // O valor recebido paga primeiro a multa, depois os juros e por último o capital.
  const total = r2(p.valor_recebido), multa = r2(p.mora || 0), pago = r2(total - multa);
  const juros = r2(Math.min(pago, p.juros)), capital = r2(pago - p.juros);
  const linhas = [multa ? ['Multa de atraso', moeda(multa)] : null, ['Juros', moeda(juros)],
    capital > 0.004 ? ['Capital (abate o saldo)', moeda(capital)] : null, ['Total recebido', moeda(total)]].filter(Boolean);
  const abertas = ps.filter(x => !x.recebido_em);
  const devedor = `${c.nome || '(nome do cliente)'}${c.documento ? `, CPF/CNPJ ${c.documento},` : ''}`;
  const blob = await gerarReciboPDF({
    numero: `${a.id.replace(/-/g, '').slice(0, 6).toUpperCase()}-${String(p.num).padStart(2, '0')}`,
    emitido: new Date().toLocaleDateString('pt-BR'),
    credor: { nome: conta.credor_nome || conta.nome, doc: conta.credor_doc, endereco: conta.credor_endereco },
    valor: moeda(total), extenso: valorPorExtenso(total),
    texto: `Recebi de ${devedor} a quantia acima, referente à parcela ${p.num} de ${ps.length} do crédito de ${moeda(a.valor)} concedido em ${dataBR(a.data_aporte)}, com vencimento em ${dataBR(p.vencimento)}, paga em ${dataBR(p.recebido_em)}.${p.obs ? ` Observação: ${p.obs}.` : ''}`,
    linhas,
    nota: capital < -0.004 ? `Os juros que faltaram (${moeda(-capital)}) somaram ao saldo devedor.` : '',
    saldo: abertas.length ? `Saldo do crédito na emissão deste recibo: ${moeda(soma(abertas, x => x.amortizacao))} em capital, com ${plural(abertas.length, 'parcela em aberto', 'parcelas em aberto')}.` : 'Crédito quitado na emissão deste recibo.',
    cidade: conta.credor_cidade, dataExtenso: dataExtenso(p.recebido_em),
  });
  const slug = norm(c.nome).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'cliente';
  return { blob, nome: `recibo_${slug}_${p.recebido_em}_parcela${p.num}.pdf` };
}

// No celular, o PDF abre direto para compartilhar (WhatsApp, e-mail...); no computador, baixa.
async function entregarPDF(blob, nome, titulo) {
  const arq = new File([blob], nome, { type: 'application/pdf' });
  if (matchMedia('(max-width: 899.98px)').matches && navigator.canShare?.({ files: [arq] })) {
    try { await navigator.share({ files: [arq], title: titulo }); return 'compartilhado'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelado'; }
  }
  baixar(nome, blob, 'application/pdf');
  return 'baixado';
}

// Carrega o gerador de PDF em segundo plano, uma vez, para o clique no recibo ser rápido.
function preparoPDF() {
  if (preparoPDF.feito) return;
  preparoPDF.feito = true;
  setTimeout(() => prepararPDF().catch(() => { preparoPDF.feito = false; }), 0);
}

// Mensagem com um botão de ação (ex.: "Recebimento registrado · Emitir recibo").
function toastAcao(msg, rotulo, dados) {
  const t = document.createElement('div'); t.className = 'toast ok com-acao';
  const s = document.createElement('span'); s.textContent = msg; t.appendChild(s);
  const b = document.createElement('button'); b.type = 'button'; b.className = 'toast-acao'; b.textContent = rotulo;
  for (const [k, v] of Object.entries(dados)) b.dataset[k] = v;
  t.appendChild(b);
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 9000);
}

// Exportação ------------------------------------------------------------------------
function baixar(nome, conteudo, tipo) {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo });
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
  'reenviar-codigo': async (d, el) => {
    const email = String($('form[data-f="confirmar"] [name=email]')?.value || S.emailConfirmar || '').trim();
    if (!email) return toast('Digite o e-mail cadastrado.', 'erro');
    S.emailConfirmar = email; el.disabled = true;
    try { await tentar(() => S.store.reenviarCodigo(email), `Código reenviado para ${email}`); }
    finally { setTimeout(() => { if (el.isConnected) el.disabled = false; }, 30000); }
  },
  sair: async () => { await S.store.sair(); if (!demo()) location.hash = ''; },
  'sair-demo': async (d, el, ev) => { ev.preventDefault(); localStorage.removeItem(CHAVE_DEMO); location.href = location.pathname; },
  graf: d => { S.grafico = d.m; render(); },
  'agenda-ir': d => {
    S.f = { ...S.f, periodo: d.periodo, de: d.de || '', ate: d.ate || '', situacao: d.situacao || 'pendente', cliente: d.cliente || '' };
    irPara('agenda');
  },
  receber: d => abrirRecebimento(d.id),
  'rec-lista': () => abrirListaReceber(),
  ajuda: () => abrirAjuda(),
  tema: d => escolherTema(d.t),
  'tema-alternar': () => escolherTema(document.documentElement.dataset.tema === 'escuro' ? 'claro' : 'escuro'),
  'rec-modo': (d, el) => {
    const f = el.closest('form'); f.elements.modo.value = d.m;
    f.querySelectorAll('[data-a="rec-modo"]').forEach(b => b.classList.toggle('on', b === el));
    previaRecebimento(el, true);
    if (d.m === 'outro') { f.elements.valor.focus(); f.elements.valor.select(); }
  },
  desfazer: async d => {
    if (!confirm('Desfazer o recebimento desta parcela?\n\nSe o valor recebido foi diferente do valor da parcela, as parcelas seguintes já foram recalculadas e não voltam sozinhas: confira o crédito e edite se precisar.')) return;
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
  'docs-tentar': d => carregarDocs(d.cliente),
  'doc-abrir': async d => {
    const doc = S.docs?.get(d.id); if (!doc) return;
    const w = window.open('', '_blank');
    try { const url = await S.store.abrirDocumento(doc); if (w) w.location = url; else location.href = url; }
    catch (e) { w?.close(); toast(e.message, 'erro'); }
  },
  'doc-excluir': async d => {
    const doc = S.docs?.get(d.id); if (!doc) return;
    if (!confirm(`Excluir o documento "${doc.nome}"?`)) return;
    await tentar(() => S.store.excluirDocumento(doc), 'Documento excluído');
    carregarDocs(doc.cliente_id);
  },
  acordo: d => {
    const a = S.ap.get(d.id); if (!a) return;
    abrir(`<div class="dlg-cab"><h2>Acordo em PDF</h2><button class="x" data-a="fechar" aria-label="Fechar">×</button></div>
      <p>Gera o instrumento particular de acordo com as condições, a tabela de parcelas e os termos definidos em Configurações › Dados do acordo.</p>
      ${S.perfil.conta?.credor_nome ? '' : '<p class="nota">' + icone('alerta') + '<span>Os dados do credor ainda não foram preenchidos (Configurações › Dados do acordo). O PDF sai com espaços em branco para completar à mão.</span></p>'}
      <div class="acoes">
        <button class="btn pri" data-a="acordo-gerar" data-id="${a.id}">${icone('documento')}Gerar PDF</button>
        ${leitura() ? '' : `<button class="btn sec" data-a="acordo-gerar" data-id="${a.id}" data-guardar="1">Gerar e guardar nos documentos do cliente</button>`}
        <button class="btn sec" data-a="ap-ver" data-id="${a.id}">Voltar</button>
      </div>`);
  },
  recibo: async (d, el) => {
    el.disabled = true;
    try {
      const { blob, nome } = await montarRecibo(d.id);
      if (await entregarPDF(blob, nome, 'Recibo de pagamento') === 'baixado') toast('Recibo gerado', 'ok');
    } catch (e) { toast(e.message || 'Não foi possível gerar o recibo', 'erro'); }
    finally { if (el.isConnected) el.disabled = false; }
  },
  'acordo-gerar': async (d, el) => {
    el.disabled = true;
    try {
      const { blob, nome, a } = await montarAcordo(d.id);
      await entregarPDF(blob, nome, 'Acordo de pagamento');
      if (d.guardar) {
        const arq = new File([blob], nome, { type: 'application/pdf' });
        await tentar(() => S.store.enviarDocumento(S.perfil.conta?.id || S.perfil.membro?.conta_id, a.cliente_id, arq, `Acordo ${dataBR(hoje())} - crédito de ${moeda(a.valor)}.pdf`), 'Acordo gerado e guardado nos documentos');
      } else toast('Acordo gerado', 'ok');
      verAporte(a.id);
    } catch (e) { toast(e.message || 'Não foi possível gerar o PDF', 'erro'); }
    finally { if (el.isConnected) el.disabled = false; }
  },
  'termos-padrao': (d, el) => { el.closest('form').elements.termos_acordo.value = TERMOS_PADRAO; },
  'conta-validade': d => abrir(`<div class="dlg-cab"><h2>Validade da assinatura</h2><button class="x" data-a="fechar" aria-label="Fechar">×</button></div>
    <p>${esc(d.nome)}</p>
    <form data-f="validade" data-id="${d.id}" class="form">
      <label>Em dia até<input name="ate" type="date" required value="${d.ate}"></label>
      <div class="acoes"><button class="btn pri">Gravar</button><button type="button" class="btn sec" data-a="fechar">Cancelar</button></div>
    </form>`),
};

// "Registrar recebimento" do Início: primeiro a lista de parcelas em aberto, depois o modal de receber.
function listaReceber(busca = '') {
  const b = norm(busca);
  const ps = pendentes().filter(p => !b || norm(clienteDe(p)?.nome).includes(b)).sort((x, y) => x.vencimento.localeCompare(y.vencimento));
  if (!ps.length) return `<p class="vazio-p">${b ? 'Nenhuma parcela em aberto para esta busca.' : 'Nenhuma parcela em aberto.'}</p>`;
  return listaAgrupada(ps, { limite: 60 }) + (ps.length > 60 ? `<p class="dica">Mostrando as 60 primeiras de ${ps.length}. Busque pelo nome do cliente para achar as outras.</p>` : '');
}

function abrirListaReceber() {
  abrir(`<div class="dlg-cab"><h2>Registrar recebimento</h2><button class="x" data-a="fechar" aria-label="Fechar">×</button></div>
    <p class="dica">Escolha a parcela que você recebeu. Em seguida, confira o valor e confirme.</p>
    <input class="busca" type="search" placeholder="Buscar pelo cliente" data-in="busca-rec" aria-label="Buscar pelo cliente">
    <div id="rec-lista">${listaReceber()}</div>`);
}

function abrirAjuda() {
  const contato = S.perfil?.config?.contato || S.publica?.contato;
  abrir(`<div class="dlg-cab"><h2>Ajuda</h2><button class="x" data-a="fechar" aria-label="Fechar">×</button></div>
  <div class="ajuda">
    <h3>Primeiros passos</h3>
    <p>Cadastre o cliente em <b>Clientes</b> e depois o crédito em <b>+ Novo crédito</b>, com o valor, a taxa e a forma de pagamento. O CredFlux gera as parcelas, e dá para ajustar a data e o valor de cada uma antes de gravar. Vencimento no domingo passa para a segunda.</p>
    <h3>Segurança e sigilo</h3>
    <p>Todos os dados são protegidos por criptografia, com segurança, discrição e total sigilo. A conexão com o CredFlux é sempre protegida (HTTPS) e as informações ficam criptografadas no armazenamento. Cada conta só acessa os próprios dados, e as senhas não ficam guardadas em texto. Os documentos dos clientes ficam numa pasta privada e só abrem por links temporários. O administrador do serviço vê apenas as contas e os pagamentos da assinatura, nunca os seus clientes e créditos. Na demonstração, os dados ficam só neste navegador.</p>
    <h3>Receber uma parcela</h3>
    <p>Use o botão de confirmar (✓) ao lado da parcela ou <b>Registrar recebimento</b>, no Início. Dá para receber a parcela inteira, só os juros ou outro valor; antes de confirmar, o sistema mostra como ficam o saldo e as próximas parcelas. O dinheiro paga primeiro a multa, depois os juros e por último o capital. Para corrigir, use <b>Desfazer</b> na Agenda ou no crédito.</p>
    <h3>Recibo e acordo em PDF</h3>
    <p>Depois de receber, toque em <b>Emitir recibo</b> na mensagem que aparece, ou no botão <b>Recibo</b> da parcela, na Agenda ou no crédito. O recibo sai em PDF com o valor por extenso, a divisão entre multa, juros e capital e a assinatura do credor. No celular, o recibo e o acordo já abrem para enviar pelo WhatsApp; no computador, são baixados.</p>
    <h3>Atrasos e multa</h3>
    <p>A multa é por crédito e conta desde a parcela mais antiga em aberto: na taxa fixa, os juros do contrato ÷ 30 por dia; nas outras formas, o saldo × a taxa mensal ÷ 30 por dia. Ela pode ser dispensada ao receber. <b>Cobrar</b>, no Início, abre o WhatsApp do cliente em atraso; com mais de um cliente, abre a Agenda nos atrasos.</p>
    <h3>Agenda</h3>
    <p>Filtre por período, cliente e situação, agrupe por dia ou por mês e baixe a planilha.</p>
    <h3>Documentos e acordo</h3>
    <p>Na ficha do cliente ficam contratos, recibos e fotos (PDF ou imagem). Em cada crédito, <b>Acordo em PDF</b> gera o acordo com as parcelas e os termos definidos em Configurações › Dados do acordo.</p>
    <h3>Assinatura</h3>
    <p>Em Configurações › Assinatura e pagamento, pague por Pix e toque em <b>Já paguei</b>. Com a assinatura vencida, a conta fica só para leitura até o pagamento ser conferido.</p>
    ${contato ? `<h3>Contato</h3><p>${esc(contato)}</p>` : ''}
  </div>`);
}

function abrirRecebimento(id) {
  const p = S.dados.parcelas.find(x => x.id === id); if (!p) return;
  const a = S.ap.get(p.aporte_id); const c = S.cli.get(a?.cliente_id);
  const n = (S.parcPorAp.get(p.aporte_id) || []).length;
  abrir(`<div class="dlg-cab"><h2>Registrar recebimento</h2><button class="x" data-a="fechar" aria-label="Fechar">×</button></div>
    <p>${esc(c?.nome)} · parcela ${p.num}/${n} · vence ${dataBR(p.vencimento)} · <b>${moeda(p.valor)}</b> (juros ${moeda(p.juros)})</p>
    <form data-f="receber" data-id="${p.id}" class="form">
      <input type="hidden" name="modo" value="inteira">
      <div class="seg largo" role="group" aria-label="Quanto recebeu">
        <button type="button" class="on" data-a="rec-modo" data-m="inteira">Parcela inteira</button>
        <button type="button" data-a="rec-modo" data-m="juros">Só os juros</button>
        <button type="button" data-a="rec-modo" data-m="outro">Outro valor</button>
      </div>
      <div class="col2">
        <label>Recebido em<input name="data" type="date" required value="${hoje()}"></label>
        <label>Valor recebido (R$)<input name="valor" inputmode="decimal" required value="${C.num(p.valor)}"></label>
      </div>
      <label class="marcar" id="rec-mora-l"><input type="checkbox" name="cobrar_mora" checked><span id="rec-mora-t"></span></label>
      <div id="rec-previa"></div>
      <label>Observação<input name="obs" placeholder="opcional"></label>
      <div class="acoes"><button class="btn ok" autofocus>Confirmar recebimento</button><button type="button" class="btn sec" data-a="fechar">Cancelar</button></div>
    </form>`);
  previaRecebimento($('form[data-f="receber"]'), true);
  preparoPDF();
}

// Calcula a multa e o efeito do valor nas parcelas. preencher: põe no campo o valor do modo escolhido.
function calcRecebimento(form, preencher) {
  const p = S.dados.parcelas.find(x => x.id === form.dataset.id); const a = S.ap.get(p.aporte_id);
  const ps = S.parcPorAp.get(p.aporte_id) || [];
  const data = form.elements.data.value || hoje();
  const moraCalc = C.moraAte(a, ps, data);
  const cobra = moraCalc > 0 && form.elements.cobrar_mora.checked;
  const mora = cobra ? moraCalc : 0;
  const modo = form.elements.modo.value;
  if (preencher && modo !== 'outro') form.elements.valor.value = C.num(r2((modo === 'juros' ? p.juros : p.valor) + mora));
  const valor = C.parseNum(form.elements.valor.value);
  let res = null, erro = '';
  if (valor >= 0) { try { res = C.aplicarRecebimento(a, ps, p.id, data, r2(valor), mora); } catch (e) { erro = e.message; } }
  return { p, a, ps, data, moraCalc, mora, valor, res, erro, dias: C.diasAtraso(ps, data) };
}

function previaRecebimento(el, preencher = false) {
  const form = el.closest ? (el.closest('form[data-f="receber"]') || el) : el; if (!form?.elements?.valor) return;
  if (el.name === 'valor') { form.elements.modo.value = 'outro'; form.querySelectorAll('[data-a="rec-modo"]').forEach(b => b.classList.toggle('on', b.dataset.m === 'outro')); }
  const k = calcRecebimento(form, preencher || el.name === 'data' || el.name === 'cobrar_mora');
  const ml = $('#rec-mora-l'); ml.hidden = !(k.moraCalc > 0);
  $('#rec-mora-t').innerHTML = `Cobrar multa de atraso: <b>${moeda(k.moraCalc)}</b> (${k.dias} dia${k.dias === 1 ? '' : 's'} × ${moeda(r2(C.moraDiaria(k.a, k.ps)))})`;
  const el2 = $('#rec-previa');
  if (!(k.valor >= 0)) { el2.innerHTML = '<p class="erro-campo">Informe um valor válido.</p>'; return; }
  if (k.erro) { el2.innerHTML = `<p class="erro-campo">${esc(k.erro)}.</p>`; return; }
  const pago = r2(k.valor - k.mora);
  const juros = r2(Math.min(pago, k.p.juros)), capital = r2(pago - k.p.juros);
  const linhas = [k.mora ? ['Multa de atraso', k.mora] : null, ['Juros da parcela', juros],
    capital >= 0 ? ['Capital (abate o saldo)', capital] : ['Juros que faltaram (somam ao saldo)', -capital]].filter(Boolean);
  let efeito = '';
  if (k.res?.refeitas) {
    const prox = k.res.parcelas.filter(x => !x.recebido_em).sort((x, y) => x.vencimento.localeCompare(y.vencimento));
    const saldo = soma(prox, x => x.amortizacao);
    efeito = prox.length
      ? `O valor é diferente da parcela: o saldo devedor passa a <b>${moeda(saldo)}</b> e ${prox.length === 1 ? 'a próxima parcela fica' : `as ${prox.length} parcelas seguintes são refeitas; a próxima fica`} em <b>${moeda(prox[0].valor)}</b>, vencendo ${dataBR(prox[0].vencimento)}.`
      : 'Com este valor o crédito fica quitado.';
  } else efeito = 'As outras parcelas não mudam.';
  el2.innerHTML = `<div class="conta-linhas">${linhas.map(([t, v]) => `<div><span>${t}</span><b>${moeda(v)}</b></div>`).join('')}
    <div class="total"><span>Total recebido</span><b>${moeda(k.valor)}</b></div></div>
    <p class="nota"><span>${efeito}</span></p>`;
}

function reabrirDetalhe(parcelaId) {
  const p = S.dados.parcelas.find(x => x.id === parcelaId);
  if (p) verAporte(p.aporte_id); else fechar();
}

// Formulários --------------------------------------------------------------------
const FORMS = {
  async acesso(fd, form) {
    const email = fd.get('email').trim(); const senha = fd.get('senha');
    const m = form.dataset.m;
    if (m === 'entrar') {
      try { await S.store.entrar(email, senha); }
      catch (e) {
        // E-mail ainda não confirmado: manda um código novo e abre a tela do código.
        if (/Confirme o e-mail/.test(e.message)) {
          S.emailConfirmar = email;
          S.store.reenviarCodigo(email).catch(() => {});
          return telaAcesso('confirmar', 'Seu e-mail ainda não foi confirmado. Enviamos um código novo.');
        }
        toast(e.message || 'Erro', 'erro'); throw e;
      }
    } else if (m === 'criar') {
      const r = await tentar(() => S.store.criarAcesso(email, senha));
      if (r.precisaConfirmar) { S.emailConfirmar = email; telaAcesso('confirmar'); }
    } else {
      await tentar(() => S.store.esqueci(email));
      telaAcesso('entrar', `Se ${email} tiver acesso, chegará um link para criar uma nova senha.`);
    }
  },
  async confirmar(fd) {
    const email = String(fd.get('email') || '').trim(); const codigo = soDigitos(fd.get('codigo'));
    S.emailConfirmar = email;
    await tentar(() => S.store.confirmarCodigo(email, codigo), 'E-mail confirmado');
    // a sessão começa sozinha: aoMudarAcesso recebe SIGNED_IN e chama iniciarSessao
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
    const aporte = { ...c, id: S.form.id || '', n_parcelas: c.modalidade === 'unico' ? 1 : Math.min(600, ps.length) };
    if (c.modalidade === 'fixa') Object.assign(aporte, { regime: 'simples', taxa_periodo: 'mes', periodicidade: 'diaria' });
    delete aporte.primeiro_venc;
    const parcelas = ps.map((p, i) => ({
      num: i + 1, vencimento: p.vencimento, valor: r2(p.valor), amortizacao: r2(p.amortizacao), juros: r2(p.valor - p.amortizacao),
      recebido_em: p.recebido_em || null, valor_recebido: p.recebido_em ? p.valor_recebido : null, mora: p.recebido_em ? (p.mora || 0) : 0, obs: p.obs || null,
    }));
    const id = await tentar(() => S.store.salvarAporte(aporte, parcelas), 'Crédito gravado');
    await recarregar();
    verAporte(id);
  },
  async receber(fd, form) {
    const k = calcRecebimento(form, false);
    if (!(k.valor >= 0)) return toast('Valor inválido.', 'erro');
    if (k.erro) return toast(k.erro, 'erro');
    const obs = String(fd.get('obs') || '').trim();
    const aporteId = k.a.id;
    if (!k.res.refeitas) {
      await tentar(() => S.store.receber(k.p.id, k.data, r2(k.valor), obs, k.mora));
    } else {
      const a = k.a;
      const aporte = { id: a.id, cliente_id: a.cliente_id, valor: a.valor, data_aporte: a.data_aporte, taxa: a.taxa, taxa_periodo: a.taxa_periodo, regime: a.regime,
        modalidade: a.modalidade, periodicidade: a.periodicidade, prazo_dias: a.prazo_dias ?? null, obs: a.obs || '',
        n_parcelas: a.modalidade === 'fixa' ? a.n_parcelas : Math.max(1, Math.min(600, k.res.parcelas.length)) };
      const parcelas = k.res.parcelas.map(x => ({ num: x.num, vencimento: x.vencimento, valor: r2(x.valor), juros: r2(x.juros), amortizacao: r2(x.amortizacao),
        recebido_em: x.recebido_em || null, valor_recebido: x.recebido_em ? r2(x.valor_recebido) : null, mora: x.recebido_em ? r2(x.mora || 0) : 0,
        obs: x.id === k.p.id ? (obs || null) : (x.obs || null) }));
      await tentar(() => S.store.salvarAporte(aporte, parcelas));
    }
    fechar(); await recarregar();
    // a parcela recebida pode ter ganhado outro id ao refazer as seguintes: acha pelo crédito e pelo vencimento
    const recebida = S.dados.parcelas.find(x => x.aporte_id === aporteId && x.vencimento === k.p.vencimento && x.recebido_em === k.data);
    const msg = k.res.refeitas ? 'Recebimento registrado e parcelas recalculadas' : 'Recebimento registrado';
    if (recebida) toastAcao(msg, 'Emitir recibo', { a: 'recibo', id: recebida.id }); else toast(msg, 'ok');
    if (S.view !== 'inicio' && S.view !== 'agenda') verAporte(aporteId);
  },
  async acordo(fd) {
    const d = Object.fromEntries([...fd].map(([k, v]) => [k, String(v)]));
    if (d.termos_acordo.trim() === TERMOS_PADRAO.trim()) d.termos_acordo = '';
    await tentar(() => S.store.salvarDadosAcordo(d), 'Dados do acordo gravados');
    S.perfil.conta = { ...S.perfil.conta, ...Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.trim() || null])) };
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

document.addEventListener('change', async e => {
  if (e.target.dataset.in === 'doc-arquivo') {
    const inp = e.target; const cli = inp.dataset.cliente; const arqs = [...inp.files]; inp.value = '';
    const contaId = S.perfil.conta?.id || S.perfil.membro?.conta_id;
    for (const f of arqs) await tentar(() => S.store.enviarDocumento(contaId, cli, f), `${f.name} enviado`).catch(() => {});
    return carregarDocs(cli);
  }
  if (e.target.closest('form[data-f="receber"]')) return previaRecebimento(e.target);
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
  if (t.dataset.in === 'busca-rec') { $('#rec-lista').innerHTML = listaReceber(t.value); return; }
  if (t.dataset.in === 'parc') {
    const p = S.form.parcelas[+t.dataset.i];
    if (t.dataset.k === 'valor') { const v = C.parseNum(t.value); if (v >= 0) p.valor = r2(v); }
    else p.vencimento = t.value;
    const tot = soma(S.form.parcelas, x => x.valor); const c = camposForm($('#f-aporte'));
    const cab = $('#previa .previa-cab');
    if (cab) { cab.children[0].querySelector('b').textContent = moeda(tot); cab.children[1].querySelector('b').textContent = moeda(c.valor > 0 ? r2(tot - c.valor) : 0); }
    return;
  }
  if (t.closest('#f-aporte') && ['valor', 'taxa', 'n_parcelas', 'prazo_dias'].includes(t.name)) campoAporteMudou(t);
  if (t.closest('form[data-f="receber"]')) previaRecebimento(t);
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
