import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import 'dotenv/config';
import { createClient } from "@supabase/supabase-js";
import cors from "cors";
const app = express();
app.use(cors({
  origin: ["http://localhost:3000", "https://*.vercel.app"],
  methods: ["GET", "POST"],
}));
app.use(express.json());
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
console.log("✅ Сервер запущен");
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
async function notifyAdmin(text) {
  await sendTG(process.env.ADMIN_TG_ID, text, { parse_mode: "HTML" });
}
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
    .eq("id", giftId);
}
async function createTBankPayment(giftId, tgUserId) {
  const paymentId = "TBANK_" + Date.now();
  await supabase
    .from("gifts")
    .update({
      payment_id: paymentId,
      status: "waiting_payment",
    })
    .eq("id", giftId);
  return {
    id: paymentId,
    confirmation: {
      confirmation_url: "https://t.me/gift_celler_bot"
    }
  };
}
app.get("/api/check-gift/:code", async (req, res) => {
  const code = req.params.code.toUpperCase();
  const { data, error } = await supabase
    .from("gifts")
    .select("id, code, type")
    .eq("code", code)
    .eq("status", "paid")
    .eq("is_used", false)
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    return res.status(404).json({
      ok: false,
      message: "Код не найден или уже использован",
    });
  }
  await notifyAdmin(`🔍 Код проверен: ${code}`);
  return res.json({
    ok: true,
    gift: data,
  });
});
app.post("/api/use-gift/:code", async (req, res) => {
  const code = req.params.code.toUpperCase();
  const { data: gift } = await supabase
    .from("gifts")
    .update({
      is_used: true,
      used_at: new Date().toISOString(),
    })
    .eq("code", code)
    .eq("is_used", false)
    .select()
    .maybeSingle();
  if (!gift) {
    return res.status(400).json({ ok: false });
  }
  await notifyAdmin(`🎁 Код активирован: ${code}`);
  return res.json({ ok: true });
});
app.get("/api/stats", async (req, res) => {
  const { count: normal_left } = await supabase
    .from("gifts")
    .select("*", { count: "exact", head: true })
    .eq("type", "normal")
    .eq("status", "free");
  const { data: vip_used } = await supabase
    .from("gifts")
    .select("id")
    .eq("type", "vip")
    .eq("status", "used")
    .limit(1);
  return res.json({
    normal_left: normal_left || 0,
    vip_found: vip_used?.length > 0,
  });
});
app.post("/telegram-webhook", async (req, res) => {
  try {
    const update = req.body;
    if (update.message?.text === "/start") {
      await sendTG(
        update.message.chat.id,
        `🎁 <b>НОВОГОДНЯЯ ИГРА 2026</b>
🎯 Купи ключ - получи подарок
💰 Шанс выиграть 100 000 ₽
⏳ Розыгрыш 31 декабря
<b>Цена:</b> 100 ₽ за ключ
<b>Гарантия:</b> Каждый код - уникальный подарок
👇 Нажмите кнопку ниже, чтобы купить ключ:`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🎯 КУПИТЬ КЛЮЧ ЗА 100 ₽", callback_data: "BUY_KEY" }],
              [{ text: "📊 Статистика", callback_data: "STATS" }],
              [{ text: "❓ FAQ", url: "https://telegra.ph/FAQ-12-16-21" }],
            ],
          },
        }
      );
      return res.sendStatus(200);
    }
    if (update.callback_query) {
      const tgId = update.callback_query.from.id;
      const data = update.callback_query.data;
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
      if (data === "STATS") {
        const { data: stats } = await supabase
          .from("gifts")
          .select("id", { count: "exact", head: true })
          .eq("is_used", false)
          .eq("reserved", false)
          .eq("type", "normal");
        const text = `📊 <b>Статистика</b>
🎁 Осталось ключей: <b>${stats?.count ?? 0}</b>
💎 VIP-билет: ${stats?.count > 0 ? "🎯 В игре" : "❌ Найден"}
👇 Купи ключ - попробуй удачу!`;
        await sendTG(tgId, text, { parse_mode: "HTML" });
        return res.sendStatus(200);
      }
      if (data === "BUY_KEY") {
        const gift = await reserveGift(tgId);
        if (!gift) {
          await sendTG(tgId, "❌ К сожалению, ключи закончились");
          return res.sendStatus(200);
        }
        const payment = await createTBankPayment(gift.id, tgId);
        await sendTG(
          tgId,
          `💳 <b>Оплатите 100 ₽</b>
После оплаты вы получите:
✅ Уникальный код для проверки на сайте
🎁 Цифровой подарок
🎯 Шанс на VIP-билет и 100 000 ₽
👇 Нажмите для оплаты:`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "💳 ОПЛАТИТЬ 100 ₽ (T-Банк)", url: payment.confirmation.confirmation_url }],
                [{ text: "❌ ОТМЕНА", callback_data: `CANCEL:${gift.id}` }],
              ],
            },
          }
        );
        return res.sendStatus(200);
      }
      if (data.startsWith("CANCEL:")) {
        const giftId = data.split(":")[1];
        await cancelReserve(giftId);
        await sendTG(tgId, "❌ Покупка отменена");
        return res.sendStatus(200);
      }
    }
    return res.sendStatus(200);
  } catch (e) {
    console.error("TG ERROR:", e);
    return res.sendStatus(200);
  }
});
app.post("/tbank-webhook", async (req, res) => {
  try {
    const payment = req.body;
    if (payment.status === "success") {
      const giftId = payment.metadata?.gift_id;
      const tgUserId = payment.metadata?.tg_user_id;
      if (giftId) {
        const { data: gift } = await supabase
          .from("gifts")
          .update({
            status: "paid",
            reserved: false,
          })
          .eq("id", giftId)
          .select("*")
          .single();
        if (gift && tgUserId) {
          await sendTG(
            tgUserId,
            `🎉 <b>Оплата прошла успешно!</b>
🔑 <b>Ваш код:</b> <code>${gift.code}</code>
👇 Перейдите на сайт и введите этот код:
${process.env.FRONTEND_URL}
🎁 Вы получите цифровой подарок сразу после проверки кода!`,
            {
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [[
                  {
                    text: "🔍 ПРОВЕРИТЬ КОД НА САЙТЕ",
                    url: process.env.FRONTEND_URL,
                  },
                ]],
              },
            }
          );
          await notifyAdmin(
            `💰 <b>Новая оплата</b>\nКод: ${gift.code}\nTG ID: ${tgUserId}`
          );
        }
      }
    }
    res.sendStatus(200);
  } catch (e) {
    console.error("T-Bank error:", e);
    res.sendStatus(200);
  }
});
export default app;
