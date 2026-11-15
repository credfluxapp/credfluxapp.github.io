// Datas, dinheiro e geração das parcelas. Sem dependências (testável no Node).

export const pad = n => String(n).padStart(2, '0');
export const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const hoje = () => toISO(new Date());
export const addDias = (s, k) => { const d = parseISO(s); d.setDate(d.getDate() + k); return toISO(d); };
export const diffDias = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);

// Soma meses mantendo o dia combinado (31 vira o último dia de meses mais curtos).
export function addMeses(s, k, diaBase) {
  const d = parseISO(s);
  const dia = diaBase || d.getDate();
  const alvo = new Date(d.getFullYear(), d.getMonth() + k, 1);
  const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  alvo.setDate(Math.min(dia, ultimo));
  return toISO(alvo);
}

// Meses entre duas datas: meses inteiros + dias restantes / 30.
export function mesesEntre(a, b) {
  if (b <= a) return 0;
  const dia = parseISO(a).getDate();
  let k = 0;
  while (addMeses(a, k + 1, dia) <= b) k++;
  return k + diffDias(addMeses(a, k, dia), b) / 30;
}

export const r2 = v => Math.round((v + Number.EPSILON) * 100) / 100;

export function parseNum(s) {
  if (typeof s === 'number') return s;
  let t = String(s || '').replace(/[R$\s%]/g, '');
  if (!t) return NaN;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  return Number(t);
}

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const moeda = v => fmtBRL.format(v || 0);
export const num = (v, casas = 2) => (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

export const PERIODICIDADES = {
  diaria:     { nome: 'Diária',     dias: 1 },
  semanal:    { nome: 'Semanal',    dias: 7 },
  quinzenal:  { nome: 'Quinzenal',  dias: 15 },
  mensal:     { nome: 'Mensal',     meses: 1 },
  bimestral:  { nome: 'Bimestral',  meses: 2 },
  trimestral: { nome: 'Trimestral', meses: 3 },
  semestral:  { nome: 'Semestral',  meses: 6 },
  anual:      { nome: 'Anual',      meses: 12 },
};

export const MODALIDADES = {
  unico: 'Pagamento único no vencimento (capital + juros)',
  juros: 'Juros a cada período e capital no último',
  price: 'Parcelas iguais (capital + juros)',
  sac:   'Amortização constante (parcelas decrescentes)',
  livre: 'Parcelas definidas por mim',
  fixa:  'Taxa fixa no prazo, parcelas em dias',
};
export const MODALIDADES_CURTAS = { unico: 'Pagamento único', juros: 'Só juros + capital no fim', price: 'Parcelas iguais', sac: 'SAC', livre: 'Parcelas livres', fixa: 'Taxa fixa em dias' };

// Dia do mês que se repete: o do 1º vencimento; se ele caiu no fim de um mês curto
// (aporte em 31/01, vencimento em 28/02), vale o dia do aporte.
export function diaBase(primeiro, dataAporte) {
  const d = parseISO(primeiro);
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const diaAporte = dataAporte ? parseISO(dataAporte).getDate() : 0;
  return d.getDate() === ultimo && diaAporte > d.getDate() ? diaAporte : d.getDate();
}

export function dataParcela(primeiro, k, per, dia) {
  const p = PERIODICIDADES[per] || PERIODICIDADES.mensal;
  return p.meses ? addMeses(primeiro, k * p.meses, dia || parseISO(primeiro).getDate()) : addDias(primeiro, k * p.dias);
}
// Vencimento que cai no domingo passa para a segunda. A sequência continua contando da data-base, sem acumular o dia a mais.
export const semDomingo = s => parseISO(s).getDay() === 0 ? addDias(s, 1) : s;
export const vencimentoPadrao = (dataAporte, per) => dataParcela(dataAporte, 1, per);
export function taxaMensal(a) {
  const t = (a.taxa || 0) / 100;
  if (a.modalidade === 'fixa') return t * 30 / prazoDias(a);
  if (a.taxa_periodo !== 'ano') return t;
  return a.regime === 'simples' ? t / 12 : Math.pow(1 + t, 1 / 12) - 1;
}

export function taxaPeriodo(a) {
  const im = taxaMensal(a);
  const p = PERIODICIDADES[a.periodicidade] || PERIODICIDADES.mensal;
  const m = p.meses || p.dias / 30;
  return a.regime === 'simples' ? im * m : Math.pow(1 + im, m) - 1;
}

// a: { valor, data_aporte, taxa, taxa_periodo, regime, modalidade, periodicidade, n_parcelas, primeiro_venc }
export function gerarParcelas(a) {
  const P = a.valor;
  if (a.modalidade === 'fixa') return parcelasFixa(a);
  const primeiro = a.primeiro_venc;
  if (!(P > 0) || !primeiro) return [];
  const im = taxaMensal(a);

  if (a.modalidade === 'unico') {
    const m = mesesEntre(a.data_aporte, primeiro);
    const juros = r2(a.regime === 'simples' ? P * im * m : P * (Math.pow(1 + im, m) - 1));
    return [{ num: 1, vencimento: semDomingo(primeiro), valor: r2(P + juros), juros, amortizacao: r2(P) }];
  }

  const n = Math.max(1, Math.min(600, a.n_parcelas | 0));
  const i = taxaPeriodo(a);
  const dia = diaBase(primeiro, a.data_aporte);
  const out = [];
  let saldo = r2(P);
  const amortFixa = r2(P / n);
  const pmt = i > 0 ? P * i / (1 - Math.pow(1 + i, -n)) : P / n;

  for (let k = 0; k < n; k++) {
    const ultimo = k === n - 1;
    let juros, amort;
    if (a.modalidade === 'juros') {
      juros = r2(P * i);
      amort = ultimo ? r2(P) : 0;
    } else if (a.modalidade === 'price') {
      juros = r2(saldo * i);
      amort = ultimo ? saldo : r2(pmt - juros);
    } else if (a.modalidade === 'sac') {
      juros = r2(saldo * i);
      amort = ultimo ? saldo : amortFixa;
    } else { // livre: começa como parcelas iguais sem juros; o usuário ajusta
      juros = 0;
      amort = ultimo ? saldo : amortFixa;
    }
    saldo = r2(saldo - amort);
    out.push({ num: k + 1, vencimento: semDomingo(dataParcela(primeiro, k, a.periodicidade, dia)), valor: r2(juros + amort), juros, amortizacao: r2(amort) });
  }
  return out;
}

export const prazoDias = a => Math.max(1, Math.min(3650, a.prazo_dias | 0 || 30));

// Taxa fixa: R$ 1.000 + 10% = R$ 1.100 no prazo (ex.: 30 dias), em n parcelas iguais
// espalhadas no prazo; a última vence no fim do prazo. Domingo passa para segunda.
function parcelasFixa(a) {
  const P = a.valor;
  if (!(P > 0) || !a.data_aporte) return [];
  const n = Math.max(1, Math.min(600, a.n_parcelas | 0));
  const prazo = prazoDias(a);
  const juros = r2(P * (a.taxa || 0) / 100), total = r2(P + juros);
  const vp = r2(total / n), jp = r2(juros / n);
  const out = [];
  for (let k = 0; k < n; k++) {
    const ultimo = k === n - 1;
    const valor = ultimo ? r2(total - vp * (n - 1)) : vp;
    const j = ultimo ? r2(juros - jp * (n - 1)) : jp;
    out.push({ num: k + 1, vencimento: semDomingo(addDias(a.data_aporte, Math.max(1, Math.round(prazo * (k + 1) / n)))), valor, juros: j, amortizacao: r2(valor - j) });
  }
  return out;
}

// Multa de atraso, por aporte: juros de um mês ÷ 30 por dia, contada do vencimento
// mais antigo em aberto. Taxa fixa: juros do contrato ÷ 30. Mensais: saldo devedor × taxa mensal ÷ 30.
export function moraDiaria(a, ps) {
  if (a.modalidade === 'fixa') return a.valor * (a.taxa || 0) / 100 / 30;
  const saldo = ps.filter(p => !p.recebido_em).reduce((s, p) => s + (Number(p.amortizacao) || 0), 0);
  return Math.max(0, saldo) * taxaMensal(a) / 30;
}
export function diasAtraso(ps, data = hoje()) {
  const v = ps.filter(p => !p.recebido_em).map(p => p.vencimento).sort()[0];
  return v && v < data ? diffDias(v, data) : 0;
}
export const moraAte = (a, ps, data = hoje()) => r2(moraDiaria(a, ps) * diasAtraso(ps, data));

// Recebimento de qualquer valor numa parcela. Paga a multa, depois os juros, depois o capital.
// Mensais (juros, price, sac, único): o que sobra ou falta do capital muda o saldo devedor
// e as parcelas seguintes são refeitas sobre ele (juros que faltaram somam ao saldo).
// Taxa fixa e livres: a diferença passa para a próxima parcela em aberto.
// Devolve a lista nova de parcelas (numeradas de novo) e se ela mudou além da parcela paga.
export function aplicarRecebimento(a, ps, id, data, valor, mora = 0) {
  const lista = ps.map(p => ({ ...p })).sort((x, y) => x.num - y.num);
  const p = lista.find(x => x.id === id);
  if (!p) throw new Error('Parcela não encontrada');
  const pago = r2(valor - mora);
  if (pago < 0) throw new Error('O valor não cobre a multa de atraso');
  Object.assign(p, { recebido_em: data, valor_recebido: r2(valor), mora: r2(mora) });
  const dif = r2(p.valor - pago); // > 0: faltou; < 0: pagou a mais
  if (Math.abs(dif) < 0.005) return { parcelas: lista, refeitas: false };
  const depois = lista.filter(x => !x.recebido_em && x.num > p.num);
  const mensal = ['juros', 'price', 'sac', 'unico'].includes(a.modalidade);
  let novas;
  if (mensal) {
    const amortEf = r2(pago - p.juros);
    const saldo = r2(depois.reduce((s, x) => s + x.amortizacao, 0) + p.amortizacao - amortEf);
    p.valor = pago; p.amortizacao = amortEf;
    novas = refazerMensais(a, p, depois, saldo);
  } else {
    p.valor = pago; p.amortizacao = r2(pago - p.juros);
    novas = depois.map(x => ({ ...x }));
    if (dif > 0) {
      if (novas.length) { novas[0].valor = r2(novas[0].valor + dif); novas[0].amortizacao = r2(novas[0].amortizacao + dif); }
      else novas.push({ num: 0, vencimento: semDomingo(addDias(p.vencimento, a.modalidade === 'fixa' ? Math.max(1, Math.round(prazoDias(a) / Math.max(1, a.n_parcelas | 0))) : 30)), valor: dif, juros: 0, amortizacao: dif });
    } else {
      let sobra = -dif;
      for (const x of novas) { const t = Math.min(sobra, x.valor); x.valor = r2(x.valor - t); x.amortizacao = r2(x.amortizacao - t); sobra = r2(sobra - t); }
      novas = novas.filter(x => x.valor > 0.004);
    }
  }
  const fora = new Set(depois.map(x => x.id));
  const final = lista.filter(x => !fora.has(x.id)).concat(novas).sort((x, y) => x.vencimento.localeCompare(y.vencimento) || x.num - y.num);
  final.forEach((x, i) => { x.num = i + 1; });
  return { parcelas: final, refeitas: true };
}

function refazerMensais(a, p, depois, saldo) {
  if (saldo <= 0.004) return [];
  const per = a.modalidade === 'unico' ? 'mensal' : a.periodicidade;
  const i = a.modalidade === 'unico' ? taxaMensal(a) : taxaPeriodo({ ...a, periodicidade: per });
  const datas = depois.length ? depois.map(x => x.vencimento) : [semDomingo(dataParcela(p.vencimento, 1, per))];
  const k = datas.length;
  const pmt = i > 0 ? saldo * i / (1 - Math.pow(1 + i, -k)) : saldo / k;
  const amortFixa = r2(saldo / k);
  let s = saldo;
  return datas.map((venc, j) => {
    const ultimo = j === k - 1;
    const juros = r2(s * i);
    let amort;
    if (a.modalidade === 'price') amort = ultimo ? s : r2(pmt - juros);
    else if (a.modalidade === 'sac') amort = ultimo ? s : amortFixa;
    else amort = ultimo ? s : 0; // juros e único: capital no fim
    s = r2(s - amort);
    return { id: depois[j]?.id, num: 0, vencimento: venc, valor: r2(juros + amort), juros, amortizacao: r2(amort), recebido_em: null, valor_recebido: null, mora: 0, obs: null };
  });
}

export function statusParcela(p, h = hoje()) {
  if (p.recebido_em) return 'recebida';
  if (p.vencimento < h) return 'atrasada';
  if (p.vencimento === h) return 'hoje';
  return 'pendente';
}
