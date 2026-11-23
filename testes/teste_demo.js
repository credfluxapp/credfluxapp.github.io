// Teste da demonstração no Chrome sem interface (DevTools Protocol, sem instalar nada).
// Uso: sirva a pasta (python -m http.server 8765) e rode: node testes/teste_demo.js <pasta_saida>
// Também gera icon-192.png e icon-512.png a partir de icon.svg (com --icones).
const { spawn, spawnSync } = require('child_process');
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
      // ícone pequeno da barra de notificações do Android: branco sobre fundo transparente
      await tela(96, 96, false);
      await cdp('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
      await cdp('Page.navigate', { url: BASE + 'img/badge.svg' }); await espera(500);
      const rb = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 96, height: 96, scale: 1 } });
      fs.writeFileSync(path.join(raiz, 'badge-96.png'), Buffer.from(rb.data, 'base64'));
      await cdp('Emulation.setDefaultBackgroundColorOverride', {});
    }

    // Celular
    await tela(375, 812, true);
    await cdp('Page.navigate', { url: BASE + '?demo' }); await espera(1500);
    // Resumo do dia ao abrir: a demonstração sempre tem uma parcela em atraso
    const resumo = await avaliar(`(()=>{const d=document.getElementById('dlg'); return {aberto:d.open, tit:d.querySelector('.dlg-cab h2')?.textContent, hoje:!!d.querySelector('.rd-cab'), atraso:!!d.querySelector('.rd-atraso'), marca:!!document.querySelector('[data-in="resumo-abrir"]:checked')}})()`);
    // depois das 18h (HORA_NOITE), com parcela amanhã e nada hoje, ele abre por "Vencimentos de amanhã" e mantém hoje e os atrasos
    const titResumo = new Date().getHours() >= 18 ? ['Resumo do dia', 'Vencimentos de amanhã'] : ['Resumo do dia'];
    ok(resumo.aberto && titResumo.includes(resumo.tit) && resumo.hoje && resumo.atraso && resumo.marca, `Resumo do dia abre ao entrar, com hoje e os atrasos (${resumo.tit})`);
    await foto('m00r_resumo_dia', false);
    await clicar('#dlg [data-a="fechar"]');
    ok(await avaliar(`/^\\d{4}-\\d{2}-\\d{2}:(dia|noite)$/.test(localStorage.credflux_resumo_visto_demo || '')`), 'O resumo fica marcado como visto nesta parte do dia');
    ok(await avaliar(`navigator.serviceWorker.getRegistration().then(r=>!!r && /sw\\.js$/.test((r.active||r.installing||r.waiting).scriptURL))`), 'Receptor de notificações (sw.js) registrado');
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

    // Recibo em um clique: a mensagem do recebimento traz "Emitir recibo" e o PDF sai na hora
    ok(await avaliar(`document.querySelector('#toasts .toast-acao')?.textContent`) === 'Emitir recibo', 'Depois de receber, a mensagem oferece "Emitir recibo"');
    await foto('m05a_recebido_recibo', false);
    await avaliar(`(()=>{window.__pdfs=[]; const o=HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click=function(){ if(this.download && /\\.pdf$/.test(this.download)){ const nome=this.download;
        fetch(this.href).then(r=>r.blob()).then(b=>new Promise(ok=>{const f=new FileReader(); f.onload=()=>ok(f.result); f.readAsDataURL(b);}))
          .then(u=>window.__pdfs.push({nome, url:u})); return; } return o.call(this); };})()`);
    await clicar('#toasts .toast-acao'); await espera(4000);
    const rec = await avaliar(`window.__pdfs.find(p=>/^recibo_/.test(p.nome)) || null`);
    ok(rec && /^recibo_.+_parcela\d+\.pdf$/.test(rec.nome) && rec.url.length > 4000, `Recibo em PDF gerado (${rec?.nome})`);
    if (rec) fs.writeFileSync(path.join(SAIDA, 'recibo.pdf'), Buffer.from(rec.url.split(',')[1], 'base64'));

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
    // Ordem por vencimento: o vencimento em aberto mais antigo primeiro (atrasados no topo), sem parcela no fim
    await clicar('[data-a="ordem-cli"][data-o="venc"]'); await espera(200);
    const ordem = await avaliar(`(()=>{const d=JSON.parse(localStorage.credflux_demo_v2); const ap=new Map(d.aportes.map(a=>[a.id,a])); const prox=new Map();
      for (const p of d.parcelas) { if (p.recebido_em) continue; const c=ap.get(p.aporte_id)?.cliente_id; if (!prox.has(c) || p.vencimento < prox.get(c)) prox.set(c, p.vencimento); }
      const esperado=d.clientes.slice().sort((a,b)=>(prox.get(a.id)||'9999').localeCompare(prox.get(b.id)||'9999') || a.nome.localeCompare(b.nome,'pt-BR')).map(c=>c.nome);
      const tela=[...document.querySelectorAll('#lista-cli .item .item-tit')].map(e=>e.textContent);
      return {igual: JSON.stringify(esperado)===JSON.stringify(tela), tela, guardado: localStorage.credflux_ordem_clientes, on: document.querySelector('[data-a="ordem-cli"].on')?.dataset.o}})()`);
    ok(ordem.igual && ordem.guardado === 'venc' && ordem.on === 'venc', `Clientes por vencimento (${ordem.tela.join(', ')})`);
    ok(await avaliar(`[...document.querySelectorAll('#lista-cli .item .pill')].every(p=>/em atraso$|^Vence hoje$|^Próx\\. \\d{2}\\/\\d{2}$|^Quitado$|^Sem crédito$/.test(p.textContent))`), 'Pílula com o atraso ou o próximo vencimento de cada cliente');
    ok(await transborda() <= 0, 'Clientes com a ordem sem rolagem lateral no celular');
    await foto('m06b_clientes_vencimento');
    await clicar('[data-a="ordem-cli"][data-o="valor"]'); await espera(200);
    ok(await avaliar(`(()=>{const v=[...document.querySelectorAll('#lista-cli .item .item-val b')].map(b=>Number(b.textContent.replace(/[^\\d,]/g,'').replace(',','.'))); return v.every((x,i)=>!i || v[i-1]>=x)})()`), 'Clientes pelo maior valor a receber');
    await clicar('[data-a="ordem-cli"][data-o="nome"]'); await espera(200);
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

    // Créditos: filtro pelo vencimento das parcelas (hoje, semanas de domingo a sábado, quinzenas, meses, ano e datas escolhidas)
    const isoT = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const hT = new Date(); hT.setHours(12, 0, 0, 0); const hojeT = isoT(hT);
    const diasT = (s, k) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + k); return isoT(d); };
    const iniMesT = k => isoT(new Date(hT.getFullYear(), hT.getMonth() + k, 1)); const fimMesK = k => isoT(new Date(hT.getFullYear(), hT.getMonth() + k + 1, 0));
    const domT = diasT(hojeT, -hT.getDay()); const fimMesT = fimMesK(0);
    const faixasT = { hoje: [hojeT, hojeT], semana: [domT, diasT(domT, 6)], proxsem: [diasT(domT, 7), diasT(domT, 13)], semant: [diasT(domT, -7), diasT(domT, -1)],
      q1: [iniMesT(0), hojeT.slice(0, 8) + '15'], q2: [hojeT.slice(0, 8) + '16', fimMesT], mes: [iniMesT(0), fimMesT],
      proxmes: [iniMesT(1), fimMesK(1)], mesant: [iniMesT(-1), fimMesK(-1)], ano: [hojeT.slice(0, 4) + '-01-01', hojeT.slice(0, 4) + '-12-31'] };
    const proxT = faixasT.proxsem;
    const curtaT = s => s.slice(8) + '/' + s.slice(5, 7);
    const faixaT = ([de, ate]) => (de.slice(0, 7) === ate.slice(0, 7) ? `${+de.slice(8)} a ${curtaT(ate)}` : `${curtaT(de)} a ${curtaT(ate)}`);
    const mudarEm = (form, nome, v) => avaliar(`(()=>{const e=document.querySelector('form[data-f="${form}"] [name=${nome}]'); e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('change',{bubbles:true})); return e.value})()`);
    const opcData = await avaliar(`[...document.querySelectorAll('form[data-f="aportes"] select[name=data] option')].map(o=>[o.value,o.textContent])`);
    const rotT = Object.fromEntries(opcData); const mmT = hojeT.slice(5, 7);
    const rotSelT = await avaliar(`document.querySelector('form[data-f="aportes"] select[name=data]').closest('label').firstChild.textContent.trim()`);
    ok(opcData.length === 12 && rotSelT === 'Vencimento das parcelas' && await avaliar(`document.querySelector('form[data-f="aportes"] select[name=data]').value`) === 'tudo', `Créditos: filtro "${rotSelT}" começa em Todas as datas (${opcData.length} opções)`);
    ok(rotT.q1 === `1ª quinzena (1 a 15/${mmT})` && rotT.q2 === `2ª quinzena (16 a ${fimMesT.slice(8)}/${mmT})`, `Quinzenas do mês corrente com as datas (${rotT.q1}; ${rotT.q2})`);
    ok(rotT.semana === `Esta semana (${faixaT(faixasT.semana)})` && rotT.proxsem === `Próxima semana (${faixaT(proxT)})` && rotT.semant === `Semana passada (${faixaT(faixasT.semant)})` && rotT.hoje === `Hoje (${curtaT(hojeT)})`, `Semana de domingo a sábado (${rotT.semana}; ${rotT.proxsem}; ${rotT.semant})`);
    await mudarEm('aportes', 'status', 'todos'); await espera(200);
    // só a tela de Créditos: a janela fechada guarda o último conteúdo (com outros totais), e ele fica de fora
    const telaT = () => avaliar(`(()=>{const fora=s=>[...document.querySelectorAll(s)].filter(e=>!e.closest('dialog')); return {ids:fora('button.item[data-a="ap-ver"]').map(b=>b.dataset.id),
      valores:fora('button.item[data-a="ap-ver"] .item-val b').map(e=>Number(e.textContent.replace(/[^0-9]/g,''))),
      pills:fora('button.item[data-a="ap-ver"] .item-val .pill').map(e=>e.textContent),
      kpiRot:fora('.mini-kpis span').map(e=>e.textContent),
      kpis:fora('.mini-kpis b').map(e=>Number(e.textContent.replace(/[^0-9]/g,'')))}})()`);
    const nTudo = (await telaT()).ids.length;
    const dadosT = await avaliar(`(()=>{const d=JSON.parse(localStorage.credflux_demo_v2); return {aps:d.aportes.map(a=>[a.id, a.cliente_id]), cli:Object.fromEntries(d.clientes.map(c=>[c.id,c.nome])),
      ps:d.parcelas.map(p=>({ap:p.aporte_id, num:p.num, v:p.vencimento, valor:Number(p.valor), rec:p.recebido_em||null, vr:Number(p.valor_recebido||0)}))}})()`);
    const centT = x => Math.round(x * 100);
    // o esperado, calculado aqui com os dados guardados: créditos com parcela no período, na ordem do primeiro vencimento
    // (e do nome), o que falta receber e a etiqueta de cada linha, e os totais do período
    const esperadoT = (de, ate) => {
      const linhas = dadosT.aps.map(([id, cli]) => ({ id, nome: dadosT.cli[cli] || '', pp: dadosT.ps.filter(p => p.ap === id && p.v >= de && p.v <= ate).sort((x, y) => x.v.localeCompare(y.v) || x.num - y.num) }))
        .filter(l => l.pp.length).sort((x, y) => x.pp[0].v.localeCompare(y.pp[0].v) || x.nome.localeCompare(y.nome, 'pt-BR'));
      for (const l of linhas) {
        const ab = l.pp.filter(p => !p.rec); const p1 = ab[0]; const mais = ab.length > 1 ? ` e mais ${ab.length - 1}` : '';
        l.valor = centT(p1 ? ab.reduce((s, p) => s + p.valor, 0) : l.pp.reduce((s, p) => s + p.vr, 0));
        l.pill = !p1 ? (l.pp.length > 1 ? 'Recebidas' : 'Recebida') : p1.v < hojeT ? `venceu ${curtaT(p1.v)}${mais}` : p1.v === hojeT ? `Vence hoje${mais}` : `vence ${curtaT(p1.v)}${mais}`;
      }
      const pps = linhas.flatMap(l => l.pp); const ab = pps.filter(p => !p.rec);
      const kpis = [pps.reduce((s, p) => s + (p.rec ? p.vr : p.valor), 0), pps.filter(p => p.rec).reduce((s, p) => s + p.vr, 0),
        ab.reduce((s, p) => s + p.valor, 0), ab.filter(p => p.v < hojeT).reduce((s, p) => s + p.valor, 0)].map(centT);
      return { ids: linhas.map(l => l.id), valores: linhas.map(l => l.valor), pills: linhas.map(l => l.pill), kpis };
    };
    const resT = {}; let certosT = true; const pillsVistas = new Set();
    for (const [k, [de, ate]] of Object.entries(faixasT)) {
      await mudarEm('aportes', 'data', k); await espera(150);
      const t = await telaT(); const e = esperadoT(de, ate);
      const igual = ['ids', 'valores', 'pills', 'kpis'].every(c => JSON.stringify(t[c]) === JSON.stringify(e[c])) && t.kpiRot.join('|') === 'Vence no período|Já recebido|A receber|Em atraso';
      t.pills.forEach(p => pillsVistas.add(p.split(' ')[0]));
      resT[k] = igual ? t.ids.length : `difere: tela ${JSON.stringify(t)} × esperado ${JSON.stringify(e)}`;
      if (!igual) certosT = false;
    }
    ok(certosT && nTudo === dadosT.aps.length && Object.values(resT).some(n => n > 0 && n < nTudo), `Créditos pelo vencimento: lista, ordem, valor e etiqueta de cada linha e totais do período (todas: ${nTudo}; ${JSON.stringify(resT)})`);
    ok(['venceu', 'vence'].every(p => pillsVistas.has(p)), `Etiquetas do período testadas: ${[...pillsVistas].join(', ')}`);
    await mudarEm('aportes', 'data', 'tudo'); await espera(150);
    ok((await telaT()).kpiRot.join('|') === 'Concedido|Já recebido|A receber|Lucro previsto', 'Sem período, os totais voltam a ser dos créditos (Concedido e Lucro previsto)');
    await mudarEm('aportes', 'data', 'custom'); await espera(150);
    const deAteT = await avaliar(`!!document.querySelector('form[data-f="aportes"] input[name=de]') && !!document.querySelector('form[data-f="aportes"] input[name=ate]')`);
    await mudarEm('aportes', 'de', faixasT.q2[0]); await espera(150); await mudarEm('aportes', 'ate', faixasT.q2[1]); await espera(150);
    const tcT = await telaT();
    ok(deAteT && JSON.stringify(tcT.ids) === JSON.stringify(esperadoT(...faixasT.q2).ids), `Escolher datas filtra pelo vencimento (${tcT.ids.length} créditos de ${curtaT(faixasT.q2[0])} a ${curtaT(faixasT.q2[1])})`);
    const largT = await avaliar(`(()=>{const f=document.querySelector('form[data-f="aportes"]').getBoundingClientRect().width; const l=document.querySelector('form[data-f="aportes"] label.largo').getBoundingClientRect().width; return [Math.round(f), Math.round(l)]})()`);
    ok(largT[0] === largT[1] && await transborda() <= 0, `No celular, "Vencimento das parcelas" ocupa a largura toda (${largT[1]} de ${largT[0]}px), sem rolagem lateral`);
    await mudarEm('aportes', 'status', 'ativos'); await mudarEm('aportes', 'data', 'q2'); await espera(200);
    await foto('m10c_creditos_quinzena');
    await mudarEm('aportes', 'data', 'tudo'); await espera(150);

    // Agenda: semana e quinzenas também no Período, pelo vencimento
    await clicar('[data-a="nav"][data-v="agenda"]'); await espera(300);
    const agAntesT = await avaliar(`['periodo','situacao'].map(n=>document.querySelector('form[data-f="agenda"] [name='+n+']').value)`);
    const rotAgT = await avaliar(`Object.fromEntries([...document.querySelectorAll('form[data-f="agenda"] select[name=periodo] option')].map(o=>[o.value,o.textContent]))`);
    ok(rotAgT.q1 === rotT.q1 && rotAgT.q2 === rotT.q2 && rotAgT.semana === rotT.semana && rotAgT.proxsem === `Próxima semana (${faixaT(proxT)})`, `Agenda com semana e quinzenas no Período (${rotAgT.proxsem})`);
    await mudarEm('agenda', 'situacao', 'todas'); await espera(150);
    const vencT = await avaliar(`JSON.parse(localStorage.credflux_demo_v2).parcelas.map(p=>p.vencimento)`);
    const contAgT = {}; let certosAgT = true;
    for (const [k, [de, ate]] of [['semana', faixasT.semana], ['proxsem', proxT], ['q1', faixasT.q1], ['q2', faixasT.q2]]) {
      await mudarEm('agenda', 'periodo', k); await espera(150);
      const n = await avaliar(`document.querySelectorAll('.grupo .item').length`); const esperado = vencT.filter(v => v >= de && v <= ate).length;
      contAgT[k] = n === esperado ? n : `${n} (esperado ${esperado})`; if (n !== esperado) certosAgT = false;
    }
    ok(certosAgT && Object.values(contAgT).some(n => n > 0), `Agenda filtra a semana e as quinzenas pelo vencimento (${JSON.stringify(contAgT)})`);
    await mudarEm('agenda', 'periodo', agAntesT[0]); await mudarEm('agenda', 'situacao', agAntesT[1]); await espera(150);

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
    ok(await avaliar(`(()=>{const ls=[...document.querySelectorAll('.item.st-recebida')]; return ls.length>0 && ls.every(l=>l.querySelector('[data-a="recibo"]'))})()`), 'Cada parcela recebida tem o botão Recibo');
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

    // Toque na notificação das 21h: o aplicativo abre direto nos vencimentos de amanhã
    await cdp('Page.navigate', { url: BASE + '?demo&aviso=amanha' }); await espera(1500);
    const am = await avaliar(`(()=>{const d=document.getElementById('dlg'); return {aberto:d.open, tit:d.querySelector('.dlg-cab h2')?.textContent, busca:location.search,
      lembrar:[...d.querySelectorAll('a[href*="wa.me"]')].map(a=>a.href), n:d.querySelectorAll('.resumo-dia .item').length}})()`);
    ok(am.aberto && am.tit === 'Vencimentos de amanhã' && am.busca === '?demo', `Notificação da noite abre os vencimentos de amanhã (${am.n} linhas)`);
    ok(am.lembrar.every(u => /^https:\/\/wa\.me\/55\d{10,11}\?text=Ol%C3%A1/.test(u)), `Lembrete pelo WhatsApp para quem paga amanhã (${am.lembrar.length})`);
    await foto('d01f_resumo_amanha', false);
    await clicar('#dlg [data-a="fechar"]');

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

    // Alterar senha (na demonstração, só a tela e as conferências)
    await clicar('.painel [data-a="senha"]'); await espera(300);
    ok(await avaliar(`(()=>{const f=document.querySelector('#dlg form[data-f="senha"]'); return !!f && f.querySelector('[name=atual]').autocomplete==='current-password' && f.querySelectorAll('[autocomplete="new-password"]').length===2})()`),
      'Alterar senha: a atual e a nova duas vezes');
    await avaliar(`(()=>{const f=document.querySelector('#dlg form[data-f="senha"]'); f.atual.value='velha123'; f.nova.value='nova12345'; f.nova2.value='outra12345'; f.requestSubmit();})()`); await espera(300);
    ok(await avaliar(`(()=>{const t=document.querySelector('#dlg-toasts .toast.erro'); return document.getElementById('dlg').open && !!t && /não são iguais/.test(t.textContent) && t.getClientRects().length > 0})()`),
      'Senhas novas diferentes: avisa por cima da janela e não grava');
    await foto('d08b_alterar_senha', false);
    await avaliar(`(()=>{const f=document.querySelector('#dlg form[data-f="senha"]'); f.nova2.value='nova12345'; f.requestSubmit();})()`); await espera(400);
    ok(await avaliar(`!document.getElementById('dlg').open && /senha não muda de verdade/.test(document.getElementById('toasts').textContent)`), 'Senha nova conferida e gravada (na demonstração, só a mensagem)');

    // Notificações no celular: os horários, a opção de esconder nomes e o exemplo da demonstração
    ok(await avaliar(`(()=>{const p=document.getElementById('painel-avisos'); return !!p && /9h/.test(p.textContent) && /21h/.test(p.textContent) && !!p.querySelector('[data-a="avisos-exemplo"]') && !!p.querySelector('[name=detalhes]:checked')})()`),
      'Painel de notificações com 9h e 21h e o exemplo');
    // o Chrome sem tela não guarda notificações: o teste registra o que o aplicativo manda mostrar
    await cdp('Browser.grantPermissions', { permissions: ['notifications'], origin: new URL(BASE).origin });
    await avaliar(`(()=>{window.__notifs=[]; const o=ServiceWorkerRegistration.prototype.showNotification;
      ServiceWorkerRegistration.prototype.showNotification=function(t,op){ window.__notifs.push(t+' | '+(op&&op.body||'')+' | '+(op&&op.badge||'')); return o.call(this,t,op); };})()`);
    await clicar('[data-a="avisos-exemplo"]'); await espera(1500);
    const notif = await avaliar(`window.__notifs`);
    ok(notif.length === 1 && /^(Hoje: |Parcelas em atraso|Vencimentos de hoje)/.test(notif[0]) && /badge-96\.png$/.test(notif[0]) && /Exemplo enviado/.test(await avaliar(`document.getElementById('toasts').textContent`)),
      `Notificação de exemplo mostrada no aparelho (${notif[0] || 'nenhuma'})`);

    // Backup em planilha: uma aba de resumo e uma por cliente (conferida por dentro com o teste_planilha.py)
    await avaliar(`(()=>{window.__arqs=[]; const o=HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click=function(){ if(this.download && /\\.xlsx$/.test(this.download)){ const nome=this.download;
        fetch(this.href).then(r=>r.blob()).then(b=>new Promise(ok=>{const f=new FileReader(); f.onload=()=>ok(f.result); f.readAsDataURL(b);}))
          .then(u=>window.__arqs.push({nome, url:u})); return; } return o.call(this); };})()`);
    await clicar('[data-a="backup-xlsx"]');
    let planilha = null;
    for (let i = 0; i < 40 && !planilha; i++) { await espera(500); planilha = await avaliar(`window.__arqs.find(a=>/\\.xlsx$/.test(a.nome)) || null`); }
    ok(planilha && /^CredFlux_backup_\d{4}-\d{2}-\d{2}\.xlsx$/.test(planilha.nome) && planilha.url.length > 8000, `Backup em planilha gerado (${planilha?.nome})`);
    if (planilha) {
      const arq = path.join(SAIDA, 'backup.xlsx');
      fs.writeFileSync(arq, Buffer.from(planilha.url.split(',')[1], 'base64'));
      const py = spawnSync('python', [path.join(__dirname, 'teste_planilha.py'), arq], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      for (const l of (py.stdout || '').trim().split(/\r?\n/).filter(Boolean)) verif.push(l);
      if (py.status !== 0 && !/FALHA/.test(py.stdout || '')) verif.push('FALHA Conferência da planilha: ' + String(py.stderr || py.error?.message || '').slice(0, 400));
    }

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
    await clicar('.tit-linha [data-a="sair"]');
    let saiu = false;
    for (let i = 0; i < 24 && !saiu; i++) { await espera(500); saiu = await avaliar(`!!document.querySelector('form[data-f="acesso"]') && !localStorage.credflux_demo_v2`).catch(() => false); }
    ok(saiu, 'Sair encerra a demonstração e volta à tela de acesso');

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
    // Confirmação do cadastro pelo código do e-mail (só a tela; nada é enviado ao Supabase)
    await clicar('[data-a="acesso"][data-m="confirmar"]'); await espera(300);
    ok(await avaliar(`(()=>{const c=document.querySelector('form[data-f="confirmar"] input.codigo'); return !!c && c.autocomplete==='one-time-code' && c.inputMode==='numeric' && !!document.querySelector('[data-a="reenviar-codigo"]') && /credfluxapp@gmail\\.com/.test(document.querySelector('.cartao').textContent)})()`),
      'Tela "Confirme seu e-mail" com o campo do código e o reenvio');
    await foto('d00c_confirmar_email');
    // Esqueci a senha: código no e-mail e a senha nova criada no próprio CredFlux (só a tela; nada vai ao Supabase)
    await clicar('[data-a="acesso"][data-m="esqueci"]'); await espera(300);
    ok(await avaliar(`document.querySelector('form[data-f="acesso"] button.pri')?.textContent === 'Enviar código' && /código de 6 dígitos/.test(document.querySelector('.ac-lado .cartao').textContent)`),
      'Esqueci a senha manda um código, sem link');
    await clicar('[data-a="acesso"][data-m="redefinir"]'); await espera(300);
    ok(await avaliar(`(()=>{const f=document.querySelector('form[data-f="redefinir"]'); return !!f && f.querySelector('input.codigo')?.autocomplete==='one-time-code' && f.querySelectorAll('input[type=password][autocomplete="new-password"]').length===2
      && !!document.querySelector('[data-a="reenviar-codigo"][data-tipo="senha"]') && /credfluxapp@gmail\\.com/.test(document.querySelector('.ac-lado .cartao').textContent) && /Criar acesso/.test(document.querySelector('.ac-lado .cartao').textContent)})()`),
      'Tela "Criar nova senha" com o código, a senha nova repetida, o reenvio e o aviso para quem foi convidado');
    await foto('d00d_criar_nova_senha');
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
