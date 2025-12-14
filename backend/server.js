import express from "express";
import cors from "cors";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

// ================== BASE ==================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// ================== SUPABASE ==================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ================== MULTER ==================
const upload = multer({ storage: multer.memoryStorage() });

// ================== HEALTH ==================
app.get("/", (req, res) => {
  res.send("Backend is alive ✅");
});

// ================== ADMIN ==================
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "upload.html"));
});

// ================== CREATE GIFT ==================
app.post("/api/create-gift", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file" });
    }

    const ext = req.file.originalname.split(".").pop();
    const safeName =
      Date.now() + "-" + crypto.randomUUID() + "." + ext;

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
      .slice(0, 8)
      .toUpperCase();

    const { error: dbError } = await supabase.from("gifts").insert({
      code,
      file_path: safeName,
      is_used: false,
    });

    if (dbError) {
      return res.status(500).json({ error: dbError.message });
    }

    res.json({ success: true, code });
  } catch (e) {
    console.error("UPLOAD ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

// ================== CHECK GIFT ==================
app.get("/api/get-gift/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();

    const { data, error } = await supabase
      .from("gifts")
      .select("*")
      .eq("code", code)
      .single();

    if (!data || error) {
      return res.status(404).json({ error: "Invalid code" });
    }

    if (data.is_used) {
      return res.status(400).json({ error: "Code already used" });
    }

    const { data: signed, error: signedError } =
      await supabase.storage
        .from("gift-files")
        .createSignedUrl(data.file_path, 60 * 60);

    if (signedError) {
      return res.status(500).json({ error: signedError.message });
    }

    await supabase
      .from("gifts")
      .update({ is_used: true })
      .eq("id", data.id);

    res.json({ gift_url: signed.signedUrl });
  } catch (err) {
    console.error("GET GIFT ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ================= TELEGRAM WEBHOOK =================
app.post("/telegram", async (req, res) => {
  try {
    console.log("📩 TG UPDATE:", JSON.stringify(req.body));

    const message = req.body.message;
    if (!message) return res.sendStatus(200);

    const chatId = message.chat.id;
    const text = message.text || "";

    let reply = "🤖 Я жив";

    if (text === "/start") {
      reply = "🎄 Привет! Бот работает и готов продавать подарки 🎁";
    }
    console.log("TG_TOKEN =", process.env.TG_TOKEN);

    const tgRes = await fetch(
      "https://api.telegram.org/bot" +
        process.env.TG_TOKEN +
        "/sendMessage",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: reply,
        }),
      }
    );

    const tgJson = await tgRes.json();
    console.log("📤 TG RESPONSE:", tgJson);

    res.sendStatus(200);
  } catch (err) {
    console.error("🔥 TG ERROR:", err);
    res.sendStatus(200);
  }
});
// ================== START ==================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});
