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
2. **Tự động theo dõi bưu kiện 24/7 (`/theodoi`)**: Tự động thông báo Telegram ngay khi bưu kiện đổi bưu cục/chuyển kho.
3. **Quét & Cào Voucher Shopee Tự Động**: Tự động quét mã giảm giá công khai từ các shop Shopee hoặc chiến dịch.
4. **Ranking Engine (Chấm điểm Voucher)**: Chấm điểm chất lượng voucher (0-100+ điểm) và lọc ra mã HOT nhất.
5. **Affiliate Deep-Link Engine**: Tự động tạo link Affiliate (AccessTrade / Shopee Affiliate) giúp mở app Shopee trực tiếp & kiếm hoa hồng.
6. **Bộ lọc thông minh (`/filter`)**: Lọc voucher theo mức giảm tối thiểu và đơn tối thiểu.
7. **Dự báo giao hàng (ETA Predictor)**: Dự đoán thời gian bưu kiện đến tay người nhận.
8. **Trang Quản Trị Web (`http://localhost:3000`)**: Giao diện Web Dashboard Dark Mode kính Glassmorphism sang trọng.

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

## 📖 HƯỚNG DẪN SỬ DỤNG TẤT CẢ CÁC LỆNH TELEGRAM BOT

### 📦 nhóm 1: TRA CỨU & THEO DÕI VẬN ĐƠN (PARCEL TRACKING)
| Lệnh Telegram | Cú pháp ví dụ | Mô tả chức năng |
|---|---|---|
| `Gõ thẳng Mã Vận Đơn` | `SPXVN068554112737` | Tra cứu hành trình vận đơn tức thì |
| `/tracuu` hoặc `/tim` | `/tracuu SPXVN068554112737` | Tra cứu hành trình vận đơn SPX, GHTK, GHN... |
| `/theodoi` hoặc `/watch` | `/theodoi SPXVN068554112737` | Đăng ký tự động theo dõi bưu kiện (báo tin ngầm khi đổi kho) |
| `/danhsach` hoặc `/watchlist` | `/danhsach` | Xem danh sách tất cả mã vận đơn đang tự động theo dõi |
| `/huytheodoi` hoặc `/unwatch` | `/huytheodoi SPXVN068554112737` | Hủy đăng ký nhận thông báo bưu kiện |
| `/nhackhach` hoặc `/remind` | `/nhackhach SPXVN068554112737` | Tạo nhanh mẫu tin nhắn gửi Zalo/SMS nhắc người nhận nghe máy |
| `/xuatexcel` hoặc `/export` | `/xuatexcel` | Xuất file Báo cáo Excel lịch sử tra cứu |
| `/baocaotudong` | `/baocaotudong` | Bật/Tắt lịch tự động gửi file Excel báo cáo định kỳ 6h/lần |

---

### 🎟️ Nhóm 2: QUÉT & THÔNG BÁO MÃ GIẢM GIÁ SHOPEE (VOUCHER SCANNER)
| Lệnh Telegram | Cú pháp ví dụ | Mô tả chức năng |
|---|---|---|
| `/addshop` hoặc `/themshop` | `/addshop https://shopee.vn/tu_store` | Thêm shop hoặc chiến dịch Shopee cần theo dõi quét mã |
| `/removeshop` hoặc `/xoashop` | `/removeshop tu_store` | Xóa shop khỏi danh sách quét voucher |
| `/listshops` hoặc `/dsshops` | `/listshops` | Xem danh sách các shop Shopee đang được quét ngầm |
| `/vouchers` hoặc `/latest` | `/vouchers` | Xem 5 voucher mới nhất vừa tìm thấy |
| `/today` hoặc `/homnay` | `/today` | Xem danh sách voucher mới phát hiện trong ngày hôm nay |
| `/hot` hoặc `/mahot` | `/hot` | Xem TOP voucher HOT nhất sàn (Xếp hạng bởi Ranking Engine) |
| `/timma` hoặc `/searchproduct` | `/timma tu_store` | Tìm kiếm voucher phù hợp theo tên sản phẩm hoặc tên shop |
| `/filter` hoặc `/boloc` | `/filter min=50k maxspend=500k` | Cài đặt bộ lọc voucher (chỉ nhận tin giảm từ 50k, đơn tối đa 500k) |
| `/pause` hoặc `/tamdung` | `/pause` | Tạm dừng nhận tin nhắn thông báo voucher tự động |
| `/resume` hoặc `/batlai` | `/resume` | Bật lại thông báo voucher tự động |

---

### ⚙️ Nhóm 3: CÀI ĐẶT & HỆ THỐNG
| Lệnh Telegram | Cú pháp ví dụ | Mô tả chức năng |
|---|---|---|
| `/lang` hoặc `/language` | `/lang` | Đổi ngôn ngữ hiển thị (Tiếng Việt 🇻🇳, English 🇺🇸, 日本語 🇯🇵, 中文 🇨🇳, हिन्दी 🇮🇳) |
| `/trangthai` hoặc `/status` | `/trangthai` | Kiểm tra trạng thái hoạt động máy chủ & thông số kỹ thuật |
| `/help` hoặc `/huongdan` | `/help` | Hiển thị bảng menu hướng dẫn tất cả các lệnh |

---

**Copyright © 2026 Kaze. All rights reserved.**

