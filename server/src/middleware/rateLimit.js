/**
 * Ograniczanie liczby żądań (okno przesuwne w pamięci procesu).
 *
 * Zakres: ochrona logowania przed atakiem słownikowym oraz kosztownych
 * eksportów przed przypadkowym zapętleniem klienta. Przy wdrożeniu
 * wieloinstancyjnym limit należy przenieść do współdzielonego magazynu
 * (patrz docs/ARCHITECTURE.md — sekcja „Skalowanie”).
 */
import { TooManyRequestsError } from '../lib/errors.js';

const buckets = new Map();

// Czyszczenie wygasłych wiader, żeby mapa nie rosła w nieskończoność.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of buckets) {
    const alive = hits.filter((t) => t > now - 3_600_000);
    if (alive.length) buckets.set(key, alive);
    else buckets.delete(key);
  }
}, 300_000);
sweeper.unref?.();

/**
 * @param {object} options
 * @param {string} options.name nazwa limitu (osobna przestrzeń kluczy)
 * @param {number} options.max maksymalna liczba żądań w oknie
 * @param {number} options.windowMs długość okna w milisekundach
 * @param {(ctx:object)=>string} [options.key] funkcja klucza (domyślnie adres IP)
 */
export function rateLimit({ name, max, windowMs, key }) {
  return (ctx) => {
    const id = `${name}:${key ? key(ctx) : ctx.ip}`;
    const now = Date.now();
    const hits = (buckets.get(id) || []).filter((t) => t > now - windowMs);
    if (hits.length >= max) {
      const retryAfterSec = Math.ceil((hits[0] + windowMs - now) / 1000);
      ctx.set('Retry-After', String(retryAfterSec));
      throw new TooManyRequestsError(
        `Przekroczono limit żądań. Spróbuj ponownie za ${retryAfterSec} s.`,
        retryAfterSec,
      );
    }
    hits.push(now);
    buckets.set(id, hits);
  };
}

/** Czyści liczniki (używane w testach). */
export function resetRateLimits() {
  buckets.clear();
}
