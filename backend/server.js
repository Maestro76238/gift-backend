import express from "express";
import fetch from "node-fetch";
import supabase from "./supabaseClient.js";


const app = express();
app.use(express.json());

// ====== ENV ======
const TG_TOKEN = process.env.TG_TOKEN;
const ADMIN_TG_ID = process.env.ADMIN_TG_ID; // пока не используется
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;
const PRICE = 1; // 1 рубль (потом поменяешь на 100)
const CODE_TTL_MINUTES = 5;

// ====== HELPERS ======
async function sendMessage(chatId, text, keyboard = null) {
    const body = {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
    };

    if (keyboard) {
        body.reply_markup = keyboard;
    }

    await fetch(`${TG_API}/sendMessage`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(body),
    });
}

// ====== KEYBOARDS ======
const mainKeyboard = {
    inline_keyboard: [
        [{text: "ℹ️ Как это работает?", callback_data: "INFO"}],
        [{text: "🔑 Купить секретный ключ", callback_data: "BUY"}],
    ],
};

const backKeyboard = {
    inline_keyboard: [
        [{text: "⬅️ Назад", callback_data: "BACK"}],
    ],
};

// ====== TELEGRAM WEBHOOK ======
app.post("/tg", async (req, res) => {
    try {
        const update = req.body;
        console.log("📩 TG UPDATE:", JSON.stringify(update));

        // --- /start ---
        if (update.message && update.message.text === "/start") {
            const chatId = update.message.chat.id;

            await sendMessage(
                chatId,
                "🎄 <b>С наступающим Новым годом!</b>\n\n" +
                "Здесь вы можете купить секретный ключ 🔑 и открыть свой подарок 🎁\n\n" +
                "Выберите действие 👇",
                mainKeyboard
            );
        }

        // --- BUTTONS ---
        if (update.callback_query) {
            const chatId = update.callback_query.message.chat.id;
            const data = update.callback_query.data;

            if (data === "INFO") {
                await sendMessage(
                    chatId,
                    "ℹ️ <b>Как это работает</b>\n\n" +
                    "1️⃣ Вы покупаете секретный ключ 🔑\n" +
                    "2️⃣ Вводите его на сайте\n" +
                    "3️⃣ Открывается ваш подарок 🎁\n\n" +
                    "⚠️ Код одноразовый и сгорает после использования",
                    backKeyboard
                );
            }

            if (data === "BUY") {
                // проверяем, есть ли активный код
                const {data: active} = await supabase
                    .from("orders")
                    .select("*")
                    .eq("tg_id", chatId)
                    .eq("status", "pending")
                    .maybeSingle();

                if (active) {
                    return send(chatId, "❌ У вас уже есть активный неоплаченный код");
                }

                const code = crypto.randomUUID().slice(0, 8).toUpperCase();

                const {data: order} = await supabase
                    .from("orders")
                    .insert({
                        tg_id: chatId,
                        code,
                        amount: PRICE,
                        status: "pending",
                    })
                    .select()
                    .single();

                // авто-сгорание через 5 минут
                setTimeout(async () => {
                    await supabase
                        .from("orders")
                        .update({status: "expired"})
                        .eq("id", order.id)
                        .eq("status", "pending");
                }, CODE_TTL_MINUTES * 60 * 1000);

                const payUrl = createPayLink(order.id);

                await send(chatId, "💳 Оплатите ключ по кнопке ниже 👇", {
                    inline_keyboard: [[{text: "💰 Оплатить", url: payUrl}]],
                });
            }

            if (data === "BACK") {
                await sendMessage(
                    chatId,
                    "Выберите действие 👇",
                    mainKeyboard
                );
            }
        }

        res.send("OK");
    } catch (e) {
        console.error("TG ERROR:", e);
        res.send("ERROR");
    }
});

// ====== HEALTH ======
app.get("/", (req, res) => {
    res.send("Telegram bot is alive ✅");
});

function createPayLink(orderId) {
    const params = new URLSearchParams({
        receiver: process.env.YOOMONEY_WALLET,
        quickpay_form: "shop",
        targets: "Секретный ключ",
        paymentType: "AC",
        sum: PRICE,
        label: orderId,
        successURL: "https://gift-backend-tn9w.onrender.com/success"
    });

    return `https://yoomoney.ru/quickpay/confirm.xml?${params.toString()}`;
}

// ====== START ======
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log("🚀 Server running on", PORT);
});