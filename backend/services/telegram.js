import fetch from "node-fetch";

export async function tgSend(chatId, text) {
  if (!process.env.TG_TOKEN) {
    console.warn("⚠️ TG_TOKEN not set");
    return;
  }

  try {
    await fetch(
      https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML"
        })
      }
    );
  } catch (e) {
    console.error("⚠️ Telegram error (ignored):", e.message);
  }
}