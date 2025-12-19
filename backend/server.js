import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import cors from "cors";

const app = express();

app.use(cors({
  origin: [
    "https://gift-frontend-poth.onrender.com",
    "http://localhost:3000"
  ],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());

// ================= SUPABASE =================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

console.log("✅ SUPABASE CONNECTED");
const userState ={};

// ================= TELEGRAM =================
async function sendTG(chatId, text, options = {}) {
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...options,
      }),
    }
  );
  return res.json();
}
async function deleteTG(chatId, messageId) {
  if (!messageId) return;

  try {
    await fetch(
      `https://api.telegram.org/bot${process.env.TG_TOKEN}/deleteMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
        }),
      }
    );
  } catch (e) {
    console.error("DELETE MESSAGE ERROR:", e);
  }
}

async function showMainMenu(tgId) {
  // удалить предыдущее сообщение
  if (userState[tgId]?.lastMessageId) {
    await deleteTG(tgId, userState[tgId].lastMessageId);
  }

  const msg = await sendTG(
    tgId,
    "👋 Добро пожаловать!\n\nВыберите действие:",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📖 FAQ", url: "https://telegra.ph/FAQ-12-16-21" }],
          [{ text: "🔑 Купить ключ", callback_data: "BUY_KEY" }],
          [{ text: "📊 Статистика", callback_data: "STATS" }],
        ],
      },
    }
  );

  userState[tgId] = {
    step: "MAIN_MENU",
    lastMessageId: msg.message_id,
  };
}
//=============================================================================================================================================
//==========admins==============
async function notifyAdmin(text) {
  console.log("📣 NOTIFY ADMIN:", text);

  const res = await fetch(
    `https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.ADMIN_TG_ID,
        text,
        parse_mode: "HTML",
      }),
    }
  );

  const data = await res.json();
  console.log("📨 ADMIN RESULT:", data);
}
// ================= BUSINESS LOGIC =================

// ---------- RESERVE ----------
async function reserveGift(tgUserId) {
  const { data: gift, error } = await supabase
    .from("gifts")
    .select("*")
    .eq("status", "free")
    .eq("type", "normal")
    .limit(1)
    .single();

  if (error || !gift) return null;

  await supabase
    .from("gifts")
    .update({
      status: "reserved",
      reserved: true,
      reserved_at: new Date().toISOString(),
      tg_user_id: tgUserId,
    })
    .eq("id", gift.id);

  return gift;
}

// ---------- CANCEL ----------
async function cancelReserve(giftId) {
  await supabase
    .from("gifts")
    .update({
      status: "free",
      reserved: false,
      reserved_at: null,
      tg_user_id: null,
      payment_id: null,
    })
    .eq("id", giftId)
    .eq("status", "reserved");
}


//=========create payment=============
async function createPayment(giftId, tgUserId) {
  const response = await fetch("https://api.yookassa.ru/v3/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotence-Key": crypto.randomUUID(),
      Authorization:
        "Basic " +
        Buffer.from(
          process.env.YOOKASSA_SHOP_ID +
            ":" +
            process.env.YOOKASSA_SECRET_KEY
        ).toString("base64"),
    },
    body: JSON.stringify({
      amount: {
        value: "100.00",
        currency: "RUB",
      },
      capture: true,
      confirmation: {
        type: "redirect",
        return_url: "https://t.me/gift_celler_bot",
      },
      description: "Секретный подарок",
      metadata: {
        gift_id: giftId,
        tg_user_id: tgUserId,
      },
    }),
  });

  const payment = await response.json();

  await supabase
    .from("gifts")
    .update({
      payment_id: payment.id,
      status: "waiting_payment",
    })
    .eq("id", giftId);

  return payment;
}

// ---------- CONFIRM PAYMENT ----------
async function confirmPayment({ giftId, paymentId }) {
  const { data, error } = await supabase
    .from("gifts")
    .update({
      status: "paid",
      payment_id: paymentId,
    })
    .eq("id", giftId)
    .eq("status", "reserved")
    .select("*")
    .single();

  if (error || !data) return null;
  return data;
}

// ---------- CHECK ----------
app.get("/api/check-gift/:code", async (req, res) => {
  const code = req.params.code.toUpperCase();

  const { data, error } = await supabase
    .from("gifts")
    .select("id, code, file_url, is_used, type")
    .eq("code", code)
    .eq("is_used", false)
    .limit(1)
    .maybeSingle();

  if (error) {
    return res.status(500).json({ ok: false });
  }

  if (!data) {
    return res.status(404).json({
      ok: false,
      message: "Код неверный или уже использованный",
    });
  }

  // 🔔 УВЕДОМЛЕНИЕ АДМИНУ О ПРОВЕРКЕ КОДА
  try {
    await sendTG(
      process.env.ADMIN_TG_ID,
      `🔓 <b>Код активирован</b>\n\n` +
        `🔑 Код: <code>${data.code}</code>\n` +
        `🎁 Тип: <b>${data.type}</b>\n` +
        `🕒 Время: ${new Date().toLocaleString("ru-RU")}`,
      { parse_mode: "HTML" }
    );
  } catch (e) {
    console.error("❌ ADMIN NOTIFY ERROR:", e);
  }

  return res.json({
    ok: true,
    gift: data,
  });
});
//=======STATS=============
app.get("/api/stats", async (req, res) => {
  try {
    // обычные коды
    const { count: normal_left } = await supabase
      .from("gifts")
      .select("*", { count: "exact", head: true })
      .eq("type", "normal")
      .eq("status", "free");

    // всего обычных
    const { count: normal_total } = await supabase
      .from("gifts")
      .select("*", { count: "exact", head: true })
      .eq("type", "normal");

    // VIP — найден или нет
    const { data: vip_used } = await supabase
      .from("gifts")
      .select("id")
      .eq("type", "vip")
      .eq("status", "used")
      .limit(1);

    return res.json({
      normal_left,
      normal_total,
      vip_found: vip_used.length > 0,
    });
  } catch (e) {
    console.error("STATS API ERROR:", e);
    return res.status(500).json({ error: true });
  }
});
// ===== USE GIFT (SITE) =====
app.post("/api/use-gift/:code", async (req, res) => {
  const code = req.params.code.toUpperCase();

  const { data, error } = await supabase
    .from("gifts")
    .update({
      is_used: true,
      used_at: new Date().toISOString(),
    })
    .eq("code", code)
    .eq("is_used", false)
    .select()
    .maybeSingle();

   await notifyAdmin(
     `🎁 <b>Код использован</b>\n\n` +
     `🔑 Код: ${code}\n` +
     `👤 TG ID: ${gift.tgUserId || "—"}`
   );

  if (error) {
    return res.status(500).json({ ok: false });
  }

  if (!data) {
    return res.status(400).json({
      ok: false,
      message: "Код уже использован",
    });
  }

  return res.json({ ok: true });
});

// ================= ROUTES =================

// ----- TELEGRAM -----
app.post("/telegram-webhook", async (req, res) => {
  try {
    const update = req.body;

    // ===== /start =====
    if (update.message?.text === "/start") {
      await sendTG(
        update.message.chat.id,
        `🎁 НОВОГОДНЯЯ ИГРА НА УДАЧУ

Каждый код — шанс получить 💎 VIP-билет
на участие в розыгрыше 💰 100 000 ₽

🔑 Код уникален
⏳ Количество ограничено
🎯 Победитель будет выбран 31 декабря

Выберите действие 👇`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "📖 FAQ", url: "https://telegra.ph/FAQ-12-16-21" }],
              [{ text: "📊 Статистика", callback_data: "STATS" }],
              [{ text: "🔑 Купить ключ", callback_data: "BUY_KEY" }],
            ],
          },
        }
      );

      return res.sendStatus(200);
    }

    // ===== CALLBACK =====
    if (update.callback_query) {
      const tgId = update.callback_query.from.id;
      const chatId = tgId;
      const data = update.callback_query.data;

      // убрать "часики" у кнопки
      await fetch(
        `https://api.telegram.org/bot${process.env.TG_TOKEN}/answerCallbackQuery`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callback_query_id: update.callback_query.id,
          }),
        }
      );

      // ===== ТЕХРАБОТЫ =====
      if (
        process.env.MAINTENANCE_MODE === "true" &&
        data === "BUY_KEY"
      ) {
        await sendTG(
          chatId,
          "🛠 Покупки временно недоступны.\n\nВыгружаем новые коды, ожидайте ⏳"
        );
        return res.sendStatus(200);
      }

      // ===== СТАТИСТИКА =====
      if (data === "STATS") {
        const { data: stats } = await supabase
          .from("gifts")
          .select("id", { count: "exact", head: true })
          .eq("is_used", false)
          .eq("reserved", false)
          .eq("type", "normal");

        const text = `📊 <b>Статистика</b>

🎁 Осталось кодов: <b>${stats?.count ?? 0}</b>

💎 VIP-билет:
${stats?.count > 0 ? "🎯 Всё ещё в игре" : "❌ Уже найден"}`;

        await sendTG(chatId, text, { parse_mode: "HTML" });
        return res.sendStatus(200);
      }

      // ===== ПОКУПКА =====
      if (data === "BUY_KEY") {
        const gift = await reserveGift(tgId);

        if (!gift) {
          await sendTG(tgId, "❌ Коды закончились");
          return res.sendStatus(200);
        }

        const payment = await createPayment(gift.id, tgId);

        await sendTG(
          tgId,
          "💳 Оплатите ключ и получите свой шанс 👇",
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "💳 Оплатить 100 ₽",
                    url: payment.confirmation.confirmation_url,
                  },
                ],
                [
                  {
                    text: "❌ Отмена",
                    callback_data: `CANCEL:${gift.id}`,
                  },
                  {
                    text: "⬅️ Назад",
                    callback_data: "BACK",
                  },
                ],
              ],
            },
          }
        );

        return res.sendStatus(200);
      }

      // ===== ОТМЕНА =====
      if (data.startsWith("CANCEL:")) {
        const giftId = data.split(":")[1];
        await cancelReserve(giftId);
        await sendTG(tgId, "❌ Оплата отменена, код возвращён");
        return res.sendStatus(200);
      }

      // ===== НАЗАД =====
      if (data === "BACK") {
        await sendTG(
          chatId,
          "👋 Выберите действие 👇",
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "📖 FAQ", url: "https://telegra.ph/FAQ-12-16-21" }],
                [{ text: "📊 Статистика", callback_data: "STATS" }],
                [{ text: "🔑 Купить ключ", callback_data: "BUY_KEY" }],
              ],
            },
          }
        );
        return res.sendStatus(200);
      }
    }

    return res.sendStatus(200);
  } catch (e) {
    console.error("TG WEBHOOK ERROR:", e);
    return res.sendStatus(200);
  }
});


// ===========YOOKASSA==========
app.post("/yookassa-webhook", async (req, res) => {
  try {
    const event = req.body;

    console.log("💳 YOOKASSA EVENT:", event.event);

    if (event.event === "payment.succeeded") {
      const payment = event.object;
      const giftId = payment.metadata.gift_id;
      const tgUserId = payment.metadata.tg_user_id;

      const { data: gift } = await supabase
        .from("gifts")
        .update({
          status: "paid",
          reserved: false,
          reserved_at: null
        })
        .eq("id", giftId)
        .eq("status", "waiting_payment")
        .select("*")
        .single();

      if (!gift) return res.sendStatus(200);
      

      await sendTG(
        tgUserId,
         `🎉 <b>Оплата прошла успешно!</b>\n\n` +
         `🔑 <b>Ваш код:</b> <code>${gift.code}</code>\n\n` +
         `⬇️ Нажмите кнопку ниже, чтобы проверить его на сайте, возможно вы приобрели VIP-код!`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "🔍 Проверить код на сайте",
                  url: "https://gift-frontend-poth.onrender.com", // ← ТВОЙ САЙТ
                },
              ],
            ],
          },
        }
      );
      await notifyAdmin(
        `💰 <b>Новая оплата</b>\n\n` +
        `👤 TG ID: ${tgUserId}\n` +
        `🔑 Код: ${gift.code}\n` +
        `📦 Тип: ${gift.type}\n` +
        `🆔 Payment ID: ${payment.id}`
      );
    }

    if (event.event === "payment.canceled") {
      const payment = event.object;
      const giftId = payment.metadata.gift_id;

      await supabase
        .from("gifts")
        .update({
          status: "free",
          reserved: false,
          reserved_at: null,
          tg_user_id: null,
          payment_id: null,
        })
        .eq("id", giftId);
    
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("🔥 YOOKASSA ERROR:", e);
    res.sendStatus(200);
  }
});


// ================= START =================
app.listen(10000, () => {
  console.log("🚀 Server running on 10000");
});