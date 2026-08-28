-- idea_queue — fila curada de ideias via Telegram (ADR-007)

create table idea_queue (
  id uuid primary key default gen_random_uuid(),
  briefing text not null,
  niche text not null,
  category text,
  product_url text,
  product_image_url text, -- imagem oficial do afiliado: prioridade 1 no hook (ADR-009)
  priority int not null default 100, -- menor = consumido primeiro
  status text not null default 'pending' check (status in ('pending','consumed','rejected')),
  episode_id uuid references episodes(id) on delete set null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  constraint consumed_requires_episode
    check (status <> 'consumed' or (episode_id is not null and consumed_at is not null))
);

-- consumo O(1) mesmo com fila grande
create index idx_idea_queue_pending on idea_queue(priority, created_at) where status = 'pending';
create index idx_idea_queue_episode_id on idea_queue(episode_id);

alter table idea_queue enable row level security;

-- ============================================================
-- consume_next_idea: consumo ATÔMICO (ADR-007).
-- FOR UPDATE SKIP LOCKED evita corrida entre invocações paralelas;
-- criar episódio + marcar consumed na mesma transação — falha = rollback,
-- a ideia volta para a fila sem intervenção manual.
-- ============================================================
create or replace function consume_next_idea()
returns table (episode_id uuid, idea_id uuid) as $$
#variable_conflict use_column
declare
  v_idea idea_queue%rowtype;
  v_episode_id uuid;
begin
  select * into v_idea
  from idea_queue
  where status = 'pending'
  order by priority, created_at
  limit 1
  for update skip locked;

  if not found then
    return;
  end if;

  insert into episodes (status, briefing, product_compliance, product_image_url)
  values (
    'idea',
    jsonb_build_object(
      'text', v_idea.briefing,
      'niche', v_idea.niche,
      'category', v_idea.category,
      'idea_id', v_idea.id
    ),
    case
      when v_idea.product_url is not null then
        jsonb_build_object('affiliate_link', v_idea.product_url, 'commercial_content', true)
      else null
    end,
    v_idea.product_image_url
  )
  returning id into v_episode_id;

  update idea_queue
  set status = 'consumed', consumed_at = now(), episode_id = v_episode_id
  where id = v_idea.id;

  return query select v_episode_id, v_idea.id;
end;
$$ language plpgsql;
