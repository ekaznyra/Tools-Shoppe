import fs from 'fs';
import path from 'path';
import { trackUniversalWaybill } from '../multi-carrier-tracker/index.ts';
import type { WaybillTrackingResult } from '../spx-tracker/index.ts';
import { sendTelegramMessage, escapeHtml } from '../telegram/index.ts';
import { logger } from '../logging/index.ts';

export interface WatchedWaybill {
  trackingNo: string;
  chatId: string;
  addedAt: string;
  lastStatus?: string;
  lastLocation?: string;
  lastUpdateTime?: string;
}

const WATCHLIST_FILE = path.resolve(process.cwd(), 'waybill_watchlist.json');

function loadWatchlist(): WatchedWaybill[] {
  try {
    if (fs.existsSync(WATCHLIST_FILE)) {
      const data = fs.readFileSync(WATCHLIST_FILE, 'utf-8');
      return JSON.parse(data || '[]');
    }
  } catch (e) {}
  return [];
}

function saveWatchlist(list: WatchedWaybill[]): void {
  try {
    fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } catch (e) {
    logger.error('Loi khi luu waybill_watchlist.json');
  }
}

export function addToWatchlist(chatId: string, trackingNo: string): { added: boolean; message: string } {
  const list = loadWatchlist();
  const cleanCode = trackingNo.trim().toUpperCase();

  if (list.some((item) => item.trackingNo === cleanCode && item.chatId === chatId)) {
    return { added: false, message: `Mã vận đơn <code>${cleanCode}</code> đã có trong danh sách theo dõi của bạn.` };
  }

  list.push({
    trackingNo: cleanCode,
    chatId,
    addedAt: new Date().toISOString(),
  });

  saveWatchlist(list);
  return { added: true, message: `✅ Đã thêm mã vận đơn <code>${cleanCode}</code> vào Danh Sách Theo Dõi Tự Động!` };
}

export function getWatchlist(chatId: string): WatchedWaybill[] {
  const list = loadWatchlist();
  return list.filter((item) => item.chatId === chatId);
}

export function removeFromWatchlist(chatId: string, trackingNo: string): boolean {
  let list = loadWatchlist();
  const cleanCode = trackingNo.trim().toUpperCase();
  const initialLen = list.length;
  list = list.filter((item) => !(item.trackingNo === cleanCode && item.chatId === chatId));
  if (list.length !== initialLen) {
    saveWatchlist(list);
    return true;
  }
  return false;
}

let pollingTimer: NodeJS.Timeout | null = null;

/**
 * Khởi chạy vòng lặp ngầm tự động quét thay đổi hành trình mã vận đơn (Mỗi 10 phút/lần)
 */
export function startWatchlistPolling(intervalMs: number = 10 * 60 * 1000) {
  if (pollingTimer) clearInterval(pollingTimer);
  logger.info(`Da bat vong lap tu dong theo doi danh sach Watchlist (Moi ${Math.round(intervalMs / 60000)} phut/lan)...`);

  pollingTimer = setInterval(async () => {
    try {
      const list = loadWatchlist();
      if (!list || list.length === 0) return;

      logger.info(`Dang tu dong quet cap nhat cho ${list.length} ma van don trong Watchlist...`);

      for (const item of list) {
        const result = await trackUniversalWaybill(item.trackingNo);
        if (result && result.success) {
          const currentLoc = result.latestLocation || result.status;
          const currentStatus = result.status;
          const currentStepTime = result.latestTime || '';

          // Kiểm tra nếu có sự thay đổi về hành trình hoặc vị trí kho
          if (
            (item.lastLocation && item.lastLocation !== currentLoc) ||
            (item.lastStatus && item.lastStatus !== currentStatus)
          ) {
            logger.info(`Phat hien THAY DOI HANH TRINH cho ma: ${item.trackingNo}`);

            let alertMsg = `🔔 <b>CẬP NHẬT MỚI HÀNH TRÌNH VẬN ĐƠN!</b>\n\n`;
            alertMsg += `• <b>Mã vận đơn:</b> <code>${escapeHtml(item.trackingNo)}</code>\n`;
            alertMsg += `• <b>Đơn vị vận chuyển:</b> ${escapeHtml(result.carrier)}\n`;
            alertMsg += `• <b>Trạng thái MỚI:</b> ${escapeHtml(result.status)}\n`;
            if (result.latestLocation) {
              alertMsg += `• <b>Vị trí kho mới nhất:</b> <i>${escapeHtml(result.latestLocation)}</i>\n`;
            }
            if (result.latestTime) {
              alertMsg += `• <b>Thời gian:</b> <code>${escapeHtml(result.latestTime)}</code>\n`;
            }

            await sendTelegramMessage(item.chatId, alertMsg);

            // Cập nhật lại trạng thái mới nhất
            item.lastStatus = currentStatus;
            item.lastLocation = currentLoc;
            item.lastUpdateTime = currentStepTime;
            saveWatchlist(list);
          } else {
            // Lưu trạng thái ban đầu nếu mới thêm
            item.lastStatus = currentStatus;
            item.lastLocation = currentLoc;
            item.lastUpdateTime = currentStepTime;
            saveWatchlist(list);
          }
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (e: any) {
      logger.error({ error: e.message }, 'Loi trong vong lap Watchlist Polling');
    }
  }, intervalMs);
}
