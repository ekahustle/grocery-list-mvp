# Grocery List Mingguan

Aplikasi web sederhana **tanpa login** untuk membuat grocery list mingguan dari
menu bank. Pilih 5–10 menu, review stok bahan berdasarkan riwayat minggu
sebelumnya, lalu dapatkan daftar belanja final dengan checklist — semua dalam
satu alur, satu halaman.

Dibangun dengan HTML/CSS/JavaScript biasa (tanpa framework, tanpa build step)
supaya bisa langsung dideploy sebagai situs statis di Vercel.

## Cara kerja

1. **Pilih Menu** — grid menu dari Menu Bank (Supabase), pilih bebas 5–10 menu
   tanpa perlu menentukan menu untuk hari tertentu.
2. **Review Stok** — semua bahan dari menu terpilih digabung otomatis
   berdasarkan `ingredient_id` (bukan pencocokan nama), jadi tidak ada
   duplikasi akibat beda penulisan. Bahan dikelompokkan:
   - **🔄 Perlu Direview Ulang** — bahan yang minggu lalu berstatus "Ada" dan
     muncul lagi di menu minggu ini. Ditampilkan lebih dulu untuk dikonfirmasi
     ulang.
   - **🆕 Stok Baru** — bahan tanpa riwayat (baru pertama kali muncul, atau
     minggu lalu berstatus "Tidak Ada").

   Bahan dari riwayat minggu lalu yang **tidak muncul lagi** di menu minggu
   ini otomatis hangus — tidak dibawa ke riwayat berikutnya.
3. **Grocery List** — bahan yang ditandai "Tidak Ada" saat review ditampilkan
   sebagai daftar belanja final dengan checklist, dikelompokkan per kategori.

Riwayat status stok disimpan di **localStorage browser** (per device, tanpa
akun, tanpa sinkronisasi). Membuka aplikasi di device/browser lain akan mulai
tanpa riwayat.

## Yang sengaja tidak ada (di luar scope)

- Login / akun pengguna
- Tambah, edit, atau hapus menu dari dalam aplikasi (Menu Bank read-only,
  dikelola langsung lewat Supabase)
- Kuantitas/jumlah stok bahan (hanya status Ada / Tidak Ada)
- Assign menu ke hari tertentu
- Filter budget atau harga bahan
- Halaman pantry/ingredients terpisah

## Struktur proyek

```
index.html          Halaman utama (satu halaman, tiga langkah)
css/styles.css       Styling
js/config.js         Konfigurasi URL + anon key Supabase (edit ini!)
js/supabaseClient.js Baca data Menu Bank dari Supabase (read-only)
js/storage.js        Baca/tulis riwayat & progress ke localStorage
js/app.js            Logika alur aplikasi (pilih menu → review → grocery list)
supabase/schema.sql  Skema tabel Menu Bank + RLS policy + contoh data
```

## Setup Supabase (Menu Bank)

Aplikasi ini membaca data Menu Bank dari 3 tabel di Supabase:

| Tabel               | Kolom                                                   | Keterangan                                   |
| ------------------- | -------------------------------------------------------- | --------------------------------------------- |
| `recipes`            | `id`, `name`, `description`, `image_url`                | Daftar menu/resep                             |
| `ingredients`        | `id`, `name`, `category`                                 | Master bahan makanan (kunci dedup: `id`)      |
| `recipe_ingredients`  | `id`, `recipe_id`, `ingredient_id`                       | Relasi many-to-many resep ↔ bahan             |

`category` di `ingredients` bersifat opsional — dipakai untuk mengelompokkan
tampilan grocery list (contoh: "Sayur", "Protein", "Bumbu"). Kosongkan/`null`
kalau tidak perlu, nanti masuk grup "Lainnya".

### Cara mengisi datanya

1. Buat project baru di [supabase.com](https://supabase.com).
2. Buka **SQL Editor**, jalankan seluruh isi file [`supabase/schema.sql`](supabase/schema.sql).
   File ini akan:
   - Membuat 3 tabel di atas
   - Mengaktifkan Row Level Security (RLS) dan hanya mengizinkan `SELECT`
     untuk role `anon` — jadi Menu Bank otomatis **read-only** dari sisi
     aplikasi (tidak ada policy insert/update/delete untuk anon key)
   - Mengisi contoh data (12 resep khas Indonesia + bahan-bahannya) supaya
     aplikasi bisa langsung dicoba
3. Untuk menambah/mengubah menu bank sendiri, gunakan **Table Editor** di
   Supabase Dashboard, atau tulis SQL `insert` seperti contoh di
   `schema.sql` — **bukan** dari dalam aplikasi.
4. Ambil **Project URL** dan **anon public key** dari
   **Project Settings > API**.

## Konfigurasi aplikasi

Edit `js/config.js`:

```js
window.SUPABASE_CONFIG = {
  url: "https://xxxxxxxx.supabase.co",
  anonKey: "eyJhbGciOi...",
};
```

Anon key ini aman ditaruh di kode sisi klien selama RLS aktif dan hanya
mengizinkan `SELECT` (sudah diatur di `schema.sql`).

## Menjalankan secara lokal

Karena tidak ada build step, cukup jalankan static file server dari folder
proyek, contoh:

```bash
npx serve .
# atau
python3 -m http.server 8080
```

Lalu buka `http://localhost:8080` (atau port yang muncul) di browser.

## Deploy ke Vercel

Aplikasi ini adalah situs statis murni (HTML/CSS/JS, tanpa build step), jadi
deploy ke Vercel tidak butuh konfigurasi khusus:

1. Push project ini ke repo GitHub.
2. Import repo di [vercel.com/new](https://vercel.com/new).
3. Framework preset pilih **Other** — Vercel akan menyajikan `index.html`
   langsung sebagai static site.
4. Pastikan `js/config.js` sudah diisi URL + anon key Supabase **sebelum**
   deploy (karena tidak ada environment variable/build step, config
   langsung dibaca dari file ini di browser).
5. Deploy.

## Catatan teknis

- Supabase JS client dimuat lewat `import()` dinamis dari CDN (`esm.sh`) di
  `js/supabaseClient.js`, jadi kalau koneksi ke CDN gagal, aplikasi
  menampilkan pesan error yang jelas dan tidak nge-blank.
- Semua teks antarmuka dalam Bahasa Indonesia dan tampilan sudah responsive
  untuk layar HP (mobile-first).
