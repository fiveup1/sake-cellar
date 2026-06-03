-- ════════════════════════════════════════════════════════════
-- 酒蔵録 Supabase 資料庫設定
-- 在 Supabase Dashboard > SQL Editor 貼上執行
-- ════════════════════════════════════════════════════════════

-- 1. 建立酒款資料表
create table if not exists sakes (
  id text primary key,
  image_url text,
  info jsonb,
  added_at timestamptz default now()
);

-- 加上索引（加速搜尋）
create index if not exists sakes_added_at_idx on sakes (added_at desc);
create index if not exists sakes_info_idx on sakes using gin (info);

-- 2. 開啟 Row Level Security 並允許匿名讀寫（個人 App 用）
alter table sakes enable row level security;

create policy "allow all on sakes" on sakes
  for all using (true) with check (true);

-- ════════════════════════════════════════════════════════════
-- 3. 建立圖片儲存桶（Storage）
--    ⚠️ 此步驟請在 Dashboard > Storage 手動操作，或執行下方：
-- ════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('sake-images', 'sake-images', true)
on conflict (id) do nothing;

-- 允許匿名上傳/讀取圖片
create policy "public read sake-images" on storage.objects
  for select using (bucket_id = 'sake-images');

create policy "public upload sake-images" on storage.objects
  for insert with check (bucket_id = 'sake-images');

create policy "public update sake-images" on storage.objects
  for update using (bucket_id = 'sake-images');

create policy "public delete sake-images" on storage.objects
  for delete using (bucket_id = 'sake-images');

-- 完成！
