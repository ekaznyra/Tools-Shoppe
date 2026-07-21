import {
  sendTelegramMessage,
  sendTelegramDocument,
  getTelegramUpdates,
  answerCallbackQuery,
  isAuthorizedUser,
  escapeHtml,
} from '../lib/telegram/index.ts';
import { exportWaybillsToExcel } from '../lib/export/index.ts';
import {
  trackMultipleSPXWaybills,
  extractWaybillsFromText,
  type WaybillTrackingResult,
} from '../lib/spx-tracker/index.ts';
import { trackUniversalWaybill, trackUniversalWaybillWithTimeout, detectCarrier } from '../lib/multi-carrier-tracker/index.ts';
import { analyzeDeliveryAlerts, sendDeliveryAlertsToTelegram } from '../lib/alert-scanner/index.ts';
import { generateCustomerDeliveryReminder } from '../lib/customer-reminder/index.ts';
import { predictDeliveryETA } from '../lib/eta-predictor/index.ts';
import {
  addToWatchlist,
  getWatchlist,
  removeFromWatchlist,
  startWatchlistPolling,
} from '../lib/waybill-watchlist/index.ts';
import {
  addShopTarget,
  removeShopTarget,
  getShopTargets,
  getLatestVouchers,
  getTodayVouchers,
  getHotVouchers,
  searchVouchersByProduct,
  findBestVouchersForProductLink,
  getUserPreference,
  setUserPreference,
  toggleUserPause,
  scanVouchersFromUrl,
  fetchRealShopeePublicVouchers,
  saveDiscoveredVouchers,
  formatVoucherTelegramMessage,
  isVoucherMatchingPreference,
  parseNumericValue,
} from '../lib/voucher-scanner/index.ts';
import { startWebServer } from '../web/server.ts';
import { logger } from '../lib/logging/index.ts';
import { t, type SupportedLanguage, isValidLanguage } from '../lib/i18n/index.ts';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

let autoReportInterval: NodeJS.Timeout | null = null;
const trackedHistory: WaybillTrackingResult[] = [];
const userLanguages = new Map<string, SupportedLanguage>();

export function startVoucherScannerPolling(intervalMs: number = 5 * 60 * 1000) {
  logger.info(`[Voucher Scheduler] Khởi chạy worker quét & cào voucher ngon nhất định kỳ siêu tốc (${intervalMs / 60000} phút/lần)...`);

  const runScan = async () => {
    try {
      // 1. Quét Mã Giảm Giá Công Khai Thực Tế Toàn Sàn Shopee (FreeShip Xtra, Hoàn Xu Xtra, Shopee Live, ShopeePay)
      const publicVouchers = await fetchRealShopeePublicVouchers();
      await saveDiscoveredVouchers(publicVouchers);

      // 2. Quét các shop theo dõi công khai
      const targets = await getShopTargets();
      if (targets && targets.length > 0) {
        const allowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;

        for (const target of targets) {
          const rawList = await scanVouchersFromUrl(target.shopUrl);
          const newlyDiscovered = await saveDiscoveredVouchers(rawList);

          if (newlyDiscovered.length > 0 && allowedChatId) {
            logger.info(`[Voucher Scheduler] Phát hiện ${newlyDiscovered.length} voucher mới từ ${target.shopName}`);

            const pref = await getUserPreference(allowedChatId);
            for (const voucher of newlyDiscovered) {
              if (isVoucherMatchingPreference(voucher, pref)) {
                const msg = formatVoucherTelegramMessage(voucher);
                await sendTelegramMessage(allowedChatId, msg, 'HTML');
              }
            }
          }
        }
      }
    } catch (err: any) {
      logger.error({ error: err.message }, 'Lỗi trong worker quét voucher định kỳ');
    }
  };

  runScan();
  return setInterval(runScan, intervalMs);
}


function getUserLang(chatId: string): SupportedLanguage {
  return userLanguages.get(chatId) || 'vi';
}

async function handleWaybillSearch(chatId: string, waybillList: string[]): Promise<boolean> {
  if (!waybillList || waybillList.length === 0) return false;
  const lang = getUserLang(chatId);

  // 1. Tra cứu 1 Mã Vận Đơn duy nhất
  if (waybillList.length === 1) {
    const waybillNo = waybillList[0];
    const spxResult = await trackUniversalWaybillWithTimeout(waybillNo, 10000);

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
      msg += `• <b>${t('carrierLabel', lang)}:</b> <b>${escapeHtml(spxResult.carrier)}</b>\n`;
      msg += `• <b>${t('statusLabel', lang)}:</b> <b>${escapeHtml(spxResult.status)}</b>\n`;
      msg += `• <b>${t('etaTitle', lang)}:</b> <b>${escapeHtml(eta.estimatedTime)}</b>\n`;
      msg += `   └ <i>${escapeHtml(eta.note)}</i>\n`;

      if (spxResult.latestLocation) {
        msg += `• <b>${t('latestLocation', lang)}:</b> <i>${escapeHtml(spxResult.latestLocation)}</i>\n`;
      }
      if (spxResult.latestTime) {
        msg += `• <b>${t('updatedAt', lang)}:</b> <code>${escapeHtml(spxResult.latestTime)}</code>\n`;
      }
      msg += `\n`;

      if ((spxResult.status || '').includes('giao') || (spxResult.latestLocation || '').includes('giao')) {
        const reminderText = generateCustomerDeliveryReminder({
          trackingNoOrOrderSn: spxResult.trackingNo,
          carrierName: spxResult.carrier,
        });
        msg += `📲 <b>${t('reminderTitle', lang)}:</b>\n`;
        msg += `<code>${escapeHtml(reminderText)}</code>\n\n`;
      }

      msg += `💡 <i>Gõ /theodoi ${spxResult.trackingNo} để nhận thông báo tự động khi bưu cục chuyển kho!</i>`;

      const trackLink = spxResult.carrier.includes('SPX') ? 'https://spx.vn' : 'https://shopee.vn';
      const stepsCount = spxResult.steps ? spxResult.steps.length : 0;

      const keyboardRows: any[] = [];
      if (stepsCount > 0) {
        keyboardRows.push([
          { text: `📜 Xem Lịch Sử Hành Trình (${stepsCount} mốc)`, callback_data: `timeline_${spxResult.trackingNo}` },
        ]);
      }
      keyboardRows.push([
        { text: '🛍️ 🔗 Mở Trang Vận Chuyển', url: trackLink },
        { text: t('btnBackMenu', lang), callback_data: 'cmd_mainmenu' },
      ]);

      const inlineButtons = { inline_keyboard: keyboardRows };

      try {
        await sendTelegramMessage(chatId, msg, 'HTML', inlineButtons);
      } catch (e) {
        await sendTelegramMessage(chatId, msg, 'HTML');
      }

      const alerts = analyzeDeliveryAlerts([spxResult]);
      if (alerts.length > 0) {
        await sendDeliveryAlertsToTelegram(chatId, alerts);
      }

      return true;
    } else {
      let failMsg = `❌ <b>KHÔNG TÌM THẤY DỮ LIỆU ĐƠN HÀNG</b>\n\n`;
      failMsg += `• <b>Mã vận đơn:</b> <code>${escapeHtml(waybillNo)}</code>\n`;
      failMsg += `• <b>Lý do:</b> <i>${spxResult?.errorMessage || 'Không tìm thấy dữ liệu vận đơn trên hệ thống (Quá 20s truy vấn).'}</i>\n\n`;
      failMsg += `💡 <i>Vui lòng kiểm tra lại chính xác Mã Vận Đơn hoặc gõ /theodoi ${waybillNo} để nhận thông báo tự động khi có dữ liệu!</i>`;

      await sendTelegramMessage(chatId, failMsg, 'HTML');
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

export function getMainMenuInlineKeyboard(lang: SupportedLanguage = 'vi') {
  return {
    inline_keyboard: [
      [
        { text: t('btnHot', lang), callback_data: 'cmd_hot' },
        { text: t('btnVouchers', lang), callback_data: 'cmd_vouchers' },
      ],
      [
        { text: t('btnToday', lang), callback_data: 'cmd_today' },
        { text: t('btnListshops', lang), callback_data: 'cmd_listshops' },
      ],
      [
        { text: t('btnWatchlist', lang), callback_data: 'cmd_danhsach' },
        { text: t('btnExport', lang), callback_data: 'cmd_export' },
      ],
      [
        { text: t('btnFilter', lang), callback_data: 'cmd_filter' },
        { text: t('btnLang', lang), callback_data: 'cmd_lang' },
      ],
      [
        { text: t('btnStatus', lang), callback_data: 'cmd_trangthai' },
        { text: t('btnFullhelp', lang), callback_data: 'cmd_fullhelp' },
      ],
    ],
  };
}

export function formatVouchersAsInlineKeyboard(vouchers: any[], lang: SupportedLanguage = 'vi') {
  const keyboardRows: any[] = [];
  const now = new Date();

  vouchers.forEach((v) => {
    const code = v.voucherCode || 'SHOPEE50K';
    const discount = v.discountValue || 'Giảm';
    const isExpired = v.endTime && new Date(v.endTime) < now;
    const statusDot = isExpired ? '🔴' : '🟢';

    let categoryIcon = '🎟️';
    let label = `Giảm ${discount}`;

    if (v.shopId === 'SHOPEE_LIVE' || (v.title && v.title.includes('Live'))) {
      categoryIcon = '🎬';
      label = `Live ${discount}`;
    } else if (v.shopId === 'SHOPEE_FREESHIP' || (v.title && v.title.includes('Freeship'))) {
      categoryIcon = '🚚';
      label = `Freeship ${discount}`;
    } else if (v.shopId === 'SHOPEEPAY' || (v.title && v.title.includes('ShopeePay'))) {
      categoryIcon = '💳';
      label = `ShopeePay ${discount}`;
    } else if (v.shopId === 'SHOPEE_CCB' || (v.title && v.title.includes('Hoàn Xu'))) {
      categoryIcon = '🔥';
      label = `Hoàn Xu ${discount}`;
    } else if (v.score >= 100) {
      categoryIcon = '🔥';
      label = `Giảm ${discount}`;
    } else if (v.score >= 50) {
      categoryIcon = '💎';
      label = `Giảm ${discount}`;
    }

    if (isExpired) categoryIcon = '❌';

    // Nút siêu gọn đẹp: 🔥 [CODE] Tên Mức Giảm 🟢 (Không nén hay tràn chữ)
    const buttonText = `${categoryIcon} [${code}] ${label} ${statusDot}`;
    keyboardRows.push([
      {
        text: buttonText,
        callback_data: `detail_${v.id || code}`,
      },
    ]);
  });

  keyboardRows.push([
    { text: t('btnBackMenu', lang), callback_data: 'cmd_mainmenu' },
    { text: '🔄 Cập Nhật Mã', callback_data: 'cmd_hot' },
  ]);

  return { inline_keyboard: keyboardRows };
}

export function getBackToMenuKeyboard(lang: SupportedLanguage = 'vi') {
  return {
    inline_keyboard: [
      [{ text: t('btnBackMenu', lang), callback_data: 'cmd_mainmenu' }],
    ],
  };
}

export async function sendMainMenuWithButtons(chatId: string) {
  const lang = getUserLang(chatId);
  let text = `<b>${t('menuHeader', lang)}</b>\n\n`;
  text += `${t('menuSubtext', lang)}`;

  await sendTelegramMessage(chatId, text, 'HTML', getMainMenuInlineKeyboard(lang));
}

async function handleShopeeProductLinkOptimization(chatId: string, productUrl: string) {
  const lang = getUserLang(chatId);
  await sendTelegramMessage(chatId, '🔎 <b>Đang phân tích sản phẩm Shopee & phân loại Mã Giảm Giá theo Giá Trị Đơn Hàng...</b>');

  const recommendation = await findBestVouchersForProductLink(productUrl);

  if (!recommendation || (!recommendation.bestForSmallOrder && !recommendation.bestForLargeOrder)) {
    await sendTelegramMessage(chatId, '📭 Chưa tìm thấy mã giảm giá phù hợp cho sản phẩm này.', 'HTML', getBackToMenuKeyboard(lang));
    return;
  }

  const smallV = recommendation.bestForSmallOrder;
  const largeV = recommendation.bestForLargeOrder;
  const targetLink = smallV?.affiliateUrl || largeV?.affiliateUrl || productUrl;

  let msg = `🎯 <b>MÃ GIẢM GIÁ PHÙ HỢP THEO GIÁ TRỊ ĐƠN HÀNG CỦA BẠN</b>\n\n`;
  msg += `📦 <b>Sản phẩm đã quăng:</b>\n<code>${escapeHtml(productUrl.slice(0, 75))}${productUrl.length > 75 ? '...' : ''}</code>\n\n`;

  if (smallV) {
    const codeS = smallV.voucherCode || 'LIVE50K';
    const isSaveVoucher = smallV.shopId === 'SHOPEE_CCB' || smallV.shopId === 'SHOPEE_FREESHIP';
    const typeLabel = isSaveVoucher ? '📌 Mã Lưu Ví (Bấm link để Lưu)' : '🔑 Mã Dán Trực Tiếp';

    msg += `⚡ <b>THƯỜNG DÙNG CHO ĐƠN DƯỚI 400.000đ (Đơn nhỏ / vừa):</b>\n`;
    msg += `• <b>Mã voucher:</b> <code>${codeS}</code>\n`;
    msg += `• 💰 <b>Mức giảm:</b> <b>${smallV.discountValue}</b> (${smallV.shopName || 'Shopee Official'})\n`;
    msg += `• 📦 <b>Đơn tối thiểu:</b> <b>${smallV.minSpend || '0đ'}</b>\n`;
    msg += `• 📌 <b>Phân loại:</b> <i>${typeLabel}</i>\n\n`;
  }

  if (largeV && largeV.voucherCode !== smallV?.voucherCode) {
    const codeL = largeV.voucherCode || 'CCB100K';
    const isSaveVoucher = largeV.shopId === 'SHOPEE_CCB' || largeV.shopId === 'SHOPEE_FREESHIP';
    const typeLabel = isSaveVoucher ? '📌 Mã Lưu Vào Ví Shopee (Bấm link để Lưu)' : '🔑 Mã Dán Trực Tiếp';

    msg += `💎 <b>DÙNG CHO ĐƠN TỪ 400.000đ TRỞ LÊN (Đơn lớn):</b>\n`;
    msg += `• <b>Mã voucher:</b> <code>${codeL}</code>\n`;
    msg += `• 💰 <b>Mức giảm:</b> <b>${largeV.discountValue}</b> (${largeV.shopName || 'Shopee Hoàn Xu'})\n`;
    msg += `• 📦 <b>Đơn tối thiểu bắt buộc:</b> <b>${largeV.minSpend || '400.000đ'}</b>\n`;
    msg += `• 📌 <b>Phân loại:</b> <i>${typeLabel}</i>\n\n`;
  }

  msg += `⚠️ <b>LƯU Ý QUAN TRỌNG KHI ÁP MÃ SHOPEE:</b>\n`;
  msg += `1. Mã Hoàn Xu/Freeship Extra (như <code>CCB100K</code>) là <b>Mã Hệ Thống Sàn</b> $\rightarrow$ Phải bấm nút <b>🛍️ 🔗 Mở App Shopee Nhận & Lưu Mã</b> bên dưới để Lưu mã vào Ví trước, mã sẽ tự hiển thị lúc Thanh Toán chứ <b>KHÔNG nhập tay vào ô text</b> (Shopee sẽ báo không tìm thấy mã nếu gõ tay).\n`;
  msg += `2. Nếu đơn hàng của bạn <b>dưới 400.000đ</b>, vui lòng chọn mã <code>${smallV?.voucherCode || 'LIVE50K'}</code> hoặc mã <b>Miễn Phí Vận Chuyển</b>!\n`;

  const topCode = smallV?.voucherCode || 'LIVE50K';

  const keyboard = {
    inline_keyboard: [
      [
        { text: `📋 CoPy Mã Dán [ ${topCode} ]`, callback_data: `copy_${topCode}` },
      ],
      [
        { text: `🛍️ 🔗 Mở App Shopee Nhận & Lưu Mã`, url: targetLink },
      ],
      [
        { text: t('btnBackMenu', lang), callback_data: 'cmd_mainmenu' },
      ],
    ],
  };

  await sendTelegramMessage(chatId, msg, 'HTML', keyboard);
}

async function handleCommand(chatId: string, text: string) {
  const trimmed = text.trim();
  const parts = trimmed.split(' ');
  const command = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');
  const lang = getUserLang(chatId);

  logger.info(`Nhan lenh Telegram tu Chat [${chatId}]: ${trimmed}`);

  // 0a. Lệnh Tự Động Khởi Động Lại CHAY_BOT.cmd khi gõ chữ "T" hoặc "t" hoặc "/restart"
  if (trimmed.toLowerCase() === 't' || command === '/restart' || command === '/reset' || command === '/t') {
    await sendTelegramMessage(
      chatId,
      '🔄 <b>ĐANG TỰ ĐỘNG KHỞI ĐỘNG LẠI BOT (CHAY_BOT.cmd)...</b>\n\n• Hệ thống đang làm sạch bộ nhớ RAM, reset kết nối và khởi chạy lại tức thì sau 1s!'
    );
    logger.warn(`[RESTART COMMAND] Nhan lenh khoi dong lai tu User [${chatId}]. Tien hanh process.exit(0)...`);

    setTimeout(() => {
      process.exit(0);
    }, 800);
    return;
  }

  // 0b. Lệnh Chọn Ngôn Ngữ Multi-Language Switcher (Mặc định: Tiếng Việt 🇻🇳)
  if (command === '/lang' || command === '/language' || command === '/ngonngu') {
    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: '🇻🇳 Tiếng Việt (Mặc định)', callback_data: 'lang_vi' },
          { text: '🇺🇸 English', callback_data: 'lang_en' },
        ],
        [
          { text: '🇨🇳 中文', callback_data: 'lang_zh' },
          { text: '🇯🇵 日本語', callback_data: 'lang_ja' },
        ],
        [
          { text: '🇰🇷 한국어', callback_data: 'lang_ko' },
          { text: '🇹🇭 ไทย', callback_data: 'lang_th' },
        ],
        [
          { text: '🇲🇾 Bahasa Melayu', callback_data: 'lang_ms' },
          { text: '🇮🇩 Bahasa Indonesia', callback_data: 'lang_id' },
        ],
        [
          { text: '🇪🇸 Español', callback_data: 'lang_es' },
          { text: '🇫🇷 Français', callback_data: 'lang_fr' },
        ],
        [
          { text: '🇩🇪 Deutsch', callback_data: 'lang_de' },
          { text: '🇷🇺 Русский', callback_data: 'lang_ru' },
        ],
        [
          { text: '🇵🇹 Português', callback_data: 'lang_pt' },
          { text: '🇮🇹 Italiano', callback_data: 'lang_it' },
        ],
        [
          { text: '🇦🇪 العربية', callback_data: 'lang_ar' },
          { text: '🇮🇳 हिन्दी', callback_data: 'lang_hi' },
        ],
        [
          { text: '🔙 Quay Về Menu Chính', callback_data: 'cmd_mainmenu' },
        ],
      ],
    };
    await sendTelegramMessage(chatId, t('selectLanguagePrompt', lang), 'HTML', inlineKeyboard);
    return;
  }

  if (command === '/start' || command === '/help' || command === '/huongdan' || command === '/trogiup' || command === '/menu') {
    await sendMainMenuWithButtons(chatId);
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

  // --- VOUCHER COMMANDS ---
  if (command === '/addshop' || command === '/themshop') {
    const url = args.trim();
    if (!url) {
      await sendTelegramMessage(chatId, '⚠️ Vui lòng nhập URL hoặc tên Shopee shop. Ví dụ: <code>/addshop https://shopee.vn/tu_store</code>');
      return;
    }
    await sendTelegramMessage(chatId, `🔍 Đang phân tích shop: <code>${escapeHtml(url)}</code>...`);
    const shop = await addShopTarget(url, chatId);
    const rawVouchers = await scanVouchersFromUrl(shop.shopUrl);
    const newVouchers = await saveDiscoveredVouchers(rawVouchers);

    let resMsg = `✅ <b>ĐÃ THÊM SHOP VÀO DANH SÁCH THEO DÕI:</b>\n\n`;
    resMsg += `• Shop Name: <b>${escapeHtml(shop.shopName || '')}</b>\n`;
    resMsg += `• URL: <code>${escapeHtml(shop.shopUrl)}</code>\n`;
    resMsg += `• Voucher mới tìm thấy ngay: <b>${newVouchers.length}</b> mã\n`;
    await sendTelegramMessage(chatId, resMsg);

    for (const v of newVouchers) {
      await sendTelegramMessage(chatId, formatVoucherTelegramMessage(v));
    }
    return;
  }

  if (command === '/removeshop' || command === '/xoashop') {
    const query = args.trim();
    if (!query) {
      await sendTelegramMessage(chatId, '⚠️ Vui lòng nhập ID hoặc URL shop cần xóa. Ví dụ: <code>/removeshop tu_store</code>');
      return;
    }
    const ok = await removeShopTarget(query);
    if (ok) {
      await sendTelegramMessage(chatId, `🗑️ Đã xóa shop <code>${escapeHtml(query)}</code> khỏi danh sách theo dõi quét voucher.`);
    } else {
      await sendTelegramMessage(chatId, `❌ Không tìm thấy shop <code>${escapeHtml(query)}</code> trong danh sách theo dõi.`);
    }
    return;
  }

  if (command === '/listshops' || command === '/dsshops') {
    const shops = await getShopTargets();
    if (!shops || shops.length === 0) {
      await sendTelegramMessage(chatId, '📭 Danh sách shop quét voucher đang trống. Gõ <code>/addshop &lt;url_shop&gt;</code> để thêm!', 'HTML', getBackToMenuKeyboard(lang));
      return;
    }
    let msg = `🛍️ <b>DANH SÁCH ${shops.length} SHOP ĐANG QUÉT VOUCHER TỰ ĐỘNG:</b>\n\n`;
    shops.forEach((s, idx) => {
      msg += `<b>${idx + 1}. ${escapeHtml(s.shopName || 'Shop')}</b>\n`;
      msg += `   • Link: <code>${escapeHtml(s.shopUrl)}</code>\n`;
      msg += `   • Thêm lúc: <code>${new Date(s.createdAt).toLocaleDateString('vi-VN')}</code>\n\n`;
    });
    await sendTelegramMessage(chatId, msg, 'HTML', getBackToMenuKeyboard(lang));
    return;
  }

  if (command === '/vouchers' || command === '/latest' || command === '/mamoiniat') {
    const vouchers = await getLatestVouchers(6);
    if (!vouchers || vouchers.length === 0) {
      await sendTelegramMessage(chatId, '📭 Chưa tìm thấy mã giảm giá nào. Hãy gõ <code>/addshop &lt;url&gt;</code> để bắt đầu quét!', 'HTML', getBackToMenuKeyboard(lang));
      return;
    }
    const keyboard = formatVouchersAsInlineKeyboard(vouchers, lang);
    await sendTelegramMessage(chatId, `📦 <b>Chọn mã giảm giá bạn muốn nhận (Bấm vào nút để mở Shopee):</b>`, 'HTML', keyboard);
    return;
  }

  if (command === '/today' || command === '/homnay') {
    const vouchers = await getTodayVouchers();
    if (!vouchers || vouchers.length === 0) {
      await sendTelegramMessage(chatId, '📭 Chưa có mã giảm giá mới nào phát hiện trong hôm nay.', 'HTML', getBackToMenuKeyboard(lang));
      return;
    }
    const keyboard = formatVouchersAsInlineKeyboard(vouchers, lang);
    await sendTelegramMessage(chatId, `📅 <b>Có ${vouchers.length} mã mới phát hiện hôm nay. Bấm nút để nhận:</b>`, 'HTML', keyboard);
    return;
  }

  if (command === '/filter' || command === '/boloc') {
    const minMatch = args.match(/min=(\d+k?)/i);
    const maxSpendMatch = args.match(/maxspend=(\d+k?)/i);

    if (!minMatch && !maxSpendMatch) {
      const pref = await getUserPreference(chatId);
      let msg = `⚙️ <b>CẤU HÌNH BỘ LỌC THÔNG BÁO VOUCHER HIỆN TẠI:</b>\n\n`;
      msg += `• Mức giảm tối thiểu: <b>${pref.minDiscountValue.toLocaleString('vi-VN')} VNĐ</b>\n`;
      msg += `• Đơn tối thiểu tối đa: <b>${pref.maxMinSpend.toLocaleString('vi-VN')} VNĐ</b>\n`;
      msg += `• Trạng thái nhận tin: <b>${pref.isPaused ? '🔴 Đang tạm dừng' : '🟢 Đang nhận bình thường'}</b>\n\n`;
      msg += `💡 <b>Mẹo cập nhật:</b> Gõ <code>/filter min=50k maxspend=500k</code>`;
      await sendTelegramMessage(chatId, msg, 'HTML', getBackToMenuKeyboard(lang));
      return;
    }

    const minVal = minMatch ? parseNumericValue(minMatch[1]) : 0;
    const maxSpendVal = maxSpendMatch ? parseNumericValue(maxSpendMatch[1]) : 10000000;

    await setUserPreference(chatId, minVal, maxSpendVal);
    await sendTelegramMessage(chatId, `✅ <b>ĐÃ CẬP NHẬT BỘ LỌC VOUCHER:</b>\n\n• Giảm từ: <b>${minVal.toLocaleString('vi-VN')} VNĐ</b>\n• Đơn tối đa: <b>${maxSpendVal.toLocaleString('vi-VN')} VNĐ</b>`, 'HTML', getBackToMenuKeyboard(lang));
    return;
  }

  if (command === '/pause' || command === '/tamdung') {
    const pref = await toggleUserPause(chatId, true);
    await sendTelegramMessage(chatId, '🔴 <b>ĐÃ TẠM DỪNG NHẬN THÔNG BÁO VOUCHER SHOPEE.</b> Gõ <code>/resume</code> để bật lại!', 'HTML', getBackToMenuKeyboard(lang));
    return;
  }

  if (command === '/resume' || command === '/batlai') {
    const pref = await toggleUserPause(chatId, false);
    await sendTelegramMessage(chatId, '🟢 <b>ĐÃ BẬT LAI THÔNG BÁO VOUCHER SHOPEE TỰ ĐỘNG.</b>', 'HTML', getBackToMenuKeyboard(lang));
    return;
  }

  if (command === '/hot' || command === '/topvouchers' || command === '/mahot') {
    const hotVouchers = await getHotVouchers(6);
    if (!hotVouchers || hotVouchers.length === 0) {
      await sendTelegramMessage(chatId, '📭 Chưa có voucher HOT nào được phát hiện.', 'HTML', getBackToMenuKeyboard(lang));
      return;
    }
    const keyboard = formatVouchersAsInlineKeyboard(hotVouchers, lang);
    await sendTelegramMessage(chatId, `🔥 <b>TOP VOUCHER SHOPEE HOT NHẤT (Chạm nút để nhận mã):</b>`, 'HTML', keyboard);
    return;
  }

  if (command === '/timma' || command === '/searchproduct' || command === '/findvoucher') {
    const query = args.trim();
    if (!query) {
      await sendTelegramMessage(chatId, '⚠️ Vui lòng nhập từ khóa tên sản phẩm hoặc shop. Ví dụ: <code>/timma tu_store</code>', 'HTML', getBackToMenuKeyboard(lang));
      return;
    }
    const found = await searchVouchersByProduct(query);
    if (!found || found.length === 0) {
      await sendTelegramMessage(chatId, `📭 Không tìm thấy voucher nào phù hợp với từ khóa <code>${escapeHtml(query)}</code>.`, 'HTML', getBackToMenuKeyboard(lang));
      return;
    }
    const keyboard = formatVouchersAsInlineKeyboard(found, lang);
    await sendTelegramMessage(chatId, `🔍 <b>Tìm thấy ${found.length} voucher phù hợp với "${escapeHtml(query)}" (Chạm nút để nhận):</b>`, 'HTML', keyboard);
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

  // Kiểm tra nếu người dùng quăng Link Sản Phẩm Shopee vào Telegram
  if (trimmed.includes('shopee.vn') || trimmed.includes('shp.ee')) {
    if (!trimmed.includes('/shop') && !trimmed.includes('/seller')) {
      await handleShopeeProductLinkOptimization(chatId, trimmed);
      return;
    }
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

function scheduleHourlyAutoRestart() {
  const ONE_HOUR_MS = 60 * 60 * 1000;
  logger.info('[Auto-Restart] Đã kích hoạt lịch tự động làm mới & khởi động lại Bot sau mỗi 1 giờ (Tối ưu RAM 24/7)...');

  setTimeout(() => {
    logger.warn('[Auto-Restart] Đã đến chu kỳ 1 giờ! Đang tự động làm mới Bot Server để tối ưu hiệu năng...');
    process.exit(0);
  }, ONE_HOUR_MS);
}

async function startBotServer() {
  scheduleHourlyAutoRestart();
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

  try {
    startVoucherScannerPolling(5 * 60 * 1000);
  } catch (e: any) {
    logger.error({ error: e.message }, 'Loi khi khoi chay Voucher Scanner Polling');
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
      if (updates && updates.length > 0) {
        offset = updates[updates.length - 1].update_id + 1;

        // Xử lý song song siêu tốc cho tất cả tin nhắn (Non-blocking async dispatch)
        updates.forEach((update: any) => {
          processSingleUpdate(update).catch((err: any) => {
            logger.error({ error: err.message }, 'Lỗi xử lý tin nhắn Telegram');
          });
        });
      }
    } catch (e: any) {
      logger.error({ error: e.message }, 'Lỗi trong vòng lặp Telegram Bot');
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function processSingleUpdate(update: any) {
  // Xử lý Inline Keyboard Button Callbacks (Nút bấm tương tác)
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = String(cb.message.chat.id);
    const data = cb.data;

    // Phản hồi CallbackQuery tức thì (0ms) để giao diện Telegram không bị đơ
    answerCallbackQuery(cb.id, '', false).catch(() => {});

    if (data && data.startsWith('detail_')) {
      const targetIdOrCode = data.replace('detail_', '');
      const lang = getUserLang(chatId);
      const voucher = await prisma.voucher.findFirst({
        where: {
          OR: [
            { id: targetIdOrCode },
            { voucherCode: targetIdOrCode },
          ],
        },
      });

      if (voucher) {
        const msg = formatVoucherTelegramMessage(voucher);
        const targetLink = voucher.affiliateUrl || voucher.sourceUrl;
        const code = voucher.voucherCode || 'SHOPEE50K';

        const detailKeyboard = {
          inline_keyboard: [
            [
              { text: `📋 Sao Chép Mã [ ${code} ]`, callback_data: `copy_${code}` },
            ],
            [
              { text: `🔗 Mở App Shopee Nhận Mã Ngay`, url: targetLink },
            ],
            [
              { text: t('btnBackMenu', lang), callback_data: 'cmd_mainmenu' },
            ],
          ],
        };

        await sendTelegramMessage(chatId, msg, 'HTML', detailKeyboard);
      }
    } else if (data && data.startsWith('copy_')) {
      const code = data.replace('copy_', '');
      await answerCallbackQuery(
        cb.id,
        `📋 ĐÃ SAO CHÉP MÃ VOUCHER: [ ${code} ]\n\nHãy dán mã này tại bước Thanh Toán trên Shopee để được trừ tiền ngay!`,
        true
      );
    } else if (data && data.startsWith('timeline_')) {
      const waybillNo = data.replace('timeline_', '');
      const lang = getUserLang(chatId);
      await sendTelegramMessage(chatId, `⏳ <b>Đang tải toàn bộ mốc hành trình chi tiết cho mã <code>${escapeHtml(waybillNo)}</code>...</b>`, 'HTML');
      const spxResult = await trackUniversalWaybillWithTimeout(waybillNo, 20000);

      if (spxResult && spxResult.steps && spxResult.steps.length > 0) {
        let timeMsg = `📜 <b>LỊCH SỬ HÀNH TRÌNH CHI TIẾT (${spxResult.steps.length} MỐC)</b>\n`;
        timeMsg += `📦 <b>Mã vận đơn:</b> <code>${escapeHtml(spxResult.trackingNo)}</code>\n\n`;

        spxResult.steps.forEach((step, idx) => {
          timeMsg += `<b>${idx + 1}. [${escapeHtml(step.time)} - ${escapeHtml(step.date)}]</b>\n`;
          timeMsg += `   └ ${escapeHtml(step.status)}\n\n`;
        });

        const hideKeyboard = {
          inline_keyboard: [
            [
              { text: '🔼 Ẩn Lịch Sử Hành Trình', callback_data: `hidetimeline_${spxResult.trackingNo}` },
              { text: t('btnBackMenu', lang), callback_data: 'cmd_mainmenu' },
            ],
          ],
        };

        await sendTelegramMessage(chatId, timeMsg, 'HTML', hideKeyboard);
      } else {
        await answerCallbackQuery(cb.id, '📭 Chưa có mốc lịch sử chi tiết cho mã này.', true);
      }
    } else if (data && data.startsWith('hidetimeline_')) {
      await answerCallbackQuery(cb.id, '🔼 Đã thu gọn lịch sử hành trình!', false);
    } else if (data && data.startsWith('lang_')) {
      const selectedLang = data.replace('lang_', '');
      if (isValidLanguage(selectedLang)) {
        userLanguages.set(chatId, selectedLang);
        await sendTelegramMessage(chatId, t('languageUpdated', selectedLang), 'HTML');
        await sendMainMenuWithButtons(chatId);
      }
    } else if (data && data.startsWith('cmd_')) {
      const cmdKey = data.replace('cmd_', '');
      if (cmdKey === 'mainmenu') {
        await sendMainMenuWithButtons(chatId);
      } else if (cmdKey === 'hot') {
        await handleCommand(chatId, '/hot');
      } else if (cmdKey === 'vouchers') {
        await handleCommand(chatId, '/vouchers');
      } else if (cmdKey === 'today') {
        await handleCommand(chatId, '/today');
      } else if (cmdKey === 'listshops') {
        await handleCommand(chatId, '/listshops');
      } else if (cmdKey === 'danhsach') {
        await handleCommand(chatId, '/danhsach');
      } else if (cmdKey === 'export') {
        await handleCommand(chatId, '/xuatexcel');
      } else if (cmdKey === 'filter') {
        await handleCommand(chatId, '/filter');
      } else if (cmdKey === 'lang') {
        await handleCommand(chatId, '/lang');
      } else if (cmdKey === 'trangthai') {
        await handleCommand(chatId, '/trangthai');
      } else if (cmdKey === 'fullhelp') {
        const lang = getUserLang(chatId);
        await sendTelegramMessage(chatId, t('helpCommandText', lang), 'HTML', getBackToMenuKeyboard());
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

startBotServer();
