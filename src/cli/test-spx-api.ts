async function testDirectSPX() {
  const code = 'SPXVN064083604507';
  console.log(`⚡ Testing PURE HTTP FETCH for: ${code}`);

  const start = Date.now();
  const res = await fetch(`https://spx.vn/api/v2/fleet_order/tracking/search?sls_tracking_number=${code}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });
  const json = await res.json();
  const elapsed = Date.now() - start;

  console.log(`⏱️ Response Time: ${elapsed}ms`);
  console.log('JSON Output:', JSON.stringify(json, null, 2));
}

testDirectSPX().catch(console.error);
