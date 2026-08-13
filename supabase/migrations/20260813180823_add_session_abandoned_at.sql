-- Explicit abandonment signal, distinct from a session simply still in progress.
alter table public.workout_sessions add column abandoned_at timestamptz;
