import { createPersistentSession, closeSession } from '../lib/browser/index.ts';
import { checkAuthStatus } from '../lib/authentication/index.ts';
import { parseOrderList } from '../lib/order-parser/index.ts';
import { saveOrdersToDatabase } from '../lib/database/index.ts';
import { exportToExcel } from '../lib/export/index.ts';
import { logger } from '../lib/logging/index.ts';

async function main() {
  logger.info('==================================================');
  logger.info('   KHỞI CHẠY TOOL KIỂM TRA ĐƠN HÀNG SHOPEE SELLER   ');
  logger.info('==================================================');

  let session;
  try {
    // 1. Khởi tạo Persistent Browser Context
    session = await createPersistentSession();

    // 2. Kiểm tra trạng thái đăng nhập
    const authStatus = await checkAuthStatus(session.page);

    if (!authStatus.isLoggedIn) {
      logger.error('--------------------------------------------------');
      logger.error(`[LỖI PHIÊN ĐĂNG NHẬP]: ${authStatus.errorMessage}`);
      logger.error('Vui lòng thực hiện các bước sau:');
      logger.error(' 1. Cửa sổ trình duyệt Chromium đã được mở.');
      logger.error(' 2. Đăng nhập thủ công tài khoản Shopee Seller của bạn.');
      logger.error(' 3. Nhập xong OTP / Mật khẩu (nếu có).');
      logger.error(' 4. Chạy lại lệnh `npm run sync` để bắt đầu đồng bộ.');
      logger.error('--------------------------------------------------');
      
      logger.info('Chờ 15 giây để bạn quan sát cửa sổ trình duyệt...');
      await session.page.waitForTimeout(15000);
      return;
    }

    // 3. Tiến hành bóc tách đơn hàng từ Seller Centre
    logger.info('Đã xác nhận phiên làm việc hợp lệ. Tiến hành đọc danh sách đơn hàng...');
    const orders = await parseOrderList(session.page, {
      maxPages: 3,
      delayMinMs: 1500,
      delayMaxMs: 3000,
    });

    if (orders.length === 0) {
      logger.warn('Không tìm thấy đơn hàng nào trong lần quét này.');
      return;
    }

    // 4. Lưu đơn hàng vào CSDL
    const dbResult = await saveOrdersToDatabase(orders);
    logger.info(`Kết quả đồng bộ CSDL: Thành công ${dbResult.syncedCount} đơn.`);

    // 5. Xuất file báo cáo
    const excelPath = await exportToExcel(orders);
    logger.info(`File báo cáo đã sẵn sàng: ${excelPath}`);

  } catch (error: any) {
    logger.error({ error: error.message }, 'Lỗi hệ thống trong quá trình đồng bộ');
  } finally {
    if (session) {
      await closeSession(session);
    }
    logger.info('Hoàn tất tiến trình.');
  }
}

main();
