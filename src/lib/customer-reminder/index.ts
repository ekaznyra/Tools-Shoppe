import { escapeHtml } from '../telegram/index.ts';

export interface CustomerReminderInfo {
  trackingNoOrOrderSn: string;
  customerName?: string;
  productName?: string;
  carrierName?: string;
}

/**
 * Tự động tạo mẫu tin nhắn gửi khách hàng nhắc nghe máy nhận hàng
 */
export function generateCustomerDeliveryReminder(info: CustomerReminderInfo): string {
  const code = info.trackingNoOrOrderSn;
  const product = info.productName ? ` (${info.productName})` : '';
  const carrier = info.carrierName ? ` [${info.carrierName}]` : '';

  return `Dạ chào bạn! Đơn hàng Shopee mã ${code}${product} của bạn đang được đơn vị vận chuyển${carrier} đi giao đến. Bạn vui lòng để ý giữ điện thoại để nhận hàng giúp Shop nhé. Cảm ơn bạn rất nhiều! ❤️`;
}

/**
 * Tạo mẫu tin nhắn định dạng HTML dùng cho Telegram Bot
 */
export function formatTelegramCustomerReminder(info: CustomerReminderInfo): string {
  const reminderText = generateCustomerDeliveryReminder(info);
  let msg = `📲 <b>MẪU TIN NHẮN NHẮC KHÁCH NGHE MÁY NHẬN HÀNG:</b>\n\n`;
  msg += `<code>${escapeHtml(reminderText)}</code>\n\n`;
  msg += `💡 <i>Bạn chỉ cần sao chép (copy) đoạn văn bản trên để gửi qua Zalo / SMS cho khách hàng!</i>`;
  return msg;
}
