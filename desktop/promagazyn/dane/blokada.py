"""Blokada pliku danych przy pracy z dysku firmowego.

Kilka osób może uruchomić program z tego samego folderu sieciowego.
Żeby nie nadpisali sobie nawzajem zmian, edycja wymaga zajęcia blokady:
pliku ``<nazwa>.lock`` leżącego obok pliku danych.

Blokada jest doradcza, ale wystarczająca: zakładamy ją atomowo
(``O_CREAT | O_EXCL``), odświeżamy w trakcie pracy i zwalniamy przy
zamknięciu. Blokada bez odświeżenia dłużej niż ``PRZETERMINOWANIE``
uznawana jest za porzuconą (np. po zaniku sieci).
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from .sciezki import stanowisko, uzytkownik

PRZETERMINOWANIE = timedelta(minutes=15)


@dataclass
class InformacjeOBlokadzie:
    uzytkownik: str
    stanowisko: str
    od: datetime | None

    def opis(self) -> str:
        kiedy = f" od {self.od:%H:%M}" if self.od else ""
        return f"{self.uzytkownik} ({self.stanowisko}){kiedy}"


class Blokada:
    """Blokada pojedynczego pliku danych."""

    def __init__(self, plik_danych: Path) -> None:
        self.plik_danych = plik_danych
        self.plik_blokady = plik_danych.with_suffix(plik_danych.suffix + ".lock")
        self.zajeta = False

    # --- odczyt stanu ---------------------------------------------------
    def informacje(self) -> InformacjeOBlokadzie | None:
        if not self.plik_blokady.exists():
            return None
        try:
            tresc = self.plik_blokady.read_text(encoding="utf-8")
        except OSError:
            return None

        dane = {}
        for linia in tresc.splitlines():
            klucz, _, wartosc = linia.partition("=")
            dane[klucz.strip()] = wartosc.strip()

        od = None
        try:
            od = datetime.fromisoformat(dane.get("odswiezono", ""))
        except ValueError:
            pass

        return InformacjeOBlokadzie(
            uzytkownik=dane.get("uzytkownik", "nieznany"),
            stanowisko=dane.get("stanowisko", "nieznane"),
            od=od,
        )

    def przeterminowana(self) -> bool:
        info = self.informacje()
        if info is None or info.od is None:
            return False
        return datetime.now() - info.od > PRZETERMINOWANIE

    # --- zajmowanie i zwalnianie ---------------------------------------
    def zajmij(self) -> bool:
        """Próbuje zająć blokadę. Zwraca True przy powodzeniu."""
        if self.zajeta:
            return True

        if self.plik_blokady.exists() and self.przeterminowana():
            # Porzucona blokada po zaniku sieci albo awarii programu.
            try:
                self.plik_blokady.unlink()
            except OSError:
                return False

        try:
            uchwyt = os.open(self.plik_blokady, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            return False
        except OSError:
            # Brak prawa zapisu w folderze - pracujemy bez blokady.
            return False

        with os.fdopen(uchwyt, "w", encoding="utf-8") as plik:
            plik.write(self._tresc())
        self.zajeta = True
        return True

    def odswiez(self) -> None:
        """Przedłuża ważność blokady - wywoływane cyklicznie w trakcie pracy."""
        if not self.zajeta:
            return
        try:
            self.plik_blokady.write_text(self._tresc(), encoding="utf-8")
        except OSError:
            pass

    def zwolnij(self) -> None:
        if not self.zajeta:
            return
        try:
            self.plik_blokady.unlink(missing_ok=True)
        except OSError:
            pass
        self.zajeta = False

    def _tresc(self) -> str:
        return (
            f"uzytkownik = {uzytkownik()}\n"
            f"stanowisko = {stanowisko()}\n"
            f"odswiezono = {datetime.now().isoformat(timespec='seconds')}\n"
            f"pid = {os.getpid()}\n"
        )

    def __enter__(self) -> "Blokada":
        self.zajmij()
        return self

    def __exit__(self, *_) -> None:
        self.zwolnij()
