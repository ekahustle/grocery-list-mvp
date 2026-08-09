-- ============================================================================
-- Migration 0001 — Izinkan INSERT publik (role anon) untuk fitur "Tambah Menu"
-- ============================================================================
-- Jalankan file ini di Supabase Dashboard > SQL Editor pada project yang
-- sudah menjalankan supabase/schema.sql sebelumnya (tabel + RLS select sudah
-- ada). Aman dijalankan berkali-kali (drop policy if exists sebelum create).
--
-- App ini tidak punya login/auth — anon key memang publik dan tertanam di
-- js/config.js. Insert dibuka tanpa syarat tambahan (keputusan sadar untuk
-- app pribadi/keluarga). Tidak ada policy update/delete — fitur hanya butuh
-- insert.
-- ============================================================================

drop policy if exists "Public insert access - recipes" on recipes;
create policy "Public insert access - recipes"
  on recipes for insert
  to anon
  with check (true);

drop policy if exists "Public insert access - ingredients" on ingredients;
create policy "Public insert access - ingredients"
  on ingredients for insert
  to anon
  with check (true);

drop policy if exists "Public insert access - recipe_ingredients" on recipe_ingredients;
create policy "Public insert access - recipe_ingredients"
  on recipe_ingredients for insert
  to anon
  with check (true);
