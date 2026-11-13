# Kontrak API backend

Base URL lokal: `http://localhost:3000`. Compose deployment menggunakan `http://127.0.0.1:8000`. Semua request body memakai `Content-Type: application/json`.

| Method | Path             | Body / query                                   | Auth                       |
| ------ | ---------------- | ---------------------------------------------- | -------------------------- |
| POST   | `/api/register`  | `name`, `email`, `password`                    | Tidak                      |
| POST   | `/api/login`     | `email`, `password`                            | Tidak                      |
| GET    | `/api/balance`   | —                                              | Bearer                     |
| POST   | `/api/topups`    | `amount`                                       | Bearer dan Idempotency-Key |
| POST   | `/api/transfers` | `amount`, `receiverWalletId`                   | Bearer dan Idempotency-Key |
| GET    | `/api/ledger`    | `limit` (1–100, default 50), `before` (cursor) | Bearer                     |
| GET    | `/health`        | —                                              | Tidak                      |

Registrasi: password minimal 8 karakter, maksimal 72 byte UTF-8; email dinormalisasi menjadi huruf kecil. Akun dan wallet dibuat atomik dengan saldo nol. Field tambahan yang tidak dikenal ditolak.

Contoh login sukses:

```json
{
  "success": true,
  "data": {
    "accessToken": "<token-login>",
    "tokenType": "Bearer",
    "expiresAt": "<waktu-ISO-8601>"
  }
}
```

Gunakan token sebagai `Authorization: Bearer <token-login>`; jangan memasukkannya ke URL atau log. Login dibatasi 10 request/IP/15 menit dan registrasi 5 request/IP/15 menit, termasuk request sukses. Limiter saat ini per proses; penyesuaian proxy/store bersama diperlukan jika arsitektur deployment berubah.

`GET /api/balance` mengembalikan `data.walletId`, `data.balance`, dan `data.currency`. ID wallet ini digunakan sebagai penerima transfer, bukan ID akun.

Contoh transfer:

```http
POST /api/transfers
Authorization: Bearer <token-login>
Idempotency-Key: <key-unik-aksi>
Content-Type: application/json

{"amount":100000,"receiverWalletId":"2"}
```

Nominal minimal Rp1.000 dan harus JSON integer yang aman; string, pecahan, negatif dan overflow ditolak. Batas transfer keluar Rp2.000.000 per hari kalender Asia/Jakarta. Input key di-trim, panjang 1–128 karakter. Pertahankan key yang sama saat retry jaringan untuk aksi yang sama. Key baru hanya untuk aksi baru. Key global yang sama dengan pemilik/payload berbeda menghasilkan 409 tanpa membocorkan hasil transaksi.

Pembuatan transaksi sukses menghasilkan 201; replay identik menghasilkan 200 dengan ID dan saldo sebelum/sesudah asli. `data.replayed` membedakan replay. Nominal dan saldo diserialisasi sebagai string agar presisi bigint terjaga. Ledger hanya menampilkan milik token dan jenisnya `TOPUP`, `TRANSFER_OUT`, atau `TRANSFER_IN`.

Contoh error:

```json
{
  "success": false,
  "error": { "code": "INSUFFICIENT_BALANCE", "message": "Insufficient balance" }
}
```

| Status | Contoh kode                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------ |
| 400    | `INVALID_AMOUNT`, `INVALID_INPUT`, `INVALID_RECIPIENT`, `INVALID_JSON`                                 |
| 401    | `INVALID_CREDENTIALS`, `UNAUTHORIZED`                                                                  |
| 404    | `NOT_FOUND`, `WALLET_NOT_FOUND`                                                                        |
| 409    | `EMAIL_TAKEN`, `INSUFFICIENT_BALANCE`, `DAILY_LIMIT_EXCEEDED`, `IDEMPOTENCY_CONFLICT`, `BALANCE_LIMIT` |
| 429    | `TOO_MANY_REQUESTS` dengan `Retry-After`                                                               |
| 500    | `INTERNAL_SERVER_ERROR` tanpa detail internal                                                          |
| 503    | `DATABASE_UNAVAILABLE` pada health                                                                     |

Health sehat mengembalikan HTTP tepat 200 dan `data.database = "connected"`; koneksi gagal menghasilkan 503. Health tidak memeriksa versi migration. UI dan logout klien akan dikerjakan terpisah; tidak ada endpoint revocation token pada MVP ini.
