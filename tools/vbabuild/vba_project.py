"""Budowa pliku ``vbaProject.bin`` z plikow zrodlowych VBA.

Sklada strumienie wymagane przez [MS-OVBA]:

* ``/PROJECT``            -- tekstowy opis projektu (moduly, workspace)
* ``/PROJECTwm``          -- mapa nazw modulow MBCS <-> UTF-16
* ``/VBA/_VBA_PROJECT``   -- naglowek z pustym PerformanceCache
* ``/VBA/dir``            -- katalog projektu (informacje, referencje, moduly)
* ``/VBA/<Modul>``        -- skompresowane zrodlo kazdego modulu

PerformanceCache (skompilowany kod p-code) celowo nie jest zapisywany --
pole ``Version`` ustawione na 0xFFFF wymusza na VBA rekompilacje ze zrodel
przy pierwszym otwarciu skoroszytu.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

from . import cfb_writer
from .ovba_compression import compress

CODEPAGE = 1250  # Europa Srodkowa - polskie znaki w nazwach i kodzie
LCID = 0x0415  # pl-PL
SYSKIND_WIN64 = 0x03

# CLSID zapisywany w korzeniu kontenera projektu VBA.
ROOT_CLSID = bytes.fromhex("00000000000000000000000000000000")

MODULE_TYPE_PROCEDURAL = 0x0021
MODULE_TYPE_DOCUMENT = 0x0022

CLASS_ATTRIBUTES_WORKSHEET = "0{00020820-0000-0000-C000-000000000046}"
CLASS_ATTRIBUTES_WORKBOOK = "0{00020819-0000-0000-C000-000000000046}"

# Referencje do bibliotek typow.  Excel rozwiazuje je po GUID z rejestru,
# sciezka jest tylko podpowiedzia, wiec dzialaja niezaleznie od wersji Office.
REFERENCES = [
    (
        "stdole",
        "*\\G{00020430-0000-0000-C000-000000000046}#2.0#0"
        "#C:\\Windows\\System32\\stdole2.tlb#OLE Automation",
    ),
    (
        "Office",
        "*\\G{2DF8D04C-5BFA-101B-BDE5-00AA0044DE52}#2.0#0"
        "#C:\\Program Files\\Common Files\\Microsoft Shared\\OFFICE16\\MSO.DLL"
        "#Microsoft Office 16.0 Object Library",
    ),
]


@dataclass
class Module:
    """Pojedynczy modul projektu VBA."""

    name: str
    code: str
    kind: str = "standard"  # standard | worksheet | workbook

    @property
    def is_document(self) -> bool:
        return self.kind in ("worksheet", "workbook")

    @property
    def record_type(self) -> int:
        return MODULE_TYPE_DOCUMENT if self.is_document else MODULE_TYPE_PROCEDURAL

    def source(self) -> str:
        """Zwraca pelne zrodlo modulu wraz z naglowkiem ``Attribute``."""
        lines = [f'Attribute VB_Name = "{self.name}"']
        if self.is_document:
            base = (
                CLASS_ATTRIBUTES_WORKBOOK
                if self.kind == "workbook"
                else CLASS_ATTRIBUTES_WORKSHEET
            )
            lines += [
                f'Attribute VB_Base = "{base}"',
                "Attribute VB_GlobalNameSpace = False",
                "Attribute VB_Creatable = False",
                "Attribute VB_PredeclaredId = True",
                "Attribute VB_Exposed = True",
                "Attribute VB_TemplateDerived = False",
                "Attribute VB_Customizable = True",
            ]
        body = self.code.replace("\r\n", "\n").replace("\r", "\n")
        return "\r\n".join(lines) + "\r\n" + body.replace("\n", "\r\n")


def _record(record_id: int, payload: bytes = b"") -> bytes:
    return struct.pack("<HI", record_id, len(payload)) + payload


def _mbcs(text: str) -> bytes:
    return text.encode(f"cp{CODEPAGE}")


def _utf16(text: str) -> bytes:
    return text.encode("utf-16-le")


def _build_dir(project_name: str, modules: list[Module]) -> bytes:
    out = bytearray()

    # --- PROJECTINFORMATION -------------------------------------------------
    out += _record(0x0001, struct.pack("<I", SYSKIND_WIN64))
    out += _record(0x004A, struct.pack("<I", 6))  # PROJECTCOMPATVERSION
    out += _record(0x0002, struct.pack("<I", LCID))
    out += _record(0x0014, struct.pack("<I", LCID))
    out += _record(0x0003, struct.pack("<H", CODEPAGE))
    out += _record(0x0004, _mbcs(project_name))
    out += _record(0x0005)  # PROJECTDOCSTRING
    out += _record(0x0040)
    out += _record(0x0006)  # PROJECTHELPFILEPATH
    out += _record(0x003D)
    out += _record(0x0007, struct.pack("<I", 0))  # PROJECTHELPCONTEXT
    out += _record(0x0008, struct.pack("<I", 0))  # PROJECTLIBFLAGS
    # PROJECTVERSION ma nietypowy uklad: Reserved(4) + Major(4) + Minor(2)
    out += struct.pack("<HIIH", 0x0009, 4, 1, 1)
    out += _record(0x000C)  # PROJECTCONSTANTS
    out += _record(0x003C)

    # --- PROJECTREFERENCES --------------------------------------------------
    for name, libid in REFERENCES:
        out += _record(0x0016, _mbcs(name))
        out += _record(0x003E, _utf16(name))
        payload = struct.pack("<I", len(_mbcs(libid))) + _mbcs(libid)
        payload += struct.pack("<I", 0) + struct.pack("<H", 0)
        out += _record(0x000D, payload)

    # --- PROJECTMODULES -----------------------------------------------------
    out += _record(0x000F, struct.pack("<H", len(modules)))
    out += _record(0x0013, struct.pack("<H", 0xFFFF))  # PROJECTCOOKIE

    for module in modules:
        out += _record(0x0019, _mbcs(module.name))
        out += _record(0x0047, _utf16(module.name))
        out += _record(0x001A, _mbcs(module.name))
        out += _record(0x0032, _utf16(module.name))
        out += _record(0x001C)  # MODULEDOCSTRING
        out += _record(0x0048)
        # Strumienie modulow nie zawieraja PerformanceCache, wiec zrodlo
        # zaczyna sie od bajtu zerowego.
        out += _record(0x0031, struct.pack("<I", 0))  # MODULEOFFSET
        out += _record(0x001E, struct.pack("<I", 0))  # MODULEHELPCONTEXT
        out += _record(0x002C, struct.pack("<H", 0xFFFF))  # MODULECOOKIE
        out += _record(module.record_type)
        out += _record(0x002B)  # koniec rekordu modulu

    out += _record(0x0010)  # Terminator
    return bytes(out)


def _build_project_stream(project_name: str, modules: list[Module]) -> bytes:
    lines = ['ID="{00000000-0000-0000-0000-000000000000}"']
    for module in modules:
        if module.is_document:
            lines.append(f"Document={module.name}/&H00000000")
        else:
            lines.append(f"Module={module.name}")
    lines += [
        'HelpFile=""',
        f'Name="{project_name}"',
        'HelpContextID="0"',
        'VersionCompatible32="393222000"',
        "",
        "[Host Extender Info]",
        "&H00000001={3832D640-CF90-11CF-8E43-00A0C911005A};VBE;&H00000000",
        "",
        "[Workspace]",
    ]
    for module in modules:
        lines.append(f"{module.name}=0, 0, 0, 0, C")
    return ("\r\n".join(lines) + "\r\n").encode(f"cp{CODEPAGE}")


def _build_projectwm(modules: list[Module]) -> bytes:
    out = bytearray()
    for module in modules:
        out += _mbcs(module.name) + b"\x00"
        out += _utf16(module.name) + b"\x00\x00"
    out += b"\x00\x00"
    return bytes(out)


def build(project_name: str, modules: list[Module]) -> bytes:
    """Zwraca zawartosc ``vbaProject.bin`` dla podanego zestawu modulow."""
    if not modules:
        raise ValueError("Projekt VBA musi zawierac co najmniej jeden modul")

    names = [module.name for module in modules]
    if len(set(names)) != len(names):
        raise ValueError("Nazwy modulow musza byc unikalne")

    vba_children = [
        cfb_writer.stream("_VBA_PROJECT", b"\xcc\x61\xff\xff\x00\x00\x00"),
        cfb_writer.stream("dir", compress(_build_dir(project_name, modules))),
    ]
    for module in modules:
        source = module.source().encode(f"cp{CODEPAGE}")
        vba_children.append(cfb_writer.stream(module.name, compress(source)))

    root_children = [
        cfb_writer.storage("VBA", vba_children),
        cfb_writer.stream("PROJECT", _build_project_stream(project_name, modules)),
        cfb_writer.stream("PROJECTwm", _build_projectwm(modules)),
    ]
    return cfb_writer.write(ROOT_CLSID, root_children)
