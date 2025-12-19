import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const app = express();
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
async function checkGift(code) {
  const { data } = await supabase
    .from("gifts")
    .select("status")
    .eq("code", code)
    .single();

  if (!data) return false;
  return data.status === "paid";
}

// ---------- USE ----------
async function useGift(code) {
  const { data, error } = await supabase
    .from("gifts")
    .update({
      status: "used",
      is_used: true,
      used_at: new Date().toISOString(),
    })
    .eq("code", code)
    .eq("status", "paid")
    .select("file_url")
    .single();

  if (error || !data) return null;
  return data;
}

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
                  `callback_data: CANCEL:${gift.id}`,
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

// ----- CHECK SITE -----
app.get("/api/check-gift/:code", async (req, res) => {
  const ok = await checkGift(req.params.code);
  res.json({ valid: ok });
});

// ----- USE SITE -----
app.post("/api/use-gift/:code", async (req, res) => {
  const gift = await useGift(req.params.code);
  if (!gift) return res.status(400).json({ error: "INVALID" });
  res.json(gift);
});

// ================= START =================
app.listen(10000, () => {
  console.log("🚀 Server running on 10000");
});