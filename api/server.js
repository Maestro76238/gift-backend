import express from "express";
import fetch from "node-fetch";
import 'dotenv/config';
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

console.log("🚀 Бот запущен (исправленная версия)");

// ============ КОНФИГ ============
const CONFIG = {
  TG_TOKEN: process.env.TG_TOKEN,
  ADMIN_ID: process.env.ADMIN_TG_ID,
  PROJECT: "gift-backend-nine"
};

// ============ ИНИЦИАЛИЗАЦИЯ ============
let supabase;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  console.log("✅ Supabase подключен");
}

// ============ БЫСТРЫЕ ФУНКЦИИ ============

// Мгновенная отправка (не ждем ответа)
function sendInstant(chatId, text, options = {}) {
  const message = {
    chat_id: chatId,
    text: text,
    ...options
  };
  
  fetch(`https://api.telegram.org/bot${CONFIG.TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message)
  }).catch(() => {});
}

// Быстрый ответ на callback
function answerCallbackFast(callbackId, text = "", showAlert = false) {
  fetch(`https://api.telegram.org/bot${CONFIG.TG_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: callbackId,
      text: text,
      show_alert: showAlert
    })
  }).catch(() => {});
}

// ============ TELEGRAM WEBHOOK ============

app.post("/api/telegram-webhook", async (req, res) => {
  // ВАЖНО: Отвечаем СРАЗУ
  res.sendStatus(200);
  
  const update = req.body;
  const requestId = Date.now();
  
  console.log(`📨 Запрос ${requestId}:`, 
    update.message ? "Сообщение" : 
    update.callback_query ? "Callback" : 
    "Другое"
  );
  
  // 📨 Обработка /start
  if (update.message?.text === "/start") {
    const chatId = update.message.chat.id;
    
    sendInstant(chatId,
`🎁 <b>НОВОГОДНЯЯ ИГРА 2026</b>

✅ <b>Быстрый ответ!</b>
⏱️ Запрос ID: ${requestId}

🎯 Купи ключ - получи подарок
💰 Шанс на 100 000 ₽
⏳ Розыгрыш 31 декабря

<b>Цена:</b> 100 ₽
<b>Возраст:</b> от 14 лет
<b>Возврат:</b> не предусмотрен

👇 Выберите действие:`, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🎯 КУПИТЬ КЛЮЧ", callback_data: `BUY_${requestId}` }],
          [{ text: "📊 СТАТИСТИКА", callback_data: `STATS_${requestId}` }],
          [{ text: "❓ FAQ", url: "https://telegra.ph/FAQ-12-16-21" }]
        ]
      }
    });
    
    return;
  }
  
  // 🔘 Обработка CALLBACK (СИНХРОННО и БЫСТРО)
  if (update.callback_query) {
    const callbackId = update.callback_query.id;
    const chatId = update.callback_query.from.id;
    const data = update.callback_query.data;
    const originalRequestId = data.split('_')[1] || 'unknown';
    
    console.log(`🔘 Callback ${requestId} для запроса ${originalRequestId}: ${data}`);
    
    // 1. СРАЗУ отвечаем на callback
    answerCallbackFast(callbackId);
    
    // 2. Обрабатываем действие СРАЗУ
    if (data.startsWith("STATS_")) {
      // Быстрая статистика без запросов к базе
      sendInstant(chatId,
`📊 <b>СТАТИСТИКА</b>

🎁 Осталось ключей: <b>2</b>
💎 VIP-билет: 🎯 В ИГРЕ
⚡ Ответ: мгновенный
📋 Запрос ID: ${originalRequestId}

👇 Успей купить ключ!`, {
        parse_mode: "HTML"
      });
    }
    
    else if (data.startsWith("BUY_")) {
      // Быстрая покупка
      sendInstant(chatId,
`💳 <b>ОПЛАТА 100 ₽</b>

✅ Гарантированный подарок
🎯 Шанс на VIP-билет
💰 Участие в розыгрыше

<b>Возраст:</b> от 14 лет
<b>Возврат:</b> не предусмотрен
📋 Запрос ID: ${originalRequestId}

👇 Нажмите для оплаты:`, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "💳 ОПЛАТИТЬ (T-Банк)", url: "https://t.me/gift_celler_bot" }],
            [{ text: "❌ ОТМЕНА", callback_data: `CANCEL_${originalRequestId}` }]
          ]
        }
      });
    }
    
    else if (data.startsWith("CANCEL_")) {
      sendInstant(chatId, `❌ Покупка отменена\n📋 Запрос ID: ${originalRequestId}`);
    }
  }
});

// ============ API МАРШРУТЫ ============

// Статистика (упрощенная)
app.get("/api/stats", (req, res) => {
  res.json({
    normal_left: 2,
    vip_found: false,
    project: CONFIG.PROJECT,
    response: "instant"
  });
});

// Проверка кода
app.get("/api/check-gift/:code", (req, res) => {
  const code = req.params.code.toUpperCase();
  res.json({
    ok: true,
    code: code,
    gift: { type: "normal", status: "valid" },
    note: "Демо-режим"
  });
});

// Keep-alive
app.get("/api/ping", (req, res) => {
  res.json({ status: "alive", project: CONFIG.PROJECT, time: Date.now() });
});

// Установка вебхука
app.get("/api/setup", async (req, res) => {
  const webhookUrl = `https://gift-backend-nine.vercel.app/api/telegram-webhook`;
  
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${CONFIG.TG_TOKEN}/setWebhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          drop_pending_updates: true,
          max_connections: 100
        })
      }
    );
    
    const result = await response.json();
    res.json({ ok: true, result, webhookUrl });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Keep-alive каждые 4 минуты
setInterval(() => {
  fetch("https://gift-backend-nine.vercel.app/api/ping").catch(() => {});
}, 4 * 60 * 1000);

// Главная
app.get("/", (req, res) => {
  res.redirect("/index.html");
});

export default app;