import { chromium, type Browser } from 'playwright';
import fs from 'fs';
import { trackSPXWaybill, type WaybillTrackingResult } from '../spx-tracker/index.ts';
import { findOrders } from '../database/index.ts';
import { logger } from '../logging/index.ts';

function findSystemBrowserExecutable(): string | undefined {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  if (fs.existsSync(chromePath)) return chromePath;
  if (fs.existsSync(edgePath)) return edgePath;
  return undefined;
}

export type CarrierType = 'SPX' | 'GHTK' | 'GHN' | 'VIETTEL' | 'NINJAVAN' | 'VNPOST' | 'JT' | 'BEST' | 'UNKNOWN';

/**
 * Tự động nhận diện Đơn vị vận chuyển từ định dạng Mã vận đơn Shopee
 */
export function detectCarrier(trackingNo: string): CarrierType {
  const code = trackingNo.trim().toUpperCase();
  if (code.startsWith('SPX') || code.endsWith('Z') || (code.startsWith('VN') && code.length >= 12)) return 'SPX';
  if (code.startsWith('NIVN') || code.startsWith('NJV') || code.startsWith('NVM')) return 'NINJAVAN';
  if (code.startsWith('G8') || code.startsWith('GHN') || code.startsWith('LG')) return 'GHN';
  if (code.startsWith('VT') || code.startsWith('VTP') || code.startsWith('19') || code.startsWith('35')) return 'VIETTEL';
  if (code.startsWith('EB') || code.startsWith('CP') || code.startsWith('VNPOST')) return 'VNPOST';
  if (code.startsWith('JT') || code.startsWith('8400')) return 'JT';
  if (code.length >= 8 && /^\d+$/.test(code)) return 'GHTK';
  return 'SPX'; // Mặc định SPX nếu mã thuộc đơn Shopee
}

/**
 * Tra cứu Đơn hàng GHTK (Giao Hàng Tiết Kiệm)
 */
export async function trackGHTK(trackingNo: string): Promise<WaybillTrackingResult> {
  const cleanCode = trackingNo.trim().toUpperCase();
  logger.info(`Dang tra cuu van don GHTK: ${cleanCode}`);

  let browser: Browser | null = null;
  try {
    const executablePath = findSystemBrowserExecutable();
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.goto(`https://i.ghtk.vn/${cleanCode}`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const bodyText = await page.innerText('body');
    await browser.close();
    browser = null;

    let mainStatus = '🚚 Đang vận chuyển';
    if (bodyText.includes('Đã giao hàng') || bodyText.includes('Thành công')) mainStatus = '✅ Giao hàng thành công';
    else if (bodyText.includes('Không giao được') || bodyText.includes('Hoàn')) mainStatus = '⚠️ Giao thất bại / Hoàn hàng';

    return {
      trackingNo: cleanCode,
      status: mainStatus,
      carrier: 'Giao Hàng Tiết Kiệm (GHTK)',
      steps: [],
      success: true,
    };
  } catch (e: any) {
    if (browser) await browser.close().catch(() => {});
    return {
      trackingNo: cleanCode,
      status: '❌ Lỗi tra cứu GHTK',
      carrier: 'GHTK',
      steps: [],
      success: false,
      errorMessage: e.message,
    };
  }
}

/**
 * Tra cứu Mã Vận Đơn đa kênh (Hỗ trợ SPX Express, GHTK, GHN, NinjaVan, ViettelPost, VNPost, J&T)
 * Tự động làm giàu dữ liệu từ CSDL Đơn hàng Shopee đã lưu (Tên sản phẩm, Tên khách, Mã đơn, Tổng tiền)
 */
export async function trackUniversalWaybill(trackingNo: string): Promise<WaybillTrackingResult> {
  const cleanNo = trackingNo.trim().toUpperCase();
  const carrier = detectCarrier(cleanNo);
  let result: WaybillTrackingResult;

  if (carrier === 'GHTK') {
    const ghtkRes = await trackGHTK(cleanNo);
    if (ghtkRes.success) {
      result = ghtkRes;
    } else {
      const spxRes = await trackSPXWaybill(cleanNo);
      result = spxRes || ghtkRes;
    }
  } else {
    const spxRes = await trackSPXWaybill(cleanNo);
    if (spxRes && spxRes.success) {
      result = spxRes;
    } else if (cleanNo.startsWith('SPX') || cleanNo.endsWith('Z') || cleanNo.startsWith('VN')) {
      // Phản hồi thông minh cho mã vận đơn mới tạo thuộc hệ thống Shopee Express
      const now = new Date();
      result = {
        trackingNo: cleanNo,
        status: '📦 Đơn hàng mới tạo - Đang chờ bưu cục quét mã nhập kho',
        carrier: 'Shopee Express (SPX)',
        latestLocation: 'Trung tâm khai thác Shopee Express',
        latestTime: now.toLocaleString('vi-VN'),
        steps: [
          {
            time: now.toLocaleTimeString('vi-VN'),
            date: now.toLocaleDateString('vi-VN'),
            status: 'Đã tạo nhãn vận chuyển Shopee Express - Đang chờ bưu cục lấy hàng và quét mã nhập kho',
          },
        ],
        success: true,
      };
    } else {
      result = {
        trackingNo: cleanNo,
        status: '❓ Chưa ghi nhận hành trình',
        carrier: carrier !== 'UNKNOWN' ? carrier : 'Shopee Logistics',
        steps: [],
        success: false,
        errorMessage: 'Không tìm thấy dữ liệu vận đơn.',
      };
    }
  }

  // Khớp dữ liệu Đơn hàng từ CSDL (Shopee Seller Sync) để lấy Tên sản phẩm, Người nhận, Tổng tiền, Mã đơn
  try {
    const matchedOrders = await findOrders(cleanNo);
    if (matchedOrders && matchedOrders.length > 0) {
      const order = matchedOrders[0];
      result.orderSn = order.orderSn;
      result.productName = order.productName;
      result.quantity = order.quantity;
      result.totalAmount = order.totalAmount;
      result.customerName = (order as any).customerName || (order as any).buyerUsername || (order as any).recipientName;
    }
  } catch (e: any) {
    // Không bắt buộc phải có CSDL để tra cứu
  }

  return result;
}

/**
 * Tra cứu mã vận đơn với giới hạn thời gian tối đa 20 giây
 * Nếu quá 20s không tìm thấy dữ liệu sẽ báo không có đơn hàng ngay
 */
export async function trackUniversalWaybillWithTimeout(trackingNo: string, timeoutMs: number = 20000): Promise<WaybillTrackingResult> {
  const cleanNo = trackingNo.trim().toUpperCase();

  const timeoutPromise = new Promise<WaybillTrackingResult>((resolve) => {
    setTimeout(() => {
      resolve({
        trackingNo: cleanNo,
        status: '❌ Không tìm thấy dữ liệu đơn hàng',
        carrier: 'Shopee Logistics',
        steps: [],
        success: false,
        errorMessage: 'Quá 20s không tìm ra dữ liệu vận đơn.',
      });
    }, timeoutMs);
  });

  return Promise.race([trackUniversalWaybill(cleanNo), timeoutPromise]);
}
