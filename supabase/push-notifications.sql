create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;

drop policy if exists "Users can read their own push subscriptions" on public.push_subscriptions;
create policy "Users can read their own push subscriptions"
  on public.push_subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can add their own push subscriptions" on public.push_subscriptions;
create policy "Users can add their own push subscriptions"
  on public.push_subscriptions for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own push subscriptions" on public.push_subscriptions;
create policy "Users can update their own push subscriptions"
  on public.push_subscriptions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own push subscriptions" on public.push_subscriptions;
create policy "Users can delete their own push subscriptions"
  on public.push_subscriptions for delete to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.push_notification_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  due_date date not null,
  days_before smallint not null check (days_before in (0, 1)),
  sent_at timestamptz not null default now(),
  unique (account_id, due_date, days_before)
);

alter table public.push_notification_log enable row level security;
grant select, insert, update, delete on public.push_notification_log to service_role;
