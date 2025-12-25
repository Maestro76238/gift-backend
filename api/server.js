// ============ ПРОВЕРКА СТАТУСА ============
async function handleCheckStatus(chatId, userId) {
  const reservation = await checkUserReservation(userId);
  
  if (!reservation) {
    sendInstant(chatId, 
      "📭 У вас нет активных резерваций.\n\nНажмите 'Купить ключ' для создания новой.",
      { parse_mode: "HTML" }
    );
    return;
  }
  
  const reservedTime = new Date(reservation.reserved_at);
  const now = new Date();
  const diffHours = Math.floor((now - reservedTime) / (1000 * 60 * 60));
  const remainingHours = 24 - diffHours;
  
  let statusText = "";
  if (reservation.status === 'reserved') {
    statusText = "⏳ <b>Ожидает оплаты</b>";
  } else if (reservation.status === 'paid') {
    statusText = "✅ <b>Оплачен</b>";
  } else {
    statusText = "❓ <b>Неизвестный статус</b>";
  }
  
  let message = `📋 <b>СТАТУС ВАШЕЙ РЕЗЕРВАЦИИ</b>\n\n`;
  message += `🔑 Код: <code>${reservation.code}</code>\n`;
  message += `📊 Статус: ${statusText}\n`;
  message += `⏰ Зарезервирован: ${reservedTime.toLocaleString('ru-RU')}\n`;
  message += `⏳ Действует еще: <b>${remainingHours} часов</b>\n\n`;
  
  if (reservation.status === 'reserved') {
    message += `💳 <b>Оплатите в течение ${remainingHours} часов!</b>`;
  } else if (reservation.status === 'paid') {
    message += `🎁 <b>Подарок готов к получению!</b>`;
  }
  
  const keyboard = [];
  
  if (reservation.status === 'reserved') {
    keyboard.push([{ text: "💳 ОПЛАТИТЬ 100 ₽", url: "https://t.me/gift_celler_bot" }]);
    keyboard.push([{ text: "❌ ОТМЕНИТЬ РЕЗЕРВ", callback_data: `CANCEL_RESERVE_${reservation.code}` }]);
  }
  
  keyboard.push([{ text: "📊 ОБЩАЯ СТАТИСТИКА", callback_data: "STATS" }]);
  
  sendInstant(chatId, message, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: keyboard
    }
  });
}

// ============ ОТМЕНА РЕЗЕРВАЦИИ ============
async function handleCancelReservation(chatId, userId, code) {
  if (!dbStatus.connected || !supabase) {
    sendInstant(chatId, "❌ Ошибка подключения к базе данных");
    return;
  }
  
  try {
    // Проверяем, что пользователь отменяет свою резервацию
    const { data: gift, error } = await supabase
      .from('gifts')
      .select('id, code, tg_user_id, status')
      .eq('code', code)
      .eq('tg_user_id', userId)
      .eq('status', 'reserved')
      .single();
    
    if (error || !gift) {
      sendInstant(chatId, "❌ Не найдено вашей активной резервации");
      return;
    }
    
    // Освобождаем подарок
    const { error: updateError } = await supabase
      .from('gifts')
      .update({
        status: 'free',
        reserved: false,
        reserved_at: null,
        tg_user_id: null
      })
      .eq('id', gift.id);
    
    if (updateError) {
      sendInstant(chatId, "❌ Ошибка отмены резервации");
      return;
    }
    
    console.log(`✅ Пользователь ${userId} отменил резервацию ${code}`);
    
    sendInstant(chatId,
`✅ <b>Резервация отменена!</b>\n\n` +
`🔑 Код: <code>${code}</code> снова свободен.\n\n` +
`Теперь вы можете создать новую резервацию.`,
      { parse_mode: "HTML" }
    );
    
  } catch (error) {
    console.log("❌ Ошибка отмены резервации:", error.message);
    sendInstant(chatId, "❌ Произошла ошибка при отмене");
  }
}