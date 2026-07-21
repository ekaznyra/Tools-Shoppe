import http from 'http';
import fs from 'fs';
import path from 'path';
import { findOrders, saveOrdersToDatabase } from '../lib/database/index.ts';
import { exportToExcel } from '../lib/export/index.ts';
import { trackUniversalWaybill } from '../lib/multi-carrier-tracker/index.ts';
import { trackMultipleSPXWaybills, extractWaybillsFromText } from '../lib/spx-tracker/index.ts';
import { analyzeDeliveryAlerts } from '../lib/alert-scanner/index.ts';
import { generateQRCodeSVG } from '../lib/qr-generator/index.ts';
import {
  getLatestVouchers,
  getHotVouchers,
  getShopTargets,
  addShopTarget,
  removeShopTarget,
  scanVouchersFromUrl,
  saveDiscoveredVouchers,
} from '../lib/voucher-scanner/index.ts';
import { logger } from '../lib/logging/index.ts';

const PORT = process.env.PORT || 3000;

export function startWebServer(port: number = Number(PORT)) {
  const publicDir = path.resolve(process.cwd(), 'public');
  const htmlPath = path.join(publicDir, 'index.html');

  const server = http.createServer(async (req, res) => {
    const rawUrl = req.url || '/';
    const parsedUrl = new URL(rawUrl, `http://localhost:${port}`);
    const pathname = parsedUrl.pathname;

    // 1. Serve Web Dashboard UI (hỗ trợ cả đường dẫn xem công khai)
    if (pathname === '/' || pathname === '/index.html' || pathname === '/public-track') {
      if (fs.existsSync(htmlPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(htmlPath).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Không tìm thấy file public/index.html');
      }
      return;
    }

    // 2. API Sinh Mã QR Code Vector SVG Siêu Sắc Nét
    if (pathname === '/api/qr' && req.method === 'GET') {
      const text = parsedUrl.searchParams.get('text') || parsedUrl.searchParams.get('code') || 'SPXVN000';
      const size = Number(parsedUrl.searchParams.get('size')) || 220;
      const svg = generateQRCodeSVG(text, size);

      res.writeHead(200, {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(svg);
      return;
    }

    // 3. API Tra Cứu Vận Đơn Ngay Trên Web
    if (pathname === '/api/track' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const trackingNo = parsed.trackingNo;

          if (!trackingNo) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, errorMessage: 'Thiếu mã vận đơn.' }));
            return;
          }

          const result = await trackUniversalWaybill(trackingNo);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(result));
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, errorMessage: e.message }));
        }
      });
      return;
    }

    // 4. API Kéo Thả Import Excel & Tra Cứu Hàng Loạt
    if (pathname === '/api/import-excel' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const contentText = parsed.content || parsed.text || '';
          const codes = extractWaybillsFromText(contentText);

          if (!codes || codes.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, errorMessage: 'Không tìm thấy mã vận đơn hợp lệ trong file.' }));
            return;
          }

          logger.info(`Web UI Import Excel: Dang quet ${codes.length} ma van don...`);
          const results = await trackMultipleSPXWaybills(codes);

          // Cảnh báo khẩn cấp từ danh sách import
          const alerts = analyzeDeliveryAlerts(results);

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: true,
            totalFound: codes.length,
            results,
            alerts,
          }));
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, errorMessage: e.message }));
        }
      });
      return;
    }

    // 5. API Cảnh Báo Khẩn Cấp (Delivery Alert Scanner)
    if (pathname === '/api/alerts' && req.method === 'GET') {
      try {
        const orders = (await findOrders()) || [];
        const alertsCount = orders.filter((o: any) =>
          (o.orderStatus || '').includes('thất bại') ||
          (o.orderStatus || '').includes('hủy') ||
          (o.shippingStatus || '').includes('không thành công')
        ).length;

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, alertsCount, orders }));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, errorMessage: e.message }));
      }
      return;
    }

    // 6. API Dashboard Stats & Orders
    if (pathname === '/api/stats' && req.method === 'GET') {
      try {
        const orders = (await findOrders()) || [];
        const deliveredOrders = orders.filter((o: any) => (o.orderStatus || '').includes('thành công') || (o.orderStatus || '').includes('Đã giao')).length;
        const shippingOrders = orders.filter((o: any) => (o.orderStatus || '').includes('giao') || (o.orderStatus || '').includes('chuyển')).length;
        const alertsCount = orders.filter((o: any) => (o.orderStatus || '').includes('thất bại') || (o.orderStatus || '').includes('hủy')).length;

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            totalOrders: orders.length,
            deliveredOrders,
            shippingOrders,
            alertsCount,
            orders,
          })
        );
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // 7. API Tải File Excel Tổng Hợp Đơn Hàng
    if (pathname === '/api/export' && req.method === 'GET') {
      try {
        const orders = (await findOrders()) || [];
        const filePath = await exportToExcel(orders);

        if (fs.existsSync(filePath)) {
          const filename = path.basename(filePath);
          res.writeHead(200, {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="${filename}"`,
          });
          fs.createReadStream(filePath).pipe(res);
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Lỗi xuất file Excel.');
        }
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(e.message);
      }
      return;
    }

    // 8. API Lấy Danh Sách Voucher Shopee
    if (pathname === '/api/vouchers' && req.method === 'GET') {
      try {
        const vouchers = await getLatestVouchers(50);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, vouchers }));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, errorMessage: e.message }));
      }
      return;
    }

    if (pathname === '/api/vouchers/hot' && req.method === 'GET') {
      try {
        const vouchers = await getHotVouchers(20);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, vouchers }));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, errorMessage: e.message }));
      }
      return;
    }

    // 9. API Lấy Danh Sách & Quản Lý Shop Theo Dõi Voucher
    if (pathname === '/api/voucher-shops') {
      if (req.method === 'GET') {
        try {
          const shops = await getShopTargets();
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, shops }));
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, errorMessage: e.message }));
        }
        return;
      }

      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const parsed = JSON.parse(body || '{}');
            const shopUrl = parsed.shopUrl;
            if (!shopUrl) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, errorMessage: 'Thiếu shopUrl' }));
              return;
            }

            const shop = await addShopTarget(shopUrl, 'WEB_UI');
            const rawVouchers = await scanVouchersFromUrl(shop.shopUrl);
            const newVouchers = await saveDiscoveredVouchers(rawVouchers);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, shop, newVouchersFound: newVouchers.length }));
          } catch (e: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, errorMessage: e.message }));
          }
        });
        return;
      }

      if (req.method === 'DELETE') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const parsed = JSON.parse(body || '{}');
            const shopId = parsed.shopId || parsed.shopUrl;
            if (!shopId) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, errorMessage: 'Thiếu shopId' }));
              return;
            }

            const ok = await removeShopTarget(shopId);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: ok }));
          } catch (e: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, errorMessage: e.message }));
          }
        });
        return;
      }
    }


    // 404 Route
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Endpoint không tồn tại.');
  });

  server.listen(port, () => {
    logger.info(`====================================================`);
    logger.info(`🌐 WEB DASHBOARD DANG CHAY TAI: http://localhost:${port}`);
    logger.info(`====================================================`);
  });

  return server;
}
