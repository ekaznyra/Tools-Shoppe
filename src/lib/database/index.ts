import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import type { ShopeeOrderRaw, SyncResult } from '../../types/index.ts';
import { logger } from '../logging/index.ts';

const require = createRequire(import.meta.url);

let prismaClient: any = null;
try {
  const { PrismaClient } = require('@prisma/client');
  prismaClient = new PrismaClient();
} catch {
  logger.warn('Chua khoi tao Prisma Client. Dang su dung che do luu CSDL backup.');
}

const LOCAL_DB_PATH = path.resolve(process.cwd(), './shopee_orders_backup.json');

export const prisma = prismaClient;

/**
 * Lưu danh sách đơn hàng bóc tách được vào CSDL
 */
export async function saveOrdersToDatabase(orders: ShopeeOrderRaw[]): Promise<SyncResult> {
  let syncedCount = 0;
  let errorCount = 0;

  logger.info(`Dang luu ${orders.length} don hang vao CSDL...`);

  if (prismaClient) {
    for (const order of orders) {
      try {
        await prismaClient.order.upsert({
          where: { orderSn: order.orderSn },
          update: {
            orderStatus: order.orderStatus,
            productName: order.productName,
            sku: order.sku || '',
            quantity: order.quantity,
            totalAmount: order.totalAmount,
            shippingCarrier: order.shippingCarrier || '',
            shippingStatus: order.shippingStatus || '',
            syncedAt: new Date(),
          },
          create: {
            orderSn: order.orderSn,
            orderStatus: order.orderStatus,
            createdAtShopee: order.createdAtShopee ? new Date(order.createdAtShopee) : new Date(),
            productName: order.productName,
            sku: order.sku || '',
            quantity: order.quantity,
            totalAmount: order.totalAmount,
            shippingCarrier: order.shippingCarrier || '',
            shippingStatus: order.shippingStatus || '',
          },
        });
        syncedCount++;
      } catch (error: any) {
        errorCount++;
        logger.error({ error: error.message, orderSn: order.orderSn }, 'Loi khi luu don hang vao SQLite');
      }
    }
  } else {
    try {
      let existing: ShopeeOrderRaw[] = [];
      if (fs.existsSync(LOCAL_DB_PATH)) {
        existing = JSON.parse(fs.readFileSync(LOCAL_DB_PATH, 'utf-8'));
      }
      
      const orderMap = new Map(existing.map(o => [o.orderSn, o]));
      orders.forEach(o => orderMap.set(o.orderSn, o));
      
      fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(Array.from(orderMap.values()), null, 2), 'utf-8');
      syncedCount = orders.length;
      logger.info(`Da luu ${syncedCount} don hang vao CSDL cuc bo: ${LOCAL_DB_PATH}`);
    } catch (e: any) {
      errorCount = orders.length;
      logger.error(`Loi khi ghi file CSDL du phong: ${e.message}`);
    }
  }

  return {
    success: errorCount === 0,
    syncedCount,
    errorCount,
  };
}

/**
 * Tìm kiếm đơn hàng trong CSDL theo Mã đơn hoặc SKU
 */
export async function findOrders(query?: string) {
  if (prismaClient) {
    try {
      if (!query || query.trim() === '') {
        return await prismaClient.order.findMany({ orderBy: { syncedAt: 'desc' }, take: 100 });
      }
      const cleanQuery = query.trim();
      return await prismaClient.order.findMany({
        where: {
          OR: [
            { orderSn: { contains: cleanQuery } },
            { sku: { contains: cleanQuery } },
            { productName: { contains: cleanQuery } },
          ],
        },
        orderBy: { syncedAt: 'desc' },
      });
    } catch (err: any) {
      logger.warn({ error: err.message }, 'Loi truy van Prisma SQLite, chuyen sang dung CSDL du phong.');
    }
  }

  if (fs.existsSync(LOCAL_DB_PATH)) {
    try {
      const data: ShopeeOrderRaw[] = JSON.parse(fs.readFileSync(LOCAL_DB_PATH, 'utf-8'));
      if (!query) return data;
      return data.filter(
        o => o.orderSn.includes(query) || (o.sku && o.sku.includes(query)) || o.productName.includes(query)
      );
    } catch (e: any) {
      logger.error(`Loi doc file CSDL du phong: ${e.message}`);
    }
  }

  return [];
}
