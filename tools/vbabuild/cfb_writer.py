"""Zapis kontenera Compound File Binary ([MS-CFB], wersja 3, sektor 512 B).

``vbaProject.bin`` jest plikiem OLE/CFB.  Biblioteka ``olefile`` potrafi go
tylko czytac, dlatego projekt zawiera wlasny, minimalny zapis obslugujacy
wszystko, czego wymaga projekt VBA: zagniezdzone magazyny (storage), strumienie
w sektorach zwyklych oraz strumienie ponizej 4096 B umieszczane w mini-strumieniu.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field

SECTOR_SIZE = 512
MINI_SECTOR_SIZE = 64
MINI_CUTOFF = 4096
DIR_ENTRY_SIZE = 128
DIR_ENTRIES_PER_SECTOR = SECTOR_SIZE // DIR_ENTRY_SIZE
FAT_ENTRIES_PER_SECTOR = SECTOR_SIZE // 4

MAXREGSECT = 0xFFFFFFFA
DIFSECT = 0xFFFFFFFC
FATSECT = 0xFFFFFFFD
ENDOFCHAIN = 0xFFFFFFFE
FREESECT = 0xFFFFFFFF
NOSTREAM = 0xFFFFFFFF

TYPE_STORAGE = 1
TYPE_STREAM = 2
TYPE_ROOT = 5

COLOR_RED = 0
COLOR_BLACK = 1


@dataclass
class Entry:
    """Wezel drzewa katalogu: magazyn albo strumien."""

    name: str
    kind: int
    data: bytes = b""
    clsid: bytes = b"\x00" * 16
    children: list["Entry"] = field(default_factory=list)

    # wypelniane podczas budowy
    index: int = -1
    child_id: int = NOSTREAM
    left_id: int = NOSTREAM
    right_id: int = NOSTREAM
    start_sector: int = ENDOFCHAIN
    size: int = 0


def storage(name: str, children: list[Entry], clsid: bytes = b"\x00" * 16) -> Entry:
    return Entry(name=name, kind=TYPE_STORAGE, children=children, clsid=clsid)


def stream(name: str, data: bytes) -> Entry:
    return Entry(name=name, kind=TYPE_STREAM, data=data)


def _sort_key(entry: Entry):
    """Porzadek katalogu wg [MS-CFB] 2.6.4: najpierw dlugosc nazwy, potem
    porownanie wielkimi literami."""
    return (len(entry.name), entry.name.upper())


def _build_tree(entries: list[Entry]) -> int:
    """Buduje zrownowazone drzewo rodzenstwa i zwraca identyfikator korzenia.

    Kolor wszystkich wezlow ustawiamy na czarny - czytniki CFB (w tym Excel)
    poruszaja sie po wskaznikach left/right i ignoruja kolor, a zrownowazone
    drzewo gwarantuje poprawne wyszukiwanie binarne po nazwie.
    """
    if not entries:
        return NOSTREAM

    ordered = sorted(entries, key=_sort_key)

    def build(lo: int, hi: int) -> int:
        if lo > hi:
            return NOSTREAM
        mid = (lo + hi) // 2
        node = ordered[mid]
        node.left_id = build(lo, mid - 1)
        node.right_id = build(mid + 1, hi)
        return node.index

    return build(0, len(ordered) - 1)


def _flatten(root: Entry) -> list[Entry]:
    """Nadaje wezlom identyfikatory (kolejnosc w tablicy katalogu) i spina
    drzewa rodzenstwa."""
    ordered: list[Entry] = []

    def assign(entry: Entry):
        entry.index = len(ordered)
        ordered.append(entry)
        for child in sorted(entry.children, key=_sort_key):
            assign(child)

    assign(root)

    def link(entry: Entry):
        if entry.children:
            entry.child_id = _build_tree(entry.children)
            for child in entry.children:
                link(child)

    link(root)
    return ordered


def _chain(fat: list[int], sectors: list[int]) -> None:
    """Spina liste sektorow w lancuch FAT."""
    for current, following in zip(sectors, sectors[1:]):
        fat[current] = following
    if sectors:
        fat[sectors[-1]] = ENDOFCHAIN


def _pad(data: bytes, block: int) -> bytes:
    remainder = len(data) % block
    return data if remainder == 0 else data + b"\x00" * (block - remainder)


def write(root_clsid: bytes, children: list[Entry]) -> bytes:
    """Sklada kompletny plik CFB i zwraca jego bajty."""
    root = Entry(name="Root Entry", kind=TYPE_ROOT, clsid=root_clsid, children=children)
    entries = _flatten(root)

    # --- 1. Mini-strumien: wszystkie strumienie < 4096 B ---------------------
    mini_data = bytearray()
    mini_fat: list[int] = []
    for entry in entries:
        if entry.kind != TYPE_STREAM:
            continue
        entry.size = len(entry.data)
        if entry.size == 0:
            entry.start_sector = ENDOFCHAIN
            continue
        if entry.size >= MINI_CUTOFF:
            continue
        first = len(mini_data) // MINI_SECTOR_SIZE
        blob = _pad(entry.data, MINI_SECTOR_SIZE)
        count = len(blob) // MINI_SECTOR_SIZE
        mini_data += blob
        indices = list(range(first, first + count))
        mini_fat.extend([FREESECT] * count)
        _chain(mini_fat, indices)
        entry.start_sector = first

    mini_fat_bytes = _pad(
        b"".join(struct.pack("<I", value) for value in mini_fat), SECTOR_SIZE
    )
    # Niewykorzystane pozycje ostatniego sektora MiniFAT musza byc wolne.
    padding_entries = (len(mini_fat_bytes) // 4) - len(mini_fat)
    if padding_entries:
        mini_fat_bytes = mini_fat_bytes[: len(mini_fat) * 4] + struct.pack(
            "<I", FREESECT
        ) * padding_entries

    # --- 2. Sektory zwykle --------------------------------------------------
    payloads: list[tuple[Entry | str, bytes]] = []
    for entry in entries:
        if entry.kind == TYPE_STREAM and entry.size >= MINI_CUTOFF:
            payloads.append((entry, _pad(entry.data, SECTOR_SIZE)))

    mini_stream_blob = _pad(bytes(mini_data), SECTOR_SIZE)
    root.size = len(mini_data)

    directory_blob = bytearray()
    for entry in entries:
        directory_blob += b"\x00" * DIR_ENTRY_SIZE  # miejsce, wypelnimy pozniej
    directory_blob = _pad(bytes(directory_blob), SECTOR_SIZE)

    # Rozklad sektorow: [strumienie duze][mini-strumien][MiniFAT][katalog][FAT]
    next_sector = 0

    def allocate(blob: bytes) -> list[int]:
        nonlocal next_sector
        count = len(blob) // SECTOR_SIZE
        indices = list(range(next_sector, next_sector + count))
        next_sector += count
        return indices

    stream_sectors: list[tuple[Entry, list[int]]] = []
    for entry, blob in payloads:
        stream_sectors.append((entry, allocate(blob)))

    mini_stream_sectors = allocate(mini_stream_blob)
    mini_fat_sectors = allocate(mini_fat_bytes)
    directory_sectors = allocate(directory_blob)

    # Liczba sektorow FAT zalezy od calkowitej liczby sektorow (w tym samej FAT),
    # wiec iterujemy do punktu stalego.
    data_sectors = next_sector
    fat_sector_count = 1
    while True:
        total = data_sectors + fat_sector_count
        needed = -(-total // FAT_ENTRIES_PER_SECTOR)
        # DIFAT w naglowku mieszci 109 pozycji; wiecej nie jest tu potrzebne.
        if needed <= fat_sector_count:
            break
        fat_sector_count = needed
    if fat_sector_count > 109:
        raise ValueError("Projekt zbyt duzy dla DIFAT w naglowku")

    fat_sectors = list(range(data_sectors, data_sectors + fat_sector_count))
    total_sectors = data_sectors + fat_sector_count

    fat = [FREESECT] * (fat_sector_count * FAT_ENTRIES_PER_SECTOR)
    for entry, sectors in stream_sectors:
        _chain(fat, sectors)
        entry.start_sector = sectors[0] if sectors else ENDOFCHAIN
    _chain(fat, mini_stream_sectors)
    _chain(fat, mini_fat_sectors)
    _chain(fat, directory_sectors)
    for sector in fat_sectors:
        fat[sector] = FATSECT

    root.start_sector = mini_stream_sectors[0] if mini_stream_sectors else ENDOFCHAIN

    # --- 3. Tablica katalogu ------------------------------------------------
    directory = bytearray()
    for entry in entries:
        name = entry.name.encode("utf-16-le") + b"\x00\x00"
        if len(name) > 64:
            raise ValueError(f"Nazwa zbyt dluga: {entry.name}")
        record = bytearray(DIR_ENTRY_SIZE)
        record[0 : len(name)] = name
        struct.pack_into("<H", record, 0x40, len(name))
        record[0x42] = entry.kind
        record[0x43] = COLOR_BLACK
        struct.pack_into("<I", record, 0x44, entry.left_id)
        struct.pack_into("<I", record, 0x48, entry.right_id)
        struct.pack_into("<I", record, 0x4C, entry.child_id)
        record[0x50:0x60] = entry.clsid
        struct.pack_into("<I", record, 0x74, entry.start_sector)
        size = entry.size if entry.kind in (TYPE_STREAM, TYPE_ROOT) else 0
        struct.pack_into("<Q", record, 0x78, size)
        directory += record
    directory = _pad(bytes(directory), SECTOR_SIZE)

    # --- 4. Naglowek --------------------------------------------------------
    header = bytearray(SECTOR_SIZE)
    header[0:8] = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
    struct.pack_into("<H", header, 0x18, 0x003E)  # MinorVersion
    struct.pack_into("<H", header, 0x1A, 0x0003)  # MajorVersion
    struct.pack_into("<H", header, 0x1C, 0xFFFE)  # ByteOrder
    struct.pack_into("<H", header, 0x1E, 9)  # SectorShift -> 512
    struct.pack_into("<H", header, 0x20, 6)  # MiniSectorShift -> 64
    struct.pack_into("<I", header, 0x28, 0)  # NumDirectorySectors (0 dla v3)
    struct.pack_into("<I", header, 0x2C, fat_sector_count)
    struct.pack_into("<I", header, 0x30, directory_sectors[0])
    struct.pack_into("<I", header, 0x38, MINI_CUTOFF)
    struct.pack_into(
        "<I", header, 0x3C, mini_fat_sectors[0] if mini_fat_sectors else ENDOFCHAIN
    )
    struct.pack_into("<I", header, 0x40, len(mini_fat_sectors))
    struct.pack_into("<I", header, 0x44, ENDOFCHAIN)  # FirstDIFATSector
    struct.pack_into("<I", header, 0x48, 0)  # NumDIFATSectors
    for slot in range(109):
        value = fat_sectors[slot] if slot < len(fat_sectors) else FREESECT
        struct.pack_into("<I", header, 0x4C + slot * 4, value)

    # --- 5. Zlozenie pliku --------------------------------------------------
    image = bytearray(header)
    blob_by_sector: dict[int, bytes] = {}
    for (_, blob), (_, sectors) in zip(payloads, stream_sectors):
        for offset, sector in enumerate(sectors):
            blob_by_sector[sector] = blob[
                offset * SECTOR_SIZE : (offset + 1) * SECTOR_SIZE
            ]
    for offset, sector in enumerate(mini_stream_sectors):
        blob_by_sector[sector] = mini_stream_blob[
            offset * SECTOR_SIZE : (offset + 1) * SECTOR_SIZE
        ]
    for offset, sector in enumerate(mini_fat_sectors):
        blob_by_sector[sector] = mini_fat_bytes[
            offset * SECTOR_SIZE : (offset + 1) * SECTOR_SIZE
        ]
    for offset, sector in enumerate(directory_sectors):
        blob_by_sector[sector] = directory[
            offset * SECTOR_SIZE : (offset + 1) * SECTOR_SIZE
        ]

    fat_blob = b"".join(struct.pack("<I", value) for value in fat)
    for offset, sector in enumerate(fat_sectors):
        blob_by_sector[sector] = fat_blob[
            offset * SECTOR_SIZE : (offset + 1) * SECTOR_SIZE
        ]

    for sector in range(total_sectors):
        image += blob_by_sector.get(sector, b"\x00" * SECTOR_SIZE)

    return bytes(image)
