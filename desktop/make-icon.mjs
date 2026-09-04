#!/usr/bin/env node
/**
 * Generator ikony aplikacji (`ResInvestERP.ico`).
 *
 * PO CO WŁASNY GENERATOR
 * Ikona jest jedynym zasobem binarnym w całym projekcie. Dołożenie biblioteki
 * graficznej po to, żeby raz na zawsze narysować sześciokąt, byłoby zależnością
 * większą niż problem. Format ICO to katalog nagłówków plus mapy bitowe —
 * kilkadziesiąt linii, bez kompresji, obsługiwane przez każdą wersję Windows.
 *
 * KSZTAŁT
 * Ten sam sześciokąt, który jest sygnetem w interfejsie (`.brand .logo::before`
 * w app.css) i ten sam gradient zieleni. Ikona na pasku zadań i logo w aplikacji
 * to musi być jeden znak, inaczej użytkownik nie skojarzy okna z programem.
 *
 * Uruchomienie:  node desktop/make-icon.mjs [plik-wyjściowy]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Rozmiary wymagane przez Windows: lista, pulpit, pasek zadań, Alt+Tab. */
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/** Sygnet marki — sześciokąt w proporcjach z `app.css`. */
const HEXAGON = [
  [0.50, 0.00], [0.92, 0.22], [1.00, 0.62],
  [0.74, 1.00], [0.26, 1.00], [0.00, 0.62], [0.08, 0.22],
];

/** Gradient zieleni biomasy: jasna góra, ciemny dół. */
const TOP = { r: 0x4F, g: 0xC3, b: 0x7C };
const BOTTOM = { r: 0x1C, g: 0x5E, b: 0x3A };

/** Czy punkt leży wewnątrz wielokąta (algorytm promienia). */
function inside(px, py, polygon) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * Rysuje jeden rozmiar ikony jako mapę BGRA.
 *
 * Wygładzanie krawędzi liczymy przez nadpróbkowanie 4x4: dla każdego piksela
 * sprawdzamy szesnaście punktów i bierzemy udział tych wewnątrz kształtu jako
 * krycie. Bez tego sześciokąt w rozmiarze 16 px wygląda na poszarpany.
 */
function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const SUB = 4;
  const inset = size <= 24 ? 0.02 : 0.06;
  const scale = 1 - inset * 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let covered = 0;
      for (let sy = 0; sy < SUB; sy += 1) {
        for (let sx = 0; sx < SUB; sx += 1) {
          const px = ((x + (sx + 0.5) / SUB) / size - inset) / scale;
          const py = ((y + (sy + 0.5) / SUB) / size - inset) / scale;
          if (px >= 0 && px <= 1 && py >= 0 && py <= 1 && inside(px, py, HEXAGON)) covered += 1;
        }
      }
      const alpha = Math.round((covered / (SUB * SUB)) * 255);
      const t = y / (size - 1);
      const offset = (y * size + x) * 4;
      // Kolejność bajtów w mapie DIB to BGRA, nie RGBA.
      pixels[offset] = Math.round(TOP.b + (BOTTOM.b - TOP.b) * t);
      pixels[offset + 1] = Math.round(TOP.g + (BOTTOM.g - TOP.g) * t);
      pixels[offset + 2] = Math.round(TOP.r + (BOTTOM.r - TOP.r) * t);
      pixels[offset + 3] = alpha;
    }
  }
  return pixels;
}

/**
 * Składa obraz ICO: nagłówek DIB o podwójnej wysokości (maska XOR + AND),
 * wiersze od dołu do góry, maska przezroczystości 1 bit na piksel.
 */
function encodeImage(size, pixels) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);           // rozmiar nagłówka
  header.writeInt32LE(size, 4);          // szerokość
  header.writeInt32LE(size * 2, 8);      // wysokość: XOR + AND
  header.writeUInt16LE(1, 12);           // płaszczyzny
  header.writeUInt16LE(32, 14);          // bity na piksel
  header.writeUInt32LE(0, 16);           // bez kompresji

  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const source = (size - 1 - y) * size * 4;
    pixels.copy(xor, y * size * 4, source, source + size * 4);
  }

  // Maska AND: wiersze wyrównane do czterech bajtów. Przy kanale alfa jest
  // zbędna, ale format jej wymaga i starsze wersje Windows ją czytają.
  const maskRow = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(maskRow * size);

  return Buffer.concat([header, xor, and]);
}

/* ------------------------------ PNG ---------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xFFFFFFFF;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * Koduje mapę BGRA jako PNG.
 *
 * Duże rozmiary ikony bez kompresji są absurdalnie ciężkie — sam obraz 256 px
 * to 270 kB, czyli więcej niż cała aplikacja w archiwum. Windows od wersji Vista
 * czyta wpisy PNG wewnątrz ICO, więc te same piksele zajmują kilka kilobajtów.
 */
function encodePng(size, bgra) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;                       // filtr: brak
    for (let x = 0; x < size; x += 1) {
      const from = (y * size + x) * 4;
      const to = y * (size * 4 + 1) + 1 + x * 4;
      raw[to] = bgra[from + 2];                        // R
      raw[to + 1] = bgra[from + 1];                    // G
      raw[to + 2] = bgra[from];                        // B
      raw[to + 3] = bgra[from + 3];                    // A
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;                                         // 8 bitów na kanał
  ihdr[9] = 6;                                         // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Powyżej tego progu opłaca się PNG; poniżej zysk jest żaden, a zgodność większa. */
const PNG_FROM = 64;

export function buildIco() {
  const images = SIZES.map((size) => {
    const pixels = drawIcon(size);
    return {
      size,
      data: size >= PNG_FROM ? encodePng(size, pixels) : encodeImage(size, pixels),
    };
  });

  const dir = Buffer.alloc(6 + images.length * 16);
  dir.writeUInt16LE(0, 0);               // zarezerwowane
  dir.writeUInt16LE(1, 2);               // typ: ikona
  dir.writeUInt16LE(images.length, 4);

  let offset = dir.length;
  images.forEach((image, i) => {
    const entry = 6 + i * 16;
    dir.writeUInt8(image.size >= 256 ? 0 : image.size, entry);      // 0 oznacza 256
    dir.writeUInt8(image.size >= 256 ? 0 : image.size, entry + 1);
    dir.writeUInt8(0, entry + 2);        // paleta: brak
    dir.writeUInt8(0, entry + 3);
    dir.writeUInt16LE(1, entry + 4);     // płaszczyzny
    dir.writeUInt16LE(32, entry + 6);    // bity na piksel
    dir.writeUInt32LE(image.data.length, entry + 8);
    dir.writeUInt32LE(offset, entry + 12);
    offset += image.data.length;
  });

  return Buffer.concat([dir, ...images.map((i) => i.data)]);
}

/* Uruchomienie bezpośrednie: zapis pliku. */
if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2]
    ?? path.join(fileURLToPath(new URL('./installer', import.meta.url)), 'ResInvestERP.ico');
  mkdirSync(path.dirname(target), { recursive: true });
  const ico = buildIco();
  writeFileSync(target, ico);
  process.stdout.write(
    `Ikona zapisana: ${target}\n`
    + `  rozmiary: ${SIZES.join(', ')} px\n`
    + `  rozmiar pliku: ${(ico.length / 1024).toFixed(1)} kB\n`,
  );
}
