import express from "express";
import fetch from "node-fetch";
import 'dotenv/config';
import { createClient } from "@supabase/supabase-js";
import cors from "cors";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const app = express();

// Получаем текущую директорию для ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Middleware
app.use(cors({
  origin: ["http://localhost:3000", "https://*.vercel.app", "https://api.telegram.org"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
}));
app.use(express.json({ limit: '10mb' }));

// Обслуживание статических файлов из папки public
app.use(express.static(join(__dirname, '../public')));

console.log("🚀 Новогодний сервер запущен!");

// ============ ИНИЦИАЛИЗАЦИЯ ============
let supabase;
try {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    {
      auth: { persistSession: false },
      global: { fetch: (...args) => fetch(...args) }
    }
  );
  console.log("✅ Supabase подключен");
} catch (error) {
  console.error("❌ Ошибка Supabase:", error);
}

// ============ ФУНКЦИИ ============

// Быстрая отправка сообщения в Telegram
async function sendTG(chatId, text, options = {}) {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          ...options,
        }),
        signal: AbortSignal.timeout(5000) // Таймаут 5 секунд
      }
    );
    
    return await response.json();
  } catch (error) {
    console.error("❌ Ошибка отправки в TG:", error.message);
    return { ok: false, error: error.message };
  }
}

// Уведомление админу (асинхронно, не ждем ответа)
function notifyAdmin(text) {
  if (process.env.ADMIN_TG_ID) {
    sendTG(process.env.ADMIN_TG_ID, text, { parse_mode: "HTML" })
      .catch(e => console.error("Ошибка уведомления админу:", e.message));
  }
}

// Быстрое резервирование подарка с таймаутом
async function reserveGift(tgUserId) {
  try {
    const { data: gift, error } = await supabase
      .from("gifts")
      .select("*")
      .eq("status", "free")
      .eq("type", "normal")
      .limit(1)
      .single();
    
    if (error || !gift) return null;
    
    // Быстрое обновление без ожидания
    supabase
      .from("gifts")
      .update({
        status: "reserved",
        reserved: true,
        reserved_at: new Date().toISOString(),
        tg_user_id: tgUserId,
      })
      .eq("id", gift.id)
      .then(() => console.log(`✅ Подарок ${gift.id} зарезервирован`))
      .catch(e => console.error("Ошибка обновления:", e.message));
    
    return gift;
  } catch (error) {
    console.error("❌ Ошибка резервирования:", error.message);
    return null;
  }
}

// Асинхронная отмена резерва
function cancelReserve(giftId) {
  supabase
    .from("gifts")
    .update({
      status: "free",
      reserved: false,
      reserved_at: null,
      tg_user_id: null,
      payment_id: null,
    })
    .eq("id", giftId)
    .catch(e => console.error("Ошибка отмены резерва:", e.message));
}

// Быстрое создание платежа
async function createTBankPayment(giftId, tgUserId) {
  const paymentId = "TBANK_" + Date.now();
  
  supabase
    .from("gifts")
    .update({
      payment_id: paymentId,
      status: "waiting_payment",
    })
    .eq("id", giftId)
    .catch(e => console.error("Ошибка создания платежа:", e.message));
  
  return {
    id: paymentId,
    confirmation: {
      confirmation_url: "https://t.me/gift_celler_bot"
    }
  };
}

// ============ МАРШРУТЫ API ============

// Главная страница
app.get("/", (req, res) => {
  res.redirect("/index.html");
});

// API маршрут для проверки работоспособности
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Проверка кода подарка (оптимизированная)
app.get("/api/check-gift/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    
    const { data, error } = await supabase
      .from("gifts")
      .select("id, code, type, is_used")
      .eq("code", code)
      .eq("status", "paid")
      .limit(1)
      .maybeSingle();
    
    if (error || !data) {
      return res.status(404).json({
        ok: false,
        message: "Код не найден или уже использован",
      });
    }
    
    if (data.is_used) {
      return res.status(400).json({
        ok: false,
        message: "Код уже использован",
      });
    }
    
    // Асинхронное уведомление
    notifyAdmin(`🔍 Код проверен: ${code}`);
    
    return res.json({
      ok: true,
      gift: {
        id: data.id,
        code: data.code,
        type: data.type
      },
    });
    
  } catch (error) {
    console.error("❌ Ошибка проверки кода:", error.message);
    res.status(500).json({ ok: false, error: "Ошибка сервера" });
  }
});

// Активация кода
app.post("/api/use-gift/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    
    const { data: gift } = await supabase
      .from("gifts")
      .update({
        is_used: true,
        used_at: new Date().toISOString(),
        status: "used"
      })
      .eq("code", code)
      .eq("is_used", false)
      .select()
      .maybeSingle();
    
    if (!gift) {
      return res.status(400).json({ 
        ok: false, 
        message: "Код не найден или уже использован" 
      });
    }
    
    notifyAdmin(`🎁 Код активирован: ${code}`);
    
    return res.json({ 
      ok: true,
      message: "Код успешно активирован"
    });
    
  } catch (error) {
    console.error("❌ Ошибка активации:", error.message);
    res.status(500).json({ ok: false, error: "Ошибка сервера" });
  }
});

// Статистика (кешированная на 30 секунд)
let statsCache = { data: null, timestamp: 0 };
app.get("/api/stats", async (req, res) => {
  try {
    // Кешируем на 30 секунд
    const now = Date.now();
    if (statsCache.data && now - statsCache.timestamp < 30000) {
      return res.json(statsCache.data);
    }
    
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
    
    const { count: total_used } = await supabase
      .from("gifts")
      .select("*", { count: "exact", head: true })
      .eq("status", "used");
    
    const stats = {
      normal_left: normal_left || 0,
      vip_found: vip_used?.length > 0,
      total_used: total_used || 0,
      server_time: new Date().toISOString(),
      cached: false
    };
    
    statsCache = { data: stats, timestamp: now };
    
    res.json(stats);
    
  } catch (error) {
    console.error("❌ Ошибка статистики:", error.message);
    // Возвращаем кешированные данные или заглушку
    if (statsCache.data) {
      statsCache.data.cached = true;
      res.json(statsCache.data);
    } else {
      res.json({
        normal_left: 0,
        vip_found: false,
        total_used: 0,
        error: "Ошибка базы данных"
      });
    }
  }
});

// ============ TELEGRAM WEBHOOK (ОПТИМИЗИРОВАННЫЙ) ============

app.post("/api/telegram-webhook", async (req, res) => {
  // ВАЖНО: Отвечаем Telegram СРАЗУ
  res.sendStatus(200);
  
  // Обработку делаем асинхронно
  processTelegramUpdate(req.body).catch(e => {
    console.error("❌ Необработанная ошибка в processTelegramUpdate:", e.message);
  });
});

// Асинхронная обработка Telegram обновлений
async function processTelegramUpdate(update) {
  try {
    console.log("🤖 Telegram update получен");
    
    // Ответ на callback query (делаем быстро)
    if (update.callback_query) {
      fetch(
        `https://api.telegram.org/bot${process.env.TG_TOKEN}/answerCallbackQuery`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callback_query_id: update.callback_query.id,
          }),
          signal: AbortSignal.timeout(3000)
        }
      ).catch(e => console.error("Ошибка ответа на callback:", e.message));
    }
    
    // Обработка /start
    if (update.message?.text === "/start") {
      const chatId = update.message.chat.id;
      console.log(`👋 /start от ${chatId}`);
      
      const message = `🎁 <b>НОВОГОДНЯЯ ИГРА 2026</b>
🎯 Купи ключ - получи подарок
💰 Шанс выиграть 100 000 ₽
⏳ Розыгрыш 31 декабря
<b>Цена:</b> 100 ₽ за ключ
<b>Гарантия:</b> Каждый код - уникальный подарок
👇 Нажмите кнопку ниже, чтобы купить ключ:`;
      
      await sendTG(chatId, message, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🎯 КУПИТЬ КЛЮЧ ЗА 100 ₽", callback_data: "BUY_KEY" }],
            [{ text: "📊 Статистика", callback_data: "STATS" }],
            [{ text: "❓ FAQ", url: "https://telegra.ph/FAQ-12-16-21" }],
          ],
        },
      });
      
      notifyAdmin(`👤 Новый пользователь: ${chatId}`);
      return;
    }
    
    // Обработка callback query
    if (update.callback_query) {
      const tgId = update.callback_query.from.id;
      const data = update.callback_query.data;
      
      console.log(`🔘 Callback от ${tgId}: ${data}`);
      
      if (data === "STATS") {
        // Используем кешированную статистику для скорости
        const stats = statsCache.data || {
          normal_left: 0,
          vip_found: false,
          total_used: 0
        };
        
        const text = `📊 <b>Статистика</b>
🎁 Осталось ключей: <b>${stats.normal_left || 0}</b>
💎 VIP-билет: ${stats.vip_found ? "❌ Найден" : "🎯 В игре"}
🎫 Использовано ключей: <b>${stats.total_used || 0}</b>
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
        
        notifyAdmin(`🛒 Пользователь ${tgId} начал покупку ключа ${gift.id}`);
        return;
      }
      
      if (data.startsWith("CANCEL:")) {
        const giftId = data.split(":")[1];
        cancelReserve(giftId);
        await sendTG(tgId, "❌ Покупка отменена");
        
        notifyAdmin(`❌ Пользователь ${tgId} отменил покупку ключа ${giftId}`);
        return;
      }
    }
    
  } catch (e) {
    console.error("❌ Ошибка в обработке Telegram:", e.message);
  }
}

// Вебхук T-Bank
app.post("/api/tbank-webhook", async (req, res) => {
  res.sendStatus(200); // Отвечаем сразу
  
  try {
    const payment = req.body;
    
    if (payment.status === "success") {
      const giftId = payment.metadata?.gift_id;
      const tgUserId = payment.metadata?.tg_user_id;
      
      if (giftId && tgUserId) {
        const { data: gift } = await supabase
          .from("gifts")
          .update({
            status: "paid",
            reserved: false,
          })
          .eq("id", giftId)
          .select("*")
          .single();
        
        if (gift) {
          await sendTG(
            tgUserId,
            `🎉 <b>Оплата прошла успешно!</b>
🔑 <b>Ваш код:</b> <code>${gift.code}</code>
👇 Перейдите на сайт и введите этот код:
${process.env.FRONTEND_URL || 'https://gift-backend-nine.vercel.app'}
🎁 Вы получите цифровой подарок сразу после проверки кода!`,
            {
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [[
                  {
                    text: "🔍 ПРОВЕРИТЬ КОД НА САЙТЕ",
                    url: process.env.FRONTEND_URL || 'https://gift-backend-nine.vercel.app',
                  },
                ]],
              },
            }
          );
          
          notifyAdmin(`💰 <b>Новая оплата</b>\nКод: ${gift.code}\nTG ID: ${tgUserId}`);
        }
      }
    }
  } catch (e) {
    console.error("❌ T-Bank error:", e.message);
  }
});

// Установка вебхука
app.get("/api/set-webhook", async (req, res) => {
  try {
    const webhookUrl = `https://gift-backend-nine.vercel.app/api/telegram-webhook`;
    
    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TG_TOKEN}/setWebhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          drop_pending_updates: true,
          allowed_updates: ["message", "callback_query"],
          max_connections: 40
        }),
        signal: AbortSignal.timeout(5000)
      }
    );
    
    const result = await response.json();
    
    res.json({ 
      ok: result.ok || false,
      result,
      webhookUrl,
      note: "Вебхук установлен. Бот должен отвечать быстро."
    });
    
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Информация о вебхуке
app.get("/api/get-webhook-info", async (req, res) => {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TG_TOKEN}/getWebhookInfo`,
      { signal: AbortSignal.timeout(3000) }
    );
    const result = await response.json();
    res.json({ ok: true, result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 404 для API
app.use("/api/*", (req, res) => {
  res.status(404).json({
    ok: false,
    error: "API маршрут не найден",
    path: req.path
  });
});

// Экспорт для Vercel
export default app;