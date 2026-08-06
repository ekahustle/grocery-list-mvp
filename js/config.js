// ============================================================================
// Konfigurasi Supabase
// ============================================================================
// Isi dengan URL project dan anon (public) key dari Supabase kamu:
// Dashboard Supabase > Project Settings > API.
//
// Anon key ini AMAN untuk ditaruh di kode sisi klien selama Row Level
// Security (RLS) sudah diaktifkan dan hanya mengizinkan SELECT (lihat
// supabase/schema.sql). Jangan pernah taruh service_role key di sini.
// ============================================================================

window.SUPABASE_CONFIG = {
  url: "https://YOUR-PROJECT-REF.supabase.co",
  anonKey: "YOUR-SUPABASE-ANON-PUBLIC-KEY",
};
