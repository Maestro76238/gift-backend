import express from "express";
import cors from "cors";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import fetch from "node-fetch"
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

// ===== PATH FIX =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== APP =====
const app = express();
app.use(cors());
app.use(express.json());

// ===== SUPABASE =====
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ===== MULTER =====
const upload = multer({ storage: multer.memoryStorage() });

// ===== HEALTH =====
app.get("/", (req, res) => {
  res.send("Backend is alive ✅");
});

// ===== ADMIN PANEL =====
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "upload.html"));
});

// ================== CREATE GIFT ==================
app.post("/api/create-gift", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const ext = req.file.originalname.split(".").pop();
    const safeName =
      Date.now().toString() +
      "-" +
      crypto.randomUUID() +
      "." +
      ext;

    // upload to storage
    const { error: uploadError } = await supabase.storage
      .from("gift-files")
      .upload(safeName, req.file.buffer, {
        contentType: req.file.mimetype,
      });

    if (uploadError) {
      console.error(uploadError);
      return res.status(500).json({ error: uploadError.message });
    }

    // generate CODE (UPPERCASE)
    const code = crypto.randomUUID().slice(0, 8).toUpperCase();

    // insert to DB
    const { error: dbError } = await supabase.from("gifts").insert({
      code,
      file_path: safeName,
      is_used: false,
    });

    if (dbError) {
      console.error(dbError);
      return res.status(500).json({ error: dbError.message });
    }

    res.json({ success: true, code });
  } catch (e) {
    console.error("CREATE GIFT ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

// ================== GET GIFT ==================
app.get("/api/get-gift/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();

    const { data, error } = await supabase
      .from("gifts")
      .select("*")
      .eq("code", code)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Invalid code" });
    }

    if (data.is_used) {
      return res.status(400).json({ error: "Code already used" });
    }

    const { data: signed, error: signedError } =
      await supabase.storage
        .from("gift-files")
        .createSignedUrl(data.file_path, 60 * 60 * 24);

    if (signedError) {
      return res.status(500).json({ error: signedError.message });
    }

    await supabase
      .from("gifts")
      .update({ is_used: true })
      .eq("id", data.id);

    res.json({ gift_url: signed.signedUrl });
  } catch (e) {
    console.error("GET GIFT ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});
// ================== TELEGRAM BOT ==================
const TG_TOKEN = process.env.TG_TOKEN;
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;

// helper
async function tg(method, body) {
  await fetch(`${TG_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// webhook
app.post("/tg", async (req, res) => {
  const update = req.body;
  console.log("📩 TG UPDATE:", JSON.stringify(update));
  res.sendStatus(200);

  // ===== /start =====
  if (update.message?.text === "/start") {
    await tg("sendMessage", {
      chat_id: update.message.chat.id,
      text:
        "🎄 С наступающим Новым годом!\n\n" +
        "Здесь вы можете купить секретный ключ 🔑\n" +
        "и открыть свой подарок 🎁\n\n" +
        "Выберите действие 👇",
      reply_markup: {
        inline_keyboard: [
          [{ text: "ℹ️ Как это работает?", callback_data: "INFO" }],
          [{ text: "🔑 Купить секретный ключ", callback_data: "BUY" }],
        ],
      },
    });
  }

  // ===== CALLBACKS =====
  if (update.callback_query) {
    const chatId = update.callback_query.message.chat.id;
    const data = update.callback_query.data;

    // INFO
    if (data === "INFO") {
      await tg("sendMessage", {
        chat_id: chatId,
        text:
          "Данный бот позволяет вам купить секретный ключ 🔑\n" +
          "всего за 100 рублей и открыть свой новогодний подарок 🎁\n\n" +
          "❗ Важно:\n" +
          "Код одноразовый.\n" +
          "После открытия подарка он сгорает 🔥",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔙 Назад", callback_data: "BACK" }],
          ],
        },
      });
    }

    // BUY
    if (data === "BUY") {
  // проверка активного кода
  const { data: activeGift } = await supabase
    .from("gifts")
    .select("id")
    .eq("tg_user_id", chatId)
    .eq("is_used", false)
    .maybeSingle();

  if (activeGift) {
    return send(chatId, "❗ У вас уже есть активный ключ. Сначала используйте его.");
  }

  const paymentId = crypto.randomUUID();

  await supabase.from("payments").insert({
    tg_user_id: chatId,
    payment_id: paymentId,
    amount: 100,
    status: "pending"
  });

  const payUrl =
    https://yoomoney.ru/quickpay/confirm.xml +
    ?receiver=${process.env.YOOMONEY_WALLET} +
    &label=${paymentId} +
    &quickpay-form=shop +
    &targets=Секретный+ключ +
    &sum=100 +
    &paymentType=SB;

  send(chatId, "💳 Оплатите ключ по кнопке ниже 👇", {
    inline_keyboard: [[
      { text: "💳 Оплатить 100 ₽", url: payUrl }
    ]]
  });
}

    // BACK
    if (data === "BACK") {
      await tg("sendMessage", {
        chat_id: chatId,
        text:
          "🎄 С наступающим Новым годом!\n\n" +
          "Выберите действие 👇",
        reply_markup: {
          inline_keyboard: [
            [{ text: "ℹ️ Как это работает?", callback_data: "INFO" }],
            [{ text: "🔑 Купить секретный ключ", callback_data: "BUY" }],
          ],
        },
      });
    }
  }
});
app.post("/yoomoney", express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const {
      notification_type,
      operation_id,
      amount,
      currency,
      datetime,
      sender,
      codepro,
      label,
      sha1_hash
    } = req.body;

    const secret = process.env.YOOMONEY_SECRET;

    const checkString =
      notification_type + "&" +
      operation_id + "&" +
      amount + "&" +
      currency + "&" +
      datetime + "&" +
      sender + "&" +
      codepro + "&" +
      secret + "&" +
      label;

    const hash = crypto
      .createHash("sha1")
      .update(checkString)
      .digest("hex");

    if (hash !== sha1_hash) {
      return res.status(403).send("Invalid hash");
    }

    if (Number(amount) !== 100) {
      return res.status(400).send("Wrong amount");
    }

    // ищем платёж
    const { data: payment } = await supabase
      .from("payments")
      .select("*")
      .eq("payment_id", label)
      .single();

    if (!payment || payment.status !== "pending") {
      return res.send("OK");
    }

    // генерируем код
    const code = crypto.randomUUID().slice(0, 8).toUpperCase();

    await supabase.from("gifts").insert({
      code,
      is_used: false,
      tg_user_id: payment.tg_user_id
    });

    await supabase
      .from("payments")
      .update({ status: "paid" })
      .eq("id", payment.id);

    // отправляем код в Telegram
    await fetch(`${TG_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: payment.tg_user_id,
        text: 🎉 Оплата прошла успешно!\n\nВаш секретный ключ:\n🔑 ${code}\n\nВведите его на сайте и откройте подарок 🎁
      })
    });

    res.send("OK");
  } catch (e) {
    console.error("YOOMONEY ERROR:", e);
    res.status(500).send("ERROR");
  }
});

// ===== START =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});