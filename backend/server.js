import express from "express";
import fetch from "node-fetch";
import TelegramBot from "node-telegram-bot-api";
import crypto from "crypto";
import multer from "multer";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

// ================== ENV CHECK ==================
const {
  TG_TOKEN,
  ADMIN_TG_ID,
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  YOOKASSA_SHOP_ID,
  YOOKASSA_SECRET_KEY,
  PORT
} = process.env;

if (!TG_TOKEN) {
  console.error("❌ TG_TOKEN missing");
  process.exit(1);
}

// ================== INIT ==================
const app = express();
app.use(cors());
app.use(express.json());

console.log("SUPABASE_URL:", !!process.env.SUPABASE_URL);
console.log("SUPABASE_SERVICE_KEY:", !!process.env.SUPABASE_SERVICE_KEY);
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY
);

const bot = new TelegramBot(TG_TOKEN, { polling: true });

bot.on("polling_error", e => console.error("TG ERROR:", e));

// ================== TG HELPERS ==================
async function tgSend(chatId, text) {
  if (!process.env.TG_TOKEN) {
    console.warn("⚠️ TG_TOKEN not set");
    return;
  }

  try {
    const res = await fetch(
      https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML"
        }),
        timeout: 8000 // 🔥 обязательно
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("❌ TG API ERROR:", errText);
    }
  } catch (err) {
    // 🔥 ВАЖНО: НЕ THROW
    console.error("❌ TG SEND FAILED (IGNORED):", err.message);
  }
}

// ================== TG BOT ==================
bot.onText(/\/start/, async msg => {
  await tgSend(
    msg.chat.id,
    "🎄 <b>С наступающим Новым годом!</b>\n\nЗдесь вы можете купить секретный ключ 🔑",
    {
      inline_keyboard: [
        [{ text: "ℹ️ Как это работает?", callback_data: "INFO" }],
        [{ text: "🔑 Купить ключ", callback_data: "BUY" }]
      ]
    }
  );
});

bot.on("callback_query", async q => {
  const chatId = q.message.chat.id;

  if (q.data === "INFO") {
    await tgSend(chatId, "Вы покупаете код, вводите его на сайте и получаете подарок 🎁");
  }

  if (q.data === "BUY") {
    const { data: order } = await supabase
      .from("orders")
      .insert({ tg_id: chatId, status: "pending" })
      .select()
      .single();

    const payUrl =
      `https://yoomoney.ru/quickpay/confirm.xml?receiver=${YOOKASSA_SHOP_ID}` +
      `&label=${order.id}` +
      `&sum=1` +
      `&quickpay-form=shop` +
      `&paymentType=AC`;

    await tgSend(chatId, "💳 Оплатите по кнопке", {
      inline_keyboard: [[{ text: "Оплатить", url: payUrl }]]
    });
  }
});

// ================== YOOKASSA WEBHOOK ==================
app.post("/yookassa", async (req, res) => {
  try {
    console.log("📩 YOOKASSA:", req.body);

    if (req.body.event !== "payment.succeeded") {
      return res.send("ok");
    }

    const payment = req.body.object;
    const orderId = payment.metadata?.order_id;
    const tgId = payment.metadata?.tg_id;

    const code = crypto.randomUUID().slice(0, 8).toUpperCase();

    await supabase.from("gifts").insert({
      code,
      is_used: false
    });

    await supabase.from("orders")
      .update({ status: "paid" })
      .eq("id", orderId);

    await tgSend(tgId, `✅ <b>Оплата прошла!</b>\n\nВаш код:\n<code>${code}</code>`);
    await tgSend(ADMIN_TG_ID, `💰 Покупка\nTG: ${tgId}\nКод: ${code}`);

    res.send("ok");
  } catch (e) {
    console.error("YOOKASSA ERROR:", e);
    res.send("ok");
  }
});

// ================== GIFT CHECK ==================
app.get("/api/get-gift/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();

    const { data } = await supabase
      .from("gifts")
      .select("*")
      .eq("code", code)
      .single();

    if (!data || data.is_used) {
      return res.status(400).json({ error: "Invalid code" });
    }

    res.json({ gift_url: data.file_path || null });
  } catch (e) {
    console.error("GET GIFT ERROR:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ================== USE GIFT ==================
app.post("/api/use-gift/:code", async (req, res) => {
  await supabase
    .from("gifts")
    .update({ is_used: true })
    .eq("code", req.params.code.toUpperCase());

  res.json({ ok: true });
});

// ================== ADMIN ==================
function checkAdmin(req, res, next) {
  if (String(req.query.tg_id) !== String(ADMIN_TG_ID)) {
    return res.status(403).send("Forbidden");
  }
  next();
}

app.get("/admin", checkAdmin, async (req, res) => {
  const { data: gifts = [] } = await supabase.from("gifts").select("*");
  res.send(`
    <h1>Admin</h1>
    <table border="1">
      <tr><th>Code</th><th>Used</th></tr>
      ${gifts.map(g => `<tr><td>${g.code}</td><td>${g.is_used}</td></tr>`).join("")}
    </table>
  `);
});

// ================== START ==================
app.listen(PORT || 10000, () =>
  console.log("🚀 Server started")
);
