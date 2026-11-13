# Panduan serah-terima DevOps DompetKu

Panduan ini untuk teman yang mengerjakan DevOps, mengikuti PRD v1.1 dan konfigurasi repository. UI masih ditunda. Gunakan data virtual untuk demo. Perintah di bawah ditujukan untuk **Bash pada agent Linux**, bukan PowerShell. Baseline paling mudah: Jenkins agent dan Docker Engine pada satu host Linux, dengan port aplikasi 8000 dapat dijangkau dari agent tersebut.

Backend menyediakan migration eksplisit, seed demo idempotent, JWT, health database, dan tes PostgreSQL. Hal yang harus dibuktikan oleh DevOps adalah image PostgreSQL 17, pipeline Jenkins, Docker Hub, webhook, backup/restore container, persistensi, dan quality gate merah–hijau. Validasi statis saja belum membuktikan bagian ini selesai.

## 1. Terima kode melalui PR

Repository: `https://github.com/lidxgoesgiri/dompetku`. Review PR `feature/prd-alignment` ke `main`, termasuk migration 003/004 dan dokumen penerimaan backend. Main sebelumnya hanya berisi commit awal, jadi PR ini membawa rangkaian implementasi backend. Jangan memulai job deployment dari branch fitur yang belum direview. Setiap anggota tetap membuat commit bermakna untuk pekerjaannya sendiri melalui PR.

Setelah PR disetujui dan di-merge:

```bash
git clone https://github.com/lidxgoesgiri/dompetku.git
cd dompetku
git switch main
git pull --ff-only origin main
git log -1 --oneline
```

Jika clone sudah ada, gunakan checkout milik sendiri dan pastikan working tree bersih sebelum berganti branch.

## 2. Siapkan host dan agent

Ikuti panduan resmi [Docker Engine Ubuntu](https://docs.docker.com/engine/install/ubuntu/), [Compose plugin](https://docs.docker.com/compose/install/), dan [Jenkins Linux](https://www.jenkins.io/doc/book/installing/linux/). Pilih Jenkins LTS dengan Java yang didukung versi Jenkins tersebut. Docker Desktop/WSL dapat digunakan untuk belajar, tetapi Jenkins yang berjalan di Windows tidak otomatis dapat menjalankan shell Linux dalam Jenkinsfile ini.

Jalankan sebagai **pengguna agent Jenkins yang sebenarnya**, bukan hanya administrator terminal:

```bash
git --version
java -version
docker version
docker info
docker compose version
curl --version
openssl version
```

`docker version` harus menampilkan server yang dapat dihubungi. Jika Docker belum siap, berhenti di sini. Siapkan izin Docker untuk agent melalui konfigurasi host yang disetujui tim; jangan membuka Docker socket atau mengubahnya menjadi world-writable.

Pada Jenkins buat agent Linux dengan label **`dompetku-linux`**. Pastikan workspace terpisah, Docker dapat diakses agent, dan port 8000 bebas. Jika controller Jenkins berada di container atau host lain, alamat smoke test mengacu pada **agent/host deployment**, bukan localhost controller. Jenkinsfile saat ini memakai `http://127.0.0.1:8000/health`.

## 3. Jalankan preflight test container

Di clone lokal yang bersih, tanpa secret deployment:

```bash
(
set -eu
project="dompetku-preflight-$(date +%s)-$$"
cleanup() { docker compose -p "$project" -f compose.test.yaml down --volumes --remove-orphans; }
trap cleanup EXIT
docker compose -f compose.test.yaml config --quiet
docker compose -p "$project" -f compose.test.yaml up --build --abort-on-container-exit --exit-code-from test
)
```

Hasil yang dicari: lint, formatting, tes tanpa DB, migration, dan seluruh tes PostgreSQL berhasil; exit code perintah 0. Cleanup di atas hanya untuk project test sementara. Simpan log hasil test untuk bukti E04. Jangan gunakan `down --volumes` pada project deployment `dompetku`.

## 4. Siapkan Docker Hub dan Jenkins plugins

Pada Docker Hub buat public repository **`USERNAME/dompetku`**. Username harus milik akun yang sama dengan credential push; namespace organisasi memerlukan penyesuaian pipeline. Buat PAT dengan izin push yang sesuai dan simpan hanya di Jenkins Credentials.

Pada Jenkins pasang/aktifkan Pipeline, Pipeline: Declarative, Git, GitHub, dan Credentials Binding. Stage View dapat dipasang untuk bukti visual. Buat akun administrator untuk pengelola dan akun penilaian terpisah dengan akses minimum. Jenkins tidak boleh dibuka sebagai dashboard anonim.

## 5. Buat konfigurasi deployment privat

Gunakan file di luar checkout dan workspace Jenkins. Contoh inisialisasi **sekali saja** pada host yang dipercaya:

```bash
set -eu
set +x
umask 077
mkdir -p "$HOME/.config/dompetku"
DEPLOY_ENV="$HOME/.config/dompetku/deploy.env"
test ! -e "$DEPLOY_ENV"
cat > "$DEPLOY_ENV" <<'ENV'
DOCKERHUB_USER=ganti_username_dockerhub
POSTGRES_DB=dompetku
POSTGRES_USER=dompetku
CORS_ORIGIN=http://localhost:8000
JWT_EXPIRES_IN=1h
APP_PORT=8000
ENV
printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 24)" >> "$DEPLOY_ENV"
printf 'JWT_SECRET=%s\n' "$(openssl rand -hex 48)" >> "$DEPLOY_ENV"
chmod 600 "$DEPLOY_ENV"
```

Ubah `DOCKERHUB_USER` memakai editor lokal agar cocok dengan akun Docker Hub. Jangan tampilkan isi file saat merekam bukti. Skrip sengaja menolak menimpa file yang sudah ada; perubahan password pada volume PostgreSQL yang sudah terisi memerlukan rotasi terencana.

```bash
docker compose --env-file "$DEPLOY_ENV" -f compose.yaml config --quiet
```

Gunakan `--quiet`; output penuh `docker compose config` dapat mengandung secret. File ini mengonfigurasi PostgreSQL container baru dan terpisah dari PostgreSQL development di komputer backend. Jangan menyalin volume/data PostgreSQL 16 langsung ke container 17; perpindahan data antar-major harus melalui dump/restore yang diuji.

## 6. Daftarkan credentials

Di Jenkins: Manage Jenkins → Credentials → domain/job yang dipercaya → Add Credentials.

| ID persis               | Jenis                      | Isi                                                   |
| ----------------------- | -------------------------- | ----------------------------------------------------- |
| `dockerhub-credentials` | Username with password     | Username Docker Hub dan PAT sebagai password          |
| `dompetku-deploy-env`   | Secret file                | Upload `deploy.env` dari langkah 5                    |
| `github-credentials`    | Credential SCM yang sesuai | Hanya jika checkout repository memerlukan autentikasi |

Jenkinsfile mengambil namespace image dari username `dockerhub-credentials`, sehingga webhook tidak memerlukan parameter manual. Secret file hanya diikat pada stage deployment. Jangan memasukkan token ke URL Git atau Jenkinsfile. Lihat [panduan credentials Jenkins](https://www.jenkins.io/doc/book/security/credentials/).

## 7. Konfigurasikan job

1. New Item → nama `DompetKu-CI-CD` → **Pipeline**.
2. Pipeline → Definition **Pipeline script from SCM** → SCM **Git**.
3. Repository URL `https://github.com/lidxgoesgiri/dompetku.git`; pilih credential SCM jika diperlukan.
4. Branch specifier **`*/main`**; Script Path **`Jenkinsfile`**.
5. Pastikan label `dompetku-linux` online. Job hanya untuk kode main yang telah direview dan hanya job ini yang boleh menerbitkan `latest`/mengubah project deployment.
6. Validasi Jenkinsfile dengan Declarative Pipeline Linter pada server Jenkins tersebut, lalu simpan. Jenkinsfile sudah memuat `githubPush()`; jangan membuat trigger paralel yang memicu build dua kali.

Jenkinsfile menggunakan `deleteDir()` hanya pada workspace job sebelum checkout; jangan gunakan folder proyek pribadi sebagai workspace custom. [Panduan Pipeline dari SCM](https://www.jenkins.io/doc/book/pipeline/getting-started/) menjelaskan konfigurasi ini.

## 8. Jalankan build pertama

Klik **Build Now** setelah kode telah masuk main dan credentials tersedia. Urutan wajib:

| Stage       | Yang harus terlihat                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------- |
| Checkout    | Commit sesuai main dan namespace Docker Hub valid                                                  |
| Test        | Database test sementara, migration dan semua test lulus                                            |
| Build Image | Runtime image dengan tag nomor build dan `latest`                                                  |
| Push Image  | Kedua tag berhasil dikirim ke Docker Hub                                                           |
| Backup DB   | DB dimulai/ditunggu healthy, dump tidak kosong dan dapat dibaca `pg_restore -l`, artifact terarsip |
| Migrate     | Image baru ditarik, ID image diverifikasi, migration dijalankan one-off                            |
| Deploy      | Compose memakai image yang sama; app dan db healthy                                                |
| Smoke Test  | HTTP tepat 200 dari `/health` dalam batas retry                                                    |

Pada deployment pertama, backup database kosong tetap dilakukan sebelum migration. Jangan membuat skema melalui entrypoint atau menjalankan seed/reset otomatis. Build merah harus diperbaiki pada stage penyebabnya, bukan dengan melewati test atau backup.

Sesudah hijau, verifikasi dari agent:

```bash
docker compose -p dompetku --env-file "$DEPLOY_ENV" ps
curl --silent --show-error --max-time 5 http://127.0.0.1:8000/health
```

Cari app dan db `healthy`, respons `success: true`, `data.database: connected`, dan HTTP 200. Docker Hub harus menampilkan tag build dan `latest`. Simpan bukti E07–E09, E12 dan E13. Backup artifact dapat berisi data pengguna; batasi pembaca dan retensinya.

## 9. Seed demo dan verifikasi API

Seed dijalankan **secara eksplisit** setelah build pertama sukses, dari host berizin dan file deployment yang sama:

```bash
read -r -s -p 'Password demo baru (minimal 12 karakter): ' DEMO_PASSWORD
printf '\n'
export DEMO_PASSWORD
docker compose -p dompetku --env-file "$DEPLOY_ENV" run --rm --no-deps --pull never -e DEMO_SEED=enabled -e DEMO_PASSWORD app npm run db:seed:demo
unset DEMO_PASSWORD
```

Akun demo: `andi@dompetku.example` Rp500.000, `budi@dompetku.example` Rp100.000, dan `citra@dompetku.example` Rp0. Password berasal dari input privat tadi. Jika akun sudah ada, seed melewatinya tanpa mengganti password, saldo atau ledger. Simpan password di kanal privat tim.

Gunakan client API dengan penyimpanan token privat mengikuti `docs/api.md`: login → cek `walletId` → top-up → transfer → cek kedua saldo dan ledger. ID receiver adalah wallet ID. Pada UI nanti token disimpan di memori, bukan localStorage. UI dan bukti browser T28/E10 masih menunggu pekerjaan terpisah.

## 10. Hubungkan Ngrok dan webhook

Instal serta autentikasi ngrok melalui akun tim mengikuti [panduan resmi GitHub webhook](https://ngrok.com/docs/integrations/webhooks/github-webhooks). Jalankan tunnel pada host yang dapat menjangkau Jenkins, misalnya:

```bash
ngrok http 8080
```

Di GitHub repository → Settings → Webhooks → Add webhook:

- Payload URL `https://ALAMAT-NGROK/github-webhook/`.
- Content type `application/json`, event **Push**.
- Gunakan HTTPS dan mekanisme secret/verifikasi webhook yang didukung konfigurasi plugin Jenkins tim. Jangan menonaktifkan autentikasi Jenkins atau CSRF protection untuk mempermudah webhook.

Merge PR kecil yang valid ke main dan pastikan Recent Deliveries sukses serta **satu** build baru muncul dengan commit tersebut. Jika URL ngrok berubah, perbarui webhook dan link penilaian. Simpan E05 dan E15 tanpa token/password.

## 11. Buktikan quality gate dan persistensi

Lakukan pada lingkungan tugas yang memakai saldo virtual, dengan koordinasi tim:

1. Catat build hijau, image/container ID, serta saldo dan ledger demo.
2. Buat PR demonstrasi yang sengaja gagal pada assertion business rule, review dan merge sesuai prosedur tugas. Jangan menonaktifkan test atau mengubah expected result untuk membuatnya hijau.
3. Buktikan stage Test merah, stage Build Image/Push/Backup/Migrate/Deploy tidak dijalankan, dan aplikasi/image versi sebelumnya masih melayani health.
4. Buat PR perbaikan, merge, dan buktikan delapan stage kembali hijau.
5. Pastikan saldo dan ledger sebelum redeploy tetap ada. Restart app dan buktikan migration tidak otomatis berjalan lagi.

Simpan E11, nomor build, commit, screenshot stage, hasil health dan perbandingan image ID. Kegagalan Deploy/Smoke tidak memiliki auto-rollback; periksa kondisi dan gunakan recovery yang disetujui tim.

## 12. Buktikan restore dan lengkapi serah-terima

Download artifact dump dari build yang sudah memiliki data demo ke lokasi privat. Uji restore hanya pada **project baru**:

```bash
(
set -eu
restore_project="dompetku-restore-$(date +%s)-$$"
cleanup() { docker compose -p "$restore_project" -f compose.test.yaml down --volumes --remove-orphans; }
trap cleanup EXIT
docker compose -p "$restore_project" -f compose.test.yaml up -d --wait db
# Ganti path dump pada redirection berikut dengan artifact yang di-download.
docker compose -p "$restore_project" -f compose.test.yaml exec -T db pg_restore --no-owner --no-acl --exit-on-error -U dompetku_test -d dompetku_test < /path/privat/dompetku-BUILD.dump
docker compose -p "$restore_project" -f compose.test.yaml exec -T db psql -U dompetku_test -d dompetku_test -c 'SELECT count(*) FROM accounts; SELECT count(*) FROM ledger_entries; SELECT id, balance FROM wallets ORDER BY id;'
)
```

Cocokkan saldo dan ledger dengan snapshot build backup. `pg_restore -l` hanya memeriksa daftar isi; restore terisolasi di atas merupakan bukti pemulihan lebih lengkap. Jangan melakukan restore ke deployment aktif sebagai percobaan.

Selesaikan bukti E01–E15 dari PRD bersama QA. Sediakan akun Jenkins dosen dengan hak minimum, link ngrok aktif dan laporan PDF pada kanal LMS privat. Minta backend membantu jika migration, kontrak API atau aturan bisnis gagal; minta penanggung jawab container membantu image/network/volume. Status selesai hanya setelah bukti nyata tersedia.

## Troubleshooting singkat

| Gejala                                          | Tindakan                                                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Cannot connect to Docker daemon                 | Jalankan daemon, periksa akses pengguna agent dan ulangi `docker info`                               |
| Waiting for executor                            | Periksa node label `dompetku-linux` dan agent online                                                 |
| Credential not found / push denied              | Cocokkan ID credential, jenis, username, PAT dan repo Docker Hub                                     |
| Backup gagal                                    | Periksa service db, env/volume yang benar dan ruang disk; jangan lanjut migration                    |
| Migration menolak key/ledger lama               | Hentikan rilis dan serahkan ke backend; jangan hapus data atau rollback membabi buta                 |
| Smoke timeout / 503                             | Periksa port host agent, JWT config, DB connectivity dan status container; jangan mencetak env penuh |
| Webhook delivery sukses tapi build tidak muncul | Pastikan job memakai main, trigger GitHub aktif, commit memang baru dan URL endpoint tepat           |
| Image ID tidak sama                             | Periksa publisher lain untuk `latest`; hanya satu job deployment yang boleh mempublikasikan image    |
