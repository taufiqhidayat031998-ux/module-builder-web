-- ============================================================================
-- Deep Learning Module Builder — Skema Database Supabase
-- ============================================================================
-- Cara pakai: buka Supabase Dashboard project Anda → SQL Editor → tempel
-- seluruh isi file ini → GANTI email di bagian bawah dengan email Anda →
-- klik Run.

-- 1) Daftar email yang otomatis mendapat peran "master" (akses alpha/tanpa
--    batas). Diverifikasi di SERVER lewat trigger di bawah, jadi tidak bisa
--    dipalsukan dari browser seperti versi prototipe sebelumnya.
create table if not exists admin_emails (
  email text primary key
);

-- 2) Profil setiap pengguna yang login (dibuat otomatis saat pertama login)
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  email text unique not null,
  role text not null default 'guru' check (role in ('guru', 'master')),
  created_at timestamptz default now()
);

-- 3) Modul yang dibuat guru
create table if not exists modules (
  id uuid primary key,
  owner_id uuid references auth.users on delete cascade not null,
  data jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 4) Template (bisa dilihat semua guru, dibuat siapa saja yang login)
create table if not exists templates (
  id uuid primary key,
  created_by uuid references auth.users on delete set null,
  name text not null,
  rows jsonb not null,
  created_at timestamptz default now()
);

-- 5) Kuota pemakaian AI harian per pengguna — pengaman penting karena
--    situsnya terbuka gratis untuk siapa saja, sementara setiap generate
--    AI memakai kuota API Anthropic berbayar milik Anda.
create table if not exists ai_usage_daily (
  user_id uuid references auth.users on delete cascade not null,
  day date not null default current_date,
  count int not null default 0,
  primary key (user_id, day)
);

alter table ai_usage_daily enable row level security;

drop policy if exists "users manage own usage row" on ai_usage_daily;
create policy "users manage own usage row" on ai_usage_daily for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Trigger: otomatis membuat baris profil + menentukan peran saat user login
-- pertama kali (Supabase Auth membuat baris di auth.users, trigger ini
-- menyalinnya ke tabel profiles milik kita).
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    new.email,
    case
      when exists (select 1 from public.admin_emails where lower(email) = lower(new.email))
      then 'master'
      else 'guru'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ----------------------------------------------------------------------------
-- Row Level Security — aturan siapa boleh baca/tulis apa
-- ----------------------------------------------------------------------------
alter table admin_emails enable row level security;
alter table profiles enable row level security;
alter table modules enable row level security;
alter table templates enable row level security;

-- profiles: setiap orang bisa baca profilnya sendiri; master bisa baca semua
drop policy if exists "read own profile" on profiles;
create policy "read own profile" on profiles for select
  using (auth.uid() = id);

drop policy if exists "master reads all profiles" on profiles;
create policy "master reads all profiles" on profiles for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'master'));

-- modules: pemilik bisa CRUD modul miliknya sendiri; master bisa lihat semua
drop policy if exists "owner manages own modules" on modules;
create policy "owner manages own modules" on modules for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "master reads all modules" on modules;
create policy "master reads all modules" on modules for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'master'));

-- templates: semua pengguna yang login bisa lihat & membuat template;
-- hanya pembuatnya atau master yang bisa mengubah/menghapus
drop policy if exists "logged in users read templates" on templates;
create policy "logged in users read templates" on templates for select
  using (auth.uid() is not null);

drop policy if exists "logged in users create templates" on templates;
create policy "logged in users create templates" on templates for insert
  with check (auth.uid() is not null);

drop policy if exists "creator or master updates templates" on templates;
create policy "creator or master updates templates" on templates for update
  using (
    auth.uid() = created_by
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'master')
  );

drop policy if exists "creator or master deletes templates" on templates;
create policy "creator or master deletes templates" on templates for delete
  using (
    auth.uid() = created_by
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'master')
  );

-- ----------------------------------------------------------------------------
-- GANTI email di bawah ini dengan email Anda sendiri sebelum menjalankan
-- seluruh script ini. Ini yang membuat akun Anda otomatis menjadi "master".
-- Anda bisa menambah baris lagi kapan pun untuk menjadikan guru lain master.
-- ----------------------------------------------------------------------------
insert into admin_emails (email) values ('email-anda@sekolah.sch.id')
  on conflict (email) do nothing;
