import { chromium, type Browser, type BrowserContext } from 'playwright';
import fs from 'fs';
import os from 'os';
import { logger } from '../logging/index.ts';

export interface TrackingStep {
  time: string;
  date: string;
  status: string;
}

export interface WaybillTrackingResult {
  trackingNo: string;
  status: string;
  carrier: string;
  latestLocation?: string;
  latestTime?: string;
  steps: TrackingStep[];
  success: boolean;
  errorMessage?: string;
}

// In-Memory Cache (Bộ nhớ đệm RAM)
const memoryCache = new Map<string, { data: WaybillTrackingResult; timestamp: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 phút

let globalBrowser: Browser | null = null;
let globalContext: BrowserContext | null = null;

function findSystemBrowserExecutable(): string | undefined {
  if (process.platform === 'win32') {
    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    if (fs.existsSync(chromePath)) return chromePath;
    if (fs.existsSync(edgePath)) return edgePath;
  }
  return undefined;
}

async function getWarmBrowserContext(): Promise<BrowserContext> {
  if (!globalBrowser || !globalBrowser.isConnected()) {
    logger.info('Khoi tao Trinh duyet Ngam SPX Tracker Context...');
    const executablePath = findSystemBrowserExecutable();
    
    globalBrowser = await chromium.launch({
      executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ],
    });

    globalContext = await globalBrowser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      locale: 'vi-VN',
    });
  }
  return globalContext!;
}

export function extractWaybillsFromText(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/\b(SPX[A-Z0-9]{8,22}|[A-Z0-9]{10,24})\b/gi);
  if (!matches) return [];
  return Array.from(new Set(matches.map((m) => m.toUpperCase())));
}

/**
 * Tra cứu 1 Mã Vận Đơn SPX Express với cơ chế chờ linh hoạt và Auto-Retry chống trùng/trễ AJAX
 */
export async function trackSPXOnPage(page: any, trackingNo: string): Promise<WaybillTrackingResult> {
  const cleanTrackingNo = trackingNo.trim().toUpperCase();

  // 1. Kiểm tra bộ nhớ đệm Cache
  const cached = memoryCache.get(cleanTrackingNo);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    logger.info(`[CACHE HIT] Tra cuu tu RAM cho ma: ${cleanTrackingNo}`);
    return cached.data;
  }

  logger.info(`Dang tra cuu SPX ma: ${cleanTrackingNo}`);

  try {
    await page.goto('https://spx.vn/vi', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(800);

    const input = page.locator('input').first();
    if (await input.isVisible({ timeout: 5000 }).catch(() => false)) {
      await input.click();
      await input.fill(cleanTrackingNo);

      const trackBtn = page.locator('button:has-text("Theo dõi"), button:has-text("Track")').first();
      if (await trackBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await trackBtn.click();
      } else {
        await page.keyboard.press('Enter');
      }

      // Đợi phản hồi từ SPX AJAX (tối đa 12 giây, tự động giải phóng ngay khi có kết quả)
      await page.waitForFunction(
        () => {
          const text = document.body.innerText || '';
          return text.includes('Giao hàng thành công') ||
                 text.includes('Đang giao hàng') ||
                 text.includes('Đơn hàng') ||
                 text.includes('Chờ lấy hàng') ||
                 text.includes('Mã Vận Đơn') ||
                 text.includes('bưu kiện');
        },
        null,
        { timeout: 12000 }
      ).catch(() => {});
    }

    let bodyText = await page.innerText('body');

    // Thử lại 1 lần nếu mạng lag AJAX chưa kịp đổ về DOM
    if (
      !bodyText.includes('Giao hàng thành công') &&
      !bodyText.includes('Đang giao hàng') &&
      !bodyText.includes('Đơn hàng') &&
      !bodyText.includes('Chờ lấy hàng') &&
      !bodyText.includes('Mã Vận Đơn')
    ) {
      logger.info(`Man hinh chua thay du lieu, cho them 2.5s cho AJAX hoan tat...`);
      await page.waitForTimeout(2500);
      bodyText = await page.innerText('body');
    }

    if (
      bodyText.includes('Giao hàng thành công') ||
      bodyText.includes('Đang giao hàng') ||
      bodyText.includes('Đơn hàng') ||
      bodyText.includes('Chờ lấy hàng') ||
      bodyText.includes('Mã Vận Đơn')
    ) {
      const lines = bodyText.split('\n').map((l: string) => l.trim()).filter(Boolean);

      let mainStatus = '🚚 Đang vận chuyển';
      if (bodyText.includes('Giao hàng thành công')) mainStatus = '✅ Giao hàng thành công';
      else if (bodyText.includes('Đang giao hàng')) mainStatus = '🚚 Đang giao hàng';
      else if (bodyText.includes('Chờ lấy hàng')) mainStatus = '📦 Chờ lấy hàng';
      else if (bodyText.includes('Hủy') || bodyText.includes('Trả hàng')) mainStatus = '❌ Đã hủy / Trả hàng';

      const steps: TrackingStep[] = [];

      for (let i = 0; i < lines.length; i++) {
        const timeMatch = lines[i].match(/^\d{2}:\d{2}:\d{2}$/);
        if (timeMatch && i + 2 < lines.length) {
          const time = lines[i];
          const date = lines[i + 1];
          const status = lines[i + 2];

          if (date.match(/\d{1,2}\s+[A-Za-z]{3}\s+\d{4}/) || date.match(/\d{2}\/\d{2}\/\d{4}/)) {
            if (!steps.some((s) => s.time === time && s.date === date && s.status === status)) {
              steps.push({ time, date, status });
            }
          }
        }
      }

      const latestStep = steps.length > 0 ? steps[0] : undefined;

      const result: WaybillTrackingResult = {
        trackingNo: cleanTrackingNo,
        status: mainStatus,
        carrier: 'SPX Express (Shopee Express)',
        latestLocation: latestStep ? latestStep.status : undefined,
        latestTime: latestStep ? `${latestStep.time} ${latestStep.date}` : undefined,
        steps,
        success: true,
      };

      memoryCache.set(cleanTrackingNo, { data: result, timestamp: Date.now() });
      return result;
    }

    return {
      trackingNo: cleanTrackingNo,
      status: '❓ Chưa ghi nhận dữ liệu hành trình',
      carrier: 'SPX Express',
      steps: [],
      success: false,
      errorMessage: 'Mã vận đơn không tồn tại trên SPX Express hoặc chưa cập nhật.',
    };
  } catch (err: any) {
    logger.error({ error: err.message }, `Loi tra cuu van don ${cleanTrackingNo}`);
    return {
      trackingNo: cleanTrackingNo,
      status: '❌ Lỗi tra cứu',
      carrier: 'SPX Express',
      steps: [],
      success: false,
      errorMessage: err.message,
    };
  }
}

/**
 * Tra cứu HÀNG LOẠT song song tối đa 16 luồng cùng lúc (Cho VPS 32 Cores / 96GB RAM)
 */
export async function trackMultipleSPXWaybills(
  trackingNumbers: string[]
): Promise<WaybillTrackingResult[]> {
  if (!trackingNumbers || trackingNumbers.length === 0) return [];

  const cpus = os.cpus().length || 8;
  const maxConcurrency = Math.min(cpus, 16);
  logger.info(`Tra cuu ${trackingNumbers.length} ma van don (Chay song song ${maxConcurrency} luong)...`);

  try {
    const context = await getWarmBrowserContext();

    const results: WaybillTrackingResult[] = [];
    for (let i = 0; i < trackingNumbers.length; i += maxConcurrency) {
      const batch = trackingNumbers.slice(i, i + maxConcurrency);
      const batchResults = await Promise.all(
        batch.map(async (code) => {
          const page = await context.newPage();
          try {
            return await trackSPXOnPage(page, code);
          } finally {
            await page.close().catch(() => {});
          }
        })
      );
      results.push(...batchResults);
    }

    return results;
  } catch (err: any) {
    logger.error({ error: err.message }, 'Loi trong qua trinh tra cuu nhieu ma van don');
    return [];
  }
}

/**
 * Tra cứu 1 Mã Vận Đơn duy nhất
 */
export async function trackSPXWaybill(trackingNo: string): Promise<WaybillTrackingResult | null> {
  const resList = await trackMultipleSPXWaybills([trackingNo]);
  return resList.length > 0 ? resList[0] : null;
}
