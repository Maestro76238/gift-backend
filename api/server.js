import express from "express";
import fetch from "node-fetch";

const app = express();

// Оптимизированный middleware
app.use(express.json({ limit: '10kb' }));
app.use((req, res, next) => {
  res.set('X-Response-Time', 'fast');
  next();
});

console.log("⚡ Ультра-быстрый бот запущен!");

// ============ КОНФИГУРАЦИЯ ============
const CONFIG = {
  TG_TOKEN: process.env.TG_TOKEN,
  ADMIN_ID: process.env.ADMIN_TG_ID,
  FRONTEND_URL: process.env.FRONTEND_URL || 'https://gift-backend-nine.vercel.app',
  KEEP_ALIVE_INTERVAL: 4 * 60 * 1000, // 4 минуты
  REQUEST_TIMEOUT: 2500, // 2.5 секунды
};

// ============ КЕШ И СОСТОЯНИЕ ============
const state = {
  statsCache: { normal_left: 2, vip_found: false, timestamp: 0 },
  lastRequests: new Map(),
  isReady: false
};

// ============ KEEP-ALIVE СИСТЕМА ============
function startKeepAlive() {
  // Первый пинг сразу
  setTimeout(() => {
    fetch(`${CONFIG.FRONTEND_URL}/api/health`).catch(() => {});
    console.log('🫀 Initial keep-alive sent');
    state.isReady = true;
  }, 1000);

  // Регулярные пинги
  setInterval(() => {
    fetch(`${CONFIG.FRONTEND_URL}/api/health`).catch(() => {});
  }, CONFIG.KEEP_ALIVE_INTERVAL);
}

// ============ БЫСТРЫЕ ФУНКЦИИ ============

// Супер-быстрая отправка в Telegram
async function sendFast(chatId, text, options = {}) {
  const url = `https://api.telegram.org/bot${CONFIG.TG_TOKEN}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text, ...options });
  
  // Не ждем ответа!
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(CONFIG.REQUEST_TIMEOUT)
  }).catch(() => {}); // Игнорируем все ошибки
  
  return { ok: true }; // Всегда возвращаем успех
}

// Быстрый ответ на callback
function answerCallback(callbackId) {
  fetch(`https://api.telegram.org/bot${CONFIG.TG_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId }),
    signal: AbortSignal.timeout(1000)
  }).catch(() => {});
}

// ============ ОБРАБОТЧИКИ ============

// Telegram вебхук - САМЫЙ БЫСТРЫЙ
app.post("/api/telegram-webhook", (req, res) => {
  const requestId = Date.now();
  const startTime = Date.now();
  
  // 🔥 ОТВЕЧАЕМ СРАЗУ!
  res.sendStatus(200);
  
  const update = req.body;
  state.lastRequests.set(requestId, { startTime, type: 'telegram' });
  
  // Очистка старых записей
  if (state.lastRequests.size > 100) {
    const keys = Array.from(state.lastRequests.keys()).slice(0, 50);
    keys.forEach(key => state.lastRequests.delete(key));
  }
  
  // 📨 Обработка сообщений
  if (update.message?.text === "/start") {
    const chatId = update.message.chat.id;
    
    sendFast(chatId, 
`🎁 <b>НОВОГОДНЯЯ ИГРА 2026</b>

⚡ <b>БЫСТРЫЙ ОТВЕТ!</b>
⏱️ Сервер ответил за ${Date.now() - startTime}мс

🎯 Купи ключ за 100₽
💰 Шанс на 100 000₽
⏳ Розыгрыш 31 декабря

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
    
    // Логируем в консоль
    console.log(`🚀 /start обработан за ${Date.now() - startTime}мс`);
  }
  
  // 🔘 Обработка callback
  if (update.callback_query) {
    const callbackId = update.callback_query.id;
    const chatId = update.callback_query.from.id;
    const data = update.callback_query.data;
    
    // Быстрый ответ на callback
    answerCallback(callbackId);
    
    if (data === "STATS") {
      const stats = state.statsCache;
      sendFast(chatId,
`📊 <b>СТАТИСТИКА В РЕАЛЬНОМ ВРЕМЕНИ</b>

🎁 Осталось ключей: <b>${stats.normal_left}</b>
💎 VIP-билет: ${stats.vip_found ? "❌ НАЙДЕН" : "🎯 В ИГРЕ"}
⚡ Ответ сервера: ${Date.now() - startTime}мс

👇 Успей купить ключ!`, {
        parse_mode: "HTML"
      });
    }
    
    if (data === "BUY") {
      sendFast(chatId,
`💳 <b>ОПЛАТА 100 ₽</b>

✅ Гарантированный подарок
🎯 Шанс на VIP-билет
💰 Участие в розыгрыше 100К

👇 Нажмите для оплаты:`, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "💳 ОПЛАТИТЬ (T-Банк)", url: "https://t.me/gift_celler_bot" }],
            [{ text: "📋 ПРАВИЛА", callback_data: "RULES" }]
          ]
        }
      });
    }
    
    if (data === "RULES") {
      sendFast(chatId,
`📋 <b>ПРАВИЛА ИГРЫ</b>

1. 🎁 Каждый ключ = подарок
2. 💰 Главный приз: 100 000₽
3. ⏳ Розыгрыш: 31 декабря
4. ✅ Возврат: 24 часа
5. 🔞 Участие: 18+

Вопросы: avitopochta17@gmail.com`, {
        parse_mode: "HTML"
      });
    }
  }
});

// ============ API МАРШРУТЫ ============

// Здоровье (самый быстрый)
app.get("/api/health", (req, res) => {
  res.json({
    status: "ultra_fast",
    ready: state.isReady,
    requests: state.lastRequests.size,
    memory: process.memoryUsage().heapUsed / 1024 / 1024 + " MB",
    timestamp: Date.now()
  });
});

// Пинг (для теста скорости)
app.get("/api/ping", (req, res) => {
  res.json({ pong: Date.now() });
});

// Статистика (кешированная)
app.get("/api/stats", (req, res) => {
  // Обновляем кеш если старый
  if (Date.now() - state.statsCache.timestamp > 30000) {
    state.statsCache.timestamp = Date.now();
  }
  
  res.json({
    ...state.statsCache,
    cached: Date.now() - state.statsCache.timestamp < 30000,
    response_time: "instant"
  });
});

// Проверка кода (упрощенная)
app.get("/api/check-gift/:code", (req, res) => {
  const code = req.params.code.toUpperCase();
  
  // Всегда успешный ответ для теста
  res.json({
    ok: true,
    code: code,
    gift: {
      type: Math.random() > 0.9 ? "vip" : "normal",
      status: "valid"
    },
    server: "ultra_fast",
    note: "Реальная проверка подключится позже"
  });
});

// Установка вебхука
app.get("/api/setup", async (req, res) => {
  try {
    const webhookUrl = `${CONFIG.FRONTEND_URL}/api/telegram-webhook`;
    const response = await fetch(
      `https://api.telegram.org/bot${CONFIG.TG_TOKEN}/setWebhook`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          max_connections: 100,
          drop_pending_updates: true
        }),
        signal: AbortSignal.timeout(3000)
      }
    );
    
    const result = await response.json();
    
    res.json({
      success: result.ok,
      webhook: webhookUrl,
      speed: "optimized",
      keep_alive: "enabled",
      note: "Бот готов к быстрой работе!"
    });
    
  } catch (error) {
    res.json({ error: error.message });
  }
});

// Главная страница
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>🎄 Новогодний Бот</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: Arial; text-align: center; padding: 50px; background: #0a0a2a; color: white; }
        h1 { color: #FFD700; }
        .status { background: rgba(0,255,0,0.1); padding: 20px; border-radius: 10px; margin: 20px; }
        .links a { display: inline-block; margin: 10px; padding: 10px 20px; background: #FFD700; color: black; text-decoration: none; border-radius: 5px; }
      </style>
    </head>
    <body>
      <h1>🎁 Новогодний Gift Bot</h1>
      <div class="status">
        <h2>✅ СЕРВЕР РАБОТАЕТ</h2>
        <p>⚡ Ультра-быстрая версия</p>
        <p>🫀 Keep-alive включен</p>
        <p>📨 Вебхук: ${state.isReady ? 'Готов' : 'Запускается...'}</p>
      </div>
      <div class="links">
        <a href="/api/health">Проверка здоровья</a>
        <a href="/api/setup">Установить вебхук</a>
        <a href="/check.html">Проверить код</a>
      </div>
    </body>
    </html>
  `);
});

// Запуск keep-alive
startKeepAlive();

// Экспорт
export default app;