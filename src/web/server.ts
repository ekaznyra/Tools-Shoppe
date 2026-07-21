import http from 'http';
import fs from 'fs';
import path from 'path';
import { findOrders } from '../lib/database/index.ts';
import { exportToExcel } from '../lib/export/index.ts';
import { trackUniversalWaybill } from '../lib/multi-carrier-tracker/index.ts';
import { logger } from '../lib/logging/index.ts';

const PORT = process.env.PORT || 3000;

export function startWebServer(port: number = Number(PORT)) {
  const publicDir = path.resolve(process.cwd(), 'public');
  const htmlPath = path.join(publicDir, 'index.html');

  const server = http.createServer(async (req, res) => {
    const url = req.url || '/';

    // 1. Serve Web Dashboard UI
    if (url === '/' || url === '/index.html') {
      if (fs.existsSync(htmlPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(htmlPath).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Không tìm thấy file public/index.html');
      }
      return;
    }

    // 2. API Dashboard Stats & Orders
    if (url === '/api/stats' && req.method === 'GET') {
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

    // 3. API Tra Cứu Vận Đơn Ngay Trên Web
    if (url === '/api/track' && req.method === 'POST') {
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

    // 4. API Tải File Excel Tổng Hợp Đơn Hàng
    if (url === '/api/export' && req.method === 'GET') {
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

    // 404 Route
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Endpoint không tồn tại.');
  });

  server.listen(port, () => {
    logger.info(`====================================================`);
    logger.info(`🌐 WEB DASHBOARD DANG CHAY TAI: http://localhost:${port}`);
    logger.info(`====================================================`);
  });

  return server;
}
