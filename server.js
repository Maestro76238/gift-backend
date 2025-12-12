import express from "express";
import cors from "cors";
import { supabase } from "./supabaseClient.js";

const app = express();

app.use(cors());
app.use(express.json());

// ---------------------------
// Получить все сообщения
// ---------------------------
app.get("/messages", async (req, res) => {
  const { data, error } = await supabase
    .from("messages")
    .select("*");

  if (error) return res.json({ error: error.message });

  res.json(data);
});

// ---------------------------
// Добавить сообщение через POST
// ---------------------------
app.post("/messages/add", async (req, res) => {
  const { user, text } = req.body;

  if (!user || !text) {
    return res.json({ error: "Missing user or text" });
  }

  const { data, error } = await supabase
    .from("messages")
    .insert([{ user_name: user, text }])
    .select();

  if (error) return res.json({ error: error.message });

  res.json({ success: true, added: data });
});

// ---------------------------
// Добавить сообщение через GET (для теста)
// ---------------------------
app.get("/messages/add", async (req, res) => {
  const { user, text } = req.query;

  if (!user || !text) {
    return res.json({ error: "Missing user or text" });
  }

  const { data, error } = await supabase
    .from("messages")
    .insert([{ user_name: user, text }])
    .select();

  if (error) return res.json({ error: error.message });

  res.json({ success: true, added: data });
});

// ---------------------------
// Запуск сервера
// ---------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Backend running on port " + PORT);
});
