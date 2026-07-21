@echo off
chcp 65001 >nul
title BOT TRA CUU MA VAN DON 24/7
cls
echo ====================================================
echo   HE THONG TRA CUU MA VAN DON TU DONG 24/7
echo ====================================================
echo.
cd /d %~dp0
set PATH=C:\Program Files\nodejs;%PATH%

:START_BOT
taskkill /f /im node.exe >nul 2>nul

if not exist node_modules (
    echo [THONG BAO] Dang cai dat thu vien...
    call npm install
)

if not exist shopee_orders.db (
    call npx prisma db push --skip-generate >nul 2>nul
)

echo ====================================================
echo [THONG BAO] BOT DANG HOAT DONG 24/7...
echo - Trang web dashboard: http://localhost:3000
echo - Che do: Tu dong khoi chay lai khi ngat mang
echo - Nhan Ctrl + C de dung Bot
echo ====================================================
echo.

call npm run bot

echo.
echo [CANH BAO] Bot ngat ket noi! Tu dong khoi chay lai sau 5s...
timeout /t 5 >nul
goto START_BOT
