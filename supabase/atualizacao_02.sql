-- Atualização 02 (novembro de 2026): notificações no celular (Web Push).
-- Às 9h (horário de Brasília) vão os vencimentos do dia e os atrasos; às 21h, os clientes de amanhã.
-- Só acrescenta; não apaga dados. Pode rodar mais de uma vez.
-- Rodar no SQL Editor do Supabase depois de publicar a função "notificar" (supabase/functions/notificar).

-- Aparelhos que ligaram as notificações (um por navegador ou celular) ---------------------------
create table if not exists push_inscricoes (
  id              uuid primary key default gen_random_uuid(),
  email           text not null check (email = lower(email)),
  conta_id        uuid not null references contas(id) on delete cascade,
  endpoint        text not null unique,
  p256dh          text not null,
  auth            text not null,
  fuso            text not null default 'America/Sao_Paulo',
  detalhes        boolean not null default true,
  aparelho        text,
  enviado_hoje    date,
  enviado_amanha  date,
  criado_em       timestamptz not null default now()
);
create index if not exists push_inscricoes_email_idx on push_inscricoes(email);
create index if not exists push_inscricoes_conta_idx on push_inscricoes(conta_id);
alter table push_inscricoes enable row level security;
drop policy if exists push_ver on push_inscricoes;
create policy push_ver on push_inscricoes for select to authenticated using (email = email_atual());
-- Gravação só pelas funções push_inscrever e push_cancelar.

-- Chave VAPID do serviço: a função "notificar" cria na primeira vez. O aplicativo só lê a parte pública.
create table if not exists push_chave (
  id         int primary key default 1 check (id = 1),
  publica    text not null,
  privada    jsonb not null,
  criado_em  timestamptz not null default now()
);
alter table push_chave enable row level security;

create or replace function public.push_chave_publica() returns text
language sql stable security definer set search_path = public as $$
  select publica from push_chave where id = 1;
$$;

-- Liga (ou atualiza) as notificações deste aparelho para a pessoa logada.
create or replace function public.push_inscrever(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_conta uuid := conta_atual();
  v_email text := email_atual();
  v_end   text := trim(coalesce(p->>'endpoint', ''));
  v_fuso  text := coalesce(nullif(trim(p->>'fuso'), ''), 'America/Sao_Paulo');
  v_id    uuid;
begin
  if v_conta is null then raise exception 'Entre numa conta do CredFlux para ligar as notificações'; end if;
  -- só os serviços de notificação dos navegadores (Google/Android, Apple, Mozilla e Microsoft)
  if v_end !~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/' then
    raise exception 'Serviço de notificação não aceito';
  end if;
  if coalesce(p->>'p256dh', '') = '' or coalesce(p->>'auth', '') = '' then raise exception 'Inscrição incompleta'; end if;
  begin perform now() at time zone v_fuso; exception when others then v_fuso := 'America/Sao_Paulo'; end;
  -- o aparelho passou para outra pessoa: sai a inscrição antiga
  delete from push_inscricoes where endpoint = v_end and email <> v_email;
  insert into push_inscricoes (email, conta_id, endpoint, p256dh, auth, fuso, detalhes, aparelho)
  values (v_email, v_conta, v_end, p->>'p256dh', p->>'auth', v_fuso, coalesce((p->>'detalhes')::boolean, true), left(p->>'aparelho', 120))
  on conflict (endpoint) do update set conta_id = excluded.conta_id, p256dh = excluded.p256dh, auth = excluded.auth,
    fuso = excluded.fuso, detalhes = excluded.detalhes, aparelho = excluded.aparelho
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.push_cancelar(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_inscricoes where endpoint = p_endpoint and email = email_atual();
$$;

-- Usadas só pela função "notificar", com a chave de serviço --------------------------------------
create or replace function public.push_chave_obter() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('publica', publica, 'privada', privada) from push_chave where id = 1;
$$;

create or replace function public.push_chave_criar(p_publica text, p_privada jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  insert into push_chave (id, publica, privada) values (1, p_publica, p_privada) on conflict (id) do nothing;
  return (select jsonb_build_object('publica', publica, 'privada', privada) from push_chave where id = 1);
end $$;

create or replace function public.push_remover(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_inscricoes where endpoint = p_endpoint;
$$;

create or replace function public.push_do_email(p_email text)
returns table (endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = public as $$
  select i.endpoint, i.p256dh, i.auth from push_inscricoes i where i.email = lower(p_email);
$$;

-- Avisos a mandar agora, no fuso de cada aparelho: das 7h às 11h, os vencimentos do dia e os atrasos;
-- das 19h às 23h, os clientes de amanhã. O agendamento abaixo roda às 9h e às 21h de Brasília.
-- Marca o envio antes de devolver, então cada aparelho recebe cada aviso uma vez por dia.
-- Só vale para quem ainda participa da conta.
create or replace function public.push_reservar(p_agora timestamptz default now())
returns table (endpoint text, p256dh text, auth text, tipo text, dia date, detalhes boolean,
               itens jsonb, atrasadas int, valor_atraso numeric)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  return query
  with locais as (
    select i.id, (p_agora at time zone i.fuso) as agora
    from push_inscricoes i
    where exists (select 1 from membros m where m.email = i.email and m.conta_id = i.conta_id)
  ), escolhidos as (
    select l.id, l.agora::date as dia,
           case when extract(hour from l.agora) between 7 and 11 then 'hoje'
                when extract(hour from l.agora) between 19 and 23 then 'amanha' end as tipo
    from locais l
  ), marcados as (
    update push_inscricoes i set
      enviado_hoje   = case when e.tipo = 'hoje'   then e.dia else i.enviado_hoje end,
      enviado_amanha = case when e.tipo = 'amanha' then e.dia else i.enviado_amanha end
    from escolhidos e
    where e.id = i.id and e.tipo is not null
      and ((e.tipo = 'hoje' and i.enviado_hoje is distinct from e.dia)
        or (e.tipo = 'amanha' and i.enviado_amanha is distinct from e.dia))
    returning i.endpoint, i.p256dh, i.auth, i.conta_id, i.detalhes, e.tipo, e.dia,
              case when e.tipo = 'hoje' then e.dia else e.dia + 1 end as alvo
  )
  select m.endpoint, m.p256dh, m.auth, m.tipo, m.dia, m.detalhes,
    coalesce((select jsonb_agg(jsonb_build_object('cliente', x.nome, 'valor', x.valor) order by x.valor desc, x.nome)
              from (select c.nome, sum(p.valor) as valor
                    from parcelas p join aportes a on a.id = p.aporte_id join clientes c on c.id = a.cliente_id
                    where p.conta_id = m.conta_id and p.recebido_em is null and p.vencimento = m.alvo
                    group by c.id, c.nome) x), '[]'::jsonb),
    case when m.tipo = 'hoje' then (select count(*)::int from parcelas p
      where p.conta_id = m.conta_id and p.recebido_em is null and p.vencimento < m.alvo) else 0 end,
    case when m.tipo = 'hoje' then (select coalesce(sum(p.valor), 0) from parcelas p
      where p.conta_id = m.conta_id and p.recebido_em is null and p.vencimento < m.alvo) else 0::numeric end
  from marcados m;
end $$;

revoke execute on function public.push_inscrever(jsonb) from anon;
revoke execute on function public.push_cancelar(text) from anon;
revoke execute on function public.push_chave_publica() from anon;
do $$
declare f text;
begin
  foreach f in array array['push_chave_obter()', 'push_chave_criar(text, jsonb)', 'push_remover(text)', 'push_do_email(text)', 'push_reservar(timestamptz)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', f);
    end if;
  end loop;
end $$;

-- AGENDA: chama a função "notificar" às 9h e às 21h de Brasília (12:00 e 00:00 UTC) ----------------
-- Para mudar os horários, troque o '0 0,12 * * *' aqui e as faixas de horário do push_reservar acima.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname = 'credflux-notificar';
select cron.schedule('credflux-notificar', '0 0,12 * * *', $agenda$
  select net.http_post(
    url := 'https://qkuzqtbqcqaavtolzree.supabase.co/functions/v1/notificar',
    body := '{"acao":"rodar"}'::jsonb,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 30000);
$agenda$);
