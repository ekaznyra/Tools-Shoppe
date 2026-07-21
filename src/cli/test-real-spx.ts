async function testSPXParser() {
  const code = 'SPXVN069602647857';
  const url = `https://spx.vn/shipment/order/open/order/get_order_info?spx_tn=${code}&language_code=vi`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const json: any = await res.json();

  if (json && json.data && json.data.sls_tracking_info && json.data.sls_tracking_info.records) {
    const records = json.data.sls_tracking_info.records;
    const steps = records.map((r: any) => ({
      time: new Date(r.actual_time * 1000).toLocaleTimeString('vi-VN'),
      date: new Date(r.actual_time * 1000).toLocaleDateString('vi-VN'),
      status: r.description || r.buyer_description || r.tracking_name || 'Cập nhật bưu cục',
    }));

    const latest = steps[0];
    let mainStatus = '🚚 Đang vận chuyển';
    if (latest.status.includes('thành công') || latest.status.includes('Delivered')) mainStatus = '✅ Giao hàng thành công';
    else if (latest.status.includes('Đang giao')) mainStatus = '🚚 Đang giao hàng';
    else if (latest.status.includes('Hủy') || latest.status.includes('Hoàn')) mainStatus = '❌ Đã hủy / Hoàn hàng';

    console.log('✅ PARSED RESULT:');
    console.log('Tracking No:', code);
    console.log('Main Status:', mainStatus);
    console.log('Latest Step:', latest.status);
    console.log('Total Steps:', steps.length);
    console.log('First 3 Steps:', steps.slice(0, 3));
  }
}

testSPXParser().catch(console.error);
