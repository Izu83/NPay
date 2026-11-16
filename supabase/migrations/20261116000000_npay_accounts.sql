-- NPay: accounts, wallets, payments and live terminal requests.
--
-- Money rules live here, not in the browser: balances can only change through the
-- functions below, which check the amount, the balance and who is calling.
-- Amounts are whole cents (bigint). Every new account starts with €100.00.
--
-- Safe to run more than once (in the SQL editor, or through the GitHub integration).

-- ---------------------------------------------------------------- tables

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null unique check (username ~ '^[a-z0-9._]{3,20}$'),
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  color       text not null default '#32292f' check (color ~ '^#[0-9a-fA-F]{6}$'),
  avatar      text check (avatar is null or (avatar like 'data:image/%' and char_length(avatar) < 200000)),
  created_at  timestamptz not null default now()
);

create table if not exists public.wallets (
  id       uuid primary key references public.profiles (id) on delete cascade,
  balance  bigint not null default 10000 check (balance >= 0)
);

-- One row per side of every payment: the payer and the payee each get their own line.
create table if not exists public.transactions (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  kind            text not null check (kind in ('pay', 'get', 'send', 'recv', 'charge', 'payout')),
  amount          bigint not null check (amount <> 0),          -- signed: + in, − out
  other_id        uuid references public.profiles (id) on delete set null,
  other_name      text not null,
  other_username  text,
  other_color     text,
  note            text check (note is null or char_length(note) <= 60),
  ref             text not null,
  created_at      timestamptz not null default now()
);
create index if not exists transactions_user_created on public.transactions (user_id, created_at desc);

-- A QR code shown by a terminal. 'pay': the scanner pays the terminal's owner.
-- 'get': the terminal's owner pays the scanner.
create table if not exists public.payment_requests (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.profiles (id) on delete cascade,
  kind          text not null check (kind in ('pay', 'get')),
  amount        bigint not null check (amount > 0 and amount <= 100000000),
  label         text not null check (char_length(btrim(label)) between 1 and 40),
  note          text check (note is null or char_length(note) <= 60),
  status        text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  paid_by       uuid references public.profiles (id) on delete set null,
  paid_by_name  text,
  paid_at       timestamptz,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now()
);
create index if not exists payment_requests_owner on public.payment_requests (owner_id, created_at desc);

-- ---------------------------------------------------------------- access

alter table public.profiles         enable row level security;
alter table public.wallets          enable row level security;
alter table public.transactions     enable row level security;
alter table public.payment_requests enable row level security;

-- Supabase grants everything on new tables to anon/authenticated by default; take it back
-- and hand out only what the app needs.
revoke all on public.profiles, public.wallets, public.transactions, public.payment_requests from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (name, color, avatar) on public.profiles to authenticated;
grant select on public.wallets, public.transactions, public.payment_requests to authenticated;

drop policy if exists "profiles are visible to signed-in users" on public.profiles;
create policy "profiles are visible to signed-in users" on public.profiles
  for select to authenticated using (true);

drop policy if exists "you can edit your own profile" on public.profiles;
create policy "you can edit your own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "you see your own wallet" on public.wallets;
create policy "you see your own wallet" on public.wallets
  for select to authenticated using (id = auth.uid());

drop policy if exists "you see your own transactions" on public.transactions;
create policy "you see your own transactions" on public.transactions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "you see your own payment requests" on public.payment_requests;
create policy "you see your own payment requests" on public.payment_requests
  for select to authenticated using (owner_id = auth.uid());

-- ---------------------------------------------------------------- new users

-- Sign-up passes { username, name, color } as user metadata; this makes the profile and
-- the wallet in the same transaction, so a taken username makes the sign-up fail cleanly.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  uname text := lower(btrim(coalesce(meta ->> 'username', '')));
begin
  if uname !~ '^[a-z0-9._]{3,20}$' then
    uname := 'user' || substr(replace(new.id::text, '-', ''), 1, 12);
  end if;
  insert into public.profiles (id, username, name, color)
  values (
    new.id,
    uname,
    left(coalesce(nullif(btrim(meta ->> 'name'), ''), uname), 40),
    case when (meta ->> 'color') ~ '^#[0-9a-fA-F]{6}$' then meta ->> 'color' else '#32292f' end
  );
  insert into public.wallets (id) values (new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- functions

create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.profiles where username = lower(btrim(p_username)));
$$;

-- Lock two wallets in a fixed order so two payments between the same people can't deadlock.
create or replace function public._lock_wallets(a uuid, b uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select null from public.wallets where id in (a, b) order by id for update;
$$;

create or replace function public.send_money(p_to uuid, p_amount bigint, p_note text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  sender public.profiles;
  receiver public.profiles;
  ref text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  note text := nullif(left(btrim(coalesce(p_note, '')), 60), '');
  new_balance bigint;
begin
  if me is null then raise exception 'NPAY:signed_out'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 then raise exception 'NPAY:bad_amount'; end if;
  if p_to = me then raise exception 'NPAY:own_account'; end if;
  select * into sender from public.profiles where id = me;
  select * into receiver from public.profiles where id = p_to;
  if receiver.id is null then raise exception 'NPAY:no_account'; end if;

  perform public._lock_wallets(me, p_to);
  update public.wallets set balance = balance - p_amount where id = me and balance >= p_amount
    returning balance into new_balance;
  if not found then raise exception 'NPAY:insufficient'; end if;
  update public.wallets set balance = balance + p_amount where id = p_to;

  insert into public.transactions (user_id, kind, amount, other_id, other_name, other_username, other_color, note, ref) values
    (me,   'send', -p_amount, p_to, receiver.name, receiver.username, receiver.color, note, ref),
    (p_to, 'recv',  p_amount, me,   sender.name,   sender.username,   sender.color,   note, ref);
  return new_balance;
end;
$$;

create or replace function public.create_request(p_kind text, p_amount bigint, p_label text, p_note text default null, p_minutes int default 5)
returns public.payment_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.payment_requests;
begin
  if auth.uid() is null then raise exception 'NPAY:signed_out'; end if;
  if p_kind not in ('pay', 'get') then raise exception 'NPAY:bad_kind'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 then raise exception 'NPAY:bad_amount'; end if;
  insert into public.payment_requests (owner_id, kind, amount, label, note, expires_at)
  values (auth.uid(), p_kind, p_amount, left(btrim(p_label), 40), nullif(left(btrim(coalesce(p_note, '')), 60), ''),
          now() + make_interval(mins => least(greatest(coalesce(p_minutes, 5), 1), 60)))
  returning * into r;
  return r;
end;
$$;

create or replace function public.cancel_request(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payment_requests set status = 'cancelled'
  where id = p_id and owner_id = auth.uid() and status = 'open';
$$;

-- What a scanner sees before confirming.
create or replace function public.get_request(p_id uuid)
returns table (id uuid, kind text, amount bigint, label text, note text, status text, expires_at timestamptz,
               owner_id uuid, owner_username text, owner_name text, owner_color text, owner_avatar text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.kind, r.amount, r.label, r.note, r.status, r.expires_at,
         p.id, p.username, p.name, p.color, p.avatar
  from public.payment_requests r join public.profiles p on p.id = r.owner_id
  where r.id = p_id and auth.uid() is not null;
$$;

-- The scanner accepts a terminal's code: money moves and the terminal is told live.
create or replace function public.settle_request(p_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  r public.payment_requests;
  scanner public.profiles;
  owner public.profiles;
  payer uuid;
  payee uuid;
  ref text;
  new_balance bigint;
begin
  if me is null then raise exception 'NPAY:signed_out'; end if;
  select * into r from public.payment_requests where id = p_id for update;
  if r.id is null then raise exception 'NPAY:not_found'; end if;
  if r.status = 'done' then raise exception 'NPAY:already_used'; end if;
  if r.status <> 'open' or r.expires_at < now() then raise exception 'NPAY:expired'; end if;
  if r.owner_id = me then raise exception 'NPAY:own_code'; end if;

  select * into scanner from public.profiles where id = me;
  select * into owner from public.profiles where id = r.owner_id;
  payer := case r.kind when 'pay' then me else r.owner_id end;
  payee := case r.kind when 'pay' then r.owner_id else me end;

  perform public._lock_wallets(payer, payee);
  update public.wallets set balance = balance - r.amount where id = payer and balance >= r.amount;
  if not found then
    raise exception '%', case when payer = me then 'NPAY:insufficient' else 'NPAY:terminal_insufficient' end;
  end if;
  update public.wallets set balance = balance + r.amount where id = payee;

  ref := upper(substr(replace(r.id::text, '-', ''), 1, 12));
  insert into public.transactions (user_id, kind, amount, other_id, other_name, other_username, other_color, note, ref) values
    (me, case r.kind when 'pay' then 'pay' else 'get' end,
         case r.kind when 'pay' then -r.amount else r.amount end,
         owner.id, r.label, owner.username, owner.color, r.note, ref),
    (owner.id, case r.kind when 'pay' then 'charge' else 'payout' end,
         case r.kind when 'pay' then r.amount else -r.amount end,
         me, scanner.name, scanner.username, scanner.color, r.note, ref);

  update public.payment_requests
    set status = 'done', paid_by = me, paid_by_name = scanner.name, paid_at = now()
    where id = r.id;

  select balance into new_balance from public.wallets where id = me;
  return new_balance;
end;
$$;

create or replace function public.delete_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = auth.uid();
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public._lock_wallets(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.username_available(text) from public;
revoke execute on function public.send_money(uuid, bigint, text) from public, anon;
revoke execute on function public.create_request(text, bigint, text, text, int) from public, anon;
revoke execute on function public.cancel_request(uuid) from public, anon;
revoke execute on function public.get_request(uuid) from public, anon;
revoke execute on function public.settle_request(uuid) from public, anon;
revoke execute on function public.delete_account() from public, anon;

grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.send_money(uuid, bigint, text) to authenticated;
grant execute on function public.create_request(text, bigint, text, text, int) to authenticated;
grant execute on function public.cancel_request(uuid) to authenticated;
grant execute on function public.get_request(uuid) to authenticated;
grant execute on function public.settle_request(uuid) to authenticated;
grant execute on function public.delete_account() to authenticated;

-- ---------------------------------------------------------------- live updates

-- The terminal hears when its code is paid; a wallet hears when money arrives.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'transactions') then
      alter publication supabase_realtime add table public.transactions;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'payment_requests') then
      alter publication supabase_realtime add table public.payment_requests;
    end if;
  end if;
end;
$$;
