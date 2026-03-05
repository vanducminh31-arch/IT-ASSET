-- ============================================================
-- SUPABASE MIGRATION: IT-ASSET
-- Run this SQL in Supabase Dashboard → SQL Editor
-- Creates all tables matching the original Firestore collections
-- ============================================================

-- 1. USERS (role management)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  role TEXT DEFAULT 'viewer' CHECK (role IN ('admin', 'manager', 'viewer')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. TRANSACTIONS
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  no INT,
  item TEXT NOT NULL DEFAULT '',
  item_key TEXT DEFAULT '',
  description TEXT DEFAULT '',
  date TEXT DEFAULT '',
  tx_type TEXT DEFAULT '',
  quantity NUMERIC DEFAULT 0,
  unit TEXT DEFAULT 'pcs',
  assigned TEXT DEFAULT '',
  status TEXT DEFAULT '',
  sn JSONB DEFAULT '[]'::jsonb,
  remark TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ,
  updated_by UUID REFERENCES auth.users(id),
  imported_at TIMESTAMPTZ
);

-- 3. STOCK (inventory)
CREATE TABLE IF NOT EXISTS stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  no INT,
  item TEXT NOT NULL DEFAULT '',
  item_key TEXT DEFAULT '',
  type_device TEXT DEFAULT '',
  stock NUMERIC DEFAULT 0,
  note TEXT DEFAULT '',
  sn TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ
);

-- 4. STORES
CREATE TABLE IF NOT EXISTS stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_code TEXT DEFAULT '',
  store_name TEXT DEFAULT '',
  store_key TEXT DEFAULT '',
  brand TEXT DEFAULT '',
  brand2 TEXT DEFAULT '',
  type TEXT DEFAULT '',
  type2 TEXT DEFAULT '',
  incharge TEXT DEFAULT '',
  "position" TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  am TEXT DEFAULT '',
  open_date TEXT DEFAULT '',
  total_area NUMERIC DEFAULT 0,
  sell_area NUMERIC DEFAULT 0,
  region TEXT DEFAULT '',
  cost_center TEXT DEFAULT '',
  address TEXT DEFAULT '',
  o2o TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ
);

-- 5. MINIPC
CREATE TABLE IF NOT EXISTS minipc (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code TEXT DEFAULT '',
  asset_key TEXT DEFAULT '',
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  imported_at TIMESTAMPTZ
);

-- 6. OFFICES
CREATE TABLE IF NOT EXISTS offices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT DEFAULT '',
  name TEXT DEFAULT '',
  location TEXT DEFAULT '',
  incharge TEXT DEFAULT '',
  "No." INT,
  "Category" TEXT,
  "Qty" TEXT,
  "Notes" TEXT,
  "HCM" TEXT,
  "South stores (other than HCM)" TEXT,
  "HN" TEXT,
  "North stores (other than HN)" TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ
);

-- 7. WAREHOUSES
CREATE TABLE IF NOT EXISTS warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT DEFAULT '',
  name TEXT DEFAULT '',
  location TEXT DEFAULT '',
  incharge TEXT DEFAULT '',
  "No" INT,
  "Model" TEXT DEFAULT '',
  "CPU" TEXT DEFAULT '',
  "Ram" TEXT DEFAULT '',
  "Hard Disk" TEXT DEFAULT '',
  "S/N" TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ
);

-- ============================================================
-- INDEXES for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_transactions_item_key ON transactions(item_key);
CREATE INDEX IF NOT EXISTS idx_transactions_tx_type ON transactions(tx_type);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_assigned ON transactions(assigned);
CREATE INDEX IF NOT EXISTS idx_stock_item_key ON stock(item_key);
CREATE INDEX IF NOT EXISTS idx_stores_store_code ON stores(store_code);
CREATE INDEX IF NOT EXISTS idx_stores_store_key ON stores(store_key);
CREATE INDEX IF NOT EXISTS idx_stores_region ON stores(region);
CREATE INDEX IF NOT EXISTS idx_offices_code ON offices(code);
CREATE INDEX IF NOT EXISTS idx_warehouses_code ON warehouses(code);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE minipc ENABLE ROW LEVEL SECURITY;
ALTER TABLE offices ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;

-- USERS: authenticated users can read their own row + admins can read all
CREATE POLICY "Users can read own data" ON users
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own data" ON users
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own data" ON users
  FOR UPDATE TO authenticated
  USING (auth.uid() = id);

-- ALL OTHER TABLES: authenticated users have full access
-- (Authorization is handled at application level, same as original Firestore approach)

-- Transactions
CREATE POLICY "Authenticated full access" ON transactions
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Stock
CREATE POLICY "Authenticated full access" ON stock
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Stores
CREATE POLICY "Authenticated full access" ON stores
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Minipc
CREATE POLICY "Authenticated full access" ON minipc
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Offices
CREATE POLICY "Authenticated full access" ON offices
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Warehouses
CREATE POLICY "Authenticated full access" ON warehouses
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
