# DompetKu

DompetKu adalah backend aplikasi e-wallet untuk tugas besar Cloud Computing Kelompok 6. Status saat ini: **Phase 1 — Backend Foundation**. Endpoint liveness tersedia; autentikasi, wallet, transaksi, skema database, dan pipeline Jenkins belum diimplementasikan.

## Teknologi dan arsitektur

Node.js (ES modules), Express, PostgreSQL, Knex, Zod, dotenv, Helmet, CORS, Vitest, Supertest, ESLint, Prettier, dan Nodemon. bcrypt dan JWT akan ditambahkan pada fase autentikasi. Aplikasi memisahkan konfigurasi, routing, middleware, dan utilitas dari proses server. Koneksi Knex dibuat secara lazy ketika dibutuhkan; health check tidak memeriksa database. Direktori migration dan seed disediakan tanpa skema maupun data.

## Persyaratan dan instalasi

- Node.js 24 dan npm; PostgreSQL diperlukan saat menggunakan perintah database.
- Jalankan `npm ci`, salin `.env.example` ke `.env`, lalu sesuaikan konfigurasi. Jangan commit `.env`.
- `PORT` harus berupa port valid, dan `CORS_ORIGIN` adalah origin frontend yang diizinkan. Server dan tes health tidak membutuhkan database atau JWT secret.
- Untuk perintah database, isi seluruh `DB_*` termasuk password yang sesuai. Gunakan database terpisah untuk testing: atur `NODE_ENV=test` dan `DB_NAME` ke database khusus test sebelum menjalankan perintah Knex. Jangan gunakan database development/production untuk test. Pengaturan kredensial dan pembuatan database menjadi tanggung jawab lingkungan lokal. Variabel JWT hanya disiapkan untuk fase berikutnya.

## Perintah

| Perintah                                                         | Fungsi                                       |
| ---------------------------------------------------------------- | -------------------------------------------- |
| `npm run dev` / `npm start`                                      | Menjalankan server development / server      |
| `npm test` / `npm run test:watch`                                | Tes sekali / watch                           |
| `npm run lint` / `npm run lint:fix`                              | Memeriksa / memperbaiki lint                 |
| `npm run format:check` / `npm run format`                        | Memeriksa / memformat                        |
| `npm run db:migrate` / `npm run db:rollback` / `npm run db:seed` | Perintah Knex; belum ada migration atau seed |

## Health check

`GET /health` mengembalikan HTTP 200 dan `{"success":true,"data":{"status":"ok","service":"dompetku"}}`. Ini hanya liveness check, bukan pemeriksaan kesiapan PostgreSQL. Endpoint yang tidak dikenal menghasilkan 404.

## Alur Git

Kembangkan perubahan pada branch fitur dari baseline terbaru, tinjau perubahan dan jalankan quality gates sebelum membuat commit atau mengusulkan penggabungan ke `main`. Phase 1 menggunakan `feature/project-setup`.
