# Penerimaan backend terhadap PRD v1.1

Dokumen ini memetakan PRD DompetKu Kelompok 6 v1.1 ke pengujian yang dapat dijalankan melalui `npm test` dan `npm run test:db`. Pengujian database memakai PostgreSQL nyata dan database test terpisah. Nomor T mengikuti bagian 13.1 PRD; satu test dapat memeriksa beberapa acceptance criteria.

| PRD | Bukti pada repository                                                                                                            | Status cakupan                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| T01 | `auth.test.js`: registrasi akun dan wallet saldo nol; rollback jika insert wallet gagal                                          | Tersedia                                       |
| T02 | `wallet.test.js`: top-up, saldo dan ledger; `business-flow.test.js`: alur API penuh                                              | Tersedia                                       |
| T03 | `wallet.test.js`: debit, kredit, dua ledger dan saldo akhir                                                                      | Tersedia                                       |
| T04 | `wallet.test.js`: saldo tidak cukup; tidak ada transaksi sukses                                                                  | Tersedia                                       |
| T05 | `wallet.test.js`: nominal di bawah minimum ditolak                                                                               | Tersedia                                       |
| T06 | `wallet.test.js`: top-up dan transfer tepat Rp1.000 diterima                                                                     | Tersedia                                       |
| T07 | `wallet.test.js`: transfer tepat Rp2.000.000 diterima                                                                            | Tersedia                                       |
| T08 | `wallet.test.js`: tambahan setelah batas harian ditolak tanpa transaksi baru                                                     | Tersedia                                       |
| T09 | `wallet.test.js`: trigger PostgreSQL menolak ledger penerima setelah kedua saldo diubah; transaksi, saldo dan ledger di-rollback | Tersedia                                       |
| T10 | `business-flow.test.js`, `wallet.test.js`: replay transfer memberikan hasil asli                                                 | Tersedia                                       |
| T11 | `wallet.test.js`: replay top-up hanya menambah saldo sekali                                                                      | Tersedia                                       |
| T12 | `wallet.test.js`: key sama dengan nominal berbeda menghasilkan 409                                                               | Tersedia                                       |
| T13 | `schema.test.js`: health menggunakan koneksi PostgreSQL nyata                                                                    | Tersedia                                       |
| T14 | `schema.test.js`: koneksi PostgreSQL yang sengaja gagal menghasilkan 503                                                         | Tersedia                                       |
| T15 | `wallet.test.js`: transfer paralel tidak menyebabkan overspending; nilai akhir diperiksa di DB                                   | Tersedia                                       |
| T16 | `wallet.test.js`: transfer paralel tidak melewati batas harian                                                                   | Tersedia                                       |
| T17 | `wallet.test.js`: top-up dan transfer paralel dengan key sama; key lintas pemilik; jumlah transaksi dan ledger diperiksa di DB   | Tersedia                                       |
| T18 | `wallet.test.js`: clock test melewati tepat pukul 00.00 WIB; limit dihitung ulang                                                | Tersedia                                       |
| T19 | `wallet.test.js`: token hilang/tidak valid ditolak                                                                               | Tersedia                                       |
| T20 | `business-flow.test.js`: riwayat dan saldo kedua akun konsisten setelah transaksi                                                | Tersedia                                       |
| T21 | `auth.test.js`, `wallet.test.js`: login benar/salah dan token kedaluwarsa                                                        | Tersedia                                       |
| T22 | `wallet.test.js`: sender tambahan ditolak, query wallet lain ditolak, riwayat selalu milik token                                 | Tersedia                                       |
| T23 | `wallet.test.js`: penerima sendiri/tidak ada ditolak tanpa mutasi                                                                | Tersedia                                       |
| T24 | `wallet.test.js`: pecahan, negatif, string, angka tidak aman dan overflow bigint ditolak                                         | Tersedia                                       |
| T25 | `wallet.test.js`: replay setelah dana habis; `business-flow.test.js`: replay setelah limit tercapai                              | Tersedia                                       |
| T26 | `wallet.test.js`: key global milik akun lain menghasilkan konflik generik tanpa data transaksi                                   | Tersedia                                       |
| T27 | `wallet.test.js`: key hilang, kosong dan terlalu panjang ditolak                                                                 | Tersedia                                       |
| T28 | UI pada `/`                                                                                                                      | Ditunda sesuai arahan; belum ada bukti browser |

Semua file test di atas berada di `tests/database/`, kecuali test HTTP tanpa database di `tests/integration/`. `migration-prd.test.js` juga menguji backfill ledger lama, penolakan key duplikat, dan rollback pada schema PostgreSQL sementara. `demo-seed.test.js` membuktikan seed tidak mereset saldo pada eksekusi ulang.

## Kontrak dan keputusan yang perlu diketahui reviewer

- Endpoint utama mengikuti `/api/*`; `/auth/*` dan `/wallet/*` masih tersedia sebagai alias kompatibilitas. Limiter autentikasi dipakai bersama oleh alias dan endpoint utama.
- Respons menggunakan envelope `success/data` atau `success/error`. `POST /api/topups` dan `/api/transfers` menyediakan `transactionId`, `type`, `amount`, `balanceBefore`, `balanceAfter`, `createdAt`, `replayed`; objek `transaction` juga dipertahankan untuk klien lama.
- Tabel pengguna bernama `accounts`, dengan `wallets.account_id`. Nama ini dipertahankan untuk menghindari rename yang tidak diperlukan. Relasinya setara dengan `users` pada PRD.
- Jenis transaksi internal tetap `top_up`/`transfer`; API mengembalikan `TOPUP`/`TRANSFER`. Ledger menyimpan `TOPUP`/`TRANSFER_IN`/`TRANSFER_OUT`. `sender_wallet_id` dan `receiver_wallet_id` merupakan kolom generated agar konsisten dengan field lama.
- Uang pada input berupa JSON integer aman; respons berupa string desimal. SQL ledger memeriksa nominal positif dan persamaan perubahan saldo. Konsistensi antar-tabel dijaga oleh layanan dalam satu transaksi; pengguna database yang menulis langsung dapat melewati aturan aplikasi.
- Key unik secara global; fingerprint payload dan pemilik diperiksa sebelum replay. Replay memakai ledger asli sebelum memeriksa ulang saldo/limit. Operasi menulis menggunakan READ COMMITTED dan row lock `FOR NO KEY UPDATE` dalam urutan ID.
- Saldo awal akun baru nol. Top-up merupakan simulasi. Revocation/refresh token bukan cakupan MVP; token berlaku sampai expiry.

## Batas bukti

Test lokal PostgreSQL 16 dan container PostgreSQL 17 telah dijalankan; hasilnya ada di `docs/verification.md`. Bukti tersebut belum membuktikan Jenkins, registry dan webhook berjalan. Teman DevOps tetap harus mengulang penerimaan pada agent miliknya, mengumpulkan bukti merah–hijau, dan menyelesaikan deployment. Kelulusan test belum berarti fitur sudah di-review atau di-merge ke main.
