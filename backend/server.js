import express from "express";
import cors from "cors";
import multer from "multer";
import crypto from "crypto";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// ================== SUPABASE ==================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ================== MULTER ==================
const upload = multer({ storage: multer.memoryStorage() });

// ================== TELEGRAM ==================
const TG_TOKEN = process.env.TG_TOKEN;
const ADMIN_TG_ID = process.env.ADMIN_TG_ID;
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;

// ================== HEALTH ==================
app.get("/", (_, res) => res.send("Backend is alive ✅"));

// ================== ADMIN PANEL ==================
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "upload.html"));
});

// ================== CREATE GIFT ==================
app.post("/api/create-gift", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file" });

    const ext = req.file.originalname.split(".").pop();
    const safeName = `${Date.now()}-${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("gift-files")
      .upload(safeName, req.file.buffer, { contentType: req.file.mimetype });

    if (uploadError) throw uploadError;

    const code = crypto.randomUUID().slice(0, 8).toUpperCase();

    await supabase.from("gifts").insert({
      code,
      file_path: safeName,
      is_used: false,
    });

    res.json({ success: true, code });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ================== GET GIFT ==================
app.get("/api/get-gift/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();

    const { data, error } = await supabase
      .from("gifts")
      .select("*")
      .eq("code", code)
      .single();

    if (!data || error) {
      return res.status(404).json({ error: "Invalid code" });
    }

    if (data.is_used) {
      return res.status(400).json({ error: "Code already used" });
    }

    const { data: signed } = await supabase.storage
      .from("gift-files")
      .createSignedUrl(data.file_path, 60 * 60 * 24);

    await supabase.from("gifts").update({ is_used: true }).eq("id", data.id);

    res.json({ gift_url: signed.signedUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ================== TELEGRAM WEBHOOK ==================
console.log("📩 TG UPDATE:", JSON.stringify(req.body));

app.post("/telegram", async (req, res) => {

  try {
    const msg = req.body.message;
    if (!msg) return res.sendStatus(200);

    const chatId = msg.chat.id;
    const text = msg.text || "";

    // ===== START =====
    if (text === "/start") {
      await sendTG(chatId,
        "🎄 С наступающим Новым годом!\n\n" +
        "Здесь вы можете купить секретный ключ 🔑 и открыть свой подарок 🎁"
      );

      await sendButtons(chatId, "Выберите действие 👇", [
        [{ text: "ℹ️ Как это работает?", callback_data: "INFO" }],
        [{ text: "🔑 Купить секретный ключ", callback_data: "BUY" }],
      ]);
    }
  } catch (e) {
    console.error("TG ERROR:", e);
  }
  res.sendStatus(200);
});

// ================== CALLBACKS ==================
app.post("/telegram-callback", async (req, res) => {
  const cb = req.body.callback_query;
  if (!cb) return res.sendStatus(200);

  const chatId = cb.message.chat.id;
  const data = cb.data;

  if (data === "INFO") {
    await sendTG(chatId,
      "Этот бот позволяет купить секретный ключ 🔑 за 100₽.\n\n" +
      "После ввода кода на сайте вы откроете подарок 🎁\n\n" +
      "⚠️ Код одноразовый и сгорает после использования."
    );
  }

  if (data === "BUY") {
    const label = crypto.randomUUID();

    const payUrl =
      "https://yoomoney.ru/quickpay/confirm.xml" +
      "?receiver=" + process.env.YOOMONEY_WALLET +
      "&quickpay-form=shop" +
      "&targets=Секретный ключ" +
      "&paymentType=AC" +
      "&sum=100" +
      "&label=" + label;

    await supabase.from("payments").insert({
      label,
      chat_id: chatId,
      status: "pending",
      created_at: new Date(),
    });

    await sendButtons(chatId, "Оплатите ключ 💳", [
      [{ text: "💰 Перейти к оплате", url: payUrl }],
    ]);
  }

  res.sendStatus(200);
});

// ================== YOUMONEY WEBHOOK ==================
app.post("/yoomoney", async (req, res) => {
  const { label } = req.body;

  const { data } = await supabase
    .from("payments")
    .select("*")
    .eq("label", label)
    .single();

  if (!data) return res.sendStatus(200);

  const code = crypto.randomUUID().slice(0, 8).toUpperCase();

  await supabase.from("gifts").insert({
    code,
    is_used: false,
  });

  await supabase
    .from("payments")
    .update({ status: "paid", code })
    .eq("label", label);

  await sendTG(data.chat_id, `✅ Оплата успешна!\n\nВаш код: ${code}`);
  await sendTG(ADMIN_TG_ID, `💰 Покупка кода\nКод: ${code}`);

  res.sendStatus(200);
});

// ================== HELPERS ==================
async function sendTG(chatId, text) {
  await fetch(`${TG_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function sendButtons(chatId, text, buttons) {
  await fetch(`${TG_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: { inline_keyboard: buttons },
    }),
  });
}

// ================== START ==================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});
