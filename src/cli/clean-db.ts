import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Đang làm sạch toàn bộ dữ liệu voucher mẫu cũ...');
  const res1 = await prisma.voucher.deleteMany({
    where: {
      OR: [
        { shopName: { contains: 'TU_STORE' } },
        { shopName: { contains: 'TU STORE' } },
        { voucherCode: { contains: 'OFF' } },
        { voucherCode: { startsWith: 'SP' } },
      ],
    },
  });
  console.log(`Đã xóa ${res1.count} mã voucher mẫu cũ.`);

  const res2 = await prisma.voucherShopTarget.deleteMany({
    where: {
      OR: [
        { shopName: { contains: 'TU_STORE' } },
        { shopName: { contains: 'TU STORE' } },
      ],
    },
  });
  console.log(`Đã xóa ${res2.count} shop mẫu cũ.`);
  console.log('✅ Hoàn tất làm sạch CSDL!');
}

main().catch(console.error);
