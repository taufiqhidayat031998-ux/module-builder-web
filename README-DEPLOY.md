# Deep Learning Module Builder — Website Publik Gratis

Ini versi aplikasi yang tersambung ke database sungguhan (Supabase) dan
dirancang sebagai **satu website yang bisa dibuka siapa saja secara gratis**
lewat browser — tidak perlu install apa pun, tidak perlu jadi file `.exe`.

- Datanya **permanen** — tersimpan di database, bukan di memori browser.
- Bisa diakses **banyak orang sekaligus**; Supabase + hosting statis
  (Vercel/Netlify) sanggup melayani jauh lebih dari 10 pengguna bersamaan
  tanpa masalah.
- Siapa pun bisa membuat akun sendiri lewat email (tidak dibatasi ke email
  sekolah tertentu) — peran **master** tetap hanya untuk email yang Anda
  daftarkan di `admin_emails`.
- **Kuota AI harian per pengguna** (lihat Langkah 3) — pengaman penting
  karena situsnya gratis untuk umum, sementara tiap "Generate AI" memakai
  kuota API Anthropic berbayar milik Anda. Anda bisa naik/turunkan batasnya.

Total waktu setup: kira-kira 20–30 menit, semuanya lewat website (tidak
wajib install apa pun di komputer, walau jauh lebih cepat kalau Anda punya
Node.js untuk tes lokal dulu).

---

## Langkah 1 — Buat project Supabase (database + login)

1. Buka https://supabase.com → Sign up / login → "New project".
2. Beri nama bebas, buat password database (simpan baik-baik), pilih region
   terdekat (mis. Singapore).
3. Tunggu ±2 menit sampai project siap.
4. Buka menu **SQL Editor** (ikon di sidebar kiri) → klik "New query".
5. Buka file `supabase/schema.sql` di folder ini, salin **seluruh isinya**,
   tempel ke SQL Editor.
6. **Cari baris paling bawah**:
   ```sql
   insert into admin_emails (email) values ('email-anda@sekolah.sch.id')
   ```
   Ganti dengan email Anda yang sebenarnya — ini yang membuat akun Anda
   otomatis jadi **master**.
7. Klik **Run**. Harus muncul "Success. No rows returned".

## Langkah 2 — Nyalakan login lewat email (magic link)

1. Di Supabase Dashboard, buka **Authentication → Providers**.
2. Pastikan **Email** aktif (biasanya sudah aktif secara default).
3. Buka **Authentication → URL Configuration** → isi "Site URL" dengan alamat
   website Anda nanti (bisa diisi/diedit lagi setelah Langkah 5 selesai dan
   Anda tahu URL Vercel-nya).

## Langkah 3 — Simpan API key Claude dengan aman (Edge Function)

Fitur "Generate AI" butuh API key Anthropic Anda sendiri (bukan lagi
menumpang sandbox Claude.ai). Ambil key di https://console.anthropic.com
→ API Keys → Create Key.

Fungsi ini juga sudah membatasi pemakaian AI **60x per pengguna per hari**
secara otomatis (tabel `ai_usage_daily`, sudah dibuat lewat `schema.sql` di
Langkah 1) — supaya biaya API Anda tidak jebol kalau situsnya dipakai
banyak orang. Mau ubah batasnya? Edit angka `DAILY_LIMIT` di baris atas
file `supabase/functions/generate-ai/index.ts` sebelum deploy.

Cara termudah (lewat browser, tanpa install):
1. Di Supabase Dashboard → **Edge Functions** → "Deploy a new function" →
   beri nama `generate-ai` → tempel isi file
   `supabase/functions/generate-ai/index.ts` dari folder ini → Deploy.
2. Buka **Edge Functions → generate-ai → Secrets** (atau menu Settings →
   Edge Functions → Secrets di beberapa versi dashboard) → tambahkan:
   - Key: `ANTHROPIC_API_KEY`
   - Value: (API key Anthropic Anda)

Kalau Anda punya Node.js dan lebih suka lewat terminal, alternatifnya:
```
npm install -g supabase
supabase login
supabase link --project-ref xxxxxxxxxxxx   # lihat di Project Settings
supabase functions deploy generate-ai
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

## Langkah 4 — Sambungkan aplikasi ke project Supabase Anda

1. Di Supabase Dashboard → **Project Settings → API**.
2. Salin **Project URL** dan **anon public key**.
3. Di folder ini, salin `.env.example` menjadi `.env`, lalu isi:
   ```
   VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

## Langkah 5 — Deploy website (gratis, lewat GitHub + Vercel)

1. Upload seluruh folder ini ke repository GitHub baru (sama seperti cara
   upload di panduan Electron sebelumnya: buat repo baru di github.com →
   "uploading an existing file" → drag semua isi folder → Commit).
   **Jangan upload file `.env`** (biarkan `.env.example` saja yang terupload;
   `.env` isinya rahasia, isi manual saja di Vercel pada langkah berikut).
2. Buka https://vercel.com → Sign up pakai akun GitHub Anda → "Add New
   Project" → pilih repo yang baru dibuat.
3. Saat konfigurasi:
   - Framework Preset: **Vite** (biasanya terdeteksi otomatis)
   - Tambahkan Environment Variables:
     - `VITE_SUPABASE_URL` = (isi sama seperti di `.env` Anda)
     - `VITE_SUPABASE_ANON_KEY` = (isi sama seperti di `.env` Anda)
4. Klik **Deploy**. Setelah ±1-2 menit, Vercel memberi Anda URL publik,
   misalnya `https://deep-learning-module-builder.vercel.app`.
5. Kembali ke Supabase → **Authentication → URL Configuration** → update
   "Site URL" dan "Redirect URLs" dengan URL Vercel tersebut, supaya link
   login lewat email mengarah ke tempat yang benar.

Selesai — bagikan URL Vercel itu ke 10+ guru. Mereka tinggal buka link,
masukkan email sekolah, klik link masuk yang dikirim ke email mereka, dan
langsung bisa memakai aplikasi. Datanya tersimpan permanen di Supabase.

---

## Menjadikan guru lain sebagai master

Buka **SQL Editor** di Supabase, jalankan:
```sql
insert into admin_emails (email) values ('email-guru-lain@sekolah.sch.id');
```
Kalau guru itu sudah pernah login sebelumnya, jalankan juga:
```sql
update profiles set role = 'master' where email = 'email-guru-lain@sekolah.sch.id';
```

## Kapasitas & biaya

- Free tier Supabase: 500MB database, 50.000 monthly active users,
  cukup jauh untuk sekolah dengan puluhan guru.
- Free tier Vercel: bandwidth & concurrent request jauh di atas kebutuhan
  10-an guru mengakses bersamaan — ini beban yang sangat kecil untuk
  infrastruktur semacam ini.
- Yang berbayar hanya pemakaian API Claude sesuai jumlah kata yang
  di-generate (lihat harga di console.anthropic.com).

## Menjalankan di komputer sendiri dulu (opsional, untuk tes)

Kalau Anda punya Node.js:
```
npm install
npm run dev
```
Buka `http://localhost:5173` — pastikan `.env` sudah diisi terlebih dahulu.
