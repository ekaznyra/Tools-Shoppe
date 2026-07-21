import type { WaybillTrackingResult } from '../spx-tracker/index.ts';

export interface ETAPrediction {
  estimatedTime: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  note: string;
}

/**
 * Dự đoán Ngày & Giờ đơn hàng sẽ được giao tới tay người nhận dựa trên hành trình bưu cục
 */
export function predictDeliveryETA(result: WaybillTrackingResult): ETAPrediction {
  if (!result || !result.success) {
    return {
      estimatedTime: 'Chưa có thông tin dự báo',
      confidence: 'LOW',
      note: 'Bưu kiện chưa ghi nhận dữ liệu vận chuyển.',
    };
  }

  const status = (result.status || '').toLowerCase();
  const latestLoc = (result.latestLocation || '').toLowerCase();

  // 1. Đã giao thành công
  if (status.includes('thành công') || status.includes('đã giao')) {
    return {
      estimatedTime: '✅ Đã hoàn tất giao hàng',
      confidence: 'HIGH',
      note: 'Bưu kiện đã tới tay người nhận.',
    };
  }

  // 2. Đang đi giao (Shipper đang trên đường)
  if (status.includes('đang giao') || latestLoc.includes('đang giao')) {
    return {
      estimatedTime: '🎯 Dự kiến giao trong HÔM NAY (trước 18:00)',
      confidence: 'HIGH',
      note: 'Bưu tá đang mang kiện hàng đi giao. Bạn chú ý nghe điện thoại nhé!',
    };
  }

  // 3. Đã về kho bưu cục Hub địa phương (Quận/Huyện)
  if (latestLoc.includes('hub') || latestLoc.includes('bưu cục') || latestLoc.includes('trạm')) {
    return {
      estimatedTime: '📦 Dự kiến giao trong HÔM NAY hoặc NGÀY MAI',
      confidence: 'HIGH',
      note: 'Hàng đã về bưu cục địa phương và sắp xuất kho giao.',
    };
  }

  // 4. Đang ở kho tổng trung chuyển (Mega SOC / SOC / Kho tổng)
  if (latestLoc.includes('soc') || latestLoc.includes('mega') || latestLoc.includes('kho')) {
    return {
      estimatedTime: '🚛 Dự kiến giao trong 1 - 2 NGÀY TỚI',
      confidence: 'MEDIUM',
      note: 'Hàng đang được luân chuyển giữa các kho trung chuyển.',
    };
  }

  // 5. Đơn mới tạo / Chuẩn bị hàng / Chờ lấy
  return {
    estimatedTime: '⏳ Dự kiến giao trong 2 - 4 NGÀY TỚI',
    confidence: 'MEDIUM',
    note: 'Đơn vị vận chuyển đang tiếp nhận hoặc vận chuyển chặng đầu.',
  };
}
