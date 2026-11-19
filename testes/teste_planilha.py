# Confere por dentro o backup em planilha gerado pelo CredFlux (chamado pelo teste_demo.js).
# Uso: python testes/teste_planilha.py backup.xlsx
import sys
import datetime as dt
from openpyxl import load_workbook

arq = sys.argv[1]
wf = load_workbook(arq)                   # fórmulas
wv = load_workbook(arq, data_only=True)   # valores guardados
res = []
def ok(c, m): res.append(('OK    ' if c else 'FALHA ') + m)

abas = wf.sheetnames
r = wf['Resumo']; rv = wv['Resumo']
ok(abas[0] == 'Resumo' and str(r['A1'].value).startswith('CredFlux · Backup da carteira'), f'Planilha abre no Resumo ({len(abas)} abas)')
cab = [r.cell(9, c).value for c in range(1, 11)]
ok(cab == ['Cliente', 'Créditos ativos', 'Total emprestado', 'Recebido', 'A receber', 'Em atraso', 'Próximo vencimento', 'Situação', 'Telefone', 'CPF/CNPJ'], 'Resumo com as colunas certas')
h = r.cell(9, 1)
ok(h.fill.fgColor.rgb == 'FF1B212D' and h.font.bold and h.font.color.rgb == 'FFFFFFFF', 'Cabeçalho escuro com letra branca')
ok(r.cell(3, 1).fill.fgColor.rgb == 'FFC8EE44', 'Faixa verde-limão da marca embaixo do título')
ok(all(wf[a].sheet_view.showGridLines is False for a in abas), 'Sem linhas de grade em nenhuma aba')

# linhas de clientes até a linha "Total"
linhas = []
k = 10
while r.cell(k, 1).value not in (None, 'Total'):
    linhas.append(k); k += 1
total_linha = k
nomes = [rv.cell(i, 1).value for i in linhas]
ok(len(nomes) == len(abas) - 1, f'Uma aba para cada cliente ({len(nomes)} clientes, {len(abas) - 1} abas)')
links = [str(r.cell(i, 1).value) for i in linhas]
ok(all(l.startswith('=HYPERLINK("#\'') and any(f"'{a}'!A1" in l.replace("''", "'") for a in abas[1:]) for l in links), 'Nome do cliente no resumo abre a aba dele')
ok(r.cell(total_linha, 1).value == 'Total' and str(r.cell(total_linha, 5).value).startswith('=SUM(E10:E'), 'Linha de total com soma de verdade (fórmula)')
ok('R$' in r.cell(10, 3).number_format and 'R$' in r.cell(6, 2).number_format and 'B6:C6' in [str(x) for x in r.merged_cells.ranges],
   'Valores em reais (R$) nas colunas e nos cartões (cartão de duas colunas)')
ok(r.auto_filter.ref is not None and r.auto_filter.ref.startswith('A9:'), f'Filtro na tabela de clientes ({r.auto_filter.ref})')

# cada aba de cliente: título, situação, créditos e parcelas; o "a receber" bate com as parcelas em aberto
erros = []
situacoes = set()
for i, nome in zip(linhas, nomes):
    aba = next(a for a in abas[1:] if f"'{a}'!A1" in str(r.cell(i, 1).value).replace("''", "'"))
    ws, wsv = wf[aba], wv[aba]
    if wsv['A1'].value != nome: erros.append(f'{aba}: título {wsv["A1"].value!r}')
    if ws.sheet_properties.tabColor is None: erros.append(f'{aba}: sem cor na aba')
    col_a = [ws.cell(x, 1).value for x in range(1, ws.max_row + 1)]
    if 'Parcelas' not in col_a or 'Créditos' not in col_a:
        if rv.cell(i, 2).value: erros.append(f'{aba}: sem as seções')
        continue
    cp = col_a.index('Parcelas') + 2   # linha do cabeçalho das parcelas
    cabp = [ws.cell(cp, c).value for c in range(1, 12)]
    if cabp != ['Crédito', 'Parcela', 'Vencimento', 'Valor', 'Juros', 'Amortização', 'Situação', 'Recebido em', 'Valor recebido', 'Multa', 'Observação']:
        erros.append(f'{aba}: cabeçalho das parcelas {cabp}'); continue
    aberto = 0.0; x = cp + 1
    while wsv.cell(x, 1).value not in (None, 'Total'):
        sit = wsv.cell(x, 7).value; situacoes.add(sit)
        if not isinstance(wsv.cell(x, 3).value, dt.datetime) or ws.cell(x, 3).number_format != 'dd/mm/yyyy': erros.append(f'{aba}: vencimento sem data na linha {x}')
        if sit != 'Pago': aberto += float(wsv.cell(x, 4).value or 0)
        x += 1
    if abs(aberto - float(rv.cell(i, 5).value or 0)) > 0.011: erros.append(f'{aba}: a receber {rv.cell(i, 5).value} x parcelas em aberto {aberto:.2f}')
    if not (ws.auto_filter.ref or '').startswith(f'A{cp}:'): erros.append(f'{aba}: sem filtro nas parcelas')
    if str(ws.print_title_rows or '').replace('$', '') != f'{cp}:{cp}': erros.append(f'{aba}: cabeçalho das parcelas não repete na impressão ({ws.print_title_rows})')
    if not str(ws['K1'].value).startswith('=HYPERLINK("#\'Resumo\'!A1"'): erros.append(f'{aba}: sem o link de volta')
ok(not erros, 'Abas dos clientes completas e "A receber" igual às parcelas em aberto' + (': ' + '; '.join(erros[:4]) if erros else ''))
ok(situacoes <= {'Pago', 'Em atraso', 'Vence hoje', 'A receber'} and 'Pago' in situacoes and 'A receber' in situacoes, f'Situação das parcelas por extenso ({", ".join(sorted(s for s in situacoes if s))})')

print('\n'.join(res))
sys.exit(1 if any(x.startswith('FALHA') for x in res) else 0)
