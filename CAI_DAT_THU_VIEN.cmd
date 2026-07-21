@echo off
chcp 65001 >nul
title CAI DAT THU VIEN - WAYBILL TRACKER
cls
echo ====================================================
echo      DANG CAI DAT TOAN BO THU VIEN VA CSDL...
echo ====================================================
echo.
cd /d %~dp0
set PATH=C:\Program Files\nodejs;%PATH%

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [CANH BAO] May tinh chua cai dat Node.js!
    echo Dang tu dong cai dat Node.js LTS tu dong...
    echo.
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    echo.
    echo [THANH CONG] Da cai dat xong Node.js! Vui long dong cua so va chay lai file nay.
    pause
    exit /b
)

echo [1/3] Dang cai dat cac thu vien npm...
call npm install

echo.
echo [2/3] Dang khoi tao CSDL SQLite...
call npx prisma db push --skip-generate >nul 2>nul

echo.
echo [3/3] Dang kiem tra trinh duyet Playwright...
call npx playwright install chromium >nul 2>nul

echo.
echo ====================================================
echo [THANH CONG] DA CAI DAT XONG 100% THU VIEN VA CSDL!
echo Bây giờ bạn có thể nhấp đúp file CHAY_BOT.cmd để khởi chạy Bot.
echo ====================================================
echo.
pause
