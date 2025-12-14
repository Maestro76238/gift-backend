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
app.use(express.urlencoded({ extended: true }));

/* ================= SUPABASE ================= */

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ================= MULTER ================= */

const upload = multer({ storage: multer.memoryStorage() });

/* ================= TELEGRAM ================= */

const TG_TOKEN = process.env.TG_TOKEN;
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;

async function sendTG(chatId, text, buttons = null) {
  await fetch(`${TG_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: buttons
        ? { inline_keyboard: buttons }
        : undefined,
    }),
  });
}

/* ================= HEALTH ================= */

app.get("/", (req, res) => {
  res.send("Backend alive ✅");
});

/* ================= ADMIN ================= */

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "upload.html"));
});

/* ================= UPLOAD GIFT ================= */

app.post("/api/create-gift", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file" });
    }

    const ext = req.file.originalname.split(".").pop();
    const safeName =
      Date.now() + "-" + crypto.randomUUID() + "." + ext;

    const { error: uploadError } = await supabase.storage
      .from("gift-files")
      .upload(safeName, req.file.buffer, {
        contentType: req.file.mimetype,
      });

    if (uploadError) {
      return res.status(500).json({ error: uploadError.message });
    }

    const code = crypto
      .randomUUID()
      .slice(0, 8)
      .toUpperCase();

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

/* ================= CHECK CODE ================= */

app.get("/api/check/:code", async (req, res) => {
  const code = req.params.code.toUpperCase();

  const { data, error } = await supabase
    .from("gifts")
    .select("*")
    .eq("code", code)
    .single();

  if (error || !data || data.is_used) {
    return res.status(404).json({ error: "Invalid or used" });
  }

  const { data: file } = supabase.storage
    .from("gift-files")
    .getPublicUrl(data.file_path);

  res.json({ gift_url: file.publicUrl });

  // помечаем использованным ПОСЛЕ выдачи
  await supabase
    .from("gifts")
    .update({ is_used: true })
    .eq("code", code);
});

/* ================= TELEGRAM WEBHOOK ================= */

app.post("/telegram", async (req, res) => {
  const msg = req.body.message;
  if (!msg) return res.send("OK");

  const chatId = msg.chat.id;
  const text = msg.text || "";

  if (text === "/start") {
    await sendTG(chatId, "🎁 Добро пожаловать!", [
      [{ text: "ℹ️ Как это работает", callback_data: "info" }],
      [{ text: "💳 Купить код — 100₽", callback_data: "buy" }],
    ]);
  }

  res.send("OK");
});

/* ================= CALLBACKS ================= */

app.post("/telegram-callback", async (req, res) => {
  const q = req.body.callback_query;
  if (!q) return res.send("OK");

  const chatId = q.message.chat.id;

  if (q.data === "info") {
    await sendTG(
      chatId,
      "1️⃣ Оплачиваешь\n2️⃣ Получаешь код\n3️⃣ Вводишь код и получаешь подарок 🎁"
    );
  }

  if (q.data === "buy") {
    const orderId = crypto.randomUUID();

    await supabase.from("orders").insert({
      id: orderId,
      tg_user_id: chatId,
      status: "pending",
    });

    const payUrl =
      "https://yoomoney.ru/quickpay/confirm.xml" +
      `?receiver=${process.env.YOOMONEY_WALLET}` +
      `&label=${orderId}` +
      "&quickpay-form=button" +
      "&paymentType=AC" +
      "&sum=100";

    await sendTG(chatId, "💳 Оплати по кнопке:", [
      [{ text: "Оплатить 100₽", url: payUrl }],
      [{ text: "❌ Отмена", callback_data: "cancel" }],
    ]);
  }

  if (q.data === "cancel") {
    await sendTG(chatId, "❌ Заказ отменён");
  }

  res.send("OK");
});

/* ================= YOOMONEY WEBHOOK ================= */

app.post("/yoomoney", async (req, res) => {
  const { label } = req.body;

  const { data: order } = await supabase
    .from("orders")
    .select("*")
    .eq("id", label)
    .single();

  if (!order || order.status === "paid") {
    return res.send("OK");
  }

  const code = crypto
    .randomUUID()
    .slice(0, 8)
    .toUpperCase();

  await supabase.from("gifts").insert({
    code,
    is_used: false,
  });

  await supabase
    .from("orders")
    .update({ status: "paid" })
    .eq("id", label);

  await sendTG(
    order.tg_user_id,
    `🎉 Оплата прошла!\nВаш код: ${code}`
  );

  res.send("OK");
});

/* ================= START ================= */

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});
