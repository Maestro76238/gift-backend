import { createGiftCode } from "./gifts.js";
import { tgSend } from "./telegram.js";

export async function handleYookassaWebhook(req, res, supabase) {
  try {
    const event = req.body;

    console.log("📩 YOOKASSA EVENT:", event?.event);

    if (event?.event !== "payment.succeeded") {
      return res.send("ok");
    }

    const payment = event.object;
    const orderId = payment.metadata?.order_id;
    const tgId = payment.metadata?.tg_id;

    if (!orderId || !tgId) {
      console.warn("⚠️ Missing metadata");
      return res.send("ok");
    }

    // обновляем заказ
    await supabase
      .from("orders")
      .update({ status: "paid" })
      .eq("id", orderId);

    // создаём код
    const code = await createGiftCode(supabase);

    // уведомления
    await tgSend(
      tgId,
      ✅ <b>Оплата прошла</b>\n\n🎁 Код:\n<code>${code}</code>
    );

    await tgSend(
      process.env.ADMIN_TG_ID,
      💰 Новая оплата\nTG: ${tgId}\nКод: ${code}
    );

    return res.send("ok");
  } catch (err) {
    console.error("❌ YOOKASSA ERROR (IGNORED):", err);
    return res.send("ok");
  }
}