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

const upload = multer();

// ======================================================
// HEALTH
// ======================================================
app.get("/health", (req, res) => res.send("OK"));

// ======================================================
// DEBUG: ПОКАЗАТЬ ВСЕ ENV
// ======================================================
app.get("/debug/env", (req, res) => {
  res.json({
    SUPABASE_URL: process.env.SUPABASE_URL || "EMPTY",
    SUPABASE_SERVICE_ROLE_KEY:
      process.env.SUPABASE_SERVICE_ROLE_KEY
        ? "LOADED (hidden)"
        : "EMPTY",
  });
});

// ======================================================
// SUPABASE CLIENT
// ======================================================
console.log("=== ENV CHECK ===");
console.log("SUPABASE_URL =", process.env.SUPABASE_URL);
console.log(
  "SUPABASE_SERVICE_ROLE_KEY exists =",
  !!process.env.SUPABASE_SERVICE_ROLE_KEY
);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ======================================================
// 1) CREATE GIFT
// ======================================================
app.post("/api/create-gift", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    // extension
    const ext = file.originalname.includes(".")
      ? file.originalname.split(".").pop()
      : "bin";

    // safe name
    const safeName = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const filePath = `gifts/${safeName}`;

    console.log("Uploading:", filePath);

    const { error: uploadError } = await supabase.storage
      .from("gift-files")
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
      });

    if (uploadError) {
      console.error("UPLOAD ERROR:", uploadError);
      return res.status(500).json({ error: uploadError.message });
    }

    const code = Math.random().toString(36).substring(2, 10).toUpperCase();

    const { data, error } = await supabase
      .from("gifts")
      .insert({
        code,
        file_path: filePath,
        is_used: false,
      })
      .select("code");

    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true, code: data[0].code });
  } catch (err) {
    console.error("SERVER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// 2) GET GIFT
// ======================================================
app.get("/api/get-gift/:code", async (req, res) => {
  const { code } = req.params;

  const { data, error } = await supabase
    .from("gifts")
    .select("*")
    .eq("code", code)
    .single();

  if (!data) return res.status(404).json({ error: "Invalid code" });
  if (data.is_used) return res.status(400).json({ error: "Code already used" });

  const { data: url } = supabase.storage
    .from("gift-files")
    .getPublicUrl(data.file_path);

  await supabase.from("gifts").update({ is_used: true }).eq("id", data.id);

  res.json({ gift_url: url.publicUrl });
});

// ======================================================
// START SERVER
// ======================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
