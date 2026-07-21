import { chromium, type Browser } from 'playwright';
import fs from 'fs';
import { trackSPXWaybill, type WaybillTrackingResult } from '../spx-tracker/index.ts';
import { logger } from '../logging/index.ts';

function findSystemBrowserExecutable(): string | undefined {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  if (fs.existsSync(chromePath)) return chromePath;
  if (fs.existsSync(edgePath)) return edgePath;
  return undefined;
}

export type CarrierType = 'SPX' | 'GHTK' | 'GHN' | 'VIETTEL' | 'NINJAVAN' | 'UNKNOWN';

/**
 * Tự động nhận diện Đơn vị vận chuyển từ định dạng Mã vận đơn
 */
export function detectCarrier(trackingNo: string): CarrierType {
  const code = trackingNo.trim().toUpperCase();
  if (code.startsWith('SPX')) return 'SPX';
  if (code.startsWith('NIVN') || code.startsWith('NJV')) return 'NINJAVAN';
  if (code.startsWith('G8') || code.startsWith('GHN')) return 'GHN';
  if (code.startsWith('VT') || code.startsWith('VTP')) return 'VIETTEL';
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
 * Tra cứu Mã Vận Đơn đa kênh (Hỗ trợ SPX, GHTK, GHN, NinjaVan, ViettelPost)
 */
export async function trackUniversalWaybill(trackingNo: string): Promise<WaybillTrackingResult> {
  const carrier = detectCarrier(trackingNo);

  if (carrier === 'GHTK') {
    const ghtkRes = await trackGHTK(trackingNo);
    if (ghtkRes.success) return ghtkRes;
  }

  // Tra cứu qua SPX Tracker mặc định
  const spxRes = await trackSPXWaybill(trackingNo);
  if (spxRes) return spxRes;

  return {
    trackingNo,
    status: '❓ Chưa ghi nhận hành trình',
    carrier: carrier !== 'UNKNOWN' ? carrier : 'Vận chuyển',
    steps: [],
    success: false,
    errorMessage: 'Không tìm thấy dữ liệu vận đơn.',
  };
}
