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
app.post("/tg", async (req, res) => {
  try {
    const update = req.body;
    console.log("📩 TG UPDATE:", JSON.stringify(update));

    if (!update.message && !update.callback_query) {
      return res.status(200).send("ok");
    }

    // ===== MESSAGE =====
    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text;

      if (text === "/start") {
        await fetch(`${TG_API}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text:
              "🎄 С наступающим Новым годом!\n\n" +
              "Здесь вы можете купить секретный ключ 🔑 и открыть свой подарок 🎁\n\n" +
              "Выберите действие 👇",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "ℹ️ Как это работает?", callback_data: "INFO" },
                ],
                [
                  { text: "🔑 Купить секретный ключ", callback_data: "BUY" },
                ],
              ],
            },
          }),
        });
      }
    }

    // ===== CALLBACKS =====
    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message.chat.id;

      // INFO
      if (cb.data === "INFO") {
        await fetch(`${TG_API}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text:
              "ℹ️ *Как это работает*\n\n" +
              "Вы покупаете секретный ключ 🔑 за 100 рублей.\n" +
              "Вводите его на сайте и открываете свой новогодний подарок 🎁\n\n" +
              "⚠️ Код одноразовый — после использования он сгорает 🔥",
            parse_mode: "Markdown",
          }),
        });
      }

if (cb.data === "BUY") {
  const paymentId = crypto.randomUUID();

  const payUrl =
    "https://yoomoney.ru/quickpay/confirm.xml" +
    "?receiver=" + process.env.YOOMONEY_WALLET +
    "&quickpay-form=button" +
    "&paymentType=AC" +
    "&sum=100" +
    "&label=" + paymentId;

  // сохраняем платёж
  await supabase.from("payments").insert({
    id: paymentId,
    tg_id: chatId,
    amount: 100,
    status: "pending",
  });

  // ❗ ГЛАВНОЕ — РЕДАКТИРУЕМ СООБЩЕНИЕ
  await fetch(`${TG_API}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: cb.message.message_id,
      text: "💳 Оплатите секретный ключ 👇",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "💰 Оплатить 100 ₽",
              url: payUrl,
            },
          ],
        ],
      },
    }),
  });

  // авто-сгорание через 5 минут
  setTimeout(async () => {
    await supabase
      .from("payments")
      .update({ status: "expired" })
      .eq("id", paymentId)
      .eq("status", "pending");
  }, 5 * 60 * 1000);
}

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
    const safeName = ${Date.now()}-${crypto.randomUUID()}.${ext};

    const { error: uploadError } = await supabase.storage
      .from("gift-files")
      .upload(safeName, req.file.buffer, {
        contentType: req.file.mimetype,
      });

    if (uploadError) throw uploadError;

    const code = crypto.randomUUID().slice(0, 8).toUpperCase();

    await supabase.from("gifts").insert({
      code,
      file_path: safeName,
      is_used: false,
    });

    res.json({ success: true, code });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ================== START ==================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});
