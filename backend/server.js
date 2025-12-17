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
        await sendTG(
          tgId,
          "📖 Инструкция:\n\n1️⃣ Купить ключ\n2️⃣ Оплатить\n3️⃣ Получить код\n4⃣ Ввести код на сайте"
        );
      }

      if (data === "BUY_KEY") {
        const reservation = await reserveCode(tgId);

        if (!reservation) {
          await sendTG(tgId, "❌ Коды на сегодня закончились");
        } else {
          const payment = await createYooPayment({
            reservation_id: reservation.id,
            tg_user_id: tgId,
          });

          await sendTG(tgId, "💳 Оплатите 👇", {
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
        await sendTG(tgId, "❌ Платёж отменён");
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

        await sendTG(tgId, text, { parse_mode: "HTML" });
      }
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
async function reserveCode(tgId) {
  console.log("🔒 reserveCode for:", tgId);

  const { data, error } = await supabase
    .from("gifts")
    .select("*")
    .eq("type", "normal")
    .eq("is_used", false)
    .eq("reserved", false)
    .eq("day", new Date().toISOString().slice(0, 10))
    .order("random()")
    .limit(1);

  if (error || ! data || data.length === 0) {
    console.log("❌ No free codes");
    return null;
  }

  const gift = data[0];

  await supabase
    .from("gifts")
    .update({
      reserved: true,
      reserved_by: tgId,
      reserved_at: new Date().toISOString(),
    })
    .eq("id", gift.id);

  return gift;
}
//==================create payment=============
async function createYooPayment({ reservation_id, tg_user_id }) {
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
        return_url: "https://example.com/success",
      },
      description: "Секретный подарок",
      metadata: {
        reservation_id,
        tg_user_id,
      },
    }),
  });

  return await response.json();
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
    `🎁 Ваш код:\n\n${reservation.code}
     Используй его на сайте: https://gift-frontend-poth.onrender.com
     Удачи`
  );
}
//===========canel==========
async function cancelReservation(reservationId) {
  console.log("❌ cancelReservation:", reservationId);

  await supabase
    .from("gifts")
    .update({
      reserved_by: null,
      reserved_at: null,
    })
    .eq("id", reservationId);
}
// ================== YOOKASSA WEBHOOK ==================
app.post("/yookassa", async (req, res) => {
  try {
    const event = req.body;

    console.log("📩 YOOKASSA:", event.event);

    if (event.event !== "payment.succeeded") {
      return res.send("ok");
    }

    const payment = event.object;
    const { reservation_id, tg_user_id } = payment.metadata;
    const gift = await confirmReservation(reservation_id);

    if (!gift) return res.send("ok");

    if (gift.type === "vip") {
      await sendTG(
        tg_user_id,
        `🎟 <b>ПОЗДРАВЛЯЕМ!</b>\n\nВы получили <b>VIP билет</b> 🎉\n\nВы участвуете в розыгрыше <b>100 000 ₽</b> 31 декабря`
      );
    } else {
      await sendTG(
        tg_user_id,
    `✅ Оплата прошла!\n\nВаш код:\n<code>${gift.code}</code>`
      );
    }

    res.send("ok");
  } catch (e) {
    console.error("🔥 YOOKASSA WEBHOOK ERROR:", e);
    res.send("ok");
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