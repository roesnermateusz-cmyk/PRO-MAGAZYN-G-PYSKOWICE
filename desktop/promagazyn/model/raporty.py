"""Raporty: szczegółowy z filtrami, roczny i zestawienie transportu."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from .jednostki import na_mp, na_tony
from .operacja import Operacja, TypOperacji
from .ustawienia import Ustawienia

MIESIACE = [
    "STYCZEŃ", "LUTY", "MARZEC", "KWIECIEŃ", "MAJ", "CZERWIEC",
    "LIPIEC", "SIERPIEŃ", "WRZESIEŃ", "PAŹDZIERNIK", "LISTOPAD", "GRUDZIEŃ",
]

WSZYSTKIE = "WSZYSTKIE"


@dataclass
class Filtr:
    rok: str = WSZYSTKIE
    miesiac: str = WSZYSTKIE
    typ: str = WSZYSTKIE
    produkt: str = WSZYSTKIE
    kontrahent: str = WSZYSTKIE
    lokalizacja: str = WSZYSTKIE
    tekst: str = ""

    def pasuje(self, op: Operacja) -> bool:
        if op.data_operacji is None:
            return False

        if self._ustawiony(self.rok) and str(op.data_operacji.year) != self.rok.strip():
            return False
        if self._ustawiony(self.miesiac):
            if MIESIACE[op.data_operacji.month - 1] != self.miesiac.strip().upper():
                return False
        if self._ustawiony(self.typ) and op.typ.value != self.typ.strip().upper():
            return False
        if self._ustawiony(self.produkt) and op.produkt.strip().upper() != self.produkt.strip().upper():
            return False
        if self._ustawiony(self.kontrahent):
            szukany = self.kontrahent.strip().upper()
            if szukany not in (op.dostawca.strip().upper(), op.odbiorca.strip().upper()):
                return False
        if self._ustawiony(self.lokalizacja):
            szukana = self.lokalizacja.strip().upper()
            if szukana not in (
                op.miejsce_zaladunku.strip().upper(),
                op.miejsce_pochodzenia.strip().upper(),
            ):
                return False
        if self.tekst.strip():
            fraza = self.tekst.strip().lower()
            pola = " ".join([
                op.produkt, op.dostawca, op.odbiorca, op.nr_wz, op.przewoznik,
                op.nr_rejestracyjny, op.uwagi, op.utworzyl, op.id_operacji,
            ]).lower()
            if fraza not in pola:
                return False
        return True

    @staticmethod
    def _ustawiony(wartosc: str) -> bool:
        return bool(wartosc) and wartosc.strip().upper() != WSZYSTKIE


@dataclass
class Podsumowanie:
    operacji: int = 0
    wolumen_mp: float = 0.0
    wolumen_t: float = 0.0
    zakup: float = 0.0
    sprzedaz: float = 0.0
    transport: float = 0.0
    rabanie: float = 0.0

    @property
    def marza(self) -> float:
        return self.sprzedaz - self.zakup - self.transport - self.rabanie


def filtruj(operacje: list[Operacja], filtr: Filtr) -> list[Operacja]:
    return [op for op in operacje if filtr.pasuje(op)]


def podsumuj(operacje: list[Operacja], ust: Ustawienia) -> Podsumowanie:
    wynik = Podsumowanie(operacji=len(operacje))
    for op in operacje:
        mp = na_mp(op.volumen, op.jednostka, ust)
        wynik.wolumen_mp += mp
        wynik.wolumen_t += na_tony(op.volumen, op.jednostka, ust)
        wynik.transport += op.koszt_transportu
        wynik.rabanie += op.koszt_rabania * mp
        if op.typ is TypOperacji.ZAKUP:
            wynik.zakup += op.wartosc
        elif op.typ is TypOperacji.SPRZEDAZ:
            wynik.sprzedaz += op.wartosc
    return wynik


@dataclass
class WierszRoczny:
    miesiac: str
    operacji: int = 0
    wolumen_mp: float = 0.0
    zakup: float = 0.0
    sprzedaz: float = 0.0
    transport: float = 0.0

    @property
    def marza(self) -> float:
        return self.sprzedaz - self.zakup - self.transport


def raport_roczny(operacje: list[Operacja], rok: int, ust: Ustawienia) -> list[WierszRoczny]:
    wiersze = [WierszRoczny(nazwa) for nazwa in MIESIACE]

    for op in operacje:
        if not op.aktywna or op.data_operacji is None or op.data_operacji.year != rok:
            continue
        wiersz = wiersze[op.data_operacji.month - 1]
        wiersz.operacji += 1
        wiersz.wolumen_mp += na_mp(op.volumen, op.jednostka, ust)
        wiersz.transport += op.koszt_transportu
        if op.typ is TypOperacji.ZAKUP:
            wiersz.zakup += op.wartosc
        elif op.typ is TypOperacji.SPRZEDAZ:
            wiersz.sprzedaz += op.wartosc

    return wiersze


@dataclass
class WierszTransportu:
    przewoznik: str
    kursow: int = 0
    kilometry: float = 0.0
    koszt: float = 0.0

    @property
    def srednia_stawka(self) -> float:
        return self.koszt / self.kilometry if self.kilometry else 0.0

    @property
    def rodzaj(self) -> str:
        return typ_transportu(self.przewoznik)


def typ_transportu(przewoznik: str) -> str:
    """Klasyfikuje przewoźnika jako własnego albo zewnętrznego.

    Poprawka: wersja 1.x rozpoznawała tylko dwie nazwy, przez co kursy
    zapisane jako „własny (Wilczak)” trafiały do transportu zewnętrznego.
    """
    nazwa = (przewoznik or "").strip().lower()
    if not nazwa:
        return ""
    if nazwa == "brak":
        return "Brak"
    if "własn" in nazwa or "wlasn" in nazwa or "wojciechowski" in nazwa:
        return "Własny"
    return "Zewnętrzny"


def raport_transportu(operacje: list[Operacja]) -> list[WierszTransportu]:
    wiersze: dict[str, WierszTransportu] = {}

    for op in operacje:
        nazwa = op.przewoznik.strip()
        if not nazwa:
            continue
        wiersz = wiersze.setdefault(nazwa.upper(), WierszTransportu(nazwa))
        wiersz.kursow += 1
        wiersz.kilometry += op.odleglosc
        wiersz.koszt += op.koszt_transportu

    return sorted(wiersze.values(), key=lambda w: -w.koszt)
