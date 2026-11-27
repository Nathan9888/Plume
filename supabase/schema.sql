-- Plume : schéma de synchronisation pour Supabase.
-- À exécuter UNE seule fois : Supabase → SQL Editor → New query → coller tout ce fichier → Run.
-- Sans danger si on le relance : il ne détruit rien.

-- Documents (un par ligne ; « deleted » sert à propager les suppressions entre appareils)
create table if not exists public.plume_documents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null default 'Sans titre',
  preview     text not null default '',
  body        text not null default '',
  encrypted   boolean not null default false,
  rev         integer not null default 1,
  deleted     boolean not null default false,
  device      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- (pour une base créée avec une version précédente de ce fichier)
alter table public.plume_documents add column if not exists preview text not null default '';

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

-- =====================================================================================================
-- PARTAGE (Plume 1.7) : annuaire des noms, partages par document avec un rôle, présence (curseurs en direct)
-- Sans danger si on relance ce fichier. À exécuter après la partie ci-dessus (même fenêtre « SQL Editor »).
-- =====================================================================================================

-- Annuaire : chaque compte y publie le NOM sous lequel on peut le trouver pour partager (jamais le courriel)
create table if not exists public.plume_directory (
  user_id     uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  name_key    text not null default '',
  color       text not null default '#4f8cff',
  updated_at  timestamptz not null default now()
);
create unique index if not exists plume_directory_name_key on public.plume_directory (name_key);

-- Partages : un document, un destinataire, un rôle (edit = Édition, suggest = Suggestion, view = Lecture)
create table if not exists public.plume_shares (
  doc_id      uuid not null references public.plume_documents(id) on delete cascade,
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('edit', 'suggest', 'view')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (doc_id, user_id)
);
create index if not exists plume_shares_user on public.plume_shares (user_id);

-- Présence : où se trouve le curseur de chaque personne qui a le document ouvert (lignes éphémères)
create table if not exists public.plume_presence (
  doc_id      uuid not null references public.plume_documents(id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null default '',
  color       text not null default '#4f8cff',
  role        text not null default 'edit',
  cursor      jsonb,
  updated_at  timestamptz not null default now(),
  primary key (doc_id, user_id)
);

-- La clé de recherche du nom (minuscules, sans espaces autour) est calculée par le serveur
create or replace function public.plume_dir_key() returns trigger
language plpgsql as $$
begin
  new.name := btrim(new.name);
  new.name_key := lower(new.name);
  return new;
end $$;
drop trigger if exists plume_directory_key on public.plume_directory;
create trigger plume_directory_key before insert or update on public.plume_directory
  for each row execute function public.plume_dir_key();

drop trigger if exists plume_directory_touch on public.plume_directory;
create trigger plume_directory_touch before insert or update on public.plume_directory
  for each row execute function public.plume_touch();
drop trigger if exists plume_shares_touch on public.plume_shares;
create trigger plume_shares_touch before insert or update on public.plume_shares
  for each row execute function public.plume_touch();
drop trigger if exists plume_presence_touch on public.plume_presence;
create trigger plume_presence_touch before insert or update on public.plume_presence
  for each row execute function public.plume_touch();

-- Fonctions d'aide (SECURITY DEFINER : elles évitent les boucles entre les politiques de sécurité)
create or replace function public.plume_is_owner(d uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.plume_documents where id = d and user_id = auth.uid())
$$;
create or replace function public.plume_my_role(d uuid) returns text
language sql security definer stable set search_path = public as $$
  select role from public.plume_shares where doc_id = d and user_id = auth.uid()
$$;
grant execute on function public.plume_is_owner(uuid) to authenticated;
grant execute on function public.plume_my_role(uuid) to authenticated;

-- Quand un accès est retiré (ou quitté), la présence de la personne dans ce document disparaît aussitôt
create or replace function public.plume_share_gone() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.plume_presence where doc_id = old.doc_id and user_id = old.user_id;
  return old;
end $$;
drop trigger if exists plume_shares_gone on public.plume_shares;
create trigger plume_shares_gone after delete on public.plume_shares
  for each row execute function public.plume_share_gone();

-- Un destinataire ne peut ni s'approprier un document, ni le supprimer
create or replace function public.plume_doc_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and auth.uid() is not null and old.user_id <> auth.uid() then
    new.user_id := old.user_id;
    new.deleted := old.deleted;
  end if;
  return new;
end $$;
drop trigger if exists plume_documents_guard on public.plume_documents;
create trigger plume_documents_guard before update on public.plume_documents
  for each row execute function public.plume_doc_guard();

alter table public.plume_directory enable row level security;
alter table public.plume_shares    enable row level security;
alter table public.plume_presence  enable row level security;

-- Documents : en plus du propriétaire, les personnes avec qui le document est partagé le lisent ; Édition et Suggestion l'enregistrent
drop policy if exists plume_documents_shared_read on public.plume_documents;
create policy plume_documents_shared_read on public.plume_documents
  for select to authenticated
  using (public.plume_my_role(id) is not null);
drop policy if exists plume_documents_shared_write on public.plume_documents;
create policy plume_documents_shared_write on public.plume_documents
  for update to authenticated
  using (public.plume_my_role(id) in ('edit', 'suggest'))
  with check (public.plume_my_role(id) in ('edit', 'suggest'));

-- Annuaire : tout compte connecté peut chercher un nom ; chacun n'écrit que sa propre ligne
drop policy if exists plume_directory_read on public.plume_directory;
create policy plume_directory_read on public.plume_directory for select to authenticated using (true);
drop policy if exists plume_directory_write on public.plume_directory;
create policy plume_directory_write on public.plume_directory
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Partages : le propriétaire du document gère ; le destinataire voit sa ligne et peut la quitter
drop policy if exists plume_shares_read on public.plume_shares;
create policy plume_shares_read on public.plume_shares
  for select to authenticated using ((select auth.uid()) = owner_id or (select auth.uid()) = user_id);
drop policy if exists plume_shares_insert on public.plume_shares;
create policy plume_shares_insert on public.plume_shares
  for insert to authenticated with check ((select auth.uid()) = owner_id and public.plume_is_owner(doc_id));
drop policy if exists plume_shares_update on public.plume_shares;
create policy plume_shares_update on public.plume_shares
  for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
drop policy if exists plume_shares_delete on public.plume_shares;
create policy plume_shares_delete on public.plume_shares
  for delete to authenticated using ((select auth.uid()) = owner_id or (select auth.uid()) = user_id);

-- Présence : visible par le propriétaire et les destinataires du document ; chacun écrit la sienne
drop policy if exists plume_presence_read on public.plume_presence;
create policy plume_presence_read on public.plume_presence
  for select to authenticated using (public.plume_is_owner(doc_id) or public.plume_my_role(doc_id) is not null);
drop policy if exists plume_presence_write on public.plume_presence;
create policy plume_presence_write on public.plume_presence
  for all to authenticated
  using ((select auth.uid()) = user_id and (public.plume_is_owner(doc_id) or public.plume_my_role(doc_id) is not null))
  with check ((select auth.uid()) = user_id and (public.plume_is_owner(doc_id) or public.plume_my_role(doc_id) is not null));

grant select, insert, update, delete on public.plume_directory to authenticated;
grant select, insert, update, delete on public.plume_shares    to authenticated;
grant select, insert, update, delete on public.plume_presence  to authenticated;
