@echo off
chcp 65001 >nul
title ResInvest ERP - Kopia zapasowa

cd /d "%~dp0"

echo.
echo  ============================================================
echo    ResInvest ERP - Kopia zapasowa danych
echo  ============================================================
echo.
echo  Tworzenie kopii pliku bazy oraz zrzutu JSON ...
echo.

node --disable-warning=ExperimentalWarning server\scripts\backup.mjs --json

echo.
echo  Kopie znajduja sie w katalogu: data\backups
echo.
echo  ZALECENIE: katalog "data" nalezy objac firmowa kopia zapasowa
echo  (dysk sieciowy, NAS albo chmura) - zawiera baze i skany dokumentow.
echo.
pause
