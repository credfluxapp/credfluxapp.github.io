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
async function foto(nome, cheia = true) {
  let clip;
  if (cheia) {
    const m = await cdp('Page.getLayoutMetrics');
    clip = { x: 0, y: 0, width: m.cssContentSize.width, height: Math.min(m.cssContentSize.height, 6000), scale: 1 };
  }
  const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: cheia, ...(clip ? { clip } : {}) });
  fs.writeFileSync(path.join(SAIDA, nome + '.png'), Buffer.from(r.data, 'base64'));
}
async function tela(larg, alt, movel) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: larg, height: alt, deviceScaleFactor: 1, mobile: movel });
}
const clicar = sel => avaliar(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) throw new Error('não achei ${sel.replace(/'/g, '')}'); e.click(); return true})()`);
const transborda = () => avaliar(`document.documentElement.scrollWidth - innerWidth`);

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
    ok(await avaliar(`!!document.querySelector('.kpis')`), 'Início carregou com os indicadores');
    ok(await transborda() <= 0, 'Início sem rolagem lateral no celular');
    await foto('m01_inicio');

    await clicar('[data-a="graf"][data-m="dias"]'); await espera(200);
    await foto('m02_inicio_30dias');

    await clicar('[data-a="nav"][data-v="agenda"]'); await espera(300);
    ok(await avaliar(`document.querySelectorAll('.grupo').length > 0`), 'Agenda lista grupos de 30 dias');
    ok(await transborda() <= 0, 'Agenda sem rolagem lateral');
    await foto('m03_agenda');

    await avaliar(`(()=>{const s=document.querySelector('select[name=agrupar]'); s.value='mes'; s.dispatchEvent(new Event('change',{bubbles:true}));
      const p=document.querySelector('select[name=periodo]'); p.value='p365'; p.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await espera(300);
    ok(await avaliar(`document.querySelector('select[name=periodo]').value==='p365' && document.querySelectorAll('.grupo').length > 3`), 'Agenda de 12 meses por mês');
    await foto('m04_agenda_meses');

    // Receber a primeira parcela da agenda
    const antes = await avaliar(`JSON.parse(localStorage.aportes_demo_v1).parcelas.filter(p=>p.recebido_em).length`);
    await clicar('[data-a="receber"]'); await espera(200);
    await foto('m05_receber', false);
    await avaliar(`document.querySelector('form[data-f="receber"]').requestSubmit()`); await espera(500);
    const depois = await avaliar(`JSON.parse(localStorage.aportes_demo_v1).parcelas.filter(p=>p.recebido_em).length`);
    ok(depois === antes + 1, `Recebimento registrado (${antes} -> ${depois})`);

    await clicar('[data-a="nav"][data-v="clientes"]'); await espera(300);
    ok(await transborda() <= 0, 'Clientes sem rolagem lateral');
    await foto('m06_clientes');
    await clicar('[data-a="cli-ver"]'); await espera(300);
    await foto('m07_cliente', false);
    await clicar('#dlg [data-a="fechar"]');

    // Novo aporte
    await clicar('[data-a="nav"][data-v="aportes"]'); await espera(300);
    await foto('m08_aportes');
    const nAp = await avaliar(`JSON.parse(localStorage.aportes_demo_v1).aportes.length`);
    await clicar('.tit-linha [data-a="ap-novo"]'); await espera(300);
    await avaliar(`(()=>{const f=document.getElementById('f-aporte');
      const set=(n,v,ev='input')=>{const e=f.elements[n]; e.value=v; e.dispatchEvent(new Event(ev,{bubbles:true}));};
      set('cliente_id', f.elements.cliente_id.options[1].value, 'change');
      set('valor','20.000,00'); set('taxa','3'); set('modalidade','price','change'); set('n_parcelas','6');})()`);
    await espera(300);
    const prev = await avaliar(`[document.querySelectorAll('.parc-lin').length, document.querySelector('.previa-cab b').textContent]`);
    ok(prev[0] === 6, `Prévia com 6 parcelas (${prev[0]}), total ${prev[1]}`);
    ok(/22\.15[0-9],/.test(prev[1].replace(/\s/g, '')), `Total Price 20.000 a 3% em 6x ~ R$ 22.152 (${prev[1]})`);
    await foto('m09_novo_aporte', false);
    await avaliar(`document.getElementById('f-aporte').requestSubmit()`); await espera(500);
    ok(await avaliar(`JSON.parse(localStorage.aportes_demo_v1).aportes.length`) === nAp + 1, 'Aporte gravado');
    await foto('m10_aporte_detalhe', false);
    await clicar('#dlg [data-a="fechar"]');

    await clicar('[data-a="nav"][data-v="mais"]'); await espera(300);
    await foto('m11_mais');
    await clicar('[data-a="nav"][data-v="assinatura"]'); await espera(1500);
    ok(await avaliar(`/^000201/.test(document.getElementById('pix-codigo').value)`), 'Código Pix gerado');
    ok(await avaliar(`!!document.querySelector('#qr svg')`), 'QR Code desenhado');
    await foto('m12_assinatura');

    // Computador
    await tela(1280, 860, false);
    await clicar('[data-a="nav"][data-v="inicio"]'); await espera(300);
    ok(await transborda() <= 0, 'Início sem rolagem lateral no computador');
    await foto('d01_inicio');
    await clicar('[data-a="nav"][data-v="agenda"]'); await espera(300);
    ok(await transborda() <= 0, 'Agenda sem rolagem lateral no computador');
    await foto('d02_agenda');
    await clicar('[data-a="nav"][data-v="clientes"]'); await espera(300);
    await foto('d03_clientes');
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
    await clicar('#dlg [data-a="fechar"]');
    await clicar('[data-a="nav"][data-v="mais"]'); await espera(300);
    await foto('d08_mais');
    await clicar('[data-a="nav"][data-v="assinatura"]'); await espera(1000);
    await foto('d09_assinatura');

    // Novo cliente no celular
    await tela(375, 812, true);
    await clicar('[data-a="nav"][data-v="clientes"]'); await espera(300);
    await clicar('[data-a="cli-novo"]'); await espera(300);
    await foto('m13_novo_cliente', false);
    await clicar('#dlg [data-a="fechar"]');

    // Tela inicial (acesso), celular e computador
    await cdp('Page.navigate', { url: BASE }); await espera(2500);
    ok(await avaliar(`!!document.querySelector('form[data-f="acesso"]')`), 'Tela inicial com o formulário de acesso');
    ok(await transborda() <= 0, 'Tela inicial sem rolagem lateral no celular');
    await foto('m00_tela_inicial');
    await tela(1280, 860, false);
    await cdp('Page.navigate', { url: BASE }); await espera(2500);
    await foto('d00_tela_inicial');
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
