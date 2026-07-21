import { trackUniversalWaybillWithTimeout } from '../lib/multi-carrier-tracker/index.ts';

async function main() {
  const code = 'SPXVN069602647857';
  console.log(`⚡ Testing OFFICIAL LIVE SPX API for ${code}...`);

  const start = Date.now();
  const res = await trackUniversalWaybillWithTimeout(code, 20000);
  const elapsed = Date.now() - start;

  console.log(`⏱️ Elapsed: ${elapsed}ms`);
  console.log('Result:', JSON.stringify(res, null, 2));
}

main().catch(console.error);
