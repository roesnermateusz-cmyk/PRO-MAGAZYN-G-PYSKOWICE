#!/usr/bin/env python3
"""Testy narzedzi budujacych projekt VBA.

Uruchomienie:  python3 tools/test_vbabuild.py

Testy weryfikuja kodek [MS-OVBA] oraz zapis kontenera [MS-CFB] przez
odczyt wygenerowanych danych niezaleznymi parserami (``olefile``, ``olevba``).
"""

from __future__ import annotations

import io
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import olefile  # noqa: E402
from oletools.olevba import VBA_Parser, decompress_stream  # noqa: E402

from vbabuild import Module, build  # noqa: E402
from vbabuild.ovba_compression import compress, decompress  # noqa: E402

FAILURES: list[str] = []


def check(condition: bool, label: str) -> None:
    status = "OK  " if condition else "BLAD"
    print(f"  [{status}] {label}")
    if not condition:
        FAILURES.append(label)


def test_compression() -> None:
    print("Kodek MS-OVBA")
    random.seed(1234)
    cases = {
        "pusty": b"",
        "jeden bajt": b"A",
        "tekst VBA": b'Sub T()\r\n    MsgBox "OK"\r\nEnd Sub\r\n' * 900,
        "polskie znaki": "Zażółć gęślą jaźń ".encode("cp1250") * 500,
        "dokladnie 4096": random.randbytes(4096),
        "4097 losowych": random.randbytes(4097),
        "20000 losowych": random.randbytes(20000),
        "powtarzalny": b"\x00" * 30000,
    }
    for label, payload in cases.items():
        encoded = compress(payload)
        check(decompress(encoded) == payload, f"round-trip: {label}")
        if payload:
            check(
                decompress_stream(bytearray(encoded)) == payload,
                f"zgodnosc z oletools: {label}",
            )


def test_project() -> None:
    print("Kontener vbaProject.bin")
    # Modul celowo duzy, zeby po kompresji przekroczyl 4096 B i trafil do
    # sektorow zwyklych zamiast do mini-strumienia.
    duzy = "Option Explicit\n\n" + "".join(
        f'Public Sub Proc{i}()\n    Debug.Print "{random.random()} ąęśłżźćóń {i}"\nEnd Sub\n\n'
        for i in range(1200)
    )
    modules = [
        Module("ThisWorkbook", 'Private Sub Workbook_Open()\n    MsgBox "Start"\nEnd Sub\n', "workbook"),
        Module("wsDane", "Private Sub Worksheet_Activate()\n    Me.Range(\"A1\").Select\nEnd Sub\n", "worksheet"),
        Module("mod_Male", "Option Explicit\n\nPublic Sub Maly()\nEnd Sub\n"),
        Module("mod_Duze", duzy),
    ]
    blob = build("PROMAGAZYN", modules)

    ole = olefile.OleFileIO(io.BytesIO(blob))
    listing = {"/".join(path) for path in ole.listdir(streams=True, storages=True)}
    for required in ("PROJECT", "PROJECTwm", "VBA/dir", "VBA/_VBA_PROJECT"):
        check(required in listing, f"strumien obecny: {required}")

    big = len(ole.openstream("VBA/mod_Duze").read())
    check(big >= 4096, f"modul w sektorach zwyklych ({big} B >= 4096)")
    small = len(ole.openstream("VBA/mod_Male").read())
    check(small < 4096, f"modul w mini-strumieniu ({small} B < 4096)")

    for module in modules:
        source = decompress(ole.openstream("VBA/" + module.name).read()).decode("cp1250")
        check(source == module.source(), f"zrodlo zgodne: {module.name}")

    parser = VBA_Parser("vbaProject.bin", data=blob)
    check(parser.detect_vba_macros(), "olevba wykrywa makra")
    extracted = {name: code for (_, _, name, code) in parser.extract_macros()}
    expected = {
        module.name + (".cls" if module.is_document else ".bas") for module in modules
    }
    check(set(extracted) == expected, "olevba widzi komplet modulow o wlasciwych typach")
    check("Proc1199" in extracted.get("mod_Duze.bas", ""), "duzy modul odczytany w calosci")

    project = ole.openstream("PROJECT").read().decode("cp1250")
    check("Document=ThisWorkbook/&H00000000" in project, "PROJECT: wpis dokumentu")
    check("Module=mod_Male" in project, "PROJECT: wpis modulu standardowego")


def main() -> int:
    test_compression()
    test_project()
    print()
    if FAILURES:
        print(f"NIEPOWODZENIE: {len(FAILURES)} test(ow)")
        for failure in FAILURES:
            print("  -", failure)
        return 1
    print("Wszystkie testy przeszly.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
