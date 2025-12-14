import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
const ADMIN_TG_ID = Number(process.env.ADMIN_TG_ID);

// ================== APP ==================
const app = express();
app.use(cors());
app.use(express.json());


// ================== ENV ==================
const PORT = process.env.PORT || 10000;

const TG_TOKEN = process.env.TG_TOKEN;


const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;

// ================== SUPABASE ==================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ================== TELEGRAM ==================
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;

async function tgSend(chatId, text, replyMarkup = null) {
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  await fetch(`${TG_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ================== HEALTH ==================
app.get("/", (req, res) => {
  res.send("OK");
});

// ================== TELEGRAM WEBHOOK ==================
app.post("/tg", async (req, res) => {
  try {
    const update = req.body;
    console.log("TG UPDATE:", JSON.stringify(update));

    // /start
    if (update.message?.text === "/start") {
      const chatId = update.message.chat.id;

      await tgSend(
        chatId,
        "🎄 <b>С наступающим Новым годом!</b>\n\nЗдесь вы можете купить секретный ключ 🔑 и открыть подарок 🎁\n\n<b>Выберите действие 👇</b>",
        {
          inline_keyboard: [
            [{ text: "ℹ️ Как это работает?", callback_data: "INFO" }],
            [{ text: "🔑 Купить секретный ключ", callback_data: "BUY" }],
          ],
        }
      );
    }
function checkAdmin(req, res, next) {
  const password = req.query.password;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(403).send("❌ Access denied");
  }
  next();
}

    // кнопки
    if (update.callback_query) {
      const chatId = update.callback_query.message.chat.id;
      const tgId = update.callback_query.from.id;
      const action = update.callback_query.data;

      // INFO
      if (action === "INFO") {
        await tgSend(
          chatId,
          "🔑 Вы покупаете секретный ключ\n🎁 Вводите его на сайте\n🔥 Код одноразовый и сгорает после использования"
        );
      }

      // BUY
      if (action === "BUY") {
        // создаём заказ
        const orderId = crypto.randomUUID();

        await supabase.from("orders").insert({
          id: orderId,
          tg_id: tgId,
          status: "pending",
          amount: 1,
        });

        // создаём оплату ЮKassa
        const payment = await fetch("https://api.yookassa.ru/v3/payments", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotence-Key": crypto.randomUUID(),
            Authorization:
              "Basic " +
              Buffer.from(
                `${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`
              ).toString("base64"),
          },
          body: JSON.stringify({
            amount: {
              value: "1.00",
              currency: "RUB",
            },
            confirmation: {
              type: "redirect",
              return_url: "https://google.com",
            },
            capture: true,
            description: "Секретный ключ",
            metadata: {
              order_id: orderId,
              tg_id: tgId,
            },
          }),
        }).then((r) => r.json());

        await supabase
          .from("orders")
          .update({ payment_id: payment.id })
          .eq("id", orderId);

        await tgSend(chatId, "💳 Оплатите ключ по кнопке ниже 👇", {
          inline_keyboard: [
            [
              {
                text: "Оплатить 💳",
                url: payment.confirmation.confirmation_url,
              },
            ],
          ],
        });
      }
    }

    res.send("ok");
  } catch (e) {
    console.error("TG ERROR:", e);
    res.send("ok");
  }
});

// ================== YOOKASSA WEBHOOK ==================
app.post("/yookassa", async (req, res) => {
  try {
    const event = req.body;

    console.log("📩 YOOKASSA WEBHOOK:", JSON.stringify(event, null, 2));

    if (event.event !== "payment.succeeded") {
      return res.send("ok");
    }

    // 🔥 ВАЖНО: объявляем ЗДЕСЬ
    const payment = event.object;

    const orderId = payment.metadata.order_id;
    const tgId = payment.metadata.tg_id;

    const code = crypto.randomUUID().slice(0, 8).toUpperCase();

    await supabase.from("gifts").insert({
      code,
      is_used: false,
    });

    await supabase
      .from("orders")
      .update({ status: "paid" })
      .eq("id", orderId);

    await tgSend(
      tgId,
      "✅ <b>Оплата прошла!</b>\n\nВаш секретный ключ:\n<code>" + code + "</code>"
    );

    await tgSend(
      ADMIN_TG_ID,
      "💰 Новая покупка\nTG ID: " + tgId + "\nКод: " + code
    );

    res.send("ok");
  } catch (e) {
    console.error("❌ YOOKASSA ERROR:", e);
    res.send("ok");
  }
});app.get("/admin", checkAdmin, async (req, res) => {
  const { data: gifts } = await supabase.from("gifts").select("*");
  const { data: orders } = await supabase.from("orders").select("*");
  const { data: analytics } = await supabase.from("analytics").select("*");

  res.send(`
    <html>
      <head>
        <title>Admin panel</title>
        <style>
          body { font-family: Arial; padding: 20px; }
          h2 { margin-top: 30px; }
          table { border-collapse: collapse; width: 100%; }
          td, th { border: 1px solid #ccc; padding: 6px; }
        </style>
      </head>
      <body>

        <h1>🛠 Admin Panel</h1>

        <h2>💰 Заказы</h2>
        <table>
          <tr><th>ID</th><th>TG</th><th>Status</th></tr>
          ${orders.map(o => `
            <tr>
              <td>${o.id}</td>
              <td>${o.tg_id}</td>
              <td>${o.status}</td>
            </tr>
          `).join("")}
        </table>

        <h2>🎁 Коды</h2>
        <table>
          <tr><th>Code</th><th>Used</th></tr>
          ${gifts.map(g => `
            <tr>
              <td>${g.code}</td>
              <td>${g.is_used}</td>
            </tr>
          `).join("")}
        </table>

        <h2>📊 Аналитика</h2>
        <table>
          <tr><th>TG</th><th>Source</th></tr>
          ${analytics.map(a => `
            <tr>
              <td>${a.tg_id}</td>
              <td>${a.source}</td>
            </tr>
          `).join("")}
        </table>

      </body>
    </html>
  `);
});


// ================== START ==================
app.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});