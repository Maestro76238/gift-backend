import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";




// ================== ENV ==================
const {
  PORT,
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ SUPABASE ENV MISSING");
  process.exit(1);
}

// ================== INIT APP ==================
const app = express();
app.use(cors());
app.use(express.json());

// ================== SUPABASE ==================
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY
);


// ================== HEALTH ==================
app.get("/", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// ================== START ==================
const LISTEN_PORT = PORT || 10000;

app.listen(LISTEN_PORT, () => {
  console.log(`🚀 Server started on port ${LISTEN_PORT}`);
});