import express from "express";
import cors from "cors";
import crypto from "crypto";
import fetch from "node-fetch";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

/* ================= SUPABASE ================= */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ================= TELEGRAM ================= */
const TG_TOKEN = process.env.TG_TOKEN;
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;

/* ================= MULTER ================= */
const upload = multer({ storage: multer.memoryStorage() });

/* ================= HEALTH ================= */
app.get("/", (_, res) => res.send("OK"));

/* ================= ADMIN ================= */
app.get("/admin", (_, res) => {
  res.sendFile(path.join(__dirname, "upload.html"));
});

/* ================= CREATE GIFT ================= */
app.post("/api/create-gift", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "NO FILE" });

    const ext = req.file.originalname.split(".").pop();
    const safeName = `${Date.now()}-${crypto.randomUUID()}.${ext}`;

    await supabase.storage
      .from("gift-files")
      .upload(safeName, req.file.buffer, {
        contentType: req.file.mimetype,
      });

    const code = crypto.randomUUID().slice(0, 8).toUpperCase();

    await supabase.from("gifts").insert({
      code,
      file_path: safeName,
      is_used: false,
    });

    res.json({ code });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ================= CHECK CODE (БЕЗ СПИСАНИЯ) ================= */
app.get("/api/check/:code", async (req, res) => {
  const code = req.params.code.toUpperCase();

  const { data, error } = await supabase
    .from("gifts")
    .select("*")
    .eq("code", code)
    .single();

  if (error || !data)
    return res.status(404).json({ error: "INVALID" });

  if (data.is_used)
    return res.status(400).json({ error: "USED" });

  res.json({ ok: true });
});

/* ================= DOWNLOAD (СПИСАНИЕ ТУТ) ================= */
app.get("/api/download/:code", async (req, res) => {
  const code = req.params.code.toUpperCase();

  const { data } = await supabase
    .from("gifts")
    .select("*")
    .eq("code", code)
    .single();

  if (!data || data.is_used)
    return res.status(400).send("USED");

  const { data: signed } = await supabase.storage
    .from("gift-files")
    .createSignedUrl(data.file_path, 60);

  await supabase
    .from("gifts")
    .update({ is_used: true })
    .eq("code", code);

  res.redirect(signed.signedUrl);
});

/* ================= TELEGRAM ================= */
app.post("/telegram", async (req, res) => {
  const msg = req.body.message;
  if (!msg) return res.sendStatus(200);

  const chatId = msg.chat.id;
  const text = msg.text;

  if (text === "/start") {
    await tgSend(chatId, "🎁 Добро пожаловать!\nКод — 100₽");
    await tgButtons(chatId);
  }

  if (text === "🛒 Купить код") {
    const orderId = crypto.randomUUID();

    await supabase.from("orders").insert({
      id: orderId,
      tg_user_id: chatId,
      status: "pending",
    });

    const payUrl =
      "https://yoomoney.ru/quickpay/quickpay-form.html" +
      "?quickpay-form=shop" +
      `&receiver=${process.env.YOOMONEY_WALLET}` +
      "&paymentType=AC" +
      "&sum=100" +
      "&targets=GiftCode" +
      `&label=${orderId}`;

    await tgSend(chatId, `💳 Оплатите:\n${payUrl}`);
  }

  res.sendStatus(200);
});

/* ================= HELPERS ================= */
async function tgSend(chatId, text) {
  await fetch(`${TG_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function tgButtons(chatId) {
  await fetch(`${TG_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: "Выберите:",
      reply_markup: {
        keyboard: [[{ text: "🛒 Купить код" }]],
        resize_keyboard: true,
      },
    }),
  });
}

/* ================= START ================= */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("🚀 Server running", PORT));
