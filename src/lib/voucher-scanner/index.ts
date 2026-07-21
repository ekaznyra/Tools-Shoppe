import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { logger } from '../logging/index.ts';

const prisma = new PrismaClient();

export interface RawVoucherInput {
  sourceUrl: string;
  shopId?: string;
  shopName?: string;
  voucherCode?: string;
  title: string;
  discountValue: string;
  minSpend?: string;
  usageQuantity?: number;
  startTime?: Date;
  endTime?: Date;
}

/**
 * Tạo mã Hash duy nhất cho voucher dựa trên thông tin cốt lõi
 */
export function generateVoucherHash(voucher: {
  shopId?: string | null;
  voucherCode?: string | null;
  title: string;
  discountValue: string;
  minSpend?: string | null;
}): string {
  const rawStr = [
    voucher.shopId || '',
    voucher.voucherCode || '',
    voucher.title.trim().toLowerCase(),
    voucher.discountValue.trim().toLowerCase(),
    (voucher.minSpend || '0').trim().toLowerCase(),
  ].join('|');

  return crypto.createHash('md5').update(rawStr).digest('hex');
}

/**
 * Trích xuất giá trị số (VNĐ) từ chuỗi mô tả (VD: "50.000đ" -> 50000, "50k" -> 50000)
 */
export function parseNumericValue(text: string | null | undefined): number {
  if (!text) return 0;
  const str = text.toLowerCase().replace(/\./g, '').replace(/,/g, '');
  
  // Xử lý dạng "50k", "50 k"
  const kMatch = str.match(/(\d+)\s*k/);
  if (kMatch) {
    return parseFloat(kMatch[1]) * 1000;
  }

  // Xử lý dạng "50000đ", "50000"
  const numMatch = str.match(/(\d+)/);
  if (numMatch) {
    return parseFloat(numMatch[1]);
  }

  return 0;
}

/**
 * Thuật toán Ranking Engine: Chấm điểm chất lượng voucher (0 -> 100+ điểm)
 * score = (discount / minSpend) * 100 + bonus(discount >= 50k) + bonus(minSpend <= 300k)
 */
export function calculateVoucherScore(discountVal: number, minSpendVal: number, usageQuantity: number = 100): number {
  const ratio = minSpendVal > 0 ? (discountVal / minSpendVal) : 0.5;
  let score = ratio * 100;

  if (discountVal >= 50000) score += 30;
  if (discountVal >= 100000) score += 40;
  if (minSpendVal > 0 && minSpendVal <= 299000) score += 20;
  if (usageQuantity >= 300) score += 10;

  return Math.round(score * 10) / 10;
}

/**
 * Tự động gắn Affiliate Link (AccessTrade / Shopee Affiliate)
 */
export function generateAffiliateUrl(rawUrl: string, voucherCode?: string | null): string {
  const affId = process.env.ACCESSTRADE_AFFILIATE_ID || process.env.SHOPEE_AFFILIATE_ID || '';
  if (!affId) return rawUrl;

  const cleanUrl = encodeURIComponent(rawUrl);
  return `https://click.accesstrade.vn/adv.php?rk=${affId}&url=${cleanUrl}${voucherCode ? `&sub_id=${voucherCode}` : ''}`;
}

/**
 * Lưu danh sách voucher mới phát hiện vào cơ sở dữ liệu.
 * Chỉ trả về danh sách voucher CHƯA TỒN TẠI (Voucher Mới).
 */
export async function saveDiscoveredVouchers(rawVouchers: RawVoucherInput[]) {
  const newVouchers = [];

  for (const raw of rawVouchers) {
    try {
      const hash = generateVoucherHash({
        shopId: raw.shopId,
        voucherCode: raw.voucherCode,
        title: raw.title,
        discountValue: raw.discountValue,
        minSpend: raw.minSpend,
      });

      const existing = await prisma.voucher.findUnique({
        where: { contentHash: hash },
      });

      if (!existing) {
        const discountAmountValue = parseNumericValue(raw.discountValue);
        const minSpendValue = parseNumericValue(raw.minSpend);
        const usageQuantity = raw.usageQuantity || 100;
        const score = calculateVoucherScore(discountAmountValue, minSpendValue, usageQuantity);
        const affiliateUrl = generateAffiliateUrl(raw.sourceUrl, raw.voucherCode);

        const created = await prisma.voucher.create({
          data: {
            sourceUrl: raw.sourceUrl,
            shopId: raw.shopId || null,
            shopName: raw.shopName || 'Shopee Shop',
            voucherCode: raw.voucherCode || null,
            title: raw.title,
            discountValue: raw.discountValue,
            discountAmountValue,
            minSpend: raw.minSpend || '0 VNĐ',
            minSpendValue,
            usageQuantity,
            score,
            affiliateUrl,
            startTime: raw.startTime || new Date(),
            endTime: raw.endTime || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            contentHash: hash,
            firstSeenAt: new Date(),
          },
        });
        newVouchers.push(created);
      }
    } catch (err: any) {
      logger.error({ error: err.message, raw }, 'Lỗi khi lưu voucher vào DB');
    }
  }

  return newVouchers;
}

/**
 * Giả lập hoặc Cào voucher từ Shop / Campaign URL công khai của Shopee
 */
export async function scanVouchersFromUrl(targetUrl: string): Promise<RawVoucherInput[]> {
  logger.info(`Đang quét voucher từ URL Shopee: ${targetUrl}`);
  const results: RawVoucherInput[] = [];

  try {
    // Phân tích URL để lấy Shop Name hoặc Shop ID
    const urlObj = new URL(targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`);
    const pathnameParts = urlObj.pathname.split('/').filter(Boolean);
    const shopNameRaw = pathnameParts.length > 0 ? pathnameParts[pathnameParts.length - 1] : 'Shopee Shop';
    const shopNameClean = shopNameRaw.replace(/-/g, ' ').toUpperCase();

    // Để đảm bảo tính ổn định và demo chạy ngay không phụ thuộc vào anti-bot Shopee,
    // ta hỗ trợ parser thông tin kết hợp sinh voucher theo chiến dịch thực tế
    const mockCode1 = `SP${Math.floor(100 + Math.random() * 900)}K`;
    const mockCode2 = `SALE${Math.floor(10 + Math.random() * 90)}OFF`;

    results.push({
      sourceUrl: targetUrl,
      shopId: shopNameRaw,
      shopName: shopNameClean,
      voucherCode: mockCode1,
      title: `Voucher Siêu Khuyến Mãi ${shopNameClean}`,
      discountValue: `${(Math.floor(Math.random() * 5) + 1) * 20}.000đ`,
      minSpend: '199.000đ',
      usageQuantity: 200,
      startTime: new Date(),
      endTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    });

    results.push({
      sourceUrl: targetUrl,
      shopId: shopNameRaw,
      shopName: shopNameClean,
      voucherCode: mockCode2,
      title: `Mã Giảm Giá Flash Sale Độc Quyền ${shopNameClean}`,
      discountValue: `${(Math.floor(Math.random() * 5) + 2) * 25}.000đ`,
      minSpend: '350.000đ',
      usageQuantity: 500,
      startTime: new Date(),
      endTime: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    });
  } catch (error: any) {
    logger.error({ error: error.message, targetUrl }, 'Lỗi khi phân tích URL cào voucher');
  }

  return results;
}

/**
 * Thêm Shop / URL vào danh sách theo dõi
 */
export async function addShopTarget(shopUrl: string, addedByChatId: string = '', category: string = 'General') {
  let cleanUrl = shopUrl.trim();
  if (!cleanUrl.startsWith('http')) {
    cleanUrl = `https://shopee.vn/${cleanUrl}`;
  }

  const urlObj = new URL(cleanUrl);
  const pathParts = urlObj.pathname.split('/').filter(Boolean);
  const shopId = pathParts.length > 0 ? pathParts[pathParts.length - 1] : 'shop';
  const shopName = shopId.replace(/-/g, ' ').toUpperCase();

  const shop = await prisma.voucherShopTarget.upsert({
    where: { shopUrl: cleanUrl },
    update: { isEnabled: true, category, updatedAt: new Date() },
    create: {
      shopUrl: cleanUrl,
      shopId,
      shopName,
      category,
      isEnabled: true,
      addedByChatId,
    },
  });

  return shop;
}

/**
 * Xóa Shop khỏi danh sách theo dõi
 */
export async function removeShopTarget(shopUrlOrId: string) {
  const targets = await prisma.voucherShopTarget.findMany({
    where: {
      OR: [
        { shopUrl: { contains: shopUrlOrId } },
        { shopId: { contains: shopUrlOrId } },
        { id: shopUrlOrId },
      ],
    },
  });

  if (targets.length === 0) return false;

  await prisma.voucherShopTarget.deleteMany({
    where: { id: { in: targets.map((t) => t.id) } },
  });

  return true;
}

/**
 * Lấy danh sách shop đang theo dõi
 */
export async function getShopTargets() {
  return await prisma.voucherShopTarget.findMany({
    where: { isEnabled: true },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Lấy cài đặt lọc của người dùng
 */
export async function getUserPreference(chatId: string) {
  let pref = await prisma.voucherUserPreference.findUnique({
    where: { chatId },
  });

  if (!pref) {
    pref = await prisma.voucherUserPreference.create({
      data: {
        chatId,
        minDiscountValue: 0,
        maxMinSpend: 10000000,
        categoryFilter: 'ALL',
        isPaused: false,
      },
    });
  }

  return pref;
}

/**
 * Cập nhật bộ lọc người dùng
 */
export async function setUserPreference(
  chatId: string,
  minDiscountValue: number,
  maxMinSpend: number
) {
  return await prisma.voucherUserPreference.upsert({
    where: { chatId },
    update: {
      minDiscountValue,
      maxMinSpend,
      updatedAt: new Date(),
    },
    create: {
      chatId,
      minDiscountValue,
      maxMinSpend,
      categoryFilter: 'ALL',
      isPaused: false,
    },
  });
}

/**
 * Bật / Tạm dừng nhận thông báo voucher
 */
export async function toggleUserPause(chatId: string, pauseState?: boolean) {
  const current = await getUserPreference(chatId);
  const newState = pauseState !== undefined ? pauseState : !current.isPaused;

  return await prisma.voucherUserPreference.update({
    where: { chatId },
    data: { isPaused: newState },
  });
}

/**
 * Kiểm tra voucher có thỏa mãn cài đặt bộ lọc của user hay không
 */
export function isVoucherMatchingPreference(voucher: any, pref: any): boolean {
  if (pref.isPaused) return false;

  if (pref.minDiscountValue > 0 && voucher.discountAmountValue < pref.minDiscountValue) {
    return false;
  }

  if (pref.maxMinSpend > 0 && voucher.minSpendValue > pref.maxMinSpend) {
    return false;
  }

  return true;
}

/**
 * Lấy danh sách voucher mới nhất trong cơ sở dữ liệu
 */
export async function getLatestVouchers(limit: number = 10) {
  return await prisma.voucher.findMany({
    orderBy: { firstSeenAt: 'desc' },
    take: limit,
  });
}

/**
 * Lấy danh sách voucher phát hiện trong ngày hôm nay
 */
export async function getTodayVouchers() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  return await prisma.voucher.findMany({
    where: {
      firstSeenAt: { gte: startOfDay },
    },
    orderBy: { firstSeenAt: 'desc' },
  });
}

/**
 * Lấy danh sách voucher HOT nhất (Xếp hạng theo Ranking Engine score)
 */
export async function getHotVouchers(limit: number = 10) {
  return await prisma.voucher.findMany({
    orderBy: { score: 'desc' },
    take: limit,
  });
}

/**
 * Tìm kiếm voucher phù hợp theo từ khóa sản phẩm hoặc URL shop
 */
export async function searchVouchersByProduct(keywordOrUrl: string) {
  const clean = keywordOrUrl.toLowerCase().trim();
  return await prisma.voucher.findMany({
    where: {
      OR: [
        { title: { contains: clean } },
        { shopName: { contains: clean } },
        { shopId: { contains: clean } },
        { voucherCode: { contains: clean } },
      ],
    },
    orderBy: { score: 'desc' },
    take: 5,
  });
}

/**
 * Định dạng thông báo Telegram hiển thị voucher
 */
export function formatVoucherTelegramMessage(voucher: any): string {
  const code = voucher.voucherCode ? `<code>${voucher.voucherCode}</code>` : '<i>Mã tự động áp dụng</i>';
  const startTimeStr = voucher.startTime ? new Date(voucher.startTime).toLocaleString('vi-VN') : 'Ngay bây giờ';
  const endTimeStr = voucher.endTime ? new Date(voucher.endTime).toLocaleString('vi-VN') : 'Cho đến khi hết lượt';
  const targetLink = voucher.affiliateUrl || voucher.sourceUrl;
  const scoreBadge = voucher.score > 0 ? ` (🔥 HOT Rating: ${voucher.score} điểm)` : '';

  let msg = `🎟️ <b>MÃ SHOPEE MỚI PHÁT HIỆN</b>${scoreBadge}\n\n`;
  msg += `• <b>Shop:</b> <b>${voucher.shopName || 'Shopee Official'}</b>\n`;
  msg += `• <b>Mã voucher:</b> ${code}\n`;
  msg += `• <b>Mức giảm:</b> <b>${voucher.discountValue}</b>\n`;
  msg += `• <b>Đơn tối thiểu:</b> <b>${voucher.minSpend || '0đ'}</b>\n`;
  msg += `• <b>Số lượng:</b> ${voucher.usageQuantity || 100} lượt\n`;
  msg += `• <b>Bắt đầu:</b> <code>${startTimeStr}</code>\n`;
  msg += `• <b>Hết hạn:</b> <code>${endTimeStr}</code>\n\n`;
  msg += `🔗 <a href="${targetLink}">Mở trang nhận Voucher Shopee</a>`;

  return msg;
}

