import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

dotenv.config();

// ===============================
// __dirname для ESM
// ===============================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===============================
// APP
// ===============================
const app = express();
app.use(cors());
app.use(express.json());

// ===============================
// MULTER
// ===============================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ===============================
// SUPABASE
// ===============================
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE ENV NOT SET");
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ===============================
// HEALTH
// ===============================
app.get("/health", (req, res) => {
  res.send("OK");
});

// ===============================
// ADMIN PANEL
// ===============================
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "upload.html"));
});

// ===============================
// UPLOAD + CREATE GIFT
// ===============================
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const ext = req.file.originalname.includes(".")
      ? req.file.originalname.split(".").pop()
      : "bin";

    // ✅ ВАЖНО: ОБРАТНЫЕ КАВЫЧКИ
    const safeName = ${Date.now()}-${crypto.randomUUID()}.${ext};
    const filePath = gifts/${safeName};

    const { error: uploadError } = await supabase.storage
      .from("gift-files")
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
      });

    if (uploadError) throw uploadError;

    const code = Math.random().toString(36).substring(2, 10).toUpperCase();

    const { error: dbError } = await supabase.from("gifts").insert({
      code,
      file_path: filePath,
      is_used: false,
    });

    if (dbError) throw dbError;

    res.json({ success: true, code });
  } catch (err) {
    console.error("🔥 UPLOAD ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// GET GIFT (ONE-TIME)
// ===============================
app.get("/api/get-gift/:code", async (req, res) => {
  try {
    const { code } = req.params;

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
        .createSignedUrl(data.file_path, 60 * 60 * 24);

    if (signedError) throw signedError;

    await supabase
      .from("gifts")
      .update({ is_used: true })
      .eq("id", data.id);

    res.json({ gift_url: signed.signedUrl });
  } catch (err) {
    console.error("🔥 GET GIFT ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// START SERVER
// ===============================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});