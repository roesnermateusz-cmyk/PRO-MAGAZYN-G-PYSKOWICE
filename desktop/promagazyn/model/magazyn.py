"""Stany magazynowe w rozbiciu na lokalizacje i produkty.

Poprawki względem arkusza 1.x:
  * przesunięcia MM zdejmują towar z magazynu źródłowego i dokładają
    do docelowego (wcześniej były pomijane),
  * stan liczony jest per lokalizacja, nie tylko globalnie,
  * wiersze oznaczone jako SKORYGOWANE są pomijane.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from .jednostki import na_gj, na_mp, na_tony
from .operacja import Operacja, TypOperacji
from .ustawienia import Ustawienia


@dataclass
class PozycjaStanu:
    lokalizacja: str
    produkt: str
    mp: float = 0.0
    tony: float = 0.0
    wartosc: float = 0.0
    ostatnia_operacja: date | None = None

    @property
    def gj(self) -> float:
        return self.tony * 8.5

    @property
    def ujemna(self) -> bool:
        return self.mp < -0.001


def kierunek_ruchu(op: Operacja, lokalizacja: str) -> int:
    """Zwraca -1, 0 albo +1 dla wskazanego magazynu."""
    if op.typ is TypOperacji.TRANSPORT:
        return 0

    cel = lokalizacja.strip().upper()
    if not cel:
        return 0

    # Przesunięcie międzymagazynowe działa zawsze dwustronnie.
    if op.typ is TypOperacji.MM:
        if op.odbiorca.strip().upper() == cel:
            return 1
        if op.dostawca.strip().upper() == cel:
            return -1
        return 0

    # Pozostałe typy zmieniają stan tylko, gdy wiersz jest magazynowany.
    # Operacje przelotowe mają znacznik NIE i celowo nie ruszają stanu.
    if not op.czy_magazynowane:
        return 0

    if op.typ in (TypOperacji.ZAKUP, TypOperacji.PRODUKCJA):
        return 1 if op.odbiorca.strip().upper() == cel else 0
    if op.typ in (TypOperacji.SPRZEDAZ, TypOperacji.ZUZYCIE):
        return -1 if op.dostawca.strip().upper() == cel else 0
    return 0


def policz_stany(operacje: list[Operacja], ust: Ustawienia) -> list[PozycjaStanu]:
    """Zwraca stany magazynowe posortowane po lokalizacji i produkcie."""
    pozycje: dict[tuple[str, str], PozycjaStanu] = {}

    for op in operacje:
        if not op.aktywna or not op.produkt.strip() or not op.volumen:
            continue

        # Gdy dostawca i odbiorca to ten sam magazyn (np. zakup księgowany
        # na magazyn, który sam go przyjmuje), lokalizację liczymy raz -
        # inaczej ta sama operacja podbiłaby stan dwukrotnie.
        lokalizacje: list[str] = []
        for nazwa in (op.odbiorca, op.dostawca):
            if nazwa.strip() and nazwa.strip().upper() not in {
                istniejaca.strip().upper() for istniejaca in lokalizacje
            }:
                lokalizacje.append(nazwa)

        for lokalizacja in lokalizacje:
            kierunek = kierunek_ruchu(op, lokalizacja)
            if kierunek == 0:
                continue

            klucz = (lokalizacja.strip().upper(), op.produkt.strip().upper())
            pozycja = pozycje.get(klucz)
            if pozycja is None:
                pozycja = PozycjaStanu(lokalizacja.strip(), op.produkt.strip())
                pozycje[klucz] = pozycja

            pozycja.mp += kierunek * na_mp(op.volumen, op.jednostka, ust)
            pozycja.tony += kierunek * na_tony(op.volumen, op.jednostka, ust)
            if kierunek > 0:
                pozycja.wartosc += op.wartosc
            if op.data_operacji and (
                pozycja.ostatnia_operacja is None or op.data_operacji > pozycja.ostatnia_operacja
            ):
                pozycja.ostatnia_operacja = op.data_operacji

    wynik = [p for p in pozycje.values() if abs(p.mp) > 0.0001]
    wynik.sort(key=lambda p: (p.lokalizacja.upper(), p.produkt.upper()))
    return wynik


@dataclass
class PodsumowanieStanu:
    mp: float = 0.0
    tony: float = 0.0
    gj: float = 0.0
    pozycji: int = 0
    ujemnych: int = 0


def podsumuj(pozycje: list[PozycjaStanu], ust: Ustawienia) -> PodsumowanieStanu:
    suma = PodsumowanieStanu(pozycji=len(pozycje))
    for pozycja in pozycje:
        suma.mp += pozycja.mp
        suma.tony += pozycja.tony
        if pozycja.ujemna:
            suma.ujemnych += 1
    suma.gj = suma.tony * ust.gj_na_tone
    return suma


def stan_produktu(operacje: list[Operacja], lokalizacja: str, produkt: str, ust: Ustawienia) -> float:
    """Stan danego produktu w danej lokalizacji, w metrach przestrzennych."""
    suma = 0.0
    for op in operacje:
        if not op.aktywna or op.produkt.strip().upper() != produkt.strip().upper():
            continue
        kierunek = kierunek_ruchu(op, lokalizacja)
        if kierunek:
            suma += kierunek * na_mp(op.volumen, op.jednostka, ust)
    return round(suma, 3)
