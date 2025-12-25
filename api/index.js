import express from "express";
import fetch from "node-fetch";
import 'dotenv/config';
import { createClient } from "@supabase/supabase-js";
import cors from "cors";

const app = express();

// Middleware
app.use(cors({
  origin: ["http://localhost:3000", "https://*.vercel.app", "https://api.telegram.org"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
}));
app.use(express.json());

console.log("🚀 Новогодний сервер запущен!");

// ============ ИНИЦИАЛИЗАЦИЯ ============
let supabase;
try {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
  console.log("✅ Supabase подключен");
} catch (error) {
  console.error("❌ Ошибка Supabase:", error);
}

// ============ ФУНКЦИИ ============

// Отправка сообщения в Telegram
async function sendTG(chatId, text, options = {}) {
  try {
    console.log(`📤 Отправка TG ${chatId}: ${text.substring(0, 50)}...`);
    
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
      }
    );
    
    const result = await response.json();
    return result;
  } catch (error) {
    console.error("❌ Ошибка отправки в TG:", error);
    return { ok: false, error: error.message };
  }
}

// Уведомление админу
async function notifyAdmin(text) {
  if (process.env.ADMIN_TG_ID) {
    await sendTG(process.env.ADMIN_TG_ID, text, { parse_mode: "HTML" });
  }
}

// Резервирование подарка
async function reserveGift(tgUserId) {
  try {
    console.log(`🎁 Резервирование для TG: ${tgUserId}`);
    
    const { data: gift, error } = await supabase
      .from("gifts")
      .select("*")
      .eq("status", "free")
      .eq("type", "normal")
      .limit(1)
      .single();
    
    if (error || !gift) {
      console.log("❌ Нет свободных подарков");
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
  } catch (error) {
    console.error("❌ Ошибка резервирования:", error);
    return null;
  }
}

// Отмена резерва
async function cancelReserve(giftId) {
  try {
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
    console.log(`✅ Резерв отменен для ${giftId}`);
  } catch (error) {
    console.error("❌ Ошибка отмены резерва:", error);
  }
}

// Создание платежа T-Bank
async function createTBankPayment(giftId, tgUserId) {
  const paymentId = "TBANK_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
  
  try {
    await supabase
      .from("gifts")
      .update({
        payment_id: paymentId,
        status: "waiting_payment",
      })
      .eq("id", giftId);
    
    console.log(`💰 Платеж создан: ${paymentId}`);
  } catch (error) {
    console.error("❌ Ошибка создания платежа:", error);
  }
  
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
  res.json({ 
    status: "online",
    name: "🎁 Новогодний Gift Bot",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    endpoints: {
      test: "/test",
      webhook: "/set-webhook",
      api: "/api/*",
      telegram: "/telegram-webhook"
    }
  });
});

// Тест
app.get("/test", (req, res) => {
  res.json({ 
    ok: true, 
    message: "✅ Сервер работает отлично!",
    env: {
      hasToken: !!process.env.TG_TOKEN,
      hasSupabase: !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_KEY,
      adminId: process.env.ADMIN_TG_ID,
      frontendUrl: process.env.FRONTEND_URL
    }
  });
});

// Установка вебхука
app.get("/set-webhook", async (req, res) => {
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
          allowed_updates: ["message", "callback_query"]
        }),
      }
    );
    
    const result = await response.json();
    
    res.json({ 
      ok: result.ok || false,
      result,
      webhookUrl,
      manualUrl: `https://api.telegram.org/bot${process.env.TG_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
    });
    
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Информация о вебхуке
app.get("/get-webhook-info", async (req, res) => {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TG_TOKEN}/getWebhookInfo`
    );
    const result = await response.json();
    res.json({ ok: true, result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Проверка кода подарка
app.get("/api/check-gift/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    console.log(`🔍 Проверка кода: ${code}`);
    
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
    
    await notifyAdmin(`🔍 Код проверен: ${code}`);
    
    return res.json({
      ok: true,
      gift: {
        id: data.id,
        code: data.code,
        type: data.type
      },
    });
    
  } catch (error) {
    console.error("❌ Ошибка проверки кода:", error);
    res.status(500).json({ ok: false, error: "Ошибка сервера" });
  }
});

// Активация кода
app.post("/api/use-gift/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    console.log(`🎁 Активация кода: ${code}`);
    
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
    
    await notifyAdmin(`🎁 Код активирован: ${code}`);
    
    return res.json({ 
      ok: true,
      message: "Код успешно активирован"
    });
    
  } catch (error) {
    console.error("❌ Ошибка активации:", error);
    res.status(500).json({ ok: false, error: "Ошибка сервера" });
  }
});

// Статистика
app.get("/api/stats", async (req, res) => {
  try {
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
    
    res.json({
      normal_left: normal_left || 0,
      vip_found: vip_used?.length > 0,
      total_used: total_used || 0,
      server_time: new Date().toISOString()
    });
    
  } catch (error) {
    console.error("❌ Ошибка статистики:", error);
    res.json({
      normal_left: 0,
      vip_found: false,
      total_used: 0,
      error: "Ошибка базы данных"
    });
  }
});

// ============ TELEGRAM WEBHOOK ============

app.post("/telegram-webhook", async (req, res) => {
  try {
    const update = req.body;
    console.log("🤖 Telegram update получен");
    
    // Отвечаем сразу Telegram
    res.sendStatus(200);
    
    // Ответ на callback query
    if (update.callback_query) {
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
    }
    
    // Обработка /start
    if (update.message?.text === "/start") {
      const chatId = update.message.chat.id;
      
      await sendTG(
        chatId,
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
      
      await notifyAdmin(`👤 Новый пользователь: ${chatId}`);
      return;
    }
    
    // Обработка callback query
    if (update.callback_query) {
      const tgId = update.callback_query.from.id;
      const data = update.callback_query.data;
      
      console.log(`🔘 Callback от ${tgId}: ${data}`);
      
      if (data === "STATS") {
        const statsResponse = await fetch(`https://gift-backend-nine.vercel.app/api/stats`);
        const stats = await statsResponse.json();
        
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
        
        await notifyAdmin(`🛒 Пользователь ${tgId} начал покупку ключа ${gift.id}`);
        return;
      }
      
      if (data.startsWith("CANCEL:")) {
        const giftId = data.split(":")[1];
        await cancelReserve(giftId);
        await sendTG(tgId, "❌ Покупка отменена");
        
        await notifyAdmin(`❌ Пользователь ${tgId} отменил покупку ключа ${giftId}`);
        return;
      }
    }
    
  } catch (e) {
    console.error("❌ Ошибка в Telegram webhook:", e);
  }
});

// Вебхук T-Bank
app.post("/tbank-webhook", async (req, res) => {
  try {
    console.log("💰 T-Bank webhook получен");
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

// 404 обработчик
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Маршрут не найден",
    path: req.path,
    method: req.method,
    tip: "Попробуйте /test для проверки сервера"
  });
});

// Экспорт для Vercel
export default app;