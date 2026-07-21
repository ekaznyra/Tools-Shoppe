import type { BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { logger } from '../logging/index.ts';

const require = createRequire(import.meta.url);

let chromium: any;
try {
  chromium = require('playwright').chromium;
} catch (e: any) {
  logger.error({ error: e.message }, 'Khong the tai goi playwright. Vui long chay `npm install` truuoc.');
  throw e;
}

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
}

/**
 * Tìm executablePath của Google Chrome hoặc Microsoft Edge trên máy người dùng
 */
function findSystemBrowserExecutable(): string | undefined {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

  if (fs.existsSync(chromePath)) {
    logger.info(`Su dung trinh duyet Google Chrome: ${chromePath}`);
    return chromePath;
  }
  if (fs.existsSync(edgePath)) {
    logger.info(`Su dung trinh duyet Microsoft Edge: ${edgePath}`);
    return edgePath;
  }
  return undefined;
}

/**
 * Khởi tạo persistent browser context để lưu trữ đăng nhập cục bộ trên máy người dùng.
 */
export async function createPersistentSession(
  userDataDirRelative: string = process.env.USER_DATA_DIR || './shopee_user_data',
  headless: boolean = process.env.HEADLESS === 'true'
): Promise<BrowserSession> {
  const absoluteDataDir = path.resolve(process.cwd(), userDataDirRelative);

  if (!fs.existsSync(absoluteDataDir)) {
    fs.mkdirSync(absoluteDataDir, { recursive: true });
    logger.info(`Da tao thu muc luu truu persistent context: ${absoluteDataDir}`);
  }

  const executablePath = findSystemBrowserExecutable();
  logger.info(`Khoi chay Browser Persistent Context tai: ${absoluteDataDir}`);

  const launchOptions: any = {
    headless,
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
  };

  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }

  const context = await chromium.launchPersistentContext(absoluteDataDir, launchOptions);

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  return { context, page };
}

/**
 * Đóng browser context an toàn
 */
export async function closeSession(session: BrowserSession): Promise<void> {
  try {
    await session.context.close();
    logger.info('Da dong Browser Context an toan.');
  } catch (error) {
    logger.error({ error }, 'Loi khi dong Browser Context');
  }
}
