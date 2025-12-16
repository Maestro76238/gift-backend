import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const TG_TOKEN = process.env.TG_TOKEN;
const ADMIN_TG_ID = process.env.ADMIN_TG_ID;

// ================== INIT APP ==================
const app = express();
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST","OPTIONS"],
    allowedHeaders: ["Content-Type","Authorization"],
  })
);
app.options("*", cors());
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
      return res.send("OK");
    }

    const chatId = message.chat.id;
    const text = message.text.trim();

    if (text === "/start") {
      await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: "🎁 Добро пожаловать!\n\nВведите код на сайте или получите подарок 🎉",
        }),
      });
    }
    res.send("OK");
  } catch (e) {
    console.error("❌ TG HANDLER ERROR:", e);
    res.send("OK");
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

//===========GET===================
app.get("/api/get-gift/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();

    const { data: gift, error } = await supabase
      .from("gifts")
      .select("code, file_url, is_used")
      .eq("code", code)
      .single();

    if (error || !gift) {
      return res.status(404).json({ error: "CODE_NOT_FOUND" });
    }

    if (gift.is_used) {
      return res.status(410).json({ error: "CODE_USED" });
    }

    if (!gift.file_url) {
      return res.status(409).json({ error: "FILE_NOT_ATTACHED" });
    }

    res.json({
      gift_url: gift.file_url
    });

  } catch (e) {
    console.error("GET GIFT ERROR:", e);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});
// ================== USE GIFT ==================
app.post("/api/use-gift/:code", async (req, res) => {
  const { code } = req.params;

  const { error } = await supabase
    .from("gifts")
    .update({ used: true })
    .eq("code", code)
    .eq("used", false)
    .select();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (!data || data.lenght === 0) {
    return res.status(404).json ({ error: "Code not found or already used" });
  }

  res.json({ success: true });
});

// ================== START ==================
const LISTEN_PORT = process.env.PORT || 10000;

app.listen(LISTEN_PORT, () => {
  console.log(`🚀 Server running on port ${LISTEN_PORT}`);
});