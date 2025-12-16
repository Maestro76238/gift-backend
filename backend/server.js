import express from "express";
import cors from "cors";
import crypto from "crypto";
import fetch from "node-fetch";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";

// ================= ENV =================
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  YOOKASSA_SHOP_ID,
  YOOKASSA_SECRET_KEY,
  TG_TOKEN,
  ADMIN_TG_ID,
  PORT
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ SUPABASE ENV missing");
  process.exit(1);
}

// ================= INIT =================
const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY
);

const upload = multer({ storage: multer.memoryStorage() });

// ================= HELPERS =================
async function tgSend(chatId, text) {
  if (!TG_TOKEN) return;

  try {
    await fetch(
      `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
        }),
      }
    );
  } catch (e) {
    console.error("TG SEND ERROR (ignored):", e.message);
  }
}

function generateCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

// ================= YOOKASSA WEBHOOK =================
app.post("/yookassa", async (req, res) => {
  try {
    const event = req.body;

    console.log("💳 YOOKASSA:", JSON.stringify(event));

    if (event.event !== "payment.succeeded") {
      return res.send("ok");
    }

    const payment = event.object;
    const tgId = payment.metadata?.tg_id;

    const code = generateCode();

    await supabase.from("gifts").insert({
      code,
      is_used: false,
      file_path: null,
    });

    if (tgId) {
      await tgSend(
        tgId,
        `✅ <b>Оплата прошла</b>\n\nВаш код:\n<code>${code}</code>`
      );
    }

    if (ADMIN_TG_ID) {
      await tgSend(
        ADMIN_TG_ID,
        `💰 Новая оплата\nКод: ${code}`
      );
    }

    res.send("ok");
  } catch (e) {
    console.error("❌ YOOKASSA ERROR:", e);
    res.send("ok");
  }
});

// ================= GIFT CHECK =================
app.get("/api/get-gift/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();

    const { data } = await supabase
      .from("gifts")
      .select("*")
      .eq("code", code)
      .single();

    if (!data || data.is_used) {
      return res.status(400).json({ error: "Invalid or used code" });
    }

    res.json({ gift_url: data.file_path });
  } catch (e) {
    console.error("GET GIFT ERROR:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ================= USE GIFT =================
app.post("/api/use-gift/:code", async (req, res) => {
  try {
    await supabase
      .from("gifts")
      .update({
        is_used: true,
        used_at: new Date().toISOString(),
      })
      .eq("code", req.params.code.toUpperCase());

    res.json({ ok: true });
  } catch (e) {
    console.error("USE GIFT ERROR:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ================= ADMIN =================
function checkAdmin(req, res, next) {
  if (String(req.query.tg_id) !== String(ADMIN_TG_ID)) {
    return res.status(403).send("Forbidden");
  }
  next();
}

app.get("/admin", checkAdmin, async (req, res) => {
  const { data: gifts = [] } = await supabase
    .from("gifts")
    .select("*")
    .order("created_at", { ascending: false });

  res.send(`
    <h1>Admin</h1>
    <table border="1">
      <tr>
        <th>Code</th>
        <th>Used</th>
        <th>File</th>
      </tr>
      ${gifts
        .map(
          g =>
            `<tr>
              <td>${g.code}</td>
              <td>${g.is_used}</td>
              <td>${g.file_path || "-"}</td>
            </tr>`
        )
        .join("")}
    </table>
  `);
});

// ================= ATTACH FILE =================
app.post(
  "/admin/attach-file",
  checkAdmin,
  upload.single("file"),
  async (req, res) => {
    try {
      const { code } = req.body;
      const file = req.file;

      if (!file || !code) {
        return res.status(400).json({ error: "Missing file or code" });
      }

      const ext = file.originalname.split(".").pop();
      const fileName = `gift_${code}_${Date.now()}.${ext}`;

      const { error } = await supabase.storage
        .from("gifts")
        .upload(fileName, file.buffer);

      if (error) throw error;

      const { data } = supabase.storage
        .from("gifts")
        .getPublicUrl(fileName);

      await supabase
        .from("gifts")
        .update({ file_path: data.publicUrl })
        .eq("code", code.toUpperCase());

      res.json({ ok: true });
    } catch (e) {
      console.error("ATTACH FILE ERROR:", e);
      res.status(500).json({ error: "Attach failed" });
    }
  }
);

// ================= HEALTH =================
app.get("/", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// ================= START =================
const RUN_PORT = PORT || 10000;
app.listen(RUN_PORT, () => {
  console.log(`🚀 Server started on ${RUN_PORT}`);
});
