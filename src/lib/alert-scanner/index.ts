import type { WaybillTrackingResult } from '../spx-tracker/index.ts';
import { sendTelegramMessage, escapeHtml } from '../telegram/index.ts';
import { logger } from '../logging/index.ts';

export interface DeliveryAlert {
  trackingNo: string;
  type: 'FAILED_DELIVERY' | 'DELAYED_HUB' | 'RETURNED' | 'CANCELLED';
  title: string;
  reason: string;
  recommendation: string;
}

/**
 * Phân tích và phát hiện các đơn hàng bị Giao thất bại / Trễ hạn / Ngâm kho / Trả hàng
 */
export function analyzeDeliveryAlerts(results: WaybillTrackingResult[]): DeliveryAlert[] {
  const alerts: DeliveryAlert[] = [];

  for (const item of results) {
    const statusText = item.status.toLowerCase();
    const latestLoc = (item.latestLocation || '').toLowerCase();

    // 1. Phát hiện Giao thất bại
    if (
      statusText.includes('thất bại') ||
      statusText.includes('khai hỏa') ||
      latestLoc.includes('không thành công') ||
      latestLoc.includes('không liên lạc được') ||
      latestLoc.includes('khách hẹn') ||
      latestLoc.includes('từ chối')
    ) {
      alerts.push({
        trackingNo: item.trackingNo,
        type: 'FAILED_DELIVERY',
        title: '⚠️ CẢNH BÁO: GIAO HÀNG THẤT BẠI / KHÔNG GIAO ĐƯỢC',
        reason: item.latestLocation || 'Giao không thành công hoặc không liên lạc được với người nhận',
        recommendation: '📞 Bạn nên gọi điện trực tiếp cho khách hàng hoặc giục shipper giao lại ngay!',
      });
    }
    // 2. Phát hiện Hoàn trả / Hủy đơn
    else if (statusText.includes('hủy') || statusText.includes('trả') || latestLoc.includes('hoàn')) {
      alerts.push({
        trackingNo: item.trackingNo,
        type: 'RETURNED',
        title: '🚨 CẢNH BÁO: ĐƠN HÀNG ĐANG BỊ THẤT BẠI / HOÀN TRẢ',
        reason: item.latestLocation || 'Đơn hàng bị yêu cầu hoàn trả hoặc đã hủy',
        recommendation: '📲 Kiểm tra ngay với bên vận chuyển để khiếu nại hoặc hỗ trợ khách đổi trả!',
      });
    }
    // 3. Phát hiện Ngâm kho (Nằm ở kho trung chuyển quá nhiều mốc)
    else if (item.steps && item.steps.length >= 6 && !statusText.includes('thành công')) {
      alerts.push({
        trackingNo: item.trackingNo,
        type: 'DELAYED_HUB',
        title: '⏳ CẢNH BÁO: ĐƠN HÀNG CÓ DẤU HIỆU NGÂM KHO / TRỄ HẠN',
        reason: `Đã trải qua ${item.steps.length} mốc trung chuyển nhưng chưa giao thành công. Vị trí: ${item.latestLocation || 'N/A'}`,
        recommendation: '📌 Bạn nên yêu cầu bưu cục hỗ trợ đẩy nhanh tiến độ giao nhận!',
      });
    }
  }

  return alerts;
}

/**
 * Gửi thông báo Cảnh báo khẩn cấp tới Telegram
 */
export async function sendDeliveryAlertsToTelegram(chatId: string, alerts: DeliveryAlert[]): Promise<void> {
  if (!alerts || alerts.length === 0) return;

  logger.info(`Gửi ${alerts.length} cảnh báo đơn hàng tới Telegram Chat [${chatId}]`);

  for (const alert of alerts) {
    let msg = `${alert.title}\n\n`;
    msg += `• <b>Mã vận đơn:</b> <code>${escapeHtml(alert.trackingNo)}</code>\n`;
    msg += `• <b>Lý do cảnh báo:</b> <i>${escapeHtml(alert.reason)}</i>\n\n`;
    msg += `💡 <b>KHUYÊN DÙNG:</b> ${escapeHtml(alert.recommendation)}`;

    await sendTelegramMessage(chatId, msg);
    await new Promise((r) => setTimeout(r, 1000));
  }
}
