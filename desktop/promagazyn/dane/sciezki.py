"""Ustalanie ścieżek: tryb przenośny kontra zainstalowany.

Aplikacja działa w dwóch trybach:

* **przenośny** - cały folder leży na dysku firmowym albo pendrivie,
  a plik danych i kopie zapasowe trzymane są obok programu,
* **zainstalowany** - program w Program Files, dane w Dokumentach.

Tryb rozpoznajemy po pliku znacznikowym ``portable.txt`` położonym obok
programu. Instalator go nie tworzy, paczka przenośna owszem.
"""

from __future__ import annotations

import getpass
import os
import platform
import socket
import sys
from pathlib import Path

NAZWA_PLIKU_DANYCH = "PRO-MAGAZYN-dane.xlsx"
ZNACZNIK_PORTABLE = "portable.txt"
PLIK_KONFIGURACJI = "promagazyn.ini"


def katalog_programu() -> Path:
    """Folder, w którym leży program (działa też po spakowaniu PyInstallerem)."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]


def tryb_przenosny() -> bool:
    return (katalog_programu() / ZNACZNIK_PORTABLE).exists()


def katalog_danych() -> Path:
    """Folder z plikiem danych, kopiami i konfiguracją stanowiska."""
    if tryb_przenosny():
        folder = katalog_programu() / "dane"
    elif platform.system() == "Windows":
        folder = Path(os.path.expanduser("~")) / "Documents" / "PRO-MAGAZYN"
    else:
        folder = Path(os.path.expanduser("~")) / "PRO-MAGAZYN"

    folder.mkdir(parents=True, exist_ok=True)
    return folder


def domyslny_plik_danych() -> Path:
    return katalog_danych() / NAZWA_PLIKU_DANYCH


def plik_konfiguracji() -> Path:
    """Konfiguracja stanowiska - zapamiętuje ostatnio używany plik danych."""
    return katalog_danych() / PLIK_KONFIGURACJI


def katalog_kopii(plik_danych: Path, wskazany: str = "") -> Path:
    folder = Path(wskazany) if wskazany.strip() else plik_danych.parent / "Kopie zapasowe"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def uzytkownik() -> str:
    try:
        return getpass.getuser()
    except Exception:  # noqa: BLE001 - brak nazwy użytkownika nie może zatrzymać programu
        return os.environ.get("USERNAME") or os.environ.get("USER") or "nieznany"


def stanowisko() -> str:
    try:
        return socket.gethostname()
    except Exception:  # noqa: BLE001
        return "nieznane"


def zapamietaj_plik_danych(sciezka: Path) -> None:
    """Zapisuje ostatnio otwarty plik, żeby aplikacja wróciła do niego przy starcie."""
    try:
        plik_konfiguracji().write_text(
            f"[stanowisko]\nplik_danych = {sciezka}\n", encoding="utf-8"
        )
    except OSError:
        pass


def ostatni_plik_danych() -> Path | None:
    plik = plik_konfiguracji()
    if not plik.exists():
        return None
    try:
        for linia in plik.read_text(encoding="utf-8").splitlines():
            if linia.strip().lower().startswith("plik_danych"):
                _, _, wartosc = linia.partition("=")
                sciezka = Path(wartosc.strip())
                if sciezka.exists():
                    return sciezka
    except OSError:
        return None
    return None
