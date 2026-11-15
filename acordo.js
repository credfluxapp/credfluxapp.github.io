// Acordo de pagamento em PDF (jsPDF + AutoTable, carregados do CDN só quando usados).
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

function carregar(src) {
  return new Promise((ok, falha) => {
    if (document.querySelector(`script[src="${src}"]`)) return ok();
    const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => falha(new Error('Não foi possível carregar o gerador de PDF. Confira a internet.'));
    document.head.appendChild(s);
  });
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
