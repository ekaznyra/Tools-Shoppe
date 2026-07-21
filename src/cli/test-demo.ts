import { createPersistentSession, closeSession } from '../lib/browser/index.ts';
import { parseOrderList } from '../lib/order-parser/index.ts';
import { saveOrdersToDatabase, findOrders } from '../lib/database/index.ts';
import { exportToExcel, exportToCsv } from '../lib/export/index.ts';
import { logger } from '../lib/logging/index.ts';

async function runDemoTest() {
  logger.info('================================================================');
  logger.info('   DEMO TEST: THỬ NGHIỆM ĐỒNG BỘ ĐƠN HÀNG SHOPEE SELLER CENTRE   ');
  logger.info('================================================================');

  let session;
  try {
    // 1. Khởi tạo Persistent Context
    session = await createPersistentSession('./shopee_user_data', false);
    const { page } = session;

    // 2. Tạo trang mẫu giả lập giao diện Shopee Seller Centre để kiểm tra bóc tách
    logger.info('Đang nạp trang thử nghiệm chứa dữ liệu đơn hàng Shopee mẫu...');
    await page.setContent(`
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <meta charset="UTF-8">
        <title>Quản lý đơn hàng - Shopee Seller Centre</title>
        <style>
          body { font-family: sans-serif; padding: 20px; background: #f5f5f5; }
          .order-item { background: white; margin-bottom: 15px; padding: 15px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
          .order-sn { font-weight: bold; color: #ee4d2d; }
          .order-status { float: right; color: #26aa99; font-weight: bold; }
          .product-name { font-size: 16px; margin: 8px 0; color: #333; }
          .sku-code { color: #888; font-size: 13px; }
          .item-quantity { font-weight: bold; }
          .total-price { color: #ee4d2d; font-size: 18px; font-weight: bold; }
          .shipping-carrier { color: #555; }
          .shipping-status { color: #17a2b8; }
        </style>
      </head>
      <body>
        <h1 class="shopee-seller-portal">Quản lý đơn hàng</h1>
        <div class="order-list" data-testid="order-list">

          <div class="order-item" data-testid="order-card">
            <span class="order-status" data-testid="order-status">Hoàn thành</span>
            <div class="order-sn" data-testid="order-sn">Mã đơn: 240722SPK1092A</div>
            <div class="product-name" data-testid="product-name">Áo Thun Nam Cotton Cao Cấp Co Giãn 4 Chiều (Khách hàng: Nguyễn Văn A, SĐT: 0912345678)</div>
            <div class="sku-code" data-testid="sku-code">SKU: AT-COTTON-L-BLACK</div>
            <div>Số lượng: <span class="item-quantity" data-testid="item-quantity">x2</span></div>
            <div>Tổng thanh toán: <span class="total-price" data-testid="total-amount">299.000 ₫</span></div>
            <div>Đơn vị vận chuyển: <span class="shipping-carrier" data-testid="shipping-carrier">SPX Express</span></div>
            <div>Trạng thái giao: <span class="shipping-status" data-testid="shipping-status">Đã giao thành công</span></div>
          </div>

          <div class="order-item" data-testid="order-card">
            <span class="order-status" data-testid="order-status">Đang giao</span>
            <div class="order-sn" data-testid="order-sn">Mã đơn: 240722SPK8832B</div>
            <div class="product-name" data-testid="product-name">Giày Sneaker Thể Thao Nam Phong Cách Hàn Quốc (Khách hàng: Trần Thị B, SĐT: 0987654321)</div>
            <div class="sku-code" data-testid="sku-code">SKU: SNK-KR-42-WHITE</div>
            <div>Số lượng: <span class="item-quantity" data-testid="item-quantity">x1</span></div>
            <div>Tổng thanh toán: <span class="total-price" data-testid="total-amount">450.000 ₫</span></div>
            <div>Đơn vị vận chuyển: <span class="shipping-carrier" data-testid="shipping-carrier">Giao Hàng Nhanh (GHN)</span></div>
            <div>Trạng thái giao: <span class="shipping-status" data-testid="shipping-status">Đang vận chuyển</span></div>
          </div>

        </div>
      </body>
      </html>
    `);

    // 3. Tiến hành bóc tách dữ liệu
    logger.info('Tiến hành bóc tách đơn hàng từ giao diện...');
    const orders = await parseOrderList(page, { maxPages: 1 });

    logger.info('----------------------------------------------------------------');
    logger.info(`Đã bóc tách thành công ${orders.length} đơn hàng:`);
    console.dir(orders, { depth: null, colors: true });
    logger.info('----------------------------------------------------------------');

    // 4. Lưu đơn hàng vào CSDL
    const dbResult = await saveOrdersToDatabase(orders);
    logger.info(`Lưu CSDL: Thành công ${dbResult.syncedCount} đơn.`);

    // 5. Thử nghiệm tìm kiếm theo SKU
    const searchResults = await findOrders('AT-COTTON');
    logger.info(`Kết quả tìm kiếm CSDL với từ khóa 'AT-COTTON': ${searchResults.length} đơn tìm thấy.`);

    // 6. Xuất file báo cáo Excel & CSV
    const excelPath = await exportToExcel(orders);
    const csvPath = await exportToCsv(orders);
    
    logger.info(`File Excel đã được tạo tại: ${excelPath}`);
    logger.info(`File CSV đã được tạo tại: ${csvPath}`);

    // Giữ trình duyệt 5 giây để quan sát
    logger.info('Chờ 5 giây quan sát trình duyệt Chrome...');
    await page.waitForTimeout(5000);

  } catch (error: any) {
    logger.error({ error: error.message }, 'Lỗi trong quá trình chạy thử nghiệm');
  } finally {
    if (session) {
      await closeSession(session);
    }
    logger.info('Hoàn tất thử nghiệm demo.');
  }
}

runDemoTest();
