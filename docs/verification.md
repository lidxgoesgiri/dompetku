# Hasil verifikasi aktual

Tanggal verifikasi: 13 November 2026, Asia/Jakarta. Dokumen ini mencatat hasil eksekusi, bukan checklist yang diasumsikan lulus.

| Pemeriksaan                | Hasil aktual                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Instalasi bersih Windows   | `npm ci` lulus dengan Node 24.11.1/npm 11.6.2                                                                                              |
| Analisis kode dan format   | `npm run lint`, `npm run format:check`, `git diff --check` lulus                                                                           |
| Tes tanpa database         | 15 lulus pada Windows dan container Linux                                                                                                  |
| Tes PostgreSQL 16 lokal    | 41 lulus pada `dompetku_test`                                                                                                              |
| Tes PostgreSQL 17 Docker   | 41 lulus melalui `compose.test.yaml`; total 56 tes bersama tes tanpa database                                                              |
| Instalasi Linux            | `npm ci` lulus setelah lockfile disinkronkan dengan npm image Linux; dependency langsung tidak diubah                                      |
| Build runtime              | Target `runtime` berhasil dibuat; Node 24.22.3; pengguna UID 1000                                                                          |
| Isi image runtime          | `.env` dan `.env.demo` tidak ada; dependency Vitest tidak disertakan                                                                       |
| Migration runtime          | One-off container berhasil menerapkan migration ke PostgreSQL 17 sementara                                                                 |
| Health runtime             | HTTP tepat 200 dan Docker healthcheck `healthy`                                                                                            |
| Graceful shutdown          | SIGTERM melalui `docker stop` berakhir dengan exit code 0                                                                                  |
| Compose sandbox            | App dan DB healthy pada project sementara, memakai image runtime lokal dengan pull dinonaktifkan                                           |
| Backup PostgreSQL 17       | Dump database kosong sebelum migration valid; dump setelah seed dapat di-restore ke database terpisah dengan jumlah record dan saldo cocok |
| Persistensi                | Saldo demo tetap sama setelah app direcreate; jumlah migration tidak berubah saat startup                                                  |
| Setup development lokal    | Database `dompetku` terverifikasi kosong sebelum setup; backup dibuat dan divalidasi sebelum empat migration diterapkan                    |
| Demo lokal                 | Tiga akun berhasil login; saldo Rp500.000/Rp100.000/Rp0 dan ledger pembuka cocok                                                           |
| Restore PostgreSQL 16      | Backup demo di-restore ke database sementara; seluruh baris akun, wallet, transaksi dan ledger cocok, lalu database sementara dihapus      |
| Audit dependency penuh     | Masih 5 temuan moderate pada rantai dependency alat development                                                                            |
| Audit tanpa dev dependency | `npm audit --omit=dev`: 0 vulnerability saat verifikasi                                                                                    |
| Compose dan shell Jenkins  | Kedua YAML valid; delapan blok shell Jenkins lolos `bash -n`                                                                               |

Database development tidak dihapus atau di-reset. Secret JWT lokal dan password demo dibuat tanpa dicetak; `.env`, `.env.demo`, dan dump backup diabaikan Git. Semua project container/database sementara untuk penerimaan dibersihkan setelah tes. Image lokal tetap tersedia sebagai cache.

## Masalah yang diperbaiki

- npm pada image Linux menolak lockfile lama karena dua optional peer dependency transitif tidak tercatat. Lockfile disinkronkan di container dengan hanya file package yang di-mount; instalasi bersih kemudian diverifikasi ulang pada Windows dan Linux.
- Jenkins sebelumnya memerlukan parameter namespace Docker Hub kosong, yang menghambat build otomatis webhook. Namespace sekarang berasal dari username credential `dockerhub-credentials`.
- Backup artifact dibatasi ke nomor build saat ini. Workspace job dibersihkan sebelum checkout; post-cleanup hanya membersihkan project test dan salinan dump build terkait.
- Tes rollback transfer sekarang menggagalkan ledger penerima setelah saldo debit dan kredit diubah, lalu memastikan kedua saldo dan seluruh ledger transaksi dibatalkan.

## Yang masih harus dibuktikan tim

- Review PR dan merge ke main; main belum dianggap berisi perubahan hanya karena branch telah dipush.
- Jenkins Declarative Pipeline Linter pada server nyata dan delapan stage pada agent tim.
- Push dua tag ke Docker Hub, autentikasi registry, webhook GitHub/Ngrok, serta image ID pada deployment tim.
- Quality gate merah–hijau dan bukti versi sebelumnya tetap berjalan ketika Test gagal.
- UI pada `/`, logout klien, serta screenshot browser (T28/E10), sesuai jadwal UI terpisah.
- Penanganan lima temuan moderate development jika versi kompatibel yang didukung telah tersedia. Tidak ada `audit fix --force` atau bypass quality gate yang dipakai.

Pengujian sandbox lokal tidak diklaim sebagai eksekusi Jenkins atau deployment cloud.
