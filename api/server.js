import express from "express";
import fetch from "node-fetch";
import 'dotenv/config';
import { createClient } from "@supabase/supabase-js";
import cors from "cors";

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

console.log("🚀 Новогодний бот запущен!");

// Keep-alive для предотвращения cold start
setInterval(() => {
  fetch('https://gift-backend-nine.vercel.app/api/health')
    .then(() => console.log('🫀 Keep-alive'))
    .catch(() => {});
}, 4 * 60 * 1000); // Каждые 4 минуты

// ============ ИНИЦИАЛИЗАЦИЯ ============
let supabase;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
  console.log("✅ Supabase подключен");
} else {
  console.log("⚠️ Supabase: нет переменных окружения");
}

// ============ ФУНКЦИИ ============

// Быстрая отправка в Telegram
async function sendTG(chatId, text, options = {}) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, ...options }),
        signal: controller.signal
      }
    );
    
    clearTimeout(timeout);
    return await response.json();
  } catch (error) {
    console.error("❌ Ошибка отправки:", error.message);
    return { ok: false };
  }
}

// Асинхронное уведомление админа
function notifyAdmin(text) {
  if (process.env.ADMIN_TG_ID) {
    sendTG(process.env.ADMIN_TG_ID, text, { parse_mode: "HTML" })
      .catch(() => {});
  }
}

// Резервирование подарка
async function reserveGift(tgUserId) {
  try {
    const { data: gift } = await supabase
      ?.from("gifts")
      .select("*")
      .eq("status", "free")
      .eq("type", "normal")
      .limit(1)
      .single() || { data: null };
    
    if (!gift) return null;
    
    // Асинхронное обновление
    supabase?.from("gifts")
      .update({
        status: "reserved",
        reserved: true,
        reserved_at: new Date().toISOString(),
        tg_user_id: tgUserId,
      })
      .eq("id", gift.id)
      .catch(() => {});
    
    return gift;
  } catch {
    return null;
  }
}

// Отмена резерва
function cancelReserve(giftId) {
  supabase?.from("gifts")
    .update({
      status: "free",
      reserved: false,
      reserved_at: null,
      tg_user_id: null,
    })
    .eq("id", giftId)
    .catch(() => {});
}

// ============ МАРШРУТЫ ============

// Здоровье сервера
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime().toFixed(2) + "s"
  });
});

// Тест скорости
app.get("/api/ping", (req, res) => {
  res.json({ ping: Date.now() });
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
          max_connections: 40
        })
      }
    );
    
    const result = await response.json();
    res.json({ ok: true, result, webhookUrl });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Telegram вебхук (ОСНОВНОЙ)
app.post("/api/telegram-webhook", (req, res) => {
  // МГНОВЕННЫЙ ответ Telegram
  res.sendStatus(200);
  
  const update = req.body;
  const startTime = Date.now();
  
  // Обработка /start
  if (update.message?.text === "/start") {
    const chatId = update.message.chat.id;
    
    const messageText = `🎁 <b>НОВОГОДНЯЯ ИГРА 2026</b>
    
🎯 Купи ключ - получи подарок
💰 Шанс выиграть 100 000 ₽
⏳ Розыгрыш 31 декабря
<b>Цена:</b> 100 ₽ за ключ

👇 Нажмите кнопку ниже:`;
    
    sendTG(chatId, messageText, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🎯 КУПИТЬ КЛЮЧ ЗА 100 ₽", callback_data: "BUY_KEY" }],
          [{ text: "📊 Статистика", callback_data: "STATS" }],
          [{ text: "❓ FAQ", url: "https://telegra.ph/FAQ-12-16-21" }],
        ]
      }
    }).then(() => {
      console.log(`✅ /start отправлен за ${Date.now() - startTime}ms`);
    });
  }
  
  // Обработка callback
  if (update.callback_query) {
    const callbackId = update.callback_query.id;
    const chatId = update.callback_query.from.id;
    const data = update.callback_query.data;
    
    // Ответ на callback query
    fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackId })
    }).catch(() => {});
    
    if (data === "STATS") {
      // Простая статистика
      sendTG(chatId, `📊 <b>Статистика</b>\n\n🎁 Ключей доступно: <b>2</b>\n💎 VIP-билет: 🎯 В игре\n\n👇 Купи ключ сейчас!`, {
        parse_mode: "HTML"
      });
    }
    
    if (data === "BUY_KEY") {
      reserveGift(chatId).then(gift => {
        if (!gift) {
          sendTG(chatId, "❌ Ключи временно закончились");
          return;
        }
        
        sendTG(chatId, `💳 <b>Оплатите 100 ₽</b>\n\nПосле оплаты вы получите код!\n\n👇 Нажмите для оплаты:`, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "💳 ОПЛАТИТЬ 100 ₽", url: "https://t.me/gift_celler_bot" }],
              [{ text: "❌ ОТМЕНА", callback_data: `CANCEL:${gift.id}` }]
            ]
          }
        });
      });
    }
    
    if (data.startsWith("CANCEL:")) {
      const giftId = data.split(":")[1];
      cancelReserve(giftId);
      sendTG(chatId, "✅ Покупка отменена");
    }
  }
});

// Проверка кода
app.get("/api/check-gift/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    
    const { data } = await supabase
      ?.from("gifts")
      .select("id, code, type")
      .eq("code", code)
      .eq("status", "paid")
      .single() || { data: null };
    
    if (!data) {
      return res.status(404).json({
        ok: false,
        message: "Код не найден"
      });
    }
    
    res.json({
      ok: true,
      gift: data
    });
  } catch {
    res.status(500).json({ ok: false, error: "Ошибка сервера" });
  }
});

// Статистика
app.get("/api/stats", async (req, res) => {
  try {
    const { count: normal_left } = await supabase
      ?.from("gifts")
      .select("*", { count: "exact", head: true })
      .eq("type", "normal")
      .eq("status", "free") || { count: 0 };
    
    const { data: vip_used } = await supabase
      ?.from("gifts")
      .select("id")
      .eq("type", "vip")
      .eq("status", "used")
      .limit(1) || { data: [] };
    
    res.json({
      normal_left: normal_left || 0,
      vip_found: vip_used?.length > 0,
      server_time: new Date().toISOString()
    });
  } catch {
    res.json({
      normal_left: 2,
      vip_found: false,
      cached: true
    });
  }
});

// Использование кода
app.post("/api/use-gift/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    
    const { data } = await supabase
      ?.from("gifts")
      .update({ is_used: true, used_at: new Date().toISOString() })
      .eq("code", code)
      .select()
      .single() || { data: null };
    
    if (!data) {
      return res.status(400).json({ ok: false });
    }
    
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

// T-Bank вебхук
app.post("/api/tbank-webhook", (req, res) => {
  res.sendStatus(200);
  
  const payment = req.body;
  if (payment.status === "success") {
    const giftId = payment.metadata?.gift_id;
    const tgUserId = payment.metadata?.tg_user_id;
    
    if (giftId && tgUserId) {
      supabase?.from("gifts")
        .update({ status: "paid", reserved: false })
        .eq("id", giftId)
        .catch(() => {});
      
      sendTG(tgUserId, `🎉 <b>Оплата успешна!</b>\n\n🔑 Код отправлен в боте\n🎁 Получите подарок на сайте`, {
        parse_mode: "HTML"
      }).catch(() => {});
    }
  }
});

// Статические файлы (если есть)
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
app.use(express.static(join(__dirname, '../public')));

// Главная страница
app.get("/", (req, res) => {
  res.redirect("/index.html");
});

// Экспорт
export default app;