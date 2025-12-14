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
const TG_API = `https://api.telegram.org/bot${process.env.TG_TOKEN}`;

// ===== TELEGRAM BUTTONS =====
const mainKeyboard = {
  inline_keyboard: [
    [
      { text: "ℹ️ Как это работает", callback_data: "how_it_works" }
    ],
    [
      { text: "💳 Купить код — 100₽", callback_data: "buy_code" }
    ]
  ]
};
app.post("/telegram", async (req, res) => {
  const update = req.body;
  console.log("📩 TG UPDATE:", JSON.stringify(update));

  // ===== /start =====
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
            "🎁 Добро пожаловать!\n\n" +
            "Здесь ты можешь купить код и получить подарок 🎄",
          reply_markup: mainKeyboard
        })
      });

      return res.sendStatus(200);
    }
  }

  // ===== CALLBACK BUTTONS =====
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message.chat.id;
    const data = cb.data;

    // ОБЯЗАТЕЛЬНО подтверждаем callback
    await fetch(`${TG_API}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: cb.id
      })
    });

    // ℹ️ КАК ЭТО РАБОТАЕТ
    if (data === "how_it_works") {
      await fetch(`${TG_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text:
            "📦 Как это работает:\n\n" +
            "1️⃣ Ты покупаешь код\n" +
            "2️⃣ Вводишь его на сайте\n" +
            "3️⃣ Получаешь подарок 🎁\n\n" +
            "Код одноразовый и действует только один раз."
        })
      });

      return res.sendStatus(200);
    }

    // 💳 КУПИТЬ КОД
    if (data === "buy_code") {
      const payUrl =
        "https://yoomoney.ru/quickpay/confirm.xml" +
        "?receiver=" + process.env.YOOMONEY_WALLET +
        "&quickpay-form=shop" +
        "&targets=Подарочный+код" +
        "&paymentType=SB" +
        "&sum=100";

      await fetch(`${TG_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text:
            "💳 Для покупки кода перейдите по ссылке:\n\n" +
            payUrl
        })
      });

      return res.sendStatus(200);
    }
  }

  res.sendStatus(200);
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
