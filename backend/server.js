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

  return res.json({
    ok: true,
    gift: data,
  });
});

// ===== USE GIFT (SITE) =====
app.post("/api/use-gift", async (req, res) => {
  let { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: "Код не передан" });
  }

  code = code.trim().toUpperCase();

  const { data, error } = await supabase
    .from("gifts")
    .update({
      is_used: true,
      used_at: new Date().toISOString(),
      status: "used",
    })
    .eq("code", code)
    .eq("is_used", false)
    .select()
    .limit(1);
  await sendTG(
    process.env.ADMIN_TG_ID,
     `✅ <b>Код использован</b>\n\n` +
     `🔑 Код: <code>${code}</code>\n` +
     `🕒 ${new Date().toLocaleString()}`
  );

  if (error || !data || data.length === 0) {
    return res.status(400).json({
      error: "Код уже использован или недействителен",
    });
  }

  return res.json({
    ok: true,
    gift: data[0],
  });
});

// ================= ROUTES =================

// ----- TELEGRAM -----
app.post("/telegram-webhook", async (req, res) => {
  try {
    const update = req.body;

    if (update.message?.text === "/start") {
      await sendTG(update.message.chat.id, "👋 Выберите действие:", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📖 FAQ", url: "https://telegra.ph/FAQ-12-16-21" }],
            [{ text: "🔑 Купить ключ", callback_data: "BUY_KEY" }],
          ],
        },
      });
    }

    if (update.callback_query) {
      const tgId = update.callback_query.from.id;

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

      if (update.callback_query.data === "BUY_KEY") {
        const gift = await reserveGift(tgId);

        if (!gift) {
          await sendTG(tgId, "❌ Коды закончились");
          return res.sendStatus(200);
        }

        const payment = await createPayment(gift.id, tgId);

        await sendTG(tgId, "💳 Оплатите:", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Оплатить", url: payment.confirmation.confirmation_url }],
              [
                {
                  text: "❌ Отмена",
                  callback_data: `CANCEL:${gift.id}`,
                },
              ],
            ],
          },
        });
      }

      if (update.callback_query.data.startsWith("CANCEL:")) {
        const giftId = update.callback_query.data.split(":")[1];
        await cancelReserve(giftId);
        await sendTG(tgId, "❌ Оплата отменена");
      }
    }

    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.sendStatus(200);
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
        `🎉 Оплата прошла!\n\n🔑 Ваш код:\n\n<b>${gift.code}</b>`,
        { parse_mode: "HTML" }
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
      await sendTG(
        process.env.ADMIN_TG_ID,
         `💳 <b>Оплата прошла</b>\n\n` +
         `👤 TG ID: ${tgUserId}\n` +
         `💰 Сумма: ${amount} RUB\n` +
         `🎁 Тип: ${type}\n` +
         `🆔 Payment ID: ${paymentId}`
      );
    
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("🔥 YOOKASSA ERROR:", e);
    res.sendStatus(200);
  }
});


//=========stats=================
app.get("/api/stats", async (req, res) => {
  const { data, error } = await supabase
    .from("gifts")
    .select("id, type, is_used");

  if (error) {
    return res.status(500).json({ ok: false });
  }

  const normalTotal = data.filter(g => g.type === "normal").length;
  const normalUsed = data.filter(g => g.type === "normal" && g.is_used).length;

  const vipTotal = data.filter(g => g.type === "vip").length;
  const vipUsed = data.filter(g => g.type === "vip" && g.is_used).length;

  return res.json({
    ok: true,
    normal: {
      total: normalTotal,
      used: normalUsed,
      left: normalTotal - normalUsed,
    },
    vip: {
      total: vipTotal,
      used: vipUsed,
      left: vipTotal - vipUsed,
    },
  });
});
// ================= START =================
app.listen(10000, () => {
  console.log("🚀 Server running on 10000");
});