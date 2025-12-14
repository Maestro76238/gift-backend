import express from "express";
import cors from "cors";
import crypto from "crypto";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

// ===== ENV =====
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  TG_TOKEN,
  YOOMONEY_WALLET,
  YOOMONEY_SECRET,
  BASE_URL,
  PORT = 10000
} = process.env;

// ===== SUPABASE =====
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

// ===== TELEGRAM =====
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;

async function sendMessage(chatId, text, replyMarkup = null) {
  await fetch(`${TG_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: replyMarkup
    })
  });
}

// ===== HEALTH =====
app.get("/", (_, res) => {
  res.send("Backend OK ✅");
});

// ===== TELEGRAM WEBHOOK =====
app.post("/tg", async (req, res) => {
  try {
    const msg = req.body.message;
    if (!msg) return res.sendStatus(200);

    const chatId = msg.chat.id;
    const text = msg.text || "";

    // ===== /start =====
    if (text === "/start") {
      await sendMessage(chatId, "Добро пожаловать 👋", {
        keyboard: [
          [{ text: "ℹ️ Как это работает" }],
          [{ text: "💰 Купить код — 100₽" }]
        ],
        resize_keyboard: true
      });
    }

    // ===== INFO =====
    if (text === "ℹ️ Как это работает") {
      await sendMessage(
        chatId,
        "1️⃣ Покупаешь код\n2️⃣ Оплачиваешь\n3️⃣ Получаешь код\n4️⃣ Используешь один раз"
      );
    }

    // ===== BUY =====
    if (text === "💰 Купить код — 100₽") {
      const orderId = crypto.randomUUID();

      await supabase.from("orders").insert({
        id: orderId,
        tg_chat_id: chatId,
        status: "pending"
      });

      const payUrl =
        "https://yoomoney.ru/quickpay/confirm.xml" +
        "?receiver=" + YOOMONEY_WALLET +
        "&quickpay-form=button" +
        "&paymentType=AC" +
        "&sum=100" +
        "&label=" + orderId;

      await sendMessage(chatId, "💳 Оплатите заказ:", {
        inline_keyboard: [
          [{ text: "👉 Оплатить 100₽", url: payUrl }]
        ]
      });
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("TG ERROR:", e);
    res.sendStatus(200);
  }
});

// ===== AUTOCHECK PAYMENTS (каждые 20 сек) =====
setInterval(async () => {
  try {
    const { data: orders } = await supabase
      .from("orders")
      .select("*")
      .eq("status", "pending");

    for (const order of orders) {
      const resp = await fetch(
        `https://yoomoney.ru/api/operation-history`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${YOOMONEY_SECRET}`,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams({
            label: order.id,
            records: "1"
          })
        }
      );

      const json = await resp.json();
      const op = json.operations?.[0];

      if (op && op.status === "success") {
        // ===== GET FREE CODE =====
        const { data: gift } = await supabase
          .from("gifts")
          .select("*")
          .eq("is_used", false)
          .limit(1)
          .single();

        if (!gift) {
          await sendMessage(order.tg_chat_id, "❌ Коды закончились");
          continue;
        }

        // ===== MARK USED =====
        await supabase
          .from("gifts")
          .update({ is_used: true })
          .eq("id", gift.id);

        await supabase
          .from("orders")
          .update({ status: "paid" })
          .eq("id", order.id);

        // ===== SEND CODE =====
        await sendMessage(
          order.tg_chat_id,
          `🎁 Ваш код:\n\n${gift.code}\n\nОдноразовый ✅`
        );
      }
    }
  } catch (e) {
    console.error("PAY CHECK ERROR:", e);
  }
}, 20000);

// ===== START =====
app.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});
