@echo off
REM ============================================================
REM  Budowa launchera ResInvestERP.exe
REM
REM  Kompilator C# jest skladnikiem systemu Windows (.NET Framework 4,
REM  obecny od Windows 8), wiec nie trzeba niczego pobierac ani instalowac.
REM  Plik zbudowany na miejscu jest lokalny - nie dziedziczy blokady
REM  "pobrane z internetu", ktora zatrzymalaby gotowy plik z archiwum.
REM
REM  Skrypt mozna uruchamiac wielokrotnie; nadpisuje poprzedni wynik.
REM ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set CSC=
for %%D in ("%WINDIR%\Microsoft.NET\Framework64" "%WINDIR%\Microsoft.NET\Framework") do (
  if exist %%~D (
    for /f "delims=" %%V in ('dir /b /o-n "%%~D\v4.*" 2^>nul') do (
      if not defined CSC if exist "%%~D\%%V\csc.exe" set CSC=%%~D\%%V\csc.exe
    )
  )
)

if not defined CSC (
  echo  [i] Nie znaleziono kompilatora C# w systemie.
  echo      Launcher ResInvestERP.exe nie zostanie zbudowany.
  echo      System pozostaje w pelni sprawny - uruchamiaj go plikiem START.bat
  exit /b 2
)

if not exist "ResInvestERP.cs" (
  echo  [BLAD] Brak pliku zrodlowego ResInvestERP.cs
  exit /b 1
)

set ICON=
if exist "ResInvestERP.ico" set ICON=/win32icon:ResInvestERP.ico

"%CSC%" /nologo /target:winexe /optimize+ /platform:anycpu ^
  /out:"ResInvestERP.exe" %ICON% ^
  /reference:System.dll ^
  /reference:System.Drawing.dll ^
  /reference:System.Windows.Forms.dll ^
  "ResInvestERP.cs"

if errorlevel 1 (
  echo  [BLAD] Kompilacja launchera nie powiodla sie.
  exit /b 1
)

if not exist "ResInvestERP.exe" (
  echo  [BLAD] Kompilator nie utworzyl pliku wynikowego.
  exit /b 1
)

echo  [OK] Zbudowano ResInvestERP.exe
exit /b 0
