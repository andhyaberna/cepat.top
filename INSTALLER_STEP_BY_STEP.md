# Installer Step by Step

Panduan ini ditujukan untuk user baru yang pertama kali memasang aplikasi dari folder `installer/`.

## 1. Siapkan Tool Dasar

1. Install Node.js versi LTS.
2. Pastikan `node` dan `npm` bisa dijalankan dari terminal.
3. Siapkan akun Google untuk Google Sheets dan Apps Script.
4. Siapkan akun Cloudflare jika aplikasi akan dideploy lewat Pages / Worker.

## 2. Buka Folder Installer

1. Masuk ke folder `installer/`.
2. Buka terminal di folder tersebut.
3. Jalankan pengecekan isi folder dan pastikan file berikut ada:
   - `install.js`
   - `appscript.js`
   - `wrangler.jsonc`
   - `site.config.js`
   - `validate-config.js`

## 3. Jalankan Wizard Instalasi Pertama

1. Jalankan:

```bash
node install.js
```

2. Isi data yang diminta wizard:
   - domain utama
   - URL Apps Script Web App
   - URL webhook / Moota bila dipakai
   - Spreadsheet ID dan nama spreadsheet
   - email admin awal
   - password admin awal
   - nama admin awal
   - identitas situs

3. Setelah selesai, wizard akan membuat:
   - `.env.local`
   - update `site.config.js`
   - update `wrangler.jsonc`
   - folder `.setup-output/`

## 4. Import Seed Data ke Google Sheets

1. Buka Google Sheets baru atau spreadsheet target.
2. Buat sheet dengan nama:
   - `Settings`
   - `Users`
   - `Orders`
   - `Access_Rules`
   - `Pages`
3. Import file CSV dari `.setup-output/seed-data/` ke sheet dengan nama yang sama.
4. Pastikan sheet `Users` sudah berisi admin awal hasil wizard.

## 5. Pasang Google Apps Script

1. Di spreadsheet, buka `Extensions -> Apps Script`.
2. Hapus isi script default jika ada.
3. Paste seluruh isi `appscript.js`.
4. Simpan project.
5. Buka `Project Settings -> Script properties`.
6. Isi property dari file `.setup-output/apps-script-properties.json`.
7. Deploy sebagai `Web app`.
8. Simpan URL `/exec` hasil deploy.

## 6. Cek Konfigurasi Runtime

1. Pastikan `site.config.js` berisi domain yang benar.
2. Pastikan `wrangler.jsonc` berisi:
   - `ALLOWED_ORIGINS`
   - `APP_GAS_URL`
   - `MOOTA_GAS_URL`
   - `MOOTA_TOKEN`
3. Review `.env.local` sebagai catatan instalasi lokal.

## 7. Deploy Aplikasi

1. Push isi paket installer ke repository deploy Anda atau upload sesuai workflow Anda.
2. Deploy ke Cloudflare Pages / Worker.
3. Pastikan domain produksi mengarah ke hasil deploy tersebut.

## 8. Validasi Setelah Deploy

1. Jalankan:

```bash
node validate-config.js
```

2. Login ke admin area.
3. Isi branding, payment, dan integrasi tambahan.
4. Jalankan test koneksi yang tersedia di admin area.
5. Buka halaman depan, checkout, login, dan dashboard untuk memastikan semua route normal.

## 9. Jika Ingin Otomasi

Wizard juga bisa dijalankan tanpa prompt interaktif:

```bash
node install.js --non-interactive
```

Gunakan environment variable `INSTALLER_*` seperti yang dijelaskan di `README.md`.

## 10. File Penting yang Perlu Disimpan

- `.env.local`
- `.setup-output/INSTALL_SUMMARY.md`
- `.setup-output/apps-script-properties.json`
- `.setup-output/database.connection.json`
- `.setup-output/seed-data/*.csv`

Jika Anda butuh langkah cepat, mulai dari `README.md`. Jika Anda butuh urutan instalasi paling detail, ikuti file ini dari atas ke bawah.
