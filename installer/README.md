# Instalator Windows

Instalator budowany jest narzędziem [Inno Setup 6](https://jrsoftware.org/isinfo.php).

## Budowanie

1. Zbuduj skoroszyt:

   ```bash
   python3 build/build_workbook.py
   ```

2. Zainstaluj Inno Setup 6 (Windows).
3. Skompiluj instalator:

   ```cmd
   ISCC.exe installer\PRO-MAGAZYN.iss
   ```

Wynik: `installer\wyjscie\PRO-MAGAZYN-Setup-2.0.0.exe`.

## Co robi instalator

| Krok | Opis |
|---|---|
| Sprawdzenie środowiska | Ostrzega, gdy nie wykryto Microsoft Excela |
| Instalacja programu | `C:\Program Files\PRO-MAGAZYN` — wzorzec pliku, dokumentacja, konfiguracja |
| Plik roboczy | `Dokumenty\PRO-MAGAZYN\PRO-MAGAZYN.xlsm` — **nie nadpisuje istniejącego** |
| Folder kopii | `Dokumenty\PRO-MAGAZYN\Kopie zapasowe` |
| Odblokowanie makr | Usuwa `Zone.Identifier` (Mark-of-the-Web), żeby Windows nie blokował makr |
| Skróty | Menu Start oraz opcjonalnie pulpit |
| Konfiguracja | Zapisuje wybrane ścieżki do `config\ustawienia.ini` |

## Aktualizacja

Ponowne uruchomienie instalatora podmienia program i dokumentację, ale
**pozostawia plik roboczy użytkownika nietknięty** (flaga `onlyifdoesntexist`).
Kartoteka nigdy nie jest kasowana przez aktualizację ani deinstalację.
