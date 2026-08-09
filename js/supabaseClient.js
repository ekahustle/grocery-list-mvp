// Client Supabase untuk membaca & menambah Menu Bank: recipes, ingredients,
// recipe_ingredients. Tidak ada operasi update/delete dari aplikasi ini —
// hanya select (menu bank) dan insert (fitur "Tambah Menu").
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

// Ambil semua bahan yang ada di menu bank, untuk cache autocomplete di form
// "Tambah Menu" dan untuk menurunkan daftar kategori yang sudah dipakai.
export async function fetchAllIngredients() {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase belum dikonfigurasi.");

  const { data, error } = await supabase
    .from("ingredients")
    .select("id, name, category")
    .order("name", { ascending: true });

  if (error) throw error;
  return data || [];
}

// Tambah resep baru ke menu bank. description/image_url dikirim null kalau
// kosong (bukan string kosong), konsisten dengan data resep yang sudah ada.
export async function insertRecipe({ name, description, image_url }) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase belum dikonfigurasi.");

  const { data, error } = await supabase
    .from("recipes")
    .insert({
      name,
      description: description || null,
      image_url: image_url || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Tambah bahan baru ke master ingredient. `name` unique di database — kalau
// bahan dengan nama itu sudah ada (race, atau beda kapitalisasi), fallback
// ambil row yang sudah ada alih-alih gagal.
export async function insertIngredient({ name, category }) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase belum dikonfigurasi.");

  const { data, error } = await supabase
    .from("ingredients")
    .insert({ name, category: category || null })
    .select()
    .single();

  if (!error) return data;

  if (error.code === "23505") {
    const { data: existing, error: fetchError } = await supabase
      .from("ingredients")
      .select("id, name, category")
      .ilike("name", name)
      .limit(1)
      .single();
    if (fetchError) throw fetchError;
    return existing;
  }

  throw error;
}

// Hubungkan sekumpulan ingredient ke satu resep sekaligus (bulk insert).
// Dedupe ingredientIds dulu -- recipe_ingredients punya
// unique(recipe_id, ingredient_id), jadi ID yang sama dua kali akan gagal
// kalau tidak di-dedupe di sini.
export async function insertRecipeIngredients(recipeId, ingredientIds) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase belum dikonfigurasi.");

  const uniqueIds = [...new Set(ingredientIds)];
  if (uniqueIds.length === 0) return [];

  const rows = uniqueIds.map((ingredientId) => ({
    recipe_id: recipeId,
    ingredient_id: ingredientId,
  }));

  const { data, error } = await supabase.from("recipe_ingredients").insert(rows).select();

  if (error) throw error;
  return data || [];
}
