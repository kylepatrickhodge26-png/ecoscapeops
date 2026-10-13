-- EcoScape Ops: customers pay with the payment apps each business already uses, instead of
-- through Stripe.
--
--   * Stripe is gone: its tables and functions are dropped, and every payment is recorded
--     by the owner (cash, check, Venmo, Cash App, PayPal, Zelle, card, bank transfer,
--     other), once per form submission, as before.
--   * Each business lists how customers can pay it: a Venmo username, Cash App $cashtag,
--     PayPal.Me name, Zelle email or phone, and/or a payment link of its own (e.g. from
--     Square), plus a note. The customer's pay page shows them for that invoice's balance.
--     The money goes straight from the customer to the business; EcoScape Ops never
--     touches it, and the owner records the payment once it arrives.
--   * Payment options are owner-only, like the rest of invoicing: only the owner reads and
--     changes them, and customers see them only on a sent invoice's pay page.

-- ---------------------------------------------------------------------------
-- Stripe out
-- ---------------------------------------------------------------------------
drop function public.begin_invoice_checkout(text);
drop function public.record_checkout_session(text, uuid, text, numeric, text);
drop function public.apply_checkout_event(text, text, text, bigint);
drop function public.record_stripe_event(text, text);
drop function public.public_invoice(text); -- returns payment options now
drop function public.record_manual_payment(uuid, numeric, public.payment_method, date, text, uuid);

alter table public.payments drop constraint payments_source;
alter table public.payments drop column checkout_session_id;

drop table public.checkout_sessions;
drop table public.stripe_events;
drop table public.stripe_accounts;
drop type public.checkout_status;

-- ---------------------------------------------------------------------------
-- Payments: all recorded by the owner. A Stripe card payment ('online') becomes 'card'.
-- ---------------------------------------------------------------------------
alter type public.payment_method rename to payment_method_stripe;
create type public.payment_method as enum (
  'cash', 'check', 'venmo', 'cash_app', 'paypal', 'zelle', 'card', 'bank_transfer', 'other'
);
alter table public.payments
  alter column method type public.payment_method
  using (case method::text when 'online' then 'card' else method::text end)::public.payment_method;
drop type public.payment_method_stripe;

update public.payments set request_id = gen_random_uuid() where request_id is null;
alter table public.payments alter column request_id set not null;

-- Records a payment on a sent invoice. request_id identifies the form submission:
-- recording the same request_id again returns the first payment instead of recording
-- another. A payment can't be more than what's still owed.
create function public.record_manual_payment(
  invoice_id uuid,
  amount numeric,
  method public.payment_method,
  received_on date,
  note text,
  request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices := private.my_invoice_for_update(record_manual_payment.invoice_id);
  existing uuid;
  payment_id uuid;
begin
  if record_manual_payment.request_id is null then
    raise exception 'Missing request id' using errcode = '22023';
  end if;
  -- The invoice row lock serializes payments on this invoice, so a repeated submission
  -- always finds the first one here.
  select p.id into existing
  from public.payments p
  where p.business_id = inv.business_id and p.request_id = record_manual_payment.request_id;
  if existing is not null then
    return existing;
  end if;

  if inv.status <> 'sent' then
    raise exception 'Payments can only be recorded on a sent invoice' using errcode = '22023';
  end if;
  if record_manual_payment.method is null then
    raise exception 'Choose how it was paid' using errcode = '22023';
  end if;
  if record_manual_payment.amount is null or record_manual_payment.amount <= 0 then
    raise exception 'Enter an amount more than $0' using errcode = '22023';
  end if;
  if record_manual_payment.amount > inv.total - inv.amount_paid then
    raise exception 'That''s more than the balance due' using errcode = '22023';
  end if;
  if record_manual_payment.received_on is null or record_manual_payment.received_on > private.business_today(inv.business_id) then
    raise exception 'The date received can''t be in the future' using errcode = '22023';
  end if;

  insert into public.payments (business_id, invoice_id, amount, method, received_on, note, request_id, recorded_by)
  values (
    inv.business_id, inv.id, record_manual_payment.amount, record_manual_payment.method,
    record_manual_payment.received_on, btrim(coalesce(record_manual_payment.note, '')),
    record_manual_payment.request_id, (select auth.uid())
  )
  returning id into payment_id;
  return payment_id;
end;
$$;

revoke execute on function public.record_manual_payment(uuid, numeric, public.payment_method, date, text, uuid) from public, anon;
grant execute on function public.record_manual_payment(uuid, numeric, public.payment_method, date, text, uuid) to authenticated;

-- Removes a payment recorded by mistake.
create or replace function public.delete_manual_payment(payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay public.payments;
begin
  select * into pay
  from public.payments p
  where p.id = delete_manual_payment.payment_id and p.business_id = private.my_owned_business();
  if not found then
    raise exception 'Payment not found' using errcode = 'P0002';
  end if;
  perform private.my_invoice_for_update(pay.invoice_id);
  delete from public.payments p where p.id = pay.id;
end;
$$;

-- Cancels an invoice with no payments. Its visits can then go on another invoice.
create or replace function public.cancel_invoice(invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices := private.my_invoice_for_update(cancel_invoice.invoice_id);
begin
  if inv.status = 'cancelled' then
    return;
  end if;
  if exists (select 1 from public.payments p where p.invoice_id = inv.id) then
    raise exception 'An invoice with payments can''t be cancelled' using errcode = '22023';
  end if;
  update public.invoices i set status = 'cancelled', cancelled_at = now() where i.id = inv.id;
  update public.invoice_lines l set invoice_cancelled = true where l.invoice_id = inv.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- How customers can pay each business
-- ---------------------------------------------------------------------------
alter table public.invoice_settings
  add column venmo text,
  add column cash_app text,
  add column paypal text,
  add column zelle text,
  add column pay_link text,
  add column payment_note text not null default '',
  -- Venmo usernames: 5-30 letters, numbers, hyphens and underscores (stored without @).
  add constraint invoice_settings_venmo_format check (venmo ~ '^[A-Za-z0-9_-]{5,30}$'),
  -- Cash App $cashtags: up to 20 letters, numbers and underscores, with at least one
  -- letter (stored without $).
  add constraint invoice_settings_cash_app_format check (cash_app ~ '^[A-Za-z0-9_]{1,20}$' and cash_app ~ '[A-Za-z]'),
  -- PayPal.Me names: up to 20 letters and numbers.
  add constraint invoice_settings_paypal_format check (paypal ~ '^[A-Za-z0-9]{1,20}$'),
  -- Zelle: the email address or US phone number (+1XXXXXXXXXX) it's registered to.
  add constraint invoice_settings_zelle_format check (
    zelle ~ '^\+1[2-9][0-9]{9}$' or (zelle ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(zelle) <= 254)
  ),
  -- Any other way to pay online: a secure (https) link, shown as a button.
  add constraint invoice_settings_pay_link_format check (pay_link ~ '^https://[^\s"<>\\]+$' and char_length(pay_link) <= 500),
  add constraint invoice_settings_payment_note_length check (char_length(payment_note) <= 300);

-- Saves the business's payment options. Blank fields are cleared; a leading @ or $ is
-- dropped. Anything else that doesn't fit a field's format is refused.
create function public.set_payment_options(
  venmo text,
  cash_app text,
  paypal text,
  zelle text,
  pay_link text,
  payment_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
  v_venmo text := nullif(regexp_replace(btrim(coalesce(set_payment_options.venmo, '')), '^@', ''), '');
  v_cash_app text := nullif(regexp_replace(btrim(coalesce(set_payment_options.cash_app, '')), '^\$', ''), '');
  v_paypal text := nullif(btrim(coalesce(set_payment_options.paypal, '')), '');
  v_zelle text := nullif(btrim(coalesce(set_payment_options.zelle, '')), '');
  v_pay_link text := nullif(btrim(coalesce(set_payment_options.pay_link, '')), '');
begin
  if v_zelle is not null and v_zelle !~ '@' then
    v_zelle := private.to_e164(v_zelle);
    if v_zelle is null or v_zelle !~ '^\+1' then
      raise exception 'Enter the email address or US phone number you use with Zelle' using errcode = '22023';
    end if;
  end if;
  insert into public.invoice_settings (business_id, venmo, cash_app, paypal, zelle, pay_link, payment_note)
  values (biz, v_venmo, v_cash_app, v_paypal, lower(v_zelle), v_pay_link, btrim(coalesce(set_payment_options.payment_note, '')))
  on conflict (business_id) do update set
    venmo = excluded.venmo,
    cash_app = excluded.cash_app,
    paypal = excluded.paypal,
    zelle = excluded.zelle,
    pay_link = excluded.pay_link,
    payment_note = excluded.payment_note;
end;
$$;

revoke execute on function public.set_payment_options(text, text, text, text, text, text) from public, anon;
grant execute on function public.set_payment_options(text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The customer's pay page (/pay/<token>): anyone with the link can see that one invoice,
-- and how to pay that business. Drafts and cancelled invoices show nothing.
-- ---------------------------------------------------------------------------
create function public.public_invoice(token text)
returns table (
  business_name text,
  number integer,
  customer_name text,
  issue_date date,
  due_date date,
  status text,
  total numeric,
  amount_paid numeric,
  balance numeric,
  lines jsonb,
  venmo text,
  cash_app text,
  paypal text,
  zelle text,
  pay_link text,
  payment_note text
)
language sql
stable
security definer
set search_path = ''
as $$
  select b.name,
         i.number,
         btrim(c.first_name || ' ' || c.last_name),
         i.issue_date,
         i.due_date,
         private.invoice_display_status(i.status, i.total, i.amount_paid, i.due_date, private.business_today(i.business_id)),
         i.total,
         i.amount_paid,
         greatest(i.total - i.amount_paid, 0),
         (
           select coalesce(jsonb_agg(jsonb_build_object(
             'description', l.description, 'quantity', l.quantity, 'unit_price', l.unit_price, 'amount', l.amount
           ) order by l.position), '[]'::jsonb)
           from public.invoice_lines l where l.invoice_id = i.id
         ),
         s.venmo,
         s.cash_app,
         s.paypal,
         s.zelle,
         s.pay_link,
         coalesce(s.payment_note, '')
  from public.invoices i
  join public.businesses b on b.id = i.business_id
  join public.customers c on c.id = i.customer_id and c.business_id = i.business_id
  left join public.invoice_settings s on s.business_id = i.business_id
  where token ~ '^[0-9a-f]{64}$'
    and i.pay_token = token
    and i.status = 'sent';
$$;

revoke execute on function public.public_invoice(text) from public;
grant execute on function public.public_invoice(text) to anon, authenticated;
