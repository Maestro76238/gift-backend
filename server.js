import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
import path from "path";
import { fileURLToPath } from "url";

// 🔹 нужно для ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ======================================================
// ADMIN PANEL
// ======================================================
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "upload.html"));
});
app.use(cors());
app.use(express.json());

const upload = multer();

// ===============================
// __dirname для ESM
// ===============================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
// SUPABASE
// ===============================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ===============================
// CREATE GIFT (UPLOAD)
// ===============================
app.post("/api/create-gift", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const ext = file.originalname.includes(".")
      ? file.originalname.split(".").pop()
      : "bin";

    const fileName = ${Date.now()}-${crypto.randomUUID()}.${ext};
    const filePath = gifts/${fileName};

    const { error: uploadError } = await supabase.storage
      .from("gift-files")
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return res.status(500).json({ error: uploadError.message });
    }

    const code = Math.random().toString(36).substring(2, 10).toUpperCase();

    const { error: dbError } = await supabase
      .from("gifts")
      .insert({
        code,
        file_path: filePath,
        is_used: false,
      });

    if (dbError) {
      console.error("DB error:", dbError);
      return res.status(500).json({ error: dbError.message });
    }

    res.json({ success: true, code });
  } catch (err) {
    console.error("Create gift error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// GET GIFT (ONE TIME)
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

    if (signedError) {
      console.error("Signed URL error:", signedError);
      return res.status(500).json({ error: signedError.message });
    }

    await supabase
      .from("gifts")
      .update({ is_used: true })
      .eq("id", data.id);

    res.json({ gift_url: signed.signedUrl });
  } catch (err) {
    console.error("Get gift error:", err);
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