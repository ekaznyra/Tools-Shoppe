import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import type { ShopeeOrderRaw } from '../../types/index.ts';
import type { WaybillTrackingResult } from '../spx-tracker/index.ts';
import { logger } from '../logging/index.ts';

const require = createRequire(import.meta.url);

/**
 * Xuất danh sách đơn hàng ra file Excel (.xlsx) hoặc CSV
 */
export async function exportToExcel(
  orders: ShopeeOrderRaw[],
  outputDir: string = './exports'
): Promise<string> {
  const absoluteDir = path.resolve(process.cwd(), outputDir);
  if (!fs.existsSync(absoluteDir)) {
    fs.mkdirSync(absoluteDir, { recursive: true });
  }

  try {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Danh sách đơn hàng');

    worksheet.columns = [
      { header: 'Mã Đơn Hàng', key: 'orderSn', width: 22 },
      { header: 'Trạng Thái Đơn', key: 'orderStatus', width: 18 },
      { header: 'Ngày Tạo Đơn', key: 'createdAtShopee', width: 22 },
      { header: 'Tên Sản Phẩm', key: 'productName', width: 35 },
      { header: 'SKU', key: 'sku', width: 18 },
      { header: 'Số Lượng', key: 'quantity', width: 10 },
      { header: 'Tổng Tiền (VNĐ)', key: 'totalAmount', width: 18 },
      { header: 'Đơn Vị Vận Chuyển', key: 'shippingCarrier', width: 20 },
      { header: 'Trạng Thái Giao', key: 'shippingStatus', width: 20 },
    ];

    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'EE4D2D' },
    };

    orders.forEach((order) => {
      worksheet.addRow({
        ...order,
        createdAtShopee: order.createdAtShopee
          ? new Date(order.createdAtShopee).toLocaleString('vi-VN')
          : '',
        totalAmount: order.totalAmount.toLocaleString('vi-VN'),
      });
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(absoluteDir, `Shopee_Orders_${timestamp}.xlsx`);

    await workbook.xlsx.writeFile(filePath);
    logger.info(`Da xuat file Excel thanh cong tai: ${filePath}`);
    return filePath;
  } catch {
    return exportToCsv(orders, outputDir);
  }
}

/**
 * Xuất báo cáo tra cứu Mã Vận Đơn hàng loạt ra Excel (.xlsx)
 */
export async function exportWaybillsToExcel(
  results: WaybillTrackingResult[],
  outputDir: string = './exports'
): Promise<string> {
  const absoluteDir = path.resolve(process.cwd(), outputDir);
  if (!fs.existsSync(absoluteDir)) {
    fs.mkdirSync(absoluteDir, { recursive: true });
  }

  try {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Tra cứu mã vận đơn');

    worksheet.columns = [
      { header: 'STT', key: 'stt', width: 8 },
      { header: 'Mã Vận Đơn', key: 'trackingNo', width: 24 },
      { header: 'Đơn Vị Vận Chuyển', key: 'carrier', width: 25 },
      { header: 'Trạng Thái Hiện Tại', key: 'status', width: 24 },
      { header: 'Hành Trình Mới Nhất', key: 'latestLocation', width: 45 },
      { header: 'Thời Gian Cập Nhật', key: 'latestTime', width: 22 },
      { header: 'Số Mốc Hành Trình', key: 'stepsCount', width: 18 },
    ];

    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'EE4D2D' },
    };

    results.forEach((res, idx) => {
      worksheet.addRow({
        stt: idx + 1,
        trackingNo: res.trackingNo,
        carrier: res.carrier,
        status: res.status,
        latestLocation: res.latestLocation || 'Chưa cập nhật',
        latestTime: res.latestTime || 'N/A',
        stepsCount: res.steps ? res.steps.length : 0,
      });
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(absoluteDir, `BaoCao_MaVanDon_${timestamp}.xlsx`);

    await workbook.xlsx.writeFile(filePath);
    logger.info(`Da xuat file Excel BaoCao_MaVanDon thanh cong tai: ${filePath}`);
    return filePath;
  } catch (e: any) {
    logger.error(`Loi khi tao file Excel Van Don: ${e.message}`);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(absoluteDir, `BaoCao_MaVanDon_${timestamp}.csv`);
    const csvLines = [
      'STT,Mã Vận Đơn,Đơn Vị Vận Chuyển,Trạng Thái,Hành Trình Mới Nhất,Thời Gian',
      ...results.map((r, i) => `${i + 1},"${r.trackingNo}","${r.carrier}","${r.status}","${r.latestLocation || ''}","${r.latestTime || ''}"`)
    ];
    fs.writeFileSync(filePath, '\uFEFF' + csvLines.join('\n'), 'utf-8');
    return filePath;
  }
}

/**
 * Xuất danh sách đơn hàng ra file CSV
 */
export async function exportToCsv(
  orders: ShopeeOrderRaw[],
  outputDir: string = './exports'
): Promise<string> {
  const absoluteDir = path.resolve(process.cwd(), outputDir);
  if (!fs.existsSync(absoluteDir)) {
    fs.mkdirSync(absoluteDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(absoluteDir, `Shopee_Orders_${timestamp}.csv`);

  const headers = [
    'Mã Đơn Hàng',
    'Trạng Thái Đơn',
    'Ngày Tạo Đơn',
    'Tên Sản Phẩm',
    'SKU',
    'Số Lượng',
    'Tổng Tiền (VNĐ)',
    'Đơn Vị Vận Chuyển',
    'Trạng Thái Giao',
  ];

  const rows = orders.map((o) => [
    `"${o.orderSn}"`,
    `"${o.orderStatus}"`,
    `"${o.createdAtShopee || ''}"`,
    `"${o.productName.replace(/"/g, '""')}"`,
    `"${o.sku || ''}"`,
    o.quantity,
    o.totalAmount,
    `"${o.shippingCarrier || ''}"`,
    `"${o.shippingStatus || ''}"`,
  ]);

  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

  fs.writeFileSync(filePath, '\uFEFF' + csvContent, 'utf-8');
  logger.info(`Da xuat file CSV thanh cong tai: ${filePath}`);

  return filePath;
}
