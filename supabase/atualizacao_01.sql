-- Atualização 01 (novembro de 2026): taxa fixa em dias, multa de atraso, dados do acordo em PDF
-- e documentos dos clientes. Só acrescenta; não apaga dados. Pode rodar mais de uma vez.
-- Rodar no SQL Editor do Supabase de um projeto que já tem o schema.sql.

-- Aportes: modalidade "taxa fixa no prazo, parcelas em dias" ----------------------
alter table aportes add column if not exists prazo_dias int check (prazo_dias between 1 and 3650);
alter table aportes drop constraint if exists aportes_modalidade_check;
alter table aportes add constraint aportes_modalidade_check
  check (modalidade in ('unico','juros','price','sac','livre','fixa'));

-- Parcelas: multa de atraso recebida (já incluída em valor_recebido) ---------------
alter table parcelas add column if not exists mora numeric(14,2) not null default 0 check (mora >= 0);

-- Contas: dados do credor e texto dos termos do acordo em PDF ------------------------
alter table contas add column if not exists credor_nome     text;
alter table contas add column if not exists credor_doc      text;
alter table contas add column if not exists credor_endereco text;
alter table contas add column if not exists credor_cidade   text;
alter table contas add column if not exists termos_acordo   text;

-- Só o dono grava os dados do acordo (a tabela contas não tem gravação direta).
create or replace function public.salvar_dados_acordo(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not e_dono() then raise exception 'Só o dono da conta altera os dados do acordo'; end if;
  update contas set
    credor_nome = nullif(trim(p->>'credor_nome'), ''), credor_doc = nullif(trim(p->>'credor_doc'), ''),
    credor_endereco = nullif(trim(p->>'credor_endereco'), ''), credor_cidade = nullif(trim(p->>'credor_cidade'), ''),
    termos_acordo = nullif(p->>'termos_acordo', '')
  where id = conta_atual();
end $$;
revoke execute on function public.salvar_dados_acordo(jsonb) from anon;

-- Aporte e parcelas gravados juntos, agora com prazo em dias e multa ---------------------
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
    insert into aportes (cliente_id, valor, data_aporte, taxa, taxa_periodo, regime, modalidade, periodicidade, n_parcelas, prazo_dias, obs)
    values ((p_aporte->>'cliente_id')::uuid, (p_aporte->>'valor')::numeric, (p_aporte->>'data_aporte')::date,
            (p_aporte->>'taxa')::numeric, p_aporte->>'taxa_periodo', p_aporte->>'regime', p_aporte->>'modalidade',
            p_aporte->>'periodicidade', (p_aporte->>'n_parcelas')::int, nullif(p_aporte->>'prazo_dias', '')::int,
            nullif(p_aporte->>'obs', ''))
    returning id into v_id;
  else
    update aportes set
      cliente_id = (p_aporte->>'cliente_id')::uuid, valor = (p_aporte->>'valor')::numeric,
      data_aporte = (p_aporte->>'data_aporte')::date, taxa = (p_aporte->>'taxa')::numeric,
      taxa_periodo = p_aporte->>'taxa_periodo', regime = p_aporte->>'regime', modalidade = p_aporte->>'modalidade',
      periodicidade = p_aporte->>'periodicidade', n_parcelas = (p_aporte->>'n_parcelas')::int,
      prazo_dias = nullif(p_aporte->>'prazo_dias', '')::int, obs = nullif(p_aporte->>'obs', '')
    where id = v_id;
    if not found then raise exception 'Aporte não encontrado'; end if;
    delete from parcelas where aporte_id = v_id;
  end if;
  insert into parcelas (aporte_id, num, vencimento, valor, juros, amortizacao, recebido_em, valor_recebido, mora, obs)
  select v_id, (e->>'num')::int, (e->>'vencimento')::date, (e->>'valor')::numeric,
         coalesce((e->>'juros')::numeric, 0), coalesce((e->>'amortizacao')::numeric, 0),
         nullif(e->>'recebido_em', '')::date, nullif(e->>'valor_recebido', '')::numeric,
         coalesce(nullif(e->>'mora', '')::numeric, 0), nullif(e->>'obs', '')
  from jsonb_array_elements(p_parcelas) e;
  return v_id;
end $$;
revoke execute on function public.salvar_aporte(jsonb, jsonb) from anon;

-- Documentos dos clientes (contratos, recibos, digitalizações) ------------------------
create table if not exists documentos (
  id          uuid primary key default gen_random_uuid(),
  conta_id    uuid not null references contas(id) on delete cascade,
  cliente_id  uuid not null references clientes(id) on delete cascade,
  nome        text not null check (length(trim(nome)) > 0),
  caminho     text not null unique,
  tipo        text,
  tamanho     bigint,
  criado_em   timestamptz not null default now()
);
create index if not exists documentos_cliente_idx on documentos(cliente_id);

drop trigger if exists t1_conta on documentos;
create trigger t1_conta before insert on documentos for each row execute function preencher_conta();
drop trigger if exists t2_cliente on documentos;
create trigger t2_cliente before insert or update on documentos for each row execute function conferir_cliente_aporte();

alter table documentos enable row level security;
drop policy if exists documentos_ler on documentos;
drop policy if exists documentos_ins on documentos;
drop policy if exists documentos_del on documentos;
create policy documentos_ler on documentos for select to authenticated using (conta_id = conta_atual());
create policy documentos_ins on documentos for insert to authenticated
  with check (conta_ativa() and caminho like conta_atual()::text || '/%');
create policy documentos_del on documentos for delete to authenticated using (conta_id = conta_atual() and conta_ativa());

-- Arquivos: espaço privado "documentos"; cada conta só vê a própria pasta (<conta_id>/...).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 10485760,
        array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists aportes_docs_ler on storage.objects;
drop policy if exists aportes_docs_enviar on storage.objects;
drop policy if exists aportes_docs_apagar on storage.objects;
create policy aportes_docs_ler on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and (storage.foldername(name))[1] = public.conta_atual()::text);
create policy aportes_docs_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and (storage.foldername(name))[1] = public.conta_atual()::text and public.conta_ativa());
create policy aportes_docs_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'documentos' and (storage.foldername(name))[1] = public.conta_atual()::text and public.conta_ativa());
