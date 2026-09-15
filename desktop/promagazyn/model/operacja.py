"""Model pojedynczej operacji magazynowej.

Struktura odpowiada kolumnom 1-30 kartoteki (kolumny 31+ to formuły
przeliczeniowe odtwarzane przy zapisie do Excela).
"""

from __future__ import annotations

from dataclasses import dataclass, field, fields, replace
from datetime import date, datetime
from enum import Enum


class TypOperacji(str, Enum):
    """Typy operacji obsługiwane przez system."""

    ZAKUP = "ZAKUP"
    SPRZEDAZ = "SPRZEDAŻ"
    PRODUKCJA = "PRODUKCJA"
    ZUZYCIE = "ZUŻYCIE"
    MM = "MM"
    TRANSPORT = "TRANSPORT"

    @classmethod
    def z_tekstu(cls, wartosc: str | None) -> "TypOperacji | None":
        if not wartosc:
            return None
        szukane = str(wartosc).strip().upper()
        for typ in cls:
            if typ.value == szukane:
                return typ
        return None

    @property
    def towarowa(self) -> bool:
        """Czy operacja obraca towarem (TRANSPORT to sam koszt przewozu)."""
        return self is not TypOperacji.TRANSPORT

    @property
    def opis(self) -> str:
        return {
            TypOperacji.ZAKUP: "Przyjęcie towaru od dostawcy",
            TypOperacji.SPRZEDAZ: "Wydanie towaru do klienta",
            TypOperacji.PRODUKCJA: "Wytworzenie wyrobu",
            TypOperacji.ZUZYCIE: "Rozchód surowca",
            TypOperacji.MM: "Przesunięcie międzymagazynowe",
            TypOperacji.TRANSPORT: "Usługa przewozu (sam koszt)",
        }[self]


class Status(str, Enum):
    AKTYWNY = "AKTYWNY"
    SKORYGOWANY = "SKORYGOWANY"
    KOREKTA = "KOREKTA"


class Jednostka(str, Enum):
    MP = "MP"
    TON = "TON"
    M3 = "M3"
    GJ = "GJ"


@dataclass
class Operacja:
    """Jeden wiersz kartoteki."""

    typ: TypOperacji = TypOperacji.ZAKUP
    data_operacji: date | None = None
    data_zaladunku: date | None = None
    miejsce_zaladunku: str = ""
    dostawca: str = ""
    odbiorca: str = ""
    nr_wz: str = ""
    czy_magazynowane: bool = True
    deklaracja: str = ""
    produkt: str = ""
    volumen: float = 0.0
    jednostka: str = "MP"
    cena_zakupu: float = 0.0
    wartosc: float = 0.0
    cena_sprzedazy: float = 0.0
    rodzaj_zrebki: str = ""
    rabanie: str = ""
    koszt_rabania: float = 0.0
    przewoznik: str = ""
    nr_rejestracyjny: str = ""
    odleglosc: float = 0.0
    stawka_km: float = 0.0
    koszt_transportu: float = 0.0
    miejsce_pochodzenia: str = ""
    uwagi: str = ""
    utworzyl: str = ""
    data_dodania: datetime | None = None
    id_operacji: str = ""
    id_powiazania: str = ""
    status: Status = Status.AKTYWNY

    def kopia(self, **zmiany) -> "Operacja":
        """Zwraca kopię operacji z podmienionymi polami."""
        return replace(self, **zmiany)

    @property
    def aktywna(self) -> bool:
        """Czy wiersz liczy się do stanów i raportów."""
        return self.status is not Status.SKORYGOWANY

    def opis_skrocony(self) -> str:
        """Jednowierszowy opis używany w dzienniku zdarzeń i komunikatach."""
        data = self.data_operacji.strftime("%d.%m.%Y") if self.data_operacji else "—"
        czesci = [f"{self.typ.value} {data}"]

        if self.typ is TypOperacji.TRANSPORT:
            czesci.append(
                f"{self.przewoznik} {self.nr_rejestracyjny}".strip()
                or "przewóz bez danych pojazdu"
            )
            czesci.append(
                f"{self.odleglosc:g} km × {self.stawka_km:.2f} zł "
                f"= {self.koszt_transportu:,.2f} zł".replace(",", " ")
            )
        else:
            czesci.append(f"{self.produkt} {self.volumen:g} {self.jednostka}")
            czesci.append(f"{self.dostawca} → {self.odbiorca}")
            if self.wartosc:
                czesci.append(f"{self.wartosc:,.2f} zł".replace(",", " "))

        if self.nr_wz:
            czesci.append(f"WZ: {self.nr_wz}")
        return " | ".join(czesci)

    @staticmethod
    def nazwy_pol() -> list[str]:
        return [pole.name for pole in fields(Operacja)]


@dataclass
class OperacjeRownolegle:
    """Dodatkowe operacje generowane razem z zakupem."""

    produkcja: bool = False
    produkt_produkcji: str = ""
    volumen_produkcji: float = 0.0
    jednostka_produkcji: str = "MP"

    sprzedaz: bool = False
    odbiorca_sprzedazy: str = ""
    cena_sprzedazy: float = 0.0

    transport: bool = False
    przewoznik: str = ""
    nr_rejestracyjny: str = ""
    odleglosc: float = 0.0
    stawka_km: float = 0.0
    koszt_transportu: float = 0.0

    @property
    def cokolwiek(self) -> bool:
        return self.produkcja or self.sprzedaz or self.transport


@dataclass
class ZdarzenieAudytu:
    """Wpis dziennika zdarzeń."""

    data: datetime
    uzytkownik: str
    zdarzenie: str
    typ_operacji: str = ""
    id_operacji: str = ""
    opis: str = ""
