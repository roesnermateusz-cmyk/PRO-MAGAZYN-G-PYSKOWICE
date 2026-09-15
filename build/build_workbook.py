#!/usr/bin/env python3
"""Generator skoroszytu PRO-MAGAZYN w wersji z makrami (.xlsm).

Układ arkuszy i zapis pliku pochodzą z pakietu ``promagazyn.dane`` -
tego samego, którego używa aplikacja desktopowa. Ten skrypt dokłada
jedynie projekt VBA i przepakowuje wynik do formatu z makrami.

Uruchomienie:
    python3 build/build_workbook.py [--dane data/kartoteka.csv]
                                    [--wyjscie dist/PRO-MAGAZYN.xlsm]
"""

from __future__ import annotations

import argparse
import re
import sys
import zipfile
from pathlib import Path

KORZEN = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(KORZEN / "desktop"))
sys.path.insert(0, str(KORZEN / "tools"))

from promagazyn.dane import csv_io, zapis  # noqa: E402
from promagazyn.model.slowniki import Slowniki  # noqa: E402
from promagazyn.model.ustawienia import Ustawienia  # noqa: E402
from vbabuild import Module, build as build_vba  # noqa: E402


def zbuduj_projekt_vba(katalog_zrodel: Path) -> bytes:
    """Kompiluje moduły .bas/.cls do pliku vbaProject.bin."""
    typy = {"ThisWorkbook": "workbook"}
    moduly = []

    for sciezka in sorted(katalog_zrodel.glob("*.cls")):
        moduly.append(
            Module(sciezka.stem, sciezka.read_text(encoding="utf-8"), typy.get(sciezka.stem, "worksheet"))
        )
    for sciezka in sorted(katalog_zrodel.glob("*.bas")):
        moduly.append(Module(sciezka.stem, sciezka.read_text(encoding="utf-8"), "standard"))

    return build_vba("PROMAGAZYN", moduly)


def przepakuj_do_xlsm(zrodlo: Path, cel: Path, vba: bytes) -> None:
    """Dodaje projekt VBA i zapisuje pakiet jako skoroszyt z makrami."""
    with zipfile.ZipFile(zrodlo, "r") as wejscie:
        wpisy = {info.filename: wejscie.read(info.filename) for info in wejscie.infolist()}

    typy = wpisy["[Content_Types].xml"].decode("utf-8")
    typy = typy.replace(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
        "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
    )
    if 'Extension="bin"' not in typy:
        typy = re.sub(
            r"(<Types\b[^>]*>)",
            r'\1<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>',
            typy,
            count=1,
        )
    wpisy["[Content_Types].xml"] = typy.encode("utf-8")

    relacje = wpisy["xl/_rels/workbook.xml.rels"].decode("utf-8")
    if "vbaProject.bin" not in relacje:
        relacje = relacje.replace(
            "</Relationships>",
            '<Relationship Id="rIdVBAProject" '
            'Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" '
            'Target="vbaProject.bin"/></Relationships>',
        )
    wpisy["xl/_rels/workbook.xml.rels"] = relacje.encode("utf-8")

    workbook_xml = wpisy["xl/workbook.xml"].decode("utf-8")
    if "<workbookPr" in workbook_xml:
        workbook_xml = re.sub(
            r"<workbookPr([^>]*?)/>",
            lambda d: f'<workbookPr{d.group(1)} codeName="ThisWorkbook"/>',
            workbook_xml,
            count=1,
        )
    else:
        workbook_xml = workbook_xml.replace(
            "<sheets>", '<workbookPr codeName="ThisWorkbook"/><sheets>', 1
        )
    wpisy["xl/workbook.xml"] = workbook_xml.encode("utf-8")
    wpisy["xl/vbaProject.bin"] = vba

    cel.parent.mkdir(parents=True, exist_ok=True)
    kolejnosc = ["[Content_Types].xml", "_rels/.rels"]
    pozostale = [nazwa for nazwa in wpisy if nazwa not in kolejnosc]

    with zipfile.ZipFile(cel, "w", zipfile.ZIP_DEFLATED) as wyjscie:
        for nazwa in kolejnosc:
            if nazwa in wpisy:
                wyjscie.writestr(nazwa, wpisy[nazwa])
        for nazwa in pozostale:
            wyjscie.writestr(nazwa, wpisy[nazwa])


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Generator skoroszytu PRO-MAGAZYN")
    parser.add_argument("--dane", default=str(KORZEN / "data" / "kartoteka.csv"))
    parser.add_argument("--wyjscie", default=str(KORZEN / "dist" / "PRO-MAGAZYN.xlsm"))
    parser.add_argument("--zrodla-vba", default=str(KORZEN / "src" / "vba"))
    argumenty = parser.parse_args(argv[1:])

    sciezka_danych = Path(argumenty.dane)
    if sciezka_danych.exists():
        operacje, pominiete = csv_io.wczytaj(sciezka_danych)
        for opis in pominiete[:10]:
            print(f"  pominieto: {opis}")
    else:
        print(f"UWAGA: brak pliku {sciezka_danych} - skoroszyt powstanie bez danych.")
        operacje = []
    print(f"Kartoteka: {len(operacje)} operacji")

    slowniki = Slowniki()
    slowniki.przebuduj(operacje)
    ustawienia = Ustawienia()

    skoroszyt = zapis.zbuduj_skoroszyt(operacje, slowniki, ustawienia, [])

    wyjscie = Path(argumenty.wyjscie)
    tymczasowy = wyjscie.with_suffix(".tmp.xlsx")
    tymczasowy.parent.mkdir(parents=True, exist_ok=True)
    skoroszyt.save(tymczasowy)

    vba = zbuduj_projekt_vba(Path(argumenty.zrodla_vba))
    print(f"Projekt VBA: {len(vba)} bajtow")

    przepakuj_do_xlsm(tymczasowy, wyjscie, vba)
    tymczasowy.unlink()

    print(f"Zapisano: {wyjscie}  ({wyjscie.stat().st_size / 1024:.0f} KB)")
    print(f"  wierszy kartoteki : {len(operacje)}")
    print(f"  pozycji slownikow : {sum(len(v) for v in slowniki.pozycje.values())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
