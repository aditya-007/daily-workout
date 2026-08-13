-- Grants the single dashboard admin account (not anonymous) read-only visibility across all rows,
-- purely additive: existing per-user anonymous isolation policies are untouched.
create policy "admin read all sessions" on public.workout_sessions
  for select using (auth.uid() = '418862cb-df43-4b59-926b-6f7fe4df43a8'::uuid);

create policy "admin read all events" on public.exercise_events
  for select using (auth.uid() = '418862cb-df43-4b59-926b-6f7fe4df43a8'::uuid);
