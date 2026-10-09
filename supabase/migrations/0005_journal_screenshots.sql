-- Journal screenshots: private bucket, accessed only through the API (service role), 2 MB, images only.
alter table trade_journal add column if not exists screenshot text;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('journal-screenshots', 'journal-screenshots', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
