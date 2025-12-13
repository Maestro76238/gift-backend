import express from "express";
import cors from "cors";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import crypto from "crypto";
import path from "path";
import fs from "fs";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer();

// ============================
// SUPABASE
// ============================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ============================
// HEALTH
// ============================
app.get("/health", (req, res) => {
  res.send("OK");
});

// ============================
// ADMIN PANEL (upload.html)
// ============================
app.get("/admin", (req, res) => {
  res.sendFile(path.resolve("upload.html"));
});

// ============================
// CREATE GIFT
// ============================
app.post("/api/create-gift", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file" });
    }

    const ext = path.extname(req.file.originalname) || ".bin";
    const fileName = ${Date.now()}-${crypto.randomUUID()}${ext};
    const filePath = gifts/${fileName};

    const { error: uploadError } = await supabase.storage
      .from("gift-files")
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
      });

    if (uploadError) {
      return res.status(500).json({ error: uploadError.message });
    }

    const code = crypto.randomBytes(4).toString("hex").toUpperCase();

    const { error: dbError } = await supabase.from("gifts").insert({
      code,
      file_path: filePath,
      is_used: false,
    });

    if (dbError) {
      return res.status(500).json({ error: dbError.message });
    }

    res.json({ success: true, code });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================
// GET GIFT (one-time)
// ============================
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
      return res.status(500).json({ error: signedError.message });
    }

    await supabase
      .from("gifts")
      .update({ is_used: true })
      .eq("id", data.id);

    res.json({ gift_url: signed.signedUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================
// START
// ============================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});