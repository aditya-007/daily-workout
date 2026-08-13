-- Invisible workout telemetry: sessions + per-exercise events, scoped to Supabase anonymous auth users.

create table public.workout_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  day_key text not null,
  name_hi text not null,
  name_en text not null,
  total_exercises integer not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms bigint,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.exercise_events (
  id uuid primary key,
  session_id uuid not null references public.workout_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  exercise_id text not null,
  sequence_index integer not null,
  event_type text not null check (event_type in ('view', 'complete', 'skip')),
  time_spent_ms bigint,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_workout_sessions_user_started on public.workout_sessions (user_id, started_at desc);
create index idx_exercise_events_session on public.exercise_events (session_id);
create index idx_exercise_events_user_occurred on public.exercise_events (user_id, occurred_at desc);

alter table public.workout_sessions enable row level security;
alter table public.exercise_events enable row level security;

-- Events are insert-only from the client's perspective; sessions can be updated (e.g. marked completed) by their own owner.
create policy "select own sessions" on public.workout_sessions for select using (auth.uid() = user_id);
create policy "insert own sessions" on public.workout_sessions for insert with check (auth.uid() = user_id);
create policy "update own sessions" on public.workout_sessions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "select own events" on public.exercise_events for select using (auth.uid() = user_id);
create policy "insert own events" on public.exercise_events for insert with check (auth.uid() = user_id);

-- Defense-in-depth grants: all writes actually flow through the service-role Edge Function, RLS still bounds any direct client access.
grant select, insert, update on public.workout_sessions to authenticated;
grant select, insert on public.exercise_events to authenticated;
