"""Import i eksport kartoteki w formacie CSV.

Format: UTF-8, separator średnik, kropka jako separator dziesiętny -
plik jest niezależny od ustawień regionalnych stanowiska.
"""

from __future__ import annotations

import csv
from datetime import date, datetime
from pathlib import Path

from ..model.operacja import Operacja, Status, TypOperacji
from . import uklad
from .odczyt import _data, _data_czasu, _liczba, _tekst

SEPARATOR = ";"


def naglowki() -> list[str]:
    return list(uklad.KOLUMNY_DANE)


def operacja_na_pola(op: Operacja) -> list[str]:
    pola: list[str] = []
    for nazwa_pola in uklad.POLA_OPERACJI:
        wartosc = getattr(op, nazwa_pola)

        if nazwa_pola == "typ":
            pola.append(wartosc.value if isinstance(wartosc, TypOperacji) else str(wartosc or ""))
        elif nazwa_pola == "status":
            pola.append(wartosc.value if isinstance(wartosc, Status) else str(wartosc or ""))
        elif nazwa_pola == "czy_magazynowane":
            pola.append("TAK" if wartosc else "NIE")
        elif nazwa_pola in uklad.POLA_LICZBOWE:
            pola.append(f"{float(wartosc or 0):g}")
        elif isinstance(wartosc, datetime):
            pola.append(wartosc.strftime("%Y-%m-%d %H:%M:%S"))
        elif isinstance(wartosc, date):
            pola.append(wartosc.strftime("%Y-%m-%d"))
        elif wartosc is None:
            pola.append("")
        else:
            pola.append(str(wartosc))
    return pola


def pola_na_operacje(pola: list[str]) -> Operacja | None:
    """Zamienia wiersz CSV na operację; None gdy wiersz jest nieużyteczny."""
    def pole(numer: int) -> str:
        return pola[numer - 1] if numer - 1 < len(pola) else ""

    dane: dict[str, object] = {}
    for numer, nazwa_pola in enumerate(uklad.POLA_OPERACJI, start=1):
        wartosc = pole(numer)

        if nazwa_pola == "typ":
            typ = TypOperacji.z_tekstu(wartosc)
            if typ is None:
                return None
            dane[nazwa_pola] = typ
        elif nazwa_pola == "status":
            tekst = wartosc.strip().upper()
            dane[nazwa_pola] = next((s for s in Status if s.value == tekst), Status.AKTYWNY)
        elif nazwa_pola == "czy_magazynowane":
            dane[nazwa_pola] = wartosc.strip().upper() != "NIE"
        elif nazwa_pola in uklad.POLA_LICZBOWE:
            dane[nazwa_pola] = _liczba(wartosc)
        elif nazwa_pola in uklad.POLA_DATY:
            dane[nazwa_pola] = _data(wartosc)
        elif nazwa_pola in uklad.POLA_DATY_CZASU:
            dane[nazwa_pola] = _data_czasu(wartosc)
        else:
            dane[nazwa_pola] = _tekst(wartosc)

    operacja = Operacja(**dane)
    if operacja.data_operacji is None:
        return None
    return operacja


def zapisz(sciezka: Path, operacje: list[Operacja]) -> int:
    sciezka.parent.mkdir(parents=True, exist_ok=True)
    with sciezka.open("w", encoding="utf-8", newline="") as plik:
        zapis = csv.writer(plik, delimiter=SEPARATOR)
        zapis.writerow(naglowki())
        for operacja in operacje:
            zapis.writerow(operacja_na_pola(operacja))
    return len(operacje)


def wczytaj(sciezka: Path) -> tuple[list[Operacja], list[str]]:
    """Wczytuje operacje z CSV. Zwraca (operacje, opisy pominiętych wierszy)."""
    operacje: list[Operacja] = []
    pominiete: list[str] = []

    with sciezka.open(encoding="utf-8-sig", newline="") as plik:
        czytnik = csv.reader(plik, delimiter=SEPARATOR)
        next(czytnik, None)  # nagłówek
        for numer, wiersz in enumerate(czytnik, start=2):
            if not any(pole.strip() for pole in wiersz):
                continue
            operacja = pola_na_operacje(wiersz)
            if operacja is None:
                pominiete.append(f"wiersz {numer}: brak poprawnego typu operacji albo daty")
                continue
            if operacja.typ.towarowa and operacja.volumen == 0:
                pominiete.append(f"wiersz {numer}: zerowy wolumen")
                continue
            operacje.append(operacja)

    return operacje, pominiete
