-- Haiduc update: start dates for tasks (Gantt timeline).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
alter table public.tasks add column if not exists start_date date;
