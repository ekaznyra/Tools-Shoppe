# 🚚 BOT TRA CỨU MÃ VẬN ĐƠN ĐA KÊNH TỰ ĐỘNG (UNIVERSAL WAYBILL TRACKER)

![License](https://img.shields.io/badge/License-Proprietary-red.svg)
![Status](https://img.shields.io/badge/Status-Active%2024%2F7-brightgreen.svg)
![VPS](https://img.shields.io/badge/VPS-32%20Cores%20%7C%2096GB%20RAM-blue.svg)

Hệ thống tra cứu, dự báo thời gian giao hàng và tự động theo dõi bưu cục 24/7 hàng đầu cho các nhà vận chuyển **SPX Express, GHTK, GHN, Viettel Post, Ninja Van**.

---

## 🔒 BẢO HỘ BẢN QUYỀN TRÊN GITHUB (PROPRIETARY COPYRIGHT)

> **⚠️ BẢO HỘ BẢN QUYỀN SỞ HỮU TRÍ TUỆ:**  
> Bản quyền thuộc về **Kaze © 2026**.  
> Nghiêm cấm mọi hành vi sao chép, chỉnh sửa, đổi tên thương hiệu (Re-branding), bán lại hoặc phát hành lại mã nguồn này trên GitHub hoặc bất kỳ nền tảng nào khác mà không có sự cho phép bằng văn bản của tác giả.

---

## 🌟 CÁC TÍNH NĂNG NỔI BẬT

1. **Tra cứu đa kênh siêu tốc**: Hỗ trợ SPX Express, GHTK, GHN, Viettel Post, Ninja Van.
2. **VPS High-Performance Ready**: Tận dụng 32 CPU Cores & 96GB RAM, xử lý song song 16 luồng cùng lúc.
3. **Bộ nhớ đệm RAM 10 phút**: Trả kết quả tức thì trong **0.001s**.
4. **Tự động theo dõi 24/7 (`/theodoi`)**: Phát báo động về Telegram ngay khi bưu kiện đổi kho.
5. **Dự báo giao hàng (ETA Predictor)**: Dự đoán ngày/giờ bưu kiện tới tay người nhận.
6. **Mẫu tin nhắn nhắc nghe máy (`/nhackhach`)**: Tạo nhanh mẫu tin nhắn gửi Zalo/SMS cho người nhận.
7. **Trang Quản Trị Web (`http://localhost:3000`)**: Giao diện Web Dark Mode chuyên nghiệp.

---

## 🚀 HƯỚNG DẪN KHỞI CHẠY

### 1. Trên Windows:
- Nhấp đúp chuột file **`CAI_DAT_THU_VIEN.cmd`** (để cài đặt tự động ban đầu).
- Nhấp đúp chuột file **`CHAY_BOT.cmd`** (để bật Bot 24/7 tự khôi phục).

### 2. Trên Linux VPS (Ubuntu/Debian/CentOS):
```bash
chmod +x CHAY_BOT.sh
./CHAY_BOT.sh
```

---

## 📜 LỆNH TELEGRAM BOT (100% TIẾNG VIỆT)

- `/tracuu <mã>` hoặc `/tim <mã>` : Tra cứu hành trình vận đơn
- `/theodoi <mã>` : Thêm mã vào danh sách Tự Động Theo Dõi 24/7
- `/danhsach` : Xem các mã đang tự động theo dõi
- `/huytheodoi <mã>` : Hủy theo dõi mã vận đơn
- `/nhackhach <mã>` : Tạo tin nhắn mẫu nhắc nghe máy
- `/xuatexcel` : Xuất file Excel báo cáo
- `/baocaotudong` : Bật/Tắt gửi file Excel tự động 6h/lần
- `/trangthai` : Kiểm tra trạng thái hệ thống
- `/huongdan` : Xem menu hướng dẫn

---

**Copyright © 2026 Kaze. All rights reserved.**
