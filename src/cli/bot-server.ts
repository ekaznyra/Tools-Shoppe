import {
  sendTelegramMessage,
  sendTelegramDocument,
  getTelegramUpdates,
  isAuthorizedUser,
  escapeHtml,
} from '../lib/telegram/index.ts';
import { exportWaybillsToExcel } from '../lib/export/index.ts';
import {
  trackMultipleSPXWaybills,
  extractWaybillsFromText,
  type WaybillTrackingResult,
} from '../lib/spx-tracker/index.ts';
import { trackUniversalWaybill, detectCarrier } from '../lib/multi-carrier-tracker/index.ts';
import { analyzeDeliveryAlerts, sendDeliveryAlertsToTelegram } from '../lib/alert-scanner/index.ts';
import { generateCustomerDeliveryReminder } from '../lib/customer-reminder/index.ts';
import { predictDeliveryETA } from '../lib/eta-predictor/index.ts';
import {
  addToWatchlist,
  getWatchlist,
  removeFromWatchlist,
  startWatchlistPolling,
} from '../lib/waybill-watchlist/index.ts';
import { startWebServer } from '../web/server.ts';
import { logger } from '../lib/logging/index.ts';
import { t, type SupportedLanguage, isValidLanguage } from '../lib/i18n/index.ts';

let autoReportInterval: NodeJS.Timeout | null = null;
const trackedHistory: WaybillTrackingResult[] = [];
const userLanguages = new Map<string, SupportedLanguage>();

function getUserLang(chatId: string): SupportedLanguage {
  return userLanguages.get(chatId) || 'vi';
}

async function handleWaybillSearch(chatId: string, waybillList: string[]): Promise<boolean> {
  if (!waybillList || waybillList.length === 0) return false;
  const lang = getUserLang(chatId);

  // 1. Tra cứu 1 Mã Vận Đơn duy nhất
  if (waybillList.length === 1) {
    const waybillNo = waybillList[0];
    const carrierName = detectCarrier(waybillNo);
    await sendTelegramMessage(
      chatId,
      `🚚 <b>${t('checking', lang).toUpperCase()} (${carrierName})...</b>\n\n• ${t('trackingNoLabel', lang)}: <code>${escapeHtml(waybillNo)}</code>\n• ${t('checkingCarrier', lang)}`
    );

    const spxResult = await trackUniversalWaybill(waybillNo);

    if (spxResult && spxResult.success) {
      if (!trackedHistory.some((h) => h.trackingNo === spxResult.trackingNo)) {
        trackedHistory.unshift(spxResult);
      }

      const eta = predictDeliveryETA(spxResult);

      let msg = `🚚 <b>${t('trackingTitle', lang)}</b>\n\n`;
      msg += `• <b>${t('trackingNoLabel', lang)}:</b> <code>${escapeHtml(spxResult.trackingNo)}</code>\n`;
      if (spxResult.orderSn) {
        msg += `• <b>Mã đơn hàng:</b> <code>${escapeHtml(spxResult.orderSn)}</code>\n`;
      }
      if (spxResult.productName) {
        msg += `• <b>Tên sản phẩm:</b> <i>${escapeHtml(spxResult.productName)}</i> (${spxResult.quantity || 1}x)\n`;
      }
      if (spxResult.totalAmount) {
        msg += `• <b>Tổng tiền:</b> <b>${spxResult.totalAmount.toLocaleString('vi-VN')} VNĐ</b>\n`;
      }
      if (spxResult.customerName) {
        msg += `• <b>Người nhận:</b> <b>${escapeHtml(spxResult.customerName)}</b>\n`;
      }
      msg += `• <b>${t('carrierLabel', lang)}:</b> ${escapeHtml(spxResult.carrier)}\n`;
      msg += `• <b>${t('statusLabel', lang)}:</b> ${escapeHtml(spxResult.status)}\n`;
      msg += `• <b>${t('etaTitle', lang)}:</b> <b>${escapeHtml(eta.estimatedTime)}</b>\n`;
      msg += `   └ <i>${escapeHtml(eta.note)}</i>\n`;

      if (spxResult.latestLocation) {
        msg += `• <b>${t('latestLocation', lang)}:</b> <i>${escapeHtml(spxResult.latestLocation)}</i>\n`;
      }
      if (spxResult.latestTime) {
        msg += `• <b>${t('updatedAt', lang)}:</b> <code>${escapeHtml(spxResult.latestTime)}</code>\n`;
      }
      msg += `\n`;

      if (spxResult.steps && spxResult.steps.length > 0) {
        msg += `<b>${t('timelineHistory', lang)} (${spxResult.steps.length}):</b>\n\n`;
        spxResult.steps.forEach((step, idx) => {
          msg += `<b>${idx + 1}. [${escapeHtml(step.time)} - ${escapeHtml(step.date)}]</b>\n`;
          msg += `   └ ${escapeHtml(step.status)}\n\n`;
        });
      }

      if ((spxResult.status || '').includes('giao') || (spxResult.latestLocation || '').includes('giao')) {
        const reminderText = generateCustomerDeliveryReminder({
          trackingNoOrOrderSn: spxResult.trackingNo,
          carrierName: spxResult.carrier,
        });
        msg += `📲 <b>${t('reminderTitle', lang)}:</b>\n`;
        msg += `<code>${escapeHtml(reminderText)}</code>\n\n`;
        msg += `${t('reminderTip', lang)}\n\n`;
      }

      msg += `${t('watchlistTip', lang, { code: spxResult.trackingNo })}`;

      const publicTrackingUrl = `http://localhost:3000/?track=${encodeURIComponent(spxResult.trackingNo)}`;
      const qrImageUrl = `http://localhost:3000/api/qr?text=${encodeURIComponent(publicTrackingUrl)}`;

      const inlineButtons = {
        inline_keyboard: [
          [
            { text: '🌐 Link Tra Cứu Công Khai', url: publicTrackingUrl },
            { text: '📱 Mã QR Code', url: qrImageUrl },
          ],
        ],
      };

      await sendTelegramMessage(chatId, msg, 'HTML', inlineButtons);

      const alerts = analyzeDeliveryAlerts([spxResult]);
      if (alerts.length > 0) {
        await sendDeliveryAlertsToTelegram(chatId, alerts);
      }

      return true;
    } else {
      await sendTelegramMessage(
        chatId,
        `${t('notFound', lang)}:\n${t('notFoundMsg', lang)} (<code>${escapeHtml(waybillNo)}</code>)`
      );
      return true;
    }
  }

  // 2. Tra cứu HÀNG LOẠT nhiều Mã Vận Đơn cùng lúc
  await sendTelegramMessage(
    chatId,
    `🚚 <b>${t('checking', lang).toUpperCase()} ${waybillList.length} MÃ...</b>\n\n• <code>${waybillList.slice(0, 5).join(', ')}${waybillList.length > 5 ? '...' : ''}</code>`
  );

  logger.info(`Bat dau tra cuu hang loat ${waybillList.length} ma van don...`);
  const results = await trackMultipleSPXWaybills(waybillList);

  results.forEach((r) => {
    if (r.success && !trackedHistory.some((h) => h.trackingNo === r.trackingNo)) {
      trackedHistory.unshift(r);
    }
  });

  const deliveredCount = results.filter((r) => r.status.includes('thành công')).length;
  const shippingCount = results.filter((r) => r.status.includes('đang giao') || r.status.includes('vận chuyển')).length;
  const pendingCount = results.filter((r) => r.status.includes('Chờ')).length;

  let summaryMsg = `📊 <b>${t('trackingTitle', lang)} (${results.length})</b>\n\n`;
  summaryMsg += `• <b>Total:</b> <b>${results.length}</b>\n`;
  summaryMsg += `• ✅ <b>Success:</b> <b>${deliveredCount}</b>\n`;
  summaryMsg += `• 🚚 <b>Shipping:</b> <b>${shippingCount}</b>\n`;
  summaryMsg += `• 📦 <b>Pending:</b> <b>${pendingCount}</b>\n\n`;
  summaryMsg += `<b>${t('timelineHistory', lang)}:</b>\n\n`;

  results.forEach((r, idx) => {
    const eta = predictDeliveryETA(r);
    summaryMsg += `<b>${idx + 1}. Code:</b> <code>${escapeHtml(r.trackingNo)}</code> (${escapeHtml(r.carrier)})\n`;
    summaryMsg += `   • ${t('statusLabel', lang)}: <b>${escapeHtml(r.status)}</b>\n`;
    summaryMsg += `   • ${t('etaTitle', lang)}: <b>${escapeHtml(eta.estimatedTime)}</b>\n`;
    if (r.latestLocation) {
      summaryMsg += `   • ${t('latestLocation', lang)}: <i>${escapeHtml(r.latestLocation)}</i>\n`;
    }
    summaryMsg += `\n`;
  });

  await sendTelegramMessage(chatId, summaryMsg);

  const alerts = analyzeDeliveryAlerts(results);
  if (alerts.length > 0) {
    await sendTelegramMessage(chatId, `🚨 <b>PHÁT HIỆN ${alerts.length} ĐƠN HÀNG CÓ CẢNH BÁO KHẨN CẤP:</b>`);
    await sendDeliveryAlertsToTelegram(chatId, alerts);
  }

  try {
    const excelPath = await exportWaybillsToExcel(results);
    await sendTelegramDocument(chatId, excelPath, `📊 Báo cáo tra cứu hàng loạt (${results.length} mã)`);
  } catch (e: any) {
    logger.error({ error: e.message }, 'Loi khi gui file Excel ma van don');
  }

  return true;
}

function startAutoReportScheduler(chatId: string) {
  if (autoReportInterval) clearInterval(autoReportInterval);
  logger.info(`Da bat lich tu dong gui bao cao dinh ky moi 6 gio cho Chat [${chatId}]`);

  autoReportInterval = setInterval(async () => {
    try {
      if (trackedHistory.length > 0) {
        const excelPath = await exportWaybillsToExcel(trackedHistory);
        await sendTelegramMessage(chatId, '⏰ <b>BÁO CÁO MÃ VẬN ĐƠN TỰ ĐỘNG (6 GIỜ/LẦN):</b>\nHệ thống đã tổng hợp báo cáo mã vận đơn.');
        await sendTelegramDocument(chatId, excelPath, '📊 Báo cáo danh sách mã vận đơn tự động');
      }
    } catch (e: any) {
      logger.error({ error: e.message }, 'Loi trong lich bao cao dinh ky');
    }
  }, 6 * 60 * 60 * 1000);
}

async function handleCommand(chatId: string, text: string) {
  const trimmed = text.trim();
  const parts = trimmed.split(' ');
  const command = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');
  const lang = getUserLang(chatId);

  logger.info(`Nhan lenh Telegram tu Chat [${chatId}]: ${trimmed}`);

  // 0. Lệnh Chọn Ngôn Ngữ Multi-Language Switcher (VI, EN, JA, ZH, HI)
  if (command === '/lang' || command === '/language' || command === '/ngonngu') {
    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: '🇻🇳 Tiếng Việt', callback_data: 'lang_vi' },
          { text: '🇺🇸 English', callback_data: 'lang_en' },
        ],
        [
          { text: '🇯🇵 日本語', callback_data: 'lang_ja' },
          { text: '🇨🇳 中文', callback_data: 'lang_zh' },
        ],
        [
          { text: '🇮🇳 हिन्दी', callback_data: 'lang_hi' },
        ],
      ],
    };
    await sendTelegramMessage(chatId, t('selectLanguagePrompt', lang), 'HTML', inlineKeyboard);
    return;
  }

  if (command === '/start' || command === '/help' || command === '/huongdan' || command === '/trogiup') {
    await sendTelegramMessage(chatId, t('helpCommandText', lang));
    return;
  }

  if (command === '/theodoi' || command === '/watch') {
    const code = args.trim();
    if (!code) {
      await sendTelegramMessage(chatId, '⚠️ Vui lòng nhập mã vận đơn để theo dõi. Ví dụ: <code>/theodoi SPXVN068554112737</code>');
      return;
    }
    const res = addToWatchlist(chatId, code);
    await sendTelegramMessage(chatId, res.message);
    return;
  }

  if (command === '/danhsach' || command === '/dastheodoi' || command === '/watchlist') {
    const list = getWatchlist(chatId);
    if (!list || list.length === 0) {
      await sendTelegramMessage(chatId, '📭 Danh sách theo dõi tự động của bạn đang trống. Gõ <code>/theodoi &lt;mã_vận_đơn&gt;</code> để thêm!');
      return;
    }
    let msg = `🔔 <b>DANH SÁCH ${list.length} MÃ VẬN ĐƠN ĐANG THEO DÕI TỰ ĐỘNG:</b>\n\n`;
    list.forEach((item, idx) => {
      msg += `<b>${idx + 1}. Mã:</b> <code>${escapeHtml(item.trackingNo)}</code>\n`;
      msg += `   • Trạng thái gần nhất: <b>${escapeHtml(item.lastStatus || 'Chưa cập nhật')}</b>\n`;
      if (item.lastLocation) msg += `   • Kho: <i>${escapeHtml(item.lastLocation)}</i>\n`;
      msg += `\n`;
    });
    await sendTelegramMessage(chatId, msg);
    return;
  }

  if (command === '/huytheodoi' || command === '/unwatch') {
    const code = args.trim();
    if (!code) {
      await sendTelegramMessage(chatId, '⚠️ Vui lòng nhập mã vận đơn cần hủy theo dõi. Ví dụ: <code>/huytheodoi SPXVN068554112737</code>');
      return;
    }
    const ok = removeFromWatchlist(chatId, code);
    if (ok) {
      await sendTelegramMessage(chatId, `🗑️ Đã xóa mã <code>${escapeHtml(code)}</code> khỏi danh sách theo dõi.`);
    } else {
      await sendTelegramMessage(chatId, `❌ Không tìm thấy mã <code>${escapeHtml(code)}</code> trong danh sách theo dõi của bạn.`);
    }
    return;
  }

  if (command === '/nhackhach' || command === '/remind') {
    const code = args.trim() || 'SPXVN...';
    const textSnippet = generateCustomerDeliveryReminder({ trackingNoOrOrderSn: code });
    let msg = `📲 <b>${t('reminderTitle', lang)}:</b>\n\n`;
    msg += `<code>${escapeHtml(textSnippet)}</code>\n\n`;
    msg += `${t('reminderTip', lang)}`;
    await sendTelegramMessage(chatId, msg);
    return;
  }

  if (command === '/baocaotudong' || command === '/autoreport') {
    if (autoReportInterval) {
      clearInterval(autoReportInterval);
      autoReportInterval = null;
      await sendTelegramMessage(chatId, '⏹️ <b>ĐÃ TẮT LỊCH TỰ ĐỘNG BÁO CÁO.</b>');
    } else {
      startAutoReportScheduler(chatId);
      await sendTelegramMessage(chatId, '🔔 <b>ĐÃ BẬT LỊCH BÁO CÁO ĐỊNH KỲ TỰ ĐỘNG (6 GIỜ/LẦN)!</b> Bot sẽ tự động gửi file Excel định kỳ.');
    }
    return;
  }

  if (command === '/xuatexcel' || command === '/xuatfile' || command === '/export') {
    await sendTelegramMessage(chatId, '📊 Đang tạo file báo cáo Excel mã vận đơn...');
    if (trackedHistory.length === 0) {
      await sendTelegramMessage(chatId, '📭 Chưa có lịch sử mã vận đơn nào. Hãy gửi mã vận đơn để tra cứu trước.');
      return;
    }
    const excelPath = await exportWaybillsToExcel(trackedHistory);
    await sendTelegramDocument(chatId, excelPath, '📊 Báo cáo danh sách mã vận đơn đã tra cứu (Excel)');
    return;
  }

  if (command === '/tracuu' || command === '/tim' || command === '/search' || !trimmed.startsWith('/')) {
    const rawInput = (command === '/tracuu' || command === '/tim' || command === '/search') ? args : trimmed;

    if (!rawInput) {
      await sendTelegramMessage(chatId, `${t('emptyAlert', lang)} Ví dụ: <code>/tracuu SPXVN068554112737</code>`);
      return;
    }

    const waybillList = extractWaybillsFromText(rawInput);
    const codes = waybillList.length > 0 ? waybillList : [rawInput.trim()];

    const ok = await handleWaybillSearch(chatId, codes);
    if (ok) return;

    await sendTelegramMessage(chatId, `${t('notFound', lang)}`);
    return;
  }

  if (command === '/trangthai' || command === '/status') {
    const statusMsg = `
ℹ️ <b>TRẠNG THÁI HỆ THỐNG TRA CỨU VẬN ĐƠN:</b>

• Trạng thái Bot: 🟢 Đang hoạt động (SPX, GHTK, GHN, ViettelPost, NinjaVan)
• Ngôn ngữ hiện tại: <b>${lang.toUpperCase()}</b> (Đổi bằng /lang)
• Trang quản trị Web: 🌐 <code>http://localhost:3000</code>
• Tự động theo dõi: 🟢 Đang quét ngầm thông báo khi đổi bưu cục
• Báo cáo tự động: <b>${autoReportInterval ? '🟢 Đang bật (6h/lần)' : '⚪ Tắt (gõ /baocaotudong để bật)'}</b>
• Tổng số mã đã tra cứu: <b>${trackedHistory.length}</b>
    `;
    await sendTelegramMessage(chatId, statusMsg);
    return;
  }

  await sendTelegramMessage(chatId, `❓ ${t('error', lang)}: Gõ <code>/help</code> hoặc <code>/lang</code>.`);
}

async function startBotServer() {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  logger.info('====================================================');
  logger.info('   KHOI CHAY TELEGRAM WAYBILL TRACKER BOT SERVER    ');
  logger.info('====================================================');

  try {
    startWebServer(3000);
  } catch (e: any) {
    logger.error({ error: e.message }, 'Loi khi khoi chay Web Server');
  }

  try {
    startWatchlistPolling(10 * 60 * 1000);
  } catch (e: any) {
    logger.error({ error: e.message }, 'Loi khi khoi chay Watchlist Polling');
  }

  if (!token) {
    logger.warn('Chua cau hinh TELEGRAM_BOT_TOKEN trong file .env');
    logger.info('Vui long them TELEGRAM_BOT_TOKEN="YOUR_BOT_TOKEN" vao file .env');
  } else {
    logger.info('Telegram Bot Token da duoc thiet lap. Dang lang nghe tin nhan...');
  }

  let offset = 0;

  while (true) {
    try {
      const updates = await getTelegramUpdates(offset, 10);
      for (const update of updates) {
        offset = update.update_id + 1;

        // Xử lý Inline Keyboard Button Callbacks (Chọn Ngôn Ngữ)
        if (update.callback_query) {
          const cb = update.callback_query;
          const chatId = String(cb.message.chat.id);
          const data = cb.data;

          if (data && data.startsWith('lang_')) {
            const selectedLang = data.replace('lang_', '');
            if (isValidLanguage(selectedLang)) {
              userLanguages.set(chatId, selectedLang);
              await sendTelegramMessage(chatId, t('languageUpdated', selectedLang), 'HTML');
            }
          }
        }

        // Xử lý Tin nhắn Text
        const message = update.message;
        if (message && message.text) {
          const chatId = String(message.chat.id);
          if (isAuthorizedUser(chatId)) {
            await handleCommand(chatId, message.text);
          } else {
            await sendTelegramMessage(chatId, '⛔ Bạn không có quyền truy cập Bot này.');
          }
        }
      }
    } catch (e: any) {
      logger.error({ error: e.message }, 'Loi trong vong lap Telegram Bot');
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

startBotServer();
