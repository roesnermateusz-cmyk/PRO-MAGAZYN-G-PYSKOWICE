"""Słowniki list rozwijanych oraz podpowiedzi autouzupełniania.

Słowniki uzupełniają się same wartościami z kartoteki, więc listy nigdy
się nie starzeją. Podpowiedzi uczą się z historii operacji.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

from .operacja import Operacja, TypOperacji

# Klucz słownika -> pozycje stałe, których nie wyprowadzamy z danych.
STALE: dict[str, list[str]] = {
    "TYP_OPERACJI": [t.value for t in TypOperacji],
    "JEDNOSTKA": ["MP", "TON", "M3", "GJ"],
    "TAK_NIE": ["TAK", "NIE"],
    "DEKLARACJA": ["Deklaracja", "KZR"],
    "ZREBKA": ["A", "B"],
    "RABANIE": ["własne", "ECO-Rest"],
    "STATUS": ["AKTYWNY", "SKORYGOWANY", "KOREKTA"],
}

# Klucz słownika -> pola operacji, z których zbieramy wartości.
ZRODLA: dict[str, tuple[str, ...]] = {
    "PRODUKT": ("produkt",),
    "JEDNOSTKA": ("jednostka",),
    "DOSTAWCA": ("dostawca",),
    "ODBIORCA": ("odbiorca",),
    "MIEJSCE": ("miejsce_zaladunku", "miejsce_pochodzenia"),
    "PRZEWOZNIK": ("przewoznik",),
    "POJAZD": ("nr_rejestracyjny",),
    "OPERATOR": ("utworzyl",),
    "DEKLARACJA": ("deklaracja",),
    "ZREBKA": ("rodzaj_zrebki",),
    "RABANIE": ("rabanie",),
}

KOLEJNOSC = [
    "TYP_OPERACJI", "PRODUKT", "JEDNOSTKA", "DOSTAWCA", "ODBIORCA", "MIEJSCE",
    "PRZEWOZNIK", "POJAZD", "OPERATOR", "TAK_NIE", "DEKLARACJA", "ZREBKA",
    "RABANIE", "STATUS",
]


@dataclass
class Slowniki:
    """Zbiór list rozwijanych systemu."""

    pozycje: dict[str, list[str]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for klucz in KOLEJNOSC:
            self.pozycje.setdefault(klucz, list(STALE.get(klucz, [])))

    def lista(self, klucz: str) -> list[str]:
        return self.pozycje.get(klucz.upper(), [])

    def dodaj(self, klucz: str, wartosc: str) -> bool:
        """Dopisuje pozycję, jeżeli jeszcze jej nie ma. Zwraca True przy zapisie."""
        wartosc = (wartosc or "").strip()
        if not wartosc:
            return False
        lista = self.pozycje.setdefault(klucz.upper(), [])
        if any(pozycja.upper() == wartosc.upper() for pozycja in lista):
            return False
        lista.append(wartosc)
        return True

    def uzupelnij_z_operacji(self, op: Operacja) -> None:
        for klucz, pola in ZRODLA.items():
            for nazwa_pola in pola:
                self.dodaj(klucz, str(getattr(op, nazwa_pola, "") or ""))

    def przebuduj(self, operacje: list[Operacja]) -> None:
        """Odtwarza słowniki od zera na podstawie całej kartoteki."""
        self.pozycje = {klucz: list(STALE.get(klucz, [])) for klucz in KOLEJNOSC}
        for op in operacje:
            self.uzupelnij_z_operacji(op)
        self.posortuj()

    def posortuj(self) -> None:
        for klucz in ZRODLA:
            if klucz in STALE:
                continue
            self.pozycje[klucz] = sorted(self.pozycje.get(klucz, []), key=str.upper)


@dataclass
class Podpowiedzi:
    """Propozycje uzupełnienia pól wyliczane z historii operacji."""

    operacje: list[Operacja] = field(default_factory=list)

    def _najczestsza(self, wedlug: str, wartosc: str, szukane: str) -> str:
        wartosc = (wartosc or "").strip().upper()
        if not wartosc:
            return ""
        licznik: Counter[str] = Counter()
        pisownia: dict[str, str] = {}
        for op in self.operacje:
            if str(getattr(op, wedlug, "") or "").strip().upper() != wartosc:
                continue
            znaleziona = str(getattr(op, szukane, "") or "").strip()
            if znaleziona:
                klucz = znaleziona.upper()
                licznik[klucz] += 1
                pisownia.setdefault(klucz, znaleziona)
        if not licznik:
            return ""
        return pisownia[licznik.most_common(1)[0][0]]

    def _ostatnia_liczba(self, wedlug: str, wartosc: str, szukane: str) -> float:
        wartosc = (wartosc or "").strip().upper()
        if not wartosc:
            return 0.0
        for op in reversed(self.operacje):
            if str(getattr(op, wedlug, "") or "").strip().upper() != wartosc:
                continue
            liczba = float(getattr(op, szukane, 0) or 0)
            if liczba > 0:
                return liczba
        return 0.0

    # --- podpowiedzi używane przez formularz ----------------------------
    def pojazd_przewoznika(self, przewoznik: str) -> str:
        return self._najczestsza("przewoznik", przewoznik, "nr_rejestracyjny")

    def stawka_przewoznika(self, przewoznik: str) -> float:
        return self._ostatnia_liczba("przewoznik", przewoznik, "stawka_km")

    def przewoznik_pojazdu(self, pojazd: str) -> str:
        return self._najczestsza("nr_rejestracyjny", pojazd, "przewoznik")

    def miejsce_dostawcy(self, dostawca: str) -> str:
        return self._najczestsza("dostawca", dostawca, "miejsce_zaladunku")

    def produkt_dostawcy(self, dostawca: str) -> str:
        return self._najczestsza("dostawca", dostawca, "produkt")

    def jednostka_produktu(self, produkt: str) -> str:
        return self._najczestsza("produkt", produkt, "jednostka")

    def cena_zakupu(self, dostawca: str, produkt: str) -> float:
        return self._ostatnia_para(TypOperacji.ZAKUP, "dostawca", dostawca, produkt, "cena_zakupu")

    def cena_sprzedazy(self, odbiorca: str, produkt: str) -> float:
        return self._ostatnia_para(TypOperacji.SPRZEDAZ, "odbiorca", odbiorca, produkt, "cena_sprzedazy")

    def _ostatnia_para(
        self, typ: TypOperacji, pole: str, wartosc: str, produkt: str, szukane: str
    ) -> float:
        wartosc = (wartosc or "").strip().upper()
        produkt = (produkt or "").strip().upper()
        if not wartosc or not produkt:
            return 0.0
        for op in reversed(self.operacje):
            if op.typ is not typ:
                continue
            if str(getattr(op, pole, "") or "").strip().upper() != wartosc:
                continue
            if op.produkt.strip().upper() != produkt:
                continue
            cena = float(getattr(op, szukane, 0) or 0)
            if cena > 0:
                return cena
        return 0.0

    def nastepny_numer_wz(self, prefiks: str) -> str:
        """Proponuje kolejny numer w formacie PREFIKS/NUMER."""
        najwyzszy = 0
        for op in self.operacje:
            numer = op.nr_wz.strip()
            if "/" not in numer:
                continue
            czesc_prefiksu, _, czesc_numeru = numer.rpartition("/")
            if czesc_prefiksu.upper() != prefiks.upper():
                continue
            if czesc_numeru.isdigit():
                najwyzszy = max(najwyzszy, int(czesc_numeru))
        return f"{prefiks}/{najwyzszy + 1}"
