-- Plume : schéma de synchronisation pour Supabase.
-- À exécuter UNE seule fois : Supabase → SQL Editor → New query → coller tout ce fichier → Run.
-- Sans danger si on le relance : il ne détruit rien.

-- Documents (un par ligne ; « deleted » sert à propager les suppressions entre appareils)
create table if not exists public.plume_documents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null default 'Sans titre',
  body        text not null default '',
  encrypted   boolean not null default false,
  rev         integer not null default 1,
  deleted     boolean not null default false,
  device      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists plume_documents_user_updated on public.plume_documents (user_id, updated_at desc);

-- Profil et réglages (une ligne par compte)
create table if not exists public.plume_profile (
  user_id     uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  author      text,
  settings    jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- L'heure de modification est fixée par le serveur (pas par l'horloge de l'appareil)
create or replace function public.plume_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists plume_documents_touch on public.plume_documents;
create trigger plume_documents_touch before insert or update on public.plume_documents
  for each row execute function public.plume_touch();

drop trigger if exists plume_profile_touch on public.plume_profile;
create trigger plume_profile_touch before insert or update on public.plume_profile
  for each row execute function public.plume_touch();

-- Sécurité : chaque compte ne voit et ne modifie que ses propres lignes
alter table public.plume_documents enable row level security;
alter table public.plume_profile   enable row level security;

drop policy if exists plume_documents_owner on public.plume_documents;
create policy plume_documents_owner on public.plume_documents
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists plume_profile_owner on public.plume_profile;
create policy plume_profile_owner on public.plume_profile
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.plume_documents to authenticated;
grant select, insert, update, delete on public.plume_profile   to authenticated;
