-- ════════════════════════════════════════════════════════════
-- 酒蔵録 Supabase 資料庫設定（v2：含背面圖片 + 分享功能）
-- 在 Supabase Dashboard > SQL Editor 貼上執行
-- ════════════════════════════════════════════════════════════

-- 1. 建立酒款資料表（新增 back_image_url 欄位）
create table if not exists sakes (
  id text primary key,
  image_url text,
  back_image_url text,        -- ← 新增：背面酒標圖片 URL
  info jsonb,
  added_at timestamptz default now()
);

-- 若 sakes 表已存在，補加 back_image_url 欄位（執行一次即可）
alter table sakes add column if not exists back_image_url text;

-- 加上索引
create index if not exists sakes_added_at_idx on sakes (added_at desc);
create index if not exists sakes_info_idx on sakes using gin (info);

-- 2. Row Level Security
alter table sakes enable row level security;

create policy "allow all on sakes" on sakes
  for all using (true) with check (true);

-- 3. 分享 token 資料表（新增）
create table if not exists share_tokens (
  token text primary key,
  created_at timestamptz default now()
);

alter table share_tokens enable row level security;

create policy "allow all on share_tokens" on share_tokens
  for all using (true) with check (true);

-- ════════════════════════════════════════════════════════════
-- 4. 建立圖片儲存桶（Storage）
-- ════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('sake-images', 'sake-images', true)
on conflict (id) do nothing;

-- 允許匿名讀寫圖片
create policy "public read sake-images" on storage.objects
  for select using (bucket_id = 'sake-images');

create policy "public upload sake-images" on storage.objects
  for insert with check (bucket_id = 'sake-images');

create policy "public update sake-images" on storage.objects
  for update using (bucket_id = 'sake-images');

create policy "public delete sake-images" on storage.objects
  for delete using (bucket_id = 'sake-images');

-- 完成！
