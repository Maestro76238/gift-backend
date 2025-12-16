import express from "express";
import cors from "cors";
import crypto from "crypto";
import fetch from "node-fetch";
import TelegramBot from "node-telegram-bot-api";
import { createClient } from "@supabase/supabase-js";
import multer from "multer";

// ================== ENV ==================
const {
  BOT_TOKEN,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  ADMIN_TG_ID,
  YOOKASSA_SECRET,
  PORT
} = process.env;

// ================== APP ==================
const app = express();
app.use(cors());
app.use(express.json());

// ================== SUPABASE ==================
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

// ================== TELEGRAM BOT ==================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

async function tgSend(chatId, text) {
  try {
    await bot.sendMessage(chatId, text, { parse_mode: "HTML" });
  } catch (e) {
    console.error("TG SEND ERROR:", e.message);
  }
}

// ================== ADMIN CHECK ==================
function checkAdmin(req, res, next) {
  const tgId = String(req.query.tg_id || "");
  if (!tgId || tgId !== String(ADMIN_TG_ID)) {
    return res.status(403).send("Admin access denied");
  }
  next();
}

// ================== YOOKASSA WEBHOOK ==================
app.post("/yookassa", async (req, res) => {
  try {
    const event = req.body;
    console.log("📩 YOOKASSA:", JSON.stringify(event, null, 2));

    if (event.event !== "payment.succeeded") {
      return res.send("ok");
    }

    const payment = event.object;
    const orderId = payment.metadata.order_id;
    const tgId = payment.metadata.tg_id;

    // 🔐 создаём код
    const code = crypto.randomUUID().slice(0, 8).toUpperCase();

    await supabase.from("gifts").insert({
      code,
      is_used: false,
      file_url: null
    });

    await supabase
      .from("orders")
      .update({ status: "paid" })
      .eq("id", orderId);

    await tgSend(
      tgId,
      `✅ <b>Оплата прошла!</b>\n\nВаш код:\n<code>${code}</code>`
    );

    await tgSend(
      ADMIN_TG_ID,
      `💰 Новая оплата\nTG: ${tgId}\nКод: ${code}`
    );

    res.send("ok");
  } catch (e) {
    console.error("❌ YOOKASSA ERROR:", e);
    res.send("ok");
  }
});

// ================== GET GIFT ==================
app.get("/api/get-gift/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();

    const { data: gift } = await supabase
      .from("gifts")
      .select("*")
      .eq("code", code)
      .single();

    if (!gift || gift.is_used || !gift.file_url) {
      return res.status(404).json({ error: "Invalid or used" });
    }

    res.json({ gift_url: gift.file_url });
  } catch (e) {
    console.error("GET GIFT ERROR:", e);
    res.status(404).json({ error: "Invalid" });
  }
});

// ================== USE GIFT ==================
app.post("/api/use-gift/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();

    await supabase
      .from("gifts")
      .update({ is_used: true })
      .eq("code", code);

    res.json({ success: true });
  } catch (e) {
    console.error("USE GIFT ERROR:", e);
    res.status(500).json({ error: "fail" });
  }
});

// ================== FILE UPLOAD ==================
const upload = multer({ storage: multer.memoryStorage() });

app.post(
  "/admin/attach-file",
  checkAdmin,
  upload.single("file"),
  async (req, res) => {
    try {
      const { code } = req.body;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: "No file" });
      }

      const ext = file.originalname.split(".").pop();
      const fileName = `gift_${code}_${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("gifts")
        .upload(fileName, file.buffer, {
          contentType: file.mimetype
        });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from("gifts")
        .getPublicUrl(fileName);

      await supabase
        .from("gifts")
        .update({ file_url: data.publicUrl })
        .eq("code", code);

      res.json({ success: true });
    } catch (e) {
      console.error("ATTACH FILE ERROR:", e);
      res.status(500).json({ error: "attach fail" });
    }
  }
);

// ================== ADMIN PANEL ==================
app.get("/admin", checkAdmin, async (req, res) => {
  try {
    const { data: orders = [] } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });

    const { data: gifts = [] } = await supabase
      .from("gifts")
      .select("*")
      .order("created_at", { ascending: false });

    res.send(`
      <h1>🛠 Admin</h1>

      <h2>📦 Orders</h2>
      ${orders.map(o => `<div>${o.id} — ${o.status}</div>`).join("")}

      <h2>🔑 Gifts</h2>
      ${gifts.map(g => `
        <div>
          ${g.code} | ${g.is_used ? "USED" : "ACTIVE"}
          <form method="post" action="/admin/attach-file?tg_id=${req.query.tg_id}" enctype="multipart/form-data">
            <input type="hidden" name="code" value="${g.code}" />
            <input type="file" name="file" />
            <button>Attach</button>
          </form>
        </div>
      `).join("")}
    `);
  } catch (e) {
    console.error("ADMIN ERROR:", e);
    res.status(500).send("Admin error");
  }
});

// ================== HEALTH ==================
app.get("/", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// ================== START ==================
const port = PORT || 10000;
app.listen(port, () => {
  console.log("🚀 Server running on", port);
});
