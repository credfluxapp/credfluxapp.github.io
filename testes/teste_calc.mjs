// Regras de dinheiro (calc.js). Uso: node testes/teste_calc.mjs
import * as C from '../calc.js';

const res = []; const ok = (c, m) => res.push((c ? 'OK    ' : 'FALHA ') + m);
const comIds = ps => ps.map((p, i) => ({ ...p, id: 'p' + (i + 1), recebido_em: null, valor_recebido: null, mora: 0 }));
const dia = s => C.parseISO(s).getDay();

// Domingo vira segunda, sem empurrar as seguintes
const price = C.gerarParcelas({ valor: 10000, data_aporte: '2026-10-15', primeiro_venc: '2026-11-15', taxa: 2, taxa_periodo: 'mes', regime: 'compostos', modalidade: 'price', periodicidade: 'mensal', n_parcelas: 12 });
ok(price[0].vencimento === '2026-11-16' && price[1].vencimento === '2026-12-15', 'Domingo 15/11 vira 16/11 e a seguinte fica no dia 15');
ok(price.every(p => dia(p.vencimento) !== 0), 'Nenhuma parcela no domingo');
ok(price[0].valor === 945.6, `Price 10.000 a 2% em 12x = 945,60 (${price[0].valor})`);

// Taxa fixa em dias
const fixa = (n) => ({ valor: 1000, data_aporte: '2026-11-16', taxa: 10, modalidade: 'fixa', prazo_dias: 30, n_parcelas: n, periodicidade: 'diaria', regime: 'simples', taxa_periodo: 'mes' });
const f11 = C.gerarParcelas(fixa(11));
ok(f11.length === 11 && f11.every(p => p.valor === 100), `Fixa: 1.000 + 10% em 11 parcelas de 100 (${f11.map(p => p.valor).join(',')})`);
ok(C.r2(f11.reduce((s, p) => s + p.juros, 0)) === 100, 'Fixa: juros somam 100');
ok(f11.at(-1).vencimento <= '2026-12-17' && f11.at(-1).vencimento >= '2026-12-16', `Fixa: última no fim do prazo (${f11.at(-1).vencimento})`);
ok(f11.every(p => dia(p.vencimento) !== 0), 'Fixa: nenhuma no domingo');
const f20 = C.gerarParcelas(fixa(20));
ok(f20.length === 20 && f20.every(p => p.valor === 55), 'Fixa: 20 parcelas de 55');

// Multa de atraso por aporte
const af = fixa(11); const pf = comIds(f11);
ok(C.r2(C.moraDiaria(af, pf)) === 3.33, `Multa fixa: 100 ÷ 30 = 3,33/dia (${C.moraDiaria(af, pf)})`);
ok(C.moraAte(af, pf, C.addDias(pf[0].vencimento, 5)) === 16.67, 'Multa de 5 dias = 16,67');
ok(C.moraAte(af, pf, pf[0].vencimento) === 0, 'No dia do vencimento não há multa');
const aj = { valor: 10000, data_aporte: '2026-10-10', primeiro_venc: '2026-11-10', taxa: 2, taxa_periodo: 'mes', regime: 'compostos', modalidade: 'juros', periodicidade: 'mensal', n_parcelas: 12 };
const pj = comIds(C.gerarParcelas(aj));
ok(C.r2(C.moraDiaria(aj, pj)) === 6.67, `Multa mensal: 200 ÷ 30 = 6,67/dia (${C.moraDiaria(aj, pj)})`);

// Recebimento parcial (juros + parte do capital)
let r = C.aplicarRecebimento(aj, pj, 'p1', '2026-11-10', 200);
ok(!r.refeitas, 'Só os juros numa parcela de juros: nada muda');
r = C.aplicarRecebimento(aj, pj, 'p1', '2026-11-10', 1200);
ok(r.parcelas[1].juros === 180 && r.parcelas.at(-1).valor === 9180, `Juros + 1.000: saldo 9.000, juros seguintes 180 (${r.parcelas[1].juros}, última ${r.parcelas.at(-1).valor})`);
ok(r.parcelas[0].amortizacao === 1000 && r.parcelas[0].valor_recebido === 1200, 'Parcela paga registra 1.000 de capital');
r = C.aplicarRecebimento(aj, pj, 'p1', '2026-11-10', 100);
ok(r.parcelas[1].juros === 202, `Pagou 100 de 200 de juros: saldo 10.100, juros 202 (${r.parcelas[1].juros})`);
r = C.aplicarRecebimento(aj, pj, 'p1', '2026-11-15', 220, 20);
ok(!r.refeitas && r.parcelas[0].mora === 20, 'Com multa: 200 de juros + 20 de multa');

const ap = { ...aj, modalidade: 'price' };
const pp = comIds(C.gerarParcelas(ap));
r = C.aplicarRecebimento(ap, pp, 'p1', '2026-11-10', 200);
const saldo = C.r2(r.parcelas.filter(p => !p.recebido_em).reduce((s, p) => s + p.amortizacao, 0));
ok(saldo === 10000 && r.parcelas.length === 12, `Price, só juros: saldo continua 10.000 em 11 parcelas (${saldo})`);
ok(r.parcelas[1].juros === 200, 'Price: juros seguintes sobre o saldo (200)');

const au = { ...aj, modalidade: 'unico', primeiro_venc: '2027-01-12' };
const pu = comIds(C.gerarParcelas(au));
r = C.aplicarRecebimento(au, pu, 'p1', '2027-01-12', pu[0].juros);
ok(r.parcelas.length === 2 && r.parcelas[1].valor === 10200 && r.parcelas[1].vencimento === '2027-02-12', `Único, só juros: nova parcela de 10.200 um mês depois (${r.parcelas[1]?.valor} ${r.parcelas[1]?.vencimento})`);

r = C.aplicarRecebimento(af, pf, 'p1', '2026-11-19', 60);
ok(r.parcelas[1].valor === 140, `Fixa: pagou 60 de 100, próxima vira 140 (${r.parcelas[1].valor})`);
r = C.aplicarRecebimento(af, pf, 'p1', '2026-11-19', 250);
ok(r.parcelas.length === 10 && r.parcelas[1].valor === 50, `Fixa: pagou 250, desconta 150 das seguintes (${r.parcelas.length} parcelas, 2ª ${r.parcelas[1].valor})`);
ok(r.parcelas.reduce((s, p) => s + (p.recebido_em ? p.valor_recebido : p.valor), 0) === 1100, 'Fixa: total continua 1.100');

console.log(res.join('\n'));
process.exit(res.some(x => x.startsWith('FALHA')) ? 1 : 0);
