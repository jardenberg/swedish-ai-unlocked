
create extension if not exists vector;

-- Roles
create type public.app_role as enum ('admin', 'user');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique(user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists(select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "Users see own roles" on public.user_roles
  for select to authenticated using (auth.uid() = user_id);

-- Sources
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  root_url text not null,
  url_filter_patterns text[] not null default '{}',
  exclude_patterns text[] not null default '{}',
  created_at timestamptz not null default now()
);
grant select on public.sources to anon, authenticated;
grant all on public.sources to service_role;
alter table public.sources enable row level security;
create policy "Sources public read" on public.sources for select using (true);
create policy "Admins manage sources" on public.sources for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- Documents
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  url text unique not null,
  title text,
  lang text,
  content_type text not null default 'html', -- 'html' | 'pdf'
  raw_markdown text,
  token_count int,
  sitemap_lastmod timestamptz,
  fetched_at timestamptz,
  status text not null default 'pending', -- pending|scraped|embedded|failed|skipped
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index documents_source_idx on public.documents(source_id);
create index documents_status_idx on public.documents(status);
create index documents_lang_idx on public.documents(lang);
grant select on public.documents to anon, authenticated;
grant all on public.documents to service_role;
alter table public.documents enable row level security;
create policy "Docs public read" on public.documents for select using (status = 'embedded');
create policy "Admins manage docs" on public.documents for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- Chunks
create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  ord int not null,
  text text not null,
  token_count int,
  embedding vector(1536),
  created_at timestamptz not null default now()
);
create index chunks_document_idx on public.chunks(document_id);
create index chunks_embedding_idx on public.chunks using hnsw (embedding vector_cosine_ops);
grant select on public.chunks to anon, authenticated;
grant all on public.chunks to service_role;
alter table public.chunks enable row level security;
create policy "Chunks public read" on public.chunks for select using (true);
create policy "Admins manage chunks" on public.chunks for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- Ingest runs
create table public.ingest_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.sources(id) on delete cascade,
  kind text not null, -- map | scrape | embed | refresh
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  mapped int default 0,
  scraped int default 0,
  embedded int default 0,
  skipped int default 0,
  failed int default 0,
  credits_used int default 0,
  notes text
);
grant all on public.ingest_runs to service_role;
alter table public.ingest_runs enable row level security;
create policy "Admins read runs" on public.ingest_runs for select to authenticated
  using (public.has_role(auth.uid(),'admin'));

-- Rate limits (per IP, per minute bucket)
create table public.rate_limits (
  ip text not null,
  window_start timestamptz not null,
  count int not null default 1,
  primary key (ip, window_start)
);
grant all on public.rate_limits to service_role;
alter table public.rate_limits enable row level security;

-- Search function (cosine similarity)
create or replace function public.match_chunks(
  query_embedding vector(1536),
  match_count int default 10,
  filter_source uuid default null,
  filter_lang text default null
)
returns table (
  chunk_id uuid,
  document_id uuid,
  url text,
  title text,
  lang text,
  source_slug text,
  source_name text,
  snippet text,
  similarity float,
  fetched_at timestamptz
)
language sql stable
as $$
  select c.id, d.id, d.url, d.title, d.lang, s.slug, s.name,
         substring(c.text from 1 for 600) as snippet,
         1 - (c.embedding <=> query_embedding) as similarity,
         d.fetched_at
  from public.chunks c
  join public.documents d on d.id = c.document_id
  join public.sources s on s.id = d.source_id
  where d.status = 'embedded'
    and (filter_source is null or d.source_id = filter_source)
    and (filter_lang is null or d.lang = filter_lang)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
grant execute on function public.match_chunks to anon, authenticated, service_role;

-- Seed sources
insert into public.sources (slug, name, root_url, url_filter_patterns, exclude_patterns) values
  ('rise', 'RISE', 'https://www.ri.se',
   array['artificial-intelligence','/ai-','-ai-','/ai/','machine-learning','maskininlarning','sprakmodell','language-model','generativ','deep-learning','/en/artificial-intelligence','/sv/ai-'],
   array['/events/','/event/']),
  ('ai_sweden', 'AI Sweden', 'https://www.ai.se',
   array['/project','/adoption','/ai-labs','/sector','/ecosystem','/news','/blogpost','/research','/report','/about','/data-factory','/language-models'],
   array['/events/','/event/','my.ai.se']);
