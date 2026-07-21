import fs from 'fs';
import path from 'path';
import { logger } from '../logging/index.ts';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ALLOWED_CHAT_ID = process.env.TELEGRAM_ALLOWED_CHAT_ID || '';

/**
 * Gửi tin nhắn Telegram
 */
export async function sendTelegramMessage(
  chatId: string,
  text: string,
  parseMode: string = 'HTML',
  replyMarkup?: any
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN || BOT_TOKEN;
  if (!token) {
    logger.warn('Chưa cấu hình TELEGRAM_BOT_TOKEN trong .env');
    return false;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const payload: any = {
      chat_id: chatId,
      text,
      parse_mode: parseMode,
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    return data.ok === true;
  } catch (error: any) {
    logger.error({ error: error.message }, 'Lỗi khi gửi tin nhắn Telegram');
    return false;
  }
}

/**
 * Trả lời Callback Query (Hiển thị popup thông báo tức thì khi bấm nút trên Telegram)
 */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text: string,
  showAlert: boolean = true
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN || BOT_TOKEN;
  if (!token) return false;

  const url = `https://api.telegram.org/bot${token}/answerCallbackQuery`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
        show_alert: showAlert,
      }),
    });
    const data = await response.json();
    return data.ok === true;
  } catch (error: any) {
    logger.error({ error: error.message }, 'Lỗi khi trả lời Callback Query');
    return false;
  }
}

/**
 * Gửi file tài liệu (Excel/CSV) qua Telegram
 */
export async function sendTelegramDocument(
  chatId: string,
  filePath: string,
  caption: string = ''
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN || BOT_TOKEN;
  if (!token) {
    logger.warn('Chưa cấu hình TELEGRAM_BOT_TOKEN trong .env');
    return false;
  }

  if (!fs.existsSync(filePath)) {
    logger.error(`File không tồn tại: ${filePath}`);
    return false;
  }

  const url = `https://api.telegram.org/bot${token}/sendDocument`;

  try {
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('caption', caption);

    const fileBuffer = fs.readFileSync(filePath);
    const blob = new Blob([fileBuffer]);
    formData.append('document', blob, path.basename(filePath));

    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();
    return data.ok === true;
  } catch (error: any) {
    logger.error({ error: error.message }, 'Lỗi khi gửi file qua Telegram');
    return false;
  }
}

/**
 * Lấy các tin nhắn mới từ Telegram Bot (Long Polling)
 */
export async function getTelegramUpdates(offset: number = 0, timeout: number = 20) {
  const token = process.env.TELEGRAM_BOT_TOKEN || BOT_TOKEN;
  if (!token) return [];

  const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=${timeout}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    if (data.ok) {
      return data.result || [];
    }
  } catch (error: any) {
    logger.error({ error: error.message }, 'Lỗi khi Polling tin nhắn Telegram');
  }
  return [];
}

/**
 * Hàm mã hóa ký tự đặc biệt tránh lỗi định dạng HTML trên Telegram
 */
export function escapeHtml(str: string): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Kiểm tra xem Chat ID có thuộc danh sách authorized không
 */
export function isAuthorizedUser(chatId: string | number): boolean {
  const allowed = process.env.TELEGRAM_ALLOWED_CHAT_ID || ALLOWED_CHAT_ID;
  if (!allowed) return true; // Nếu chưa cài ID thì chấp nhận để test ban đầu
  return String(chatId) === String(allowed);
}
