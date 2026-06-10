-- =============================================
-- 海鮮圖鑑 Supabase Schema  (v2 — adds ai_cover_photo)
-- Run this in your Supabase SQL editor
-- =============================================

-- Create fishes table
CREATE TABLE IF NOT EXISTS fishes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Basic info
  name TEXT NOT NULL,
  scientific_name TEXT,
  common_names TEXT,
  category TEXT DEFAULT '魚',

  -- AI-generated fields
  flavor TEXT,
  texture TEXT,
  market_price NUMERIC,
  cooking_methods TEXT,
  habitat_depth NUMERIC,

  -- Media
  photos TEXT[] DEFAULT '{}',
  cover_photo TEXT,        -- 目前封面（可能是 AI 圖或使用者照片）
  ai_cover_photo TEXT,     -- AI 辨識到的原始封面，永久保留供切換

  -- Extra
  description TEXT
);

-- Add ai_cover_photo column if table already exists
ALTER TABLE fishes ADD COLUMN IF NOT EXISTS ai_cover_photo TEXT;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fishes_updated_at ON fishes;
CREATE TRIGGER fishes_updated_at
  BEFORE UPDATE ON fishes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_fishes_name ON fishes USING gin(to_tsvector('simple', name));
CREATE INDEX IF NOT EXISTS idx_fishes_category ON fishes(category);
CREATE INDEX IF NOT EXISTS idx_fishes_habitat_depth ON fishes(habitat_depth);
CREATE INDEX IF NOT EXISTS idx_fishes_created_at ON fishes(created_at DESC);

-- RLS
ALTER TABLE fishes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read"   ON fishes;
DROP POLICY IF EXISTS "Public insert" ON fishes;
DROP POLICY IF EXISTS "Public update" ON fishes;
CREATE POLICY "Public read"   ON fishes FOR SELECT USING (true);
CREATE POLICY "Public insert" ON fishes FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update" ON fishes FOR UPDATE USING (true);
