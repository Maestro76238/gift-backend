import express from "express";
import fetch from "node-fetch";
import 'dotenv/config';
import { createClient } from "@supabase/supabase-js";
import cors from "cors";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Middleware
app.use(cors());
app.use(express.json());

// Обслуживание статических файлов
app.use(express.static(join(__dirname, '../public')));

console.log("🚀 Сервер запущен!");

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
      }
    );
    return await response.json();
  } catch (error) {
    console.error("❌ Ошибка отправки в TG:", error);
    return { ok: false };
  }
}

async function notifyAdmin(text) {
  if (process.env.ADMIN_TG_ID) {
    await sendTG(process.env.ADMIN_TG_ID, text, { parse_mode: "HTML" });
  }
}

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
  } catch (error) {
    console.error("❌ Ошибка резервирования:", error);
    return null;
  }
}

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
  } catch (error) {
    console.error("❌ Ошибка отмены резерва:", error);
  }
}

async function createTBankPayment(giftId, tgUserId) {
  const paymentId = "TBANK_" + Date.now();
  
  try {
    await supabase
      .from("gifts")
      .update({
        payment_id: paymentId,
        status: "waiting_payment",
      })
      .eq("id", giftId);
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

app.get("/", (req, res) => {
  res.redirect("/index.html");
});

// Тестовый маршрут для проверки сервера
app.get("/api/test", (req, res) => {
  console.log("✅ Тестовый запрос получен");
  res.json({ 
    ok: true, 
    message: "Сервер работает",
    time: new Date().toISOString(),
    webhook_url: "https://gift-backend-nine.vercel.app/api/telegram-webhook"
  });
});

app.get("/api/check-gift/:code", async (req, res) => {
  try {
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
    
  } catch (error) {
    console.error("❌ Ошибка проверки кода:", error);
    res.status(500).json({ ok: false, error: "Ошибка сервера" });
  }
});

app.post("/api/use-gift/:code", async (req, res) => {
  try {
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
    
  } catch (error) {
    console.error("❌ Ошибка активации:", error);
    res.status(500).json({ ok: false, error: "Ошибка сервера" });
  }
});

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
    
    return res.json({
      normal_left: normal_left || 0,
      vip_found: vip_used?.length > 0,
    });
    
  } catch (error) {
    console.error("❌ Ошибка статистики:", error);
    res.json({
      normal_left: 0,
      vip_found: false,
      error: "Ошибка базы данных"
    });
  }
});

// ============ TELEGRAM WEBHOOK ============

app.post("/api/telegram-webhook", async (req, res) => {
  try {
    console.log("=".repeat(50));
    console.log("🤖 TELEGRAM WEBHOOK ПОЛУЧЕН!");
    console.log("Время:", new Date().toISOString());
    console.log("Тело запроса:", JSON.stringify(req.body, null, 2));
    console.log("=".repeat(50));
    
    const update = req.body;
    
    // Отвечаем СРАЗУ
    res.sendStatus(200);
    
    if (update.message?.text === "/start") {
      const chatId = update.message.chat.id;
      console.log(`👋 /start от ${chatId}`);
      
      const result = await sendTG(
        chatId,
        `🎁 <b>НОВОГОДНЯЯ ИГРА 2026</b>
🎯 Купи ключ - получи подарок
💰 Шанс выиграть 100 000 ₽
⏳ Розыгрыш 31 декабря
<b>Цена:</b> 100 ₽ за ключ
<b>Возраст:</b> от 14 лет
<b>Возврат:</b> не предусмотрен
👇 Нажмите кнопку ниже:`,
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
      
      console.log("📤 Результат отправки:", result.ok ? "УСПЕХ" : "ОШИБКА");
      return;
    }
    
    if (update.callback_query) {
      const tgId = update.callback_query.from.id;
      const data = update.callback_query.data;
      
      console.log(`🔘 Callback от ${tgId}: ${data}`);
      
      // Ответ на callback
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
        const statsResponse = await fetch(`https://gift-backend-nine.vercel.app/api/stats`);
        const stats = await statsResponse.json();
        
        const text = `📊 <b>Статистика</b>
🎁 Осталось ключей: <b>${stats.normal_left || 0}</b>
💎 VIP-билет: ${stats.vip_found ? "❌ Найден" : "🎯 В игре"}
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
После оплаты вы получите код!
<b>Возраст:</b> от 14 лет
<b>Возврат:</b> не предусмотрен
👇 Нажмите для оплаты:`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "💳 ОПЛАТИТЬ 100 ₽", url: payment.confirmation.confirmation_url }],
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
  }
});

// Вебхук T-Bank
app.post("/api/tbank-webhook", async (req, res) => {
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
👇 Проверьте код на сайте!`,
            {
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [[
                  {
                    text: "🔍 ПРОВЕРИТЬ КОД",
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

// Управление вебхуком
app.get("/api/webhook/set", async (req, res) => {
  try {
    const webhookUrl = `https://gift-backend-nine.vercel.app/api/telegram-webhook`;
    
    // Сначала удаляем старый
    await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/deleteWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drop_pending_updates: true }),
    });
    
    // Устанавливаем новый
    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TG_TOKEN}/setWebhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          max_connections: 40,
          drop_pending_updates: true,
          allowed_updates: ["message", "callback_query"]
        }),
      }
    );
    
    const result = await response.json();
    
    res.json({ 
      ok: true,
      result,
      webhookUrl,
      note: "Вебхук переустановлен. Теперь отправь /start боту."
    });
    
  } catch (e) {
    console.error("Webhook error:", e);
    res.json({ ok: false, error: e.message });
  }
});

app.get("/api/webhook/info", async (req, res) => {
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

// Keep-alive
app.get("/api/keep-alive", (req, res) => {
  res.json({ status: "alive", time: new Date().toISOString() });
});

// Keep-alive интервал
setInterval(() => {
  fetch(`https://gift-backend-nine.vercel.app/api/keep-alive`).catch(() => {});
}, 4 * 60 * 1000);

export default app;