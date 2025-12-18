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
  const today = new Date().toISOString().slice(0, 10);

  const { data: normalAll } = await supabase
    .from("gifts")
    .select("id")
    .eq("type", "normal")
    .eq("day", today);

  const { data: normalUsed } = await supabase
    .from("gifts")
    .select("id")
    .eq("type", "normal")
    .eq("is_used", true)
    .eq("day", today);

  const { data: vipUsed } = await supabase
    .from("gifts")
    .select("id")
    .eq("type", "vip")
    .eq("is_used", true)
    .eq("day", today);

  return {
    normal_left: (normalAll?.length || 0) - (normalUsed?.length || 0),
    normal_total: normalAll?.length || 0,
    vip_sold: (vipUsed?.length || 0) > 0,
  };
}
// ================== RESERVE CODE ==================
async function reserveCode(tgUserId) {
  console.log("🔒 reserveCode for:", tgUserId);

  // 1. Проверка: нет ли уже резерва у пользователя
  const { data: existing } = await supabase
    .from("gifts")
    .select("id")
    .eq("tg_user_id", tgUserId)
    .eq("reserved", true)
    .eq("is_used", false)
    .limit(1);

  if (existing && existing.length > 0) {
    console.log("⚠️ Already reserved");
    return null;
  }

  // 2. Берём случайный свободный код
  const { data, error } = await supabase
    .from("gifts")
    .select("*")
    .eq("type", "normal")
    .eq("is_used", false)
    .eq("reserved", false)
    .order("random()")
    .limit(1);

  if (error⠞⠞⠵⠵⠟⠞⠺⠺⠺data.length === 0) {
    console.log("❌ No free codes");
    return null;
  }

  const gift = data[0];

  // 3. Резервируем
  const { error: updError } = await supabase
    .from("gifts")
    .update({
      reserved: true,
      reserved_at: new Date().toISOString(),
      tg_user_id: tgUserId,
      status: "reserved",
    })
    .eq("id", gift.id);

  if (updError) {
    console.error("❌ Reserve failed:", updError);
    return null;
  }

  console.log("✅ Reserved:", gift.code);
  return gift;
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
        await sendMessage(chatId, "👋 Добро пожаловать!\n\nВыберите действие:", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "📖 FAQ", url: "https://telegra.ph/FAQ-12-16-21" }],
              [{ text: "📝 Инструкция", callback_data: "INSTRUCTION" }],
              [{ text: "🔑 Купить ключ", callback_data: "BUY_KEY" }],
              [{ text: "📊 Статистика", callback_data: "STATS" }],
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

      await fetch(
        `https://api.telegram.org/bot${process.env.TG_TOKEN}/answerCallbackQuery`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callback_query_id: cb.id }),
        }
      );

      if (data === "INSTRUCTION") {
        await sendMessage(
          tgId,
          "📖 Инструкция:\n\n1️⃣ Купить ключ\n2️⃣ Оплатить\n3️⃣ Получить код\n4⃣ Ввести код на сайте"
        );
      }

      if (data === "BUY_KEY") {
        const reservation = await reserveCode(tgId);

        if (!reservation) {
          await sendMessage(tgId, "❌ Коды на сегодня закончились");
        } else {
          const payment = await createYooPayment({
            reservation_id: reservation.id,
            tg_user_id: tgId,
          });

          await sendMessage(tgId, "💳 Оплатите 👇", {
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

      if (data.startsWith("CANCEL_PAYMENT:")) {
        const reservationId = data.split(":")[1];
        await cancelReservation(reservationId);
        await sendMessage(tgId, "❌ Платёж отменён");
      }

      if (data === "STATS") {
        const stats = await getTodayStats();

        const text = `
📊 <b>Статистика на сегодня</b>

🔑 Обычные ключи:
— Осталось: <b>${stats.normal_left}</b> / ${stats.normal_total}

💎 VIP билет:
${stats.vip_sold ? "— ✅ уже найден" : "— ❌ ещё в игре"}
        `;

        await sendMessage(tgId, text, { parse_mode: "HTML" });
      }
    }

    return res.sendStatus(200);
  } catch (e) {
    console.error("🔥 TG WEBHOOK ERROR:", e);
    return res.sendStatus(200);
  }
});

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
async function getGift(code) {
  const { data, error } = await supabase
    .from("gifts")
    .select("file_url, status")
    .eq("code", code)
    .single();

  if (error || !data) {
    return { error: "INVALID_CODE" };
  }

  if (data.status !== "used") {
    return { error: "NOT_ACTIVATED" };
  }

  return { success: true, file_url: data.file_url };
}

//====================check gift=================
async function checkGift(code) {
  const { data, error } = await supabase
    .from("gifts")
    .select("status")
    .eq("code", code)
    .single();

  if (error || !data) {
    return { valid: false, reason: "INVALID" };
  }

  if (data.status === "used") {
    return { valid: true };
  }

  return { valid: false, reason: "NOT_ACTIVATED" };
}

// ================== USE GIFT ==================
async function useGift(id) {
  await supabase
    .from("gifts")
    .update({
      is_used: true,
      used_at: new Date().toISOString(),
      status: "used",
      reserved: false,
    })
    .eq("id", id)
    .eq("status", "reserved");
}

//==================create payment=============
async function createPayment({ reservationId, tgUserId }) {
  const res = await fetch("https://api.yookassa.ru/v3/payments", {
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
        return_url: "https://example.com/success",
      },
      description: "Подарочный код",
      metadata: {
        reservation_id: reservationId,
        tg_user_id: tgUserId,
      },
    }),
  });

  return await res.json();
}

// ================== CONFIRM RESERVATION ==================
async function confirmReserved(reservationId, paymentId) {
  const { data, error } = await supabase
    .from("gifts")
    .select("*")
    .eq("id", reservationId)
    .eq("status", "reserved")
    .single();

  if (error || !data) return null;

  await supabase
    .from("gifts")
    .update({
      status: "used",
      is_used: true,
      used_at: new Date().toISOString(),
      payment_id: paymentId,
      reserved: false,
    })
    .eq("id", reservationId);

  return data;
}
//===========canel reserved===========

async function cancelReserved(reservationId) {
  await supabase
    .from("gifts")
    .update({
      status: "free",
      reserved: false,
      reserved_at: null,
      tg_user_id: null,
    })
    .eq("id", reservationId)
    .eq("status", "reserved");
}
//===========cancel payment===========
async function cancelPayment(reservationId) {
  await cancelReserved(reservationId);
}

// ================== YOOKASSA WEBHOOK ==================
app.post("/yookassa-webhook", async (req, res) => {
  try {
    const event = req.body;

    if (event.event !== "payment.succeeded") {
      return res.sendStatus(200);
    }

    const payment = event.object;
    const reservationId = payment.metadata.reservation_id;
    const tgUserId = payment.metadata.tg_user_id;

    const gift = await confirmReserved(reservationId, payment.id);

    if (gift) {
      await sendMessage(
        tgUserId,
        `🎁 Ваш код:\n\n<code>${gift.code}</code>`,
        { parse_mode: "HTML" }
      );
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("YOOKASSA ERROR:", e);
    res.sendStatus(200);
  }
});

//======send messege====
async function sendMessage(chatId, text, options = {}) {
  await fetch(
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
}
// ================== START ==================
const LISTEN_PORT = process.env.PORT || 10000;

app.listen(LISTEN_PORT, () => {
  console.log(`🚀 Server running on port ${LISTEN_PORT}`);
});