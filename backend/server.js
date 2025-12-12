import express from "express";
import cors from "cors";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer(); // для загрузки файлов

// Создаём Supabase клиент
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // нужен service-role, иначе не запишет файл
);

// Проверка
console.log("Supabase URL:", process.env.SUPABASE_URL);
console.log("Service key exists:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);

/* ==========================================================
   1) Создание подарка: загрузка файла + генерация кода
   ========================================================== */
app.post("/api/create-gift", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // путь для файла
    const filePath = `gifts/${Date.now()}-${file.originalname}`;

    // Загружаем файл в Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("gift-files")
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
      });

    if (uploadError) {
      console.error(uploadError.message);
      return res.status(500).json({ error: uploadError.message });
    }

    // Генерируем секретный код
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();

    // Сохраняем в таблицу gifts
    const { data, error } = await supabase
      .from("gifts")
      .insert({
        code,
        file_path: filePath,
        is_used: false,
      })
      .select("code");

    if (error) {
      console.error(error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true, code: data[0].code });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ==========================================================
   2) Проверка кода + выдача файла (скачивание подарка)
   ========================================================== */
app.get("/api/get-gift/:code", async (req, res) => {
  const { code } = req.params;

  // Ищем подарок по коду
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

  // создаём публичную ссылку
  const { data: urlData } = supabase.storage
    .from("gift-files")
    .getPublicUrl(data.file_path);

  // помечаем как использованный
  await supabase
    .from("gifts")
    .update({ is_used: true })
    .eq("id", data.id);

  res.json({ gift_url: urlData.publicUrl });
});

/* ==========================================================
   Запуск сервера
   ========================================================== */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
