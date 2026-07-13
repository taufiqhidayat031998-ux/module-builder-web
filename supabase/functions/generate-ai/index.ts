// Supabase Edge Function: generate-ai
// Menjembatani permintaan dari aplikasi ke Anthropic API tanpa pernah
// mengekspos API key ke browser, DAN membatasi pemakaian harian per
// pengguna — penting karena situsnya terbuka gratis untuk siapa saja,
// sementara API Anthropic yang dipakai di baliknya berbayar.
//
// Deploy: supabase functions deploy generate-ai
// Set secret sekali: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Batas generate AI per pengguna per hari. Ubah sesuai kebutuhan/anggaran Anda.
const DAILY_LIMIT = 60;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { prompt, maxTokens } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "prompt wajib diisi" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Kenali siapa pengguna yang memanggil (lewat token login mereka),
    // supaya kuota dihitung per orang, bukan per aplikasi.
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_ANON_KEY"),
      { global: { headers: { Authorization: authHeader } } }
    );
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Sesi login tidak valid. Silakan masuk ulang." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const { data: usageRow } = await supabaseClient
      .from("ai_usage_daily")
      .select("count")
      .eq("user_id", user.id)
      .eq("day", today)
      .maybeSingle();
    const currentCount = usageRow?.count || 0;

    if (currentCount >= DAILY_LIMIT) {
      return new Response(
        JSON.stringify({
          error: `Batas pemakaian AI harian (${DAILY_LIMIT}x) sudah tercapai untuk akun Anda. Coba lagi besok.`,
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY belum di-set di Supabase secrets" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: Math.min(maxTokens || 1200, 4096),
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return new Response(JSON.stringify({ error: `Anthropic API error: ${errText}` }), {
        status: resp.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const text = (data.content || [])
      .map((c) => c.text || "")
      .join("\n")
      .trim();

    // Catat pemakaian setelah berhasil, supaya panggilan yang gagal tidak
    // ikut memotong kuota pengguna.
    await supabaseClient
      .from("ai_usage_daily")
      .upsert(
        { user_id: user.id, day: today, count: currentCount + 1 },
        { onConflict: "user_id,day" }
      );

    return new Response(JSON.stringify({ text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
