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

    // ===== MESSAGE =====
    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text;

      if (text === "/start") {
        await sendTG(chatId, "👋 Добро пожаловать!\n\nВыберите действие:", {
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
        });

        return res.sendStatus(200);
      }
    }
});
// ===== CALLBACK =====
app.post("/telegram", async (req, res) => {
  try {
    const update = req.body;

    // ✅ ОБЯЗАТЕЛЬНО
    res.send("ok");

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
          "📖 Инструкция:\n\n1️⃣ Купите ключ\n2️⃣ Получите код\n3️⃣ Проверьте код на сайте"
        );
        return;
      }

      // ===== ПОКУПКА =====
      if (data === "BUY_KEY") {
        console.log("🛒 BUY_KEY pressed by", tgId);

        // 🔒 резерв кода
        const reservation = await reserveCode(tgId);

        if (!reservation) {
          await sendTG(tgId, "❌ Коды временно закончились");
          return;
        }

        // 💳 платёж
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
                  callback_data: "CANCEL_PAYMENT:" + reservation.id,
                },
              ],
            ],
          },
        });

        return;
      }

      // ===== ОТМЕНА =====
      if (data.startsWith("CANCEL_PAYMENT:")) {
        const reservationId = data.split(":")[1];

        await cancelReservation(reservationId);

        await sendTG(tgId, "❌ Платёж отменён. Код возвращён в систему.");
        return;
      }
    }
  } catch (e) {
    console.error("🔥 TG WEBHOOK ERROR:", e);
  }
});

// ================== TELEGRAM SAFE SEND ==================
async function tgSend(chatId, text) {
  if (!TG_TOKEN) {
    console.warn("⚠️ TG_TOKEN not set");
    return;
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
        }),
      }
    );

    if (!res.ok) {
      const t = await res.text();
      console.error("❌ TG API ERROR:", t);
    }
  } catch (e) {
    console.error("❌ TG SEND FAILED (IGNORED):", e.message);
  }
}
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
app.post("/api/reserve-code", async (req, res) => {
  const reservation_id = crypto.randomUUID();
  const tg_user_id = req.body.tg_user_id;

  const { data: gift, error } = await supabase
    .from("gifts")
    .select("*")
    .eq("is_used", false)
    .eq("reserved", false)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (!gift) {
    return res.status(404).json({ error: "NO_AVAILABLE_CODES" });
  }

  await supabase
    .from("gifts")
    .update({
      reserved: true,
      reservation_id,
      reserved_at: new Date().toISOString(),
      tg_user_id,
    })
    .eq("id", gift.id);

  console.log("🟡 RESERVED:", gift.code);

  res.json({
    reservation_id,
    code: gift.code,
  });
});
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

app.post("/api/confirm-payment", async (req, res) => {
  const { reservation_id, code } = req.body;

  const { data, error } = await supabase
    .from("gifts")
    .update({
      is_used: true,
      used_at: new Date().toISOString(),
      reserved: false,
      reserved_by: null,
      reserved_at: null,
    })
    .eq("code", code)
    .eq("reserved_by", reservation_id)
    .eq("is_used", false)
    .select();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (!data || data.length === 0) {
    return res.status(400).json({ error: "INVALID_RESERVATION" });
  }

  res.json({ success: true });
});

//===========canel==========

app.post("/api/cancel-reservation", async (req, res) => {
  const { reservation_id } = req.body;

  await supabase
    .from("gifts")
    .update({
      reserved: false,
      reservation_id: null,
      reserved_at: null,
      tg_user_id: null,
    })
    .eq("reservation_id", reservation_id)
    .eq("is_used", false);

  console.log("🔴 RESERVATION CANCELED:", reservation_id);

  res.json({ success: true });
});

//==========yookassa======
app.post("/yookassa-webhook", async (req, res) => {
  try {
    const event = req.body;
    const payment = event.object;

    const reservation_id = payment.metadata?.reservation_id;
    const tg_user_id = payment.metadata?.tg_user_id;

    if (!reservation_id) return res.sendStatus(200);

    // ✅ УСПЕХ
    if (event.event === "payment.succeeded") {
      const { data: gift } = await supabase
        .from("gifts")
        .select("*")
        .eq("reservation_id", reservation_id)
        .single();

      if (gift) {
        await supabase
          .from("gifts")
          .update({
            is_used: true,
            used_at: new Date().toISOString(),
          })
          .eq("id", gift.id);

        await sendTG(
          tg_user_id,
          `🎉 Оплата прошла!\n\nВаш секретный ключ:\n\n🔑 ${gift.code}`
        );
      }
    }

    // ❌ ОТМЕНА
    if (event.event === "payment.canceled") {
      await supabase
        .from("gifts")
        .update({
          reserved_by: null,
          reservation_id: null,
          reserved_at: null,
        })
        .eq("reservation_id", reservation_id);
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("YOOKASSA ERROR:", e);
    res.sendStatus(200);
  }
});

//======send messege====
async function sendTG(chatId, text, reply_markup = null) {
  await fetch(
    `https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        reply_markup,
      }),
    }
  );
}
// ================== START ==================
const LISTEN_PORT = process.env.PORT || 10000;

app.listen(LISTEN_PORT, () => {
  console.log(`🚀 Server running on port ${LISTEN_PORT}`);
});