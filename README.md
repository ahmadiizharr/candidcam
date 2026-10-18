# candid-cam-app

Kamera sekali pakai digital untuk acara, live di **https://cam.mangaisekai.com**.

- **Host** (`/app`): daftar/masuk, wizard 8 langkah (nama & link, sampul, rasio 3:4/9:16, 15 filter, bingkai polaroid, kuota peserta & foto per tamu, jadwal, konfirmasi), halaman acara (QR, passcode display, foto, tamu, pengaturan, unduh ZIP).
- **Tamu** (`/{slug}`): tema Dark Elegant / Scrapbook, join dengan nama, kamera browser dengan filter live, roll per tamu, upload galeri (opsional), galeri “Rollmu”/“Semua Orang”, like, unduh, bagikan.
- **Live Display** (`/display/{id}`): dikunci passcode (pemilik yang login tidak perlu), foto baru disorot, urutkan, jumlah like, auto scroll, layar penuh.

## Struktur

- `backend/` FastAPI + SQLite (`app/`), tes `pytest` di `backend/tests` (lewat HTTP API).
- `frontend/` Vite + Preact, 5 halaman: `index.html` (landing), `app.html`, `guest.html`, `display.html`, `404.html`.
  - `src/lib/filters.js` — filter kamera: shader WebGL + renderer CPU cadangan dengan rumus yang sama (dipakai otomatis kalau WebGL gagal self-test).
  - `src/lib/frame.js` — bingkai polaroid yang ditempel ke foto sebelum diunggah.
- `shared/catalog.json` — sumber tunggal pilihan (tema, filter, font, kertas bingkai, kuota). Backend memvalidasi terhadap file ini.
- `deploy/` — unit systemd `candid-cam.service` (:8092, data `/var/lib/candid-cam`) dan nginx `nginx-candid-cam.conf`.

## Kerja harian

```bash
cd backend && .venv/bin/python -m pytest -q          # tes backend
cd frontend && npx vite build                        # frontend langsung live (dist dibaca dari disk)
systemctl restart candid-cam                         # setelah ubah backend / catalog.json
```

Foto tamu dihapus otomatis 12 bulan sejak foto pertama (janitor tiap jam). Foto contoh di `frontend/public/static` dari Unsplash (lihat `CREDITS.txt`).
