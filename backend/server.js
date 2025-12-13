import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();

/* =========================
   BASE SETUP
========================= */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================
   SUPABASE
========================= */
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Supabase env vars missing");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

/* =========================
   HEALTH CHECK
========================= */
app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

/* =========================
   ADMIN PANEL
========================= */
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "upload.html"));
});

/* =========================
   CREATE GIFT
========================= */
app.post("/api/create-gift", async (req, res) => {
  try {
    const { code, file_path } = req.body;

    if (!code || !file_path) {
      return res.status(400).json({ error: "Missing code or file_path" });
    }

    const { error } = await supabase.from("gifts").insert([
      {
        code,
        file_path,
        is_used: false,
      },
    ]);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("🔥 create-gift error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   GET GIFT (ONE TIME)
========================= */
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
    console.error("🔥 get-gift error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});