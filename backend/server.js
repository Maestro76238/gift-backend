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

// =====================
// SUPABASE
// =====================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// =====================
// MULTER
// =====================
const upload = multer({
  storage: multer.memoryStorage(),
});

// =====================
// HEALTH
// =====================
app.get("/", (req, res) => {
  res.send("Backend is alive ✅");
});

// =====================
// ADMIN PANEL
// =====================
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "upload.html"));
});

// =====================
// CREATE GIFT (ADMIN)
// =====================
app.post("/api/create-gift", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const ext = req.file.originalname.split(".").pop();
    const safeName =
      Date.now() + "-" + crypto.randomUUID() + "." + ext;

    // upload to storage
    const { error: uploadError } = await supabase.storage
      .from("gift-files")
      .upload(safeName, req.file.buffer, {
        contentType: req.file.mimetype,
      });

    if (uploadError) {
      return res.status(500).json({ error: uploadError.message });
    }

    const code = crypto.randomUUID().slice(0, 8).toUpperCase();

    const { error: dbError } = await supabase.from("gifts").insert({
      code,
      file_path: safeName,
      is_used: false,
    });

    if (dbError) {
      return res.status(500).json({ error: dbError.message });
    }

    res.json({ success: true, code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// CHECK CODE (НЕ СПИСЫВАЕТ)
// =====================
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

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// DOWNLOAD GIFT (СПИСЫВАЕТ)
// =====================
app.get("/api/download/:code", async (req, res) => {
  try {
    const { code } = req.params;

    const { data, error } = await supabase
      .from("gifts")
      .select("*")
      .eq("code", code)
      .single();

    if (!data⠺⠵⠺⠟⠞⠵⠺⠟⠺data.is_used) {
      return res.status(400).send("Invalid or used code");
    }

    const { data: signed, error: signedError } =
      await supabase.storage
        .from("gift-files")
        .createSignedUrl(data.file_path, 60);

    if (signedError) {
      return res.status(500).send("Failed to generate link");
    }

    await supabase
      .from("gifts")
      .update({ is_used: true })
      .eq("id", data.id);

    res.redirect(signed.signedUrl);
  } catch (err) {
    res.status(500).send("Server error");
  }
});

// =====================
// START
// =====================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});