; =====================================================================
;  PRO-MAGAZYN - instalator aplikacji desktopowej (Inno Setup 6)
;  ---------------------------------------------------------------
;  Przed kompilacją zbuduj program:
;      python desktop\build_windows.py
;  Następnie:
;      ISCC.exe installer\PRO-MAGAZYN-APP.iss
;  Wynik:
;      installer\wyjscie\PRO-MAGAZYN-Setup-2.1.0.exe
; =====================================================================

#define NazwaAplikacji  "PRO-MAGAZYN"
#define WersjaAplikacji "2.1.0"
#define Wydawca         "ResInvest Commodities"
#define PlikExe         "PRO-MAGAZYN.exe"

[Setup]
AppId={{2E6B9A74-1C3D-4F58-9B02-7A4E51D6C930}
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
ArchitecturesAllowed=x64compatible
DisableProgramGroupPage=yes
LicenseFile=..\LICENSE
UninstallDisplayName={#NazwaAplikacji} {#WersjaAplikacji}
UninstallDisplayIcon={app}\{#PlikExe}
MinVersion=10.0

[Languages]
Name: "polski"; MessagesFile: "compiler:Languages\Polish.isl"

[Tasks]
Name: "desktopicon"; Description: "Utwórz skrót na pulpicie"; GroupDescription: "Skróty:"
Name: "powiazanie"; Description: "Otwieraj pliki .xlsx tej aplikacji podwójnym kliknięciem"; \
    GroupDescription: "Dodatkowo:"; Flags: unchecked

[Files]
; Cały folder zbudowany przez PyInstaller.
Source: "..\dist\PRO-MAGAZYN\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\README.md";          DestDir: "{app}";      Flags: ignoreversion
Source: "..\LICENSE";            DestDir: "{app}";      Flags: ignoreversion
Source: "..\docs\*.md";          DestDir: "{app}\docs"; Flags: ignoreversion
Source: "..\data\dane_przykladowe.csv"; DestDir: "{app}\data"; Flags: ignoreversion

[Dirs]
Name: "{code:KatalogDanych}"
Name: "{code:KatalogDanych}\Kopie zapasowe"

[Icons]
Name: "{group}\{#NazwaAplikacji}";            Filename: "{app}\{#PlikExe}"
Name: "{group}\Instrukcja obsługi";           Filename: "{app}\docs\APLIKACJA.md"
Name: "{group}\Folder danych";                Filename: "{code:KatalogDanych}"
Name: "{group}\Odinstaluj {#NazwaAplikacji}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#NazwaAplikacji}";      Filename: "{app}\{#PlikExe}"; Tasks: desktopicon

[Registry]
; Opcjonalne powiązanie z plikami danych aplikacji.
Root: HKA; Subkey: "Software\Classes\PROMAGAZYN.Dane"; ValueType: string; \
    ValueData: "Plik danych PRO-MAGAZYN"; Flags: uninsdeletekey; Tasks: powiazanie
Root: HKA; Subkey: "Software\Classes\PROMAGAZYN.Dane\DefaultIcon"; ValueType: string; \
    ValueData: "{app}\{#PlikExe},0"; Tasks: powiazanie
Root: HKA; Subkey: "Software\Classes\PROMAGAZYN.Dane\shell\open\command"; ValueType: string; \
    ValueData: """{app}\{#PlikExe}"" ""%1"""; Tasks: powiazanie

[Run]
Filename: "{app}\{#PlikExe}"; Description: "Uruchom {#NazwaAplikacji}"; \
    Flags: postinstall nowait skipifsilent

[Code]
{ Folder danych użytkownika - tam trafia plik .xlsx i kopie zapasowe. }
function KatalogDanych(Param: String): String;
begin
  Result := ExpandConstant('{userdocs}') + '\PRO-MAGAZYN';
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    MsgBox('Instalacja zakończona.' + #13#10 + #13#10 +
           'Dane zapisują się w pliku Excela:' + #13#10 +
           KatalogDanych('') + '\PRO-MAGAZYN-dane.xlsx' + #13#10 + #13#10 +
           'Kopie zapasowe trafiają do podfolderu "Kopie zapasowe".' + #13#10 + #13#10 +
           'Aby pracować z dysku firmowego, użyj wersji przenośnej ' +
           '(folder PRO-MAGAZYN-portable) zamiast instalacji.',
           mbInformation, MB_OK);
  end;
end;
