import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import YooCheckout from "@a2seven/yoo-checkout";

const TG_TOKEN = process.env.TG_TOKEN;
const ADMIN_TG_ID = process.env.ADMIN_TG_ID;
console.log("SUPABASE_URL =", process.env.SUPABASE_URL);
console.log("SUPABASE_SERVICE_KEY =", process.env.SUPABASE_SERVICE_KEY ? "OK" : "MISSING");

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
//===================stats===========
async function getTodayStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // обычные ключи
  const { data: normalAll } = await supabase
    .from("gifts")
    .select("id")
    .eq("type", "normal")
    .gte("created_at", today.toISOString());

  const { data: normalUsed } = await supabase
    .from("gifts")
    .select("id")
    .eq("type", "normal")
    .eq("is_used", true)
    .gte("created_at", today.toISOString());

  // vip
  const { data: vipUsed } = await supabase
    .from("gifts")
    .select("id")
    .eq("type", "vip")
    .eq("is_used", true)
    .gte("created_at", today.toISOString());

  return {
    normal_left: (normalAll?.length || 0) - (normalUsed?.lenght || 0),
    normal_total: normalAll?.length || 0,
    vip_sold: (vipUsed?.length || 0) > 0,
  };
}

// ================== TELEGRAM WEBHOOK ==================
app.post("/telegram-webhook", async (req, res) => {
  try {
    const update = req.body;
    console.log("TG UPDATE:", JSON.stringify(update, null, 2));

    // ================== MESSAGE ==================
    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text;

      if (text === "/start") {
        await sendTG(chatId, "👋 Добро пожаловать!\n\nВыберите действие:", {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "📖 FAQ",
                  url: "https://telegra.ph/FAQ-12-16-21",
                },
              ],
              [
                {
                  text: "📝 Инструкция",
                  callback_data: "INSTRUCTION",
                },
              ],
              [
                {
                  text: "🔑 Купить ключ",
                  callback_data: "BUY_KEY",
                },
              ],
              [
                {
                  text: "Статистика",
                  callback_data: "STATS",
                },
              ],
            ],
          },
        });
      }
    }

    // ================== CALLBACK ==================
    if (update.callback_query) {
      const cb = update.callback_query;
      const tgId = cb.from.id;
      const data = cb.data;

      console.log("➡️ CALLBACK:", data);

      // ❗️ ОБЯЗАТЕЛЬНО отвечаем Telegram
      await fetch(
        `https://api.telegram.org/bot${process.env.TG_TOKEN}/answerCallbackQuery`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callback_query_id: cb.id,
          }),
        }
      );

      // ===== ИНСТРУКЦИЯ =====
      if (data === "INSTRUCTION") {
        await sendTG(
          tgId,
          "📖 Инструкция:\n\n1️⃣ Нажмите «Купить ключ»\n2️⃣ Оплатите\n3️⃣ Получите код\n4️⃣ Проверьте его на сайте"
        );
      }

      // ===== ПОКУПКА =====
      if (data === "BUY_KEY") {
        console.log("🛒 BUY_KEY pressed by", tgId);

        const reservation = await reserveCode(tgId);

        if (!reservation) {
          await sendTG(tgId, "❌ Коды временно закончились");
        } else {
          const payment = await createYooPayment({
            reservation_id: reservation.id,
            tg_user_id: tgId,
          });

          await sendTG(tgId, "💳 Оплатите подарок 👇", {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "Оплатить",
                    url: payment.confirmation.confirmation_url,
                  },
                ],
                [
                  {
                    text: "❌ Отменить",
                    callback_data: `CANCEL_PAYMENT:${reservation.id}`,
                  },
                ],
              ],
            },
          });
        }
      }

      // ===== ОТМЕНА =====
      if (data.startsWith("CANCEL_PAYMENT:")) {
        const reservationId = data.split(":")[1];

        await cancelReservation(reservationId);
        await sendTG(tgId, "❌ Платёж отменён. Код возвращён в систему.");
      }
    }
       // ===== СТАТИСТИКА =====
      if (data === "STATS") {
        const stats = await getTodayStats();

        await sendTG(
          tgId,
          `📊 <b>Статистика на сегодня</b>\n\n` +
          `🔑 Обычные ключи:\n` +
          `— Осталось: <b>${stats.normal_left}</b> / ${stats.normal_total}\n\n` +
          `💎 VIP билет:\n` +
          (stats.vip_sold ? "— ✅ <b>уже куплен</b>" : "— ❌ <b>ещё не куплен</b>"),
        { parse_mode: "HTML" }
      );

      return;
    }

    return res.sendStatus(200);
  } catch (e) {
    console.error("🔥 TG WEBHOOK ERROR:", e);
    return res.sendStatus(200);
  }
});

// ================== TELEGRAM SAFE SEND ==================

// ================== TG TEST ==================
app.get("/tg-test", async (req, res) => {
  await tgSend(ADMIN_TG_ID, "✅ Telegram test OK");
  res.json({ ok: true });
});


// ================== HEALTH ==================
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// ================== GET GIFT ==================
app.get("/api/get-gift/:code", async (req, res) => {
  const code = req.params.code.toUpperCase();

  const { data, error } = await supabase
    .from("gifts")
    .select("code, file_url, is_used")
    .eq("code", code)
    .single();

  if (!data) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  if (data.is_used) {
    return res.status(400).json({ error: "USED" });
  }

  res.json({ gift_url: data.file_url });
});
// ================== USE GIFT ==================
app.post("/api/use-gift/:code", async (req, res) => {
  const code = req.params.code.toUpperCase();

  console.log("➡️ use-gift called");
  console.log("🔑 CODE:", code);

  const { data, error } = await supabase
    .from("gifts")
    .update({
      is_used: true,
      used_at: new Date().toISOString(),
    })
    .eq("code", code)
    .eq("is_used", false)
    .select()
    .single();

  console.log("📦 DATA:", data);
  console.log("⚠️ ERROR:", error);

  if (error || !data) {
    return res.status(400).json({ error: "ALREADY_USED_OR_NOT_FOUND" });
  }

  res.json({ success: true });
});
//==========reserved==========
async function reserveCode(tg_user_id, isVip = false) {
  const { data, error } = await supabase
    .from("gifts")
    .select("*")
    .eq("is_used", false)
    .is("reserved_at", null)
    .eq("type", isVip ? "vip" : "normal")
    .order("id", { ascending: false }) // чтобы Supabase не ругался
    .limit(50); // берём пул

  if (error || !data || data.length === 0) return null;

  // 🎲 выбираем рандомно из пула
  const gift = data[Math.floor(Math.random() * data.length)];

  const { error: reserveError } = await supabase
    .from("gifts")
    .update({
      reserved: true,
      reserved_at: new Date().toISOString(),
      tg_user_id,
    })
    .eq("id", gift.id)
    .eq("is_used", false)
    .is("reserved_at", null);

  if (reserveError) return null;

  return gift;
}

//==================create payment=============
async function createYooPayment({ reservation_id, tg_user_id }) {
  // 👉 1. Проверяем, не создан ли уже платёж
  const { data: existing } = await supabase
    .from("reservations")
    .select("payment_id")
    .eq("id", reservation_id)
    .single();

  if (existing?.payment_id) {
    throw new Error("PAYMENT_ALREADY_CREATED");
  }

  // 👉 2. Создаём платёж
  const idempotenceKey = crypto.randomUUID();

  const response = await fetch("https://api.yookassa.ru/v3/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotence-Key": idempotenceKey,
      Authorization:
        "Basic " +
        Buffer.from(
          process.env.YOOKASSA_SHOP_ID + ":" + process.env.YOOKASSA_SECRET_KEY
        ).toString("base64"),
    },
    body: JSON.stringify({
      amount: {
        value: "100.00",
        currency: "RUB",
      },
      confirmation: {
        type: "redirect",
        return_url: "https://example.com/success",
      },
      capture: true,
      description: "Секретный подарок",
      metadata: {
        reservation_id,
        tg_user_id,
      },
    }),
  });

  const payment = await response.json();

  // 👉 3. Сохраняем payment_id (АНТИ ДАБЛ)
  await supabase
    .from("reservations")
    .update({
      payment_id: payment.id,
    })
    .eq("id", reservation_id);

  return payment;
}
// ================== CONFIRM RESERVATION ==================
async function confirmReservation({ reservation_id, payment_id }) {
  // 🔒 Берём резерв
  const { data: reservation } = await supabase
    .from("reservations")
    .select("*")
    .eq("id", reservation_id)
    .single();

  // ❌ Нет резерва
  if (!reservation) return;

  // ❌ Уже подтверждён (АНТИ ДАБЛ)
  if (reservation.status === "paid") {
    console.log("⚠️ Payment already processed:", payment_id);
    return;
  }

  // ❌ payment_id не совпадает
  if (reservation.payment_id !== payment_id) {
    console.log("⚠️ Payment ID mismatch");
    return;
  }

  // ✅ Подтверждаем резерв
  await supabase
    .from("reservations")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
    })
    .eq("id", reservation_id);

  // ✅ Выдаём код
  await supabase
    .from("gifts")
    .update({
      is_used: true,
      used_at: new Date().toISOString(),
      tg_user_id: reservation.tg_user_id,
    })
    .eq("id", reservation.gift_id);

  // 📩 Отправляем код в TG
  await sendTG(
    reservation.tg_user_id,
    `🎁 Ваш код:\n\n${reservation.code}`
  );
}
//===========canel==========
async function cancelReservation(giftId) {
  await supabase
    .from("gifts")
    .update({
      reserved: false,
      reserved_at: null,
      tg_user_id: null,
    })
    .eq("id", giftId);
}
// ================== YOOKASSA WEBHOOK ==================
app.post("/yookassa-webhook", async (req, res) => {
  try {
    const event = req.body;

    if (event.event === "payment.succeeded") {
      const payment = event.object;

      await confirmReservation({
        reservation_id: payment.metadata.reservation_id,
        payment_id: payment.id,
      });
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("🔥 YOOKASSA WEBHOOK ERROR:", e);
    res.sendStatus(200);
  }
});

//======send messege====
async function sendTG(chatId, text, extra = {}) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };

  if (extra.reply_markup) {
    payload.reply_markup = extra.reply_markup;
  }

  const res = await fetch(
    `https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  const data = await res.json();
  console.log("TG SEND RESULT:", data);
  return data;
}
// ================== START ==================
const LISTEN_PORT = process.env.PORT || 10000;

app.listen(LISTEN_PORT, () => {
  console.log(`🚀 Server running on port ${LISTEN_PORT}`);
});