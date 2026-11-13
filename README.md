# DompetKu

DompetKu adalah backend aplikasi e-wallet untuk tugas besar Cloud Computing Kelompok 6. Status saat ini: **Phase 3 — Account Authentication**. Registrasi dan login tersedia; operasi top-up, transfer, riwayat transaksi, dan pipeline Jenkins belum diimplementasikan.

## Teknologi dan arsitektur

Node.js (ES modules), Express, PostgreSQL, Knex, Zod, dotenv, Helmet, CORS, Vitest, Supertest, ESLint, Prettier, dan Nodemon. bcrypt digunakan untuk hash password dan JWT untuk token login. Aplikasi memisahkan konfigurasi, routing, middleware, dan utilitas dari proses server. Koneksi Knex dibuat secara lazy ketika dibutuhkan. Health check memeriksa koneksi PostgreSQL; migration awal dan seed contoh tersedia.

## Persyaratan dan instalasi

- Node.js 24 dan npm; PostgreSQL diperlukan saat menggunakan perintah database.
- Jalankan `npm ci`, salin `.env.example` ke `.env`, lalu sesuaikan konfigurasi. Jangan commit `.env`.
- `PORT` harus berupa port valid, dan `CORS_ORIGIN` adalah origin frontend yang diizinkan. Health check memerlukan koneksi database; tes HTTP biasa menggunakan pemeriksaan database terisolasi. Server memerlukan JWT_SECRET acak minimal 32 karakter; JWT_EXPIRES_IN default 1h dan menerima format seperti 30m, 1h, atau 1d. Jangan menyimpan secret asli dalam repository.
- Untuk perintah database, isi seluruh `DB_*` termasuk password yang sesuai. Gunakan database terpisah untuk testing: isi `DB_NAME` untuk database development dan `TEST_DB_NAME` dengan nama database test yang berbeda, lalu atur `NODE_ENV=test` atau pilih `--env test` untuk perintah Knex. Jangan gunakan database production untuk test. Pengaturan kredensial dan pembuatan database menjadi tanggung jawab lingkungan lokal. Gunakan secret JWT yang unik dan kuat untuk setiap lingkungan.

## Perintah

| Perintah                                                         | Fungsi                                                |
| ---------------------------------------------------------------- | ----------------------------------------------------- |
| `npm run dev` / `npm start`                                      | Menjalankan server development / server               |
| `npm test` / `npm run test:watch`                                | Tes tanpa database / watch                            |
| `npm run test:db`                                                | Tes integrasi pada database test yang sudah dimigrasi |
| `npm run lint` / `npm run lint:fix`                              | Memeriksa / memperbaiki lint                          |
| `npm run format:check` / `npm run format`                        | Memeriksa / memformat                                 |
| `npm run db:migrate` / `npm run db:rollback` / `npm run db:seed` | Migration, rollback, dan seed test                    |

## Health check

`GET /health` menjalankan `SELECT 1` ke PostgreSQL. Ketika terhubung, HTTP 200 mengembalikan `{"success":true,"data":{"status":"ok","service":"dompetku","database":"connected"}}`. Jika koneksi gagal, respons HTTP 503 berisi kode `DATABASE_UNAVAILABLE` tanpa detail internal. Pemeriksaan ini tidak memvalidasi skema atau migrasi. Endpoint yang tidak dikenal menghasilkan 404.

## Alur Git

Kembangkan perubahan pada branch fitur dari baseline terbaru, tinjau perubahan dan jalankan quality gates sebelum membuat commit atau mengusulkan penggabungan ke `main`. Phase 1 menggunakan `feature/project-setup`.

## Rancangan database Phase 2

Skema menggunakan `accounts`, `wallets`, `transactions`, dan `ledger_entries`. Nominal disimpan sebagai bilangan bulat rupiah (`bigint`), tanpa pecahan; batas minimum Rp1.000, saldo nonnegatif, kunci idempotensi per wallet pengirim, dan relasi peserta transaksi dijaga oleh constraint. Nama tabel, satuan rupiah, ruang lingkup idempotensi, dan saldo awal nol merupakan keputusan desain proyek, bukan ketentuan terperinci dokumen tugas. PostgreSQL mengembalikan nilai `bigint` sebagai string melalui driver; kode aplikasi nanti harus menghindari konversi ke JavaScript `Number` tanpa pemeriksaan rentang.

Constraint skema saja belum menjamin transfer atomik, batas harian Rp2.000.000, konsistensi mutasi saldo dengan ledger, maupun pemrosesan idempotensi secara menyeluruh. Fitur transaksi nantinya harus memakai transaksi database dan penguncian yang sesuai. Zona waktu batas harian dan aturan autentikasi masih perlu ditetapkan sebelum implementasi fitur terkait. Health check memeriksa koneksi database, tetapi tidak menguji kesiapan skema.

Migration dapat diterapkan dengan `npm run db:migrate` dan dikembalikan dengan `npm run db:rollback`; jalankan hanya terhadap database yang dituju. `npm run db:seed` menyediakan dua akun contoh dengan login dinonaktifkan dan saldo nol; seed hanya berjalan pada database test yang dikonfigurasi dengan `NODE_ENV=test`. Aturan bisnis belum diimplementasikan atau diuji end-to-end.

Tes database menggunakan transaksi yang dibatalkan setelah tiap kasus. Siapkan database test terpisah, isi `TEST_DB_NAME`, lalu jalankan migration dengan `NODE_ENV=test` sebelum `npm run test:db`. Nama test dibandingkan dengan `DB_NAME`, tetapi konfigurasi dan hak akses PostgreSQL tetap harus memastikan server dan database test bukan production.

## Registrasi dan login

`POST /auth/register` menerima JSON `{"name":"Nama","email":"user@example.com","password":"password-aman"}`. Password harus minimal 8 karakter dan maksimal 72 byte UTF-8. Akun dan wallet saldo nol dibuat dalam satu transaksi; respons 201 hanya memuat data akun, tanpa hash. Email dinormalisasi menjadi huruf kecil dan harus unik tanpa membedakan kapitalisasi; email duplikat menghasilkan 409.

`POST /auth/login` menerima `email` dan `password`, lalu mengembalikan access token JWT bertipe Bearer. Email tidak dikenal dan password salah menghasilkan respons 401 yang sama. Token berlaku selama `JWT_EXPIRES_IN`; endpoint terlindungi, refresh token, pencabutan token, dan pembatasan percobaan login belum tersedia. Konfigurasi tersebut harus ditambahkan sebelum deployment publik.

Migration kedua menambahkan indeks unik email case-insensitive. Jika database yang sudah berisi data memiliki email yang hanya berbeda kapitalisasi, migration akan gagal dan duplikasi harus ditangani secara manual sebelum dijalankan.
