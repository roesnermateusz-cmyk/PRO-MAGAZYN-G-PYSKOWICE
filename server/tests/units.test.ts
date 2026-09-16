import { describe, expect, it } from 'vitest';
import { convert, deriveQuantities, normalizeRates, roundQty } from '../src/core/units.js';
import { lineValueGr, toGrosze, toPln } from '../src/core/money.js';
import { monthRange, isIsoDate, yearRange } from '../src/core/time.js';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../src/core/password.js';

describe('przeliczniki jednostek', () => {
  it('przelicza 100 m3 na 400 MP i 132 t', () => {
    const result = deriveQuantities(100, 'M3');
    expect(result.m3).toBe(100);
    expect(result.mp).toBe(400);
    expect(result.t).toBe(132);
  });

  it('przelicza 400 MP na 100 m3', () => {
    const result = deriveQuantities(400, 'MP');
    expect(result.m3).toBe(100);
    expect(result.mp).toBe(400);
    expect(result.t).toBe(132);
  });

  it('przelicza tony z powrotem na MP i m3', () => {
    const result = deriveQuantities(132, 'T');
    expect(result.mp).toBe(400);
    expect(result.m3).toBe(100);
  });

  it('nie przelicza jednostki SZT', () => {
    expect(deriveQuantities(10, 'SZT')).toEqual({ m3: 0, mp: 0, t: 0 });
    expect(() => convert(10, 'SZT', 'MP')).toThrow();
  });

  it('respektuje przeliczniki indywidualne produktu', () => {
    const rates = { m3PerMp: 0.2, tPerMp: 0.28 };
    const result = deriveQuantities(100, 'M3', rates);
    expect(result.mp).toBe(500);
    expect(result.t).toBe(140);
  });

  it('zastepuje nieprawidłowe przeliczniki wartosciami domyslnymi', () => {
    expect(normalizeRates({ m3PerMp: 0, tPerMp: -1 })).toEqual({ m3PerMp: 0.25, tPerMp: 0.33 });
    expect(normalizeRates(null)).toEqual({ m3PerMp: 0.25, tPerMp: 0.33 });
  });

  it('zaokragla ilości do czterech miejsc', () => {
    expect(roundQty(1.000049)).toBe(1);
    expect(roundQty(1.00005)).toBe(1.0001);
  });

  it('konwersja w obie strony zachowuje wartość', () => {
    const mp = convert(37.5, 'M3', 'MP');
    expect(convert(mp, 'MP', 'M3')).toBe(37.5);
  });
});

describe('arytmetyka kwot', () => {
  it('konwertuje zlote na grosze bez błędu zaokraglenia', () => {
    expect(toGrosze(165.15)).toBe(16515);
    expect(toGrosze(0.1 + 0.2)).toBe(30);
    expect(toPln(16515)).toBe(165.15);
  });

  it('wylicza wartość pozycji w groszach', () => {
    expect(lineValueGr(toGrosze(82), 180)).toBe(1476000);
    expect(toPln(lineValueGr(toGrosze(82), 180))).toBe(14760);
  });

  it('sumowanie w groszach nie kumuluje błędu zmiennoprzecinkowego', () => {
    let sum = 0;
    for (let i = 0; i < 1000; i += 1) sum += toGrosze(0.1);
    expect(toPln(sum)).toBe(100);
  });
});

describe('daty', () => {
  it('waliduje istnienie daty w kalendarzu', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('26-01-01')).toBe(false);
  });

  it('wyznacza zakres miesiaca i roku', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(yearRange(2026)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });
});

describe('hasła', () => {
  it('weryfikuje poprawne hasło i odrzuca błędne', () => {
    const hash = hashPassword('Tajne#Haslo1');
    expect(verifyPassword('Tajne#Haslo1', hash)).toBe(true);
    expect(verifyPassword('Tajne#Haslo2', hash)).toBe(false);
  });

  it('każde haszowanie używa innej soli', () => {
    expect(hashPassword('Tajne#Haslo1')).not.toBe(hashPassword('Tajne#Haslo1'));
  });

  it('odrzuca uszkodzony format hasza', () => {
    expect(verifyPassword('x', 'nieprawidłowy-format')).toBe(false);
  });

  it('egzekwuje polityke zlozonosci hasła', () => {
    expect(validatePasswordStrength('krotkie')).not.toBeNull();
    expect(validatePasswordStrength('bezwielkich123')).not.toBeNull();
    expect(validatePasswordStrength('BezCyfrLiter')).not.toBeNull();
    expect(validatePasswordStrength('Poprawne123')).toBeNull();
  });
});
