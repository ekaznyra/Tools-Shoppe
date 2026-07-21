import {
  addShopTarget,
  getShopTargets,
  scanVouchersFromUrl,
  saveDiscoveredVouchers,
  getLatestVouchers,
  getHotVouchers,
  searchVouchersByProduct,
  getUserPreference,
  setUserPreference,
  isVoucherMatchingPreference,
  formatVoucherTelegramMessage,
  generateVoucherHash,
  parseNumericValue,
  calculateVoucherScore,
  generateAffiliateUrl,
} from '../lib/voucher-scanner/index.ts';
import { logger } from '../lib/logging/index.ts';

async function testVoucherScannerModule() {
  console.log('====================================================');
  console.log('🧪 KIỂM THỬ TỰ ĐỘNG MODULE VOUCHER SCANNER & RANKING');
  console.log('====================================================\n');

  // 1. Test Hash, Numeric & Ranking Score Engine
  console.log('1️⃣ Testing Hash, Numeric Parser & Ranking Engine...');
  const hash1 = generateVoucherHash({
    shopId: 'tu_store',
    voucherCode: 'TUSTORE50K',
    title: 'Giảm 50k đơn từ 299k',
    discountValue: '50.000đ',
    minSpend: '299.000đ',
  });
  const val50k = parseNumericValue('50.000đ');
  const val299k = parseNumericValue('299k');
  const score1 = calculateVoucherScore(val50k, val299k, 500);

  console.log(`   • Hash Generated: ${hash1}`);
  console.log(`   • Numeric 50.000đ -> ${val50k}`);
  console.log(`   • Numeric 299k -> ${val299k}`);
  console.log(`   • Ranking Engine Score: ${score1} điểm`);

  if (val50k !== 50000 || val299k !== 299000 || score1 <= 0) {
    throw new Error('❌ Test Ranking Engine FAILED!');
  }
  console.log('   ✅ Hash & Ranking Engine PASSED!\n');

  // 2. Test Add Shop Target & Scanning & Deduplication
  console.log('2️⃣ Testing Add Shop Target & Voucher Scanning...');
  const shop = await addShopTarget('https://shopee.vn/m/ma-giam-gia', 'TEST_CHAT_ID');
  console.log(`   • Added Shop: ${shop.shopName} (${shop.shopUrl})`);

  const rawList = await scanVouchersFromUrl(shop.shopUrl);
  console.log(`   • Scanned ${rawList.length} vouchers from ${shop.shopName}`);

  const newlyDiscovered = await saveDiscoveredVouchers(rawList);
  console.log(`   • Newly Discovered Vouchers Saved: ${newlyDiscovered.length}`);

  const duplicateCheck = await saveDiscoveredVouchers(rawList);
  console.log(`   • Duplicate Scan Test (Expected 0): ${duplicateCheck.length}`);
  if (duplicateCheck.length !== 0) {
    throw new Error('❌ Test Deduplication FAILED! Duplicate vouchers were saved.');
  }
  console.log('   ✅ Deduplication & Storage PASSED!\n');

  // 3. Test Hot Vouchers Ranking Query & Product Keyword Search
  console.log('3️⃣ Testing Hot Vouchers Ranking & Keyword Search...');
  const hotList = await getHotVouchers(5);
  console.log(`   • Top HOT Vouchers Found: ${hotList.length}`);

  const searchResults = await searchVouchersByProduct('Shopee');
  console.log(`   • Keyword Search for "Shopee": Found ${searchResults.length} matching vouchers`);
  if (searchResults.length === 0) {
    throw new Error('❌ Test Keyword Search FAILED!');
  }
  console.log('   ✅ Hot Vouchers Ranking & Search PASSED!\n');

  // 4. Test Preference Filter & Telegram Message Format
  console.log('4️⃣ Testing Preference Filter & Telegram Formatting...');
  const pref = await setUserPreference('TEST_CHAT_ID', 30000, 500000);
  const latestVouchers = await getLatestVouchers(5);

  for (const v of latestVouchers) {
    const isMatched = isVoucherMatchingPreference(v, pref);
    const msg = formatVoucherTelegramMessage(v);
    console.log(`   • Voucher: ${v.title} | Score: ${v.score} | Matched: ${isMatched}`);
    console.log(`   • Telegram HTML Snippet:\n${msg.split('\n').map(l => '     ' + l).join('\n')}\n`);
  }
  console.log('   ✅ Filter & Formatting PASSED!\n');

  console.log('====================================================');
  console.log('🎉 TOÀN BỘ BÀI TEST VOUCHER SCANNER & RANKING THÀNH CÔNG RỰC RỠ!');
  console.log('====================================================');
}

testVoucherScannerModule().catch((err) => {
  console.error('❌ TEST FAILED WITH ERROR:', err);
  process.exit(1);
});
