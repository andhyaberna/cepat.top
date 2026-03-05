# Root Cause Analysis: Ketidaksesuaian Data Katalog Produk
**Tanggal:** 2026-03-05
**Penyusun:** Trae AI Assistant

## 1. Executive Summary
Ditemukan dua penyebab utama ketidaksesuaian (data discrepancy) antara tampilan Admin Area dan Dashboard User:
1.  **Cache Inconsistency (High Severity):** Dashboard menggunakan data ter-cache (durasi 1 jam) yang tidak dibersihkan saat Admin melakukan update produk. Ini menyebabkan perubahan harga, nama, atau status produk tidak langsung terlihat oleh user.
2.  **Visibility Gap (Medium Severity):** Admin Area menampilkan semua produk tanpa indikator status (Active/Inactive), sedangkan Dashboard memfilter dan hanya menampilkan produk "Active". Hal ini menyebabkan kebingungan bagi Admin karena tidak mengetahui produk mana yang sebenarnya tampil di sisi user.

## 2. Detail Audit
### A. Struktur Database (Spreadsheet)
-   **Konsistensi:** ✅ Valid.
-   Kedua sisi menggunakan Sheet `Access_Rules` sebagai sumber data.
-   Mapping kolom konsisten:
    -   ID: Kolom A (Index 0)
    -   Title: Kolom B (Index 1)
    -   Status: Kolom F (Index 5)

### B. Query & Data Retrieval
| Fitur | Fungsi Backend | Metode Fetch | Filter Logic | Cache |
| :--- | :--- | :--- | :--- | :--- |
| **Admin Area** | `getAdminData` | `getDataRange().getValues()` (Live) | **TIDAK ADA** (Menampilkan semua) | Tidak ada (Real-time) |
| **Dashboard** | `getProducts` | `getCachedData_` (Cached) | `Status === "Active"` | **YA (1 Jam)** |

**Temuan:**
-   Admin Area selalu melihat data *real-time*.
-   Dashboard melihat data *cached* yang bisa tertinggal hingga 60 menit dari versi terbaru.

### C. Business Logic
-   **Admin:** Tidak ada filter status. Admin melihat produk Inactive seolah-olah aktif (karena tidak ada label status di UI).
-   **Dashboard:** Strict filter `Status == "Active"`. Produk Inactive disembunyikan.

### D. API Response Structure
-   **Admin:** Array of Arrays (Raw Rows). Hemat bandwidth tapi rentan kesalahan indeks manual.
-   **Dashboard:** Array of Objects. Lebih aman dan terstruktur.
-   **Impact:** Tidak ada isu fungsional langsung, namun menyulitkan maintenance.

## 3. Rekomendasi Perbaikan
### A. Backend (Critical)
-   Implementasi **Cache Invalidation** pada fungsi `saveProduct` dan `deleteProduct`.
-   Setiap kali produk disimpan/dihapus, hapus key cache `access_rules` agar Dashboard memaksa ambil data baru.

### B. Frontend Admin (UX)
-   Tambahkan **Badge Status** (Active/Inactive) pada kartu produk di Admin Area.
-   Pastikan Admin sadar bahwa produk "Inactive" tidak akan muncul di Dashboard.

### C. Monitoring
-   Tambahkan log sistem saat cache dibersihkan.
