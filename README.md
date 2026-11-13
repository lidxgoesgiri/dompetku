# DompetKu

DompetKu adalah backend aplikasi e-wallet untuk tugas besar Cloud Computing Kelompok 6. Backend mengikuti kontrak PRD v1.1 dengan registrasi, login, saldo, top-up simulasi, transfer, dan riwayat transaksi. Rancangan pipeline tersedia dan menunggu verifikasi pada lingkungan DevOps; UI ditunda.

## Teknologi dan arsitektur

Node.js (ES modules), Express, PostgreSQL, Knex, Zod, dotenv, Helmet, CORS, Vitest, Supertest, ESLint, Prettier, dan Nodemon. bcrypt digunakan untuk hash password dan JWT untuk token login. Aplikasi memisahkan konfigurasi, routing, middleware, dan utilitas dari proses server. Koneksi Knex dibuat secara lazy ketika dibutuhkan. Health check memeriksa koneksi PostgreSQL; migration dan seed contoh tersedia.

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

Skema menggunakan `accounts`, `wallets`, `transactions`, dan `ledger_entries`. Nominal disimpan sebagai bilangan bulat rupiah (`bigint`), tanpa pecahan; ledger mencatat tipe, nominal dan persamaan saldo; batas minimum Rp1.000, saldo nonnegatif, kunci idempotensi global, dan relasi peserta transaksi dijaga oleh constraint. Nama tabel, satuan rupiah, ruang lingkup idempotensi, dan saldo awal nol merupakan keputusan desain proyek, bukan ketentuan terperinci dokumen tugas. PostgreSQL mengembalikan nilai `bigint` sebagai string melalui driver; kode aplikasi nanti harus menghindari konversi ke JavaScript `Number` tanpa pemeriksaan rentang.

Operasi wallet menggunakan transaksi database dan penguncian baris untuk menjaga saldo dan ledger. Batas transfer harian menggunakan zona waktu Asia/Jakarta sebagai keputusan proyek. Constraint skema sendiri tidak mencegah perubahan langsung database yang melewati layanan aplikasi. Health check memeriksa koneksi database, tetapi tidak menguji kesiapan skema.

Migration dapat diterapkan dengan `npm run db:migrate` dan dikembalikan dengan `npm run db:rollback`; jalankan hanya terhadap database yang dituju. `npm run db:seed` menyediakan dua akun contoh dengan login dinonaktifkan dan saldo nol; seed hanya berjalan pada database test yang dikonfigurasi dengan `NODE_ENV=test`. Aturan bisnis wallet diuji melalui API pada database test.

Tes database memakai rollback atau membersihkan data fixture yang dibuat setelah tiap kasus. Siapkan database test terpisah, isi `TEST_DB_NAME`, lalu jalankan migration dengan `NODE_ENV=test` sebelum `npm run test:db`. Nama test dibandingkan dengan `DB_NAME`, tetapi konfigurasi dan hak akses PostgreSQL tetap harus memastikan server dan database test bukan production.

## Registrasi dan login

`POST /api/register` (atau `/auth/register`) menerima JSON `{"name":"Nama","email":"user@example.com","password":"password-aman"}`. Password harus minimal 8 karakter dan maksimal 72 byte UTF-8. Akun dan wallet saldo nol dibuat dalam satu transaksi; respons 201 hanya memuat data akun, tanpa hash. Email dinormalisasi menjadi huruf kecil dan harus unik tanpa membedakan kapitalisasi; email duplikat menghasilkan 409.

`POST /api/login` (atau `/auth/login`) menerima `email` dan `password`, lalu mengembalikan access token JWT bertipe Bearer. Email tidak dikenal dan password salah menghasilkan respons 401 yang sama. Token berlaku selama `JWT_EXPIRES_IN`; refresh token dan pencabutan token belum tersedia. Keduanya perlu dipertimbangkan sebelum deployment publik.

Migration kedua menambahkan indeks unik email case-insensitive. Jika database yang sudah berisi data memiliki email yang hanya berbeda kapitalisasi, migration akan gagal dan duplikasi harus ditangani secara manual sebelum dijalankan.

## Operasi wallet

Semua endpoint wallet membutuhkan `Authorization: Bearer <token>`. `GET /api/balance` (atau `/wallet`) mengembalikan ID wallet dan saldo; `GET /api/ledger` (atau `/wallet/transactions`) mengembalikan riwayat milik akun, diurutkan berdasarkan ID transaksi dari terbesar ke terkecil. Nominal dan saldo pada respons adalah string bilangan bulat rupiah agar presisi PostgreSQL bigint terjaga.

`POST /api/topups` (atau `/wallet/top-up`) menerima `{"amount":1000}`. **Top-up ini hanya simulasi:** tidak ada pembayaran atau verifikasi dana eksternal, sehingga tidak boleh digunakan dengan uang sungguhan. `POST /api/transfers` menerima `{"amount":1000,"receiverWalletId":"2"}`; endpoint lama `/wallet/transfer` dan `recipientAccountId` tetap tersedia untuk kompatibilitas. Kedua operasi memerlukan header `Idempotency-Key` yang tidak kosong dan unik secara global; pengulangan dengan isi sama mengembalikan transaksi sebelumnya, sedangkan isi berbeda atau penggunaan oleh akun lain menghasilkan 409 tanpa membuka data transaksi. Panjang key maksimal 128 karakter.

Nominal minimal Rp1.000; transfer dibatasi Rp2.000.000 per akun per hari kalender Asia/Jakarta. Saldo tidak boleh negatif. Debit, kredit, dan ledger ditulis dalam satu transaksi database. Aturan ini berlaku melalui API; akses langsung ke database harus dibatasi. Perlu kontrol token yang lebih lengkap serta integrasi pembayaran sebelum deployment publik.

## Pembatasan percobaan autentikasi

Login dibatasi 10 permintaan per alamat IP per 15 menit dan registrasi 5 permintaan per alamat IP per 15 menit, termasuk permintaan yang berhasil atau tidak valid. Jika melewati batas, API mengembalikan HTTP 429 dan header `Retry-After`. Batas disimpan di memori tiap proses dan hilang saat proses dimulai ulang; ini belum cukup untuk banyak instance. Server tidak mempercayai header proxy secara default. Sebelum memakai reverse proxy atau beberapa instance, konfigurasi IP proxy terpercaya dan penyimpanan pembatasan bersama harus ditinjau dan diuji sesuai lingkungan deployment.

## Pagination riwayat

`GET /wallet/transactions?limit=50` mengembalikan maksimal 50 transaksi secara default; `limit` dapat diatur antara 1 dan 100. Respons menyertakan `pagination.hasMore` dan `pagination.nextCursor`. Untuk mengambil halaman berikutnya, kirim cursor tersebut sebagai `before`, misalnya `GET /wallet/transactions?limit=50&before=123`. Cursor adalah ID transaksi, bukan offset, dan hanya riwayat wallet dari token yang dapat dibaca. Saat `hasMore` bernilai false, `nextCursor` bernilai null. Data yang baru berkomitmen selama pagination tidak membentuk snapshot konsisten; muat ulang halaman pertama untuk melihat transaksi terbaru.

## Verifikasi aturan bisnis

`npm run test:db` menjalankan pengujian PostgreSQL pada database test. Tes alur bisnis menghubungkan registrasi, login, top-up simulasi, transfer, saldo, dan ledger melalui API. Tes wallet tambahan memeriksa saldo tidak negatif (BR-01), rollback dan persaingan transfer (BR-02), nominal minimum (BR-03), batas harian Asia/Jakarta (BR-04), serta idempotensi dan permintaan bersamaan (BR-05). Tes menggunakan data terisolasi dan tidak menggantikan uji deployment atau integrasi pembayaran nyata.

## Seed demo dan kompatibilitas data

Jalankan `npm run db:seed:demo` secara eksplisit setelah mengatur `DEMO_SEED=enabled` dan `DEMO_PASSWORD` yang kuat melalui environment privat. Seed membuat akun contoh Andi, Budi, dan Citra dengan top-up pembuka dan ledger untuk saldo awal; akun yang sudah ada dilewati tanpa reset. Jangan menyimpan password demo di repository atau menjalankan seed otomatis saat deploy. Migration PRD memeriksa key duplikat, key yang terlalu panjang, dan ledger lama yang tidak konsisten; bila ada, migration berhenti dan data perlu ditinjau sebelum mencoba kembali.

## Docker dan Jenkins

`Dockerfile`, `compose.yaml`, `compose.test.yaml`, dan `Jenkinsfile` menyiapkan delapan tahap PRD: Checkout, Test, Build Image, Push Image, Backup DB, Migrate, Deploy, dan Smoke Test. Compose deployment memakai image Docker Hub, PostgreSQL 17, volume persisten, serta jaringan database internal. Test memakai project Compose terpisah. Build image, test PostgreSQL 17 dan smoke test runtime telah diuji pada project Docker lokal yang terisolasi; Jenkins, push Docker Hub dan webhook belum diverifikasi end-to-end. Tidak ada deployment ke lingkungan tim atau cloud yang telah dijalankan.

Untuk Jenkins, gunakan job terpercaya dari branch main, agent Linux berlabel `dompetku-linux`, credential `dockerhub-credentials` dan secret file `dompetku-deploy-env` yang berisi `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `JWT_SECRET`, dan `CORS_ORIGIN`. Namespace Docker Hub diambil dari username credential, sehingga webhook tidak membutuhkan parameter manual. Pastikan namespace Docker Hub dan credential cocok, agent dapat mengakses Docker serta port 8000, dan webhook GitHub serta Ngrok dikonfigurasi oleh tim. Backup diarsipkan sebelum migration; artifact dapat berisi data sensitif dan akses serta retensinya harus dibatasi. Jangan menjalankan `docker compose down --volumes` pada project deployment. Migration dijalankan terpisah; seed demo hanya melalui perintah eksplisit.
