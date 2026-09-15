@echo off
chcp 65001 >nul
title ResInvest ERP - Magazyn Biomasy

cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo  [BLAD] Nie znaleziono Node.js. Uruchom najpierw INSTALUJ.bat
  pause
  exit /b 1
)

if not exist ".env" (
  echo  [BLAD] Brak pliku konfiguracyjnego. Uruchom najpierw INSTALUJ.bat
  pause
  exit /b 1
)

REM Odczyt portu z pliku .env (domyslnie 4173)
set PORT=4173
for /f "tokens=2 delims==" %%p in ('findstr /b "PORT=" .env') do set PORT=%%p

echo.
echo  ResInvest ERP uruchamia sie ...
echo  Adres: http://localhost:%PORT%
echo.
echo  UWAGA: nie zamykaj tego okna - to serwer aplikacji.
echo  Aby zakonczyc prace systemu, nacisnij Ctrl+C albo zamknij okno.
echo.

REM Przegladarka otwiera sie z opoznieniem, gdy serwer jest juz gotowy
start "" /b cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:%PORT%"

node --disable-warning=ExperimentalWarning server\src\index.js

echo.
echo  Serwer zostal zatrzymany.
pause
