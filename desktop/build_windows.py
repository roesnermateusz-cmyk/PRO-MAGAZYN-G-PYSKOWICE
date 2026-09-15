#!/usr/bin/env python3
"""Budowa aplikacji PRO-MAGAZYN dla Windows.

Skrypt przygotowuje dwa warianty:

* ``dist/PRO-MAGAZYN/``          - folder programu dla instalatora,
* ``dist/PRO-MAGAZYN-portable/`` - wersja przenośna na dysk firmowy
  (zawiera znacznik ``portable.txt``, więc dane trzymane są obok programu).

Uruchomienie (na Windows, z zainstalowanym Pythonem 3.11+):

    python -m pip install -r desktop/requirements.txt
    python desktop/build_windows.py

Wynik dla instalatora buduje się potem narzędziem Inno Setup:

    ISCC.exe installer\\PRO-MAGAZYN-APP.iss
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

KATALOG = Path(__file__).resolve().parent
KORZEN = KATALOG.parent
DIST = KORZEN / "dist"
BUILD = KORZEN / "build" / "pyinstaller"

NAZWA = "PRO-MAGAZYN"
sys.path.insert(0, str(KATALOG))
from promagazyn import APP_WERSJA  # noqa: E402


def wymagane_narzedzia() -> None:
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        print("Brak PyInstallera. Zainstaluj:  python -m pip install pyinstaller")
        raise SystemExit(1)


def zbuduj_ikone() -> Path | None:
    """Zapisuje ikonę programu do pliku .ico (wymaganego przez Windows)."""
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    try:
        from PySide6.QtGui import QIcon  # noqa: F401
        from PySide6.QtWidgets import QApplication

        from promagazyn.ui.ikony import ikona_aplikacji

        aplikacja = QApplication.instance() or QApplication([])
        sciezka = BUILD / "promagazyn.ico"
        sciezka.parent.mkdir(parents=True, exist_ok=True)

        ikona = ikona_aplikacji("#17A67C", 256)
        # Windows oczekuje kilku rozmiarów w jednym pliku .ico.
        mapy = [ikona.pixmap(rozmiar, rozmiar) for rozmiar in (16, 24, 32, 48, 64, 128, 256)]
        if not mapy[0].save(str(sciezka), "ICO"):
            return None
        _ = aplikacja
        return sciezka
    except Exception as blad:  # noqa: BLE001 - ikona jest opcjonalna
        print(f"Uwaga: nie udało się wygenerować ikony ({blad}).")
        return None


def uruchom_pyinstaller(ikona: Path | None) -> Path:
    polecenie = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm", "--clean",
        "--name", NAZWA,
        "--windowed",                      # bez okna konsoli
        "--distpath", str(DIST),
        "--workpath", str(BUILD),
        "--specpath", str(BUILD),
        "--paths", str(KATALOG),
        # Moduły Qt, których nie używamy - wycinamy, żeby paczka była mniejsza.
        "--exclude-module", "PySide6.QtNetwork",
        "--exclude-module", "PySide6.QtQml",
        "--exclude-module", "PySide6.QtQuick",
        "--exclude-module", "PySide6.Qt3DCore",
        "--exclude-module", "PySide6.QtMultimedia",
        "--exclude-module", "PySide6.QtWebEngineCore",
        "--exclude-module", "tkinter",
        "--exclude-module", "matplotlib",
        "--exclude-module", "numpy",
    ]
    if ikona is not None:
        polecenie += ["--icon", str(ikona)]
    polecenie.append(str(KATALOG / "uruchom.py"))

    print("Uruchamiam PyInstaller…")
    subprocess.run(polecenie, check=True)
    return DIST / NAZWA


def zbuduj_portable(folder_programu: Path) -> Path:
    """Kopiuje wynik i oznacza go jako wersję przenośną."""
    cel = DIST / f"{NAZWA}-portable"
    if cel.exists():
        shutil.rmtree(cel)
    # symlinks=True: na Linuksie biblioteki Qt są dowiązaniami; kopiowanie
    # ich zawartości podwoiłoby rozmiar paczki. Na Windows nie ma to znaczenia.
    shutil.copytree(folder_programu, cel, symlinks=True)

    (cel / "portable.txt").write_text(
        "Ten plik włącza tryb przenośny.\n"
        "Plik danych i kopie zapasowe trzymane są w podfolderze 'dane'\n"
        "obok programu, a nie w Dokumentach użytkownika.\n\n"
        "Skopiuj cały folder na dysk firmowy i uruchom PRO-MAGAZYN.exe.\n",
        encoding="utf-8",
    )
    (cel / "dane").mkdir(exist_ok=True)

    for nazwa in ("README.md", "LICENSE"):
        zrodlo = KORZEN / nazwa
        if zrodlo.exists():
            shutil.copy2(zrodlo, cel / nazwa)

    dokumentacja = cel / "dokumentacja"
    dokumentacja.mkdir(exist_ok=True)
    for plik in (KORZEN / "docs").glob("*.md"):
        shutil.copy2(plik, dokumentacja / plik.name)

    return cel


def main() -> int:
    wymagane_narzedzia()
    DIST.mkdir(parents=True, exist_ok=True)

    ikona = zbuduj_ikone()
    folder_programu = uruchom_pyinstaller(ikona)
    folder_portable = zbuduj_portable(folder_programu)

    print()
    print(f"Wersja {APP_WERSJA} zbudowana.")
    print(f"  program    : {folder_programu}")
    print(f"  przenośna  : {folder_portable}")
    print()
    print("Instalator:  ISCC.exe installer\\PRO-MAGAZYN-APP.iss")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
