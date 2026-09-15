"""Kopie zapasowe pliku danych z rotacją."""

from __future__ import annotations

import shutil
from datetime import date, datetime
from pathlib import Path

from .sciezki import katalog_kopii

WZORZEC = "_kopia_"


def utworz_kopie(plik_danych: Path, folder_docelowy: str = "", ile_zachowac: int = 30) -> Path | None:
    """Kopiuje aktualny plik danych do folderu kopii. Zwraca ścieżkę kopii."""
    if not plik_danych.exists():
        return None

    folder = katalog_kopii(plik_danych, folder_docelowy)
    nazwa = f"{plik_danych.stem}{WZORZEC}{datetime.now():%Y-%m-%d_%H%M%S}{plik_danych.suffix}"
    cel = folder / nazwa

    try:
        shutil.copy2(plik_danych, cel)
    except OSError:
        return None

    usun_stare(folder, ile_zachowac)
    return cel


def lista_kopii(plik_danych: Path, folder_docelowy: str = "") -> list[Path]:
    folder = katalog_kopii(plik_danych, folder_docelowy)
    kopie = [plik for plik in folder.glob(f"*{WZORZEC}*") if plik.is_file()]
    return sorted(kopie, key=lambda plik: plik.stat().st_mtime, reverse=True)


def usun_stare(folder: Path, ile_zachowac: int) -> int:
    """Kasuje najstarsze kopie, zostawiając wskazaną liczbę. Zwraca ile usunięto."""
    if ile_zachowac <= 0:
        return 0

    kopie = sorted(
        (plik for plik in folder.glob(f"*{WZORZEC}*") if plik.is_file()),
        key=lambda plik: plik.stat().st_mtime,
        reverse=True,
    )
    usuniete = 0
    for plik in kopie[ile_zachowac:]:
        try:
            plik.unlink()
            usuniete += 1
        except OSError:
            continue
    return usuniete


def kopia_potrzebna(ostatnia: str) -> bool:
    """Czy kopia automatyczna nie powstała jeszcze dzisiaj."""
    return str(ostatnia).strip() != date.today().isoformat()
