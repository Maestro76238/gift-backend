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
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
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
      console.error(uploadError);
      return res.status(500).json({ error: uploadError.message });
    }

    const code = crypto.randomUUID().slice(0, 8).toUpperCase();

    // insert into DB (ВАЖНО: is_used = false)
    const { error: dbError } = await supabase.from("gifts").insert({
      code,
      file_path: safeName,
      is_used: false,
    });

    if (dbError) {
      console.error(dbError);
      return res.status(500).json({ error: dbError.message });
    }

    res.json({ success: true, code });
  } catch (e) {
    console.error("CREATE GIFT ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

// ================= CHECK GIFT (НЕ МЕНЯЕТ is_used) =================
app.get("/api/check-gift/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();

    const { data, error } = await supabase
      .from("gifts")
      .select("*")
      .eq("code", code)
      .eq("is_used", false)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Invalid or used code" });
    }

    const { data: signed, error: signError } =
      await supabase.storage
        .from("gift-files")
        .createSignedUrl(data.file_path, 60);

    if (signError) {
      return res.status(500).json({ error: signError.message });
    }

    res.json({
      gift_url: signed.signedUrl,
    });
  } catch (e) {
    console.error("CHECK ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

// ================= CONFIRM DOWNLOAD (ТОЛЬКО ТУТ is_used = true) =================
app.post("/api/confirm-used/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();

    const { error } = await supabase
      .from("gifts")
      .update({ is_used: true })
      .eq("code", code)
      .eq("is_used", false);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (e) {
    console.error("CONFIRM ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

// ================= START =================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});