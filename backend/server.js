import express from "express";
import cors from "cors";
import multer from "multer";
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
// MULTER (upload)
// =====================
const upload = multer({ storage: multer.memoryStorage() });

// =====================
// ROOT — чтобы НЕ было Cannot GET /
// =====================
app.get("/", (req, res) => {
  res.send("Backend is alive ✅");
});

// =====================
// ADMIN PANEL
// backend/upload.html
// =====================
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "upload.html"));
});

// =====================
// FILE UPLOAD
// =====================
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file" });
    }

    const ext = req.file.originalname.split(".").pop();
    const fileName = '${Date.now()}-${crypto.randomUUID()}.${ext}';

    const { error } = await supabase.storage
      .from("gift-files")
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
      });

    if (error) throw error;

    res.json({ ok: true, file: fileName });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// =====================
// START
// =====================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});