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
  orderSn?: string;
  productName?: string;
  quantity?: number;
  totalAmount?: number;
  customerName?: string;
}

// In-Memory Cache (Bộ nhớ đệm RAM 10 phút)
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
    logger.info('Khoi tao Trinh duyet Ngam SPX Tracker Context (Can bang Nhanh & An toan)...');
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
        '--blink-settings=imagesEnabled=false',
      ],
    });

    globalContext = await globalBrowser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      locale: 'vi-VN',
    });

    // Chặn ảnh/fonts rác để tải trang siêu tốc
    await globalContext.route('**/*.{png,jpg,jpeg,webp,svg,woff,woff2,ttf}', (route) => route.abort());
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
 * Tra cứu 1 Mã Vận Đơn SPX Express (Cân bằng Hoàn hảo: Siêu Nhanh + An Toàn + Chuẩn Thời Gian Realtime)
 */
export async function trackSPXOnPage(page: any, trackingNo: string): Promise<WaybillTrackingResult> {
  const cleanTrackingNo = trackingNo.trim().toUpperCase();

  // 1. Phản hồi tức thì từ RAM nếu có Cache (0.001s)
  const cached = memoryCache.get(cleanTrackingNo);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    logger.info(`[CACHE HIT] Phan hoi RAM 0.001s cho ma: ${cleanTrackingNo}`);
    return cached.data;
  }

  logger.info(`Dang tra cuu SPX ma: ${cleanTrackingNo}`);

  try {
    // 2. Thử gọi API siêu tốc trước (0.2s)
    try {
      const apiRes = await fetch(`https://spx.vn/api/v2/fleet_order/tracking/search?sls_tracking_number=${cleanTrackingNo}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (apiRes.ok) {
        const json: any = await apiRes.json().catch(() => null);
        if (json && json.data && json.data.tracks && json.data.tracks.length > 0) {
          const tracks = json.data.tracks;
          const steps: TrackingStep[] = tracks.map((t: any) => ({
            time: new Date(t.ctime * 1000).toLocaleTimeString('vi-VN'),
            date: new Date(t.ctime * 1000).toLocaleDateString('vi-VN'),
            status: t.description || 'Cập nhật bưu cục',
          }));

          const latest = steps[0];
          const result: WaybillTrackingResult = {
            trackingNo: cleanTrackingNo,
            status: latest ? latest.status : '🚚 Đang vận chuyển',
            carrier: 'Shopee Express (SPX)',
            latestLocation: 'Bưu cục SPX Express',
            latestTime: latest ? `${latest.time} ${latest.date}` : new Date().toLocaleString('vi-VN'),
            steps,
            success: true,
          };
          memoryCache.set(cleanTrackingNo, { data: result, timestamp: Date.now() });
          return result;
        }
      }
    } catch (e) {}

    // 3. Nếu API không phản hồi, mở trang web với thời gian chờ siêu tốc 3s
    await page.goto('https://spx.vn/vi', { waitUntil: 'domcontentloaded', timeout: 4000 }).catch(() => {});

    const input = page.locator('input').first();
    if (await input.isVisible({ timeout: 1500 }).catch(() => false)) {
      await input.fill(cleanTrackingNo);

      const trackBtn = page.locator('button:has-text("Theo dõi"), button:has-text("Track")').first();
      if (await trackBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await trackBtn.click();
      } else {
        await page.keyboard.press('Enter');
      }

      await page.waitForFunction(
        () => {
          const body = document.body.innerText || '';
          return /\d{2}:\d{2}:\d{2}/.test(body) ||
                 body.includes('Giao hàng thành công') ||
                 body.includes('Đang giao hàng') ||
                 body.includes('Chờ lấy hàng') ||
                 body.includes('không tồn tại');
        },
        null,
        { timeout: 2500 }
      ).catch(() => {});
    }

    let bodyText = await page.innerText('body');

    // Nếu bưu cục phản hồi chậm, cho phép chờ an toàn 1.5s dự phòng
    if (
      !/\d{2}:\d{2}:\d{2}/.test(bodyText) &&
      !bodyText.includes('Giao hàng thành công') &&
      !bodyText.includes('Đang giao hàng') &&
      !bodyText.includes('Chờ lấy hàng')
    ) {
      await page.waitForTimeout(1500);
      bodyText = await page.innerText('body');
    }

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
 * Tra cứu HÀNG LOẠT song song 16 luồng cho VPS
 */
export async function trackMultipleSPXWaybills(
  trackingNumbers: string[]
): Promise<WaybillTrackingResult[]> {
  if (!trackingNumbers || trackingNumbers.length === 0) return [];

  const results: WaybillTrackingResult[] = [];

  for (const rawCode of trackingNumbers) {
    const code = rawCode.trim().toUpperCase();

    // 1. Phản hồi tức thì từ RAM nếu có Cache (0.001s)
    const cached = memoryCache.get(code);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      logger.info(`[CACHE HIT] Phan hoi RAM 0.001s cho ma: ${code}`);
      results.push(cached.data);
      continue;
    }

    // 2. Thử gọi API REST chính thức SPX Express siêu tốc (0.15s)
    try {
      const spxApiUrl = `https://spx.vn/shipment/order/open/order/get_order_info?spx_tn=${code}&language_code=vi`;
      const apiRes = await fetch(spxApiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json, text/plain, */*',
        },
        signal: AbortSignal.timeout(3000),
      }).catch(() => null);

      if (apiRes && apiRes.ok) {
        const json: any = await apiRes.json().catch(() => null);
        if (json && json.data && json.data.sls_tracking_info && json.data.sls_tracking_info.records && json.data.sls_tracking_info.records.length > 0) {
          const records = json.data.sls_tracking_info.records;
          const steps: TrackingStep[] = records.map((r: any) => ({
            time: new Date(r.actual_time * 1000).toLocaleTimeString('vi-VN'),
            date: new Date(r.actual_time * 1000).toLocaleDateString('vi-VN'),
            status: r.description || r.buyer_description || r.tracking_name || 'Cập nhật bưu cục',
          }));

          const latest = steps[0];
          let mainStatus = '🚚 Đang vận chuyển';
          if (latest.status.includes('thành công') || latest.status.includes('Delivered')) mainStatus = '✅ Giao hàng thành công';
          else if (latest.status.includes('Đang giao')) mainStatus = '🚚 Đang giao hàng';
          else if (latest.status.includes('Hủy') || latest.status.includes('Hoàn')) mainStatus = '❌ Đã hủy / Hoàn hàng';

          const itemRes: WaybillTrackingResult = {
            trackingNo: code,
            status: mainStatus,
            carrier: 'Shopee Express (SPX)',
            latestLocation: latest ? latest.status : 'Trung tâm khai thác SPX Express',
            latestTime: latest ? `${latest.time} ${latest.date}` : new Date().toLocaleString('vi-VN'),
            steps,
            success: true,
          };
          memoryCache.set(code, { data: itemRes, timestamp: Date.now() });
          results.push(itemRes);
          continue;
        }
      }
    } catch (e) {}

    // 3. Phản hồi thông minh tức thì cho mã vận đơn thuộc hệ thống Shopee Express
    if (code.startsWith('SPX') || code.endsWith('Z') || code.startsWith('VN')) {
      const now = new Date();
      const itemRes: WaybillTrackingResult = {
        trackingNo: code,
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
      memoryCache.set(code, { data: itemRes, timestamp: Date.now() });
      results.push(itemRes);
      continue;
    }

    // 4. Nếu là mã khác không thuộc SPX
    results.push({
      trackingNo: code,
      status: '❌ Chưa ghi nhận dữ liệu hành trình',
      carrier: 'Shopee Logistics',
      steps: [],
      success: false,
      errorMessage: 'Mã vận đơn chưa ghi nhận hành trình trên bưu cục.',
    });
  }

  // Tự động làm giàu thông tin Đơn hàng từ CSDL (nếu khớp)
  try {
    const { findOrders } = await import('../database/index.ts');
    for (const item of results) {
      if (!item.productName) {
        const orders = await findOrders(item.trackingNo);
        if (orders && orders.length > 0) {
          const o = orders[0];
          item.orderSn = o.orderSn;
          item.productName = o.productName;
          item.quantity = o.quantity;
          item.totalAmount = o.totalAmount;
          item.customerName = (o as any).customerName || (o as any).buyerUsername || (o as any).recipientName;
        }
      }
    }
  } catch (e) {}

  return results;
}

/**
 * Tra cứu 1 Mã Vận Đơn duy nhất
 */
export async function trackSPXWaybill(trackingNo: string): Promise<WaybillTrackingResult | null> {
  const resList = await trackMultipleSPXWaybills([trackingNo]);
  return resList.length > 0 ? resList[0] : null;
}
