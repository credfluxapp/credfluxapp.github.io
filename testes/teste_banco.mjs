import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite();
const sql = fs.readFileSync(process.argv[2], 'utf8')
  .replace('create extension if not exists pgcrypto;', '')
  .replace(/SEU_EMAIL@EXEMPLO\.COM/g, 'admin@x.com');
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  -- Imitação mínima do Storage do Supabase
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id serial primary key, bucket_id text, name text);
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant usage on schema storage to anon, authenticated;
`);
await db.exec(sql);
// A parte da AGENDA (pg_cron e pg_net) só existe no Supabase: fica de fora aqui.
for (const extra of process.argv.slice(3)) await db.exec(fs.readFileSync(extra, 'utf8').split(/\r?\n-- AGENDA/)[0]);
const tem02 = process.argv.some(a => /atualizacao_02/.test(a));
await db.exec(`alter table storage.objects enable row level security; grant all on all tables in schema storage to authenticated; grant usage on all sequences in schema storage to authenticated;`);
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

if (process.argv.length > 3) {
  // Atualização 01: taxa fixa, multa, dados do acordo, documentos
  const fixa = JSON.stringify({ cliente_id: cli.id, valor: 1000, data_aporte: '2026-11-16', taxa: 10, taxa_periodo: 'mes', regime: 'simples', modalidade: 'fixa', periodicidade: 'diaria', n_parcelas: 2, prazo_dias: 30 });
  const pf = JSON.stringify([{ num: 1, vencimento: '2026-12-01', valor: 550, juros: 50, amortizacao: 500, recebido_em: '2026-12-03', valor_recebido: 556.67, mora: 6.67 }, { num: 2, vencimento: '2026-12-16', valor: 550, juros: 50, amortizacao: 500 }]);
  const idf = (await como('ana@x.com', `select salvar_aporte($1::jsonb, $2::jsonb) as id`, [fixa, pf])).rows[0].id;
  const af = (await como('ana@x.com', `select modalidade, prazo_dias from aportes where id=$1`, [idf])).rows[0];
  ok(af.modalidade === 'fixa' && af.prazo_dias === 30, 'Aporte de taxa fixa em 30 dias gravado');
  ok(Number((await como('ana@x.com', `select mora from parcelas where aporte_id=$1 and num=1`, [idf])).rows[0].mora) === 6.67, 'Multa de atraso gravada na parcela');
  await como('ana@x.com', `select salvar_dados_acordo($1::jsonb)`, [JSON.stringify({ credor_nome: 'Ana Credora', credor_doc: '123', termos_acordo: 'Termos' })]);
  ok((await como('ana@x.com', `select credor_nome from contas`)).rows[0].credor_nome === 'Ana Credora', 'Dono grava os dados do acordo');
  ok((await falha('carla@x.com', `select salvar_dados_acordo($1::jsonb)`, ['{"credor_nome":"x"}']) || '').includes('dono'), 'Membro não altera os dados do acordo');
  ok((await como('bob@x.com', `select credor_nome from contas`)).rows[0].credor_nome === null, 'Bob não recebe os dados do acordo da Ana');
  const pasta = cli.conta_id + '/' + cli.id + '/contrato.pdf';
  await como('ana@x.com', `insert into documentos(cliente_id, nome, caminho) values ($1, 'contrato.pdf', $2)`, [cli.id, pasta]);
  ok((await como('ana@x.com', `select count(*)::int n from documentos`)).rows[0].n === 1, 'Documento registrado no cliente');
  ok((await como('bob@x.com', `select count(*)::int n from documentos`)).rows[0].n === 0, 'Bob não vê documentos da Ana');
  ok(await falha('bob@x.com', `insert into documentos(cliente_id, nome, caminho) values ($1, 'x.pdf', 'qualquer/x.pdf')`, [cli.id]) !== null, 'Bob não pendura documento no cliente da Ana');
  ok(await falha('ana@x.com', `insert into documentos(cliente_id, nome, caminho) values ($1, 'x.pdf', 'outra-conta/x.pdf')`, [cli.id]) !== null, 'Documento só na pasta da própria conta');
  await como('ana@x.com', `insert into storage.objects(bucket_id, name) values ('documentos', $1)`, [pasta]);
  ok((await como('ana@x.com', `select count(*)::int n from storage.objects`)).rows[0].n === 1, 'Arquivo enviado na pasta da conta');
  ok((await como('bob@x.com', `select count(*)::int n from storage.objects`)).rows[0].n === 0, 'Bob não vê o arquivo da Ana');
  ok(await falha('bob@x.com', `insert into storage.objects(bucket_id, name) values ('documentos', $1)`, [pasta.replace('contrato', 'invasao')]) !== null, 'Bob não envia arquivo para a pasta da Ana');
  ok((await como('bob@x.com', `delete from storage.objects`)).affectedRows === 0, 'Bob não apaga arquivo da Ana');
}

if (tem02) {
  // Atualização 02: notificações no celular
  const insc = (endpoint, extra = {}) => JSON.stringify({ endpoint, p256dh: 'BPUB', auth: 'AUTH', fuso: 'America/Sao_Paulo', detalhes: true, aparelho: 'Teste', ...extra });
  const ep1 = 'https://fcm.googleapis.com/fcm/send/ana-celular';
  await como('ana@x.com', `select push_inscrever($1::jsonb)`, [insc(ep1)]);
  ok((await como('ana@x.com', `select count(*)::int n from push_inscricoes`)).rows[0].n === 1, 'Ana liga as notificações no celular');
  ok((await como('bob@x.com', `select count(*)::int n from push_inscricoes`)).rows[0].n === 0, 'Bob não vê os aparelhos da Ana');
  await como('ana@x.com', `select push_inscrever($1::jsonb)`, [insc(ep1, { detalhes: false, fuso: 'Fuso/Inventado' })]);
  const a1 = (await como('ana@x.com', `select count(*)::int n, bool_and(detalhes) d, min(fuso) f from push_inscricoes`)).rows[0];
  ok(a1.n === 1 && a1.d === false && a1.f === 'America/Sao_Paulo', 'Ligar de novo atualiza o mesmo aparelho; fuso inválido vira o de Brasília');
  ok((await falha('ana@x.com', `select push_inscrever($1::jsonb)`, [insc('https://evil.example.com/x')]) || '').includes('não aceito'), 'Endereço fora dos serviços de notificação é recusado');
  ok(await falha('ana@x.com', `insert into push_inscricoes(email, conta_id, endpoint, p256dh, auth) values ('ana@x.com', $1, 'https://fcm.googleapis.com/x', 'a', 'b')`, [cli.conta_id]) !== null, 'Gravação direta na tabela de aparelhos bloqueada');
  ok((await falha('x@x.com', `select push_inscrever($1::jsonb)`, [insc('https://fcm.googleapis.com/fcm/send/sem-conta')]) || '').includes('Entre numa conta'), 'Sem conta não liga notificações');
  for (const f of ['push_reservar()', `push_do_email('ana@x.com')`, 'push_chave_obter()', `push_remover('${ep1}')`, `push_chave_criar('x', '{}'::jsonb)`]) {
    ok(/permission denied|permissão negada/i.test(await falha('ana@x.com', `select * from ${f}`) || ''), `Só a função de notificações usa ${f.split('(')[0]}`);
  }
  ok((await como('ana@x.com', `select push_chave_publica() k`)).rows[0].k === null, 'Sem chave VAPID antes da primeira notificação');
  await db.query(`select push_chave_criar('PUBLICA', '{"d":"segredo"}'::jsonb)`);
  await db.query(`select push_chave_criar('OUTRA', '{"d":"x"}'::jsonb)`);
  ok((await como('ana@x.com', `select push_chave_publica() k`)).rows[0].k === 'PUBLICA', 'Chave VAPID criada uma vez só; o aplicativo lê só a parte pública');
  ok((await como('ana@x.com', `select count(*)::int n from push_chave`)).rows[0].n === 0, 'A chave privada não aparece para o aplicativo');

  await como('ana@x.com', `select push_inscrever($1::jsonb)`, [insc(ep1)]);
  const reservar = t => db.query(`select tipo, to_char(dia, 'YYYY-MM-DD') dia, itens, atrasadas, valor_atraso::float va, endpoint from push_reservar($1::timestamptz)`, [t]).then(r => r.rows);
  // 15/12/2026 às 9h em Brasília: vence a parcela de R$ 1.100 da Padaria
  const r9 = await reservar('2026-12-15 12:00+00');
  ok(r9.length === 1 && r9[0].tipo === 'hoje' && r9[0].dia === '2026-12-15' && r9[0].itens.length === 1 && r9[0].itens[0].cliente === 'Padaria' && Number(r9[0].itens[0].valor) === 1100 && r9[0].atrasadas === 0,
    `Às 9h: vencimentos do dia (${JSON.stringify(r9[0]?.itens)})`);
  ok((await reservar('2026-12-15 12:40+00')).length === 0, 'O aviso da manhã não sai duas vezes no mesmo dia');
  ok((await reservar('2026-12-15 15:00+00')).length === 0, 'Ao meio-dia não sai aviso');
  // 15/12 às 21h em Brasília (00:00 UTC do dia 16): amanhã vence a parcela de R$ 550 da taxa fixa
  const r21 = await reservar('2026-12-16 00:00+00');
  ok(r21.length === 1 && r21[0].tipo === 'amanha' && r21[0].dia === '2026-12-15' && Number(r21[0].itens[0]?.valor) === 550,
    `Às 21h: clientes de amanhã (${JSON.stringify(r21[0]?.itens)})`);
  ok((await reservar('2026-12-16 01:00+00')).length === 0, 'O aviso da noite não sai duas vezes');
  // 17/12 às 9h: nada vence no dia, mas há duas parcelas em atraso (R$ 1.100 e R$ 550)
  const r17 = await reservar('2026-12-17 12:00+00');
  ok(r17.length === 1 && r17[0].itens.length === 0 && r17[0].atrasadas === 2 && r17[0].va === 1650, `Atrasos no aviso da manhã (${r17[0]?.atrasadas}, R$ ${r17[0]?.va})`);
  // Manaus (uma hora a menos): às 9h de Brasília são 8h lá, ainda na faixa da manhã
  await como('ana@x.com', `select push_inscrever($1::jsonb)`, [insc(ep1, { fuso: 'America/Manaus' })]);
  ok((await reservar('2026-12-18 12:00+00')).length === 1, 'Fuso de Manaus: aviso da manhã às 8h de lá');

  // o celular passa para o Bob: a Ana deixa de receber nele
  await como('bob@x.com', `select push_inscrever($1::jsonb)`, [insc(ep1)]);
  ok((await como('ana@x.com', `select count(*)::int n from push_inscricoes`)).rows[0].n === 0 && (await como('bob@x.com', `select count(*)::int n from push_inscricoes`)).rows[0].n === 1,
    'Celular que passa para o Bob deixa de avisar a Ana');
  await como('ana@x.com', `select push_cancelar($1)`, [ep1]);
  ok((await como('bob@x.com', `select count(*)::int n from push_inscricoes`)).rows[0].n === 1, 'Ana não desliga o aparelho do Bob');
  await como('bob@x.com', `select push_cancelar($1)`, [ep1]);
  ok((await como('bob@x.com', `select count(*)::int n from push_inscricoes`)).rows[0].n === 0, 'Bob desliga o próprio aparelho');

  // quem sai da conta para de receber
  const epC = 'https://updates.push.services.mozilla.com/wpush/v2/carla';
  await como('carla@x.com', `select push_inscrever($1::jsonb)`, [insc(epC)]);
  ok((await reservar('2026-12-19 12:00+00')).some(r => r.endpoint === epC), 'Carla (membro) recebe os avisos da conta');
  await como('ana@x.com', `delete from membros where email='carla@x.com'`);
  ok(!(await reservar('2026-12-20 12:00+00')).some(r => r.endpoint === epC), 'Quem sai da conta não recebe mais avisos');
}

await db.exec(`update contas set assinatura_ate = current_date - 1 where nome='Conta Ana'`);
ok((await como('ana@x.com', `select count(*)::int n from clientes`)).rows[0].n === 1, 'Vencida: continua lendo');
ok(await falha('ana@x.com', `insert into clientes(nome) values ('Nova')`) !== null, 'Vencida: não cadastra');
ok((await como('ana@x.com', `update parcelas set recebido_em=current_date`)).affectedRows === 0, 'Vencida: não altera parcelas');
ok((await falha('ana@x.com', `select salvar_aporte($1::jsonb, $2::jsonb)`, [apo({}), parc]) || '').includes('leitura'), 'Vencida: não grava aporte');
if (process.argv.length > 3) {
  ok(await falha('ana@x.com', `insert into storage.objects(bucket_id, name) values ('documentos', $1)`, [cli.conta_id + '/x/novo.pdf']) !== null, 'Vencida: não envia arquivo');
  ok((await como('ana@x.com', `select count(*)::int n from storage.objects`)).rows[0].n === 1, 'Vencida: continua vendo os arquivos');
}
ok((await como('x@x.com', `select preco_mensal from config`)).rows.length === 1, 'Config pública legível');
console.log(res.join('\n'));
