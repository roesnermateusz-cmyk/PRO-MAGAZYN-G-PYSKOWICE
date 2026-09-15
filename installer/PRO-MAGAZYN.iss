; =====================================================================
;  PRO-MAGAZYN - instalator Windows (Inno Setup 6)
;  ---------------------------------------------------------------
;  Budowanie:
;      ISCC.exe installer\PRO-MAGAZYN.iss
;  Wynik:
;      installer\wyjscie\PRO-MAGAZYN-Setup-2.0.0.exe
;
;  Instalator:
;    * kopiuje program do Program Files,
;    * zaklada plik roboczy w Dokumentach uzytkownika (nie nadpisuje istniejacego),
;    * tworzy folder kopii zapasowych,
;    * odblokowuje plik (usuwa Mark-of-the-Web),
;    * zaklada skroty i zapisuje konfiguracje srodowiska.
; =====================================================================

#define NazwaAplikacji    "PRO-MAGAZYN"
#define WersjaAplikacji   "2.0.0"
#define Wydawca           "ResInvest Commodities"
#define PlikRoboczy       "PRO-MAGAZYN.xlsm"

[Setup]
AppId={{8C1F4E9A-52B7-4A6D-9E3C-7D2B5A0F1C84}
AppName={#NazwaAplikacji}
AppVersion={#WersjaAplikacji}
AppVerName={#NazwaAplikacji} {#WersjaAplikacji}
AppPublisher={#Wydawca}
DefaultDirName={autopf}\{#NazwaAplikacji}
DefaultGroupName={#NazwaAplikacji}
OutputDir=wyjscie
OutputBaseFilename={#NazwaAplikacji}-Setup-{#WersjaAplikacji}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
LicenseFile=..\LICENSE
UninstallDisplayName={#NazwaAplikacji} {#WersjaAplikacji}
MinVersion=10.0

[Languages]
Name: "polski"; MessagesFile: "compiler:Languages\Polish.isl"

[Tasks]
Name: "desktopicon"; Description: "Utwórz skrót na pulpicie"; GroupDescription: "Skróty:"
Name: "otworzdok"; Description: "Otwórz instrukcję obsługi po instalacji"; GroupDescription: "Dodatkowo:"; Flags: unchecked

[Files]
; Program - wzorzec pliku roboczego.
Source: "..\dist\{#PlikRoboczy}";   DestDir: "{app}";       Flags: ignoreversion
Source: "..\README.md";             DestDir: "{app}";       Flags: ignoreversion
Source: "..\LICENSE";               DestDir: "{app}";       Flags: ignoreversion
Source: "..\docs\INSTRUKCJA.md";    DestDir: "{app}\docs";  Flags: ignoreversion
Source: "..\docs\POPRAWKI.md";      DestDir: "{app}\docs";  Flags: ignoreversion
Source: "..\docs\BUDOWANIE.md";     DestDir: "{app}\docs";  Flags: ignoreversion
Source: "..\config\ustawienia.ini"; DestDir: "{app}\config"; Flags: ignoreversion
Source: "..\data\dane_przykladowe.csv"; DestDir: "{app}\data"; Flags: ignoreversion

; Plik roboczy uzytkownika - kopiowany tylko, gdy jeszcze nie istnieje,
; zeby aktualizacja nigdy nie skasowala kartoteki.
Source: "..\dist\{#PlikRoboczy}"; DestDir: "{code:KatalogRoboczy}"; \
    Flags: onlyifdoesntexist uninsneveruninstall

[Dirs]
Name: "{code:KatalogRoboczy}"
Name: "{code:KatalogRoboczy}\Kopie zapasowe"

[Icons]
Name: "{group}\{#NazwaAplikacji}"; Filename: "{code:KatalogRoboczy}\{#PlikRoboczy}"
Name: "{group}\Instrukcja obsługi"; Filename: "{app}\docs\INSTRUKCJA.md"
Name: "{group}\Folder kopii zapasowych"; Filename: "{code:KatalogRoboczy}\Kopie zapasowe"
Name: "{group}\Odinstaluj {#NazwaAplikacji}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#NazwaAplikacji}"; Filename: "{code:KatalogRoboczy}\{#PlikRoboczy}"; Tasks: desktopicon

[INI]
; Zapis wyborow instalacyjnych do konfiguracji srodowiska.
Filename: "{app}\config\ustawienia.ini"; Section: "sciezki"; Key: "katalog_roboczy"; String: "{code:KatalogRoboczy}"
Filename: "{app}\config\ustawienia.ini"; Section: "sciezki"; Key: "katalog_kopii";   String: "{code:KatalogRoboczy}\Kopie zapasowe"
Filename: "{app}\config\ustawienia.ini"; Section: "aplikacja"; Key: "wersja";        String: "{#WersjaAplikacji}"

[Run]
Filename: "{code:KatalogRoboczy}\{#PlikRoboczy}"; Description: "Uruchom {#NazwaAplikacji}"; \
    Flags: postinstall nowait shellexec skipifsilent
Filename: "{app}\docs\INSTRUKCJA.md"; Flags: postinstall nowait shellexec skipifsilent; Tasks: otworzdok

[UninstallDelete]
Type: filesandordirs; Name: "{app}\docs"
Type: filesandordirs; Name: "{app}\config"
Type: filesandordirs; Name: "{app}\data"

[Code]
{ Katalog roboczy uzytkownika - tam trafia plik z danymi. }
function KatalogRoboczy(Param: String): String;
begin
  Result := ExpandConstant('{userdocs}') + '\PRO-MAGAZYN';
end;

{ Windows blokuje makra w plikach pobranych z internetu lub poczty
  (Mark-of-the-Web). Usuwamy alternatywny strumien danych, zeby
  uzytkownik nie musial recznie odblokowywac pliku we wlasciwosciach. }
procedure OdblokujPlik(const Sciezka: String);
var
  KodWyjscia: Integer;
begin
  if FileExists(Sciezka + ':Zone.Identifier') then
    DeleteFile(Sciezka + ':Zone.Identifier');
  Exec(ExpandConstant('{cmd}'), '/C del /F /Q "' + Sciezka + ':Zone.Identifier"',
       '', SW_HIDE, ewWaitUntilTerminated, KodWyjscia);
end;

function CzyExcelZainstalowany(): Boolean;
begin
  Result := RegKeyExists(HKEY_CLASSES_ROOT, 'Excel.Application');
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  if not CzyExcelZainstalowany() then
  begin
    if MsgBox('Nie wykryto programu Microsoft Excel.' + #13#10 + #13#10 +
              'PRO-MAGAZYN wymaga Excela 2016 lub nowszego, aby makra mogły działać.' + #13#10 +
              'Czy mimo to kontynuować instalację?',
              mbConfirmation, MB_YESNO) = IDNO then
      Result := False;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  PlikUzytkownika: String;
begin
  if CurStep = ssPostInstall then
  begin
    OdblokujPlik(ExpandConstant('{app}\{#PlikRoboczy}'));
    PlikUzytkownika := KatalogRoboczy('') + '\{#PlikRoboczy}';
    if FileExists(PlikUzytkownika) then
      OdblokujPlik(PlikUzytkownika);

    MsgBox('Instalacja zakończona.' + #13#10 + #13#10 +
           'Plik roboczy:' + #13#10 + PlikUzytkownika + #13#10 + #13#10 +
           'Przy pierwszym otwarciu Excel poprosi o zgodę na uruchomienie makr - ' +
           'kliknij "Włącz zawartość".' + #13#10 + #13#10 +
           'Kopie zapasowe zapisują się w podfolderze "Kopie zapasowe".',
           mbInformation, MB_OK);
  end;
end;
