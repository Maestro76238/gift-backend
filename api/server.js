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
app.use(express.static(join(__dirname, 'public')));

console.log("⚡ Бот запущен");

// ============ КОНФИГ ============
const CONFIG = {
  TG_TOKEN: process.env.TG_TOKEN,
  ADMIN_ID: process.env.ADMIN_TG_ID,
  PROJECT: "gift-backend",
  FRONTEND_URL: process.env.FRONTEND_URL || "https://gift-backend-nine.vercel.app",
  
  // УМЕРЕННЫЙ KEEP-ALIVE
  KEEP_ALIVE_INTERVAL: 30 * 1000, // 30 секунд
  
  RATE_LIMIT: {
    MESSAGES_PER_MINUTE: 5,
    CALLBACKS_PER_MINUTE: 10,
    USER_COOLDOWN_MS: 1000,
    IP_COOLDOWN_MS: 500
  }
};

// ============ УМЕРЕННЫЙ KEEP-ALIVE ============
console.log(`🫀 Keep-alive: ${CONFIG.KEEP_ALIVE_INTERVAL}ms`);

let keepAliveCounter = 0;
const keepAliveEndpoints = ['/api/ping', '/api/stats', '/', '/health'];

const keepAliveInterval = setInterval(() => {
  keepAliveCounter++;
  const endpoint = keepAliveEndpoints[keepAliveCounter % keepAliveEndpoints.length];
  const startTime = Date.now();
  
  fetch(`${CONFIG.FRONTEND_URL}${endpoint}`, {
    signal: AbortSignal.timeout(5000)
  })
  .then(response => {
    const time = Date.now() - startTime;
    if (keepAliveCounter % 20 === 0) {
      console.log(`🫀 Keep-alive #${keepAliveCounter}: ${time}ms (${endpoint})`);
    }
  })
  .catch(() => {
    if (keepAliveCounter % 40 === 0) {
      console.log(`⚠️ Keep-alive #${keepAliveCounter} пропущен`);
    }
  });
}, CONFIG.KEEP_ALIVE_INTERVAL);

process.on('SIGTERM', () => {
  clearInterval(keepAliveInterval);
  console.log("🛑 Keep-alive остановлен");
});

// ============ ПРОВЕРКА ПОДКЛЮЧЕНИЙ ============
let supabase = null;
let dbStatus = { connected: false, error: null };
let telegramStatus = { connected: false, error: null };

async function checkSupabase() {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      dbStatus = { connected: false, error: "Нет переменных окружения Supabase" };
      return;
    }
    
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    
    const { data, error } = await supabase
      .from('gifts')
      .select('id, code')
      .limit(1);
    
    if (error) {
      dbStatus = { connected: false, error: error.message };
    } else {
      dbStatus = { connected: true };
    }
  } catch (error) {
    dbStatus = { connected: false, error: error.message };
  }
}

async function checkTelegram() {
  try {
    if (!CONFIG.TG_TOKEN) {
      telegramStatus = { connected: false, error: "Нет TG_TOKEN" };
      return;
    }
    
    const response = await fetch(
      `https://api.telegram.org/bot${CONFIG.TG_TOKEN}/getMe`,
      { signal: AbortSignal.timeout(3000) }
    );
    
    const data = await response.json();
    
    if (data.ok) {
      telegramStatus = { 
        connected: true, 
        bot: data.result.username,
        name: data.result.first_name
      };
    } else {
      telegramStatus = { connected: false, error: data.description };
    }
  } catch (error) {
    telegramStatus = { connected: false, error: error.message };
  }
}

(async () => {
  await Promise.all([checkSupabase(), checkTelegram()]);
  console.log("✅ Проверка подключений завершена");
  console.log(`📊 База данных: ${dbStatus.connected ? '✅ подключена' : '❌ ошибка'}`);
  console.log(`🤖 Telegram: ${telegramStatus.connected ? '✅ подключен (@' + telegramStatus.bot + ')' : '❌ ошибка'}`);
})();

// ============ СИСТЕМА ЗАЩИТЫ ============
const userRateLimit = new Map();
const ipRateLimit = new Map();
const userLastAction = new Map();

function checkUserRateLimit(userId, type = 'message') {
  const now = Date.now();
  const limit = type === 'callback' 
    ? CONFIG.RATE_LIMIT.CALLBACKS_PER_MINUTE 
    : CONFIG.RATE_LIMIT.MESSAGES_PER_MINUTE;
  
  const lastAction = userLastAction.get(userId);
  if (lastAction && (now - lastAction) < CONFIG.RATE_LIMIT.USER_COOLDOWN_MS) {
    return { allowed: false, reason: 'cooldown', wait: CONFIG.RATE_LIMIT.USER_COOLDOWN_MS - (now - lastAction) };
  }
  
  let userData = userRateLimit.get(userId);
  if (!userData) {
    userData = { count: 0, resetTime: now + 60000 };
    userRateLimit.set(userId, userData);
  }
  
  if (now > userData.resetTime) {
    userData.count = 0;
    userData.resetTime = now + 60000;
  }
  
  if (userData.count >= limit) {
    return { allowed: false, reason: 'rate_limit', resetIn: userData.resetTime - now };
  }
  
  userData.count++;
  userLastAction.set(userId, now);
  return { allowed: true };
}

function checkIPRateLimit(ip) {
  const now = Date.now();
  const ipData = ipRateLimit.get(ip);
  if (ipData && (now - ipData.lastRequest) < CONFIG.RATE_LIMIT.IP_COOLDOWN_MS) {
    return { allowed: false, reason: 'ip_cooldown' };
  }
  
  ipRateLimit.set(ip, { lastRequest: now });
  return { allowed: true };
}

setInterval(() => {
  const now = Date.now();
  const fiveMinutesAgo = now - 5 * 60 * 1000;
  
  for (const [userId, time] of userLastAction.entries()) {
    if (time < fiveMinutesAgo) userLastAction.delete(userId);
  }
  
  for (const [ip, data] of ipRateLimit.entries()) {
    if (data.lastRequest < fiveMinutesAgo) ipRateLimit.delete(ip);
  }
}, 5 * 60 * 1000);

// ============ ФУНКЦИИ ДЛЯ БД ============
async function reserveGiftForUser(tgUserId) {
  if (!dbStatus.connected || !supabase) {
    console.log("❌ Не могу зарезервировать подарок: БД не подключена");
    return null;
  }
  
  try {
    const { data: gift, error } = await supabase
      .from('gifts')
      .select('*')
      .eq('status', 'free')
      .eq('type', 'normal')
      .limit(1)
      .single();
    
    if (error || !gift) {
      console.log("❌ Нет свободных подарков или ошибка:", error?.message);
      return null;
    }
    
    const { error: updateError } = await supabase
      .from('gifts')
      .update({
        status: 'reserved',
        reserved: true,
        reserved_at: new Date().toISOString(),
        tg_user_id: tgUserId
      })
      .eq('id', gift.id);
    
    if (updateError) {
      console.log("❌ Ошибка обновления подарка:", updateError.message);
      return null;
    }
    
    console.log(`✅ Подарок ${gift.code} зарезервирован для пользователя ${tgUserId}`);
    return gift;
    
  } catch (error) {
    console.log("❌ Ошибка резервирования:", error.message);
    return null;
  }
}

async function getStatsFromDB() {
  if (!dbStatus.connected || !supabase) {
    return { normal_left: 0, vip_found: false, error: "БД не подключена" };
  }
  
  try {
    const { count: normal_left, error: normalError } = await supabase
      .from('gifts')
      .select('*', { count: 'exact', head: true })
      .eq('type', 'normal')
      .eq('status', 'free');
    
    const { data: vip_used, error: vipError } = await supabase
      .from('gifts')
      .select('id')
      .eq('type', 'vip')
      .eq('is_used', true)
      .limit(1);
    
    if (normalError || vipError) {
      return { normal_left: 0, vip_found: false, error: "Ошибка запроса" };
    }
    
    return {
      normal_left: normal_left || 0,
      vip_found: vip_used?.length > 0,
      db_connected: true
    };
    
  } catch (error) {
    return { normal_left: 0, vip_found: false, error: error.message };
  }
}

async function checkGiftCode(code) {
  if (!dbStatus.connected || !supabase) {
    return { ok: false, error: "БД не подключена" };
  }
  
  try {
    const { data, error } = await supabase
      .from('gifts')
      .select('id, code, type, is_used, status')
      .eq('code', code.toUpperCase())
      .maybeSingle();
    
    if (error) return { ok: false, error: "Ошибка базы данных" };
    if (!data) return { ok: false, error: "Код не найден" };
    if (data.is_used) return { ok: false, error: "Код уже использован" };
    if (data.status !== 'paid') return { ok: false, error: "Код не оплачен" };
    
    return { ok: true, gift: data };
    
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// ============ ОБЩИЕ ФУНКЦИИ ============
function sendInstant(chatId, text, options = {}) {
  if (!telegramStatus.connected) {
    console.log("❌ Не могу отправить сообщение: Telegram не подключен");
    return;
  }
  
  const message = {
    chat_id: chatId,
    text: text,
    ...options
  };
  
  fetch(`https://api.telegram.org/bot${CONFIG.TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(5000)
  })
  .then(response => response.json())
  .then(data => {
    if (!data.ok) {
      console.log(`❌ Ошибка отправки в Telegram: ${data.description}`);
    }
  })
  .catch(error => {
    console.log(`❌ Ошибка сети при отправке в Telegram: ${error.message}`);
  });
}

function answerCallbackFast(callbackId, text = "", showAlert = false) {
  if (!telegramStatus.connected) return;
  
  fetch(`https://api.telegram.org/bot${CONFIG.TG_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: callbackId,
      text: text,
      show_alert: showAlert
    }),
    signal: AbortSignal.timeout(3000)
  }).catch(() => {});
}

// ============ МАРШРУТЫ ============
app.get("/api/ping", (req, res) => {
  res.json({ 
    status: "alive", 
    project: CONFIG.PROJECT,
    keep_alive: "30s",
    timestamp: Date.now(),
    uptime: process.uptime().toFixed(2) + "s",
    requests: keepAliveCounter,
    db_connected: dbStatus.connected,
    tg_connected: telegramStatus.connected
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    keep_alive: "30s",
    project: CONFIG.PROJECT
  });
});

app.get("/api/health-check", (req, res) => {
  res.json({
    ok: true,
    message: "Сервер работает",
    time: Date.now(),
    keep_alive_requests: keepAliveCounter
  });
});

// ============ TELEGRAM WEBHOOK ============
app.get("/api/telegram-webhook", (req, res) => {
  console.log("📡 GET-запрос на /api/telegram-webhook");
  res.json({
    status: "active",
    service: "Telegram Webhook Endpoint",
    bot: telegramStatus.connected ? `@${telegramStatus.bot}` : "unknown",
    method: "GET received, use POST for Telegram updates",
    webhook_url: `${CONFIG.FRONTEND_URL}/api/telegram-webhook`,
    timestamp: new Date().toISOString(),
    instructions: "Этот endpoint принимает POST-запросы от Telegram Bot API"
  });
});

app.post("/api/telegram-webhook", async (req, res) => {
  console.log("📨 Входящий POST-запрос от Telegram");
  
  const clientIP = req.headers['x-forwarded-for'] || req.ip || 'unknown';
  res.sendStatus(200); // Важно: отвечаем сразу Telegram
  
  const update = req.body;
  const requestId = Date.now();
  
  if (update.message?.text === "/start") {
    const chatId = update.message.chat.id;
    const userId = update.message.from.id;
    const username = update.message.from.username || `user_${userId}`;
    
    console.log(`👤 Пользователь ${username} (${userId}) отправил /start`);
    
    const ipCheck = checkIPRateLimit(clientIP);
    if (!ipCheck.allowed) {
      console.log(`🚫 IP ${clientIP} в кулдауне`);
      return;
    }
    
    const userCheck = checkUserRateLimit(userId, 'message');
    if (!userCheck.allowed) {
      if (userCheck.reason === 'rate_limit') {
        sendInstant(chatId, `🚫 <b>Слишком много запросов!</b>\n\nПодождите ${Math.ceil(userCheck.resetIn / 1000)} секунд.`, {
          parse_mode: "HTML"
        });
      }
      console.log(`🚫 Пользователь ${userId} превысил лимит: ${userCheck.reason}`);
      return;
    }
    
    const stats = await getStatsFromDB();
    const dbStatusText = dbStatus.connected 
      ? `✅ База данных подключена\n🎁 Свободных ключей: ${stats.normal_left}` 
      : "⚠️ База данных offline";
    
    sendInstant(chatId,
`🎁 <b>НОВОГОДНЯЯ ИГРА 2026</b>

${dbStatusText}
🌐 Сайт: ${CONFIG.FRONTEND_URL}
🔒 Защита от флуда: активна
🫀 Keep-alive: 30 секунд

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
          [{ text: "🔍 ПРОВЕРИТЬ КОД", url: `${CONFIG.FRONTEND_URL}/check.html` }]
        ]
      }
    });
    
    return;
  }
  
  if (update.callback_query) {
    const callbackId = update.callback_query.id;
    const chatId = update.callback_query.from.id;
    const userId = update.callback_query.from.id;
    const data = update.callback_query.data;
    const parts = data.split('_');
    const action = parts[0];
    
    console.log(`🖱️ Callback от пользователя ${userId}: ${action}`);
    
    const ipCheck = checkIPRateLimit(clientIP);
    if (!ipCheck.allowed) {
      answerCallbackFast(callbackId, "Подождите...", true);
      return;
    }
    
    const userCheck = checkUserRateLimit(userId, 'callback');
    if (!userCheck.allowed) {
      if (userCheck.reason === 'cooldown') {
        answerCallbackFast(callbackId, `Подождите ${Math.ceil(userCheck.wait / 1000)}с...`, true);
      }
      return;
    }
    
    answerCallbackFast(callbackId);
    
    switch (action) {
      case "STATS":
        const stats = await getStatsFromDB();
        let statsText = "📊 <b>СТАТИСТИКА ИЗ БАЗЫ</b>\n\n";
        
        if (stats.error) {
          statsText += `⚠️ Ошибка: ${stats.error}\n`;
        } else {
          statsText += `🎁 Свободных ключей: <b>${stats.normal_left}</b>\n`;
          statsText += `💎 VIP-билет: ${stats.vip_found ? "❌ Найден" : "🎯 В игре"}\n`;
        }
        
        statsText += `\n🌐 Проверить код: ${CONFIG.FRONTEND_URL}/check.html`;
        
        sendInstant(chatId, statsText, { parse_mode: "HTML" });
        break;
        
      case "BUY":
        const gift = await reserveGiftForUser(userId);
        
        if (!gift) {
          sendInstant(chatId, "❌ К сожалению, ключи закончились или произошла ошибка");
          break;
        }
        
        sendInstant(chatId,
`💳 <b>ОПЛАТА 100 ₽</b>

✅ Подарок зарезервирован!
🔑 Код: ${gift.code}

🎯 Шанс на VIP-билет
💰 Участие в розыгрыше 100К

<b>Возраст:</b> от 14 лет
<b>Возврат:</b> не предусмотрен

👇 Нажмите для оплаты:`, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "💳 ОПЛАТИТЬ (T-Банк)", url: "https://t.me/gift_celler_bot" }],
              [{ text: "❌ ОТМЕНА", callback_data: `CANCEL_${Date.now()}_${userId}` }]
            ]
          }
        });
        break;
        
      case "CANCEL":
        sendInstant(chatId, "❌ Покупка отменена");
        break;
    }
  }
});

app.get("/api/stats", async (req, res) => {
  const stats = await getStatsFromDB();
  
  res.json({
    ...stats,
    site_url: CONFIG.FRONTEND_URL,
    check_url: `${CONFIG.FRONTEND_URL}/check.html`,
    timestamp: new Date().toISOString(),
    keep_alive: "30s",
    keep_alive_requests: keepAliveCounter
  });
});

app.get("/api/check-gift/:code", async (req, res) => {
  const code = req.params.code.toUpperCase();
  const result = await checkGiftCode(code);
  
  if (!result.ok) {
    return res.status(404).json({
      ok: false,
      message: result.error,
      code: code,
      site_url: CONFIG.FRONTEND_URL
    });
  }
  
  res.json({
    ok: true,
    gift: result.gift,
    site_url: CONFIG.FRONTEND_URL,
    check_url: `${CONFIG.FRONTEND_URL}/check.html`
  });
});

app.post("/api/use-gift/:code", async (req, res) => {
  const code = req.params.code.toUpperCase();
  
  if (!dbStatus.connected || !supabase) {
    return res.status(500).json({ ok: false, error: "БД не подключена" });
  }
  
  try {
    const { data: gift, error } = await supabase
      .from('gifts')
      .update({
        is_used: true,
        used_at: new Date().toISOString(),
        status: 'used'
      })
      .eq('code', code)
      .eq('is_used', false)
      .select()
      .maybeSingle();
    
    if (error) return res.status(500).json({ ok: false, error: "Ошибка базы данных" });
    if (!gift) return res.status(400).json({ ok: false, message: "Код не найден или уже использован" });
    
    if (CONFIG.ADMIN_ID && telegramStatus.connected) {
      sendInstant(CONFIG.ADMIN_ID, `🎁 Код активирован: ${code}`);
    }
    
    res.json({ ok: true, message: "Код успешно активирован", gift_code: gift.code });
    
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/status", async (req, res) => {
  await Promise.all([checkSupabase(), checkTelegram()]);
  
  const stats = await getStatsFromDB();
  
  res.json({
    project: CONFIG.PROJECT,
    timestamp: new Date().toISOString(),
    
    database: {
      connected: dbStatus.connected,
      table: 'gifts',
      stats: stats
    },
    
    telegram: telegramStatus,
    
    frontend: {
      url: CONFIG.FRONTEND_URL,
      endpoints: {
        check_code: `${CONFIG.FRONTEND_URL}/check.html`,
        api_stats: `${CONFIG.FRONTEND_URL}/api/stats`,
        webhook: `${CONFIG.FRONTEND_URL}/api/telegram-webhook`
      }
    },
    
    keep_alive: {
      interval: "30s",
      requests: keepAliveCounter,
      endpoints: keepAliveEndpoints
    },
    
    security: {
      active_users: userLastAction.size,
      active_ips: ipRateLimit.size,
      rate_limits: CONFIG.RATE_LIMIT
    }
  });
});

app.get("/", (req, res) => {
  res.redirect("/index.html");
});

app.use((req, res) => {
  res.status(404).json({ error: "Не найдено", path: req.path });
});

app.use((err, req, res, next) => {
  console.error("❌ Ошибка сервера:", err);
  res.status(500).json({ error: "Внутренняя ошибка сервера" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`🌐 Frontend URL: ${CONFIG.FRONTEND_URL}`);
});

export default app;