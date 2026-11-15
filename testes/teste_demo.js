// Teste da demonstração no Chrome sem interface (DevTools Protocol, sem instalar nada).
// Uso: sirva a pasta (python -m http.server 8765) e rode: node testes/teste_demo.js <pasta_saida>
// Também gera icon-192.png e icon-512.png a partir de icon.svg (com --icones).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.APORTES_URL || 'http://127.0.0.1:8765/';
const SAIDA = process.argv[2] || path.join(os.tmpdir(), 'aportes_teste');
const PORTA = 9333;
fs.mkdirSync(SAIDA, { recursive: true });

const espera = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pend = new Map(); const erros = [];

function cdp(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((ok, falha) => pend.set(id, { ok, falha }));
}
async function avaliar(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
let atual = { width: 375, height: 812, mobile: true };
async function tela(larg, alt, movel) {
  atual = { width: larg, height: alt, mobile: movel };
  await cdp('Emulation.setDeviceMetricsOverride', { width: larg, height: alt, deviceScaleFactor: 1, mobile: movel });
}
// Página inteira: a janela cresce até a altura do conteúdo, para o menu fixo ficar no pé da foto (e não no meio).
async function foto(nome, cheia = true) {
  if (cheia) {
    const m = await cdp('Page.getLayoutMetrics');
    const alt = Math.max(atual.height, Math.min(Math.ceil(m.cssContentSize.height), 6000));
    await cdp('Emulation.setDeviceMetricsOverride', { width: atual.width, height: alt, deviceScaleFactor: 1, mobile: atual.mobile });
    await espera(200);
  }
  const r = await cdp('Page.captureScreenshot', { format: 'png' });
  if (cheia) { await tela(atual.width, atual.height, atual.mobile); await espera(100); }
  fs.writeFileSync(path.join(SAIDA, nome + '.png'), Buffer.from(r.data, 'base64'));
}
const clicar = sel => avaliar(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) throw new Error('não achei ${sel.replace(/'/g, '')}'); e.click(); return true})()`);
const transborda = () => avaliar(`document.documentElement.scrollWidth - innerWidth`);
const estilo = (sel, prop) => avaliar(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); return e ? getComputedStyle(e)[${JSON.stringify(prop)}] : null})()`);
const visivel = sel => avaliar(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'})()`);
// parcelas em atraso segundo os dados guardados na demonstração
const atrasosNoBanco = () => avaliar(`(()=>{const d=new Date(); const h=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  return JSON.parse(localStorage.credflux_demo_v2).parcelas.filter(p=>!p.recebido_em && p.vencimento < h).length})()`);

const verif = []; const ok = (cond, msg) => { verif.push((cond ? 'OK   ' : 'FALHA') + ' ' + msg); };

(async () => {
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'aportes-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${PORTA}`, `--user-data-dir=${perfil}`, 'about:blank'], { stdio: 'ignore' });
  let alvo;
  for (let i = 0; i < 50 && !alvo; i++) {
    await espera(200);
    try { alvo = (await (await fetch(`http://127.0.0.1:${PORTA}/json`)).json()).find(t => t.type === 'page'); } catch { /* ainda subindo */ }
  }
  ws = new WebSocket(alvo.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.falha(new Error(m.error.message)) : p.ok(m.result); }
    if (m.method === 'Runtime.exceptionThrown') erros.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') erros.push(m.params.args.map(a => a.value || a.description).join(' '));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon\.ico/.test(m.params.entry.url || '')) erros.push(m.params.entry.text + ' ' + (m.params.entry.url || ''));
  });
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Log.enable');
  // tema do sistema simulado: claro no começo (o automático segue esta escolha)
  const esquema = v => cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: v }] });
  const tok = v => avaliar(`getComputedStyle(document.documentElement).getPropertyValue('${v}').trim().toUpperCase()`);
  await esquema('light');

  try {
    if (process.argv.includes('--icones')) {
      const raiz = path.join(__dirname, '..');
      for (const t of [192, 512]) {
        await tela(t, t, false);
        await cdp('Page.navigate', { url: BASE + 'icon.svg' }); await espera(500);
        const r = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: t, height: t, scale: 1 } });
        fs.writeFileSync(path.join(raiz, `icon-${t}.png`), Buffer.from(r.data, 'base64'));
      }
    }

    // Celular
    await tela(375, 812, true);
    await cdp('Page.navigate', { url: BASE + '?demo' }); await espera(1500);
    ok(await avaliar(`!!document.querySelector('.destaques .destaque.escuro')`), 'Início carregou com os destaques');
    ok(await transborda() <= 0, 'Início sem rolagem lateral no celular');
    ok(await avaliar(`['--bg','--surface','--ink','--muted','--line','--brand-dark','--brand-dark-2','--brand','--brand-text','--danger'].map(v=>getComputedStyle(document.documentElement).getPropertyValue(v).trim().toUpperCase()).join(' ')`)
      === '#FFFFFF #FFFFFF #1B212D #646F82 #F0F1F3 #1B212D #363A3F #C8EE44 #1E7F5A #C9302C', 'Tokens de cor no :root');
    ok(await estilo('.lateral', 'position') === 'fixed' && await avaliar(`Math.abs(document.querySelector('.lateral').getBoundingClientRect().bottom - innerHeight) < 1`), 'Menu fixo embaixo no celular');
    ok(await avaliar(`document.querySelectorAll('.lateral .nav-it').length === 8 && [...document.querySelectorAll('.lateral .nav-it')].filter(e=>e.getClientRects().length).length === 5`), 'Menu de baixo com 5 itens (Ajuda, tema e Sair ficam em Ajustes)');
    ok(await avaliar(`getComputedStyle(document.querySelector('.destaques')).gridTemplateColumns.split(' ').length === 1 && getComputedStyle(document.querySelector('.janelas')).gridTemplateColumns.split(' ').length === 1`), 'Cartões em uma coluna no celular');
    const nAtraso = await atrasosNoBanco();
    const cont = await avaliar(`document.querySelector('[data-v="agenda"] .nav-cont')?.firstChild?.textContent || ''`);
    ok(nAtraso === 0 ? cont === '' : cont === String(nAtraso), `Contador da Agenda = parcelas em atraso (${cont || 'sem contador'} / ${nAtraso})`);
    const graf = await avaliar(`(()=>{const cs=[...document.querySelectorAll('.graf-col')]; const h=c=>parseFloat(c.querySelector('.graf-b').style.getPropertyValue('--h'));
      const outros=cs.filter(c=>!c.classList.contains('atual')).map(h).sort((a,b)=>b-a); const picos=cs.filter(c=>c.classList.contains('pico')).map(h);
      return {n:cs.length, atual:cs[0].classList.contains('atual') && getComputedStyle(cs[0].querySelector('.graf-b')).backgroundColor,
        picos:picos.length, certos: picos.every(v=>v>=outros[Math.min(1,outros.length-1)]), cor: cs.find(c=>c.classList.contains('pico')) ? getComputedStyle(cs.find(c=>c.classList.contains('pico')).querySelector('.graf-b')).backgroundColor : '',
        rotulo: cs[0].querySelector('.graf-v').textContent, pe: document.querySelector('.graf-pe').textContent}})()`);
    ok(graf.n === 12 && graf.atual === 'rgb(32, 32, 31)' && graf.picos <= 2 && graf.certos && (!graf.picos || graf.cor === 'rgb(41, 160, 115)'),
      `Gráfico de 12 colunas: mês atual escuro, ${graf.picos} picos em verde (${graf.rotulo}; ${graf.pe.replace(/\s+/g, ' ').trim()})`);
    ok(/^(-|\d+(,\d)?[kM]?)$/.test(graf.rotulo), `Valor curto em cima da coluna (${graf.rotulo})`);
    const linha = await avaliar(`(()=>{const l=document.querySelector('.lista-g .item'); return l ? {av: l.querySelector('.av').getBoundingClientRect().width, ck: l.querySelector('.ck')?.getBoundingClientRect().width, sub: l.querySelector('.item-sub').textContent} : null})()`);
    ok(linha && linha.av === 40 && linha.ck === 34 && /^Parcela \d+\/\d+ · /.test(linha.sub), `Próximos recebimentos: avatar 40px, botão 34px e "${linha?.sub}"`);
    await foto('m01_inicio');

    await clicar('[data-a="graf"][data-m="dias"]'); await espera(200);
    ok(await avaliar(`document.querySelectorAll('.graf-col').length > 0 || /Nada a receber/.test(document.querySelector('.paineis').textContent)`), 'Gráfico de 30 dias');
    await foto('m02_inicio_30dias');
    await clicar('[data-a="graf"][data-m="meses"]'); await espera(200);

    await clicar('[data-a="nav"][data-v="agenda"]'); await espera(300);
    ok(await avaliar(`document.querySelectorAll('.grupo').length > 0`), 'Agenda lista grupos de 30 dias');
    ok(await transborda() <= 0, 'Agenda sem rolagem lateral');
    ok(await avaliar(`[...document.querySelectorAll('.grupo .pill')].every(p=>p.textContent==='A receber' ? !p.classList.contains('verde') && !p.classList.contains('vermelha') : true)`), 'Pílula "A receber" em cinza');
    await foto('m03_agenda');

    await avaliar(`(()=>{const s=document.querySelector('select[name=agrupar]'); s.value='mes'; s.dispatchEvent(new Event('change',{bubbles:true}));
      const p=document.querySelector('select[name=periodo]'); p.value='p365'; p.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await espera(300);
    ok(await avaliar(`document.querySelector('select[name=periodo]').value==='p365' && document.querySelectorAll('.grupo').length > 3`), 'Agenda de 12 meses por mês');
    await foto('m04_agenda_meses');

    // Receber a primeira parcela da agenda
    const antes = await avaliar(`JSON.parse(localStorage.credflux_demo_v2).parcelas.filter(p=>p.recebido_em).length`);
    await clicar('[data-a="receber"]'); await espera(200);
    await foto('m05_receber', false);
    await avaliar(`document.querySelector('form[data-f="receber"]').requestSubmit()`); await espera(500);
    const depois = await avaliar(`JSON.parse(localStorage.credflux_demo_v2).parcelas.filter(p=>p.recebido_em).length`);
    ok(depois === antes + 1, `Recebimento registrado (${antes} -> ${depois})`);

    // Parcela em atraso: botão vermelho, multa e "só os juros" (recalcula as seguintes)
    await clicar('[data-a="nav"][data-v="inicio"]'); await espera(300);
    ok(await avaliar(`(()=>{const b=document.querySelector('.item.st-atrasada .ck'); return !!b && b.classList.contains('ruim') && getComputedStyle(b).backgroundColor==='rgb(201, 48, 44)' && /check-branco/.test(b.querySelector('img').src)})()`), 'Parcela atrasada com o botão vermelho preenchido');
    ok(await avaliar(`[...document.querySelectorAll('.lista-g .item:not(.st-atrasada) .ck')].every(b=>/^rgba?\\(255, 255, 255/.test(getComputedStyle(b).backgroundColor) && getComputedStyle(b).borderTopWidth==='1px' && /check-verde/.test(b.querySelector('img').src))`), 'Demais parcelas com o botão branco de borda');
    ok(await avaliar(`(()=>{const s=getComputedStyle(document.querySelector('.destaque.escuro')); const b=getComputedStyle(document.querySelector('.lateral'));
      return /gradient/.test(s.backgroundImage) && /gradient/.test(getComputedStyle(document.querySelector('.graf-col.atual .graf-b')).backgroundImage) && /blur/.test(b.backdropFilter || b.webkitBackdropFilter || '')})()`), 'Degradês (cartão escuro, gráfico) e menu translúcido com desfoque');
    await clicar('.item.st-atrasada [data-a="receber"]'); await espera(300);
    const mora = await avaliar(`(()=>{const l=document.getElementById('rec-mora-l'); return l && !l.hidden ? document.getElementById('rec-mora-t').textContent : ''})()`);
    ok(/multa/i.test(mora), `Multa de atraso oferecida (${mora})`);
    await clicar('[data-a="rec-modo"][data-m="juros"]'); await espera(200);
    const prevJ = await avaliar(`document.getElementById('rec-previa').textContent`);
    ok(/saldo devedor passa/.test(prevJ) || /não mudam/.test(prevJ), 'Prévia do recebimento só dos juros');
    await foto('m05b_receber_juros_multa', false);
    const antes2 = await avaliar(`JSON.parse(localStorage.credflux_demo_v2).parcelas.filter(p=>p.recebido_em).length`);
    await avaliar(`document.querySelector('form[data-f="receber"]').requestSubmit()`); await espera(600);
    const db2 = await avaliar(`(()=>{const d=JSON.parse(localStorage.credflux_demo_v2); return {n:d.parcelas.filter(p=>p.recebido_em).length, mora:d.parcelas.filter(p=>p.mora>0).length}})()`);
    ok(db2.n === antes2 + 1 && db2.mora >= 1, `Recebimento só dos juros com multa gravado (${antes2} -> ${db2.n}, ${db2.mora} com multa)`);

    // "Registrar recebimento": lista das parcelas em aberto e, depois, o modal de receber.
    // Pagamento parcial numa parcela Price: as seguintes são refeitas sobre o saldo
    await clicar('[data-a="rec-lista"]'); await espera(300);
    ok(await avaliar(`document.querySelectorAll('#rec-lista .item').length > 0 && !document.querySelector('#rec-lista .item.st-recebida')`), 'Registrar recebimento lista as parcelas em aberto');
    await avaliar(`(()=>{const i=document.querySelector('[data-in="busca-rec"]'); i.value='mercad'; i.dispatchEvent(new Event('input',{bubbles:true}));})()`); await espera(200);
    ok(await avaliar(`[...document.querySelectorAll('#rec-lista .item .item-tit')].every(t=>/Mercadinho/.test(t.textContent))`), 'Busca pelo cliente na lista de recebimento');
    await foto('m05c_registrar_recebimento', false);
    await avaliar(`[...document.querySelectorAll('#rec-lista .item')].find(i=>/Mercadinho/.test(i.textContent)).querySelector('[data-a="receber"]').click()`);
    await espera(300);
    const pid = await avaliar(`document.querySelector('form[data-f="receber"]').dataset.id`);
    const ap = await avaliar(`JSON.parse(localStorage.credflux_demo_v2).parcelas.find(p=>p.id==='${pid}').aporte_id`);
    const antesP = await avaliar(`JSON.parse(localStorage.credflux_demo_v2).parcelas.filter(p=>p.aporte_id==='${ap}' && !p.recebido_em).map(p=>p.valor)`);
    await clicar('[data-a="rec-modo"][data-m="outro"]');
    await avaliar(`(()=>{const v=document.querySelector('form[data-f="receber"] [name=valor]'); v.value='500,00'; v.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await espera(200);
    ok(/saldo devedor passa/.test(await avaliar(`document.getElementById('rec-previa').textContent`)), 'Prévia avisa que o saldo muda no pagamento parcial');
    await foto('m05d_receber_parcial', false);
    await avaliar(`document.querySelector('form[data-f="receber"]').requestSubmit()`); await espera(700);
    const depoisP = await avaliar(`JSON.parse(localStorage.credflux_demo_v2).parcelas.filter(p=>p.aporte_id==='${ap}' && !p.recebido_em).map(p=>p.valor)`);
    ok(depoisP.length === antesP.length - 1 && depoisP[0] > antesP[1], `Parcelas seguintes refeitas (${antesP[1]} -> ${depoisP[0]})`);
    ok(await avaliar(`JSON.parse(localStorage.credflux_demo_v2).parcelas.some(p=>p.aporte_id==='${ap}' && p.valor_recebido===500)`), 'Recebimento parcial gravado');

    await clicar('[data-a="nav"][data-v="clientes"]'); await espera(300);
    ok(await transborda() <= 0, 'Clientes sem rolagem lateral');
    ok(await avaliar(`[...document.querySelectorAll('#lista-cli .item')].every(i=>/^[A-ZÀ-Ú?]{1,2}$/.test(i.querySelector('.av').textContent))`), 'Clientes com avatar de iniciais');
    await foto('m06_clientes');
    await clicar('[data-a="cli-ver"]'); await espera(500);
    await avaliar(`(()=>{const i=document.querySelector('[data-in="doc-arquivo"]'); const dt=new DataTransfer();
      dt.items.add(new File(['%PDF-1.4 teste'], 'contrato assinado.pdf', {type:'application/pdf'})); i.files=dt.files;
      i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await espera(800);
    ok(await avaliar(`document.querySelectorAll('#docs-cli .item').length`) === 1, 'Documento enviado aparece no cliente');
    await foto('m07_cliente', false);
    await clicar('#dlg [data-a="fechar"]');

    // Novo crédito
    await clicar('[data-a="nav"][data-v="aportes"]'); await espera(300);
    await foto('m08_creditos');
    const nAp = await avaliar(`JSON.parse(localStorage.credflux_demo_v2).aportes.length`);
    await clicar('.tit-linha [data-a="ap-novo"]'); await espera(300);
    await avaliar(`(()=>{const f=document.getElementById('f-aporte');
      const set=(n,v,ev='input')=>{const e=f.elements[n]; e.value=v; e.dispatchEvent(new Event(ev,{bubbles:true}));};
      set('cliente_id', f.elements.cliente_id.options[1].value, 'change');
      set('valor','20.000,00'); set('taxa','3'); set('modalidade','price','change'); set('n_parcelas','6');})()`);
    await espera(300);
    const prev = await avaliar(`[document.querySelectorAll('.parc-lin').length, document.querySelector('.previa-cab b').textContent]`);
    ok(prev[0] === 6, `Prévia com 6 parcelas (${prev[0]}), total ${prev[1]}`);
    ok(/22\.15[0-9],/.test(prev[1].replace(/\s/g, '')), `Total Price 20.000 a 3% em 6x ~ R$ 22.152 (${prev[1]})`);
    await foto('m09_novo_credito', false);
    await avaliar(`document.getElementById('f-aporte').requestSubmit()`); await espera(500);
    ok(await avaliar(`JSON.parse(localStorage.credflux_demo_v2).aportes.length`) === nAp + 1, 'Crédito gravado');
    await foto('m10_credito_detalhe', false);

    // Acordo em PDF guardado nos documentos do cliente
    const nDocs = await avaliar(`(JSON.parse(localStorage.credflux_demo_v2).documentos||[]).length`);
    await clicar('#dlg [data-a="acordo"]'); await espera(300);
    await foto('m10b_acordo', false);
    await clicar('#dlg [data-a="acordo-gerar"][data-guardar="1"]'); await espera(5000);
    const docs = await avaliar(`(JSON.parse(localStorage.credflux_demo_v2).documentos||[]).map(d=>[d.nome,d.tamanho])`);
    ok(docs.length === nDocs + 1 && docs.at(-1)[1] > 3000, `Acordo em PDF gerado e guardado (${JSON.stringify(docs.at(-1))})`);
    const pdf = await avaliar(`(JSON.parse(localStorage.credflux_demo_v2).documentos||[]).at(-1)?.dados || ''`);
    if (pdf) fs.writeFileSync(path.join(SAIDA, 'acordo.pdf'), Buffer.from(pdf.split(',')[1], 'base64'));
    await clicar('#dlg [data-a="fechar"]');

    // Crédito com taxa fixa em dias: 1.000 + 10% em 30 dias, 11 parcelas de 100
    await clicar('.tit-linha [data-a="ap-novo"]'); await espera(300);
    await avaliar(`(()=>{const f=document.getElementById('f-aporte');
      const set=(n,v,ev='input')=>{const e=f.elements[n]; e.value=v; e.dispatchEvent(new Event(ev,{bubbles:true}));};
      set('cliente_id', f.elements.cliente_id.options[1].value, 'change'); set('modalidade','fixa','change');
      set('valor','1.000,00'); set('taxa','10'); set('prazo_dias','30'); set('n_parcelas','11');})()`);
    await espera(300);
    const fx = await avaliar(`[document.querySelectorAll('.parc-lin').length, document.querySelector('.previa-cab b').textContent, [...document.querySelectorAll('.parc-lin input[data-k=valor]')].map(i=>i.value).join('|'), document.querySelector('[name=primeiro_venc]').closest('label').hidden]`);
    ok(fx[0] === 11 && /1\.100,00/.test(fx[1]) && fx[2].split('|').every(v => v === '100,00') && fx[3], `Taxa fixa: 11 parcelas de 100, total 1.100 (${fx[0]}, ${fx[1]})`);
    await foto('m09b_credito_fixa', false);
    await avaliar(`document.getElementById('f-aporte').requestSubmit()`); await espera(500);
    ok(await avaliar(`JSON.parse(localStorage.credflux_demo_v2).aportes.some(a=>a.modalidade==='fixa' && a.prazo_dias===30 && a.valor===1000)`), 'Crédito de taxa fixa gravado com o prazo');
    await clicar('#dlg [data-a="fechar"]');

    await clicar('[data-a="nav"][data-v="mais"]'); await espera(300);
    ok(await avaliar(`!!document.querySelector('form[data-f="acordo"] textarea[name=termos_acordo]') && document.querySelector('.tit').textContent === 'Configurações'`), 'Configurações mostra os dados do acordo');
    await foto('m11_configuracoes');
    await clicar('.tit-linha [data-a="ajuda"]'); await espera(300);
    ok(await avaliar(`document.getElementById('dlg').open && /Primeiros passos/i.test(document.getElementById('dlg-corpo').textContent)`), 'Ajuda abre no celular pela tela Configurações');
    await foto('m11b_ajuda', false);
    await clicar('#dlg [data-a="fechar"]');
    await clicar('[data-a="nav"][data-v="assinatura"]'); await espera(1500);
    ok(await avaliar(`/^000201/.test(document.getElementById('pix-codigo').value)`), 'Código Pix gerado');
    ok(await avaliar(`!!document.querySelector('#qr svg')`), 'QR Code desenhado');
    await foto('m12_assinatura');

    // Computador
    await tela(1280, 860, false);
    await clicar('[data-a="nav"][data-v="inicio"]'); await espera(300);
    ok(await transborda() <= 0, 'Início sem rolagem lateral no computador');
    const lat = await avaliar(`(()=>{const l=document.querySelector('.lateral'); const r=l.getBoundingClientRect(); return {w:r.width, x:r.left, cor:getComputedStyle(l).backgroundColor,
      on:getComputedStyle(document.querySelector('.nav-it.on')).backgroundColor, logo:getComputedStyle(document.querySelector('.lateral-marca .marca-ic')).backgroundColor,
      rot:[...document.querySelectorAll('.nav-rot')].map(e=>e.textContent).join('/'), itens:[...document.querySelectorAll('.lateral .nav-it')].filter(e=>e.getClientRects().length).map(e=>e.querySelector('.nav-t:not([hidden])').textContent).join(', ')}})()`);
    ok(lat.w === 248 && lat.x === 0 && lat.cor === 'rgb(250, 250, 250)', `Barra lateral clara de 248px (${lat.w}px, ${lat.cor})`);
    ok(lat.on === 'rgb(200, 238, 68)' && lat.logo === 'rgb(200, 238, 68)', 'Item ativo e logo em verde-limão');
    ok(lat.rot === 'Menu/Conta' && /Início, Agenda, Clientes, Créditos, Configurações, Ajuda/.test(lat.itens), `Menu e Conta na barra lateral (${lat.itens})`);
    ok(/Sair$/.test(lat.itens) && await visivel('.lateral [data-a="sair"]'), 'Sair à mão na barra lateral');
    ok(await visivel('.lateral-aviso') && /Criar conta de verdade/.test(await avaliar(`document.querySelector('.lateral-aviso').textContent`)), 'Aviso da demonstração no rodapé da barra lateral');
    ok(await avaliar(`(()=>{const t=[...document.querySelectorAll('.destaque')].map(e=>Math.round(e.getBoundingClientRect().top)); return t.length===3 && t.every(v=>v===t[0])})()`), 'Três destaques lado a lado');
    ok(await avaliar(`(()=>{const p=[...document.querySelectorAll('.paineis > .painel')].map(e=>e.getBoundingClientRect()); return p.length===2 && Math.round(p[0].top)===Math.round(p[1].top) && p[0].right < p[1].left})()`), 'Gráfico e Próximos recebimentos lado a lado');
    ok(/^(Bom dia|Boa tarde|Boa noite)/.test(await avaliar(`document.querySelector('.pag-cab .tit').textContent`)) && /\d{4} · /.test(await avaliar(`document.querySelector('.pag-sub').textContent`)), 'Saudação, data por extenso e carteira');
    await foto('d01_inicio');

    // Cobrar: um cliente só abre o WhatsApp; mais de um abre a Agenda nos atrasos
    const cobrar = await avaliar(`(()=>{const e=document.querySelector('.destaque.perigo .lnk.ruim'); return e ? {tag:e.tagName, href:e.getAttribute('href')||'', per:e.dataset.periodo||''} : null})()`);
    if (!cobrar) ok(await avaliar(`!document.querySelector('.destaque.perigo') && /Tudo em dia/.test(document.querySelectorAll('.destaque')[1].textContent)`), 'Sem atraso, o cartão fica neutro');
    else if (cobrar.tag === 'A') ok(/^https:\/\/wa\.me\/55\d{10,11}$/.test(cobrar.href), `Cobrar abre o WhatsApp do cliente (${cobrar.href})`);
    else {
      await clicar('.destaque.perigo .lnk.ruim'); await espera(300);
      ok(await avaliar(`document.querySelector('select[name=periodo]').value==='atraso' && document.querySelectorAll('.item').length>0 && [...document.querySelectorAll('.item')].every(i=>i.classList.contains('st-atrasada'))`), 'Cobrar com mais de um cliente abre a Agenda nos atrasos');
      await clicar('[data-a="nav"][data-v="inicio"]'); await espera(300);
    }
    // Ver extrato: Agenda com as recebidas no mês
    await clicar('[data-a="agenda-ir"][data-situacao="recebida"]'); await espera(300);
    ok(await avaliar(`document.querySelector('select[name=periodo]').value==='mes' && document.querySelector('select[name=situacao]').value==='recebida' && [...document.querySelectorAll('.item')].every(i=>i.classList.contains('st-recebida'))`), 'Ver extrato abre a Agenda com as recebidas no mês');
    ok(await avaliar(`[...document.querySelectorAll('.item .pill')].every(p=>p.textContent==='Pago' && p.classList.contains('verde'))`), 'Pílula "Pago" em verde');
    await foto('d02b_extrato');
    await clicar('[data-a="nav"][data-v="inicio"]'); await espera(300);
    await clicar('[data-a="rec-lista"]'); await espera(300);
    await foto('d01b_registrar_recebimento', false);
    await clicar('#rec-lista [data-a="receber"]'); await espera(300);
    ok(await avaliar(`!!document.querySelector('#dlg form[data-f="receber"]')`), 'Da lista, o botão abre o modal de receber');
    await foto('d01c_receber', false);
    await clicar('#dlg [data-a="fechar"]');
    await clicar('.lateral [data-a="ajuda"]'); await espera(300);
    ok(await avaliar(`document.getElementById('dlg').open && /Atrasos e multa/i.test(document.getElementById('dlg-corpo').textContent) && /Segurança e sigilo/.test(document.getElementById('dlg-corpo').textContent)`), 'Ajuda abre uma janela com o texto fixo, incluindo segurança e sigilo');
    await foto('d01d_ajuda', false);
    await clicar('#dlg [data-a="fechar"]');
    await clicar('[data-a="graf"][data-m="dias"]'); await espera(200);
    await foto('d01e_inicio_30dias');
    await clicar('[data-a="graf"][data-m="meses"]'); await espera(200);

    await clicar('[data-a="nav"][data-v="agenda"]'); await espera(300);
    ok(await transborda() <= 0, 'Agenda sem rolagem lateral no computador');
    await foto('d02_agenda');
    await clicar('[data-a="nav"][data-v="clientes"]'); await espera(300);
    await foto('d03_clientes');
    await clicar('[data-a="cli-ver"]'); await espera(500);
    await foto('d03b_cliente', false);
    await clicar('#dlg [data-a="fechar"]');
    await clicar('[data-a="cli-novo"]'); await espera(300);
    await foto('d04_novo_cliente', false);
    await clicar('#dlg [data-a="fechar"]');
    await clicar('[data-a="nav"][data-v="aportes"]'); await espera(300);
    await foto('d05_creditos');
    await clicar('.tit-linha [data-a="ap-novo"]'); await espera(300);
    await foto('d06_novo_credito', false);
    await clicar('#dlg [data-a="fechar"]');
    await clicar('button.item[data-a="ap-ver"]'); await espera(300);
    await foto('d07_credito_detalhe', false);
    await clicar('#dlg [data-a="acordo"]'); await espera(300);
    await foto('d07b_acordo', false);
    await clicar('#dlg [data-a="fechar"]');
    await clicar('[data-a="nav"][data-v="mais"]'); await espera(300);
    await foto('d08_configuracoes');
    await clicar('[data-a="nav"][data-v="assinatura"]'); await espera(1000);
    await foto('d09_assinatura');

    // Modo escuro: botão da barra lateral, Configurações › Aparência e o automático acompanhando o sistema
    await clicar('[data-a="nav"][data-v="inicio"]'); await espera(300);
    await clicar('.lateral [data-a="tema-alternar"]'); await espera(200);
    ok(await avaliar(`document.documentElement.dataset.tema`) === 'escuro' && await tok('--bg') === '#15171C' && await avaliar(`localStorage.credflux_tema`) === 'escuro',
      'Botão da barra lateral liga o modo escuro e guarda a escolha');
    ok(await avaliar(`getComputedStyle(document.querySelector('.nav-it.on')).color`) === 'rgb(27, 33, 45)' && await avaliar(`getComputedStyle(document.querySelector('.pag-cab .tit')).color`) === 'rgb(242, 244, 247)',
      'No escuro: texto claro e item ativo com texto escuro sobre o verde-limão');
    ok(await avaliar(`/Modo claro/.test([...document.querySelectorAll('.nav-tema .nav-t')].filter(e=>e.getClientRects().length).map(e=>e.textContent).join())`), 'No escuro, o botão oferece o modo claro');
    await foto('d10_inicio_escuro');
    await clicar('[data-a="nav"][data-v="agenda"]'); await espera(300);
    await foto('d11_agenda_escuro');
    await clicar('[data-a="nav"][data-v="clientes"]'); await espera(300);
    await clicar('[data-a="cli-ver"]'); await espera(500);
    await foto('d12_cliente_escuro', false);
    await clicar('#dlg [data-a="fechar"]');
    await clicar('[data-a="nav"][data-v="mais"]'); await espera(300);
    await clicar('[data-a="tema"][data-t="auto"]'); await espera(200);
    ok(await avaliar(`document.documentElement.dataset.tema`) === 'claro' && await avaliar(`localStorage.credflux_tema`) === 'auto' && await avaliar(`document.querySelector('[data-a="tema"][data-t="auto"]').classList.contains('on')`),
      'Automático com o sistema claro volta ao tema claro');
    await esquema('dark'); await espera(300);
    ok(await avaliar(`document.documentElement.dataset.tema`) === 'escuro', 'Automático acompanha o sistema quando ele muda para escuro');
    await foto('d13_configuracoes_escuro');
    await tela(375, 812, true);
    await clicar('[data-a="nav"][data-v="inicio"]'); await espera(300);
    ok(await transborda() <= 0, 'Início escuro sem rolagem lateral no celular');
    await foto('m14_inicio_escuro');
    await clicar('[data-a="rec-lista"]'); await espera(300);
    await foto('m15_registrar_escuro', false);
    await clicar('#dlg [data-a="fechar"]');
    await esquema('light'); await espera(300);
    ok(await avaliar(`document.documentElement.dataset.tema`) === 'claro', 'Sistema de volta ao claro, tema claro');

    // Novo cliente no celular
    await tela(375, 812, true);
    await clicar('[data-a="nav"][data-v="clientes"]'); await espera(300);
    await clicar('[data-a="cli-novo"]'); await espera(300);
    await foto('m13_novo_cliente', false);
    await clicar('#dlg [data-a="fechar"]');

    // Sair no topo de Configurações (celular): na demonstração, volta à tela inicial
    await clicar('[data-a="nav"][data-v="mais"]'); await espera(300);
    ok(await visivel('.tit-linha [data-a="sair"]'), 'Sair no topo de Configurações no celular');
    await foto('m16_configuracoes_sair', false);
    await clicar('.tit-linha [data-a="sair"]'); await espera(2500);
    ok(await avaliar(`!!document.querySelector('form[data-f="acesso"]') && !localStorage.credflux_demo_v2`), 'Sair encerra a demonstração e volta à tela de acesso');

    // Tela inicial (acesso), celular e computador
    await cdp('Page.navigate', { url: BASE }); await espera(2500);
    ok(await avaliar(`!!document.querySelector('form[data-f="acesso"]')`), 'Tela inicial com o formulário de acesso');
    ok(await transborda() <= 0, 'Tela inicial sem rolagem lateral no celular');
    await foto('m00_tela_inicial');
    await tela(1280, 860, false);
    await cdp('Page.navigate', { url: BASE }); await espera(2500);
    ok(await avaliar(`(()=>{const m=document.querySelector('.ac-marca').getBoundingClientRect(), f=document.querySelector('.ac-lado').getBoundingClientRect();
      return /gradient/.test(getComputedStyle(document.querySelector('.ac'),'::before').backgroundImage) && getComputedStyle(document.querySelector('.ac-marca h1')).color==='rgb(255, 255, 255)' && m.left===0 && m.right<=f.left && Math.round(m.top)===Math.round(f.top)})()`), 'Login em duas colunas com o painel escuro à esquerda');
    ok(await avaliar(`[...document.querySelectorAll('.ac-ic')].every(i=>getComputedStyle(i).color==='rgb(27, 33, 45)' && getComputedStyle(i.querySelector('svg')).strokeWidth==='2px')`),
      'Ícones do login escuros e mais grossos sobre o verde-limão');
    ok(await visivel('.ac-selo') && /protegidos por criptografia, com segurança, discrição e total sigilo/.test(await avaliar(`document.querySelector('.ac-selo').textContent`)) && await avaliar(`document.querySelectorAll('.ac-lista li').length`) === 4,
      'Faixa de segurança e sigilo abaixo da descrição, com os quatro cartões');
    await foto('d00_tela_inicial');
    await esquema('dark');
    await cdp('Page.navigate', { url: BASE }); await espera(2500);
    ok(await avaliar(`document.documentElement.dataset.tema`) === 'escuro' && await avaliar(`getComputedStyle(document.querySelector('.ac-lado')).backgroundColor`) === 'rgb(29, 32, 38)',
      'Login no tema escuro quando o sistema está escuro');
    await foto('d00b_tela_inicial_escuro');
    await tela(375, 812, true);
    await cdp('Page.navigate', { url: BASE }); await espera(2500);
    await foto('m00b_tela_inicial_escuro');
  } catch (e) {
    verif.push('FALHA ' + e.message);
  } finally {
    ok(erros.length === 0, 'Sem erros no console' + (erros.length ? ': ' + erros.join(' | ') : ''));
    console.log(verif.join('\n'));
    console.log('Fotos em', SAIDA);
    ws.close(); chrome.kill();
    process.exit(verif.some(v => v.startsWith('FALHA')) ? 1 : 0);
  }
})();
