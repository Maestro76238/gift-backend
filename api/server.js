import express from "express";
import fetch from "node-fetch";
import 'dotenv/config';
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.use(express.json());

// ============ КОНФИГ ДЛЯ RENDER ============
const CONFIG = {
  TG_TOKEN: process.env.TG_TOKEN,
  ADMIN_ID: process.env.ADMIN_TG_ID,
  PROJECT: "gift-backend",
  // Используем Render URL если есть, иначе дефолтный
  FRONTEND_URL: process.env.RENDER_EXTERNAL_URL || process.env.FRONTEND_URL || "https://your-render-app.onrender.com",
  
  // На Render нужен менее частый keep-alive (каждые 10 минут)
  KEEP_ALIVE_INTERVAL: process.env.RENDER ? (10 * 60 * 1000) : (30 * 1000),
  
  RATE_LIMIT: {
    MESSAGES_PER_MINUTE: 5,
    CALLBACKS_PER_MINUTE: 10,
    USER_COOLDOWN_MS: 1000,
    IP_COOLDOWN_MS: 500
  },
  
  // Флаг что мы на Render
  IS_RENDER: process.env.RENDER || false,
  RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL || ""
};

console.log("⚡ Бот запущен");
console.log(`🌐 Environment: ${CONFIG.IS_RENDER ? 'Render.com' : 'Development'}`);
console.log(`🔗 Frontend URL: ${CONFIG.FRONTEND_URL}`);

// ============ ПУТЬ К СТАТИЧЕСКИМ ФАЙЛАМ ============
const publicPathVercel = join(__dirname, 'public');
const publicPathLocal = join(__dirname, '../public');
const publicPathRender = join(__dirname, 'public');

// Проверяем разные пути для разных сред
if (existsSync(publicPathRender)) {
  console.log(`📁 Использую путь для Render: ${publicPathRender}`);
  app.use(express.static(publicPathRender));
} else if (existsSync(publicPathVercel)) {
  console.log(`📁 Использую путь для Vercel: ${publicPathVercel}`);
  app.use(express.static(publicPathVercel));
} else if (existsSync(publicPathLocal)) {
  console.log(`📁 Использую путь для локальной разработки: ${publicPathLocal}`);
  app.use(express.static(publicPathLocal));
} else {
  console.log('⚠️ Папка public не найдена');
}

// ============ УМНЫЙ KEEP-ALIVE ДЛЯ RENDER ============
let keepAliveCounter = 0;
let keepAliveInterval = null;

function startKeepAlive() {
  if (!CONFIG.IS_RENDER || !CONFIG.RENDER_EXTERNAL_URL) {
    console.log("🫀 Keep-alive: отключен (не на Render или нет URL)");
    return;
  }
  
  console.log(`🫀 Keep-alive запущен: ${CONFIG.KEEP_ALIVE_INTERVAL / 1000} секунд`);
  
  const endpoints = ['/api/ping', '/api/stats', '/health', '/'];
  
  keepAliveInterval = setInterval(() => {
    keepAliveCounter++;
    const endpoint = endpoints[keepAliveCounter % endpoints.length];
    const startTime = Date.now();
    
    fetch(`${CONFIG.RENDER_EXTERNAL_URL}${endpoint}`, {
      signal: AbortSignal.timeout(10000) // 10 секунд таймаут
    })
    .then(response => {
      const time = Date.now() - startTime;
      if (keepAliveCounter % 6 === 0) { // Логируем каждые ~60 минут
        console.log(`🫀 Keep-alive #${keepAliveCounter}: ${time}ms (${endpoint})`);
      }
    })
    .catch(error => {
      if (keepAliveCounter % 3 === 0) { // Логируем ошибки каждые ~30 минут
        console.log(`⚠️ Keep-alive #${keepAliveCounter} ошибка: ${error.message}`);
      }
    });
  }, CONFIG.KEEP_ALIVE_INTERVAL);
}

// Запускаем keep-alive только на Render
if (CONFIG.IS_RENDER) {
  startKeepAlive();
}

process.on('SIGTERM', () => {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    console.log("🛑 Keep-alive остановлен");
  }
});

// ============ ПРОВЕРКА ПОДКЛЮЧЕНИЙ ============
let supabase = null;
let dbStatus = { connected: false, error: null };
let telegramStatus = { connected: false, error: null };

async function checkSupabase() {
  try {
    console.log("🔍 Проверяю подключение к Supabase...");
    
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      dbStatus = { connected: false, error: "Нет переменных окружения Supabase" };
      console.log("❌ Нет переменных окружения");
      return;
    }
    
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false }
    });
    console.log("✅ Клиент Supabase создан");
    
    const { data, error } = await supabase
      .from('gifts')
      .select('id, code')
      .limit(1);
    
    if (error) {
      console.log("❌ Ошибка запроса к БД:", error.message);
      dbStatus = { connected: false, error: error.message };
    } else {
      console.log("✅ Подключение к БД успешно. Найдено записей:", data?.length || 0);
      dbStatus = { connected: true };
    }
  } catch (error) {
    console.log("❌ Ошибка в checkSupabase:", error.message);
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
      { signal: AbortSignal.timeout(5000) }
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
  await checkSupabase();
  console.log(`📊 База данных: ${dbStatus.connected ? '✅ подключена' : '❌ ошибка'}`);
  console.log(`🤖 Telegram: Будет проверяться при первом запросе`);
})();

// ============ СИСТЕМА ЗАЩИТЫ (оставляем как есть) ============
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

// ============ ФУНКЦИИ ДЛЯ БД (оставляем как есть) ============
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
    const { count: freeCount, error: freeError } = await supabase
      .from('gifts')
      .select('*', { count: 'exact', head: true })
      .eq('is_used', false)
      .eq('status', 'free');
    
    if (freeError) throw freeError;
    
    const { data: vipData, error: vipError } = await supabase
      .from('gifts')
      .select('id')
      .eq('type', 'vip')
      .eq('is_used', false)
      .limit(1);
    
    const vipFound = vipData && vipData.length > 0;
    
    const { count: totalCount, error: totalError } = await supabase
      .from('gifts')
      .select('*', { count: 'exact', head: true });
    
    return {
      normal_left: freeCount || 0,
      vip_found: vipFound,
      db_connected: true,
      total_gifts: totalCount || 0,
      free_gifts: freeCount || 0,
      error: null
    };
    
  } catch (error) {
    console.log(`❌ Ошибка запроса: ${error.message}`);
    return { 
      normal_left: 0, 
      vip_found: false, 
      error: error.message,
      db_connected: false 
    };
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

// ============ ОБЩИЕ ФУНКЦИИ (оставляем как есть) ============
function sendInstant(chatId, text, options = {}) {
  const message = {
    chat_id: chatId,
    text: text,
    parse_mode: options.parse_mode || "HTML",
    ...options
  };
  
  fetch(`https://api.telegram.org/bot${CONFIG.TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message)
  })
  .then(response => response.json())
  .then(data => {
    if (!data.ok) {
      console.log(`❌ Ошибка отправки в Telegram: ${data.description}`);
      
      if (data.description && data.description.includes("can't parse entities")) {
        const plainMessage = {
          chat_id: chatId,
          text: text.replace(/<[^>]*>/g, ''),
          reply_markup: options.reply_markup
        };
        
        fetch(`https://api.telegram.org/bot${CONFIG.TG_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(plainMessage)
        });
      }
    } else {
      console.log(`✅ Сообщение отправлено пользователю ${chatId}`);
    }
  })
  .catch(error => {
    console.log(`❌ Ошибка сети при отправке в Telegram: ${error.message}`);
  });
}

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

// ============ МАРШРУТЫ (добавляем keep-alive info) ============
app.get("/api/ping", (req, res) => {
  res.json({ 
    status: "alive", 
    project: CONFIG.PROJECT,
    environment: CONFIG.IS_RENDER ? "Render.com" : "Development",
    keep_alive: CONFIG.IS_RENDER ? "10m" : "30s",
    keep_alive_counter: keepAliveCounter,
    timestamp: Date.now(),
    uptime: process.uptime().toFixed(2) + "s",
    db_connected: dbStatus.connected,
    tg_connected: telegramStatus.connected
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: CONFIG.IS_RENDER ? "Render.com" : "Development",
    keep_alive: CONFIG.IS_RENDER ? "active" : "inactive",
    project: CONFIG.PROJECT
  });
});

app.get("/api/health-check", (req, res) => {
  res.json({
    ok: true,
    message: "Сервер работает",
    time: Date.now(),
    keep_alive_requests: keepAliveCounter,
    environment: CONFIG.IS_RENDER ? "Render.com" : "Development"
  });
});

// ============ TELEGRAM WEBHOOK (оставляем как есть) ============
app.post("/api/telegram-webhook", async (req, res) => {
  console.log("📨 Входящий POST-запрос от Telegram");
  
  const clientIP = req.headers['x-forwarded-for'] || req.ip || 'unknown';
  
  // Отправляем ответ Telegram сразу
  res.sendStatus(200);
  
  const update = req.body;
  
  // Обработка команд из сообщений
  if (update.message) {
    const chatId = update.message.chat.id;
    const userId = update.message.from.id;
    const username = update.message.from.username || `user_${userId}`;
    const text = update.message.text || '';
    
    console.log(`👤 Пользователь ${username} (${userId}): "${text}"`);
    
    // Проверка rate limit
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
    
    // Обработка команд
    if (text === "/start" || text === "/start@GiftCellerBot") {
      await handleStartCommand(chatId, userId, username);
    } else if (text.startsWith("/")) {
      sendInstant(chatId, "⚠️ Неизвестная команда. Используйте /start");
    }
    
    return;
  }
  
  // Обработка callback-запросов
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query, clientIP);
  }
});

// ============ ФУНКЦИЯ ДЛЯ КОМАНДЫ /start (добавляем инфо о Render) ============
async function handleStartCommand(chatId, userId, username) {
  console.log(`🎯 Обработка /start для пользователя ${username} (${userId})`);
  
  const stats = await getStatsFromDB();
  const environmentInfo = CONFIG.IS_RENDER ? "\n☁️ Хостинг: Render.com" : "";
  
  const dbStatusText = dbStatus.connected 
    ? `✅ База данных подключена\n🎁 Свободных ключей: ${stats.normal_left}` 
    : "⚠️ База данных offline";
  
  sendInstant(chatId,
`🎁 <b>НОВОГОДНЯЯ ИГРА 2026</b>

${dbStatusText}
🌐 Сайт: ${CONFIG.FRONTEND_URL}${environmentInfo}
🔒 Защита от флуда: активна
🫀 Keep-alive: ${CONFIG.IS_RENDER ? "10 минут" : "30 секунд"}

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
        [{ text: "🎯 КУПИТЬ КЛЮЧ", callback_data: "BUY" }],
        [{ text: "📊 СТАТИСТИКА", callback_data: "STATS" }],
        [{ text: "🔍 ПРОВЕРИТЬ КОД", url: `${CONFIG.FRONTEND_URL}/check.html` }]
      ]
    }
  });
}

// ============ ФУНКЦИЯ ДЛЯ ОБРАБОТКИ CALLBACK ============
async function handleCallbackQuery(callbackQuery, clientIP) {
  const callbackId = callbackQuery.id;
  const chatId = callbackQuery.message?.chat?.id;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;
  
  console.log(`🖱️ Callback от ${userId}: ${data}`);
  
  // Проверка rate limit
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
  
  // Отвечаем на callback сразу
  answerCallbackFast(callbackId);
  
  switch (data) {
    case "STATS":
      await handleStatsCallback(chatId, userId);
      break;
      
    case "BUY":
      await handleBuyCallback(chatId, userId);
      break;
      
    case "CANCEL":
      sendInstant(chatId, "❌ Покупка отменена");
      break;
      
    default:
      console.log(`⚠️ Неизвестный callback_data: ${data}`);
      sendInstant(chatId, "⚠️ Неизвестное действие");
  }
}

// ============ ОБРАБОТКА СТАТИСТИКИ (добавляем keep-alive info) ============
async function handleStatsCallback(chatId, userId) {
  const stats = await getStatsFromDB();
  let statsText = "📊 <b>СТАТИСТИКА ИЗ БАЗЫ</b>\n\n";
  
  if (stats.error) {
    statsText += `⚠️ Ошибка: ${stats.error}\n`;
  } else {
    statsText += `🎁 Всего подарков: <b>${stats.total_gifts || 0}</b>\n`;
    statsText += `🎁 Свободных ключей: <b>${stats.normal_left || 0}</b>\n`;
    statsText += `💎 VIP-билет: ${stats.vip_found ? "🎯 В игре" : "❌ Не найден"}\n`;
    statsText += `🫀 Keep-alive запросов: <b>${keepAliveCounter}</b>\n`;
    statsText += `☁️ Хостинг: <b>Render.com</b>`;
  }
  
  statsText += `\n🌐 Проверить код: ${CONFIG.FRONTEND_URL}/check.html`;
  
  sendInstant(chatId, statsText, { parse_mode: "HTML" });
}

// ============ ОБРАБОТКА ПОКУПКИ (оставляем как есть) ============
async function handleBuyCallback(chatId, userId) {
  const gift = await reserveGiftForUser(userId);
  
  if (!gift) {
    sendInstant(chatId, 
      "❌ К сожалению, ключи временно закончились.\n\nПопробуйте позже или проверьте статистику.",
      { parse_mode: "HTML" }
    );
    return;
  }
  
  sendInstant(chatId,
`💳 <b>ОПЛАТА 100 ₽</b>

✅ Подарок зарезервирован!
🔑 Код: <code>${gift.code}</code>

🎯 Шанс на VIP-билет
💰 Участие в розыгрыше 100К

<b>Возраст:</b> от 14 лет
<b>Возврат:</b> не предусмотрен

👇 Нажмите для оплаты:`, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "💳 ОПЛАТИТЬ 100 ₽", url: "https://t.me/gift_celler_bot" }],
        [{ text: "❌ ОТМЕНА", callback_data: "CANCEL" }]
      ]
    }
  });
}

// ============ ОСТАЛЬНЫЕ МАРШРУТЫ (оставляем как есть) ============
app.get("/api/stats", async (req, res) => {
  const stats = await getStatsFromDB();
  
  res.json({
    ...stats,
    site_url: CONFIG.FRONTEND_URL,
    check_url: `${CONFIG.FRONTEND_URL}/check.html`,
    timestamp: new Date().toISOString(),
    environment: CONFIG.IS_RENDER ? "Render.com" : "Development",
    keep_alive: CONFIG.IS_RENDER ? "10m" : "30s",
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
    
    if (CONFIG.ADMIN_ID) {
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
    environment: CONFIG.IS_RENDER ? "Render.com" : "Development",
    
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
      active: CONFIG.IS_RENDER,
      interval: CONFIG.IS_RENDER ? "10m" : "30s",
      requests: keepAliveCounter,
      external_url: CONFIG.RENDER_EXTERNAL_URL || "none"
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
  console.log(`🫀 Keep-alive: ${CONFIG.IS_RENDER ? 'активен (10m)' : 'неактивен'}`);
});

export default app;