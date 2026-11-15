// Acordo de pagamento e recibo em PDF (jsPDF + AutoTable, carregados do CDN só quando usados).
const LIBS = [
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js',
];

export const TERMOS_PADRAO = [
  'O DEVEDOR reconhece ter recebido do CREDOR o valor descrito nas condições acima e se compromete a pagá-lo nas datas e nos valores da tabela de parcelas.',
  'Parcela com vencimento no domingo poderá ser paga na segunda-feira seguinte, sem acréscimo.',
  'Em caso de atraso, será cobrado, por dia de atraso, o valor indicado em "Encargo por atraso", contado a partir do vencimento da parcela mais antiga em aberto, até o pagamento.',
  'Pagamentos parciais serão abatidos na seguinte ordem: encargos de atraso, juros e saldo devedor. O saldo restante continuará devido e as parcelas seguintes serão recalculadas sobre ele.',
  'O DEVEDOR poderá antecipar o pagamento total ou parcial do saldo a qualquer tempo.',
  'As partes elegem o foro da comarca de {cidade} para resolver questões deste acordo.',
].join('\n');

// Cada script carrega uma vez só; quem chega durante o carregamento espera o mesmo pedido.
const carregando = new Map();
function carregar(src) {
  if (!carregando.has(src)) {
    carregando.set(src, new Promise((ok, falha) => {
      const s = document.createElement('script'); s.src = src; s.onload = ok;
      s.onerror = () => { carregando.delete(src); s.remove(); falha(new Error('Não foi possível carregar o gerador de PDF. Confira a internet.')); };
      document.head.appendChild(s);
    }));
  }
  return carregando.get(src);
}
// Deixa o gerador de PDF pronto antes do clique (no celular, o compartilhamento precisa ser rápido).
export async function prepararPDF() { for (const src of LIBS) await carregar(src); }

// Valor em reais por extenso, para o recibo (até 999 bilhões).
const UNI = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
const DEZ = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
function ate999(n) {
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100), r = n % 100, partes = [];
  if (c) partes.push(CENTENAS[c]);
  if (r) partes.push(r < 10 ? UNI[r] : r < 20 ? DEZ[r - 10] : DEZENAS[Math.floor(r / 10)] + (r % 10 ? ' e ' + UNI[r % 10] : ''));
  return partes.join(' e ');
}
function inteiroPorExtenso(n) {
  const grupos = []; let resto = n;
  for (const [v, um, varios] of [[1e9, 'bilhão', 'bilhões'], [1e6, 'milhão', 'milhões'], [1e3, 'mil', 'mil']]) {
    const q = Math.floor(resto / v); resto -= q * v;
    if (q) grupos.push({ q, t: v === 1e3 && q === 1 ? 'mil' : `${ate999(q)} ${q === 1 ? um : varios}` });
  }
  if (resto) grupos.push({ q: resto, t: ate999(resto) });
  if (!grupos.length) return 'zero';
  // "mil e quinhentos", "um milhão e cem mil", mas "mil duzentos e trinta e quatro"
  const ult = grupos[grupos.length - 1];
  if (grupos.length > 1 && (ult.q < 100 || ult.q % 100 === 0)) return grupos.slice(0, -1).map(g => g.t).join(' ') + ' e ' + ult.t;
  return grupos.map(g => g.t).join(' ');
}
export function valorPorExtenso(v) {
  const total = Math.round(Math.abs(Number(v) || 0) * 100);
  const reais = Math.floor(total / 100), cent = total % 100, partes = [];
  if (reais) partes.push(`${inteiroPorExtenso(reais)}${reais >= 1e6 && reais % 1e6 === 0 ? ' de' : ''} ${reais === 1 ? 'real' : 'reais'}`);
  if (cent) partes.push(`${ate999(cent)} ${cent === 1 ? 'centavo' : 'centavos'}`);
  return partes.join(' e ') || 'zero real';
}

// As fontes padrão do PDF cobrem o português (Latin-1); troca o resto por equivalentes.
const lat = s => String(s ?? '').replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  .replace(/…/g, '...').replace(/ /g, ' ').replace(/[^\x00-\xFF]/g, '');

const COR = { texto: [17, 24, 39], fraco: [91, 102, 117], linha: [220, 225, 231], marca: [30, 30, 30], fundo: [244, 246, 248] };

// d: { numero, emitido, credor:{nome,doc,endereco}, devedor:{nome,doc,telefone,email}, condicoes:[[rótulo, valor]],
//      parcelas:[[nº, vencimento, valor, juros, capital, situação]], totais:[...], termos, cidade, dataExtenso }
export async function gerarAcordoPDF(d) {
  for (const src of LIBS) await carregar(src);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const L = 18, R = 192, W = R - L;
  let y = 18;
  const cor = (c) => doc.setTextColor(...c);
  const fonte = (tam, estilo = 'normal') => { doc.setFont('helvetica', estilo); doc.setFontSize(tam); };
  const quebra = (alt) => { if (y + alt > 276) { doc.addPage(); y = 20; } };
  const texto = (t, x, opts) => doc.text(lat(t), x, y, opts);

  // Cabeçalho
  fonte(9, 'bold'); cor(COR.marca); texto('CREDFLUX', L);
  fonte(9); cor(COR.fraco); texto(`Acordo nº ${d.numero}  ·  emitido em ${d.emitido}`, R, { align: 'right' });
  y += 3; doc.setDrawColor(...COR.linha); doc.setLineWidth(0.3); doc.line(L, y, R, y);
  y += 11; fonte(15, 'bold'); cor(COR.texto); texto('Instrumento particular de acordo de pagamento', L);
  y += 9;

  // Partes
  const parte = (rot, p, x, larg) => {
    let yy = y;
    fonte(8, 'bold'); cor(COR.fraco); doc.text(lat(rot), x, yy); yy += 5;
    fonte(10.5, 'bold'); cor(COR.texto); doc.text(doc.splitTextToSize(lat(p.nome || '(preencher)'), larg), x, yy); yy += 5;
    fonte(9.5); cor(COR.texto);
    for (const l of [p.doc && `CPF/CNPJ: ${p.doc}`, p.endereco, p.telefone && `Telefone: ${p.telefone}`, p.email && `E-mail: ${p.email}`].filter(Boolean)) {
      const linhas = doc.splitTextToSize(lat(l), larg); doc.text(linhas, x, yy); yy += 4.6 * linhas.length;
    }
    return yy;
  };
  const meio = L + W / 2 + 4;
  const fim = Math.max(parte('CREDOR', d.credor, L, W / 2 - 8), parte('DEVEDOR', d.devedor, meio, W / 2 - 4));
  y = fim + 4;

  // Condições
  const secao = (t) => { quebra(14); y += 3; fonte(8, 'bold'); cor(COR.marca); texto(t.toUpperCase(), L); y += 2; doc.setDrawColor(...COR.linha); doc.line(L, y, R, y); y += 3; };
  secao('Condições');
  doc.autoTable({
    startY: y, margin: { left: L, right: 210 - R }, theme: 'plain',
    body: d.condicoes.map(([a, b]) => [lat(a), lat(b)]),
    styles: { font: 'helvetica', fontSize: 9.5, cellPadding: { top: 1.4, bottom: 1.4, left: 0, right: 2 }, textColor: COR.texto },
    columnStyles: { 0: { cellWidth: 52, textColor: COR.fraco } },
  });
  y = doc.lastAutoTable.finalY + 4;

  // Parcelas
  secao('Parcelas');
  doc.autoTable({
    startY: y, margin: { left: L, right: 210 - R, top: 20 }, theme: 'plain',
    head: [['Nº', 'Vencimento', 'Valor', 'Juros', 'Capital', 'Situação']],
    body: d.parcelas.map(l => l.map(lat)),
    foot: d.totais ? [d.totais.map(lat)] : undefined,
    styles: { font: 'helvetica', fontSize: 9, cellPadding: { top: 1.6, bottom: 1.6, left: 2, right: 2 }, textColor: COR.texto, lineColor: COR.linha },
    headStyles: { fillColor: COR.fundo, textColor: COR.fraco, fontStyle: 'bold', fontSize: 8 },
    footStyles: { fontStyle: 'bold', textColor: COR.texto, lineWidth: { top: 0.3 }, lineColor: COR.linha },
    bodyStyles: { lineWidth: { bottom: 0.1 } },
    columnStyles: { 0: { cellWidth: 12 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { cellWidth: 30 } },
    didParseCell: (c) => { if ((c.section === 'head' || c.section === 'foot') && [2, 3, 4].includes(c.column.index)) c.cell.styles.halign = 'right'; },
  });
  y = doc.lastAutoTable.finalY + 4;

  // Termos
  secao('Termos');
  const termos = lat((d.termos || TERMOS_PADRAO).replace(/\{cidade\}/g, d.cidade || '_____________')).split(/\n+/).map(t => t.trim()).filter(Boolean);
  fonte(9.5); cor(COR.texto);
  termos.forEach((t, i) => {
    const linhas = doc.splitTextToSize(t.replace(/^\d+[.)]\s*/, ''), W - 8);
    quebra(linhas.length * 4.6 + 2);
    doc.text(`${i + 1}.`, L, y); doc.text(linhas, L + 8, y);
    y += linhas.length * 4.6 + 2;
  });

  // Local, data e assinaturas
  quebra(70); y += 6;
  fonte(10); texto(`${d.cidade || '_____________'}, ${d.dataExtenso}.`, L);
  y += 22;
  const assinatura = (x, rot, nome) => {
    doc.setDrawColor(...COR.texto); doc.setLineWidth(0.2); doc.line(x, y, x + 78, y);
    if (nome) { fonte(9, 'bold'); cor(COR.texto); doc.text(lat(nome), x, y + 4.5); }
    fonte(8); cor(COR.fraco); doc.text(lat(rot), x, y + (nome ? 8.5 : 4.5));
  };
  assinatura(L, 'Credor', d.credor.nome); assinatura(R - 78, 'Devedor', d.devedor.nome);
  y += 24;
  assinatura(L, 'Testemunha 1 - nome e CPF', ''); assinatura(R - 78, 'Testemunha 2 - nome e CPF', '');

  // Rodapé com página
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); fonte(8); cor(COR.fraco);
    doc.text(lat(`Acordo nº ${d.numero}`), L, 288);
    doc.text(`Página ${i} de ${n}`, R, 288, { align: 'right' });
  }
  return doc.output('blob');
}

// Recibo de pagamento de uma parcela, em meia folha (A5).
// d: { numero, emitido, credor:{nome,doc,endereco}, devedor:{nome,doc}, valor, extenso, texto,
//      linhas:[[rótulo, valor]] (a última é o total), nota, saldo, cidade, dataExtenso }
export async function gerarReciboPDF(d) {
  await prepararPDF();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a5' });
  const L = 14, R = 134, W = R - L;
  let y = 16;
  const cor = (c) => doc.setTextColor(...c);
  const fonte = (tam, estilo = 'normal') => { doc.setFont('helvetica', estilo); doc.setFontSize(tam); };
  const bloco = (t, tam, estilo, c, alt) => { fonte(tam, estilo); cor(c); const ls = doc.splitTextToSize(lat(t), W); doc.text(ls, L, y); y += ls.length * alt; };

  // Cabeçalho
  fonte(9, 'bold'); cor(COR.marca); doc.text('CREDFLUX', L, y);
  fonte(8.5); cor(COR.fraco); doc.text(lat(`Recibo nº ${d.numero}`), R, y, { align: 'right' });
  y += 3; doc.setDrawColor(...COR.linha); doc.setLineWidth(0.3); doc.line(L, y, R, y);
  y += 10; fonte(14, 'bold'); cor(COR.texto); doc.text('Recibo de pagamento', L, y);

  // Valor em destaque, com o valor por extenso
  y += 6;
  const extenso = doc.splitTextToSize(lat(`(${d.extenso})`), W - 10);
  const altCaixa = 17 + extenso.length * 4;
  doc.setFillColor(...COR.fundo); doc.roundedRect(L, y, W, altCaixa, 2.5, 2.5, 'F');
  fonte(7.5, 'bold'); cor(COR.fraco); doc.text('VALOR RECEBIDO', L + 5, y + 6);
  fonte(17, 'bold'); cor(COR.texto); doc.text(lat(d.valor), L + 5, y + 13.5);
  fonte(8.5, 'italic'); cor(COR.fraco); doc.text(extenso, L + 5, y + 19);
  y += altCaixa + 8;

  // Texto do recibo
  bloco(d.texto, 10, 'normal', COR.texto, 4.8);
  y += 3;

  // Como o valor foi abatido
  doc.autoTable({
    startY: y, margin: { left: L, right: 148 - R }, theme: 'plain',
    body: d.linhas.map(([a, b]) => [lat(a), lat(b)]),
    styles: { font: 'helvetica', fontSize: 9.5, cellPadding: { top: 1.6, bottom: 1.6, left: 0, right: 0 }, textColor: COR.texto, lineColor: COR.linha },
    bodyStyles: { lineWidth: { bottom: 0.1 } },
    columnStyles: { 0: { textColor: COR.fraco }, 1: { halign: 'right' } },
    didParseCell: (c) => { if (c.row.index === d.linhas.length - 1) { c.cell.styles.fontStyle = 'bold'; c.cell.styles.textColor = COR.texto; } },
  });
  y = doc.lastAutoTable.finalY + 5;
  if (d.nota) bloco(d.nota, 8.5, 'normal', COR.fraco, 4.2);
  if (d.saldo) { y += 1; bloco(d.saldo, 8.5, 'normal', COR.fraco, 4.2); }

  // Local, data e assinatura do credor
  y = Math.max(y + 8, 150);
  fonte(10); cor(COR.texto); doc.text(lat(`${d.cidade || '_____________'}, ${d.dataExtenso}.`), L, y);
  y += 20;
  doc.setDrawColor(...COR.texto); doc.setLineWidth(0.2); doc.line(L, y, L + 80, y);
  fonte(9, 'bold'); cor(COR.texto); doc.text(lat(d.credor.nome || 'Credor'), L, y + 4.5);
  fonte(8); cor(COR.fraco);
  doc.text(lat(['Credor', d.credor.doc && `CPF/CNPJ: ${d.credor.doc}`].filter(Boolean).join('  ·  ')), L, y + 8.5);
  if (d.credor.endereco) doc.text(doc.splitTextToSize(lat(d.credor.endereco), W), L, y + 12.5);

  // Rodapé
  fonte(7.5); cor(COR.fraco);
  doc.text(lat(`Recibo nº ${d.numero} · emitido pelo CredFlux em ${d.emitido}`), L, 202);
  return doc.output('blob');
}
