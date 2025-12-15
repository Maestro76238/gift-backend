import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import multer from "multer";
import path from "path";
const ADMIN_TG_ID = Number(process.env.ADMIN_TG_ID);
const upload = multer({ storage: multer.memoryStorage() });

// ================== APP ==================
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true}));


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
      file_path: false
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
// ================== ADMIN PANEL (FULL) ==================

// 🔐 ADMIN MIDDLEWARE
function checkAdmin(req, res, next) {
  const tgId = String(req.query.tg_id || "");
  const adminId = String(process.env.ADMIN_TG_ID || "");

  console.log("ADMIN CHECK:", { tg: tgId, admin: adminId });

  if (!tgId || tgId !== adminId) {
    return res.status(403).send("Admin access denied");
  }

  next();
}

// ================== ADMIN PAGE ==================
app.get("/admin", checkAdmin, async (req, res) => {
  try {
    // ====== DATE (TODAY, MSK) ======
    const now = new Date();
    const mskNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    mskNow.setHours(0, 0, 0, 0);

    const startOfDay = new Date(
      mskNow.getTime() - 3 * 60 * 60 * 1000
    ).toISOString();

    // ====== DATA ======
    const { data: ordersRaw } = await supabase
      .from("orders")
      .select("id, tg_id, status, amount, created_at")
      .order("created_at", { ascending: false });

    const { data: codesRaw } = await supabase
      .from("gifts")
      .select("code, is_used, created_at")
      .order("created_at", { ascending: false });

    const { data: analyticsRaw } = await supabase
      .from("analytics")
      .select("tg_id, source, created_at");

    const orders = ordersRaw || [];
    const codes = codesRaw || [];
    const analytics = analyticsRaw || [];

    // ====== TODAY STATS ======
    const todayOrders = orders.filter(
      o => o.status === "paid" && o.created_at >= startOfDay
    );

    const totalSales = todayOrders.length;
    const totalSum = todayOrders.reduce(
      (sum, o) => sum + Number(o.amount || 0),
      0
    );

    const usedCodes = codes.filter(
      c => c.is_used && c.created_at >= startOfDay
    );

    const burnedCodes = codes.filter(
      c => !c.is_used && c.created_at < startOfDay
    );

    const traffic = {
      reels: 0,
      tiktok: 0,
      shorts: 0,
      other: 0,
    };

    analytics
      .filter(a => a.created_at >= startOfDay)
      .forEach(a => {
        if (a.source === "reels") traffic.reels++;
        else if (a.source === "tiktok") traffic.tiktok++;
        else if (a.source === "shorts") traffic.shorts++;
        else traffic.other++;
      });

    // ====== HTML ======
    res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Admin Panel</title>
<style>
body { font-family: Arial; padding: 20px; }
table { border-collapse: collapse; margin-bottom: 20px; }
td, th { border: 1px solid #ccc; padding: 6px 10px; }
button { margin-right: 5px; }
</style>
</head>
<body>

<h1>🛠 Admin Panel</h1>

<h2>📊 Статистика за сегодня (МСК)</h2>
<ul>
  <li>💰 Сумма продаж: <b>${totalSum} ₽</b></li>
  <li>🧾 Оплачено заказов: <b>${totalSales}</b></li>
  <li>🔑 Активировано кодов: <b>${usedCodes.length}</b></li>
  <li>🔥 Сгорело кодов: <b>${burnedCodes.length}</b></li>
</ul>

<h3>📣 Источники трафика</h3>
<ul>
  <li>Reels: ${traffic.reels}</li>
  <li>TikTok: ${traffic.tiktok}</li>
  <li>Shorts: ${traffic.shorts}</li>
  <li>Другое: ${traffic.other}</li>
</ul>

<h2>📦 Заказы</h2>
<table>
<tr><th>ID</th><th>TG</th><th>Status</th></tr>
${orders.map(o => `
<tr>
  <td>${o.id}</td>
  <td>${o.tg_id || "-"}</td>
  <td>${o.status}</td>
</tr>
`).join("")}
</table>

<h2>🔑 Коды</h2>
<button onclick="createCode()">➕ Создать код</button>

<table>
<tr><th>Код</th><th>Статус</th><th>Действия</th></tr>
${codes.map(c => `
<tr>
  <td>${c.code}</td>
  <td>${c.is_used ? "🔥 Использован" : "✅ Активен"}</td>
  <td>
    <button onclick="attachFile('${c.code}')">📎 Привязать файл</button>
    <button onclick="resetCode('${c.code}')">🔄 Сброс</button>
    <button onclick="deleteCode('${c.code}')">🗑 Удалить</button>
  </td>
</tr>
`).join("")}
</table>

<script>
const tgId = new URLSearchParams(window.location.search).get("tg_id");

async function createCode() {
  console.log("TG ID:", tgId);

  const res = await fetch("/admin/create-code?tg_id=" + tgId, {
    method: "POST"
  });

  const data = await res.json();
  console.log("CREATE CODE RESPONSE:", data);

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
<script>
  async function attachFile(code) {
    const input = document.createElement("input");
    input.type = "file";

    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;

      const form = new FormData();
      form.append("file", file);
      form.append("code", code);

      const res = await fetch(
        "/admin/attach-file?tg_id=" + tgId,
        {
          method: "POST",
          body: form,
        }
      );

      if (res.ok) {
        alert("Файл привязан");
        location.reload();
      } else {
        alert("Ошибка привязки файла");
      }
    };

    input.click();
  }
</script>

</body>
</html>
    `);
  } catch (e) {
    console.error("ADMIN ERROR:", e);
    res.status(500).send("Admin error");
  }
});

// ================== ADMIN ACTIONS ==================

app.post("/admin/create-code", checkAdmin, async (req, res) => {
  try {
    const code = crypto.randomUUID().slice(0, 8).toUpperCase();

    const { error } = await supabase
      .from("gifts")
      .insert({
        code,
        is_used: false,
      });

    if (error) {
      console.error("CREATE CODE ERROR:", error);
      return res.status(500).json({ error: error.message });
    }

    console.log("CODE CREATED:", code);
    res.json({ success: true, code });
  } catch (e) {
    console.error("CREATE CODE EXCEPTION:", e);
    res.status(500).json({ error: "Create code failed" });
  }
});
app.post("/admin/delete-code", checkAdmin, async (req, res) => {
  const { code } = req.body;
  await supabase.from("gifts").delete().eq("code", code);
  res.json({ success: true });
});

app.post("/admin/reset-code", checkAdmin, async (req, res) => {
  const { code } = req.body;
  await supabase.from("gifts").update({ is_used: false }).eq("code", code);
  res.json({ success: true });
});
app.post(
  "/admin/attach-file",
  checkAdmin,
  upload.single("file"),
  async (req, res) => {
    try {
      const { code } = req.body;

      if (!code || !req.file) {
        return res.status(400).json({ error: "Нет кода или файла" });
      }

      const ext = path.extname(req.file.originalname);
      const fileName = `gift_${code}_${Date.now()}${ext}`;

      // загружаем файл
      const { error: uploadError } = await supabase.storage
        .from("gift-files")
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype,
        });

      if (uploadError) throw uploadError;

      // сохраняем путь в БД
      const { error: dbError } = await supabase
        .from("gifts")
        .update({ file_path: true })
        .eq("code", code);

      if (dbError) throw dbError;

      res.json({ success: true });
    } catch (e) {
      console.error("ATTACH FILE ERROR:", e);
      res.status(500).json({ error: e.message });
    }
  }
);
// ================== START ==================
app.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});