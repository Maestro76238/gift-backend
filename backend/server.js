import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();

// ======================================================
// PATH SETUP (ESM)
// ======================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ======================================================
// MIDDLEWARE
// ======================================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ======================================================
// SUPABASE
// ======================================================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ======================================================
// HEALTH CHECK
// ======================================================
app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

// ======================================================
// ADMIN PANEL (UPLOAD)
// ======================================================
app.use("/admin", express.static(path.join(__dirname, "upload")));

// ======================================================
// CREATE GIFT (ADMIN)
// ======================================================
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
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// GET GIFT (USER)
// ======================================================
app.get("/api/get-gift/:code", async (req, res) => {
  try {
    const { code } = req.params;

    const { data, error } = await supabase
      .from("gifts")
      .select("*")
      .eq("code", code)
      .single();

    if (error || !data) {
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

    res.json({
      gift_url: signed.signedUrl,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// START SERVER
// ======================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});