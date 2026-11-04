-- Video reports sent from the ••• menu on video cards.
-- Anyone (signed in or not) can submit; only admins (public.admin_users) can read or dismiss.
create table if not exists public.video_reports (
  id uuid primary key default gen_random_uuid(),
  video_id text not null check (char_length(video_id) between 1 and 200),
  video_url text not null check (char_length(video_url) between 8 and 2048),
  video_title text check (video_title is null or char_length(video_title) <= 300),
  reason text not null check (char_length(reason) between 2 and 80),
  details text check (details is null or char_length(details) <= 500),
  reporter_id uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists video_reports_created_at_idx on public.video_reports (created_at desc);
create index if not exists video_reports_video_id_idx on public.video_reports (video_id);

alter table public.video_reports enable row level security;

drop policy if exists "Anyone can submit a video report" on public.video_reports;
create policy "Anyone can submit a video report" on public.video_reports
  for insert to anon, authenticated
  with check (reporter_id is null or reporter_id = auth.uid());

drop policy if exists "Admins can read video reports" on public.video_reports;
create policy "Admins can read video reports" on public.video_reports
  for select to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

drop policy if exists "Admins can dismiss video reports" on public.video_reports;
create policy "Admins can dismiss video reports" on public.video_reports
  for delete to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

grant insert on public.video_reports to anon, authenticated;
grant select, delete on public.video_reports to authenticated;
