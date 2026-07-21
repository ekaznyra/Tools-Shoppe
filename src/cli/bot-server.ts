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

let autoReportInterval: NodeJS.Timeout | null = null;
const trackedHistory: WaybillTrackingResult[] = [];

async function handleWaybillSearch(chatId: string, waybillList: string[]): Promise<boolean> {
  if (!waybillList || waybillList.length === 0) return false;

  // 1. Tra cứu 1 Mã Vận Đơn duy nhất
  if (waybillList.length === 1) {
    const waybillNo = waybillList[0];
    const carrierName = detectCarrier(waybillNo);
    await sendTelegramMessage(
      chatId,
      `🚚 <b>ĐANG TRA CỨU MÃ VẬN ĐƠN (${carrierName})...</b>\n\n• Mã vận đơn: <code>${escapeHtml(waybillNo)}</code>\n• Hệ thống đang kiểm tra hành trình vận chuyển thực tế...`
    );

    const spxResult = await trackUniversalWaybill(waybillNo);

    if (spxResult && spxResult.success) {
      if (!trackedHistory.some((h) => h.trackingNo === spxResult.trackingNo)) {
        trackedHistory.unshift(spxResult);
      }

      // Tính toán Dự báo Thời gian Giao Hàng (ETA Predictor)
      const eta = predictDeliveryETA(spxResult);

      let msg = `🚚 <b>THÔNG TIN CHI TIẾT MÃ VẬN ĐƠN</b>\n\n`;
      msg += `• <b>Mã vận đơn:</b> <code>${escapeHtml(spxResult.trackingNo)}</code>\n`;
      msg += `• <b>Đơn vị vận chuyển:</b> ${escapeHtml(spxResult.carrier)}\n`;
      msg += `• <b>Trạng thái hiện tại:</b> ${escapeHtml(spxResult.status)}\n`;
      msg += `• <b>🎯 DỰ BÁO THỜI GIAN GIAO HÀNG:</b> <b>${escapeHtml(eta.estimatedTime)}</b>\n`;
      msg += `   └ <i>${escapeHtml(eta.note)}</i>\n`;

      if (spxResult.latestLocation) {
        msg += `• <b>Hành trình mới nhất:</b> <i>${escapeHtml(spxResult.latestLocation)}</i>\n`;
      }
      if (spxResult.latestTime) {
        msg += `• <b>Cập nhật lúc:</b> <code>${escapeHtml(spxResult.latestTime)}</code>\n`;
      }
      msg += `\n`;

      if (spxResult.steps && spxResult.steps.length > 0) {
        msg += `<b>📍 LỊCH SỬ HÀNH TRÌNH CHI TIẾT (${spxResult.steps.length} mốc):</b>\n\n`;
        spxResult.steps.forEach((step, idx) => {
          msg += `<b>${idx + 1}. [${escapeHtml(step.time)} - ${escapeHtml(step.date)}]</b>\n`;
          msg += `   └ ${escapeHtml(step.status)}\n\n`;
        });
      }

      // Mẫu tin nhắn nhắc nghe máy nếu đang đi giao
      if ((spxResult.status || '').includes('giao') || (spxResult.latestLocation || '').includes('giao')) {
        const reminderText = generateCustomerDeliveryReminder({
          trackingNoOrOrderSn: spxResult.trackingNo,
          carrierName: spxResult.carrier,
        });
        msg += `📲 <b>MẪU TIN NHẮC NGHE MÁY NHẬN HÀNG:</b>\n`;
        msg += `<code>${escapeHtml(reminderText)}</code>\n\n`;
        msg += `💡 <i>Sao chép mẫu trên để gửi Zalo / SMS cho người nhận!</i>\n\n`;
      }

      msg += `📌 <i>Mẹo: Gõ <code>/theodoi ${spxResult.trackingNo}</code> để tự động nhận thông báo ngay khi bưu cục có cập nhật mới!</i>`;

      await sendTelegramMessage(chatId, msg);

      const alerts = analyzeDeliveryAlerts([spxResult]);
      if (alerts.length > 0) {
        await sendDeliveryAlertsToTelegram(chatId, alerts);
      }

      return true;
    } else {
      await sendTelegramMessage(
        chatId,
        `❌ <b>KHÔNG TÌM THẤY VẬN ĐƠN:</b>\nHệ thống chưa ghi nhận mã vận đơn: <code>${escapeHtml(waybillNo)}</code> hoặc chưa có dữ liệu hành trình.`
      );
      return true;
    }
  }

  // 2. Tra cứu HÀNG LOẠT nhiều Mã Vận Đơn cùng lúc
  await sendTelegramMessage(
    chatId,
    `🚚 <b>ĐANG TRA CỨU HÀNG LOẠT ${waybillList.length} MÃ VẬN ĐƠN...</b>\n\n• Danh sách mã: <code>${waybillList.slice(0, 5).join(', ')}${waybillList.length > 5 ? '...' : ''}</code>\n• Hệ thống đang quét hành trình cho toàn bộ mã...`
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

  let summaryMsg = `📊 <b>BÁO CÁO KẾT QUẢ TRA CỨU HÀNG LOẠT (${results.length} MÃ VẬN ĐƠN)</b>\n\n`;
  summaryMsg += `• <b>Tổng số mã kiểm tra:</b> <b>${results.length}</b>\n`;
  summaryMsg += `• ✅ <b>Đã giao thành công:</b> <b>${deliveredCount}</b>\n`;
  summaryMsg += `• 🚚 <b>Đang vận chuyển / Giao hàng:</b> <b>${shippingCount}</b>\n`;
  summaryMsg += `• 📦 <b>Chờ lấy hàng:</b> <b>${pendingCount}</b>\n\n`;
  summaryMsg += `<b>📍 CHI TIẾT THEO TỪNG MÃ VẬN ĐƠN:</b>\n\n`;

  results.forEach((r, idx) => {
    const eta = predictDeliveryETA(r);
    summaryMsg += `<b>${idx + 1}. Mã:</b> <code>${escapeHtml(r.trackingNo)}</code> (${escapeHtml(r.carrier)})\n`;
    summaryMsg += `   • Trạng thái: <b>${escapeHtml(r.status)}</b>\n`;
    summaryMsg += `   • Dự báo giao: <b>${escapeHtml(eta.estimatedTime)}</b>\n`;
    if (r.latestLocation) {
      summaryMsg += `   • Mới nhất: <i>${escapeHtml(r.latestLocation)}</i>\n`;
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
    await sendTelegramDocument(chatId, excelPath, `📊 Báo cáo tra cứu hàng loạt (${results.length} mã vận đơn)`);
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

  logger.info(`Nhan lenh Telegram tu Chat [${chatId}]: ${trimmed}`);

  if (command === '/start' || command === '/help' || command === '/huongdan' || command === '/trogiup') {
    const helpMsg = `
🤖 <b>BOT TRA CỨU MÃ VẬN ĐƠN TỰ ĐỘNG</b> 🚚

Hệ thống tra cứu & theo dõi hành trình mã vận đơn tự động 24/7!

🌐 <b>TRANG QUẢN TRỊ WEB:</b> <code>http://localhost:3000</code>

<b>📋 DANH SÁCH LỆNH BẰNG TIẾNG VIỆT THUẦN TÚY:</b>
• <code>Gửi Mã vận đơn trực tiếp</code> (VD: <code>SPXVN068554112737</code>) để tra cứu tự động
• <code>/tracuu &lt;mã_vận_đơn&gt;</code> hoặc <code>/tim &lt;mã&gt;</code> - Tra cứu mã vận đơn SPX, GHTK, GHN, ViettelPost...
• <code>/theodoi &lt;mã_vận_đơn&gt;</code> - Thêm mã vào danh sách TỰ ĐỘNG THEO DÕI & Nhận báo động khi bưu cục chuyển kho
• <code>/danhsach</code> - Xem các mã vận đơn đang được tự động theo dõi
• <code>/huytheodoi &lt;mã_vận_đơn&gt;</code> - Bỏ theo dõi mã vận đơn
• <code>/nhackhach &lt;mã_vận_đơn&gt;</code> - Soạn nhanh tin nhắn mẫu nhắc nghe máy nhận hàng
• <code>/xuatexcel</code> hoặc <code>/xuatfile</code> - Xuất file Excel báo cáo danh sách vận đơn
• <code>/baocaotudong</code> - Bật/Tắt lịch tự động gửi báo cáo Excel định kỳ 6 tiếng/lần
• <code>/trangthai</code> - Kiểm tra trạng thái hoạt động của hệ thống
    `;
    await sendTelegramMessage(chatId, helpMsg);
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
    let msg = `📲 <b>MẪU TIN NHẮN NHẮC NGHE MÁY NHẬN HÀNG:</b>\n\n`;
    msg += `<code>${escapeHtml(textSnippet)}</code>\n\n`;
    msg += `💡 <i>Sao chép mẫu trên để gửi Zalo / SMS cho người nhận!</i>`;
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
      await sendTelegramMessage(chatId, '⚠️ Vui lòng nhập Mã vận đơn. Ví dụ: <code>/tracuu SPXVN068554112737</code>');
      return;
    }

    const waybillList = extractWaybillsFromText(rawInput);
    const codes = waybillList.length > 0 ? waybillList : [rawInput.trim()];

    const ok = await handleWaybillSearch(chatId, codes);
    if (ok) return;

    await sendTelegramMessage(chatId, '❌ Không nhận diện được mã vận đơn hợp lệ.');
    return;
  }

  if (command === '/trangthai' || command === '/status') {
    const statusMsg = `
ℹ️ <b>TRẠNG THÁI HỆ THỐNG TRA CỨU VẬN ĐƠN:</b>

• Trạng thái Bot: 🟢 Đang hoạt động (SPX, GHTK, GHN, ViettelPost, NinjaVan)
• Trang quản trị Web: 🌐 <code>http://localhost:3000</code>
• Tự động theo dõi: 🟢 Đang quét ngầm thông báo khi đổi bưu cục
• Báo cáo tự động: <b>${autoReportInterval ? '🟢 Đang bật (6h/lần)' : '⚪ Tắt (gõ /baocaotudong để bật)'}</b>
• Tổng số mã đã tra cứu: <b>${trackedHistory.length}</b>
    `;
    await sendTelegramMessage(chatId, statusMsg);
    return;
  }

  await sendTelegramMessage(chatId, '❓ Lệnh không hợp lệ. Gõ <code>/huongdan</code> để xem danh sách lệnh Tiếng Việt.');
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
