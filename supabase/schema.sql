-- Sistema de Aportes: banco multi-conta (Supabase / Postgres)
-- Rodar uma vez no SQL Editor do Supabase. Antes, troque SEU_EMAIL@EXEMPLO.COM pelo seu e-mail
-- (é quem administra as assinaturas) e ajuste a configuração no fim do arquivo.

create extension if not exists pgcrypto;

-- Tabelas -----------------------------------------------------------------

-- Cada investidor assinante tem uma conta. Os dados de uma conta não aparecem para outra.
create table if not exists contas (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null check (length(trim(nome)) > 0),
  assinatura_ate  date not null,
  criado_em       timestamptz not null default now()
);

-- Pessoas com acesso a uma conta. Um e-mail pertence a uma conta só.
create table if not exists membros (
  email      text primary key check (email = lower(email)),
  conta_id   uuid not null references contas(id) on delete cascade,
  nome       text,
  papel      text not null default 'membro' check (papel in ('dono','membro')),
  criado_em  timestamptz not null default now()
);
create index if not exists membros_conta_idx on membros(conta_id);

-- Administradores do serviço (quem vende). Veem contas e pagamentos, nunca clientes e aportes.
create table if not exists administradores (
  email text primary key check (email = lower(email))
);

-- Configuração do serviço (uma linha só).
create table if not exists config (
  id             int primary key default 1 check (id = 1),
  preco_mensal   numeric(10,2) not null default 49.90,
  dias_teste     int not null default 15,
  chave_pix      text not null default '',
  nome_recebedor text not null default '',
  cidade         text not null default '',
  contato        text not null default ''
);

create table if not exists pagamentos (
  id            uuid primary key default gen_random_uuid(),
  conta_id      uuid not null references contas(id) on delete cascade,
  valor         numeric(10,2) not null,
  txid          text not null,
  status        text not null default 'informado' check (status in ('informado','confirmado','recusado')),
  informado_por text,
  criado_em     timestamptz not null default now(),
  confirmado_em timestamptz,
  meses         int not null default 1 check (meses between 1 and 24)
);
create index if not exists pagamentos_conta_idx on pagamentos(conta_id);

create table if not exists clientes (
  id         uuid primary key default gen_random_uuid(),
  conta_id   uuid not null references contas(id) on delete cascade,
  nome       text not null check (length(trim(nome)) > 0),
  documento  text,
  telefone   text,
  email      text,
  obs        text,
  criado_em  timestamptz not null default now()
);
create index if not exists clientes_conta_idx on clientes(conta_id);

create table if not exists aportes (
  id             uuid primary key default gen_random_uuid(),
  conta_id       uuid not null references contas(id) on delete cascade,
  cliente_id     uuid not null references clientes(id) on delete restrict,
  valor          numeric(14,2) not null check (valor > 0),
  data_aporte    date not null,
  taxa           numeric(10,4) not null default 0 check (taxa >= 0),
  taxa_periodo   text not null default 'mes' check (taxa_periodo in ('mes','ano')),
  regime         text not null default 'compostos' check (regime in ('simples','compostos')),
  modalidade     text not null check (modalidade in ('unico','juros','price','sac','livre')),
  periodicidade  text not null default 'mensal'
                 check (periodicidade in ('diaria','semanal','quinzenal','mensal','bimestral','trimestral','semestral','anual')),
  n_parcelas     int not null default 1 check (n_parcelas between 1 and 600),
  obs            text,
  criado_em      timestamptz not null default now()
);
create index if not exists aportes_conta_idx on aportes(conta_id);
create index if not exists aportes_cliente_idx on aportes(cliente_id);

create table if not exists parcelas (
  id              uuid primary key default gen_random_uuid(),
  conta_id        uuid not null references contas(id) on delete cascade,
  aporte_id       uuid not null references aportes(id) on delete cascade,
  num             int not null,
  vencimento      date not null,
  valor           numeric(14,2) not null check (valor >= 0),
  juros           numeric(14,2) not null default 0,
  amortizacao     numeric(14,2) not null default 0,
  recebido_em     date,
  valor_recebido  numeric(14,2),
  obs             text,
  unique (aporte_id, num)
);
create index if not exists parcelas_conta_venc_idx on parcelas(conta_id, vencimento);
create index if not exists parcelas_aporte_idx on parcelas(aporte_id);

-- Funções de acesso ------------------------------------------------------

create or replace function public.email_atual() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.conta_atual() returns uuid
language sql stable security definer set search_path = public as $$
  select conta_id from membros where email = email_atual();
$$;

create or replace function public.e_dono() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from membros where email = email_atual() and papel = 'dono');
$$;

create or replace function public.e_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from administradores where email = email_atual());
$$;

-- Assinatura em dia (ou período de teste). Vencida: só leitura.
create or replace function public.conta_ativa() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from contas where id = conta_atual() and assinatura_ate >= current_date);
$$;

-- Toda linha nova cai na conta de quem grava.
create or replace function public.preencher_conta() returns trigger
language plpgsql as $$
begin
  new.conta_id := conta_atual();
  if new.conta_id is null then raise exception 'Usuário sem conta'; end if;
  return new;
end $$;

-- Os gatilhos rodam em ordem alfabética: t1_ (preenche a conta) antes de t2_ (confere).
drop trigger if exists t1_conta on clientes;
drop trigger if exists t1_conta on aportes;
drop trigger if exists t1_conta on parcelas;
create trigger t1_conta before insert on clientes for each row execute function preencher_conta();
create trigger t1_conta before insert on aportes  for each row execute function preencher_conta();
create trigger t1_conta before insert on parcelas for each row execute function preencher_conta();

-- Regras de acesso (RLS) ---------------------------------------------------

alter table contas          enable row level security;
alter table membros         enable row level security;
alter table administradores enable row level security;
alter table config          enable row level security;
alter table pagamentos      enable row level security;
alter table clientes        enable row level security;
alter table aportes         enable row level security;
alter table parcelas        enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
           and tablename in ('contas','membros','administradores','config','pagamentos','clientes','aportes','parcelas')
  loop execute format('drop policy %I on %I', r.policyname, r.tablename); end loop;
end $$;

create policy contas_ver   on contas for select to authenticated using (id = conta_atual() or e_admin());
create policy contas_admin on contas for update to authenticated using (e_admin()) with check (e_admin());

create policy membros_ver    on membros for select to authenticated using (conta_id = conta_atual() or e_admin());
create policy membros_incluir on membros for insert to authenticated
  with check (e_dono() and conta_id = conta_atual() and papel = 'membro');
create policy membros_tirar  on membros for delete to authenticated
  using (e_dono() and conta_id = conta_atual() and email <> email_atual());

create policy admins_ver on administradores for select to authenticated using (email = email_atual());

create policy config_ver   on config for select to anon, authenticated using (true);
create policy config_admin on config for update to authenticated using (e_admin()) with check (e_admin());

create policy pag_ver      on pagamentos for select to authenticated using (conta_id = conta_atual() or e_admin());

-- Dados do investidor: leitura sempre; gravação só com assinatura em dia.
create policy clientes_ler on clientes for select to authenticated using (conta_id = conta_atual());
create policy clientes_ins on clientes for insert to authenticated with check (conta_ativa());
create policy clientes_upd on clientes for update to authenticated using (conta_id = conta_atual() and conta_ativa()) with check (conta_id = conta_atual());
create policy clientes_del on clientes for delete to authenticated using (conta_id = conta_atual() and conta_ativa());

create policy aportes_ler on aportes for select to authenticated using (conta_id = conta_atual());
create policy aportes_ins on aportes for insert to authenticated with check (conta_ativa());
create policy aportes_upd on aportes for update to authenticated using (conta_id = conta_atual() and conta_ativa()) with check (conta_id = conta_atual());
create policy aportes_del on aportes for delete to authenticated using (conta_id = conta_atual() and conta_ativa());

create policy parcelas_ler on parcelas for select to authenticated using (conta_id = conta_atual());
create policy parcelas_ins on parcelas for insert to authenticated with check (conta_ativa());
create policy parcelas_upd on parcelas for update to authenticated using (conta_id = conta_atual() and conta_ativa()) with check (conta_id = conta_atual());
create policy parcelas_del on parcelas for delete to authenticated using (conta_id = conta_atual() and conta_ativa());

-- Um cliente de outra conta não pode ser usado num aporte.
create or replace function public.conferir_cliente_aporte() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from clientes where id = new.cliente_id and conta_id = new.conta_id) then
    raise exception 'Cliente inválido';
  end if;
  return new;
end $$;
drop trigger if exists t2_cliente on aportes;
create trigger t2_cliente before insert or update on aportes for each row execute function conferir_cliente_aporte();

create or replace function public.conferir_aporte_parcela() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from aportes where id = new.aporte_id and conta_id = new.conta_id) then
    raise exception 'Aporte inválido';
  end if;
  return new;
end $$;
drop trigger if exists t2_aporte on parcelas;
create trigger t2_aporte before insert or update on parcelas for each row execute function conferir_aporte_parcela();

-- Operações ----------------------------------------------------------------

-- Primeiro acesso de um investidor: cria a conta com o período de teste.
create or replace function public.criar_conta(p_nome text, p_seu_nome text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_conta uuid; v_dias int;
begin
  if email_atual() = '' then raise exception 'Entre com seu e-mail primeiro'; end if;
  if exists (select 1 from membros where email = email_atual()) then
    raise exception 'Este e-mail já participa de uma conta';
  end if;
  select dias_teste into v_dias from config where id = 1;
  insert into contas (nome, assinatura_ate) values (trim(p_nome), current_date + coalesce(v_dias, 15))
    returning id into v_conta;
  insert into membros (email, conta_id, nome, papel) values (email_atual(), v_conta, nullif(trim(p_seu_nome), ''), 'dono');
  return v_conta;
end $$;

-- O investidor avisa que pagou o Pix.
create or replace function public.informar_pagamento(p_meses int default 1) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_preco numeric; v_conta uuid := conta_atual();
begin
  if v_conta is null then raise exception 'Sem conta'; end if;
  if p_meses not between 1 and 12 then raise exception 'Meses inválidos'; end if;
  if exists (select 1 from pagamentos where conta_id = v_conta and status = 'informado') then
    raise exception 'Já existe um pagamento aguardando confirmação';
  end if;
  select preco_mensal into v_preco from config where id = 1;
  insert into pagamentos (conta_id, valor, txid, informado_por, meses)
  values (v_conta, v_preco * p_meses, txid_conta(v_conta), email_atual(), p_meses)
  returning id into v_id;
  return v_id;
end $$;

-- Identificador do Pix: o mesmo que aparece no QR Code (ajuda a achar o pagamento no extrato).
create or replace function public.txid_conta(p_conta uuid) returns text
language sql immutable as $$ select 'APT' || upper(replace(left(p_conta::text, 13), '-', '')) $$;

-- O administrador confirma (ou recusa) o pagamento. Confirmar soma os meses à assinatura.
create or replace function public.confirmar_pagamento(p_id uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v pagamentos;
begin
  if not e_admin() then raise exception 'Sem acesso'; end if;
  select * into v from pagamentos where id = p_id for update;
  if v.id is null or v.status <> 'informado' then raise exception 'Pagamento não está aguardando'; end if;
  update pagamentos set status = case when p_ok then 'confirmado' else 'recusado' end, confirmado_em = now() where id = p_id;
  if p_ok then
    update contas set assinatura_ate = (greatest(assinatura_ate, current_date) + make_interval(months => v.meses))::date
    where id = v.conta_id;
  end if;
end $$;

-- Aporte e parcelas gravados juntos (tudo ou nada).
create or replace function public.salvar_aporte(p_aporte jsonb, p_parcelas jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  if not conta_ativa() then raise exception 'Assinatura vencida: a conta está em modo leitura'; end if;
  if jsonb_array_length(coalesce(p_parcelas, '[]'::jsonb)) = 0 then
    raise exception 'O aporte precisa de pelo menos uma parcela';
  end if;
  v_id := nullif(p_aporte ->> 'id', '')::uuid;
  if v_id is null then
    insert into aportes (cliente_id, valor, data_aporte, taxa, taxa_periodo, regime, modalidade, periodicidade, n_parcelas, obs)
    values ((p_aporte->>'cliente_id')::uuid, (p_aporte->>'valor')::numeric, (p_aporte->>'data_aporte')::date,
            (p_aporte->>'taxa')::numeric, p_aporte->>'taxa_periodo', p_aporte->>'regime', p_aporte->>'modalidade',
            p_aporte->>'periodicidade', (p_aporte->>'n_parcelas')::int, nullif(p_aporte->>'obs', ''))
    returning id into v_id;
  else
    update aportes set
      cliente_id = (p_aporte->>'cliente_id')::uuid, valor = (p_aporte->>'valor')::numeric,
      data_aporte = (p_aporte->>'data_aporte')::date, taxa = (p_aporte->>'taxa')::numeric,
      taxa_periodo = p_aporte->>'taxa_periodo', regime = p_aporte->>'regime', modalidade = p_aporte->>'modalidade',
      periodicidade = p_aporte->>'periodicidade', n_parcelas = (p_aporte->>'n_parcelas')::int,
      obs = nullif(p_aporte->>'obs', '')
    where id = v_id;
    if not found then raise exception 'Aporte não encontrado'; end if;
    delete from parcelas where aporte_id = v_id;
  end if;
  insert into parcelas (aporte_id, num, vencimento, valor, juros, amortizacao, recebido_em, valor_recebido, obs)
  select v_id, (e->>'num')::int, (e->>'vencimento')::date, (e->>'valor')::numeric,
         coalesce((e->>'juros')::numeric, 0), coalesce((e->>'amortizacao')::numeric, 0),
         nullif(e->>'recebido_em', '')::date, nullif(e->>'valor_recebido', '')::numeric, nullif(e->>'obs', '')
  from jsonb_array_elements(p_parcelas) e;
  return v_id;
end $$;

-- Visão do administrador: contas com o dono e o último pagamento, sem dados de clientes.
create or replace function public.admin_contas()
returns table (id uuid, nome text, dono text, membros bigint, assinatura_ate date, criado_em timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.nome,
         (select m.email from membros m where m.conta_id = c.id and m.papel = 'dono' limit 1),
         (select count(*) from membros m where m.conta_id = c.id),
         c.assinatura_ate, c.criado_em
  from contas c where e_admin() order by c.assinatura_ate;
$$;

revoke execute on function public.admin_contas() from anon;
revoke execute on function public.confirmar_pagamento(uuid, boolean) from anon;
revoke execute on function public.criar_conta(text, text) from anon;
revoke execute on function public.informar_pagamento(int) from anon;
revoke execute on function public.salvar_aporte(jsonb, jsonb) from anon;

-- Configuração inicial (ajuste aqui ou depois no painel do administrador) ------

insert into config (id, preco_mensal, dias_teste, chave_pix, nome_recebedor, cidade, contato)
values (1, 49.90, 15, '', '', '', '')
on conflict (id) do nothing;

insert into administradores (email) values (lower('SEU_EMAIL@EXEMPLO.COM'))
on conflict do nothing;
