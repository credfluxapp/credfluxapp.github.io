import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite();
const sql = fs.readFileSync(process.argv[2], 'utf8')
  .replace('create extension if not exists pgcrypto;', '')
  .replace(/SEU_EMAIL@EXEMPLO\.COM/g, 'admin@x.com');
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
`);
await db.exec(sql);
await db.exec(`grant all on all tables in schema public to anon, authenticated;`);
const res = [];
const ok = (c, m) => res.push((c ? 'OK    ' : 'FALHA ') + m);
async function como(email, q, params) {
  await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify({ email })}', false); set role authenticated;`);
  try { return await db.query(q, params); } finally { await db.exec('reset role'); }
}
async function falha(email, q, params) { try { await como(email, q, params); return null; } catch (e) { return e.message; } }

await como('ana@x.com', `select criar_conta('Conta Ana','Ana')`);
await como('bob@x.com', `select criar_conta('Conta Bob','Bob')`);
ok((await falha('ana@x.com', `select criar_conta('Outra','Ana')`) || '').includes('já participa'), 'Mesmo e-mail não cria segunda conta');
const cli = (await como('ana@x.com', `insert into clientes(nome) values ('Padaria') returning id, conta_id`)).rows[0];
ok(cli.conta_id, 'Cliente cai na conta da Ana');
const parc = JSON.stringify([{ num: 1, vencimento: '2026-12-15', valor: 1100, juros: 100, amortizacao: 1000 }, { num: 2, vencimento: '2027-01-15', valor: 1050, juros: 50, amortizacao: 0 }]);
const apo = p => JSON.stringify({ cliente_id: cli.id, valor: 1000, data_aporte: '2026-11-15', taxa: 5, taxa_periodo: 'mes', regime: 'simples', modalidade: 'juros', periodicidade: 'mensal', n_parcelas: 2, ...p });
const apId = (await como('ana@x.com', `select salvar_aporte($1::jsonb, $2::jsonb) as id`, [apo({}), parc])).rows[0].id;
ok((await como('ana@x.com', `select count(*)::int n from parcelas where aporte_id=$1`, [apId])).rows[0].n === 2, 'Aporte com 2 parcelas gravado');
await como('ana@x.com', `select salvar_aporte($1::jsonb, $2::jsonb)`, [apo({ id: apId }), parc]);
ok((await como('ana@x.com', `select count(*)::int n from parcelas`)).rows[0].n === 2, 'Editar aporte troca as parcelas sem duplicar');

ok((await como('bob@x.com', `select count(*)::int n from clientes`)).rows[0].n === 0, 'Bob não vê clientes da Ana');
ok((await como('bob@x.com', `select count(*)::int n from parcelas`)).rows[0].n === 0, 'Bob não vê parcelas da Ana');
ok((await como('bob@x.com', `update clientes set nome='x' where id=$1`, [cli.id])).affectedRows === 0, 'Bob não altera cliente da Ana');
ok((await como('bob@x.com', `delete from aportes where id=$1`, [apId])).affectedRows === 0, 'Bob não apaga aporte da Ana');
ok((await falha('bob@x.com', `select salvar_aporte($1::jsonb, $2::jsonb)`, [apo({}), parc]) || '').includes('Cliente inválido'), 'Bob não usa cliente da Ana num aporte');
ok((await falha('bob@x.com', `select salvar_aporte($1::jsonb, $2::jsonb)`, [apo({ id: apId }), parc]) || '').includes('não encontrado'), 'Bob não edita aporte da Ana');
ok((await falha('bob@x.com', `insert into parcelas(aporte_id,num,vencimento,valor) values ($1, 9, '2027-01-01', 1)`, [apId]) || '').includes('Aporte inválido'), 'Bob não pendura parcela no aporte da Ana');
ok((await como('ana@x.com', `select count(*)::int n from parcelas where aporte_id=$1`, [apId])).rows[0].n === 2, 'Parcelas da Ana intactas depois das tentativas do Bob');

await como('ana@x.com', `insert into membros(conta_id,email,nome) values ($1,'carla@x.com','Carla')`, [cli.conta_id]);
ok((await como('carla@x.com', `select count(*)::int n from clientes`)).rows[0].n === 1, 'Carla (convidada) vê os clientes da Ana');
ok(await falha('carla@x.com', `insert into membros(conta_id,email) values ($1,'dan@x.com')`, [cli.conta_id]) !== null, 'Membro comum não convida');
ok(await falha('bob@x.com', `insert into membros(conta_id,email) values ($1,'eva@x.com')`, [cli.conta_id]) !== null, 'Bob não se convida para a conta da Ana');
ok((await como('ana@x.com', `delete from membros where email='ana@x.com'`)).affectedRows === 0, 'Dono não se remove');
ok((await como('ana@x.com', `update contas set assinatura_ate='2099-01-01'`)).affectedRows === 0, 'Investidor não altera a própria validade');
ok(await falha('ana@x.com', `insert into pagamentos(conta_id,valor,txid,status) values ($1,1,'x','confirmado')`, [cli.conta_id]) !== null, 'Investidor não cria pagamento confirmado');

const antes = (await db.query(`select assinatura_ate::text a from contas where nome='Conta Ana'`)).rows[0].a;
await como('ana@x.com', `select informar_pagamento(3)`);
ok((await como('ana@x.com', `update pagamentos set status='confirmado'`)).affectedRows === 0, 'Investidor não muda status do pagamento');
ok((await falha('ana@x.com', `select informar_pagamento(1)`) || '').includes('aguardando'), 'Não informa dois pagamentos ao mesmo tempo');
const pg = (await como('admin@x.com', `select id, valor::float v, txid from pagamentos where status='informado'`)).rows[0];
ok(pg && pg.v === 149.7, `Admin vê pagamento de 3 meses (${pg?.v}, ${pg?.txid})`);
ok((await falha('ana@x.com', `select confirmar_pagamento($1, true)`, [pg.id]) || '').includes('Sem acesso'), 'Investidor não confirma o próprio pagamento');
await como('admin@x.com', `select confirmar_pagamento($1, true)`, [pg.id]);
const depois = (await db.query(`select assinatura_ate::text a from contas where nome='Conta Ana'`)).rows[0].a;
ok(depois > antes, `Confirmação soma 3 meses (${antes} -> ${depois})`);
ok((await como('admin@x.com', `select * from admin_contas()`)).rows.length === 2, 'Admin vê as 2 contas');
ok((await como('ana@x.com', `select * from admin_contas()`)).rows.length === 0, 'Investidor não vê lista de contas');
ok((await como('admin@x.com', `select count(*)::int n from clientes`)).rows[0].n === 0, 'Admin não vê clientes dos investidores');

await db.exec(`update contas set assinatura_ate = current_date - 1 where nome='Conta Ana'`);
ok((await como('ana@x.com', `select count(*)::int n from clientes`)).rows[0].n === 1, 'Vencida: continua lendo');
ok(await falha('ana@x.com', `insert into clientes(nome) values ('Nova')`) !== null, 'Vencida: não cadastra');
ok((await como('ana@x.com', `update parcelas set recebido_em=current_date`)).affectedRows === 0, 'Vencida: não altera parcelas');
ok((await falha('ana@x.com', `select salvar_aporte($1::jsonb, $2::jsonb)`, [apo({}), parc]) || '').includes('leitura'), 'Vencida: não grava aporte');
ok((await como('x@x.com', `select preco_mensal from config`)).rows.length === 1, 'Config pública legível');
console.log(res.join('\n'));
