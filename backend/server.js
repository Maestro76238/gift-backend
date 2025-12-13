import express from "express";
import cors from "cors";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// ================= SUPABASE =================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ================= MULTER =================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50mb
});

// ================= HEALTH =================
app.get("/", (req, res) => {
  res.send("Backend is alive ✅");
});

// ================= ADMIN =================
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "upload.html"));
});

// ================= CREATE GIFT =================
app.post("/api/create-gift", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const ext = path.extname(req.file.originalname);
    const safeName =
      Date.now().toString() + "-" + crypto.randomUUID() + ext;

    // upload to storage
    const { error: uploadError } = await supabase.storage
      .from("gift-files")
      .upload(safeName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      return res.status(500).json({ error: uploadError.message });
    }

    const code = crypto
  .randomUUID()
  .replace(/-/g, "")
  .slice(0, 8)
  .toUpperCase();


    const { error: dbError } = await supabase.from("gifts").insert({
      code,
      file_path: safeName,
      is_used: false, // ❗️ВАЖНО
    });

    if (dbError) {
      return res.status(500).json({ error: dbError.message });
    }

    res.json({
      success: true,
      code,
    });
  } catch (err) {
    console.error("CREATE GIFT ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ================= GET GIFT (CHECK ONLY) =================
app.get("/api/get-gift/:code", async (req, res) => {
  try {
    const { code } = req.params;

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

    // ❗️НИКАКОГО update здесь
await supabase
      .from("gifts")
      .update({ is_used: true })
      .eq("id", data.id);

    res.json({
      gift_url: signed.signedUrl,
    });
  } catch (err) {
    console.error("GET GIFT ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ================= MARK AS USED =================
app.post("/api/use-gift/:code", async (req, res) => {
  try {
    const { code } = req.params;

    const { error } = await supabase
      .from("gifts")
      .update({ is_used: true })
      .eq("code", code);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ================= TELEGRAM BOT =================
import fetch from "node-fetch";

const TG_TOKEN = process.env.TG_BOT_TOKEN;
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;

// webhook endpoint
app.post("/telegram", async (req, res) => {
  try {
    const update = req.body;

    if (!update.message) {
      return res.sendStatus(200);
    }

    const chatId = update.message.chat.id;
    const text = update.message.text || "";

    // /start
    if (text === "/start") {
      await fetch(`${TG_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text:
            "🎁 Добро пожаловать!\n\n" +
            "Здесь вы можете купить подарочный код.\n\n" +
            "Нажмите кнопку ниже 👇",
          reply_markup: {
            keyboard: [[{ text: "🎟 Купить код" }]],
            resize_keyboard: true,
          },
        }),
      });
    }

    // Купить код
    if (text === "🎟 Купить код") {
      await fetch(`${TG_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text:
            "💳 Оплата скоро будет подключена.\n\n" +
            "Пока что это тестовый бот.",
        }),
      });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("TG ERROR:", err);
    res.sendStatus(200);
  }
});

// ================= START =================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});
