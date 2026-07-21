# Shopee Order Checker Tool (Node.js + TypeScript + Playwright + SQLite + Telegram Bot)

Công cụ tự động kiểm tra, đồng bộ và quản lý đơn hàng từ **Shopee Seller Centre** bảo mật cao dành cho chính chủ tài khoản shop.

---

## 🔒 Nguyên Tắc Bảo Mật & An Toàn 
1. **Chỉ dùng cho tài khoản chính chủ / được ủy quyền**: Người dùng tự đăng nhập trực tiếp trên cửa sổ trình duyệt Playwright Chromium/Chrome.
2. **Persistent Browser Context**: Lưu session đăng nhập cục bộ tại thư mục máy người dùng (`./shopee_user_data`).
3. **Không thu thập / gửi dữ liệu ra ngoài**: Không bao giờ sao chép, gửi cookie, OTP, token hay mật khẩu lên bất kỳ máy chủ bên ngoài nào.
4. **Bảo vệ PII**: Tự động lọc/mask họ tên, số điện thoại, địa chỉ khách hàng trên giao diện và log.
5. **Telegram Whitelist**: Chỉ tài khoản Telegram có `CHAT_ID` trong danh sách cho phép mới có quyền ra lệnh cho Bot.

---

## 📂 Cấu Trúc Thư Mục Dự Án

```
shopee-order-checker/
├── .env                         # Configuration môi trường cục bộ (Chứa Telegram Token & DB URL)
├── .env.example                 # File mẫu cấu hình môi trường
├── package.json                 # Khai báo dependency & npm scripts
├── tsconfig.json                # Cấu hình TypeScript Strict Mode
├── prisma/
│   └── schema.prisma            # Schema SQLite lưu trữ đơn hàng & nhật ký đồng bộ
├── src/
│   ├── types/
│   │   └── index.ts             # Định nghĩa Interface TypeScript
│   ├── lib/
│   │   ├── logging/             # Module ghi log an toàn, tự động mask PII
│   │   ├── browser/             # Khởi tạo Playwright Persistent Browser Context
│   │   ├── authentication/      # Kiểm tra trạng thái đăng nhập Shopee Seller Centre
│   │   ├── order-parser/        # Bóc tách dữ liệu đơn hàng với selector an toàn
│   │   ├── database/            # Client Prisma SQLite, upsert đơn & lịch sử đồng bộ
│   │   ├── export/              # Xuất dữ liệu báo cáo ra file Excel (.xlsx) & CSV
│   │   └── telegram/            # Client Telegram Bot API (Send message, send file, polling)
│   └── cli/
│       ├── sync-orders.ts       # Script chính khởi chạy tiến trình đồng bộ CLI
│       ├── test-demo.ts         # Script test thử nghiệm bóc tách & export dữ liệu
│       └── bot-server.ts        # Telegram Bot Server chạy nền tương tác trực tiếp
└── README.md                    # Hướng dẫn chi tiết cài đặt và vận hành
```

---

## 🤖 Hướng Dẫn Cấu Hình & Chạy Telegram Bot

### Step 1: Tạo Telegram Bot
1. Mở Telegram, tìm kiếm **@BotFather**.
2. Gõ `/newbot` và đặt tên cho Bot của bạn.
3. Sao chép chuỗi **API Token** được BotFather cấp (VD: `7123456789:AAFxxx...`).

### Step 2: Cấu hình File `.env`
Mở file `.env` và điền thông tin Token của bạn:

```env
TELEGRAM_BOT_TOKEN="7123456789:AAFxxx..."
TELEGRAM_ALLOWED_CHAT_ID=""
```

### Step 3: Khởi chạy Telegram Bot Server

```bash
npm run bot
```

---

## 💬 Các Lệnh Tương Tác Qua Telegram Bot

- `/start` hoặc `/help` : Xem danh sách menu và hướng dẫn.
- `/orders` : Xem danh sách 10 đơn hàng mới nhất lưu trong CSDL.
- `/search <từ_khóa>` : Tìm kiếm đơn theo Mã đơn hàng, SKU hoặc Tên sản phẩm.
- `/sync` : Kích hoạt Playwright mở Chrome đồng bộ đơn hàng trực tiếp từ Shopee.
- `/export` : Tạo file báo cáo Excel & CSV rồi gửi đính kèm thẳng vào Telegram Chat.
- `/status` : Kiểm tra trạng thái làm việc của hệ thống và CSDL.
