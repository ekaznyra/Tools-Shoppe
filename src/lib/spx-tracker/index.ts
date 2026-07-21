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

// In-Memory Cache (Bộ nhớ đệm RAM 10 phút -> Phản hồi 0.001s)
const memoryCache = new Map<string, { data: WaybillTrackingResult; timestamp: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

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
    logger.info('Khoi tao Trinh duyet Ngam Tieu Chuan VPS (Super Fast Speed)...');
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
        '--blink-settings=imagesEnabled=false', // Tắt ảnh tải cực nhanh
      ],
    });

    globalContext = await globalBrowser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      locale: 'vi-VN',
    });

    // Chặn tất cả ảnh, font, css rác để tải trang spx.vn chỉ trong 0.3 giây
    await globalContext.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf}', (route) => route.abort());
    await globalContext.route('**/*analytics*', (route) => route.abort());
    await globalContext.route('**/*google*', (route) => route.abort());
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
 * Tra cứu 1 Mã Vận Đơn SPX Express siêu tốc (Chặn rác + Nhận diện phản hồi tức thì trong ~1s)
 */
export async function trackSPXOnPage(page: any, trackingNo: string): Promise<WaybillTrackingResult> {
  const cleanTrackingNo = trackingNo.trim().toUpperCase();

  // 1. Kiểm tra Cache RAM (0.001s)
  const cached = memoryCache.get(cleanTrackingNo);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    logger.info(`[CACHE HIT] Phan hoi RAM 0.001s cho ma: ${cleanTrackingNo}`);
    return cached.data;
  }

  logger.info(`Dang tra cuu SPX ma: ${cleanTrackingNo}`);

  try {
    // Tải trang SPX không hình ảnh -> Cực nhanh 0.3s
    await page.goto('https://spx.vn/vi', { waitUntil: 'commit', timeout: 8000 }).catch(() => {});

    const input = page.locator('input').first();
    if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
      await input.fill(cleanTrackingNo);

      const trackBtn = page.locator('button:has-text("Theo dõi"), button:has-text("Track")').first();
      if (await trackBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await trackBtn.click();
      } else {
        await page.keyboard.press('Enter');
      }

      // Đợi đến khi mốc thời gian xuất hiện (định dạng HH:MM:SS) hoặc từ khóa trạng thái
      await page.waitForFunction(
        () => {
          const body = document.body.innerText || '';
          return /\d{2}:\d{2}:\d{2}/.test(body) || body.includes('Giao hàng thành công') || body.includes('Đang giao hàng') || body.includes('không tồn tại');
        },
        null,
        { timeout: 7000 }
      ).catch(() => {});
    }

    let bodyText = await page.innerText('body');

    if (
      bodyText.includes('Giao hàng thành công') ||
      bodyText.includes('Đang giao hàng') ||
      bodyText.includes('Đơn hàng') ||
      bodyText.includes('Chờ lấy hàng') ||
      /\d{2}:\d{2}:\d{2}/.test(bodyText)
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
 * Tra cứu HÀNG LOẠT song song siêu tốc 16 luồng
 */
export async function trackMultipleSPXWaybills(
  trackingNumbers: string[]
): Promise<WaybillTrackingResult[]> {
  if (!trackingNumbers || trackingNumbers.length === 0) return [];

  const cpus = os.cpus().length || 8;
  const maxConcurrency = Math.min(cpus, 16);

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
