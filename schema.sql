-- ============================================================
-- IT ASSET MANAGEMENT — Supabase Schema
-- Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

-- ── 1. USERS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'manager', 'viewer')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. STOCK ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stock (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "No"         INTEGER,
  "Item"       TEXT NOT NULL,
  itemKey      TEXT,
  "TypeDevice" TEXT,
  "Stock"      NUMERIC DEFAULT 0,
  "Note"       TEXT DEFAULT '',
  "SN"         TEXT DEFAULT '',
  "createdBy"  UUID REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_itemkey ON public.stock (itemKey);

-- ── 3. TRANSACTIONS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "No"          INTEGER,
  "Item"        TEXT NOT NULL,
  itemKey       TEXT,
  "Description" TEXT DEFAULT '',
  "Date"        TEXT,
  "TxType"      TEXT CHECK ("TxType" IN ('in', 'out')),
  "Quantity"    NUMERIC DEFAULT 0,
  "Unit"        TEXT DEFAULT 'pcs',
  "Assigned"    TEXT DEFAULT '',
  "Status"      TEXT DEFAULT '',
  "SN"          JSONB DEFAULT '[]',
  "Remark"      TEXT DEFAULT '',
  "TypeDevice"  TEXT DEFAULT '',
  "createdBy"   UUID REFERENCES auth.users(id),
  "updatedBy"   UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tx_itemkey  ON public.transactions (itemKey);
CREATE INDEX IF NOT EXISTS idx_tx_txtype   ON public.transactions ("TxType");
CREATE INDEX IF NOT EXISTS idx_tx_assigned ON public.transactions ("Assigned");
CREATE INDEX IF NOT EXISTS idx_tx_date     ON public.transactions ("Date");

-- ── 4. STORES ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stores (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_code    TEXT,
  store_name    TEXT,
  "Store code"  TEXT,
  "Store name"  TEXT,
  storeKey      TEXT,
  "Brand"       TEXT DEFAULT '',
  "Brand2"      TEXT DEFAULT '',
  "Type"        TEXT DEFAULT '',
  "Type 2"      TEXT DEFAULT '',
  "Incharge"    TEXT DEFAULT '',
  "Position"    TEXT DEFAULT '',
  "Phone"       TEXT DEFAULT '',
  "Email"       TEXT DEFAULT '',
  "AM"          TEXT DEFAULT '',
  "Open date"   TEXT DEFAULT '',
  "TotalArea"   NUMERIC DEFAULT 0,
  "SellArea"    NUMERIC DEFAULT 0,
  "Region"      TEXT DEFAULT '',
  "Cost Center" TEXT DEFAULT '',
  "Address"     TEXT DEFAULT '',
  "O2O"         TEXT DEFAULT '',
  "o2o"         TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stores_region ON public.stores ("Region");
CREATE INDEX IF NOT EXISTS idx_stores_brand  ON public.stores ("Brand");

-- ── 5. OFFICES ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.offices (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  location   TEXT DEFAULT '',
  incharge   TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 6. WAREHOUSES ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.warehouses (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  location   TEXT DEFAULT '',
  incharge   TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 7. MINIPC ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.minipc (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "Item"     TEXT,
  "SN"       TEXT,
  "Assigned" TEXT,
  "Status"   TEXT,
  "Note"     TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stores       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.minipc       ENABLE ROW LEVEL SECURITY;

-- Helper function
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- USERS
CREATE POLICY "users_select_own"       ON public.users FOR SELECT USING (id = auth.uid());
CREATE POLICY "users_insert_own"       ON public.users FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY "users_update_own"       ON public.users FOR UPDATE USING (id = auth.uid());
CREATE POLICY "users_admin_select_all" ON public.users FOR SELECT USING (public.get_my_role() = 'admin');

-- TRANSACTIONS
CREATE POLICY "tx_select" ON public.transactions FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "tx_insert" ON public.transactions FOR INSERT WITH CHECK (public.get_my_role() IN ('admin','manager'));
CREATE POLICY "tx_update" ON public.transactions FOR UPDATE USING (public.get_my_role() IN ('admin','manager'));
CREATE POLICY "tx_delete" ON public.transactions FOR DELETE USING (public.get_my_role() = 'admin');

-- STOCK
CREATE POLICY "stock_select" ON public.stock FOR SELECT USING (public.get_my_role() IN ('admin','manager'));
CREATE POLICY "stock_insert" ON public.stock FOR INSERT WITH CHECK (public.get_my_role() IN ('admin','manager'));
CREATE POLICY "stock_update" ON public.stock FOR UPDATE USING (public.get_my_role() IN ('admin','manager'));
CREATE POLICY "stock_delete" ON public.stock FOR DELETE USING (public.get_my_role() = 'admin');

-- STORES
CREATE POLICY "stores_select" ON public.stores FOR SELECT USING (public.get_my_role() IN ('admin','manager'));
CREATE POLICY "stores_insert" ON public.stores FOR INSERT WITH CHECK (public.get_my_role() IN ('admin','manager'));
CREATE POLICY "stores_update" ON public.stores FOR UPDATE USING (public.get_my_role() IN ('admin','manager'));
CREATE POLICY "stores_delete" ON public.stores FOR DELETE USING (public.get_my_role() = 'admin');

-- OFFICES
CREATE POLICY "offices_select" ON public.offices FOR SELECT USING (public.get_my_role() IN ('admin','manager'));
CREATE POLICY "offices_insert" ON public.offices FOR INSERT WITH CHECK (public.get_my_role() IN ('admin','manager'));
CREATE POLICY "offices_update" ON public.offices FOR UPDATE USING (public.get_my_role() IN ('admin','manager'));
CREATE POLICY "offices_delete" ON public.offices FOR DELETE USING (public.get_my_role() = 'admin');

-- WAREHOUSES
CREATE POLICY "wh_select" ON public.warehouses FOR SELECT USING (public.get_my_role() IN ('admin','manager'));
CREATE POLICY "wh_insert" ON public.warehouses FOR INSERT WITH CHECK (public.get_my_role() IN ('admin','manager'));
CREATE POLICY "wh_update" ON public.warehouses FOR UPDATE USING (public.get_my_role() IN ('admin','manager'));
CREATE POLICY "wh_delete" ON public.warehouses FOR DELETE USING (public.get_my_role() = 'admin');

-- MINIPC
CREATE POLICY "minipc_select" ON public.minipc FOR SELECT USING (public.get_my_role() IN ('admin','manager'));
CREATE POLICY "minipc_insert" ON public.minipc FOR INSERT WITH CHECK (public.get_my_role() IN ('admin','manager'));
CREATE POLICY "minipc_update" ON public.minipc FOR UPDATE USING (public.get_my_role() IN ('admin','manager'));
CREATE POLICY "minipc_delete" ON public.minipc FOR DELETE USING (public.get_my_role() = 'admin');

-- ============================================================
-- AUTO-CREATE user row khi đăng ký
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, role)
  VALUES (NEW.id, NEW.email, 'viewer')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- SAU KHI TẠO TÀI KHOẢN ĐẦU TIÊN, chạy lệnh này để set Admin:
-- UPDATE public.users SET role = 'admin' WHERE email = 'your-email@company.com';
-- ============================================================
