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

//===========GET===================
app.get("/api/get-gift/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();

    const { data: gift, error } = await supabase
      .from("gifts")
      .select("code, file_url, is_used")
      .eq("code", code)
      .single();

    if (error || !gift) {
      return res.status(404).json({ error: "CODE_NOT_FOUND" });
    }

    if (gift.is_used) {
      return res.status(410).json({ error: "CODE_USED" });
    }

    if (!gift.file_url) {
      return res.status(409).json({ error: "FILE_NOT_ATTACHED" });
    }

    res.json({
      gift_url: gift.file_url
    });

  } catch (e) {
    console.error("GET GIFT ERROR:", e);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});
// ================== USE GIFT ==================
app.post("/api/use-gift/:code", async (req, res) => {
  try {
    console.log("➡️ use-gift called");

    if (!supabase) {
      console.error("❌ SUPABASE IS NULL");
      return res.status(500).json({ error: "Supabase not initialized" });
    }

    const { code } = req.params;
    console.log("🔑 CODE:", code);

    const { data, error } = await supabase
      .from("gifts")
      .update({ is_used: true,
                used_at: new Date().toISOString(),
      })
      .eq("code", code)
      .eq("is_used", false)
      .select("*");

    console.log("📦 DATA:", data);
    console.log("⚠️ ERROR:", error);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!data || data.length === 0) {
      return res.status(400).json({ error: "Code not found or already used" });
    }

    res.json({ success: true });
  } catch (e) {
    console.error("🔥 CATCH ERROR:", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

//==========reserved==========
async function reserveCode(tgUserId) {
  console.log("🔒 reserveCode for:", tgUserId);

  const { data, error } = await supabase
    .from("gifts")
    .select("*")
    .eq("is_used", false)
    .eq("reserved", false)
    .limit(1)
    .single();

  if (error || !data) {
    console.log("❌ No free codes");
    return null;
  }

  const { error: updateError } = await supabase
    .from("gifts")
    .update({
      reserved: true,
      reserved_at: new Date().toISOString(),
      tg_user_id: tgUserId,
    })
    .eq("id", data.id);

  if (updateError) {
    console.error("❌ Reserve update error:", updateError);
    return null;
  }

  return data;
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

  return await response.json();
}
//=========confirm============
// ================== CONFIRM RESERVATION ==================
async function confirmReservation(reservation_id, tg_user_id) {
  console.log("✅ CONFIRM RESERVATION:", reservation_id, tg_user_id);

  // 1️⃣ находим зарезервированный код
  const { data: gift, error: findError } = await supabase
    .from("gifts")
    .select("*")
    .eq("id", reservation_id)
    .eq("reserved", true)
    .single();

  if (findError || !gift) {
    console.error("❌ Gift not found or not reserved", findError);
    return;
  }

  // 2️⃣ подтверждаем код
  const { error: updateError } = await supabase
    .from("gifts")
    .update({
      reserved: false,
      is_used: false,
      tg_user_id: tg_user_id,
      used_at: null,
    })
    .eq("id", reservation_id);

  if (updateError) {
    console.error("❌ Failed to confirm gift", updateError);
    return;
  }

  // 3️⃣ отправляем код пользователю
  await sendTG(
    tg_user_id,
    `🎉 <b>Оплата прошла успешно!</b>\n\nВаш секретный код:\n<code>${gift.code}</code>`
  );

  console.log("🎁 CODE SENT:", gift.code);
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

    console.log("💳 YooKassa event:", event.event);

    // ОБЯЗАТЕЛЬНО сразу отвечаем
    res.sendStatus(200);

    if (event.event === "payment.succeeded") {
      const payment = event.object;

      const reservationId = payment.metadata?.reservation_id;
      const tgUserId = payment.metadata?.tg_user_id;

      console.log("✅ PAYMENT SUCCESS:", reservationId, tgUserId);

      if (!reservationId || !tgUserId) {
        console.error("❌ METADATA MISSING");
        return;
      }

      await confirmReservation(reservationId, tgUserId);
    }

    if (event.event === "payment.canceled") {
      const payment = event.object;
      const reservationId = payment.metadata?.reservation_id;

      console.log("❌ PAYMENT CANCELED:", reservationId);

      if (reservationId) {
        await cancelReservation(reservationId);
      }
    }
  } catch (e) {
    console.error("🔥 YOOKASSA WEBHOOK ERROR:", e);
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