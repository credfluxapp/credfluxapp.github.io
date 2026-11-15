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
};
export const MODALIDADES_CURTAS = { unico: 'Pagamento único', juros: 'Só juros + capital no fim', price: 'Parcelas iguais', sac: 'SAC', livre: 'Parcelas livres' };

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
export const vencimentoPadrao = (dataAporte, per) => dataParcela(dataAporte, 1, per);
export function taxaMensal(a) {
  const t = (a.taxa || 0) / 100;
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
  const primeiro = a.primeiro_venc;
  if (!(P > 0) || !primeiro) return [];
  const im = taxaMensal(a);

  if (a.modalidade === 'unico') {
    const m = mesesEntre(a.data_aporte, primeiro);
    const juros = r2(a.regime === 'simples' ? P * im * m : P * (Math.pow(1 + im, m) - 1));
    return [{ num: 1, vencimento: primeiro, valor: r2(P + juros), juros, amortizacao: r2(P) }];
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
    out.push({ num: k + 1, vencimento: dataParcela(primeiro, k, a.periodicidade, dia), valor: r2(juros + amort), juros, amortizacao: r2(amort) });
  }
  return out;
}

export function statusParcela(p, h = hoje()) {
  if (p.recebido_em) return 'recebida';
  if (p.vencimento < h) return 'atrasada';
  if (p.vencimento === h) return 'hoje';
  return 'pendente';
}
