@echo off
:: QSR Printer Service Startup Script
:: Run this at Windows startup to auto-start the printer service

echo Starting QSR Printer Service...

:: Start PM2 service
cd /d D:\projects\QSR_New\Myqsr\local-printer
pm2 resurrect

echo QSR Printer Service started!
echo.
echo To view logs: pm2 logs qsr-printer
echo To stop: pm2 stop qsr-printer
echo To restart: pm2 restart qsr-printer
echo.
pause
