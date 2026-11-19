// Backup da carteira em planilha do Excel (.xlsx): uma aba de resumo e uma aba para cada cliente.
// O ExcelJS vem do CDN só quando a pessoa pede a planilha, com conferência de integridade do arquivo.
const EXCELJS = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
const INTEGRIDADE = 'sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz';

let carregando = null;
export function prepararPlanilha() {
  if (globalThis.ExcelJS) return Promise.resolve(globalThis.ExcelJS);
  if (!carregando) {
    carregando = new Promise((ok, falha) => {
      const s = document.createElement('script');
      s.src = EXCELJS; s.integrity = INTEGRIDADE; s.crossOrigin = 'anonymous';
      s.onload = () => ok(globalThis.ExcelJS);
      s.onerror = () => { carregando = null; s.remove(); falha(new Error('Não foi possível carregar o gerador de planilhas. Confira a internet.')); };
      document.head.appendChild(s);
    });
  }
  return carregando;
}

// Cores da marca (ARGB) e formatos -------------------------------------------------------
const COR = {
  tinta: 'FF1B212D', suave: 'FF646F82', limao: 'FFC8EE44', branco: 'FFFFFFFF', linha: 'FFE4E7EC', divisa: 'FFB0B7C3',
  cartao: 'FFF6F7F9', faixa: 'FFFAFBFC', link: 'FF1E7F5A',
  verde: 'FF1E7F5A', verdeFundo: 'FFE7F5EE', vermelho: 'FFB42318', vermelhoFundo: 'FFFDECEA',
  ambar: 'FF8A5300', ambarFundo: 'FFFFF4D6', cinza: 'FF646F82', cinzaFundo: 'FFF2F4F7',
};
const MOEDA = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
const DATA = 'dd/mm/yyyy';
const fonte = (o = {}) => ({ name: 'Calibri', size: 11, color: { argb: COR.tinta }, ...o });
const fundo = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const borda = (argb, style = 'thin') => ({ style, color: { argb } });

const SITUACAO = {
  // parcelas
  recebida: ['Pago', COR.verde, COR.verdeFundo], atrasada: ['Em atraso', COR.vermelho, COR.vermelhoFundo],
  hoje: ['Vence hoje', COR.ambar, COR.ambarFundo], pendente: ['A receber', COR.cinza, COR.cinzaFundo],
  // clientes e créditos
  atraso: ['Em atraso', COR.vermelho, COR.vermelhoFundo], em_dia: ['Em dia', COR.verde, COR.verdeFundo],
  quitado: ['Quitado', COR.cinza, COR.cinzaFundo], sem: ['Sem crédito', COR.cinza, COR.cinzaFundo],
};
const COR_ABA = { atraso: 'FFD92D20', em_dia: 'FF29A073', quitado: 'FFB0B7C3', sem: 'FFB0B7C3' };

// "2026-11-19" vira a data do Excel (meia-noite UTC: o Excel mostra o mesmo dia em qualquer fuso).
const dataXL = iso => { if (!iso) return null; const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const aspas = s => String(s).replace(/"/g, '""');
const linkAba = (aba, texto) => ({ formula: `HYPERLINK("#'${aspas(aba).replace(/'/g, "''")}'!A1","${aspas(texto)}")`, result: texto });
const rodapeSeguro = s => String(s || '').replace(/&/g, '&&');

// Nomes de aba: até 31 letras, sem \ / ? * [ ] :, sem repetir (o Excel não diferencia maiúsculas).
export function nomesDeAba(nomes) {
  const usados = new Set(['resumo', 'history']);
  return nomes.map(n => {
    let base = String(n || '').replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '').trim() || 'Cliente';
    base = base.slice(0, 31).trim();
    let nome = base;
    for (let k = 2; usados.has(nome.toLowerCase()); k++) { const suf = ` (${k})`; nome = base.slice(0, 31 - suf.length).trim() + suf; }
    usados.add(nome.toLowerCase());
    return nome;
  });
}

function prepararAba(ws, larguras, m) {
  larguras.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.25 } };
  ws.headerFooter = { oddFooter: `&L&8CredFlux · ${rodapeSeguro(m.conta)} · backup de ${rodapeSeguro(m.geradoEm)}&R&8Página &P de &N` };
}

function titulo(ws, texto, sub, ncols) {
  const t = ws.getCell('A1'); t.value = texto; t.font = fonte({ size: 18, bold: true }); t.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 32;
  const s = ws.getCell('A2'); s.value = sub; s.font = fonte({ color: { argb: COR.suave } });
  ws.getRow(2).height = 18;
  for (let c = 1; c <= ncols; c++) ws.getCell(3, c).fill = fundo(COR.limao);   // faixa verde-limão da marca
  ws.getRow(3).height = 4;
  ws.getRow(4).height = 10;
}

function secao(ws, r, texto) {
  const c = ws.getCell(r, 1); c.value = texto; c.font = fonte({ size: 13, bold: true }); c.alignment = { vertical: 'bottom' };
  ws.getRow(r).height = 24;
}

// Cartões: rótulo pequeno em cima, valor grande embaixo, com o traço verde-limão da marca.
function cartoes(ws, r, lista) {
  ws.getRow(r).height = 20; ws.getRow(r + 1).height = 30;
  for (const k of lista) {
    const [de, ate] = k.cols;
    if (ate > de) { ws.mergeCells(r, de, r, ate); ws.mergeCells(r + 1, de, r + 1, ate); }
    for (let c = de; c <= ate; c++) {
      const lado = {};
      if (c === de) lado.left = borda(COR.branco, 'thick');
      if (c === ate) lado.right = borda(COR.branco, 'thick');
      const a = ws.getCell(r, c); a.fill = fundo(COR.cartao); a.border = { ...lado, top: borda(COR.limao, 'thick') };
      const b = ws.getCell(r + 1, c); b.fill = fundo(COR.cartao); b.border = { ...lado, bottom: borda(COR.linha) };
    }
    const a = ws.getCell(r, de); a.value = k.rot; a.font = fonte({ size: 9, color: { argb: COR.suave } }); a.alignment = { vertical: 'bottom', indent: 1 };
    const b = ws.getCell(r + 1, de); b.value = k.fmt === 'data' ? dataXL(k.v) : k.v ?? null;
    b.numFmt = k.fmt === 'moeda' ? MOEDA : k.fmt === 'data' ? DATA : '0';
    b.font = fonte({ size: 15, bold: true, color: { argb: k.cor || (k.ruim ? COR.vermelho : COR.tinta) } });
    b.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    if (k.v == null || k.v === '') { b.value = '-'; b.font = fonte({ size: 15, bold: true, color: { argb: COR.suave } }); }
  }
}

// Tabela a partir da linha r: cabeçalho escuro, linhas com divisória, situação colorida e linha de total.
// Devolve a última linha usada.
function tabela(ws, r, colunas, linhas, { total = null, grupo = null, filtro = false } = {}) {
  const cab = ws.getRow(r); cab.height = 32;
  colunas.forEach((c, i) => {
    const cel = cab.getCell(i + 1);
    cel.value = c.t;
    cel.font = fonte({ bold: true, size: 10, color: { argb: COR.branco } });
    cel.fill = fundo(COR.tinta);
    // com filtro, o botão da setinha fica à direita: os títulos alinhados à direita ganham recuo
    cel.alignment = { vertical: 'middle', horizontal: c.al || (c.f === 'moeda' ? 'right' : 'left'), wrapText: true, indent: c.f === 'moeda' ? (filtro ? 2 : 0) : 1 };
  });
  let faixa = false, antes = null;
  linhas.forEach((l, k) => {
    const row = ws.getRow(r + 1 + k); row.height = 20;
    // um crédito por faixa: as parcelas de cada crédito ficam juntas, alternando o fundo
    const novoGrupo = grupo && l[grupo] !== antes;
    if (grupo) { if (novoGrupo && k) faixa = !faixa; antes = l[grupo]; } else faixa = k % 2 === 1;
    colunas.forEach((c, i) => {
      const cel = row.getCell(i + 1);
      const v = l[c.k];
      cel.font = fonte();
      cel.alignment = { vertical: 'middle', horizontal: c.al || (c.f === 'moeda' ? 'right' : 'left'), indent: c.f === 'moeda' ? 0 : 1 };
      cel.border = { bottom: borda(COR.linha), ...(novoGrupo && k ? { top: borda(COR.divisa) } : {}) };
      if (faixa) cel.fill = fundo(COR.faixa);
      if (c.f === 'moeda') { cel.value = v == null || v === '' ? null : Number(v); cel.numFmt = MOEDA; }
      else if (c.f === 'data') { cel.value = dataXL(v); cel.numFmt = DATA; cel.alignment = { ...cel.alignment, horizontal: 'center', indent: 0 }; }
      else if (c.f === 'int') { cel.value = v == null ? null : Number(v); cel.numFmt = '0'; }
      else if (c.f === 'situacao') {
        const [rot, cor, fd] = SITUACAO[v] || [String(v || ''), COR.cinza, COR.cinzaFundo];
        cel.value = rot; cel.font = fonte({ bold: true, size: 10, color: { argb: cor } }); cel.fill = fundo(fd);
        cel.alignment = { vertical: 'middle', horizontal: 'center' };
      } else if (c.f === 'link') {
        cel.value = linkAba(l._aba, String(v || ''));
        cel.font = fonte({ bold: true, underline: true, color: { argb: COR.link } });
      } else cel.value = v == null || v === '' ? null : String(v);
    });
  });
  let fim = r + linhas.length;
  if (filtro && linhas.length) ws.autoFilter = { from: { row: r, column: 1 }, to: { row: fim, column: colunas.length } };
  if (total && linhas.length) {
    fim += 1;
    const row = ws.getRow(fim); row.height = 22;
    colunas.forEach((c, i) => {
      const cel = row.getCell(i + 1);
      cel.font = fonte({ bold: true });
      cel.fill = fundo(COR.cartao);
      cel.border = { top: borda(COR.tinta, 'medium') };
      cel.alignment = { vertical: 'middle', horizontal: c.f === 'moeda' ? 'right' : c.al || 'left', indent: c.f === 'moeda' ? 0 : 1 };
      if (i === 0) cel.value = total;
      else if (c.soma) {
        const L = ws.getColumn(i + 1).letter;
        cel.value = { formula: `SUM(${L}${r + 1}:${L}${r + linhas.length})`, result: Math.round(linhas.reduce((s, l) => s + (Number(l[c.k]) || 0), 0) * 100) / 100 };
        cel.numFmt = c.f === 'moeda' ? MOEDA : '0';
      }
    });
  }
  return fim;
}

function nota(ws, r, ncols, texto) {
  ws.mergeCells(r, 1, r, ncols);
  const c = ws.getCell(r, 1); c.value = texto;
  c.font = fonte({ size: 10, italic: true, color: { argb: COR.suave } }); c.alignment = { wrapText: true, vertical: 'top' };
  ws.getRow(r).height = Math.max(18, Math.ceil(String(texto).length / 140) * 15);
}

// Aba Resumo ------------------------------------------------------------------------------
function abaResumo(wb, m, abas) {
  const ws = wb.addWorksheet('Resumo', { properties: { tabColor: { argb: COR.tinta } }, views: [{ showGridLines: false }] });
  const cols = [
    { t: 'Cliente', k: 'nome', f: 'link' },
    { t: 'Créditos ativos', k: 'ativos', f: 'int', al: 'center', soma: true },
    { t: 'Total emprestado', k: 'emprestado', f: 'moeda', soma: true },
    { t: 'Recebido', k: 'recebido', f: 'moeda', soma: true },
    { t: 'A receber', k: 'aReceber', f: 'moeda', soma: true },
    { t: 'Em atraso', k: 'atraso', f: 'moeda', soma: true },
    { t: 'Próximo vencimento', k: 'proximo', f: 'data' },
    { t: 'Situação', k: 'situacao', f: 'situacao' },
    { t: 'Telefone', k: 'telefone' },
    { t: 'CPF/CNPJ', k: 'documento' },
  ];
  prepararAba(ws, [34, 12, 18, 18, 18, 18, 16, 14, 18, 21], m);
  titulo(ws, 'CredFlux · Backup da carteira', `${m.conta} · gerado em ${m.geradoEm}`, cols.length);
  const t = m.totais;
  cartoes(ws, 5, [
    { cols: [1, 1], rot: `Clientes (${t.ativos} ${t.ativos === 1 ? 'crédito ativo' : 'créditos ativos'})`, v: m.clientes.length, fmt: 'int' },
    { cols: [2, 3], rot: 'Total emprestado', v: t.emprestado, fmt: 'moeda' },
    { cols: [4, 5], rot: 'Recebido', v: t.recebido, fmt: 'moeda' },
    { cols: [6, 7], rot: 'A receber', v: t.aReceber, fmt: 'moeda' },
    { cols: [8, 9], rot: 'Em atraso', v: t.atraso, fmt: 'moeda', ruim: t.atraso > 0 },
    { cols: [10, 10], rot: 'Multa em aberto', v: t.mora, fmt: 'moeda' },
  ]);
  ws.getRow(7).height = 12;
  secao(ws, 8, 'Clientes');
  const linhas = m.clientes.map((c, i) => ({ ...c, _aba: abas[i] }));
  const fim = tabela(ws, 9, cols, linhas, { total: 'Total', filtro: true });
  nota(ws, fim + 2, cols.length, `Cada cliente tem uma aba com os créditos e as parcelas: clique no nome para abrir. Situação calculada em ${m.geradoEm.split(' ')[0]}. Os documentos anexados (PDF e fotos) ficam no CredFlux e não entram nesta planilha.`);
}

// Aba de um cliente -----------------------------------------------------------------------
function abaCliente(wb, m, c, aba) {
  const ws = wb.addWorksheet(aba, { properties: { tabColor: { argb: COR_ABA[c.situacao] || COR_ABA.sem } }, views: [{ showGridLines: false }] });
  prepararAba(ws, [12, 11, 15, 19, 15, 15, 13, 15, 15, 14, 36], m);
  const dados = [c.documento && `CPF/CNPJ ${c.documento}`, c.telefone && `Telefone ${c.telefone}`, c.email && `E-mail ${c.email}`].filter(Boolean).join(' · ');
  titulo(ws, c.nome, dados || 'Sem documento nem telefone cadastrados', 11);
  const volta = ws.getCell('K1'); volta.value = linkAba('Resumo', '‹ Voltar ao resumo');
  volta.font = fonte({ underline: true, color: { argb: COR.link } }); volta.alignment = { horizontal: 'right', vertical: 'middle' };
  const [rotSit, corSit] = SITUACAO[c.situacao] || SITUACAO.sem;
  cartoes(ws, 5, [
    { cols: [1, 2], rot: 'Total emprestado', v: c.emprestado, fmt: 'moeda' },
    { cols: [3, 4], rot: 'Recebido', v: c.recebido, fmt: 'moeda' },
    { cols: [5, 6], rot: 'A receber', v: c.aReceber, fmt: 'moeda' },
    { cols: [7, 8], rot: c.mora ? `Em atraso (+ multa ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c.mora)})` : 'Em atraso', v: c.atraso, fmt: 'moeda', ruim: c.atraso > 0 },
    { cols: [9, 10], rot: 'Próximo vencimento', v: c.proximo, fmt: 'data' },
    { cols: [11, 11], rot: 'Situação', v: rotSit, fmt: 'texto', cor: corSit },
  ]);
  let r = 7;
  if (c.obs) { r += 1; nota(ws, r, 11, `Observações: ${c.obs}`); }
  if (!c.creditos.length) { secao(ws, r + 2, 'Nenhum crédito cadastrado para este cliente.'); return; }
  secao(ws, r + 2, 'Créditos');
  r = tabela(ws, r + 3, [
    { t: 'Crédito', k: 'rot' }, { t: 'Data', k: 'data', f: 'data' }, { t: 'Valor', k: 'valor', f: 'moeda', soma: true },
    { t: 'Taxa', k: 'taxa' }, { t: 'Parcelas pagas', k: 'pagas', al: 'center' }, { t: 'Recebido', k: 'recebido', f: 'moeda', soma: true },
    { t: 'Situação', k: 'situacao', f: 'situacao' }, { t: 'Próximo vencimento', k: 'proximo', f: 'data' },
    { t: 'A receber', k: 'aReceber', f: 'moeda', soma: true }, { t: 'Em atraso', k: 'atraso', f: 'moeda', soma: true },
    { t: 'Forma de pagamento', k: 'forma', f: 'texto-longo' },
  ], c.creditos, { total: c.creditos.length > 1 ? 'Total' : null });
  secao(ws, r + 2, 'Parcelas');
  const cabParcelas = r + 3;
  tabela(ws, cabParcelas, [
    { t: 'Crédito', k: 'credito' }, { t: 'Parcela', k: 'parcela', al: 'center' }, { t: 'Vencimento', k: 'vencimento', f: 'data' },
    { t: 'Valor', k: 'valor', f: 'moeda', soma: true }, { t: 'Juros', k: 'juros', f: 'moeda', soma: true },
    { t: 'Amortização', k: 'amortizacao', f: 'moeda', soma: true }, { t: 'Situação', k: 'situacao', f: 'situacao' },
    { t: 'Recebido em', k: 'recebidoEm', f: 'data' }, { t: 'Valor recebido', k: 'valorRecebido', f: 'moeda', soma: true },
    { t: 'Multa', k: 'mora', f: 'moeda', soma: true }, { t: 'Observação', k: 'obs', f: 'texto-longo' },
  ], c.parcelas, { total: 'Total', grupo: 'credito', filtro: true });
  ws.pageSetup.printTitlesRow = `${cabParcelas}:${cabParcelas}`;
}

// m: { conta, geradoEm, totais, clientes: [{ ..., creditos: [...], parcelas: [...] }] } (montado no app.js)
export async function gerarBackupXLSX(m) {
  const ExcelJS = await prepararPlanilha();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CredFlux'; wb.title = `Backup do CredFlux · ${m.conta}`; wb.created = new Date();
  const abas = nomesDeAba(m.clientes.map(c => c.nome));
  abaResumo(wb, m, abas);
  m.clientes.forEach((c, i) => abaCliente(wb, m, c, abas[i]));
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
