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
          created_at: new Date().toISOString(),
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
});
const checkAdmin = (req, res, next) => {
  const tgId = String(req.query.tg_id || "");
  const adminId = String(process.env.ADMIN_TG_ID || "");

  console.log("ADMIN CHECK:", {
    tg: tgId,
    admin: adminId
  });

  if (!tgId || tgId !== adminId) {
    return res.status(403).send("Admin error");
  }

  next();
};

app.get("/admin", checkAdmin, async (req, res) => {

    const now = new Date();
    
    const mskOffset = 3 * 60 * 60 * 1000;
    
    const mskNow = new Date(now.getTime() + mskOffset);
    mskNow.setHours(0, 0, 0, 0);

    const startOfDay = new Date(mskNow.getTime() - mskOffset).toISOString();

  try {
    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("id, tg_id, status")
      .order("created_at", { ascending: false });

    const { data: codes, error: codesError} = await supabase
      .from("gifts")
      .select("code, is_used")
      .order("created_at", { ascending: false });

    const { data: analytics, error: analyticsError } = await supabase
      .from("analytics")
      .select("tg_id, source");
    const safeOrders = orders || [];
    const safeCodes  = codes || [];
    const safeAnalytics = analytics || [];
          // ===== 📊 DAILY STATS =====
    const { data: paidOrders } = await supabase
       .from("orders")
       .select("amount")
       .eq("status", "paid")
       .gte("created_at", startOfDay);

    const totalSales = paidOrders?.length || 0;
    const totalSum = paidOrders?.reduce((s, o) => s + Number(o.amount || 0), 0) || 0;

         // Активированные коды
    const { data: usedCodes } = await supabase
       .from("gifts")
       .select("id")
       .eq("is_used", true)
       .gte("updated_at", startOfDay);

        // Сгоревшие коды
    const { data: burnedCodes } = await supabase
       .from("orders")
       .select("id")
       .eq("status", "expired")
       .gte("created_at", startOfDay);

       // Аналитика
    const { data: sources } = await supabase
       .from("analytics")
       .select("source")
       .gte("created_at", startOfDay);

    const traffic = {
       reels: 0,
       tiktok: 0,
       shorts: 0,
       other: 0,
    };

    (sources || []).forEach(s => {
       if (s.source === "reels") traffic.reels++;
       else if (s.source === "tiktok") traffic.tiktok++;
       else if (s.source === "shorts") traffic.shorts++;
       else traffic.other++;
    });

    res.send(`
      <h2>📊 Статистика за сегодня</h2>
      <ul>
        <li>💰 Сумма продаж: <b>${totalSum} ₽</b></li>
        <li>🧾 Оплачено заказов: <b>${totalSales}</b></li>
        <li>🔑 Активировано кодов: <b>${usedCodes?.length || 0}</b></li>
        <li>🔥 Сгорело кодов: <b>${burnedCodes?.length || 0}</b></li>
      </ul>

      <h3>📣 Источники трафика</h3>
      <ul>
        <li>Reels: ${traffic.reels}</li>
        <li>TikTok: ${traffic.tiktok}</li>
        <li>Shorts: ${traffic.shorts}</li>
        <li>Другое: ${traffic.other}</li>
      </ul>
      <h1>🛠 Admin Panel</h1>

      <h2>📦 Заказы</h2>
      <table border="1">
        <tr><th>ID</th><th>TG</th><th>Status</th></tr>
        ${safeOrders.map(o => `
          <tr>
            <td>${o.id}</td>
            <td>${o.tg_id ?? "-"}</td>
            <td>${o.status}</td>
          </tr>
        `).join("")}
      </table>

      <h2>🔑 Коды</h2>
<h2>🔑 Коды</h2>

<button onclick="createCode()">➕ Создать код</button>

<table border="1">
  <tr>
    <th>Код</th>
    <th>Статус</th>
    <th>Действия</th>
  </tr>

  ${codes.map(c => `
    <tr>
      <td>${c.code}</td>
      <td>${c.is_used ? "🔥 Использован" : "✅ Активен"}</td>
      <td>
        <button onclick="resetCode('${c.code}')">🔄 Сброс</button>
        <button onclick="deleteCode('${c.code}')">🗑 Удалить</button>
      </td>
    </tr>
  `).join("")}
</table>

<script>
  const tgId = new URLSearchParams(window.location.search).get("tg_id");

  async function createCode() {
    const res = await fetch("/admin/create-code?tg_id=" + tgId, { method: "POST" });
    location.reload();
  }

  async function deleteCode(code) {
    await fetch("/admin/delete-code?tg_id=" + tgId, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code })
    });
    location.reload();
  }

  async function resetCode(code) {
    await fetch("/admin/reset-code?tg_id=" + tgId, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code })
    });
    location.reload();
  }
</script>

      <h2>📊 Аналитика</h2>
      <table border="1">
        <tr><th>TG</th><th>Source</th></tr>
        ${safeAnalytics.map(a => `
          <tr>
            <td>${a.tg_id}</td>
            <td>${a.source}</td>
          </tr>
        `).join("")}
      </table>
    `);
  } catch (e) {
    console.error("ADMIN ERROR:", e);
    res.status(500).send("Admin error");
  }
});

app.post("/admin/create-code", checkAdmin, async (req, res) => {
  try {
    const code = crypto.randomUUID().slice(0, 8).toUpperCase();

    await supabase.from("gifts").insert({
      code,
      is_used: false
    });

    res.json({ success: true, code });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/admin/delete-code", checkAdmin, async (req, res) => {
  const { code } = req.body;

  await supabase.from("gifts").delete().eq("code", code);
  res.json({ success: true });
});

app.post("/admin/reset-code", checkAdmin, async (req, res) => {
  const { code } = req.body;

  await supabase
    .from("gifts")
    .update({ is_used: false })
    .eq("code", code);

  res.json({ success: true });
});

// ================== START ==================
app.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});