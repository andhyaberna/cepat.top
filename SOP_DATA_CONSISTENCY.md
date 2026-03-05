# Standard Operating Procedure (SOP): Menjaga Konsistensi Data Katalog Produk

Dokumen ini panduan operasional untuk memastikan data produk yang tampil di **Dashboard User** selalu sinkron dengan data di **Admin Area** dan **Database Utama (Google Sheets)**.

## 1. Arsitektur Data
Penting untuk memahami alur data agar dapat mendiagnosa masalah dengan tepat:

1.  **Source of Truth (Database):** Google Sheets (Sheet `Access_Rules`). Ini adalah data master.
2.  **Admin Area:** Mengambil data langsung dari Sheet melalui fungsi `getAdminData`. Menampilkan *semua* produk (Active & Inactive).
3.  **API Layer (Google Apps Script):** Menggunakan caching (`CacheService`) untuk performa tinggi.
4.  **Dashboard User:** Mengambil data dari API (`getProducts`) yang hanya menampilkan status `Active`. Data ini juga disimpan sementara di browser user (`localStorage`) selama 1 jam.

---

## 2. Fitur Monitoring (System Health)
Telah ditambahkan fitur **System Health** di dalam Admin Area untuk mendeteksi ketidaksesuaian secara otomatis.

### Cara Mengakses:
1.  Login ke **Admin Area**.
2.  Buka menu **System Health** di sidebar.
3.  Klik tombol **Refresh** untuk menjalankan diagnostik.

### Membaca Laporan:
Laporan akan menampilkan 3 indikator utama:

| Indikator | Deskripsi | Status Normal |
| :--- | :--- | :--- |
| **Product Cache** | Status sinkronisasi antara Google Sheet dan Server Cache. | `ok` atau `empty (clean)` |
| **Data Integrity** | Hasil pengujian otomatis logika backend (Unit Test). Memastikan API `getProducts` mengembalikan jumlah data yang sama dengan jumlah baris 'Active' di Sheet. | `Success` |
| **Active Products** | Jumlah produk berstatus 'Active' yang terdeteksi di Database. | Sesuai jumlah produk Anda |

---

## 3. Penanganan Masalah (Troubleshooting)

### Skenario A: Data Integrity "Failed"
Jika indikator Data Integrity menunjukkan status `Failed` atau `Error`, artinya ada bug pada logika kode atau struktur data yang rusak.

**Langkah Perbaikan:**
1.  Buka Google Sheet database.
2.  Cek Sheet `Access_Rules`. Pastikan tidak ada baris kosong di tengah-tengah data.
3.  Pastikan kolom status (Kolom F / Index 5) terisi dengan benar ("Active" atau "Inactive").
4.  Cek kolom harga (Kolom E / Index 4), pastikan hanya berisi angka.
5.  Refresh System Health.

### Skenario B: Product Cache "Mismatch"
Artinya data di cache server tertinggal dibandingkan data di Sheet (misal: baru saja edit manual di Sheet tapi cache belum update).

**Langkah Perbaikan:**
1.  Di Admin Area, buka menu **Produk & Layanan**.
2.  Lakukan edit ringan pada salah satu produk (misal: tambah spasi di deskripsi lalu hapus lagi), kemudian **Simpan**.
3.  Aksi "Simpan" akan memicu pembersihan cache otomatis.
4.  Cek kembali System Health.

### Skenario C: User Komplain Data Tidak Update
Jika System Health "Healthy" tapi user masih melihat data lama.

**Penyebab:** Browser user menyimpan cache lama (`localStorage`).
**Solusi:**
1.  Minta user untuk **Logout** dan **Login** kembali. (Proses logout membersihkan data lokal).
2.  Atau minta user melakukan Hard Refresh (`Ctrl + F5`).

---

## 4. Jadwal Pengecekan Berkala

Disarankan untuk melakukan pengecekan System Health pada waktu-waktu berikut:

1.  **Setelah Update Massal:** Jika Anda melakukan perubahan harga atau stok banyak produk sekaligus langsung dari Google Sheets.
2.  **Sebelum Event Promo:** H-1 sebelum flash sale atau launching produk baru.
3.  **Mingguan:** Setiap hari Senin pagi untuk memastikan sistem berjalan optimal.

---

## 5. Kontak Teknis
Jika masalah Data Integrity tetap persisten (gagal terus menerus), segera hubungi pengembang dengan menyertakan screenshot halaman System Health yang menampilkan pesan error di bagian "Issues Found".
