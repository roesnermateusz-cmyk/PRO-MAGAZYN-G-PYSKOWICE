"""Kompresja / dekompresja strumieni VBA zgodna z [MS-OVBA] 2.4.1.

Strumienie ``dir`` oraz strumienie modulow w pliku ``vbaProject.bin`` sa
przechowywane w formacie ``CompressedContainer``.  Modul implementuje pelny
kodek (LZ77 z tokenami kopiujacymi), dzieki czemu projekt VBA moze byc
budowany z plikow zrodlowych ``.bas`` / ``.cls`` zamiast recznej edycji
binariow.

Format w skrocie:

* bajt 0    -- ``SignatureByte`` = 0x01
* dalej     -- sekwencja ``CompressedChunk``

Kazdy ``CompressedChunk`` zaczyna sie 16-bitowym naglowkiem (little endian):

* bity 0-11  -- ``CompressedChunkSize`` = rozmiar calego chunku - 3
* bity 12-14 -- ``CompressedChunkSignature`` = 0b011
* bit 15     -- ``CompressedChunkFlag`` (1 = dane skompresowane, 0 = surowe)

Chunk skompresowany sklada sie z ``TokenSequence``: bajt flag + do 8 tokenow.
Bit ustawiony = ``CopyToken`` (2 bajty), bit zerowy = pojedynczy bajt literalu.
"""

from __future__ import annotations

MAX_CHUNK_DECOMPRESSED = 4096
SIGNATURE_BYTE = 0x01
CHUNK_SIGNATURE = 0b011


def _copy_token_bits(difference: int) -> tuple[int, int]:
    """Zwraca (bitCount, lengthMask) dla pozycji oddalonej o ``difference``
    bajtow od poczatku biezacego chunku ([MS-OVBA] 2.4.1.3.19.1)."""
    bit_count = max(4, (difference - 1).bit_length() if difference > 0 else 0)
    length_mask = 0xFFFF >> bit_count
    return bit_count, length_mask


def decompress(data: bytes) -> bytes:
    """Rozpakowuje ``CompressedContainer`` do surowych bajtow zrodla."""
    if not data:
        return b""
    if data[0] != SIGNATURE_BYTE:
        raise ValueError(f"Nieprawidlowy SignatureByte: 0x{data[0]:02X}")

    out = bytearray()
    pos = 1
    while pos + 1 < len(data):
        header = int.from_bytes(data[pos : pos + 2], "little")
        pos += 2
        size = (header & 0x0FFF) + 3
        compressed = bool(header & 0x8000)
        end = pos + size - 2
        if end > len(data):
            end = len(data)
        chunk_start = len(out)

        if not compressed:
            out += data[pos:end]
            pos = end
            continue

        while pos < end:
            flags = data[pos]
            pos += 1
            for bit in range(8):
                if pos >= end:
                    break
                if flags & (1 << bit):
                    token = int.from_bytes(data[pos : pos + 2], "little")
                    pos += 2
                    bit_count, length_mask = _copy_token_bits(len(out) - chunk_start)
                    offset = (token >> (16 - bit_count)) + 1
                    length = (token & length_mask) + 3
                    src = len(out) - offset
                    if src < 0:
                        raise ValueError("CopyToken wskazuje poza bufor")
                    for i in range(length):
                        out.append(out[src + i])
                else:
                    out.append(data[pos])
                    pos += 1
    return bytes(out)


def _find_match(chunk: bytes, pos: int, index: dict, max_offset: int, max_length: int):
    """Wyszukuje najdluzsze dopasowanie w oknie ``max_offset`` bajtow wstecz.

    Uzywa tablicy pozycji trojek bajtow (hash chain) ograniczonej do stalej
    liczby kandydatow -- kompresja ma byc poprawna i szybka, nie optymalna.
    """
    remaining = len(chunk) - pos
    if remaining < 3:
        return 0, 0

    key = chunk[pos : pos + 3]
    candidates = index.get(key)
    if not candidates:
        return 0, 0

    limit = pos - max_offset
    best_length = 0
    best_offset = 0
    cap = min(max_length, remaining)

    # Najswiezsze pozycje daja najmniejszy offset, wiec idziemy od konca listy.
    for candidate in reversed(candidates[-32:]):
        if candidate < limit:
            break
        length = 3
        # Dopasowanie moze zachodzic na siebie (RLE) - dekoder kopiuje bajt po bajcie.
        while length < cap and chunk[candidate + length] == chunk[pos + length]:
            length += 1
        if length > best_length:
            best_length = length
            best_offset = pos - candidate
            if best_length >= cap:
                break
    return best_length, best_offset


def _compress_chunk(chunk: bytes) -> bytes:
    """Koduje pojedynczy chunk (max 4096 bajtow) jako sekwencje tokenow."""
    out = bytearray()
    index: dict[bytes, list[int]] = {}
    pos = 0

    while pos < len(chunk):
        flag_index = len(out)
        out.append(0)
        flags = 0

        for bit in range(8):
            if pos >= len(chunk):
                break
            bit_count, length_mask = _copy_token_bits(pos)
            max_offset = 1 << bit_count
            max_length = length_mask + 3

            length, offset = _find_match(chunk, pos, index, max_offset, max_length)
            if length >= 3:
                token = ((offset - 1) << (16 - bit_count)) | (length - 3)
                out += token.to_bytes(2, "little")
                flags |= 1 << bit
            else:
                out.append(chunk[pos])
                length = 1

            for i in range(pos, pos + length):
                if i + 3 <= len(chunk):
                    index.setdefault(chunk[i : i + 3], []).append(i)
            pos += length

        out[flag_index] = flags

    return bytes(out)


def compress(data: bytes) -> bytes:
    """Pakuje surowe bajty do ``CompressedContainer``."""
    out = bytearray([SIGNATURE_BYTE])

    for start in range(0, len(data), MAX_CHUNK_DECOMPRESSED):
        chunk = data[start : start + MAX_CHUNK_DECOMPRESSED]
        encoded = _compress_chunk(chunk)

        # Pole CompressedChunkSize ma 12 bitow, wiec dane chunku nie moga
        # przekroczyc 4096 bajtow.  Gdy kodowanie tokenami sie nie miesci,
        # jedynym wyjsciem jest chunk surowy - ten zas z definicji przechowuje
        # pelne 4096 bajtow.
        if len(encoded) <= MAX_CHUNK_DECOMPRESSED:
            header = (
                ((len(encoded) + 2 - 3) & 0x0FFF) | (CHUNK_SIGNATURE << 12) | 0x8000
            )
            out += header.to_bytes(2, "little")
            out += encoded
        elif len(chunk) == MAX_CHUNK_DECOMPRESSED:
            header = ((len(chunk) + 2 - 3) & 0x0FFF) | (CHUNK_SIGNATURE << 12)
            out += header.to_bytes(2, "little")
            out += chunk
        else:  # pragma: no cover - nieosiagalne dla tekstu zrodlowego VBA
            raise ValueError(
                "Ostatni chunk jest nieskompresowalny i niepelny - "
                "nie da sie go zapisac zgodnie z [MS-OVBA]"
            )

    if not data:
        out += (0x0000 | (CHUNK_SIGNATURE << 12)).to_bytes(2, "little")

    return bytes(out)
