-- Search and FAQ.
--
-- 1. search_everything(q): the owner's one search box. Finds customers, visits, quotes,
--    invoices and requests in the owner's own business by name, phone, street, email,
--    service or number. Owner only: crew members and signed-out visitors get nothing.
-- 2. faq_items: questions and answers the owner writes for their customers. The owner reads
--    and changes them; customers read them on their account page and on the business's
--    request form, through functions that return only that business's questions.

-- ---------------------------------------------------------------------------
-- Search
-- ---------------------------------------------------------------------------
create function public.search_everything(q text)
returns table (
  kind text,
  id uuid,
  title text,
  detail text,
  on_date date,
  status text,
  amount numeric,
  number integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
  term text := left(btrim(regexp_replace(coalesce(q, ''), '\s+', ' ', 'g')), 100);
  pattern text;
  digits text;
  num integer;
  today date := private.business_today(biz);
begin
  if char_length(term) < 2 then
    return;
  end if;
  -- What was typed is matched as plain text: % and _ are not wildcards.
  pattern := '%' || replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  -- Phone numbers match on their digits, but only when what was typed looks like a phone
  -- number, so "123 Main St" doesn't match every phone with 123 in it.
  digits := regexp_replace(term, '\D', '', 'g');
  if term !~ '^[0-9 ()+.-]+$' or char_length(digits) < 3 then
    digits := null;
  end if;
  -- "#12", "Q-12", "invoice 12", "12" can all mean number 12.
  if term ~* '^(#|q-?|quote\s*#?|invoice\s*#?)?\s*\d{1,9}$' then
    num := regexp_replace(term, '\D', '', 'g')::integer;
  end if;

  return query
  select 'customer'::text, c.id, private.customer_label(c),
         concat_ws(' · ', nullif(c.property_address, ''), nullif(c.phone, ''), nullif(c.email, '')),
         null::date, c.status, null::numeric, null::integer
  from public.customers c
  where c.business_id = biz
    and (concat_ws(' ', c.first_name, c.last_name) ilike pattern
         or c.property_address ilike pattern
         or c.email ilike pattern
         or (digits is not null and c.phone_digits like '%' || digits || '%'))
  order by lower(private.customer_label(c)), c.id
  limit 20;

  -- Visits closest to today first, so a customer's next and last visits come up.
  return query
  select 'visit'::text, j.id, private.customer_label(c), j.service_name, j.scheduled_date,
         j.status::text, j.price, null::integer
  from public.jobs j
  join public.customers c on c.id = j.customer_id and c.business_id = j.business_id
  where j.business_id = biz
    and (j.service_name ilike pattern
         or concat_ws(' ', c.first_name, c.last_name) ilike pattern
         or c.property_address ilike pattern
         or (digits is not null and c.phone_digits like '%' || digits || '%'))
  order by abs(j.scheduled_date - today), j.scheduled_date desc, j.id
  limit 12;

  return query
  select 'quote'::text, qt.id,
         coalesce(case when c.id is not null then private.customer_label(c) end, nullif(qt.prospect_name, ''), nullif(qt.prospect_phone, ''), 'No name'),
         qt.title, qt.issue_date, public.quote_status_shown(qt), qt.total, qt.number
  from public.quotes qt
  left join public.customers c on c.id = qt.customer_id and c.business_id = qt.business_id
  where qt.business_id = biz
    and (qt.number = num
         or qt.title ilike pattern
         or qt.prospect_name ilike pattern
         or qt.prospect_address ilike pattern
         or qt.prospect_email ilike pattern
         or (digits is not null and regexp_replace(qt.prospect_phone, '\D', '', 'g') like '%' || digits || '%')
         or concat_ws(' ', c.first_name, c.last_name) ilike pattern
         or c.property_address ilike pattern
         or (digits is not null and c.phone_digits like '%' || digits || '%'))
  order by qt.number desc
  limit 10;

  return query
  select 'invoice'::text, i.id, private.customer_label(c), null::text, i.issue_date,
         public.display_status(i), i.total, i.number
  from public.invoices i
  join public.customers c on c.id = i.customer_id and c.business_id = i.business_id
  where i.business_id = biz
    and (i.number = num
         or concat_ws(' ', c.first_name, c.last_name) ilike pattern
         or c.property_address ilike pattern
         or (digits is not null and c.phone_digits like '%' || digits || '%'))
  order by i.number desc
  limit 10;

  return query
  select 'request'::text, r.id, coalesce(nullif(r.name, ''), nullif(r.phone, ''), nullif(r.email, ''), 'No name'),
         r.address, (r.created_at at time zone b.time_zone)::date, r.status::text, null::numeric, null::integer
  from public.requests r
  join public.businesses b on b.id = r.business_id
  where r.business_id = biz
    and (r.name ilike pattern
         or r.address ilike pattern
         or r.email ilike pattern
         or r.details ilike pattern
         or (digits is not null and regexp_replace(r.phone, '\D', '', 'g') like '%' || digits || '%'))
  order by r.created_at desc
  limit 10;
end;
$$;

revoke execute on function public.search_everything(text) from public, anon;
grant execute on function public.search_everything(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Customer FAQ
-- ---------------------------------------------------------------------------
create table public.faq_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  question text not null,
  answer text not null,
  -- Order shown to customers, lowest first. Set by the database.
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint faq_items_question_length check (char_length(btrim(question)) between 1 and 200),
  constraint faq_items_answer_length check (char_length(btrim(answer)) between 1 and 2000)
);

create index faq_items_business_position_idx on public.faq_items (business_id, position);

create trigger faq_items_set_updated_at
  before update on public.faq_items
  for each row execute function private.set_updated_at();

create trigger faq_items_business_id_immutable
  before update on public.faq_items
  for each row execute function private.prevent_business_id_change();

-- New questions go to the end, and a business keeps at most 50.
create function private.faq_item_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing integer;
  last_position integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('faq:' || new.business_id::text, 0));
  select count(*), coalesce(max(f.position), 0) into existing, last_position
  from public.faq_items f where f.business_id = new.business_id;
  if existing >= 50 then
    raise exception 'You can have up to 50 questions' using errcode = '22023';
  end if;
  new.position := last_position + 1;
  return new;
end;
$$;

revoke execute on function private.faq_item_added() from public;

create trigger faq_items_add_at_end
  before insert on public.faq_items
  for each row execute function private.faq_item_added();

-- The owner reads and changes their questions; nobody else touches the table.
revoke all on public.faq_items from anon, authenticated;
grant select, insert, delete on public.faq_items to authenticated;
grant update (question, answer) on public.faq_items to authenticated;
alter table public.faq_items enable row level security;

create policy "Owners can view their FAQ"
  on public.faq_items for select to authenticated
  using (business_id in (select private.owner_business_ids()));

create policy "Owners can add to their FAQ"
  on public.faq_items for insert to authenticated
  with check (business_id in (select private.owner_business_ids()));

create policy "Owners can edit their FAQ"
  on public.faq_items for update to authenticated
  using (business_id in (select private.owner_business_ids()))
  with check (business_id in (select private.owner_business_ids()));

create policy "Owners can remove from their FAQ"
  on public.faq_items for delete to authenticated
  using (business_id in (select private.owner_business_ids()));

-- Moves a question one place up or down by swapping it with its neighbour.
create function public.move_faq_item(item_id uuid, up boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
  item public.faq_items;
  neighbour public.faq_items;
begin
  perform pg_advisory_xact_lock(hashtextextended('faq:' || biz::text, 0));
  select * into item from public.faq_items f where f.id = move_faq_item.item_id and f.business_id = biz;
  if not found then
    raise exception 'Question not found' using errcode = 'P0002';
  end if;
  if up then
    select * into neighbour from public.faq_items f
    where f.business_id = biz and f.position < item.position
    order by f.position desc limit 1;
  else
    select * into neighbour from public.faq_items f
    where f.business_id = biz and f.position > item.position
    order by f.position limit 1;
  end if;
  if not found then
    return;
  end if;
  update public.faq_items set position = neighbour.position where id = item.id;
  update public.faq_items set position = item.position where id = neighbour.id;
end;
$$;

revoke execute on function public.move_faq_item(uuid, boolean) from public, anon;
grant execute on function public.move_faq_item(uuid, boolean) to authenticated;

-- A signed-in customer's FAQ: only their own landscaper's questions.
create function public.portal_faq()
returns table (question text, answer text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.question, f.answer
  from public.customer_accounts a
  join public.faq_items f on f.business_id = a.business_id
  where a.user_id = (select auth.uid()) and a.user_id is not null
  order by f.position, f.id;
$$;

revoke execute on function public.portal_faq() from public, anon;
grant execute on function public.portal_faq() to authenticated;

-- The request form's FAQ: only while that business's link is switched on.
create function public.public_request_faq(token text)
returns table (question text, answer text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.question, f.answer
  from public.request_links l
  join public.faq_items f on f.business_id = l.business_id
  where l.token = public_request_faq.token and l.enabled
  order by f.position, f.id;
$$;

revoke execute on function public.public_request_faq(text) from public;
grant execute on function public.public_request_faq(text) to anon, authenticated;
