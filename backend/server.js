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
    const safeName =
      Date.now() + "-" + crypto.randomUUID() + "." + ext;

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

/* ================= CHECK CODE ================= */
app.get("/api/check/:code", async (req, res) => {
  const code = req.params.code.toUpperCase();

  const { data } = await supabase
    .from("gifts")
    .select("*")
    .eq("code", code)
    .single();

  if (!data || data.is_used)
    return res.status(400).json({ error: "USED" });

  const { data: url } = supabase.storage
    .from("gift-files")
    .getPublicUrl(data.file_path);

  await supabase
    .from("gifts")
    .update({ is_used: true })
    .eq("code", code);

  res.json({ gift_url: url.publicUrl });
});

/* ================= TELEGRAM WEBHOOK ================= */
app.post("/telegram", async (req, res) => {
  const msg = req.body.message;
  if (!msg) return res.sendStatus(200);

  const chatId = msg.chat.id;
  const text = msg.text;

  if (text === "/start") {
    await tgSend(chatId, "🎁 Добро пожаловать!\n\nКупить код — 100₽");
    await tgButtons(chatId);
  }

  if (text === "🛒 Купить код") {
    const orderId = crypto.randomUUID();

    await supabase.from("orders").insert({
      id: orderId,
      tg_user_id: chatId,
      status: "pending",
    });

const payUrl = `https://yoomoney.ru/quickpay/quickpay-form.html
?quickpay-form=shop
&receiver=${process.env.YOOMONEY_WALLET}
&paymentType=AC
&sum=100
&targets=CODE
&label=${orderId}
&successURL=${encodeURIComponent(process.env.BASE_URL)}`.replace(/\n/g, "");

    await tgSend(chatId, `💳 Оплатите:\n${payUrl}`);
  }

  res.sendStatus(200);
});

/* ================= YOUMONEY WEBHOOK ================= */
app.post("/yoomoney", async (req, res) => {
  const { label, sha1_hash, withdraw_amount } = req.body;

  const hash = crypto
    .createHash("sha1")
    .update(
      `${req.body.notification_type}&${req.body.operation_id}&${withdraw_amount}&643&${req.body.datetime}&${req.body.sender}&${req.body.codepro}&${process.env.YOOMONEY_SECRET}&${label}`
    )
    .digest("hex");

  if (hash !== sha1_hash) return res.sendStatus(403);

  const { data: gift } = await supabase
    .from("gifts")
    .select("*")
    .eq("is_used", false)
    .limit(1)
    .single();

  await supabase
    .from("gifts")
    .update({ is_used: true })
    .eq("code", gift.code);

  await supabase
    .from("orders")
    .update({ status: "paid", gift_code: gift.code })
    .eq("id", label);

  const { data: order } = await supabase
    .from("orders")
    .select("tg_user_id")
    .eq("id", label)
    .single();

  await tgSend(order.tg_user_id, `🎉 Ваш код:\n${gift.code}`);

  res.send("OK");
});

/* ================= AUTO RESET ================= */
setInterval(async () => {
  const limit = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  await supabase
    .from("orders")
    .update({ status: "expired" })
    .eq("status", "pending")
    .lt("created_at", limit);
}, 10 * 60 * 1000);

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
app.listen(PORT, () => console.log("🚀 Server on", PORT));
