-- ============================================================================
-- Grocery List Mingguan — Skema Supabase (Menu Bank, read-only untuk aplikasi)
-- ============================================================================
-- Jalankan seluruh file ini di Supabase Dashboard > SQL Editor.
-- Tabel ini adalah "Menu Bank": resep + bahan. Aplikasi hanya membaca (SELECT).
-- Tidak ada fitur tambah/edit menu dari dalam aplikasi — isi data lewat SQL
-- Editor atau Table Editor di Supabase.
-- ============================================================================

-- 1. Tabel resep (menu bank)
create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  image_url text,
  created_at timestamptz not null default now()
);

-- 2. Tabel bahan makanan (ingredient master, jadi kunci deduplikasi)
create table if not exists ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text, -- contoh: 'Sayur', 'Protein', 'Bumbu', 'Bahan Pokok' (opsional, untuk grouping tampilan)
  created_at timestamptz not null default now()
);

-- 3. Tabel relasi resep <-> bahan (many-to-many)
create table if not exists recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  unique (recipe_id, ingredient_id)
);

create index if not exists idx_recipe_ingredients_recipe on recipe_ingredients(recipe_id);
create index if not exists idx_recipe_ingredients_ingredient on recipe_ingredients(ingredient_id);

-- ============================================================================
-- Row Level Security — aplikasi jalan tanpa login (pakai anon key), jadi akses
-- dibuka untuk SELECT saja. Tidak ada policy insert/update/delete untuk anon,
-- sehingga menu bank otomatis read-only dari sisi aplikasi.
-- ============================================================================

alter table recipes enable row level security;
alter table ingredients enable row level security;
alter table recipe_ingredients enable row level security;

create policy "Public read access - recipes"
  on recipes for select
  to anon
  using (true);

create policy "Public read access - ingredients"
  on ingredients for select
  to anon
  using (true);

create policy "Public read access - recipe_ingredients"
  on recipe_ingredients for select
  to anon
  using (true);

-- ============================================================================
-- Contoh data (opsional) — hapus atau sesuaikan sesuai kebutuhan menu bank kamu
-- ============================================================================

insert into ingredients (name, category) values
  ('Beras', 'Bahan Pokok'),
  ('Telur', 'Protein'),
  ('Ayam', 'Protein'),
  ('Daging Sapi', 'Protein'),
  ('Ikan Kembung', 'Protein'),
  ('Tahu', 'Protein'),
  ('Tempe', 'Protein'),
  ('Bawang Merah', 'Bumbu'),
  ('Bawang Putih', 'Bumbu'),
  ('Cabai Merah', 'Bumbu'),
  ('Cabai Rawit', 'Bumbu'),
  ('Kecap Manis', 'Bumbu'),
  ('Garam', 'Bumbu'),
  ('Gula Pasir', 'Bumbu'),
  ('Minyak Goreng', 'Bumbu'),
  ('Santan', 'Bumbu'),
  ('Kunyit', 'Bumbu'),
  ('Lengkuas', 'Bumbu'),
  ('Serai', 'Bumbu'),
  ('Daun Salam', 'Bumbu'),
  ('Wortel', 'Sayur'),
  ('Kentang', 'Sayur'),
  ('Kol', 'Sayur'),
  ('Kangkung', 'Sayur'),
  ('Bayam', 'Sayur'),
  ('Buncis', 'Sayur'),
  ('Tauge', 'Sayur'),
  ('Timun', 'Sayur'),
  ('Tomat', 'Sayur'),
  ('Jagung Manis', 'Sayur')
on conflict (name) do nothing;

insert into recipes (name, description) values
  ('Nasi Goreng', 'Nasi goreng bumbu kecap sederhana'),
  ('Ayam Bakar', 'Ayam bakar bumbu kunyit'),
  ('Sayur Sop', 'Sop sayur bening dengan wortel dan kentang'),
  ('Tumis Kangkung', 'Kangkung tumis bawang putih dan cabai'),
  ('Soto Ayam', 'Soto ayam kuah kunyit'),
  ('Rendang Daging', 'Rendang daging sapi santan'),
  ('Capcay', 'Capcay sayuran campur'),
  ('Gado-Gado', 'Sayuran rebus dengan bumbu kacang'),
  ('Ikan Bakar', 'Ikan kembung bakar bumbu rica'),
  ('Tempe Orek', 'Tempe orek manis pedas'),
  ('Sup Jagung', 'Sup jagung manis dengan wortel'),
  ('Telur Balado', 'Telur rebus dengan sambal balado')
on conflict do nothing;

-- Hubungkan resep dengan bahan (contoh)
with r as (select id, name from recipes),
     i as (select id, name from ingredients)
insert into recipe_ingredients (recipe_id, ingredient_id)
select r.id, i.id from r, i where
  (r.name = 'Nasi Goreng' and i.name in ('Beras','Telur','Bawang Merah','Bawang Putih','Kecap Manis','Garam','Minyak Goreng','Cabai Rawit')) or
  (r.name = 'Ayam Bakar' and i.name in ('Ayam','Kunyit','Bawang Merah','Bawang Putih','Garam','Minyak Goreng','Serai')) or
  (r.name = 'Sayur Sop' and i.name in ('Wortel','Kentang','Kol','Bawang Putih','Garam','Daun Salam')) or
  (r.name = 'Tumis Kangkung' and i.name in ('Kangkung','Bawang Putih','Cabai Merah','Garam','Minyak Goreng')) or
  (r.name = 'Soto Ayam' and i.name in ('Ayam','Kunyit','Bawang Putih','Bawang Merah','Serai','Daun Salam','Garam','Tauge')) or
  (r.name = 'Rendang Daging' and i.name in ('Daging Sapi','Santan','Cabai Merah','Bawang Merah','Bawang Putih','Lengkuas','Serai','Daun Salam','Garam')) or
  (r.name = 'Capcay' and i.name in ('Wortel','Kol','Buncis','Jagung Manis','Bawang Putih','Garam','Minyak Goreng')) or
  (r.name = 'Gado-Gado' and i.name in ('Tahu','Tempe','Tauge','Kol','Timun','Garam','Gula Pasir')) or
  (r.name = 'Ikan Bakar' and i.name in ('Ikan Kembung','Cabai Merah','Bawang Merah','Bawang Putih','Garam','Minyak Goreng')) or
  (r.name = 'Tempe Orek' and i.name in ('Tempe','Kecap Manis','Bawang Merah','Bawang Putih','Cabai Merah','Gula Pasir','Minyak Goreng')) or
  (r.name = 'Sup Jagung' and i.name in ('Jagung Manis','Wortel','Bawang Putih','Garam','Telur')) or
  (r.name = 'Telur Balado' and i.name in ('Telur','Cabai Merah','Bawang Merah','Bawang Putih','Gula Pasir','Garam','Minyak Goreng'))
on conflict do nothing;
