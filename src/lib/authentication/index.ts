import type { Page } from 'playwright';
import type { AuthStatus } from '../../types/index.ts';
import { logger } from '../logging/index.ts';

const SHOPEE_SELLER_URL = process.env.SHOPEE_SELLER_URL || 'https://seller.shopee.vn/portal/sale/order?type=all';

/**
 * Kiểm tra trạng thái đăng nhập vào Shopee Seller Centre.
 */
export async function checkAuthStatus(page: Page, timeoutMs: number = 10000): Promise<AuthStatus> {
  logger.info(`Dang dieu huong den Shopee Seller Centre: ${SHOPEE_SELLER_URL}`);

  try {
    await page.goto(SHOPEE_SELLER_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const currentUrl = page.url();
    logger.info(`URL hien tai: ${currentUrl}`);

    if (currentUrl.includes('/account/signin') || currentUrl.includes('/login') || currentUrl.includes('/seller/login')) {
      logger.warn('Session het han hoac chua dang nhap Shopee Seller Centre!');
      return {
        isLoggedIn: false,
        errorMessage: 'Chưa đăng nhập Shopee Seller Centre.',
      };
    }

    const isOrderListVisible = await page
      .locator('.shopee-seller-portal, [data-testid="order-list"], text="Quản lý đơn hàng"')
      .first()
      .isVisible({ timeout: timeoutMs })
      .catch(() => false);

    if (isOrderListVisible || currentUrl.includes('/portal/sale/order')) {
      logger.info('Xac nhan dang nhap thanh cong vao Shopee Seller Centre.');
      return { isLoggedIn: true };
    }

    return {
      isLoggedIn: false,
      errorMessage: 'Chưa thấy giao diện quản lý đơn hàng Shopee.',
    };
  } catch (err: any) {
    logger.error({ error: err.message }, 'Loi khi kiem tra dang nhap Shopee');
    return {
      isLoggedIn: false,
      errorMessage: `Lỗi kết nối: ${err.message}`,
    };
  }
}

/**
 * Chờ người dùng tự hoàn tất đăng nhập trên trình duyệt Chrome trong tối đa timeoutMs (mặc định 3 phút)
 */
export async function waitForUserLogin(page: Page, timeoutMs: number = 180000): Promise<boolean> {
  logger.info(`Dang cho nguoi dung dang nhap Shopee tren cua so Chrome (Toi da ${Math.round(timeoutMs/1000)}s)...`);
  try {
    const success = await page.waitForFunction(
      () => {
        const href = window.location.href;
        return href.includes('/portal/sale/order') && !href.includes('/login') && !href.includes('/signin');
      },
      null,
      { timeout: timeoutMs }
    );
    if (success) {
      logger.info('Xac nhan nguoi dung da dang nhap Shopee thanh cong!');
      await page.waitForTimeout(3000);
      return true;
    }
  } catch (e) {
    logger.warn('Het thoi gian cho nguoi dung dang nhap Shopee.');
  }
  return false;
}
