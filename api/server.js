// Временно замени весь код в api/index.js на этот:
import express from "express";
const app = express();
app.use(express.json());

app.post("/api/telegram-webhook", (req, res) => {
  console.log("✅ WEBHOOK RECEIVED!");
  console.log("Body:", req.body);
  res.sendStatus(200);
  
  if (req.body.message?.text === "/start") {
    fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        chat_id: req.body.message.chat.id,
        text: "✅ Вебхук работает!"
      })
    }).catch(() => {});
  }
});

app.get("/", (req, res) => {
  res.send("Test webhook");
});

export default app;