﻿import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import 'dotenv/config';
import { createClient } from "@supabase/supabase-js";
import cors from "cors";

const app = express();

// CORS для Vercel
app.use(cors({
  origin: ["http://localhost:3000", "https://*.vercel.app", "https://api.telegram.org"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
}));

app.use(express.json());

// Supabase клиент
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

console.log("✅ Сервер запущен");

// Функция отправки сообщений в Telegram
async function sendTG(chatId, text, options = {}) {
  console.log(`📤 Отправка в TG ${chatId}: ${text.substring(0, 50)}...`);
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
  const result = await res.json();
  console.log("📤 Результат отправки:", result.ok ? "Успех" : "Ошибка");
  return result;
}

// Уведомление админу
async function notifyAdmin(text) {
  console.log(`📢 Уведомление админу: ${text}`);
  await sendTG(process.env.ADMIN_TG_ID, text, { parse_mode: "HTML" });
}

// Резервирование подарка
async function reserveGift(tgUserId) {
  console.log(`🎁 Резервирование подарка для TG: ${tgUserId}`);
  const { data: gift, error } = await supabase
    .from("gifts")
    .select("*")
    .eq("status", "free")
    .eq("type", "normal")
    .limit(1)
    .single();
  
  if (error || !gift) {
    console.log("❌ Нет свободных подарков:", error?.message);
    return null;
  }
  
  await supabase
    .from("gifts")
    .update({
      status: "reserved",
      reserved: true,
      reserved_at: new Date().toISOString(),
      tg_user_id: tgUserId,
    })
    .eq("id", gift.id);
  
  console.log(`✅ Подарок ${gift.id} зарезервирован`);
  return gift;
}

// Отмена резерва
async function cancelReserve(giftId) {
  console.log(`❌ Отмена резерва подарка ${giftId}`);
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

// Создание платежа T-Bank
async function createTBankPayment(giftId, tgUserId) {
  console.log(`💰 Создание платежа для подарка ${giftId}`);
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

// Проверка подарка
app.get("/api/check-gift/:code", async (req, res) => {
  console.log(`🔍 Проверка кода: ${req.params.code}`);
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
    console.log(`❌ Код не найден: ${code}`);
    return res.status(404).json({
      ok: false,
      message: "Код не найден или уже использован",
    });
  }
  
  await notifyAdmin(`🔍 Код проверен: ${code}`);
  console.log(`✅ Код найден: ${code}, тип: ${data.type}`);
  
  return res.json({
    ok: true,
    gift: data,
  });
});

// Использование подарка
app.post("/api/use-gift/:code", async (req, res) => {
  console.log(`🎁 Активация кода: ${req.params.code}`);
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
    console.log(`❌ Код не найден для активации: ${code}`);
    return res.status(400).json({ ok: false });
  }
  
  await notifyAdmin(`🎁 Код активирован: ${code}`);
  console.log(`✅ Код активирован: ${code}`);
  
  return res.json({ ok: true });
});

// Статистика
app.get("/api/stats", async (req, res) => {
  console.log("📊 Запрос статистики");
  
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

// Установка вебхука Telegram
app.get("/set-webhook", async (req, res) => {
  try {
    console.log("🔄 Установка вебхука Telegram");
    const webhookUrl = `https://gift-backend-nine.vercel.app/telegram-webhook`;
    
    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TG_TOKEN}/setWebhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          drop_pending_updates: true,
          allowed_updates: ["message", "callback_query"]
        }),
      }
    );
    
    const result = await response.json();
    console.log("🔄 Результат установки вебхука:", result);
    
    return res.json({ 
      ok: true, 
      result,
      webhookUrl
    });
    
  } catch (e) {
    console.error("❌ Ошибка установки вебхука:", e);
    return res.json({ 
      ok: false, 
      error: e.message,
      note: "Токен бота: " + (process.env.TG_TOKEN ? "установлен" : "отсутствует")
    });
  }
});

// Получение информации о вебхуке
app.get("/get-webhook-info", async (req, res) => {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TG_TOKEN}/getWebhookInfo`
    );
    const result = await response.json();
    return res.json({ ok: true, result });
  } catch (e) {
    console.error("Ошибка получения информации о вебхуке:", e);
    return res.json({ ok: false, error: e.message });
  }
});

// Удаление вебхука
app.get("/delete-webhook", async (req, res) => {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TG_TOKEN}/deleteWebhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drop_pending_updates: true }),
      }
    );
    const result = await response.json();
    return res.json({ ok: true, result });
  } catch (e) {
    console.error("Ошибка удаления вебхука:", e);
    return res.json({ ok: false, error: e.message });
  }
});

// Вебхук Telegram
app.post("/telegram-webhook", async (req, res) => {
  try {
    console.log("📨 Telegram webhook получен!");
    console.log("📨 Тело запроса:", JSON.stringify(req.body, null, 2));
    
    const update = req.body;
    
    // Отвечаем Telegram сразу, чтобы он не ждал
    res.sendStatus(200);
    
    if (update.message?.text === "/start") {
      console.log(`👋 Новый пользователь: ${update.message.chat.id}`);
      
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
      return;
    }
    
    if (update.callback_query) {
      const tgId = update.callback_query.from.id;
      const data = update.callback_query.data;
      
      console.log(`🔘 Callback от ${tgId}: ${data}`);
      
      // Отвечаем на callback query
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
        return;
      }
      
      if (data === "BUY_KEY") {
        const gift = await reserveGift(tgId);
        
        if (!gift) {
          await sendTG(tgId, "❌ К сожалению, ключи закончились");
          return;
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
        return;
      }
      
      if (data.startsWith("CANCEL:")) {
        const giftId = data.split(":")[1];
        await cancelReserve(giftId);
        await sendTG(tgId, "❌ Покупка отменена");
        return;
      }
    }
    
  } catch (e) {
    console.error("❌ TG ERROR:", e);
    // Не отправляем повторный статус, уже отправили в начале
  }
});

// Вебхук T-Bank
app.post("/tbank-webhook", async (req, res) => {
  try {
    console.log("💰 T-Bank webhook получен:", req.body);
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
    console.error("❌ T-Bank error:", e);
    res.sendStatus(200);
  }
});

// Тестовый маршрут
app.get("/test", (req, res) => {
  console.log("✅ Тестовый запрос получен");
  res.json({ 
    ok: true, 
    message: "Сервер работает!",
    timestamp: new Date().toISOString(),
    env: {
      hasToken: !!process.env.TG_TOKEN,
      hasSupabase: !!process.env.SUPABASE_URL,
      frontendUrl: process.env.FRONTEND_URL
    }
  });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
  console.log(`🌐 Frontend URL: ${process.env.FRONTEND_URL}`);
  console.log(`🤖 TG Token: ${process.env.TG_TOKEN ? 'установлен' : 'отсутствует'}`);
});