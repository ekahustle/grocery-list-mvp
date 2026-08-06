// Semua state aplikasi disimpan di localStorage browser. Tidak ada login,
// tidak ada sinkronisasi antar-device — riwayat hanya berlaku di browser ini.

const KEY_LAST_SESSION = "gl_last_session_v1";
const KEY_CURRENT = "gl_current_progress_v1";

// Sesi terakhir yang SUDAH selesai direview: dipakai sebagai "riwayat 1
// minggu terakhir" untuk minggu berikutnya.
// Bentuk: { completedAt: ISOString, statuses: { [ingredientId]: 'ada' | 'tidak_ada' } }
export function getLastSession() {
  try {
    const raw = localStorage.getItem(KEY_LAST_SESSION);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveLastSession(statuses) {
  const payload = { completedAt: new Date().toISOString(), statuses };
  localStorage.setItem(KEY_LAST_SESSION, JSON.stringify(payload));
}

// Progress minggu yang sedang berjalan (dipakai supaya tidak hilang kalau
// halaman ter-refresh di HP saat lagi belanja / lagi review).
export function getCurrentProgress() {
  try {
    const raw = localStorage.getItem(KEY_CURRENT);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveCurrentProgress(progress) {
  localStorage.setItem(KEY_CURRENT, JSON.stringify(progress));
}

export function clearCurrentProgress() {
  localStorage.removeItem(KEY_CURRENT);
}
