import React, { useState, useRef, useCallback, useEffect } from "react";
import mammoth from "mammoth";
import { supabase } from "./supabaseClient.js";
import {
  LayoutDashboard,
  FilePlus,
  History,
  LayoutTemplate,
  Settings,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Download,
  Edit2,
  Copy,
  Trash2,
  Loader2,
  X,
  Save,
  BookOpen,
  Wand2,
  CheckCircle2,
  ShieldCheck,
  Users,
  LogIn,
  FileUp,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Peran pengguna (guru / master) sekarang ditentukan di SERVER, lewat tabel
// `admin_emails` + trigger Postgres di supabase/schema.sql — bukan lagi
// dicek di browser. Lihat README-DEPLOY.md untuk cara mengisi email master.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helper: panggil Claude API lewat Supabase Edge Function "generate-ai".
// API key Anthropic tersimpan aman di server (Supabase secrets), tidak
// pernah dikirim ke browser.
// ---------------------------------------------------------------------------
async function callClaude(prompt, maxTokens = 1200) {
  const { data, error } = await supabase.functions.invoke("generate-ai", {
    body: { prompt, maxTokens },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return (data?.text || "").trim();
}

function stripFences(text) {
  return text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

// Parser berbasis penanda "###key###" — jauh lebih tahan banting daripada
// meminta AI mengembalikan JSON, karena isi (langkah-langkah bernomor,
// paragraf multi-baris) sering berisi baris baru yang membuat JSON.parse gagal.
function parseDelimited(raw, fields) {
  const text = stripFences(raw);
  const result = {};
  fields.forEach((f, i) => {
    const startMarker = `###${f.key}###`;
    const startIdx = text.indexOf(startMarker);
    if (startIdx === -1) return;
    const contentStart = startIdx + startMarker.length;
    let endIdx = text.length;
    fields.forEach((other, j) => {
      if (j === i) return;
      const idx = text.indexOf(`###${other.key}###`, contentStart);
      if (idx !== -1 && idx < endIdx) endIdx = idx;
    });
    result[f.key] = text.slice(contentStart, endIdx).trim();
  });
  return result;
}

// ---------------------------------------------------------------------------
// Data awal
// ---------------------------------------------------------------------------
const emptyDataDasar = {
  namaSekolah: "",
  mapel: "",
  fase: "A",
  kelas: "",
  semester: "Ganjil",
  tahunAjaran: "",
  penyusun: "",
  alokasiWaktu: "",
};

const emptyModule = () => ({
  id: crypto.randomUUID(),
  dataDasar: { ...emptyDataDasar },
  cp: "",
  materi: "",
  subMateri: "",
  deepLearning: { meaningful: false, mindful: false, joyful: false },
  model: "Problem Based Learning",
  diferensiasi: { konten: false, proses: false, produk: false },
  profilLulusan: {
    keimanan: false,
    kewargaan: false,
    penalaranKritis: false,
    kreativitas: false,
    kolaborasi: false,
    kemandirian: false,
  },
  jenisAsesmen: { diagnostik: false, formatif: true, sumatif: true },
  generated: {
    tujuanPembelajaran: "",
    pertanyaanPemantik: "",
    kegiatanAwal: "",
    kegiatanInti: "",
    kegiatanPenutup: "",
    refleksi: "",
    asesmenInstrumen: "",
    rubrik: "",
  },
  templateId: null,
  // Salinan (snapshot) urutan baris template yang dipilih, disimpan di dalam
  // modul itu sendiri — supaya modul tetap konsisten walau template induknya
  // diedit/dihapus belakangan.
  templateRows: [],
  // Nilai yang diisi guru untuk baris bertipe "manual" pada template di atas.
  customSections: [],
  createdAt: new Date().toLocaleDateString("id-ID"),
});

// Pilihan field dinamis yang bisa dihubungkan ke sebuah baris template —
// isinya otomatis mengikuti data/hasil AI dari modul yang sedang dibuat.
const DYNAMIC_FIELD_OPTIONS = [
  { value: "identifikasi", label: "Identifikasi (Materi, Profil Lulusan, Diferensiasi)" },
  { value: "cp", label: "Capaian Pembelajaran" },
  { value: "desainPembelajaran", label: "Desain Pembelajaran (Tujuan + Model)" },
  { value: "kegiatanAwal", label: "Kegiatan Awal (AI)" },
  { value: "kegiatanInti", label: "Kegiatan Inti (AI)" },
  { value: "kegiatanPenutup", label: "Kegiatan Penutup (AI)" },
  { value: "refleksi", label: "Refleksi (AI)" },
  { value: "asesmen", label: "Asesmen (Instrumen + Rubrik)" },
  { value: "model", label: "Model Pembelajaran saja" },
  { value: "materi", label: "Materi & Sub Materi saja" },
];

function resolveDynamicField(mod, field) {
  const g = mod.generated;
  const profilTerpilih = Object.entries(mod.profilLulusan)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(", ");
  const diferensiasiTerpilih = Object.entries(mod.diferensiasi)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(", ");
  switch (field) {
    case "identifikasi":
      return (
        `Materi: ${mod.materi || "-"} — ${mod.subMateri || "-"}\n` +
        `Profil Lulusan: ${profilTerpilih || "-"}\n` +
        `Diferensiasi: ${diferensiasiTerpilih || "-"}`
      );
    case "cp":
      return mod.cp || "-";
    case "desainPembelajaran":
      return (
        `Tujuan Pembelajaran:\n${g.tujuanPembelajaran || "-"}\n\n` +
        `Pertanyaan Pemantik:\n${g.pertanyaanPemantik || "-"}\n\n` +
        `Model Pembelajaran: ${mod.model || "-"}`
      );
    case "kegiatanAwal":
      return g.kegiatanAwal || "-";
    case "kegiatanInti":
      return g.kegiatanInti || "-";
    case "kegiatanPenutup":
      return g.kegiatanPenutup || "-";
    case "refleksi":
      return g.refleksi || "-";
    case "asesmen":
      return `Instrumen:\n${g.asesmenInstrumen || "-"}\n\nRubrik Penilaian:\n${g.rubrik || "-"}`;
    case "model":
      return mod.model || "-";
    case "materi":
      return `${mod.materi || "-"} — ${mod.subMateri || "-"}`;
    default:
      return "-";
  }
}

// Template default sebagai contoh — guru bisa memasukkan template sendiri
// (baris demi baris, persis seperti modul ajar yang biasa dipakai
// sekolahnya) lewat menu "Template".
const DEFAULT_TEMPLATES = [
  {
    id: "tpl-default",
    name: "Template Standar Kurikulum Merdeka",
    rows: [
      {
        id: "row-rujukan",
        label: "Rujukan Spiritualisasi",
        type: "manual",
        defaultText: "Kutipan ayat/nilai spiritual beserta maknanya...",
      },
      {
        id: "row-identifikasi",
        label: "Identifikasi",
        type: "dynamic",
        field: "identifikasi",
      },
      { id: "row-cp", label: "Capaian Pembelajaran", type: "dynamic", field: "cp" },
      {
        id: "row-desain",
        label: "Desain Pembelajaran",
        type: "dynamic",
        field: "desainPembelajaran",
      },
      {
        id: "row-awal",
        label: "Pengalaman Belajar — Kegiatan Awal",
        type: "dynamic",
        field: "kegiatanAwal",
      },
      {
        id: "row-inti",
        label: "Pengalaman Belajar — Kegiatan Inti",
        type: "dynamic",
        field: "kegiatanInti",
      },
      {
        id: "row-penutup",
        label: "Pengalaman Belajar — Kegiatan Penutup",
        type: "dynamic",
        field: "kegiatanPenutup",
      },
      { id: "row-refleksi", label: "Refleksi", type: "dynamic", field: "refleksi" },
      { id: "row-asesmen", label: "Asesmen", type: "dynamic", field: "asesmen" },
      {
        id: "row-kemitraan",
        label: "Kemitraan Pembelajaran",
        type: "manual",
        defaultText: "Peran orang tua/wali, guru BK, dsb...",
      },
    ],
  },
];

function applyTemplateToModule(mod, template) {
  if (!template) {
    return { ...mod, templateId: null, templateRows: [], customSections: [] };
  }
  return {
    ...mod,
    templateId: template.id,
    templateRows: template.rows,
    customSections: template.rows
      .filter((r) => r.type === "manual")
      .map((r) => ({ id: r.id, label: r.label, value: r.defaultText || "" })),
  };
}

const MENU = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "buatModul", label: "Buat Modul", icon: FilePlus },
  { key: "riwayat", label: "Riwayat Modul", icon: History },
  { key: "template", label: "Template", icon: LayoutTemplate },
  { key: "pengaturan", label: "Pengaturan", icon: Settings },
];

// Menu tambahan yang hanya tampil untuk peran "master"
const MASTER_MENU = [{ key: "kelolaPengguna", label: "Kelola Pengguna", icon: Users }];

const WIZARD_STEPS = [
  "Isi Data",
  "Tujuan Pembelajaran",
  "Kegiatan Pembelajaran",
  "Asesmen",
  "Preview & Export",
];

const QUICK_ACTIONS = [
  { key: "bahasa", label: "Perbaiki Bahasa" },
  { key: "hots", label: "Buat lebih HOTS" },
  { key: "deep", label: "Sesuaikan Deep Learning" },
  { key: "diferensiasi", label: "Tambahkan Diferensiasi" },
  { key: "fase", label: "Sesuaikan dengan Fase" },
  { key: "profil", label: "Tambahkan Profil Lulusan" },
  { key: "pemantik", label: "Tambahkan Pertanyaan Pemantik" },
  { key: "refleksi", label: "Tambahkan Refleksi" },
];

function quickActionInstruction(key) {
  switch (key) {
    case "bahasa":
      return "Perbaiki tata bahasa, ejaan, dan kejelasan kalimat tanpa mengubah maksud aslinya. Gunakan Bahasa Indonesia formal.";
    case "hots":
      return "Tingkatkan agar mendorong kemampuan berpikir tingkat tinggi (HOTS) seperti menganalisis, mengevaluasi, dan mencipta, sesuai Taksonomi Bloom.";
    case "deep":
      return "Sesuaikan agar lebih mencerminkan prinsip Deep Learning (Meaningful, Mindful, dan Joyful Learning) yang telah dipilih guru.";
    case "diferensiasi":
      return "Tambahkan unsur pembelajaran berdiferensiasi (konten, proses, dan/atau produk) sesuai kebutuhan belajar murid yang beragam.";
    case "fase":
      return "Sesuaikan tingkat kesulitan bahasa dan aktivitas agar tepat dengan fase dan kelas peserta didik yang dipilih.";
    case "profil":
      return "Hubungkan dengan dimensi Profil Lulusan yang telah dipilih guru, jelaskan keterkaitannya secara singkat.";
    case "pemantik":
      return "Tambahkan atau perkuat pertanyaan pemantik yang memancing rasa ingin tahu murid di awal pembelajaran.";
    case "refleksi":
      return "Tambahkan bagian refleksi murid di akhir pembelajaran (apa yang dipelajari, apa yang masih sulit, apa langkah selanjutnya).";
    default:
      return "Perbaiki teks berikut.";
  }
}

function contextSummary(mod) {
  const d = mod.dataDasar;
  const dl = Object.entries(mod.deepLearning)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(", ") || "-";
  const profil = Object.entries(mod.profilLulusan)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(", ") || "-";
  return `Mata Pelajaran: ${d.mapel || "-"}
Fase/Kelas: ${d.fase || "-"} / ${d.kelas || "-"}
Materi: ${mod.materi || "-"}
Sub Materi: ${mod.subMateri || "-"}
Capaian Pembelajaran: ${mod.cp || "-"}
Model Pembelajaran: ${mod.model}
Prinsip Deep Learning dipilih: ${dl}
Profil Lulusan dipilih: ${profil}`;
}

// ---------------------------------------------------------------------------
// Komponen kecil
// ---------------------------------------------------------------------------
function Field({ label, children }) {
  return (
    <label className="block mb-4">
      <span className="block text-sm font-medium text-slate-600 mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-300 transition";

function TextInput(props) {
  return <input {...props} className={inputCls + " " + (props.className || "")} />;
}

function TextArea(props) {
  return (
    <textarea
      {...props}
      className={inputCls + " min-h-[110px] resize-y " + (props.className || "")}
    />
  );
}

function Checkbox({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none rounded-lg px-2.5 py-2 hover:bg-sky-50 transition">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 rounded accent-sky-500"
      />
      <span className="text-sm text-slate-700">{label}</span>
    </label>
  );
}

function PrimaryButton({ children, onClick, disabled, icon: Icon, className = "" }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        "inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-sky-600 active:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition " +
        className
      }
    >
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
}

function GhostButton({ children, onClick, icon: Icon, className = "" }) {
  return (
    <button
      onClick={onClick}
      className={
        "inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition " +
        className
      }
    >
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
}

function Card({ children, className = "" }) {
  return (
    <div
      className={
        "rounded-2xl border border-slate-100 bg-white shadow-sm p-5 " + className
      }
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------
function Sidebar({ active, onSelect, user }) {
  const isMaster = user?.role === "master";
  const menuItems = isMaster ? [...MENU, ...MASTER_MENU] : MENU;
  return (
    <aside className="w-60 shrink-0 h-full border-r border-slate-100 bg-white flex flex-col">
      <div className="flex items-center gap-2 px-5 py-5 border-b border-slate-100">
        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-sky-400 to-emerald-400 flex items-center justify-center">
          <BookOpen size={18} className="text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-800 leading-tight">
            Deep Learning
          </p>
          <p className="text-xs text-slate-400 leading-tight">Module Builder</p>
        </div>
      </div>

      {user && (
        <div className="px-5 py-3 border-b border-slate-100">
          <p className="text-xs font-medium text-slate-700 truncate">{user.email}</p>
          {isMaster ? (
            <span className="inline-flex items-center gap-1 mt-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
              <ShieldCheck size={11} /> Master · Akses Alpha
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 mt-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
              Guru
            </span>
          )}
        </div>
      )}

      <nav className="flex-1 py-3 px-3 space-y-1">
        {menuItems.map((m) => {
          const Icon = m.icon;
          const isActive = active === m.key;
          return (
            <button
              key={m.key}
              onClick={() => onSelect(m.key)}
              className={
                "w-full flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition " +
                (isActive
                  ? "bg-sky-50 text-sky-700"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-700")
              }
            >
              <Icon size={17} className={isActive ? "text-sky-600" : "text-slate-400"} />
              {m.label}
            </button>
          );
        })}
      </nav>
      <div className="px-5 py-4 border-t border-slate-100 space-y-2">
        <button
          onClick={() => supabase.auth.signOut()}
          className="text-xs text-slate-400 hover:text-red-500"
        >
          Keluar
        </button>
        <p className="text-xs text-slate-400">Kurikulum Merdeka · v1.0</p>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// AI Assistant Panel (kanan)
// ---------------------------------------------------------------------------
function AIPanel({ activeField, onApply, moduleCtx }) {
  const [loadingKey, setLoadingKey] = useState(null);
  const [panelError, setPanelError] = useState("");

  const run = async (action) => {
    if (!activeField) return;
    setLoadingKey(action.key);
    setPanelError("");
    try {
      const instruction = quickActionInstruction(action.key);
      const prompt = `Kamu adalah asisten guru SD untuk menyusun Modul Pembelajaran berbasis Deep Learning sesuai Kurikulum Merdeka Indonesia.

Konteks modul:
${contextSummary(moduleCtx)}

Bagian yang sedang diedit: "${activeField.label}"
Isi saat ini:
"""
${activeField.value || "(masih kosong)"}
"""

Instruksi revisi: ${instruction}

Tulis ulang isi bagian tersebut secara lengkap dalam Bahasa Indonesia formal. Balas HANYA dengan teks hasil revisi, tanpa penjelasan tambahan, tanpa tanda kutip pembuka/penutup.`;
      const result = await callClaude(prompt, 900);
      onApply(activeField.key, stripFences(result));
    } catch (e) {
      setPanelError(e?.message || "Gagal menghubungi AI. Coba lagi.");
    } finally {
      setLoadingKey(null);
    }
  };

  return (
    <aside className="w-72 shrink-0 h-full border-l border-slate-100 bg-white flex flex-col">
      <div className="px-4 py-4 border-b border-slate-100 flex items-center gap-2">
        <Sparkles size={16} className="text-emerald-500" />
        <p className="text-sm font-semibold text-slate-800">AI Assistant</p>
      </div>
      <div className="px-4 py-3">
        {activeField ? (
          <p className="text-xs text-slate-400 mb-2">
            Sedang mengedit:{" "}
            <span className="font-medium text-slate-600">{activeField.label}</span>
          </p>
        ) : (
          <p className="text-xs text-slate-400 mb-2">
            Klik salah satu kolom teks untuk mengaktifkan bantuan AI.
          </p>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {panelError && (
          <p className="text-xs text-red-500 mb-1">{panelError}</p>
        )}
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.key}
            disabled={!activeField || loadingKey}
            onClick={() => run(action)}
            className="w-full flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-left text-xs font-medium text-slate-600 hover:bg-emerald-50 hover:border-emerald-100 hover:text-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {loadingKey === action.key ? (
              <Loader2 size={14} className="animate-spin text-emerald-500" />
            ) : (
              <Sparkles size={14} className="text-emerald-500" />
            )}
            {action.label}
          </button>
        ))}
      </div>
      <div className="px-4 py-3 border-t border-slate-100">
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Perubahan langsung diterapkan pada kolom aktif. Anda tidak perlu mengulang
          generate dari awal.
        </p>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
function Dashboard({ modules, onNewModule }) {
  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-xl font-semibold text-slate-800 mb-1">
        Selamat datang, Bapak/Ibu Guru 👋
      </h1>
      <p className="text-sm text-slate-500 mb-6">
        Susun Modul Pembelajaran berbasis Deep Learning dengan bantuan AI, langkah
        demi langkah.
      </p>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card>
          <p className="text-xs text-slate-400 mb-1">Total Modul</p>
          <p className="text-2xl font-semibold text-slate-800">{modules.length}</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-400 mb-1">Mata Pelajaran</p>
          <p className="text-2xl font-semibold text-slate-800">
            {new Set(modules.map((m) => m.dataDasar.mapel).filter(Boolean)).size}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-slate-400 mb-1">Template Tersimpan</p>
          <p className="text-2xl font-semibold text-slate-800">3</p>
        </Card>
      </div>

      <Card className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-700">Mulai modul baru</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Ikuti wizard 5 langkah: Isi Data → Tujuan Pembelajaran → Kegiatan →
            Asesmen → Preview
          </p>
        </div>
        <PrimaryButton icon={FilePlus} onClick={onNewModule}>
          Buat Modul
        </PrimaryButton>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wizard: Step 1 - Isi Data
// ---------------------------------------------------------------------------
function StepData({ mod, setMod, templates }) {
  const d = mod.dataDasar;
  const setD = (patch) => setMod({ ...mod, dataDasar: { ...d, ...patch } });
  const toggle = (group, key) =>
    setMod({ ...mod, [group]: { ...mod[group], [key]: !mod[group][key] } });

  const selectTemplate = (templateId) => {
    const tpl = templates.find((t) => t.id === templateId) || null;
    setMod(applyTemplateToModule(mod, tpl));
  };

  const updateCustomSection = (id, value) =>
    setMod({
      ...mod,
      customSections: mod.customSections.map((s) => (s.id === id ? { ...s, value } : s)),
    });

  return (
    <div className="space-y-6">
      <Card>
        <p className="text-sm font-semibold text-slate-700 mb-1">Template Modul</p>
        <p className="text-xs text-slate-400 mb-3">
          Pilih template agar bagian-bagian tambahannya otomatis muncul di modul ini.
        </p>
        <select
          value={mod.templateId || ""}
          onChange={(e) => selectTemplate(e.target.value || null)}
          className={inputCls}
        >
          <option value="">Tanpa Template</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Card>

      {mod.customSections.length > 0 && (
        <Card>
          <p className="text-sm font-semibold text-slate-700 mb-1">
            Isi Bagian Manual dari Template
          </p>
          <p className="text-xs text-slate-400 mb-3">
            Bagian lain dari template ini akan otomatis terisi mengikuti hasil AI
            di langkah-langkah berikutnya.
          </p>
          {mod.customSections.map((s) => (
            <Field key={s.id} label={s.label}>
              <TextArea
                value={s.value}
                onChange={(e) => updateCustomSection(s.id, e.target.value)}
              />
            </Field>
          ))}
        </Card>
      )}

      <Card>
        <p className="text-sm font-semibold text-slate-700 mb-4">Data Dasar</p>
        <div className="grid grid-cols-2 gap-x-6">
          <Field label="Nama Sekolah">
            <TextInput
              value={d.namaSekolah}
              onChange={(e) => setD({ namaSekolah: e.target.value })}
              placeholder="SD Negeri 1 Makassar"
            />
          </Field>
          <Field label="Mata Pelajaran">
            <TextInput
              value={d.mapel}
              onChange={(e) => setD({ mapel: e.target.value })}
              placeholder="IPA"
            />
          </Field>
          <Field label="Fase">
            <select
              value={d.fase}
              onChange={(e) => setD({ fase: e.target.value })}
              className={inputCls}
            >
              {["A", "B", "C"].map((f) => (
                <option key={f} value={f}>
                  Fase {f}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Kelas">
            <TextInput
              value={d.kelas}
              onChange={(e) => setD({ kelas: e.target.value })}
              placeholder="III"
            />
          </Field>
          <Field label="Semester">
            <select
              value={d.semester}
              onChange={(e) => setD({ semester: e.target.value })}
              className={inputCls}
            >
              <option>Ganjil</option>
              <option>Genap</option>
            </select>
          </Field>
          <Field label="Tahun Ajaran">
            <TextInput
              value={d.tahunAjaran}
              onChange={(e) => setD({ tahunAjaran: e.target.value })}
              placeholder="2026/2027"
            />
          </Field>
          <Field label="Penyusun">
            <TextInput
              value={d.penyusun}
              onChange={(e) => setD({ penyusun: e.target.value })}
              placeholder="Nama guru"
            />
          </Field>
          <Field label="Alokasi Waktu">
            <TextInput
              value={d.alokasiWaktu}
              onChange={(e) => setD({ alokasiWaktu: e.target.value })}
              placeholder="2 x 35 menit"
            />
          </Field>
        </div>
      </Card>

      <Card>
        <p className="text-sm font-semibold text-slate-700 mb-3">
          Capaian Pembelajaran
        </p>
        <TextArea
          value={mod.cp}
          onChange={(e) => setMod({ ...mod, cp: e.target.value })}
          placeholder="Ketik sendiri atau tempelkan CP dari dokumen..."
          className="min-h-[130px]"
        />
      </Card>

      <Card>
        <p className="text-sm font-semibold text-slate-700 mb-4">
          Topik Pembelajaran
        </p>
        <div className="grid grid-cols-2 gap-x-6">
          <Field label="Materi">
            <TextInput
              value={mod.materi}
              onChange={(e) => setMod({ ...mod, materi: e.target.value })}
              placeholder="Magnet"
            />
          </Field>
          <Field label="Sub Materi">
            <TextInput
              value={mod.subMateri}
              onChange={(e) => setMod({ ...mod, subMateri: e.target.value })}
              placeholder="Gaya tarik dan tolak magnet"
            />
          </Field>
        </div>
      </Card>

      <Card>
        <p className="text-sm font-semibold text-slate-700 mb-1">
          Deep Learning — Learning Experience
        </p>
        <p className="text-xs text-slate-400 mb-3">Boleh memilih lebih dari satu.</p>
        <div className="grid grid-cols-3 gap-2">
          <Checkbox
            checked={mod.deepLearning.meaningful}
            onChange={() => toggle("deepLearning", "meaningful")}
            label="Meaningful Learning"
          />
          <Checkbox
            checked={mod.deepLearning.mindful}
            onChange={() => toggle("deepLearning", "mindful")}
            label="Mindful Learning"
          />
          <Checkbox
            checked={mod.deepLearning.joyful}
            onChange={() => toggle("deepLearning", "joyful")}
            label="Joyful Learning"
          />
        </div>
      </Card>

      <Card>
        <p className="text-sm font-semibold text-slate-700 mb-3">Model Pembelajaran</p>
        <select
          value={mod.model}
          onChange={(e) => setMod({ ...mod, model: e.target.value })}
          className={inputCls}
        >
          {[
            "Problem Based Learning",
            "Project Based Learning",
            "Discovery Learning",
            "Inquiry",
            "Cooperative Learning",
            "Direct Instruction",
          ].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </Card>

      <Card>
        <p className="text-sm font-semibold text-slate-700 mb-3">Jenis Asesmen</p>
        <div className="grid grid-cols-3 gap-2">
          <Checkbox
            checked={mod.jenisAsesmen.diagnostik}
            onChange={() => toggle("jenisAsesmen", "diagnostik")}
            label="Diagnostik"
          />
          <Checkbox
            checked={mod.jenisAsesmen.formatif}
            onChange={() => toggle("jenisAsesmen", "formatif")}
            label="Formatif"
          />
          <Checkbox
            checked={mod.jenisAsesmen.sumatif}
            onChange={() => toggle("jenisAsesmen", "sumatif")}
            label="Sumatif"
          />
        </div>
      </Card>

      <Card>
        <p className="text-sm font-semibold text-slate-700 mb-3">Diferensiasi</p>
        <div className="grid grid-cols-3 gap-2">
          <Checkbox
            checked={mod.diferensiasi.konten}
            onChange={() => toggle("diferensiasi", "konten")}
            label="Konten"
          />
          <Checkbox
            checked={mod.diferensiasi.proses}
            onChange={() => toggle("diferensiasi", "proses")}
            label="Proses"
          />
          <Checkbox
            checked={mod.diferensiasi.produk}
            onChange={() => toggle("diferensiasi", "produk")}
            label="Produk"
          />
        </div>
      </Card>

      <Card>
        <p className="text-sm font-semibold text-slate-700 mb-3">Profil Lulusan</p>
        <div className="grid grid-cols-3 gap-2">
          {[
            ["keimanan", "Keimanan"],
            ["kewargaan", "Kewargaan"],
            ["penalaranKritis", "Penalaran Kritis"],
            ["kreativitas", "Kreativitas"],
            ["kolaborasi", "Kolaborasi"],
            ["kemandirian", "Kemandirian"],
          ].map(([key, label]) => (
            <Checkbox
              key={key}
              checked={mod.profilLulusan[key]}
              onChange={() => toggle("profilLulusan", key)}
              label={label}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wizard: Step generik untuk generate AI (TP, Kegiatan, Asesmen)
// ---------------------------------------------------------------------------
function GenerateStep({
  title,
  description,
  mod,
  fields, // [{key, label}]
  buildPrompt,
  onFieldFocus,
  setMod,
  maxTokens = 1800,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const hasContent = fields.some((f) => mod.generated[f.key]);

  const attempt = async (strict) => {
    const basePrompt = buildPrompt(mod, fields);
    const prompt = strict
      ? basePrompt +
        `\n\nPENTING: Jangan menulis kalimat pembuka, sapaan, atau penjelasan apa pun. Balasan Anda HARUS langsung dimulai dengan "###${fields[0].key}###" pada baris pertama, dan wajib menyertakan seluruh penanda ###...### untuk setiap bagian yang diminta, masing-masing ringkas dan padat.`
      : basePrompt;
    const raw = await callClaude(prompt, maxTokens);
    return parseDelimited(raw, fields);
  };

  const generate = async () => {
    setLoading(true);
    setError("");
    try {
      let parsed = await attempt(false);
      let missing = fields.filter((f) => !parsed[f.key]);

      // Jika ada bagian yang tidak terbaca, coba sekali lagi dengan instruksi
      // yang lebih ketat sebelum menyerah — mengatasi kasus AI menambahkan
      // kalimat pembuka atau terpotong sebelum semua penanda selesai ditulis.
      if (missing.length > 0) {
        const retryParsed = await attempt(true);
        parsed = { ...parsed, ...retryParsed };
        missing = fields.filter((f) => !parsed[f.key]);
      }

      const gotSomething = fields.some((f) => parsed[f.key]);
      if (gotSomething) {
        setMod({
          ...mod,
          generated: { ...mod.generated, ...parsed },
        });
      }
      if (missing.length > 0) {
        setError(
          gotSomething
            ? `Bagian "${missing.map((f) => f.label).join(", ")}" belum berhasil dibuat AI. Tekan Generate AI lagi untuk mencoba melengkapi bagian tersebut.`
            : "AI tidak mengembalikan format yang diharapkan. Silakan coba tekan Generate AI sekali lagi."
        );
      }
    } catch (e) {
      setError(e?.message || "Gagal menghubungi AI. Periksa koneksi lalu coba lagi.");
    } finally {
      setLoading(false);
    }
  };

  const setFieldValue = (key, value) =>
    setMod({ ...mod, generated: { ...mod.generated, [key]: value } });

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-700">{title}</p>
            <p className="text-xs text-slate-400 mt-1">{description}</p>
          </div>
          <PrimaryButton icon={loading ? Loader2 : Sparkles} onClick={generate} disabled={loading}>
            {loading ? "Membuat..." : hasContent ? "Buat Ulang dengan AI" : "Generate AI"}
          </PrimaryButton>
        </div>
        {error && (
          <p className="text-xs text-red-500 mt-3">{error}</p>
        )}
      </Card>

      {fields.map((f) => (
        <Card key={f.key}>
          <p className="text-sm font-semibold text-slate-700 mb-2">{f.label}</p>
          <TextArea
            value={mod.generated[f.key]}
            onFocus={() =>
              onFieldFocus({ key: f.key, label: f.label, value: mod.generated[f.key] })
            }
            onChange={(e) => setFieldValue(f.key, e.target.value)}
            placeholder={
              hasContent
                ? ""
                : 'Klik "Generate AI" di atas untuk membuat draf otomatis, lalu edit di sini.'
            }
            className="min-h-[120px]"
          />
        </Card>
      ))}
    </div>
  );
}

// Format keluaran seragam: setiap bagian diawali penanda ###key### di baris
// tersendiri. Jauh lebih tahan gagal parse dibanding meminta JSON, karena isi
// biasanya berupa daftar bernomor / multi-paragraf yang berisi baris baru.
function markerInstructions(fields) {
  return fields
    .map((f) => `###${f.key}###\n(isi ${f.label} di sini)`)
    .join("\n\n");
}

function buildTPPrompt(mod, fields) {
  return `Kamu adalah asisten guru SD Kurikulum Merdeka Indonesia. Susun bagian awal Modul Pembelajaran berbasis Deep Learning berikut, dalam Bahasa Indonesia formal.

Konteks:
${contextSummary(mod)}

Buat:
- tujuanPembelajaran: 2-4 tujuan pembelajaran yang jelas dan terukur (gunakan kata kerja operasional), sebagai daftar bernomor.
- pertanyaanPemantik: 2-3 pertanyaan pemantik yang memancing rasa ingin tahu murid tentang topik ini, sebagai daftar bernomor.

Balas PERSIS dengan format berikut, tanpa kalimat pembuka, tanpa penjelasan tambahan, tanpa tanda kutip, dan tanpa markdown code block:

${markerInstructions(fields)}`;
}

function buildKegiatanPrompt(mod, fields) {
  return `Kamu adalah asisten guru SD Kurikulum Merdeka Indonesia. Susun rangkaian kegiatan pembelajaran sesuai sintaks model "${mod.model}", dalam Bahasa Indonesia formal.

Konteks:
${contextSummary(mod)}
Tujuan Pembelajaran yang sudah disusun:
${mod.generated.tujuanPembelajaran || "-"}

Buat, masing-masing sebagai daftar langkah bernomor:
- kegiatanAwal: langkah-langkah kegiatan pembuka (apersepsi, motivasi, penyampaian tujuan).
- kegiatanInti: langkah-langkah kegiatan inti sesuai sintaks model pembelajaran yang dipilih, mencerminkan prinsip Deep Learning yang dipilih guru.
- kegiatanPenutup: langkah-langkah kegiatan penutup (kesimpulan, tindak lanjut).
- refleksi: pertanyaan atau kegiatan refleksi murid di akhir pembelajaran.

Balas PERSIS dengan format berikut, tanpa kalimat pembuka, tanpa penjelasan tambahan, tanpa tanda kutip, dan tanpa markdown code block:

${markerInstructions(fields)}`;
}

function buildAsesmenPrompt(mod, fields) {
  const jenis = Object.entries(mod.jenisAsesmen)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(", ");
  return `Kamu adalah asisten guru SD Kurikulum Merdeka Indonesia. Susun instrumen asesmen sederhana, dalam Bahasa Indonesia formal.

Konteks:
${contextSummary(mod)}
Jenis asesmen yang dipilih guru: ${jenis || "formatif"}
Tujuan Pembelajaran:
${mod.generated.tujuanPembelajaran || "-"}

Buat, secara ringkas dan padat (jangan bertele-tele):
- asesmenInstrumen: instrumen asesmen sederhana untuk SETIAP jenis asesmen yang dipilih (maksimal 3-5 butir/poin per jenis), diberi sub-judul jenis asesmennya.
- rubrik: rubrik penilaian sederhana (3-4 level capaian, masing-masing 1 baris deskripsi singkat).

Balas PERSIS dengan format berikut, tanpa kalimat pembuka, tanpa penjelasan tambahan, tanpa tanda kutip, dan tanpa markdown code block:

${markerInstructions(fields)}`;
}

// ---------------------------------------------------------------------------
// Wizard: Step Preview & Export
// ---------------------------------------------------------------------------
// Menyusun modul sebagai daftar baris tabel "Komponen | Deskripsi". Jika guru
// memilih Template, urutan & isi barisnya mengikuti template tersebut
// (baris manual = teks tetap dari guru, baris dinamis = otomatis dari data
// modul / hasil AI). Jika "Tanpa Template", pakai struktur bawaan aplikasi.
function buildKomponenRows(mod) {
  if (mod.templateRows && mod.templateRows.length > 0) {
    return mod.templateRows.map((row) => {
      if (row.type === "manual") {
        const cs = mod.customSections.find((s) => s.id === row.id);
        return { label: row.label, content: (cs && cs.value) || row.defaultText || "-" };
      }
      return { label: row.label, content: resolveDynamicField(mod, row.field) };
    });
  }
  return buildDefaultKomponenRows(mod);
}

function buildDefaultKomponenRows(mod) {
  const g = mod.generated;
  const rows = [];

  const profilTerpilih = Object.entries(mod.profilLulusan)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(", ");
  const diferensiasiTerpilih = Object.entries(mod.diferensiasi)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(", ");

  rows.push({
    label: "Identifikasi",
    content:
      `Materi: ${mod.materi || "-"} — ${mod.subMateri || "-"}\n` +
      `Profil Lulusan: ${profilTerpilih || "-"}\n` +
      `Diferensiasi: ${diferensiasiTerpilih || "-"}`,
  });

  rows.push({
    label: "Capaian Pembelajaran",
    content: mod.cp || "-",
  });

  rows.push({
    label: "Desain Pembelajaran",
    content:
      `Tujuan Pembelajaran:\n${g.tujuanPembelajaran || "-"}\n\n` +
      `Pertanyaan Pemantik:\n${g.pertanyaanPemantik || "-"}\n\n` +
      `Model Pembelajaran: ${mod.model || "-"}`,
  });

  rows.push({
    label: "Pengalaman Belajar — Kegiatan Awal",
    content: g.kegiatanAwal || "-",
  });
  rows.push({
    label: "Pengalaman Belajar — Kegiatan Inti",
    content: g.kegiatanInti || "-",
  });
  rows.push({
    label: "Pengalaman Belajar — Kegiatan Penutup",
    content: g.kegiatanPenutup || "-",
  });
  rows.push({
    label: "Refleksi",
    content: g.refleksi || "-",
  });

  rows.push({
    label: "Asesmen",
    content: `Instrumen:\n${g.asesmenInstrumen || "-"}\n\nRubrik Penilaian:\n${g.rubrik || "-"}`,
  });

  return rows;
}

function StepPreview({ mod, onSave }) {
  const d = mod.dataDasar;
  const rows = buildKomponenRows(mod);
  const today = new Date().toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const exportDocx = () => {
    const safeName =
      (d.mapel || mod.materi || "Modul")
        .replace(/[^a-zA-Z0-9\u00C0-\u024F _-]+/g, "")
        .trim() || "Modul";

    const tableRowsHtml = rows
      .map(
        (r) => `
        <tr>
          <td style="border:1px solid #333;padding:6px 8px;width:22%;vertical-align:top;font-weight:bold;">${r.label}</td>
          <td style="border:1px solid #333;padding:6px 8px;vertical-align:top;">${(r.content || "-").replace(/\n/g, "<br/>")}</td>
        </tr>`
      )
      .join("");

    const html =
      "\ufeff" +
      `
      <html><head><meta charset="utf-8"></head><body style="font-family:Calibri,Arial,sans-serif;font-size:11pt;">
      <h2 style="text-align:center;">MODUL AJAR</h2>
      <table style="border-collapse:collapse;width:100%;margin-bottom:16px;">
        <tr><td style="border:1px solid #333;padding:5px 8px;width:30%;">Nama Sekolah</td><td style="border:1px solid #333;padding:5px 8px;">: ${d.namaSekolah || "-"}</td></tr>
        <tr><td style="border:1px solid #333;padding:5px 8px;">Nama Penyusun</td><td style="border:1px solid #333;padding:5px 8px;">: ${d.penyusun || "-"}</td></tr>
        <tr><td style="border:1px solid #333;padding:5px 8px;">Mata Pelajaran</td><td style="border:1px solid #333;padding:5px 8px;">: ${d.mapel || "-"}</td></tr>
        <tr><td style="border:1px solid #333;padding:5px 8px;">Fase/Kelas</td><td style="border:1px solid #333;padding:5px 8px;">: ${d.fase || "-"}/${d.kelas || "-"}</td></tr>
        <tr><td style="border:1px solid #333;padding:5px 8px;">Semester</td><td style="border:1px solid #333;padding:5px 8px;">: ${d.semester || "-"}</td></tr>
        <tr><td style="border:1px solid #333;padding:5px 8px;">Tahun Ajaran</td><td style="border:1px solid #333;padding:5px 8px;">: ${d.tahunAjaran || "-"}</td></tr>
        <tr><td style="border:1px solid #333;padding:5px 8px;">Alokasi Waktu</td><td style="border:1px solid #333;padding:5px 8px;">: ${d.alokasiWaktu || "-"}</td></tr>
      </table>
      <table style="border-collapse:collapse;width:100%;">
        <tr>
          <td style="border:1px solid #333;padding:6px 8px;width:22%;font-weight:bold;background:#eef6fb;">Komponen</td>
          <td style="border:1px solid #333;padding:6px 8px;font-weight:bold;background:#eef6fb;">Deskripsi</td>
        </tr>
        ${tableRowsHtml}
      </table>
      <p style="margin-top:24px;">Makassar, ${today}</p>
      <p>Mengetahui,</p>
      <table style="border-collapse:collapse;width:100%;margin-top:40px;">
        <tr>
          <td style="width:33%;text-align:center;">Kepala Sekolah</td>
          <td style="width:33%;text-align:center;"></td>
          <td style="width:34%;text-align:center;">Guru Kelas</td>
        </tr>
        <tr><td style="height:50px;"></td><td></td><td></td></tr>
        <tr>
          <td style="text-align:center;text-decoration:underline;">(________________)</td>
          <td></td>
          <td style="text-align:center;text-decoration:underline;">${d.penyusun || "________________"}</td>
        </tr>
      </table>
      </body></html>`;

    let url;
    try {
      const blob = new Blob([html], { type: "application/msword" });
      url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Modul_${safeName}.doc`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      // Beberapa lingkungan (mis. iframe sandbox) memblokir unduhan otomatis.
      // Fallback: buka dokumen di tab baru agar guru bisa "Simpan Sebagai" manual.
      try {
        if (!url) {
          const blob = new Blob([html], { type: "application/msword" });
          url = URL.createObjectURL(blob);
        }
        window.open(url, "_blank");
      } catch (err2) {
        alert(
          "Unduhan otomatis diblokir oleh lingkungan ini. Salin isi modul dari halaman Preview di bawah, lalu tempelkan ke dokumen Word secara manual."
        );
      }
    }
  };

  return (
    <div className="space-y-4">
      <Card className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-700">Preview Modul</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Periksa kembali seluruh isi sebelum mengekspor. Hasil akhir berbentuk
            tabel, sama seperti format modul ajar konvensional.
          </p>
        </div>
        <div className="flex gap-2">
          <GhostButton icon={Save} onClick={onSave}>
            Simpan
          </GhostButton>
          <PrimaryButton icon={Download} onClick={exportDocx}>
            Export DOCX
          </PrimaryButton>
        </div>
      </Card>

      <Card>
        <p className="text-base font-semibold text-slate-800 mb-3 text-center">
          MODUL AJAR
        </p>
        <table className="w-full border-collapse text-sm mb-6">
          <tbody>
            {[
              ["Nama Sekolah", d.namaSekolah],
              ["Nama Penyusun", d.penyusun],
              ["Mata Pelajaran", d.mapel],
              ["Fase/Kelas", `${d.fase || "-"}/${d.kelas || "-"}`],
              ["Semester", d.semester],
              ["Tahun Ajaran", d.tahunAjaran],
              ["Alokasi Waktu", d.alokasiWaktu],
            ].map(([label, value]) => (
              <tr key={label}>
                <td className="border border-slate-200 px-3 py-1.5 w-1/3 text-slate-500">
                  {label}
                </td>
                <td className="border border-slate-200 px-3 py-1.5 text-slate-700">
                  {value || "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border border-slate-200 bg-sky-50 px-3 py-2 text-left w-1/4 text-slate-700">
                Komponen
              </th>
              <th className="border border-slate-200 bg-sky-50 px-3 py-2 text-left text-slate-700">
                Deskripsi
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="border border-slate-200 px-3 py-2 align-top font-medium text-slate-700">
                  {r.label}
                </td>
                <td className="border border-slate-200 px-3 py-2 align-top text-slate-700 whitespace-pre-line">
                  {r.content}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="text-xs text-slate-400 mt-6 text-center">
          Makassar, {today} · Mengetahui, Kepala Sekolah & Guru Kelas ({d.penyusun || "-"})
        </p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wizard container
// ---------------------------------------------------------------------------
function WizardProgress({ step }) {
  return (
    <div className="flex items-center gap-2 px-8 pt-6 pb-4">
      {WIZARD_STEPS.map((label, i) => {
        const state = i < step ? "done" : i === step ? "active" : "todo";
        return (
          <React.Fragment key={label}>
            <div className="flex items-center gap-2">
              <div
                className={
                  "h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-semibold " +
                  (state === "done"
                    ? "bg-emerald-500 text-white"
                    : state === "active"
                    ? "bg-sky-500 text-white"
                    : "bg-slate-100 text-slate-400")
                }
              >
                {state === "done" ? <CheckCircle2 size={14} /> : i + 1}
              </div>
              <span
                className={
                  "text-xs font-medium " +
                  (state === "todo" ? "text-slate-400" : "text-slate-700")
                }
              >
                {label}
              </span>
            </div>
            {i < WIZARD_STEPS.length - 1 && (
              <div className="w-6 h-px bg-slate-200 shrink-0" />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function BuatModul({ mod, setMod, onFieldFocus, onSaveModule, onExit, templates }) {
  const [step, setStep] = useState(0);

  const next = () => setStep((s) => Math.min(s + 1, WIZARD_STEPS.length - 1));
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-8 pt-5">
        <button
          onClick={onExit}
          className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
        >
          <ChevronLeft size={14} /> Kembali ke Dashboard
        </button>
      </div>
      <WizardProgress step={step} />
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {step === 0 && <StepData mod={mod} setMod={setMod} templates={templates} />}
        {step === 1 && (
          <GenerateStep
            title="Tujuan Pembelajaran"
            description="AI menyusun tujuan pembelajaran dan pertanyaan pemantik berdasarkan data yang telah diisi."
            mod={mod}
            setMod={setMod}
            onFieldFocus={onFieldFocus}
            fields={[
              { key: "tujuanPembelajaran", label: "Tujuan Pembelajaran" },
              { key: "pertanyaanPemantik", label: "Pertanyaan Pemantik" },
            ]}
            buildPrompt={buildTPPrompt}
          />
        )}
        {step === 2 && (
          <GenerateStep
            title="Kegiatan Pembelajaran"
            description="AI menyusun kegiatan awal, inti, penutup, dan refleksi sesuai model pembelajaran yang dipilih."
            mod={mod}
            setMod={setMod}
            onFieldFocus={onFieldFocus}
            maxTokens={2200}
            fields={[
              { key: "kegiatanAwal", label: "Kegiatan Awal" },
              { key: "kegiatanInti", label: "Kegiatan Inti" },
              { key: "kegiatanPenutup", label: "Kegiatan Penutup" },
              { key: "refleksi", label: "Refleksi" },
            ]}
            buildPrompt={buildKegiatanPrompt}
          />
        )}
        {step === 3 && (
          <GenerateStep
            title="Asesmen"
            description="AI menyusun instrumen asesmen sederhana dan rubrik penilaian sesuai jenis asesmen yang dipilih."
            mod={mod}
            setMod={setMod}
            onFieldFocus={onFieldFocus}
            maxTokens={2200}
            fields={[
              { key: "asesmenInstrumen", label: "Instrumen Asesmen" },
              { key: "rubrik", label: "Rubrik Penilaian" },
            ]}
            buildPrompt={buildAsesmenPrompt}
          />
        )}
        {step === 4 && <StepPreview mod={mod} onSave={onSaveModule} />}
      </div>
      <div className="flex items-center justify-between px-8 py-4 border-t border-slate-100 bg-white">
        <GhostButton icon={ChevronLeft} onClick={prev} className={step === 0 ? "invisible" : ""}>
          Sebelumnya
        </GhostButton>
        {step < WIZARD_STEPS.length - 1 ? (
          <PrimaryButton icon={ChevronRight} onClick={next} className="flex-row-reverse">
            Lanjut
          </PrimaryButton>
        ) : (
          <span className="text-xs text-slate-400">Modul siap diekspor</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Riwayat
// ---------------------------------------------------------------------------
function Riwayat({ modules, onEdit, onDuplicate, onDelete }) {
  if (modules.length === 0) {
    return (
      <div className="p-8">
        <p className="text-sm text-slate-500">Belum ada modul yang tersimpan.</p>
      </div>
    );
  }
  return (
    <div className="p-8 max-w-4xl">
      <h2 className="text-lg font-semibold text-slate-800 mb-4">Riwayat Modul</h2>
      <div className="grid grid-cols-2 gap-4">
        {modules.map((m) => (
          <Card key={m.id}>
            <p className="text-sm font-semibold text-slate-800">
              {m.materi || "Modul tanpa nama"}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {m.createdAt} · {m.dataDasar.mapel || "-"} · Kelas {m.dataDasar.kelas || "-"}
            </p>
            <div className="flex gap-2 mt-4">
              <GhostButton icon={Edit2} onClick={() => onEdit(m)}>
                Edit
              </GhostButton>
              <GhostButton icon={Copy} onClick={() => onDuplicate(m)}>
                Duplikat
              </GhostButton>
              <GhostButton icon={Trash2} onClick={() => onDelete(m)}>
                Hapus
              </GhostButton>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------
function TemplateForm({ onSave, onCancel }) {
  const [name, setName] = useState("");
  const [rows, setRows] = useState([
    { label: "", type: "manual", defaultText: "", field: DYNAMIC_FIELD_OPTIONS[0].value },
  ]);
  const [pasteText, setPasteText] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef(null);

  const updateRow = (i, patch) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const addRow = () =>
    setRows((prev) => [
      ...prev,
      { label: "", type: "manual", defaultText: "", field: DYNAMIC_FIELD_OPTIONS[0].value },
    ]);
  const removeRow = (i) => setRows((prev) => prev.filter((_, idx) => idx !== i));
  const moveRow = (i, dir) =>
    setRows((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  // Mengubah tabel terbesar di dalam file .docx yang diunggah menjadi baris
  // template siap edit — setiap baris tabel jadi satu baris Komponen/Deskripsi.
  const handleFileUpload = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setUploading(true);
    setUploadError("");
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer });
      const doc = new DOMParser().parseFromString(result.value, "text/html");
      const tables = Array.from(doc.querySelectorAll("table"));
      if (tables.length === 0) {
        setUploadError(
          "Tidak ditemukan tabel di dalam file ini. Pastikan template berbentuk tabel (mis. tabel Komponen/Deskripsi), atau gunakan opsi tempel teks di atas."
        );
        return;
      }
      // Ambil tabel dengan jumlah baris terbanyak — biasanya itu tabel isi
      // utama (Komponen/Deskripsi), bukan tabel data sekolah di bagian atas.
      const mainTable = tables.reduce((best, t) => {
        const rowCount = t.querySelectorAll("tr").length;
        const bestCount = best ? best.querySelectorAll("tr").length : 0;
        return rowCount > bestCount ? t : best;
      }, null);

      const trs = Array.from(mainTable.querySelectorAll("tr"));
      const imported = [];
      trs.forEach((tr) => {
        const cells = Array.from(tr.querySelectorAll("td, th"));
        if (cells.length < 2) return;
        const label = cells[0].textContent.replace(/\s+/g, " ").trim();
        const defaultText = cells
          .slice(1)
          .map((c) => c.textContent.replace(/[ \t]+/g, " ").trim())
          .filter(Boolean)
          .join("\n");
        if (!label) return;
        // Lewati baris header seperti "Komponen | Deskripsi"
        if (/^komponen$/i.test(label)) return;
        imported.push({
          label,
          type: "manual",
          defaultText,
          field: DYNAMIC_FIELD_OPTIONS[0].value,
        });
      });

      if (imported.length === 0) {
        setUploadError(
          "Tabel ditemukan, tapi tidak ada baris yang bisa dibaca. Coba gunakan opsi tempel teks di atas sebagai gantinya."
        );
        return;
      }

      setRows(imported);
      if (!name.trim()) {
        setName(file.name.replace(/\.docx?$/i, ""));
      }
    } catch (err) {
      setUploadError(
        "Gagal membaca file ini. Pastikan file berformat .docx (Word), bukan .doc lama atau PDF."
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Mengubah contoh template yang ditempel (mis. hasil salin dari modul lama)
  // menjadi baris-baris siap edit, tanpa harus menambah satu-satu secara manual.
  // Format: setiap bagian dipisah baris kosong; baris pertama tiap bagian jadi
  // nama Komponen, sisanya jadi isi/contoh teks (tipe Manual).
  const importFromPaste = () => {
    const blocks = pasteText
      .split(/\n\s*\n+/)
      .map((b) => b.trim())
      .filter(Boolean);
    if (blocks.length === 0) return;
    const imported = blocks.map((block) => {
      const lines = block.split("\n");
      const label = lines[0].trim();
      const defaultText = lines.slice(1).join("\n").trim();
      return { label, type: "manual", defaultText, field: DYNAMIC_FIELD_OPTIONS[0].value };
    });
    setRows(imported);
    setPasteText("");
    setShowPaste(false);
  };

  const save = () => {
    const cleanRows = rows
      .filter((r) => r.label.trim())
      .map((r, i) => ({
        id: `row-${Date.now()}-${i}`,
        label: r.label.trim(),
        type: r.type,
        ...(r.type === "manual"
          ? { defaultText: r.defaultText.trim() }
          : { field: r.field }),
      }));
    if (!name.trim() || cleanRows.length === 0) return;
    onSave({ id: crypto.randomUUID(), name: name.trim(), rows: cleanRows });
  };

  return (
    <Card className="mb-4">
      <p className="text-sm font-semibold text-slate-700 mb-3">Buat Template Baru</p>
      <Field label="Nama Template">
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Template IPA"
        />
      </Field>

      <div className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50/50 p-3 mb-3">
        <p className="text-xs font-medium text-emerald-700 flex items-center gap-1 mb-2">
          <FileUp size={13} />
          Unggah File Contoh Template (.docx)
        </p>
        <p className="text-xs text-slate-500 mb-2">
          Punya file modul ajar yang biasa dipakai sekolah Anda? Unggah di sini —
          tabel Komponen/Deskripsi di dalamnya otomatis diubah menjadi baris
          template siap pakai, tanpa perlu mengetik ulang.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx"
          onChange={handleFileUpload}
          className="hidden"
          id="template-file-upload"
        />
        <div className="flex items-center gap-2">
          <GhostButton
            icon={uploading ? Loader2 : FileUp}
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
            disabled={uploading}
          >
            {uploading ? "Membaca file..." : "Pilih File .docx"}
          </GhostButton>
        </div>
        {uploadError && <p className="text-xs text-red-500 mt-2">{uploadError}</p>}
        <p className="text-[11px] text-slate-400 mt-2">
          Ini akan mengganti seluruh baris di bawah dengan hasil bacaan file — Anda
          tetap bisa mengedit teks, mengubah tipe (Manual/Otomatis), menambah, atau
          menghapus baris setelahnya.
        </p>
      </div>

      <div className="rounded-xl border border-dashed border-sky-200 bg-sky-50/50 p-3 mb-4">
        <button
          onClick={() => setShowPaste((v) => !v)}
          className="text-xs font-medium text-sky-700 flex items-center gap-1"
        >
          <Sparkles size={13} />
          {showPaste ? "Sembunyikan" : "Tempel Contoh Template Sekaligus (opsional)"}
        </button>
        {showPaste && (
          <div className="mt-3">
            <p className="text-xs text-slate-500 mb-2">
              Alih-alih menambah baris satu per satu, tempel saja contoh modul/template
              Anda di sini. Pisahkan setiap bagian dengan <b>satu baris kosong</b>; baris
              pertama tiap bagian akan menjadi nama Komponen, sisanya menjadi isi bawaan.
              Contoh:
            </p>
            <pre className="text-[11px] bg-white border border-slate-200 rounded-lg p-2 mb-2 whitespace-pre-wrap text-slate-500">
{`Rujukan Spiritualisasi
QS. Al-Baqarah (2):286 — "Allah tidak membebani seseorang..."

Kemitraan Pembelajaran
Orang Tua/Wali: mengajak anak berdiskusi di rumah...`}
            </pre>
            <TextArea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Tempel contoh template Anda di sini..."
              className="min-h-[140px] mb-2"
            />
            <PrimaryButton icon={Wand2} onClick={importFromPaste}>
              Pisahkan ke Baris Template
            </PrimaryButton>
            <p className="text-[11px] text-slate-400 mt-2">
              Ini akan mengganti seluruh baris di bawah dengan hasil impor — Anda tetap
              bisa mengedit, mengubah tipe (Manual/Otomatis), atau menghapus baris
              setelahnya.
            </p>
          </div>
        )}
      </div>

      <p className="text-xs font-medium text-slate-600 mb-2">
        Susun baris "Komponen" dari template ini, urut dari atas ke bawah
      </p>
      <p className="text-xs text-slate-400 mb-3">
        Masukkan template Anda persis seperti modul yang biasa dipakai — baris
        <b> Manual</b> berarti teks tetap yang Anda tulis sendiri (mis. "Rujukan
        Spiritualisasi"); baris <b>Otomatis</b> berarti isinya diambil dari data modul
        atau hasil AI (mis. Tujuan Pembelajaran, Kegiatan Inti, Asesmen).
      </p>
      <div className="space-y-3 mb-3">
        {rows.map((r, i) => (
          <div key={i} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <div className="flex gap-2 items-start mb-2">
              <TextInput
                value={r.label}
                onChange={(e) => updateRow(i, { label: e.target.value })}
                placeholder="Nama baris/komponen (mis. Rujukan Spiritualisasi)"
                className="flex-1"
              />
              <select
                value={r.type}
                onChange={(e) => updateRow(i, { type: e.target.value })}
                className={inputCls + " w-40"}
              >
                <option value="manual">Manual</option>
                <option value="dynamic">Otomatis</option>
              </select>
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => moveRow(i, -1)}
                  disabled={i === 0}
                  className="text-slate-400 hover:text-sky-600 disabled:opacity-30"
                >
                  <ChevronLeft size={14} className="rotate-90" />
                </button>
                <button
                  onClick={() => moveRow(i, 1)}
                  disabled={i === rows.length - 1}
                  className="text-slate-400 hover:text-sky-600 disabled:opacity-30"
                >
                  <ChevronRight size={14} className="rotate-90" />
                </button>
              </div>
              <button
                onClick={() => removeRow(i)}
                className="text-slate-400 hover:text-red-500 mt-2"
              >
                <X size={16} />
              </button>
            </div>
            {r.type === "manual" ? (
              <TextArea
                value={r.defaultText}
                onChange={(e) => updateRow(i, { defaultText: e.target.value })}
                placeholder="Teks bawaan / contoh isi untuk baris ini (bisa diedit lagi saat membuat modul)"
                className="min-h-[70px]"
              />
            ) : (
              <select
                value={r.field}
                onChange={(e) => updateRow(i, { field: e.target.value })}
                className={inputCls}
              >
                {DYNAMIC_FIELD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mb-4">
        <GhostButton onClick={addRow}>+ Tambah Baris</GhostButton>
      </div>
      <div className="flex gap-2">
        <PrimaryButton icon={Save} onClick={save}>
          Simpan Template
        </PrimaryButton>
        <GhostButton onClick={onCancel}>Batal</GhostButton>
      </div>
    </Card>
  );
}

function TemplatePage({ templates, onCreateTemplate, onDeleteTemplate }) {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Template</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Masukkan template Anda sendiri (baris demi baris) — template ini akan
            menjadi struktur dasar setiap modul yang dibuat dengannya.
          </p>
        </div>
        {!showForm && (
          <PrimaryButton icon={FilePlus} onClick={() => setShowForm(true)}>
            Buat Template
          </PrimaryButton>
        )}
      </div>

      {showForm && (
        <TemplateForm
          onSave={(tpl) => {
            onCreateTemplate(tpl);
            setShowForm(false);
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      <div className="grid grid-cols-2 gap-4">
        {templates.map((t) => (
          <Card key={t.id}>
            <div className="flex items-start justify-between">
              <div className="h-9 w-9 rounded-lg bg-sky-50 flex items-center justify-center mb-3">
                <LayoutTemplate size={16} className="text-sky-500" />
              </div>
              <button
                onClick={() => onDeleteTemplate(t)}
                className="text-slate-300 hover:text-red-500"
              >
                <Trash2 size={15} />
              </button>
            </div>
            <p className="text-sm font-medium text-slate-700">{t.name}</p>
            <p className="text-xs text-slate-400 mt-1">
              {t.rows.length} baris: {t.rows.map((r) => r.label).join(", ")}
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pengaturan
// ---------------------------------------------------------------------------
function Pengaturan() {
  const [nama, setNama] = useState("");
  const [email, setEmail] = useState("");
  return (
    <div className="p-8 max-w-lg">
      <h2 className="text-lg font-semibold text-slate-800 mb-4">Pengaturan</h2>
      <Card>
        <Field label="Nama Guru">
          <TextInput value={nama} onChange={(e) => setNama(e.target.value)} placeholder="Nama Anda" />
        </Field>
        <Field label="Email">
          <TextInput
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nama@sekolah.sch.id"
          />
        </Field>
        <PrimaryButton icon={Save}>Simpan Perubahan</PrimaryButton>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Login sederhana berbasis email
// ---------------------------------------------------------------------------
function LoginScreen() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!email.trim()) return;
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setLoading(false);
    if (error) {
      setError(error.message || "Gagal mengirim link masuk. Coba lagi.");
    } else {
      setSent(true);
    }
  };

  return (
    <div className="h-screen w-full flex items-center justify-center bg-slate-50">
      <Card className="w-full max-w-sm">
        <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-sky-400 to-emerald-400 flex items-center justify-center mb-4">
          <BookOpen size={20} className="text-white" />
        </div>
        <p className="text-base font-semibold text-slate-800 mb-1">
          Deep Learning Module Builder
        </p>

        {sent ? (
          <>
            <p className="text-sm text-slate-600 mb-1">Cek email Anda 📩</p>
            <p className="text-xs text-slate-400 mb-4">
              Kami mengirim link masuk ke <b>{email}</b>. Klik link tersebut untuk
              langsung masuk ke aplikasi — tidak perlu kata sandi.
            </p>
            <GhostButton onClick={() => setSent(false)} className="w-full justify-center">
              Kirim ulang / ganti email
            </GhostButton>
          </>
        ) : (
          <>
            <p className="text-xs text-slate-400 mb-5">
              Masuk dengan email sekolah Anda — kami akan mengirim link masuk, tanpa
              kata sandi.
            </p>
            <Field label="Email">
              <TextInput
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="nama@sekolah.sch.id"
                type="email"
              />
            </Field>
            {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
            <PrimaryButton
              icon={loading ? Loader2 : LogIn}
              onClick={submit}
              disabled={loading}
              className="w-full justify-center"
            >
              {loading ? "Mengirim..." : "Kirim Link Masuk"}
            </PrimaryButton>
          </>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kelola Pengguna (khusus master)
// ---------------------------------------------------------------------------
function KelolaPengguna({ user }) {
  const [otherUsers, setOtherUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("email, role")
      .neq("email", user.email)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        setOtherUsers(data || []);
        setLoading(false);
      });
  }, [user.email]);

  return (
    <div className="p-8 max-w-2xl">
      <h2 className="text-lg font-semibold text-slate-800 mb-1">Kelola Pengguna</h2>
      <p className="text-xs text-slate-400 mb-4">
        Hanya akun master yang dapat melihat halaman ini. Untuk menjadikan guru lain
        sebagai master, tambahkan emailnya ke tabel <code>admin_emails</code> di
        Supabase (lihat README-DEPLOY.md).
      </p>
      <Card className="mb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-700">{user.email}</p>
            <p className="text-xs text-slate-400">Akun ini</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600">
            <ShieldCheck size={12} /> Master · Tanpa Batas
          </span>
        </div>
      </Card>
      {loading ? (
        <p className="text-xs text-slate-400">Memuat daftar pengguna...</p>
      ) : otherUsers.length > 0 ? (
        <div className="space-y-2">
          {otherUsers.map((u) => (
            <Card key={u.email} className="flex items-center justify-between">
              <p className="text-sm text-slate-700">{u.email}</p>
              <span
                className={
                  "rounded-full px-2.5 py-1 text-xs font-medium " +
                  (u.role === "master"
                    ? "bg-emerald-50 text-emerald-600"
                    : "bg-slate-100 text-slate-500")
                }
              >
                {u.role === "master" ? "Master" : "Guru"}
              </span>
            </Card>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-400">Belum ada guru lain yang masuk.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
  const [session, setSession] = useState(undefined); // undefined = memuat, null = belum login
  const [profile, setProfile] = useState(null);
  const [activeMenu, setActiveMenu] = useState("dashboard");
  const [modules, setModules] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [currentModule, setCurrentModule] = useState(null);
  const [activeField, setActiveField] = useState(null);

  // Pantau status login (session) Supabase
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Setelah login, ambil profil (berisi peran guru/master yang ditentukan server)
  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    const loadProfile = async () => {
      // Baris profil dibuat otomatis oleh trigger saat pertama login; beri
      // sedikit jeda/percobaan ulang untuk menghindari race condition di
      // percobaan login pertama.
      for (let i = 0; i < 5; i++) {
        const { data } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", session.user.id)
          .maybeSingle();
        if (data) {
          if (!cancelled) setProfile(data);
          return;
        }
        await new Promise((r) => setTimeout(r, 600));
      }
    };
    loadProfile();
    return () => {
      cancelled = true;
    };
  }, [session]);

  // Muat modul & template milik pengguna setelah profil siap
  useEffect(() => {
    if (!session || !profile) return;
    supabase
      .from("modules")
      .select("*")
      .eq("owner_id", session.user.id)
      .order("updated_at", { ascending: false })
      .then(({ data }) => {
        setModules(
          (data || []).map((row) => ({
            ...row.data,
            id: row.id,
            createdAt: new Date(row.created_at).toLocaleDateString("id-ID"),
          }))
        );
      });

    supabase
      .from("templates")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setTemplates((data || []).map((row) => ({ id: row.id, name: row.name, rows: row.rows })));
      });
  }, [session, profile]);

  if (session === undefined) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-sky-400" size={28} />
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  if (!profile) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <Loader2 className="animate-spin text-sky-400 mx-auto mb-3" size={28} />
          <p className="text-xs text-slate-400">Menyiapkan akun Anda...</p>
        </div>
      </div>
    );
  }

  const user = { email: profile.email, role: profile.role };

  const startNewModule = () => {
    setCurrentModule(emptyModule());
    setActiveField(null);
    setActiveMenu("buatModul");
  };

  const editModule = (m) => {
    setCurrentModule(m);
    setActiveField(null);
    setActiveMenu("buatModul");
  };

  const saveCurrentModule = async () => {
    if (!currentModule) return;
    const { id, ...data } = currentModule;
    const { error } = await supabase
      .from("modules")
      .upsert({ id, owner_id: session.user.id, data, updated_at: new Date().toISOString() });
    if (error) {
      alert("Gagal menyimpan modul: " + error.message);
      return;
    }
    setModules((prev) => {
      const exists = prev.find((m) => m.id === currentModule.id);
      if (exists) return prev.map((m) => (m.id === currentModule.id ? currentModule : m));
      return [currentModule, ...prev];
    });
  };

  const duplicateModule = async (m) => {
    const copy = {
      ...m,
      id: crypto.randomUUID(),
      createdAt: new Date().toLocaleDateString("id-ID"),
    };
    const { id, ...data } = copy;
    const { error } = await supabase.from("modules").insert({ id, owner_id: session.user.id, data });
    if (error) {
      alert("Gagal menduplikasi modul: " + error.message);
      return;
    }
    setModules((prev) => [copy, ...prev]);
  };

  const deleteModule = async (m) => {
    const { error } = await supabase.from("modules").delete().eq("id", m.id);
    if (error) {
      alert("Gagal menghapus modul: " + error.message);
      return;
    }
    setModules((prev) => prev.filter((x) => x.id !== m.id));
  };

  const createTemplate = async (tpl) => {
    const { error } = await supabase
      .from("templates")
      .insert({ id: tpl.id, created_by: session.user.id, name: tpl.name, rows: tpl.rows });
    if (error) {
      alert("Gagal menyimpan template: " + error.message);
      return;
    }
    setTemplates((prev) => [tpl, ...prev]);
  };

  const deleteTemplate = async (tpl) => {
    const { error } = await supabase.from("templates").delete().eq("id", tpl.id);
    if (error) {
      alert("Gagal menghapus template: " + error.message);
      return;
    }
    setTemplates((prev) => prev.filter((t) => t.id !== tpl.id));
  };

  const handleApplyAI = (key, value) => {
    setCurrentModule((prev) => ({
      ...prev,
      generated: { ...prev.generated, [key]: value },
    }));
    setActiveField((prev) => (prev ? { ...prev, value } : prev));
  };

  const showAIPanel = activeMenu === "buatModul" && currentModule;

  return (
    <div className="h-screen w-full flex bg-slate-50 font-sans overflow-hidden">
      <Sidebar active={activeMenu} onSelect={setActiveMenu} user={user} />

      {activeMenu === "dashboard" && (
        <div className="flex-1 overflow-y-auto">
          <Dashboard modules={modules} onNewModule={startNewModule} />
        </div>
      )}

      {activeMenu === "buatModul" && currentModule && (
        <BuatModul
          mod={currentModule}
          setMod={setCurrentModule}
          onFieldFocus={setActiveField}
          onSaveModule={saveCurrentModule}
          onExit={() => setActiveMenu("dashboard")}
          templates={templates}
        />
      )}

      {activeMenu === "buatModul" && !currentModule && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-slate-500 mb-3">Belum ada modul yang sedang dibuat.</p>
            <PrimaryButton icon={FilePlus} onClick={startNewModule}>
              Buat Modul Baru
            </PrimaryButton>
          </div>
        </div>
      )}

      {activeMenu === "riwayat" && (
        <div className="flex-1 overflow-y-auto">
          <Riwayat
            modules={modules}
            onEdit={editModule}
            onDuplicate={duplicateModule}
            onDelete={deleteModule}
          />
        </div>
      )}

      {activeMenu === "template" && (
        <div className="flex-1 overflow-y-auto">
          <TemplatePage
            templates={templates}
            onCreateTemplate={createTemplate}
            onDeleteTemplate={deleteTemplate}
          />
        </div>
      )}

      {activeMenu === "pengaturan" && (
        <div className="flex-1 overflow-y-auto">
          <Pengaturan />
        </div>
      )}

      {activeMenu === "kelolaPengguna" && user.role === "master" && (
        <div className="flex-1 overflow-y-auto">
          <KelolaPengguna user={user} />
        </div>
      )}

      {showAIPanel && (
        <AIPanel activeField={activeField} onApply={handleApplyAI} moduleCtx={currentModule} />
      )}
    </div>
  );
}
