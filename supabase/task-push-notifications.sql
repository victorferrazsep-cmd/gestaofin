create table if not exists public.task_push_notification_log (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  task_date date not null,
  days_before smallint not null check (days_before in (0, 1)),
  sent_at timestamptz not null default now(),
  unique (task_id, task_date, days_before)
);

alter table public.task_push_notification_log enable row level security;
grant select, insert, update, delete on public.task_push_notification_log to service_role;
