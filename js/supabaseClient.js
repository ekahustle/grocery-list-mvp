// Client Supabase (read-only) untuk membaca Menu Bank: recipes, ingredients,
// recipe_ingredients. Tidak ada operasi insert/update/delete dari aplikasi ini.
//
// Catatan: library @supabase/supabase-js dimuat lewat dynamic import() (bukan
// static import) supaya kalau CDN-nya gagal dimuat (offline, ad-blocker,
// firewall), errornya bisa ditangkap dengan rapi lewat try/catch di
// pemanggilnya, bukan membuat seluruh halaman blank.

const config = window.SUPABASE_CONFIG || {};

export const isSupabaseConfigured =
  !!config.url &&
  !!config.anonKey &&
  !config.url.includes("YOUR-PROJECT") &&
  !config.anonKey.includes("YOUR-SUPABASE");

let clientPromise = null;
function getClient() {
  if (!isSupabaseConfigured) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import("https://esm.sh/@supabase/supabase-js@2")
      .then(({ createClient }) => createClient(config.url, config.anonKey))
      .catch((err) => {
        clientPromise = null;
        throw new Error(
          "Gagal memuat pustaka Supabase dari CDN. Cek koneksi internet / ad-blocker, lalu muat ulang halaman."
        );
      });
  }
  return clientPromise;
}

// Ambil semua resep di menu bank, untuk grid pilih menu mingguan.
export async function fetchRecipes() {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase belum dikonfigurasi.");

  const { data, error } = await supabase
    .from("recipes")
    .select("id, name, description, image_url")
    .order("name", { ascending: true });

  if (error) throw error;
  return data || [];
}

// Ambil bahan-bahan (dengan ingredient_id sebagai kunci) untuk sekumpulan
// resep terpilih, lalu digabung tanpa duplikasi di sisi pemanggil.
export async function fetchIngredientsForRecipes(recipeIds) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase belum dikonfigurasi.");
  if (!recipeIds || recipeIds.length === 0) return [];

  const { data, error } = await supabase
    .from("recipe_ingredients")
    .select("recipe_id, ingredient_id, ingredients ( id, name, category )")
    .in("recipe_id", recipeIds);

  if (error) throw error;
  return data || [];
}
