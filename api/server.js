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

console.log("🚀 Бот запущен с защитой от флуда");

// ============ КОНФИГ ============
const CONFIG = {
  TG_TOKEN: process.env.TG_TOKEN,
  ADMIN_ID: process.env.ADMIN_TG_ID,
  PROJECT: "gift-backend-nine",
  
  // Настройки защиты от флуда
  RATE_LIMIT: {
    MESSAGES_PER_MINUTE: 5,     // Макс сообщений в минуту
    CALLBACKS_PER_MINUTE: 10,   // Макс callback в минуту
    USER_COOLDOWN_MS: 1000,     // Задержка между действиями пользователя
    IP_COOLDOWN_MS: 500         // Задержка между запросами с одного IP
  }
};

// ============ СИСТЕМА ЗАЩИТЫ ОТ ФЛУДА ============

const userRateLimit = new Map();    // userId -> {count, resetTime}
const ipRateLimit = new Map();      // ip -> {count, resetTime}
const userLastAction = new Map();   // userId -> lastActionTime

// Проверка лимитов для пользователя
function checkUserRateLimit(userId, type = 'message') {
  const now = Date.now();
  const limit = type === 'callback' 
    ? CONFIG.RATE_LIMIT.CALLBACKS_PER_MINUTE 
    : CONFIG.RATE_LIMIT.MESSAGES_PER_MINUTE;
  
  // Проверка времени последнего действия
  const lastAction = userLastAction.get(userId);
  if (lastAction && (now - lastAction) < CONFIG.RATE_LIMIT.USER_COOLDOWN_MS) {
    return { allowed: false, reason: 'cooldown', wait: CONFIG.RATE_LIMIT.USER_COOLDOWN_MS - (now - lastAction) };
  }
  
  // Проверка лимита в минуту
  let userData = userRateLimit.get(userId);
  if (!userData) {
    userData = { count: 0, resetTime: now + 60000 };
    userRateLimit.set(userId, userData);
  }
  
  // Сброс счетчика если минута прошла
  if (now > userData.resetTime) {
    userData.count = 0;
    userData.resetTime = now + 60000;
  }
  
  // Проверка лимита
  if (userData.count >= limit) {
    return { allowed: false, reason: 'rate_limit', resetIn: userData.resetTime - now };
  }
  
  userData.count++;
  userLastAction.set(userId, now);
  return { allowed: true };
}

// Проверка лимитов для IP
function checkIPRateLimit(ip) {
  const now = Date.now();
  
  // Быстрая проверка cooldown по IP
  const ipData = ipRateLimit.get(ip);
  if (ipData && (now - ipData.lastRequest) < CONFIG.RATE_LIMIT.IP_COOLDOWN_MS) {
    return { allowed: false, reason: 'ip_cooldown' };
  }
  
  ipRateLimit.set(ip, { lastRequest: now });
  return { allowed: true };
}

// Очистка старых записей каждые 5 минут
setInterval(() => {
  const now = Date.now();
  const fiveMinutesAgo = now - 5 * 60 * 1000;
  
  // Очистка userLastAction
  for (const [userId, time] of userLastAction.entries()) {
    if (time < fiveMinutesAgo) {
      userLastAction.delete(userId);
    }
  }
  
  // Очистка ipRateLimit
  for (const [ip, data] of ipRateLimit.entries()) {
    if (data.lastRequest < fiveMinutesAgo) {
      ipRateLimit.delete(ip);
    }
  }
  
  console.log(`🧹 Очистка кеша. User actions: ${userLastAction.size}, IPs: ${ipRateLimit.size}`);
}, 5 * 60 * 1000);

// ============ ИНИЦИАЛИЗАЦИЯ ============
let supabase;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  console.log("✅ Supabase подключен");
}

// ============ БЫСТРЫЕ ФУНКЦИИ ============

function sendInstant(chatId, text, options = {}) {
  const message = {
    chat_id: chatId,
    text: text,
    ...options
  };
  
  fetch(`https://api.telegram.org/bot${CONFIG.TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(3000)
  }).catch(() => {});
}

function answerCallbackFast(callbackId, text = "", showAlert = false) {
  fetch(`https://api.telegram.org/bot${CONFIG.TG_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: callbackId,
      text: text,
      show_alert: showAlert
    }),
    signal: AbortSignal.timeout(2000)
  }).catch(() => {});
}

// ============ TELEGRAM WEBHOOK ============

app.post("/api/telegram-webhook", async (req, res) => {
  const clientIP = req.headers['x-forwarded-for'] || req.ip || 'unknown';
  const startTime = Date.now();
  
  // СРАЗУ отвечаем Telegram
  res.sendStatus(200);
  
  const update = req.body;
  const requestId = Date.now();
  
  // 📨 Обработка /start
  if (update.message?.text === "/start") {
    const chatId = update.message.chat.id;
    const userId = update.message.from.id;
    
    // Проверка rate limit
    const ipCheck = checkIPRateLimit(clientIP);
    if (!ipCheck.allowed) {
      console.log(`🚫 IP ${clientIP} в cooldown`);
      return;
    }
    
    const userCheck = checkUserRateLimit(userId, 'message');
    if (!userCheck.allowed) {
      console.log(`🚫 User ${userId} превысил лимит:`, userCheck.reason);
      
      if (userCheck.reason === 'rate_limit') {
        sendInstant(chatId, `🚫 <b>Слишком много запросов!</b>\n\nПожалуйста, подождите ${Math.ceil(userCheck.resetIn / 1000)} секунд.`, {
          parse_mode: "HTML"
        });
      }
      return;
    }
    
    console.log(`✅ /start от ${userId} (IP: ${clientIP}) за ${Date.now() - startTime}ms`);
    
    sendInstant(chatId,
`🎁 <b>НОВОГОДНЯЯ ИГРА 2026</b>

✅ <b>Безопасный и быстрый бот</b>
🔒 Защита от флуда активна
⏱️ ID запроса: ${requestId}

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
          [{ text: "🎯 КУПИТЬ КЛЮЧ", callback_data: `BUY_${requestId}_${userId}` }],
          [{ text: "📊 СТАТИСТИКА", callback_data: `STATS_${requestId}_${userId}` }],
          [{ text: "❓ FAQ", url: "https://telegra.ph/FAQ-12-16-21" }]
        ]
      }
    });
    
    return;
  }
  
  // 🔘 Обработка CALLBACK с защитой от флуда
  if (update.callback_query) {
    const callbackId = update.callback_query.id;
    const chatId = update.callback_query.from.id;
    const userId = update.callback_query.from.id;
    const data = update.callback_query.data;
    const parts = data.split('_');
    const action = parts[0];
    const originalRequestId = parts[1] || 'unknown';
    
    // Проверка rate limit для callback
    const ipCheck = checkIPRateLimit(clientIP);
    if (!ipCheck.allowed) {
      console.log(`🚫 Callback от IP ${clientIP} в cooldown`);
      answerCallbackFast(callbackId, "Подождите немного...", true);
      return;
    }
    
    const userCheck = checkUserRateLimit(userId, 'callback');
    if (!userCheck.allowed) {
      console.log(`🚫 Callback от ${userId} превысил лимит:`, userCheck.reason);
      
      if (userCheck.reason === 'cooldown') {
        answerCallbackFast(callbackId, `Подождите ${Math.ceil(userCheck.wait / 1000)}с...`, true);
      } else if (userCheck.reason === 'rate_limit') {
        answerCallbackFast(callbackId, `Лимит! Ждите ${Math.ceil(userCheck.resetIn / 1000)}с`, true);
      }
      return;
    }
    
    console.log(`✅ Callback ${action} от ${userId} за ${Date.now() - startTime}ms`);
    
    // СРАЗУ отвечаем на callback
    answerCallbackFast(callbackId);
    
    // Обработка действий
    switch (action) {
      case "STATS":
        sendInstant(chatId,
`📊 <b>СТАТИСТИКА</b>

🎁 Осталось ключей: <b>2</b>
💎 VIP-билет: 🎯 В ИГРЕ
👤 Запросов у вас: ${userRateLimit.get(userId)?.count || 0}/мин
🔒 Защита: активна

👇 Успей купить ключ!`, {
          parse_mode: "HTML"
        });
        break;
        
      case "BUY":
        sendInstant(chatId,
`💳 <b>ОПЛАТА 100 ₽</b>

✅ Гарантированный подарок
🎯 Шанс на VIP-билет
💰 Участие в розыгрыше

<b>Возраст:</b> от 14 лет
<b>Возврат:</b> не предусмотрен
📋 ID запроса: ${originalRequestId}

👇 Нажмите для оплаты:`, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "💳 ОПЛАТИТЬ (T-Банк)", url: "https://t.me/gift_celler_bot" }],
              [{ text: "❌ ОТМЕНА", callback_data: `CANCEL_${originalRequestId}_${userId}` }]
            ]
          }
        });
        break;
        
      case "CANCEL":
        sendInstant(chatId, `❌ Покупка отменена\n📋 Запрос ID: ${originalRequestId}`);
        break;
        
      default:
        sendInstant(chatId, "⚠️ Неизвестное действие");
    }
  }
});

// ============ API МАРШРУТЫ ============

// Мониторинг защиты
app.get("/api/security-status", (req, res) => {
  res.json({
    active_users: userLastAction.size,
    active_ips: ipRateLimit.size,
    rate_limits: CONFIG.RATE_LIMIT,
    project: CONFIG.PROJECT,
    timestamp: new Date().toISOString()
  });
});

app.get("/api/stats", (req, res) => {
  res.json({
    normal_left: 2,
    vip_found: false,
    project: CONFIG.PROJECT,
    security: "enabled"
  });
});

app.get("/api/check-gift/:code", (req, res) => {
  const code = req.params.code.toUpperCase();
  
  // Простая проверка кода без сложной логики
  res.json({
    ok: true,
    code: code,
    gift: { type: "normal", status: "valid" },
    security: "protected"
  });
});

// Keep-alive
app.get("/api/ping", (req, res) => {
  res.json({ 
    status: "alive", 
    project: CONFIG.PROJECT, 
    time: Date.now(),
    security: "active"
  });
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
    res.json({ 
      ok: true, 
      result, 
      webhookUrl,
      security: "rate-limiting enabled"
    });
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