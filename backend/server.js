import express from "express";
import cors from "cors";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// multer — загрузка файлов в память
const upload = multer({
  limits: { fileSize: 50 * 1024 * 1024 }, // до 50MB
});

// ======================================================
// HEALTH (Render проверяет этот роут)
// ======================================================
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// ======================================================
// DEBUG ENV (можно удалить позже)
// ======================================================
app.get("/debug/env", (req, res) => {
  res.json({
    SUPABASE_URL: process.env.SUPABASE_URL || "EMPTY",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
      ? "LOADED (hidden)"
      : "EMPTY",
  });
});

// ======================================================
// SUPABASE CLIENT
// ======================================================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ======================================================
// 1) CREATE GIFT — загрузка файла + генерация кода
// ======================================================
app.post("/api/create-gift", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Получаем расширение файла
    const ext = file.originalname.includes(".")
      ? file.originalname.split(".").pop()
      : "bin";

    // Безопасное имя файла (НИКАКИХ русских символов)
    const safeName = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const filePath = `gifts/${safeName}`;

    console.log("📤 Uploading:", filePath);

    // Загрузка в Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("gift-files") // ⚠️ bucket ДОЛЖЕН существовать
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      console.error("❌ Upload error:", uploadError.message);
      return res.status(500).json({ error: uploadError.message });
    }

    // Генерация кода подарка
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();

    // Запись в таблицу gifts
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

    res.json({
      success: true,
      code: data[0].code,
    });
  } catch (err) {
    console.error("🔥 Server error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// 2) GET GIFT — одноразовое получение подарка
// ======================================================
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

    // Генерируем подписанную ссылку (действует 24 часа)
    const { data: signed, error: signedError } =
      await supabase.storage
        .from("gift-files")
        .createSignedUrl(data.file_path, 60 * 60 * 24);

    if (signedError) {
      console.error("❌ Signed URL error:", signedError.message);
      return res.status(500).json({ error: signedError.message });
    }

    // Помечаем подарок как использованный
    await supabase
      .from("gifts")
      .update({ is_used: true })
      .eq("id", data.id);

    res.json({
      gift_url: signed.signedUrl,
    });
  } catch (err) {
    console.error("🔥 Get gift error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// START SERVER
// ======================================================
const PORT = process.env.PORT || 10000;
app.get("/api/download-gift/:code", async (req, res) => {
  const { code } = req.params;

  const { data, error } = await supabase
    .from("gifts")
    .select("*")
    .eq("code", code)
    .single();

  if (!data) {
    return res.status(404).send("Invalid code");
  }

  if (data.is_used) {
    return res.status(400).send("Code already used");
  }

  // Получаем файл
  const { data: file, error: fileError } = await supabase.storage
    .from("gift-files")
    .download(data.file_path);

  if (fileError) {
    return res.status(500).send("File error");
  }

  // Помечаем код использованным
  await supabase
    .from("gifts")
    .update({ is_used: true })
    .eq("id", data.id);

  res.setHeader(
    "Content-Disposition",
    attachment; filename="gift"
  );
  res.setHeader("Content-Type", "application/octet-stream");

  const buffer = Buffer.from(await file.arrayBuffer());
  res.send(buffer);
});
app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});
