-- ADR-027: catálogo de produtos elegíveis para afiliação.
-- O serviço grava somente snapshots retornados pelo provedor; links continuam
-- sujeitos a revisão humana antes de entrarem em um episódio.

create table if not exists public.affiliate_products (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('tiktok_shop', 'manual')),
  external_product_id text not null,
  title text not null,
  product_url text,
  affiliate_url text,
  image_url text,
  currency text,
  price numeric,
  commission_rate numeric,
  units_sold bigint,
  category_id text,
  raw_data jsonb not null default '{}'::jsonb,
  eligible boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_product_id)
);

create index if not exists affiliate_products_provider_eligible
  on public.affiliate_products(provider, eligible, last_seen_at desc);

alter table public.affiliate_products enable row level security;

create or replace function public.touch_affiliate_product_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  new.last_seen_at = now();
  return new;
end;
$$;

drop trigger if exists affiliate_products_updated_at on public.affiliate_products;
create trigger affiliate_products_updated_at
before update on public.affiliate_products
for each row execute function public.touch_affiliate_product_updated_at();

revoke all on public.affiliate_products from public, anon, authenticated;
grant select, insert, update on public.affiliate_products to service_role;
