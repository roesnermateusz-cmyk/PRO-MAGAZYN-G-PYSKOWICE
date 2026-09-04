@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title ResInvest ERP - Instalacja

echo.
echo  ============================================================
echo    ResInvest ERP - Magazyn Biomasy
echo    Instalacja na komputerze z systemem Windows
echo  ============================================================
echo.

cd /d "%~dp0"

REM ---------- 1. Sprawdzenie srodowiska Node.js ----------
where node >nul 2>&1
if errorlevel 1 (
  echo  [BLAD] Nie znaleziono srodowiska Node.js.
  echo.
  echo  System wymaga Node.js w wersji 22 lub nowszej.
  echo  Pobierz wersje LTS ze strony:  https://nodejs.org/pl
  echo  Zainstaluj, a nastepnie uruchom ten plik ponownie.
  echo.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if !NODE_MAJOR! LSS 22 (
  echo  [BLAD] Zainstalowana wersja Node.js jest za stara.
  node -v
  echo  Wymagana jest wersja 22 lub nowsza: https://nodejs.org/pl
  echo.
  pause
  exit /b 1
)

echo  [OK] Node.js
node -v
echo.

REM ---------- 2. Plik konfiguracyjny ----------
if not exist ".env" (
  echo  Tworzenie pliku konfiguracyjnego .env ...
  copy /y ".env.example" ".env" >nul

  REM Klucz podpisu tokenow - unikalny dla tej instalacji
  for /f "delims=" %%s in ('node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"') do set SECRET=%%s
  for /f "delims=" %%p in ('node -e "console.log('Res-'+require('crypto').randomBytes(4).toString('hex')+'-2026A')"') do set ADMPASS=%%p

  node -e "const fs=require('fs');let t=fs.readFileSync('.env','utf8');t=t.replace(/^AUTH_SECRET=.*$/m,'AUTH_SECRET=%SECRET%');t=t.replace(/^BOOTSTRAP_ADMIN_PASSWORD=.*$/m,'BOOTSTRAP_ADMIN_PASSWORD=%ADMPASS%');fs.writeFileSync('.env',t);"

  echo  [OK] Utworzono plik .env z unikalnym kluczem bezpieczenstwa.
  echo.
  echo  ------------------------------------------------------------
  echo    DANE PIERWSZEGO LOGOWANIA - ZAPISZ JE TERAZ
  echo  ------------------------------------------------------------
  echo    Login : admin@resinvest.local
  echo    Haslo : !ADMPASS!
  echo.
  echo    Haslo zostanie zmienione przy pierwszym logowaniu.
  echo  ------------------------------------------------------------
  echo.
) else (
  echo  [OK] Plik .env juz istnieje - konfiguracja zachowana.
  echo.
)

REM ---------- 3. Przygotowanie bazy danych ----------
echo  Przygotowywanie bazy danych ...
node --disable-warning=ExperimentalWarning server\scripts\migrate.mjs
if errorlevel 1 (
  echo  [BLAD] Nie udalo sie przygotowac bazy danych.
  pause
  exit /b 1
)
echo.

REM ---------- 4. Dane testowe (opcjonalnie) ----------
set /p SEED="  Wgrac przykladowe dane testowe? (T/N): "
if /i "!SEED!"=="T" (
  echo  Generowanie danych testowych ...
  node --disable-warning=ExperimentalWarning server\scripts\seed.mjs
)
echo.

REM ---------- 5. Launcher ResInvestERP.exe ----------
echo  Budowanie programu uruchamiajacego ...
call "%~dp0ZBUDUJ-EXE.bat"
set EXE_OK=0
if exist "%~dp0ResInvestERP.exe" set EXE_OK=1
echo.

REM ---------- 6. Skroty ----------
if "!EXE_OK!"=="1" (
  set TARGET=%~dp0ResInvestERP.exe
  set ICONSRC=%~dp0ResInvestERP.exe
) else (
  set TARGET=%~dp0START.bat
  set ICONSRC=%SystemRoot%\System32\shell32.dll,13
)

set DESKTOP=%USERPROFILE%\Desktop
if exist "!DESKTOP!" (
  echo  Tworzenie skrotu na pulpicie ...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut((Join-Path $env:USERPROFILE 'Desktop\ResInvest ERP.lnk'));" ^
    "$s.TargetPath='!TARGET!'; $s.WorkingDirectory='%~dp0';" ^
    "$s.IconLocation='!ICONSRC!'; $s.Description='ResInvest ERP - Magazyn Biomasy'; $s.Save()" >nul 2>&1
  if exist "!DESKTOP!\ResInvest ERP.lnk" (echo  [OK] Skrot na pulpicie) else (echo  [i] Skrotu na pulpicie nie utworzono)
)

set STARTMENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs
if exist "!STARTMENU!" (
  echo  Dodawanie do menu Start ...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut((Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\ResInvest ERP.lnk'));" ^
    "$s.TargetPath='!TARGET!'; $s.WorkingDirectory='%~dp0';" ^
    "$s.IconLocation='!ICONSRC!'; $s.Description='ResInvest ERP - Magazyn Biomasy'; $s.Save()" >nul 2>&1
  if exist "!STARTMENU!\ResInvest ERP.lnk" (echo  [OK] Menu Start) else (echo  [i] Wpisu w menu Start nie utworzono)
)

REM ---------- 7. Uruchamianie przy starcie systemu (opcjonalnie) ----------
echo.
set /p AUTOSTART="  Uruchamiac system automatycznie po zalogowaniu? (T/N): "
set AUTODIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
if /i "!AUTOSTART!"=="T" (
  if exist "!AUTODIR!" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut((Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\ResInvest ERP.lnk'));" ^
      "$s.TargetPath='!TARGET!'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='!ICONSRC!'; $s.Save()" >nul 2>&1
    if exist "!AUTODIR!\ResInvest ERP.lnk" (echo  [OK] Autostart wlaczony) else (echo  [i] Autostartu nie ustawiono)
  )
) else (
  if exist "!AUTODIR!\ResInvest ERP.lnk" del /q "!AUTODIR!\ResInvest ERP.lnk" >nul 2>&1
  echo  [i] Autostart wylaczony
)

echo.
echo  ============================================================
echo    INSTALACJA ZAKONCZONA
echo.
if "!EXE_OK!"=="1" (
  echo    Aby uruchomic system, kliknij dwukrotnie: ResInvestERP.exe
  echo    albo skrot "ResInvest ERP" na pulpicie.
  echo.
  echo    Program dziala w zasobniku systemowym obok zegara.
  echo    Prawy przycisk na ikonie - menu z opcja zakonczenia pracy.
) else (
  echo    Aby uruchomic system, kliknij dwukrotnie: START.bat
  echo    albo skrot "ResInvest ERP" na pulpicie.
)
echo.
echo    Aplikacja otworzy sie w przegladarce pod adresem:
echo      http://localhost:4173
echo  ============================================================
echo.
pause
