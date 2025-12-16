import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const TG_TOKEN = process.env.TG_TOKEN;
const ADMIN_TG_ID = process.env.ADMIN_TG_ID;

// ================== INIT APP ==================
const app = express();
app.use(cors());
app.use(express.json());

// ================= SUPABASE INIT =================
let supabase = null;

try {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("❌ SUPABASE ENV NOT SET");
  } else {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
    console.log("✅ SUPABASE CONNECTED");
  }
} catch (e) {
  console.error("❌ SUPABASE INIT ERROR:", e);
}

// ================== TELEGRAM WEBHOOK ==================
app.post("/telegram", async (req, res) => {
  try {
    const update = req.body;
    console.log("📩 TG UPDATE:", JSON.stringify(update, null, 2));

    const message = update.message;
    if (!message || !message.text) {
      return res.sendStatus(200);
    }

    const chatId = message.chat.id;
    const text = message.text.trim();

    if (text === "/start") {
      await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: "🎁 Добро пожаловать!\n\nВведите код на сайте или получите подарок 🎉",
        }),
      });
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("❌ TG HANDLER ERROR:", e);
    res.sendStatus(200);
  }
});

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


// ================== HEALTH ==================
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// ================== START ==================
const LISTEN_PORT = process.env.PORT || 10000;

app.listen(LISTEN_PORT, () => {
  console.log(`🚀 Server running on port ${LISTEN_PORT}`);
});