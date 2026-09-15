#!/usr/bin/env python3
"""Generator skoroszytu PRO-MAGAZYN (.xlsm).

Sklada kompletny system magazynowy:

  * arkusze START / FORMULARZ / Dane / MAGAZYN / RAPORTY / SLOWNIK /
    HISTORIA / USTAWIENIA,
  * tabele "Tabela_dane" z kolumnami wyliczanymi,
  * listy rozwijane na wszystkich kolumnach kartoteki i polach formularza,
  * projekt VBA zbudowany ze zrodel w src/vba.

Uruchomienie:
    python3 build/build_workbook.py [--dane data/kartoteka.csv] [--wyjscie dist/PRO-MAGAZYN.xlsm]
"""

from __future__ import annotations

import argparse
import csv
import re
import shutil
import sys
import zipfile
from datetime import datetime
from pathlib import Path

KATALOG = Path(__file__).resolve().parent
KORZEN = KATALOG.parent
sys.path.insert(0, str(KATALOG))
sys.path.insert(0, str(KORZEN / "tools"))

import openpyxl  # noqa: E402
from openpyxl.formatting.rule import CellIsRule  # noqa: E402
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side  # noqa: E402
from openpyxl.utils import get_column_letter  # noqa: E402
from openpyxl.workbook.defined_name import DefinedName  # noqa: E402
from openpyxl.worksheet.datavalidation import DataValidation  # noqa: E402
from openpyxl.worksheet.table import Table, TableStyleInfo  # noqa: E402

import uklad  # noqa: E402
from vbabuild import Module, build as build_vba  # noqa: E402

# --- Paleta -----------------------------------------------------------------
GRANAT = "1F3A5F"
ZIELONY = "10845A"
JASNY = "F2F5F8"
SZARY = "5A626E"
BIALY = "FFFFFF"
AKCENT = "E8EEF4"

CIENKA = Side(style="thin", color="C8D0DA")
RAMKA = Border(left=CIENKA, right=CIENKA, top=CIENKA, bottom=CIENKA)


def naglowek(komorka, tlo=GRANAT, kolor=BIALY, rozmiar=11):
    komorka.font = Font(bold=True, color=kolor, size=rozmiar, name="Segoe UI")
    komorka.fill = PatternFill("solid", fgColor=tlo)
    komorka.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    komorka.border = RAMKA


def tytul(arkusz, komorka, tekst, rozmiar=18):
    arkusz[komorka] = tekst
    arkusz[komorka].font = Font(bold=True, size=rozmiar, color=GRANAT, name="Segoe UI")


# ============================================================================
#  Wczytanie kartoteki
# ============================================================================


def wczytaj_kartoteke(sciezka: Path) -> list[list]:
    if not sciezka.exists():
        print(f"UWAGA: brak pliku {sciezka} - skoroszyt powstanie z pusta kartoteka.")
        return []

    wiersze = []
    with sciezka.open(encoding="utf-8", newline="") as plik:
        czytnik = csv.reader(plik, delimiter=";")
        next(czytnik, None)  # naglowek
        for surowy in czytnik:
            if not any(pole.strip() for pole in surowy):
                continue
            wiersze.append(konwertuj_wiersz(surowy))
    return wiersze


def konwertuj_wiersz(surowy: list[str]) -> list:
    """Zamienia pola tekstowe CSV na typy Excela (daty, liczby)."""
    liczbowe = {9, 11, 12, 13, 17, 20, 21, 22}  # 1-based
    daty = {1, 3}
    datyczas = {27}

    wynik: list = []
    for numer in range(1, len(uklad.KOLUMNY_DANE) + 1):
        wartosc = surowy[numer - 1] if numer - 1 < len(surowy) else ""
        wartosc = wartosc.strip()

        if not wartosc:
            wynik.append(None)
        elif numer in liczbowe:
            try:
                wynik.append(float(wartosc))
            except ValueError:
                wynik.append(None)
        elif numer in daty:
            wynik.append(parsuj_date(wartosc))
        elif numer in datyczas:
            wynik.append(parsuj_date(wartosc, z_czasem=True))
        else:
            wynik.append(wartosc)
    return wynik


def parsuj_date(wartosc: str, z_czasem: bool = False):
    for wzorzec in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(wartosc, wzorzec)
        except ValueError:
            continue
    return wartosc


# ============================================================================
#  Arkusze
# ============================================================================


def zbuduj_start(arkusz):
    arkusz.sheet_view.showGridLines = False
    for kolumna, szerokosc in zip("ABCDEFGHI", [2, 22, 18, 18, 18, 22, 18, 18, 4]):
        arkusz.column_dimensions[kolumna].width = szerokosc

    tytul(arkusz, "B2", "PRO-MAGAZYN", 26)
    arkusz["B3"] = "System ewidencji magazynowej - biomasa i drewno"
    arkusz["B3"].font = Font(size=12, color=SZARY, name="Segoe UI")
    arkusz["B4"] = "ResInvest Commodities  |  wersja 2.0.0"
    arkusz["B4"].font = Font(size=10, italic=True, color=SZARY, name="Segoe UI")

    for kolumna, etykieta in (("B", "Operacji w kartotece"), ("D", "Zdarzeń w dzienniku"), ("F", "Ostatnie odświeżenie")):
        arkusz[f"{kolumna}6"] = etykieta
        arkusz[f"{kolumna}6"].font = Font(size=9, bold=True, color=SZARY, name="Segoe UI")

    for komorka in ("C7", "E7", "G7"):
        arkusz[komorka].font = Font(size=14, bold=True, color=GRANAT, name="Segoe UI")
    arkusz["G7"].number_format = "dd.mm.yyyy hh:mm"

    arkusz["B8"] = "Przyciski poniżej uruchamiają moduły systemu."
    arkusz["B8"].font = Font(size=9, italic=True, color=SZARY, name="Segoe UI")

    # Miejsce na przyciski rysowane przez VBA (wiersze 10-22).
    for wiersz in range(10, 23):
        arkusz.row_dimensions[wiersz].height = 23

    arkusz["B24"] = (
        "Skróty:  Ctrl+Shift+N nowa operacja   |   Ctrl+Shift+Z zapisz   |   "
        "Ctrl+Shift+M magazyn   |   Ctrl+Shift+R raporty"
    )
    arkusz["B24"].font = Font(size=9, color=SZARY, name="Segoe UI")


def zbuduj_formularz(arkusz):
    arkusz.sheet_view.showGridLines = False
    arkusz.column_dimensions["A"].hidden = True
    arkusz.column_dimensions["A"].width = 2
    arkusz.column_dimensions["B"].width = 34
    arkusz.column_dimensions["C"].width = 30
    arkusz.column_dimensions["D"].width = 48
    arkusz.column_dimensions["E"].width = 3
    arkusz.column_dimensions["F"].width = 16
    arkusz.column_dimensions["G"].width = 16

    tytul(arkusz, "B1", "NOWA OPERACJA MAGAZYNOWA", 16)
    arkusz["B2"] = "Pola oznaczone * są obowiązkowe. Wartości wybieraj z list rozwijanych."
    arkusz["B2"].font = Font(size=9, italic=True, color=SZARY, name="Segoe UI")

    wiersz = 4
    pola: dict[str, int] = {}

    for pozycja in uklad.FORMULARZ:
        if pozycja[0] == "blank":
            arkusz.row_dimensions[wiersz].height = 6
            wiersz += 1
            continue

        if pozycja[0] == "section":
            arkusz.cell(row=wiersz, column=2, value=pozycja[1])
            for kolumna in range(2, 5):
                komorka = arkusz.cell(row=wiersz, column=kolumna)
                komorka.fill = PatternFill("solid", fgColor=GRANAT)
                komorka.font = Font(bold=True, color=BIALY, size=10, name="Segoe UI")
            arkusz.row_dimensions[wiersz].height = 20
            wiersz += 1
            continue

        _, klucz, etykieta, podpowiedz, format_liczb = pozycja
        arkusz.cell(row=wiersz, column=1, value=klucz)

        komorka_etykiety = arkusz.cell(row=wiersz, column=2, value=etykieta)
        komorka_etykiety.font = Font(size=10, bold=etykieta.endswith("*"), name="Segoe UI")
        komorka_etykiety.alignment = Alignment(vertical="center")

        komorka_wartosci = arkusz.cell(row=wiersz, column=3)
        komorka_wartosci.fill = PatternFill("solid", fgColor=BIALY)
        komorka_wartosci.border = RAMKA
        komorka_wartosci.number_format = format_liczb
        komorka_wartosci.font = Font(size=11, name="Segoe UI")
        komorka_wartosci.alignment = Alignment(vertical="center")

        komorka_podpowiedzi = arkusz.cell(row=wiersz, column=4, value=podpowiedz)
        komorka_podpowiedzi.font = Font(size=9, italic=True, color=SZARY, name="Segoe UI")

        arkusz.row_dimensions[wiersz].height = 18
        pola[klucz] = wiersz
        wiersz += 1

    # Listy rozwijane na polach formularza.
    for klucz, slownik in uklad.LISTY_FORMULARZA.items():
        if klucz not in pola:
            continue
        sprawdzanie = DataValidation(
            type="list",
            formula1=f"sl_{slownik}",
            allow_blank=True,
            showDropDown=False,
            errorStyle="information",
            error="Ta pozycja nie występuje jeszcze w słowniku - zostanie do niego dopisana.",
            errorTitle="Wartość spoza słownika",
        )
        arkusz.add_data_validation(sprawdzanie)
        sprawdzanie.add(arkusz.cell(row=pola[klucz], column=3))

    # Wartości domyślne.
    arkusz.cell(row=pola["TYP"], column=3, value="ZAKUP")
    arkusz.cell(row=pola["CZY_MAG"], column=3, value="TAK")
    arkusz.cell(row=pola["STAWKA_KM"], column=3, value=5)
    for klucz in ("ROWN_PRODUKCJA", "ROWN_SPRZEDAZ", "ROWN_TRANSPORT"):
        arkusz.cell(row=pola[klucz], column=3, value="NIE")

    return pola


def zbuduj_dane(arkusz, wiersze):
    arkusz.freeze_panes = "A2"

    wszystkie = uklad.KOLUMNY_DANE + [nazwa for nazwa, _, _ in uklad.KOLUMNY_WYLICZANE]
    for numer, nazwa in enumerate(wszystkie, start=1):
        naglowek(arkusz.cell(row=1, column=numer, value=nazwa), rozmiar=9)
    arkusz.row_dimensions[1].height = 34

    for przesuniecie, dane in enumerate(wiersze):
        numer_wiersza = przesuniecie + 2
        for numer_kolumny, wartosc in enumerate(dane, start=1):
            arkusz.cell(row=numer_wiersza, column=numer_kolumny, value=wartosc)

    # Kartoteka nie może być pusta - tabela Excela wymaga wiersza danych.
    ostatni = max(len(wiersze) + 1, 2)

    for przesuniecie, (_, szablon, format_liczb) in enumerate(uklad.KOLUMNY_WYLICZANE):
        numer_kolumny = len(uklad.KOLUMNY_DANE) + 1 + przesuniecie
        for numer_wiersza in range(2, ostatni + 1):
            komorka = arkusz.cell(row=numer_wiersza, column=numer_kolumny)
            komorka.value = szablon.format(r=numer_wiersza)
            komorka.number_format = format_liczb

    # Formaty kolumn wypełnianych przez silnik.
    formaty = {
        1: "dd.mm.yyyy", 3: "dd.mm.yyyy", 9: "# ##0.000", 11: "# ##0.00 zł",
        12: "# ##0.00 zł", 13: "# ##0.00 zł", 17: "# ##0.00 zł", 20: "# ##0.00",
        21: "# ##0.00 zł", 22: "# ##0.00 zł", 27: "dd.mm.yyyy hh:mm",
    }
    for numer_kolumny, format_liczb in formaty.items():
        for numer_wiersza in range(2, ostatni + 1):
            arkusz.cell(row=numer_wiersza, column=numer_kolumny).number_format = format_liczb

    szerokosci = {
        1: 13, 2: 20, 3: 13, 4: 28, 5: 13, 6: 11, 7: 10, 8: 13, 9: 11, 10: 8,
        11: 14, 12: 15, 13: 14, 14: 30, 15: 9, 16: 16, 17: 12, 18: 24, 19: 14,
        20: 11, 21: 11, 22: 14, 23: 24, 24: 20, 25: 34, 26: 20, 27: 17, 28: 20,
        29: 20, 30: 14,
    }
    for numer_kolumny, szerokosc in szerokosci.items():
        arkusz.column_dimensions[get_column_letter(numer_kolumny)].width = szerokosc
    for numer_kolumny in range(len(uklad.KOLUMNY_DANE) + 1, len(wszystkie) + 1):
        arkusz.column_dimensions[get_column_letter(numer_kolumny)].width = 15

    ostatnia_litera = get_column_letter(len(wszystkie))
    tabela = Table(displayName="Tabela_dane", ref=f"A1:{ostatnia_litera}{ostatni}")
    tabela.tableStyleInfo = TableStyleInfo(
        name="TableStyleMedium2", showRowStripes=True, showColumnStripes=False
    )
    arkusz.add_table(tabela)

    # Listy rozwijane na wszystkich kolumnach słownikowych kartoteki.
    for numer_kolumny, slownik in uklad.LISTY_KARTOTEKI.items():
        litera = get_column_letter(numer_kolumny)
        sprawdzanie = DataValidation(
            type="list",
            formula1=f"sl_{slownik}",
            allow_blank=True,
            showDropDown=False,
            errorStyle="information",
            error="Wartość spoza słownika - zostanie do niego dopisana przy najbliższym odświeżeniu.",
            errorTitle="Wartość spoza słownika",
        )
        arkusz.add_data_validation(sprawdzanie)
        sprawdzanie.add(f"{litera}2:{litera}{max(ostatni, 5000)}")

    # Wiersze skorygowane wyróżniamy kolorem.
    arkusz.conditional_formatting.add(
        f"A2:{ostatnia_litera}{ostatni}",
        CellIsRule(
            operator="equal",
            formula=['"SKORYGOWANY"'],
            stopIfTrue=False,
            fill=PatternFill("solid", fgColor="FFE4E4"),
        ),
    )
    return ostatni


def zbuduj_magazyn(arkusz):
    arkusz.sheet_view.showGridLines = False
    for kolumna, szerokosc in zip("ABCDEFGH", [2, 24, 34, 14, 14, 14, 16, 18]):
        arkusz.column_dimensions[kolumna].width = szerokosc

    tytul(arkusz, "B1", "STAN MAGAZYNOWY", 16)
    arkusz["F2"] = "Przeliczono:"
    arkusz["F2"].font = Font(size=9, color=SZARY, name="Segoe UI")
    arkusz["G2"].number_format = "dd.mm.yyyy hh:mm"

    for kolumna, etykieta in (("B", "RAZEM [MP]"), ("D", "RAZEM [tony]"), ("F", "RAZEM [GJ]")):
        arkusz[f"{kolumna}4"] = etykieta
        arkusz[f"{kolumna}4"].font = Font(size=9, bold=True, color=SZARY, name="Segoe UI")
    for komorka in ("C4", "E4", "G4"):
        arkusz[komorka].font = Font(size=13, bold=True, color=ZIELONY, name="Segoe UI")
        arkusz[komorka].number_format = "# ##0.000"

    for przesuniecie, nazwa in enumerate(uklad.NAGLOWKI_MAGAZYN):
        naglowek(arkusz.cell(row=6, column=2 + przesuniecie, value=nazwa), rozmiar=10)
    arkusz.row_dimensions[6].height = 26

    arkusz["B4"].comment = None
    arkusz.freeze_panes = "A7"


def zbuduj_raporty(arkusz):
    arkusz.sheet_view.showGridLines = False
    for kolumna, szerokosc in zip("ABCDEFGHIJKLMNOPQR", [2, 14, 16, 14, 16, 8, 16, 22, 22, 18, 16, 12, 18, 14, 3, 14, 14, 14]):
        arkusz.column_dimensions[kolumna].width = szerokosc

    tytul(arkusz, "B1", "RAPORTY I ZESTAWIENIA", 16)

    etykiety = (
        ("B3", "Rok"), ("D3", "Miesiąc"), ("F3", "Typ operacji"),
        ("B4", "Produkt"), ("D4", "Kontrahent"), ("F4", "Lokalizacja"),
    )
    for komorka, tekst in etykiety:
        arkusz[komorka] = tekst
        arkusz[komorka].font = Font(size=9, bold=True, color=SZARY, name="Segoe UI")

    for komorka in ("C3", "E3", "G3", "C4", "E4", "G4"):
        arkusz[komorka].fill = PatternFill("solid", fgColor=BIALY)
        arkusz[komorka].border = RAMKA
        arkusz[komorka].font = Font(size=10, name="Segoe UI")

    arkusz["C3"] = datetime.now().year
    arkusz["E3"] = "WSZYSTKIE"
    arkusz["G3"] = "WSZYSTKIE"
    arkusz["C4"] = "WSZYSTKIE"
    arkusz["E4"] = "WSZYSTKIE"
    arkusz["G4"] = "WSZYSTKIE"

    miesiace = DataValidation(
        type="list",
        formula1='"WSZYSTKIE,STYCZEŃ,LUTY,MARZEC,KWIECIEŃ,MAJ,CZERWIEC,LIPIEC,SIERPIEŃ,WRZESIEŃ,PAŹDZIERNIK,LISTOPAD,GRUDZIEŃ"',
        allow_blank=True,
    )
    arkusz.add_data_validation(miesiace)
    miesiace.add(arkusz["E3"])

    podsumowania = (
        ("B7", "Operacji"), ("D7", "Wolumen [MP]"), ("F7", "Wolumen [t]"),
        ("H7", "Zakup"), ("J7", "Sprzedaż"), ("L7", "Transport"),
        ("J8", "Marża"), ("L8", "Rąbanie"),
    )
    for komorka, tekst in podsumowania:
        arkusz[komorka] = tekst
        arkusz[komorka].font = Font(size=9, bold=True, color=SZARY, name="Segoe UI")

    for komorka, format_liczb in (
        ("C7", "# ##0"), ("E7", "# ##0.000"), ("G7", "# ##0.000"),
        ("I7", "# ##0.00 zł"), ("K7", "# ##0.00 zł"), ("M7", "# ##0.00 zł"),
        ("K8", "# ##0.00 zł"), ("M8", "# ##0.00 zł"),
    ):
        arkusz[komorka].font = Font(size=11, bold=True, color=GRANAT, name="Segoe UI")
        arkusz[komorka].number_format = format_liczb

    for przesuniecie, nazwa in enumerate(uklad.NAGLOWKI_RAPORT):
        naglowek(arkusz.cell(row=10, column=2 + przesuniecie, value=nazwa), rozmiar=9)
    arkusz.row_dimensions[10].height = 26
    arkusz.freeze_panes = "A11"


def zbuduj_slownik(arkusz, wiersze):
    arkusz.freeze_panes = "A2"

    # Wartości zebrane z kartoteki - słowniki startują kompletne.
    zebrane: dict[str, list[str]] = {klucz: list(stale) for klucz, stale in uklad.SLOWNIKI}
    zrodla = {
        "PRODUKT": [14], "JEDNOSTKA": [10], "DOSTAWCA": [4], "ODBIORCA": [23],
        "MIEJSCE": [2, 24], "PRZEWOZNIK": [18], "POJAZD": [19], "OPERATOR": [26],
        "DEKLARACJA": [8], "ZREBKA": [15], "RABANIE": [16],
    }
    for klucz, kolumny in zrodla.items():
        istniejace = {pozycja.upper() for pozycja in zebrane[klucz]}
        for dane in wiersze:
            for numer_kolumny in kolumny:
                wartosc = dane[numer_kolumny - 1]
                if isinstance(wartosc, str) and wartosc.strip():
                    wartosc = wartosc.strip()
                    if wartosc.upper() not in istniejace:
                        istniejace.add(wartosc.upper())
                        zebrane[klucz].append(wartosc)

    for numer_kolumny, (klucz, _) in enumerate(uklad.SLOWNIKI, start=1):
        naglowek(arkusz.cell(row=1, column=numer_kolumny, value=klucz), rozmiar=9)
        arkusz.column_dimensions[get_column_letter(numer_kolumny)].width = 26

        pozycje = zebrane[klucz]
        # Słowniki otwarte sortujemy alfabetycznie, zamknięte zostawiamy w kolejności logicznej.
        if klucz in zrodla:
            pozycje = sorted(pozycje, key=lambda tekst: tekst.upper())

        for przesuniecie, pozycja in enumerate(pozycje):
            komorka = arkusz.cell(row=2 + przesuniecie, column=numer_kolumny, value=pozycja)
            komorka.font = Font(size=10, name="Segoe UI")
    arkusz.row_dimensions[1].height = 28
    return zebrane


def zbuduj_historie(arkusz):
    arkusz.freeze_panes = "A2"
    for przesuniecie, nazwa in enumerate(uklad.NAGLOWKI_HISTORIA, start=1):
        naglowek(arkusz.cell(row=1, column=przesuniecie, value=nazwa), rozmiar=10)
    for kolumna, szerokosc in zip("ABCDEFG", [8, 20, 24, 20, 16, 26, 80]):
        arkusz.column_dimensions[kolumna].width = szerokosc
    arkusz.row_dimensions[1].height = 26

    arkusz.cell(row=2, column=1, value=1)
    arkusz.cell(row=2, column=2, value=datetime.now()).number_format = "dd.mm.yyyy hh:mm:ss"
    arkusz.cell(row=2, column=3, value="System")
    arkusz.cell(row=2, column=4, value="INSTALACJA")
    arkusz.cell(row=2, column=7, value="Utworzenie skoroszytu PRO-MAGAZYN 2.0.0")


def zbuduj_ustawienia(arkusz) -> dict[str, int]:
    arkusz.sheet_view.showGridLines = False
    for kolumna, szerokosc in zip("ABCD", [2, 32, 26, 66]):
        arkusz.column_dimensions[kolumna].width = szerokosc

    tytul(arkusz, "B1", "USTAWIENIA SYSTEMU", 16)
    for przesuniecie, nazwa in enumerate(("Klucz", "Wartość", "Opis")):
        naglowek(arkusz.cell(row=1, column=2 + przesuniecie, value=nazwa), rozmiar=10)
    arkusz["B1"] = "Klucz"
    naglowek(arkusz["B1"], rozmiar=10)

    wiersze_ustawien: dict[str, int] = {}
    for przesuniecie, (klucz, wartosc, opis) in enumerate(uklad.USTAWIENIA):
        numer_wiersza = 2 + przesuniecie
        arkusz.cell(row=numer_wiersza, column=2, value=klucz).font = Font(
            size=10, bold=True, name="Consolas"
        )
        komorka = arkusz.cell(row=numer_wiersza, column=3, value=wartosc if wartosc != "" else None)
        komorka.fill = PatternFill("solid", fgColor=BIALY)
        komorka.border = RAMKA
        komorka.font = Font(size=11, name="Segoe UI")
        arkusz.cell(row=numer_wiersza, column=4, value=opis).font = Font(
            size=9, italic=True, color=SZARY, name="Segoe UI"
        )
        wiersze_ustawien[klucz] = numer_wiersza

    return wiersze_ustawien


# ============================================================================
#  Nazwane zakresy
# ============================================================================


def dodaj_nazwy(skoroszyt, slowniki, wiersze_ustawien, nazwa_slownika, nazwa_ustawien):
    # Dynamiczne zakresy słowników - rosną razem z listą pozycji.
    for numer_kolumny, (klucz, _) in enumerate(uklad.SLOWNIKI, start=1):
        litera = get_column_letter(numer_kolumny)
        odwolanie = (
            f"OFFSET('{nazwa_slownika}'!${litera}$2,0,0,"
            f"MAX(1,COUNTA('{nazwa_slownika}'!${litera}:${litera})-1),1)"
        )
        skoroszyt.defined_names.add(DefinedName(f"sl_{klucz}", attr_text=odwolanie))

    # Przeliczniki używane w formułach kartoteki.
    for nazwa, klucz in uklad.NAZWY_PRZELICZNIKOW.items():
        numer_wiersza = wiersze_ustawien[klucz]
        skoroszyt.defined_names.add(
            DefinedName(nazwa, attr_text=f"'{nazwa_ustawien}'!$C${numer_wiersza}")
        )


# ============================================================================
#  Projekt VBA i przepakowanie do .xlsm
# ============================================================================


def zbuduj_projekt_vba(katalog_zrodel: Path) -> bytes:
    typy = {"ThisWorkbook": "workbook"}
    moduly = []

    # Najpierw moduły dokumentów (ThisWorkbook i arkusze), potem standardowe.
    dokumenty = sorted(katalog_zrodel.glob("*.cls"))
    standardowe = sorted(katalog_zrodel.glob("*.bas"))

    for sciezka in dokumenty:
        nazwa = sciezka.stem
        moduly.append(
            Module(nazwa, sciezka.read_text(encoding="utf-8"), typy.get(nazwa, "worksheet"))
        )
    for sciezka in standardowe:
        moduly.append(Module(sciezka.stem, sciezka.read_text(encoding="utf-8"), "standard"))

    return build_vba("PROMAGAZYN", moduly)


def przepakuj_do_xlsm(zrodlo: Path, cel: Path, vba: bytes, code_names: dict[str, str]):
    """Dodaje projekt VBA i nazwy kodowe arkuszy, zapisujac plik jako .xlsm."""
    with zipfile.ZipFile(zrodlo, "r") as wejscie:
        wpisy = {info.filename: wejscie.read(info.filename) for info in wejscie.infolist()}

    # 1. Typy zawartości: skoroszyt z makrami + rozszerzenie .bin.
    typy = wpisy["[Content_Types].xml"].decode("utf-8")
    typy = typy.replace(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
        "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
    )
    if 'Extension="bin"' not in typy:
        # Wstawiamy Default tuz za znacznikiem otwierajacym <Types ...>,
        # nie za pierwszym napotkanym ">" (moze nim byc deklaracja XML).
        typy = re.sub(
            r"(<Types\b[^>]*>)",
            r'\1<Default Extension="bin" '
            r'ContentType="application/vnd.ms-office.vbaProject"/>',
            typy,
            count=1,
        )
    wpisy["[Content_Types].xml"] = typy.encode("utf-8")

    # 2. Relacja skoroszyt -> vbaProject.bin.
    relacje = wpisy["xl/_rels/workbook.xml.rels"].decode("utf-8")
    if "vbaProject.bin" not in relacje:
        relacje = relacje.replace(
            "</Relationships>",
            '<Relationship Id="rIdVBAProject" '
            'Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" '
            'Target="vbaProject.bin"/></Relationships>',
        )
    wpisy["xl/_rels/workbook.xml.rels"] = relacje.encode("utf-8")

    # 3. Nazwa kodowa skoroszytu.
    workbook_xml = wpisy["xl/workbook.xml"].decode("utf-8")
    if "<workbookPr" in workbook_xml:
        workbook_xml = re.sub(
            r"<workbookPr([^>]*?)/>",
            lambda dopasowanie: f'<workbookPr{dopasowanie.group(1)} codeName="ThisWorkbook"/>',
            workbook_xml,
            count=1,
        )
    else:
        workbook_xml = workbook_xml.replace(
            "<sheets>", '<workbookPr codeName="ThisWorkbook"/><sheets>', 1
        )
    wpisy["xl/workbook.xml"] = workbook_xml.encode("utf-8")

    # 4. Nazwy kodowe arkuszy.
    for sciezka_arkusza, code_name in code_names.items():
        xml = wpisy[sciezka_arkusza].decode("utf-8")
        if "<sheetPr" in xml:
            xml = re.sub(
                r"<sheetPr([^>]*?)(/?)>",
                lambda d: f'<sheetPr{d.group(1)} codeName="{code_name}"{d.group(2)}>',
                xml,
                count=1,
            )
        else:
            xml = re.sub(
                r"(<worksheet[^>]*>)",
                rf'\1<sheetPr codeName="{code_name}"/>',
                xml,
                count=1,
            )
        wpisy[sciezka_arkusza] = xml.encode("utf-8")

    wpisy["xl/vbaProject.bin"] = vba

    cel.parent.mkdir(parents=True, exist_ok=True)

    # Pakiet OPC wymaga, zeby [Content_Types].xml byl pierwsza czescia
    # archiwum, a relacje glowne tuz za nim.
    kolejnosc = ["[Content_Types].xml", "_rels/.rels"]
    pozostale = [nazwa for nazwa in wpisy if nazwa not in kolejnosc]

    with zipfile.ZipFile(cel, "w", zipfile.ZIP_DEFLATED) as wyjscie:
        for nazwa in kolejnosc:
            if nazwa in wpisy:
                wyjscie.writestr(nazwa, wpisy[nazwa])
        for nazwa in pozostale:
            wyjscie.writestr(nazwa, wpisy[nazwa])


# ============================================================================
#  Główny przebieg
# ============================================================================


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Generator skoroszytu PRO-MAGAZYN")
    parser.add_argument("--dane", default=str(KORZEN / "data" / "kartoteka.csv"))
    parser.add_argument("--wyjscie", default=str(KORZEN / "dist" / "PRO-MAGAZYN.xlsm"))
    parser.add_argument("--zrodla-vba", default=str(KORZEN / "src" / "vba"))
    argumenty = parser.parse_args(argv[1:])

    wiersze = wczytaj_kartoteke(Path(argumenty.dane))
    print(f"Kartoteka: {len(wiersze)} wierszy")

    skoroszyt = openpyxl.Workbook()
    skoroszyt.remove(skoroszyt.active)

    arkusze = {
        "START": "wsStart",
        "FORMULARZ": "wsFormularz",
        "Dane": "wsDane",
        "MAGAZYN": "wsMagazyn",
        "RAPORTY": "wsRaporty",
        "SŁOWNIK": "wsSlownik",
        "HISTORIA": "wsHistoria",
        "USTAWIENIA": "wsUstawienia",
    }
    for nazwa in arkusze:
        skoroszyt.create_sheet(nazwa)

    zbuduj_start(skoroszyt["START"])
    zbuduj_formularz(skoroszyt["FORMULARZ"])
    ostatni_wiersz = zbuduj_dane(skoroszyt["Dane"], wiersze)
    zbuduj_magazyn(skoroszyt["MAGAZYN"])
    zbuduj_raporty(skoroszyt["RAPORTY"])
    slowniki = zbuduj_slownik(skoroszyt["SŁOWNIK"], wiersze)
    zbuduj_historie(skoroszyt["HISTORIA"])
    wiersze_ustawien = zbuduj_ustawienia(skoroszyt["USTAWIENIA"])

    dodaj_nazwy(skoroszyt, slowniki, wiersze_ustawien, "SŁOWNIK", "USTAWIENIA")

    skoroszyt.active = skoroszyt.index(skoroszyt["START"])

    tymczasowy = Path(argumenty.wyjscie).with_suffix(".tmp.xlsx")
    tymczasowy.parent.mkdir(parents=True, exist_ok=True)
    skoroszyt.save(tymczasowy)

    vba = zbuduj_projekt_vba(Path(argumenty.zrodla_vba))
    print(f"Projekt VBA: {len(vba)} bajtow")

    # Mapowanie plikow arkuszy -> nazwy kodowe (kolejnosc tworzenia = sheet1..N).
    code_names = {
        f"xl/worksheets/sheet{numer}.xml": nazwa_kodowa
        for numer, nazwa_kodowa in enumerate(arkusze.values(), start=1)
    }

    przepakuj_do_xlsm(tymczasowy, Path(argumenty.wyjscie), vba, code_names)
    tymczasowy.unlink()

    rozmiar = Path(argumenty.wyjscie).stat().st_size
    print(f"Zapisano: {argumenty.wyjscie}  ({rozmiar/1024:.0f} KB)")
    print(f"  wierszy kartoteki : {ostatni_wiersz - 1}")
    print(f"  pozycji slownikow : {sum(len(v) for v in slowniki.values())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
