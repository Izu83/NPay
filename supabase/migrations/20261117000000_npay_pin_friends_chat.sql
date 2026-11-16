-- NPay part 2: PIN lock, friends and chat.
-- Run after 20261116000000_npay_accounts.sql. Safe to run more than once.

create extension if not exists pgcrypto with schema extensions;

-- ================================================================ PIN

-- Only the functions below can read or write this table; nobody can see a hash.
create table if not exists public.pins (
  user_id       uuid primary key references public.profiles (id) on delete cascade,
  hash          text not null,
  attempts      int not null default 0,
  locked_until  timestamptz,
  updated_at    timestamptz not null default now()
);
alter table public.pins enable row level security;
revoke all on public.pins from anon, authenticated;

-- True when this session signed in with the account password in the last 15 minutes.
-- That is what lets someone who forgot their PIN set a new one.
create or replace function public._recent_password_login()
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) a
    where a ->> 'method' = 'password'
      and (a ->> 'timestamp')::bigint > extract(epoch from now())::bigint - 900
  );
$$;

-- Checks a PIN and counts wrong tries: 5 wrong in a row locks it for 5 minutes.
-- Returns 'ok', 'wrong', 'locked' or 'none' (no PIN set). Never raises, so the
-- attempt counter is always saved.
create or replace function public._check_pin(p_user uuid, p_pin text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pins;
begin
  select * into p from public.pins where user_id = p_user for update;
  if p.user_id is null then return 'none'; end if;
  if p.locked_until is not null and p.locked_until > now() then return 'locked'; end if;
  if p_pin is not null and extensions.crypt(p_pin, p.hash) = p.hash then
    update public.pins set attempts = 0, locked_until = null where user_id = p_user;
    return 'ok';
  end if;
  if p.attempts + 1 >= 5 then
    update public.pins set attempts = 0, locked_until = now() + interval '5 minutes' where user_id = p_user;
    return 'locked';
  end if;
  update public.pins set attempts = attempts + 1 where user_id = p_user;
  return 'wrong';
end;
$$;

create or replace function public.has_pin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.pins where user_id = auth.uid());
$$;

-- Turns a _check_pin result into { ok, error?, attempts_left?, locked_until? }.
create or replace function public._pin_result(p_user uuid, res text)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'ok', res = 'ok',
    'error', case when res = 'ok' then null else res end,
    'attempts_left', case when res = 'wrong' then 5 - p.attempts end,
    'locked_until', case when res = 'locked' then p.locked_until end)
  from (select 1) x left join public.pins p on p.user_id = p_user;
$$;

create or replace function public.verify_pin(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  res text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'signed_out'); end if;
  res := public._check_pin(auth.uid(), p_pin);
  return public._pin_result(auth.uid(), res);
end;
$$;

-- Set or change the PIN. Changing needs the old PIN, or a password sign-in in the
-- last 15 minutes (the "forgot PIN" route).
create or replace function public.set_pin(p_new text, p_old text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  res text;
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'signed_out'); end if;
  if p_new is null or p_new !~ '^[0-9]{4}$' then return jsonb_build_object('ok', false, 'error', 'bad_pin'); end if;
  if exists (select 1 from public.pins where user_id = me) then
    if p_old is not null then
      res := public._check_pin(me, p_old);
      if res <> 'ok' then return public._pin_result(me, res); end if;
    elsif not public._recent_password_login() then
      return jsonb_build_object('ok', false, 'error', 'needs_password');
    end if;
  end if;
  insert into public.pins (user_id, hash) values (me, extensions.crypt(p_new, extensions.gen_salt('bf', 8)))
  on conflict (user_id) do update set hash = excluded.hash, attempts = 0, locked_until = null, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- ================================================================ friends

create table if not exists public.friendships (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references public.profiles (id) on delete cascade,
  addressee_id  uuid not null references public.profiles (id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  check (requester_id <> addressee_id)
);
create unique index if not exists friendships_pair
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

alter table public.friendships enable row level security;
revoke all on public.friendships from anon, authenticated;
grant select on public.friendships to authenticated;

drop policy if exists "you see your own friendships" on public.friendships;
create policy "you see your own friendships" on public.friendships
  for select to authenticated using (auth.uid() in (requester_id, addressee_id));

create or replace function public._are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships
    where status = 'accepted'
      and least(requester_id, addressee_id) = least(a, b)
      and greatest(requester_id, addressee_id) = greatest(a, b));
$$;

-- Send a request, or accept theirs if they already asked you. Returns the status.
create or replace function public.add_friend(p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  f public.friendships;
begin
  if me is null then raise exception 'NPAY:signed_out'; end if;
  if p_user = me then raise exception 'NPAY:own_account'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'NPAY:no_account'; end if;
  select * into f from public.friendships
    where least(requester_id, addressee_id) = least(me, p_user) and greatest(requester_id, addressee_id) = greatest(me, p_user)
    for update;
  if f.id is null then
    insert into public.friendships (requester_id, addressee_id) values (me, p_user);
    return 'requested';
  end if;
  if f.status = 'pending' and f.addressee_id = me then
    update public.friendships set status = 'accepted', accepted_at = now() where id = f.id;
    return 'accepted';
  end if;
  return case when f.status = 'accepted' then 'accepted' else 'requested' end;
end;
$$;

create or replace function public.respond_friend(p_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_accept then
    update public.friendships set status = 'accepted', accepted_at = now()
      where id = p_id and addressee_id = auth.uid() and status = 'pending';
  else
    delete from public.friendships where id = p_id and addressee_id = auth.uid() and status = 'pending';
  end if;
end;
$$;

-- Unfriend, or cancel a request you sent.
create or replace function public.remove_friend(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.friendships
  where least(requester_id, addressee_id) = least(auth.uid(), p_user)
    and greatest(requester_id, addressee_id) = greatest(auth.uid(), p_user);
$$;

-- ================================================================ chat

create table if not exists public.messages (
  id            bigint generated always as identity primary key,
  sender_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  recipient_id  uuid not null references public.profiles (id) on delete cascade,
  body          text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at    timestamptz not null default now(),
  read_at       timestamptz
);
create index if not exists messages_pair on public.messages (sender_id, recipient_id, created_at desc);
create index if not exists messages_inbox on public.messages (recipient_id, created_at desc);

alter table public.messages enable row level security;
revoke all on public.messages from anon, authenticated;
grant select on public.messages to authenticated;
grant insert (recipient_id, body) on public.messages to authenticated;

drop policy if exists "you see your own messages" on public.messages;
create policy "you see your own messages" on public.messages
  for select to authenticated using (auth.uid() in (sender_id, recipient_id));

drop policy if exists "you can message your friends" on public.messages;
create policy "you can message your friends" on public.messages
  for insert to authenticated
  with check (sender_id = auth.uid() and public._are_friends(sender_id, recipient_id));

create or replace function public.mark_read(p_other uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.messages set read_at = now()
  where recipient_id = auth.uid() and sender_id = p_other and read_at is null;
$$;

-- Everyone you're connected with: friends, requests in and out, with the last
-- message and how many you haven't read.
create or replace function public.my_friends()
returns table (
  friendship_id uuid, user_id uuid, username text, name text, color text, avatar text,
  status text, last_body text, last_at timestamptz, last_from_me boolean, unread int)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select auth.uid() as id),
  f as (
    select fr.id, fr.status, fr.requester_id, fr.created_at,
           case when fr.requester_id = me.id then fr.addressee_id else fr.requester_id end as other
    from public.friendships fr, me
    where me.id in (fr.requester_id, fr.addressee_id)
  )
  select f.id, p.id, p.username, p.name, p.color, p.avatar,
         case when f.status = 'accepted' then 'friends'
              when f.requester_id = (select id from me) then 'outgoing' else 'incoming' end,
         lm.body, coalesce(lm.created_at, f.created_at), lm.sender_id = (select id from me),
         (select count(*)::int from public.messages m
           where m.recipient_id = (select id from me) and m.sender_id = f.other and m.read_at is null)
  from f
  join public.profiles p on p.id = f.other
  left join lateral (
    select m.body, m.created_at, m.sender_id from public.messages m
    where (m.sender_id = (select id from me) and m.recipient_id = f.other)
       or (m.sender_id = f.other and m.recipient_id = (select id from me))
    order by m.created_at desc limit 1
  ) lm on true
  order by coalesce(lm.created_at, f.created_at) desc;
$$;

-- ================================================================ grants

revoke execute on function public._recent_password_login() from public, anon, authenticated;
revoke execute on function public._check_pin(uuid, text) from public, anon, authenticated;
revoke execute on function public._pin_result(uuid, text) from public, anon, authenticated;
revoke execute on function public._are_friends(uuid, uuid) from public, anon;
revoke execute on function public.has_pin() from public, anon;
revoke execute on function public.verify_pin(text) from public, anon;
revoke execute on function public.set_pin(text, text) from public, anon;
revoke execute on function public.add_friend(uuid) from public, anon;
revoke execute on function public.respond_friend(uuid, boolean) from public, anon;
revoke execute on function public.remove_friend(uuid) from public, anon;
revoke execute on function public.mark_read(uuid) from public, anon;
revoke execute on function public.my_friends() from public, anon;

-- _are_friends is used inside the messages insert policy, so signed-in users need it.
grant execute on function public._are_friends(uuid, uuid) to authenticated;
grant execute on function public.has_pin() to authenticated;
grant execute on function public.verify_pin(text) to authenticated;
grant execute on function public.set_pin(text, text) to authenticated;
grant execute on function public.add_friend(uuid) to authenticated;
grant execute on function public.respond_friend(uuid, boolean) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.mark_read(uuid) to authenticated;
grant execute on function public.my_friends() to authenticated;

-- ================================================================ live updates

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages') then
      alter publication supabase_realtime add table public.messages;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friendships') then
      alter publication supabase_realtime add table public.friendships;
    end if;
  end if;
end;
$$;
