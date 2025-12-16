import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";




// ================== ENV ==================
const {
  PORT,
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ SUPABASE ENV MISSING");
  process.exit(1);
}

// ================== INIT APP ==================
const app = express();
app.use(cors());
app.use(express.json());

// ================== TELEGRAM SAFE SEND ==================
async function tgSend(chatId, text) {
  if (!TG_TOKEN) {
    console.warn("⚠️ TG_TOKEN not set");
    return;
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
        }),
      }
    );

    if (!res.ok) {
      const t = await res.text();
      console.error("❌ TG API ERROR:", t);
    }
  } catch (e) {
    console.error("❌ TG SEND FAILED (IGNORED):", e.message);
  }
}
// ================== TG TEST ==================
app.get("/tg-test", async (req, res) => {
  await tgSend(ADMIN_TG_ID, "✅ Telegram test OK");
  res.json({ ok: true });
});

// ================== SUPABASE ==================
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY
);


// ================== HEALTH ==================
app.get("/", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// ================== START ==================
const LISTEN_PORT = PORT || 10000;

app.listen(LISTEN_PORT, () => {
  console.log(`🚀 Server started on port ${LISTEN_PORT}`);
});