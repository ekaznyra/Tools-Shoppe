import type { Page } from 'playwright';
import type { ShopeeOrderRaw, SyncOptions } from '../../types/index.ts';
import { logger, maskSensitiveData } from '../logging/index.ts';

/**
 * Tạo độ trễ ngẫu nhiên giữa minMs và maxMs
 */
export async function randomDelay(page: Page, minMs: number = 1500, maxMs: number = 3000): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  logger.debug(`Delay ngau nhien ${delay}ms...`);
  await page.waitForTimeout(delay);
}

/**
 * Parser danh sách đơn hàng từ trang Shopee Seller Centre
 */
export async function parseOrderList(
  page: Page,
  options: SyncOptions = {}
): Promise<ShopeeOrderRaw[]> {
  const maxPages = options.maxPages || 5;
  const searchQuery = options.searchQuery || '';
  const orders: ShopeeOrderRaw[] = [];

  logger.info(`Bat dau thu thap don hang (Toi da ${maxPages} trang)...`);

  if (searchQuery) {
    logger.info(`Thuc hien tim kiem tren Shopee voi tu khoa: "${searchQuery}"`);
    
    // Đợi ô tìm kiếm xuất hiện
    const searchInput = page
      .locator('input[placeholder*="Tìm kiếm"], input[placeholder*="Mã đơn"], input[placeholder*="Mã vận đơn"], [role="searchbox"], .shopee-input input')
      .first();

    if (await searchInput.isVisible({ timeout: 10000 }).catch(() => false)) {
      await searchInput.click();
      await searchInput.fill('');
      await searchInput.fill(searchQuery);
      await randomDelay(page, 1000, 1500);
      await page.keyboard.press('Enter');
      
      logger.info('Da bam Enter tim kiem, dang cho Shopee cap nhat ket qua...');
      // Chờ Shopee tải và cập nhật DOM hoàn tất
      await page.waitForLoadState('networkidle').catch(() => {});
      await randomDelay(page, 3000, 4500);
    } else {
      logger.warn('Khong tim thay khung tim kiem tren giao dien Shopee!');
    }
  }

  let currentPage = 1;

  while (currentPage <= maxPages) {
    logger.info(`Dang boc tach du lieu tai trang ${currentPage}/${maxPages}...`);

    // Selector mở rộng để bắt khớp đa dạng thẻ đơn hàng trên Shopee Seller Centre
    const orderCards = page.locator(
      '[data-testid="order-card"], [role="row"], .order-item, .shopee-seller-order-card, tr.shopee-table__row, .order-list-item'
    );

    let count = await orderCards.count();

    // Nếu chưa thấy, thử đợi thêm 2s cho AJAX render xong
    if (count === 0) {
      await page.waitForTimeout(2500);
      count = await orderCards.count();
    }

    if (count === 0) {
      logger.warn(`Khong tim thay don hang nào o trang ${currentPage}.` );
      
      const tableRows = page.locator('table tbody tr');
      const rowCount = await tableRows.count();

      if (rowCount === 0) {
        logger.info('Khong co don hang nao phu hop hoac danh sach trong.');
        break;
      }
    }

    logger.info(`Tim thay ${count} the/dong don hang tren trang ${currentPage}`);

    for (let i = 0; i < count; i++) {
      const card = orderCards.nth(i);

      try {
        const orderSnText = await card
          .locator('[data-testid="order-sn"], .order-sn, text=/Đơn hàng ID|Mã đơn|Order ID/i')
          .first()
          .innerText({ timeout: 3000 })
          .catch(() => '');

        const orderSnMatch = orderSnText.match(/[A-Z0-9]{10,24}/i);
        const orderSn = orderSnMatch ? orderSnMatch[0] : (searchQuery || `ORD-${Date.now()}-${i}`);

        const orderStatus = await card
          .locator('[data-testid="order-status"], .order-status, .status-text, .shopee-badge')
          .first()
          .innerText({ timeout: 2000 })
          .catch(() => 'Đang xử lý');

        const productNameRaw = await card
          .locator('[data-testid="product-name"], .product-name, .item-name, .order-item__name')
          .first()
          .innerText({ timeout: 2000 })
          .catch(() => 'Sản phẩm Shopee');

        const productName = maskSensitiveData(productNameRaw.trim());

        const skuText = await card
          .locator('[data-testid="sku-code"], .sku-code, text=/SKU/i')
          .first()
          .innerText({ timeout: 2000 })
          .catch(() => '');
        
        const sku = skuText.replace(/SKU\s*:\s*/i, '').trim();

        const quantityText = await card
          .locator('[data-testid="item-quantity"], .item-quantity, text=/x\d+/')
          .first()
          .innerText({ timeout: 2000 })
          .catch(() => '1');
        const quantityMatch = quantityText.match(/\d+/);
        const quantity = quantityMatch ? parseInt(quantityMatch[0], 10) : 1;

        const totalAmountText = await card
          .locator('[data-testid="total-amount"], .total-price, .order-total, .amount')
          .first()
          .innerText({ timeout: 2000 })
          .catch(() => '0');
        
        const totalAmountParsed = parseFloat(totalAmountText.replace(/[^\d]/g, '')) || 0;

        const shippingCarrier = await card
          .locator('[data-testid="shipping-carrier"], .shipping-carrier, .logistics-name')
          .first()
          .innerText({ timeout: 2000 })
          .catch(() => 'Shopee Express');

        const shippingStatus = await card
          .locator('[data-testid="shipping-status"], .shipping-status, .logistics-status')
          .first()
          .innerText({ timeout: 2000 })
          .catch(() => 'Đang vận chuyển');

        const parsedOrder: ShopeeOrderRaw = {
          orderSn: orderSn.trim(),
          orderStatus: orderStatus.trim(),
          createdAtShopee: new Date().toISOString(),
          productName,
          sku,
          quantity,
          totalAmount: totalAmountParsed,
          shippingCarrier: shippingCarrier.trim(),
          shippingStatus: shippingStatus.trim(),
        };

        orders.push(parsedOrder);
      } catch (err: any) {
        logger.error({ error: err.message, index: i }, 'Loi khi boc tach thong tin 1 don hang');
      }
    }

    const nextBtn = page.locator('button.shopee-icon-button--right, button[aria-label="Next Page"], [data-testid="pagination-next"]').first();
    
    const isNextEnabled = await nextBtn.isEnabled().catch(() => false);
    if (isNextEnabled && currentPage < maxPages) {
      logger.info(`Chuyen sang trang ${currentPage + 1}...`);
      await nextBtn.click();
      await randomDelay(page, options.delayMinMs, options.delayMaxMs);
      currentPage++;
    } else {
      logger.info('Da toi trang cuoi cung hoac het trang can duyet.');
      break;
    }
  }

  logger.info(`Boc tach hoan tat! Tong cong da thu thap ${orders.length} don hang.`);
  return orders;
}
