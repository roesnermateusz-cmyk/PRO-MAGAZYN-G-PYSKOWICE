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

REM ---------- 5. Skrot na pulpicie ----------
set DESKTOP=%USERPROFILE%\Desktop
if exist "%DESKTOP%" (
  echo  Tworzenie skrotu na pulpicie ...
  set SHORTCUT=%DESKTOP%\ResInvest ERP.lnk
  powershell -NoProfile -Command ^
    "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut('%DESKTOP%\ResInvest ERP.lnk');" ^
    "$s.TargetPath='%~dp0START.bat'; $s.WorkingDirectory='%~dp0';" ^
    "$s.IconLocation='%SystemRoot%\System32\shell32.dll,13'; $s.Description='ResInvest ERP - Magazyn Biomasy'; $s.Save()" >nul 2>&1
  if exist "%DESKTOP%\ResInvest ERP.lnk" (echo  [OK] Skrot utworzony) else (echo  [i] Skrotu nie utworzono - uruchamiaj plik START.bat)
)

echo.
echo  ============================================================
echo    INSTALACJA ZAKONCZONA
echo.
echo    Aby uruchomic system, kliknij dwukrotnie: START.bat
echo    albo skrot "ResInvest ERP" na pulpicie.
echo.
echo    Aplikacja otworzy sie w przegladarce pod adresem:
echo      http://localhost:4173
echo  ============================================================
echo.
pause
