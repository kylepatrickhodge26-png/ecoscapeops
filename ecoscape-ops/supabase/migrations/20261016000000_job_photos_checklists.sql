-- EcoScape Ops job photos and checklists.
--
-- Photos
--   * Files live in a PRIVATE Supabase Storage bucket ("job-photos") at
--     <business_id>/<job_id>/<random>.<ext>. Storage's own row-level security decides who can
--     read, add or remove a file: a business's owner for any job in the business, and a crew
--     member only for jobs assigned to them. Nobody else, signed in or not, can open a file.
--   * A job_photos row holds the photo's kind (before/after/other), caption and who took it. Rows
--     are created through add_job_photo(), which checks the caller can use that job and that the
--     file really is in storage at the right path.
--   * Free-tier friendly: the bucket refuses files over 5 MB and non-images; the app shrinks every
--     photo in the browser before uploading (about 0.3 MB each), and a job holds at most 30.
--
-- Checklists
--   * The owner writes a checklist template per service name ("Mow, edge, blow, bag clippings").
--     Each NEW visit of that service gets its own copy of the items, and saving a template also
--     gives it to the service's upcoming visits that have no checklist yet. Crew and the owner tick
--     items off; each item remembers who ticked it and when.
--   * Crew read and tick only the checklists and photos of jobs assigned to them, through functions.
--     They get no table access, and never see prices.

-- ---------------------------------------------------------------------------
-- Who may use a job: the owner of its business, or the crew member it is assigned to.
-- ---------------------------------------------------------------------------
create function private.can_use_job(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.jobs j
    where j.id = p_job_id
      and (
        j.business_id in (select private.owner_business_ids())
        or j.assigned_crew_member_id = private.my_crew_member_id()
      )
  );
$$;

revoke execute on function private.can_use_job(uuid) from public;
grant execute on function private.can_use_job(uuid) to authenticated;

-- Storage paths are <business_id>/<job_id>/<file>. True when the caller may use that job and
-- the business folder matches the job's business.
create function private.can_use_job_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m text[] := regexp_match(p_name, '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[A-Za-z0-9._-]{1,100}$');
begin
  if m is null then
    return false;
  end if;
  return exists (
    select 1 from public.jobs j
    where j.id = m[2]::uuid and j.business_id = m[1]::uuid
  ) and private.can_use_job(m[2]::uuid);
end;
$$;

revoke execute on function private.can_use_job_path(text) from public;
grant execute on function private.can_use_job_path(text) to authenticated;

-- ---------------------------------------------------------------------------
-- The private bucket and its access rules
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-photos', 'job-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create policy "Job photos: read for jobs you can use"
  on storage.objects for select to authenticated
  using (bucket_id = 'job-photos' and private.can_use_job_path(name));

create policy "Job photos: add for jobs you can use"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'job-photos' and private.can_use_job_path(name));

-- Only a business's owner removes files (even of jobs that no longer exist).
create policy "Job photos: owners remove their business's files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'job-photos'
    and (storage.foldername(name))[1] in (select o::text from private.owner_business_ids() o)
  );

-- ---------------------------------------------------------------------------
-- Photo records
-- ---------------------------------------------------------------------------
create type public.photo_kind as enum ('before', 'after', 'other');

create table public.job_photos (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  job_id uuid not null,
  storage_path text not null unique,
  kind public.photo_kind not null default 'other',
  caption text not null default '',
  size_bytes bigint not null default 0,
  uploaded_by uuid references auth.users (id) on delete set null,
  uploaded_by_name text not null default '',
  created_at timestamptz not null default now(),

  foreign key (job_id, business_id) references public.jobs (id, business_id) on delete cascade,
  constraint job_photos_id_business_unique unique (id, business_id),
  constraint job_photos_path_matches_job check (storage_path like business_id::text || '/' || job_id::text || '/%'),
  constraint job_photos_caption_length check (char_length(caption) <= 200)
);

create index job_photos_job_idx on public.job_photos (job_id, created_at);
create index job_photos_business_idx on public.job_photos (business_id);

create trigger job_photos_business_id_immutable
  before update on public.job_photos
  for each row execute function private.prevent_business_id_change();

-- The caller's name as the crew list knows it (the owner is on the crew too).
create function private.my_crew_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.name from public.crew_members c where c.user_id = (select auth.uid())), 'Unknown');
$$;

revoke execute on function private.my_crew_name() from public;

create function public.add_job_photo(job_id uuid, storage_path text, kind public.photo_kind, caption text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.jobs;
  size bigint;
  new_id uuid;
begin
  select * into job from public.jobs j where j.id = add_job_photo.job_id;
  if not found or not private.can_use_job(add_job_photo.job_id) then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if add_job_photo.storage_path not like job.business_id::text || '/' || job.id::text || '/%' then
    raise exception 'That photo doesn''t belong to this job' using errcode = '22023';
  end if;
  if char_length(coalesce(add_job_photo.caption, '')) > 200 then
    raise exception 'Captions must be 200 characters or fewer' using errcode = '22023';
  end if;
  if (select count(*) from public.job_photos p where p.job_id = job.id) >= 30 then
    raise exception 'A job can have at most 30 photos' using errcode = '22023';
  end if;

  select coalesce((o.metadata ->> 'size')::bigint, 0) into size
  from storage.objects o
  where o.bucket_id = 'job-photos' and o.name = add_job_photo.storage_path;
  if not found then
    raise exception 'That photo hasn''t finished uploading' using errcode = '22023';
  end if;

  insert into public.job_photos (business_id, job_id, storage_path, kind, caption, size_bytes, uploaded_by, uploaded_by_name)
  values (
    job.business_id, job.id, add_job_photo.storage_path, add_job_photo.kind,
    btrim(coalesce(add_job_photo.caption, '')), size, (select auth.uid()), private.my_crew_name()
  )
  returning id into new_id;
  return new_id;
exception
  when unique_violation then
    raise exception 'That photo is already added' using errcode = '22023';
end;
$$;

-- Owner only. Returns the file's path so the app can remove the file from storage too.
create function public.delete_job_photo(photo_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
  path text;
begin
  delete from public.job_photos p
  where p.id = delete_job_photo.photo_id and p.business_id = biz
  returning p.storage_path into path;
  if path is null then
    raise exception 'Photo not found' using errcode = 'P0002';
  end if;
  return path;
end;
$$;

-- A job's photos, for the owner or the crew member it's assigned to.
create function public.job_photos_for(job_id uuid)
returns table (
  id uuid,
  storage_path text,
  kind public.photo_kind,
  caption text,
  uploaded_by_name text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.storage_path, p.kind, p.caption, p.uploaded_by_name, p.created_at
  from public.job_photos p
  where p.job_id = job_photos_for.job_id and private.can_use_job(p.job_id)
  order by p.created_at;
$$;

-- Owner only: how much storage the business's photos use (the free plan includes 1 GB).
create function public.photo_usage()
returns table (photo_count bigint, total_bytes bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
begin
  return query
    select count(*), coalesce(sum(p.size_bytes), 0)::bigint from public.job_photos p where p.business_id = biz;
end;
$$;

-- ---------------------------------------------------------------------------
-- Checklist templates and the copies on each visit
-- ---------------------------------------------------------------------------
create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  service_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint checklist_templates_id_business_unique unique (id, business_id),
  constraint checklist_templates_service_length check (char_length(btrim(service_name)) between 1 and 100)
);

-- One checklist per service name per business (names compare without case or edge spaces).
create unique index checklist_templates_service_unique
  on public.checklist_templates (business_id, lower(btrim(service_name)));

create trigger checklist_templates_set_updated_at
  before update on public.checklist_templates
  for each row execute function private.set_updated_at();

create trigger checklist_templates_business_id_immutable
  before update on public.checklist_templates
  for each row execute function private.prevent_business_id_change();

create table public.checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  template_id uuid not null,
  position integer not null,
  label text not null,

  foreign key (template_id, business_id) references public.checklist_templates (id, business_id) on delete cascade,
  constraint checklist_template_items_label_length check (char_length(btrim(label)) between 1 and 120)
);

create index checklist_template_items_template_idx on public.checklist_template_items (template_id, position);

create trigger checklist_template_items_business_id_immutable
  before update on public.checklist_template_items
  for each row execute function private.prevent_business_id_change();

create table public.job_checklist_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  job_id uuid not null,
  position integer not null,
  label text not null,
  done boolean not null default false,
  done_at timestamptz,
  done_by uuid references auth.users (id) on delete set null,
  done_by_name text not null default '',

  foreign key (job_id, business_id) references public.jobs (id, business_id) on delete cascade,
  constraint job_checklist_items_id_business_unique unique (id, business_id),
  constraint job_checklist_items_label_length check (char_length(btrim(label)) between 1 and 120)
);

create index job_checklist_items_job_idx on public.job_checklist_items (job_id, position);

create trigger job_checklist_items_business_id_immutable
  before update on public.job_checklist_items
  for each row execute function private.prevent_business_id_change();

-- Gives a job a copy of its service's checklist (if the service has one and the job has none).
create function private.copy_checklist_to_job(p_job public.jobs)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.job_checklist_items i where i.job_id = p_job.id) then
    return;
  end if;
  insert into public.job_checklist_items (business_id, job_id, position, label)
  select p_job.business_id, p_job.id, ti.position, ti.label
  from public.checklist_templates t
  join public.checklist_template_items ti on ti.template_id = t.id and ti.business_id = t.business_id
  where t.business_id = p_job.business_id
    and lower(btrim(t.service_name)) = lower(btrim(p_job.service_name))
  order by ti.position;
end;
$$;

revoke execute on function private.copy_checklist_to_job(public.jobs) from public;

create function private.job_created_copy_checklist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.copy_checklist_to_job(new);
  return null;
end;
$$;

revoke execute on function private.job_created_copy_checklist() from public;

create trigger jobs_copy_checklist
  after insert on public.jobs
  for each row execute function private.job_created_copy_checklist();

-- Owner: set (or clear) the checklist for a service. p_items is a JSON array of strings, in
-- order; an empty array removes the checklist. Upcoming visits of the service that have no
-- checklist yet get it. Returns the template's id (null when removed).
create function public.save_checklist_template(service_name text, items jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
  today date := private.business_today(biz);
  svc text := btrim(coalesce(save_checklist_template.service_name, ''));
  tpl public.checklist_templates;
  item jsonb;
  pos integer := 0;
  label text;
  j public.jobs;
begin
  if svc = '' or char_length(svc) > 100 then
    raise exception 'Enter the service''s name (up to 100 characters)' using errcode = '22023';
  end if;
  if jsonb_typeof(save_checklist_template.items) is distinct from 'array' then
    raise exception 'The checklist must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(save_checklist_template.items) > 30 then
    raise exception 'A checklist can have at most 30 items' using errcode = '22023';
  end if;

  select * into tpl from public.checklist_templates t
  where t.business_id = biz and lower(btrim(t.service_name)) = lower(svc)
  for update;

  if jsonb_array_length(save_checklist_template.items) = 0 then
    if found then
      delete from public.checklist_templates t where t.id = tpl.id;
    end if;
    return null;
  end if;

  if not found then
    insert into public.checklist_templates (business_id, service_name) values (biz, svc) returning * into tpl;
  else
    update public.checklist_templates t set service_name = svc where t.id = tpl.id;
    delete from public.checklist_template_items ti where ti.template_id = tpl.id;
  end if;

  for item in select * from jsonb_array_elements(save_checklist_template.items) loop
    if jsonb_typeof(item) <> 'string' then
      raise exception 'Each checklist item must be text' using errcode = '22023';
    end if;
    label := btrim(item #>> '{}');
    if label = '' or char_length(label) > 120 then
      raise exception 'Each checklist item must be 1 to 120 characters' using errcode = '22023';
    end if;
    insert into public.checklist_template_items (business_id, template_id, position, label)
    values (biz, tpl.id, pos, label);
    pos := pos + 1;
  end loop;

  -- Upcoming visits that haven't been started and have no checklist get it now.
  for j in
    select * from public.jobs x
    where x.business_id = biz
      and lower(btrim(x.service_name)) = lower(svc)
      and x.scheduled_date >= today
      and x.status in ('scheduled', 'assigned')
  loop
    perform private.copy_checklist_to_job(j);
  end loop;

  return tpl.id;
end;
$$;

-- A job's checklist, for the owner or the crew member it's assigned to.
create function public.job_checklist(job_id uuid)
returns table (
  id uuid,
  "position" integer,
  label text,
  done boolean,
  done_at timestamptz,
  done_by_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.position, i.label, i.done, i.done_at, i.done_by_name
  from public.job_checklist_items i
  where i.job_id = job_checklist.job_id and private.can_use_job(i.job_id)
  order by i.position;
$$;

-- Tick or untick an item, as the owner or the crew member the job is assigned to.
create function public.set_checklist_item(item_id uuid, done boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.job_checklist_items;
  job_status public.job_status;
begin
  select * into item from public.job_checklist_items i where i.id = set_checklist_item.item_id for update;
  if not found or not private.can_use_job(item.job_id) then
    raise exception 'Checklist item not found' using errcode = 'P0002';
  end if;
  select j.status into job_status from public.jobs j where j.id = item.job_id;
  if job_status = 'cancelled' then
    raise exception 'This job is cancelled' using errcode = '22023';
  end if;
  if set_checklist_item.done is null then
    raise exception 'Tick or untick' using errcode = '22023';
  end if;

  if set_checklist_item.done then
    update public.job_checklist_items i
    set done = true, done_at = now(), done_by = (select auth.uid()), done_by_name = private.my_crew_name()
    where i.id = item.id;
  else
    update public.job_checklist_items i
    set done = false, done_at = null, done_by = null, done_by_name = ''
    where i.id = item.id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security: owners read; functions write.
-- ---------------------------------------------------------------------------
revoke all on public.job_photos, public.checklist_templates, public.checklist_template_items, public.job_checklist_items
  from anon, authenticated;
grant select on public.job_photos, public.checklist_templates, public.checklist_template_items, public.job_checklist_items
  to authenticated;

alter table public.job_photos enable row level security;
alter table public.checklist_templates enable row level security;
alter table public.checklist_template_items enable row level security;
alter table public.job_checklist_items enable row level security;

create policy "Owners can view their job photos"
  on public.job_photos for select to authenticated
  using (business_id in (select private.owner_business_ids()));

create policy "Owners can view their checklist templates"
  on public.checklist_templates for select to authenticated
  using (business_id in (select private.owner_business_ids()));

create policy "Owners can view their checklist template items"
  on public.checklist_template_items for select to authenticated
  using (business_id in (select private.owner_business_ids()));

create policy "Owners can view their job checklist items"
  on public.job_checklist_items for select to authenticated
  using (business_id in (select private.owner_business_ids()));

revoke execute on function public.add_job_photo(uuid, text, public.photo_kind, text) from public, anon;
revoke execute on function public.delete_job_photo(uuid) from public, anon;
revoke execute on function public.job_photos_for(uuid) from public, anon;
revoke execute on function public.photo_usage() from public, anon;
revoke execute on function public.save_checklist_template(text, jsonb) from public, anon;
revoke execute on function public.job_checklist(uuid) from public, anon;
revoke execute on function public.set_checklist_item(uuid, boolean) from public, anon;
grant execute on function public.add_job_photo(uuid, text, public.photo_kind, text) to authenticated;
grant execute on function public.delete_job_photo(uuid) to authenticated;
grant execute on function public.job_photos_for(uuid) to authenticated;
grant execute on function public.photo_usage() to authenticated;
grant execute on function public.save_checklist_template(text, jsonb) to authenticated;
grant execute on function public.job_checklist(uuid) to authenticated;
grant execute on function public.set_checklist_item(uuid, boolean) to authenticated;
