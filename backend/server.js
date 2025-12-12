import express from "express";
import cors from "cors";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer();

// ===============================
// Health-check (Render требует!)
// ===============================
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// Простой тест
app.get("/test", (req, res) => {
  res.json({ status: "server alive" });
});

// ===============================
// Supabase client
// ===============================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log("🔗 Supabase URL:", supabaseUrl);
console.log("🔐 Service key loaded:", !!supabaseKey);

const supabase = createClient(supabaseUrl, supabaseKey);

/* ==========================================================
   1) Создание подарка (запись файла + генерация кода)
   ========================================================== */
app.post("/api/create-gift", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const filePath = `gifts/${Date.now()}-${file.originalname}`;

    // Загружаем файл в Storage
    const { error: uploadError } = await supabase.storage
      .from("gift-files")
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
      });

    if (uploadError) {
      console.error("❌ Upload error:", uploadError.message);
      return res.status(500).json({ error: uploadError.message });
    }

    // Генерация кода
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();

    // Запись в таблицу
    const { data, error } = await supabase
      .from("gifts")
      .insert({
        code,
        file_path: filePath,
        is_used: false,
      })
      .select("code");

    if (error) {
      console.error("❌ DB error:", error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true, code: data[0].code });
  } catch (err) {
    console.error("🔥 Server error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ==========================================================
   2) Проверка кода + выдача подарка
   ========================================================== */
app.get("/api/get-gift/:code", async (req, res) => {
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

  // Получаем публичную ссылку
  const { data: urlData } = supabase.storage
    .from("gift-files")
    .getPublicUrl(data.file_path);

  // Помечаем как использованный
  await supabase
    .from("gifts")
    .update({ is_used: true })
    .eq("id", data.id);

  res.json({ gift_url: urlData.publicUrl });
});

/* ==========================================================
   3) Запуск сервера
   ========================================================== */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
