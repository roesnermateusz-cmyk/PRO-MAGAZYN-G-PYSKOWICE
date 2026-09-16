import crypto from 'node:crypto';

/**
 * Haszowanie haseł: scrypt z modulu wbudowanego node:crypto.
 * Format przechowywania: scrypt$N$r$p$saltBase64$hashBase64
 * Zaleta wobec bibliotek natywnych: brak kompilacji przy instalacji na Windows.
 */
const PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain.normalize('NFKC'), salt, PARAMS.keylen, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: 128 * PARAMS.N * PARAMS.r * 2,
  });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] as string, 'base64');
    expected = Buffer.from(parts[5] as string, 'base64');
  } catch {
    return false;
  }

  const actual = crypto.scryptSync(plain.normalize('NFKC'), salt, expected.length, {
    N,
    r,
    p,
    maxmem: 128 * N * r * 2,
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function sha256Hex(input: crypto.BinaryLike): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Minimalna polityka haseł egzekwowana przy tworzeniu i zmianie hasła. */
export function validatePasswordStrength(plain: string): string | null {
  if (plain.length < 10) return 'Hasło musi miec co najmniej 10 znaków.';
  if (!/[a-z]/.test(plain)) return 'Hasło musi zawierać mala litere.';
  if (!/[A-Z]/.test(plain)) return 'Hasło musi zawierać wielka litere.';
  if (!/[0-9]/.test(plain)) return 'Hasło musi zawierać cyfre.';
  return null;
}
