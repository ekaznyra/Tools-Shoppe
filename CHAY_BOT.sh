#!/bin/bash
# ====================================================
#   HE THONG TRA CUU MA VAN DON 24/7 (LINUX VPS)
#   Optimized for 32 CPU Cores / 96GB RAM VPS
# ====================================================

cd "$(dirname "$0")"

while true; do
  echo "[THONG BAO] Dang khoi chay Telegram Waybill Tracker Bot 24/7..."
  
  if [ ! -d "node_modules" ]; then
    echo "[THONG BAO] Dang cai dat thu vien ban dau..."
    npm install
  fi

  if [ ! -f "shopee_orders.db" ]; then
    echo "[THONG BAO] Dang khoi tao CSDL..."
    npx prisma db push --skip-generate
  fi

  echo "===================================================="
  echo "[THONG BAO] BOT DANG HOAT DONG MANG 24/7 TREN VPS..."
  echo "- Trang web dashboard: http://localhost:3000"
  echo "===================================================="
  echo ""

  npm run bot

  echo ""
  echo "[CANH BAO] Bot ngat ket noi! Tu dong khoi chay lai sau 5s..."
  sleep 5
done
