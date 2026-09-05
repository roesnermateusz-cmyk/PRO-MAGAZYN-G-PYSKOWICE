/**
 * Testy walidatora — kontrakt „brak pola” kontra „pole wyczyszczone”.
 *
 * To rozróżnienie decyduje o tym, czy korekta dokumentu potrafi usunąć błędnie
 * wpisaną wartość. Zapisane tutaj, żeby nie zginęło przy kolejnej zmianie
 * w `lib/validate.js`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { validate } from '../src/lib/validate.js';
import { likePattern, LIKE_ESCAPE } from '../src/db/index.js';

const SCHEMA = {
  name: { type: 'string', required: true, max: 20, label: 'Nazwa' },
  note: { type: 'string', max: 50, label: 'Uwaga' },
  code: { type: 'string', max: 10, upper: true, default: 'BRAK', label: 'Kod' },
  amount: { type: 'number', min: 0, default: 0, label: 'Kwota' },
  count: { type: 'int', min: 0, label: 'Sztuki' },
  active: { type: 'bool', default: true, label: 'Aktywny' },
  day: { type: 'date', label: 'Dzień' },
};

test('pole nieobecne w wejściu nie pojawia się w wyniku', () => {
  const out = validate({ name: 'Dokument' }, SCHEMA, { partial: true });
  assert.deepEqual(Object.keys(out), ['name']);
  assert.equal('note' in out, false);
});

test('pole obecne i puste daje null — sygnał wyczyszczenia', () => {
  const out = validate({ note: '', day: null }, SCHEMA, { partial: true });
  assert.equal(out.note, null);
  assert.equal(out.day, null);
  assert.equal('note' in out, true, 'klucz musi być obecny, inaczej zapis go pominie');
});

test('ciąg samych spacji jest wartością pustą, nie napisem', () => {
  const out = validate({ note: '   \t ' }, SCHEMA, { partial: true });
  assert.equal(out.note, null);
});

test('wartość domyślna wygrywa z wyczyszczeniem', () => {
  const out = validate({ code: '', amount: '', active: '' }, SCHEMA, { partial: true });
  assert.equal(out.code, 'BRAK');
  assert.equal(out.amount, 0);
  assert.equal(out.active, true);
});

test('pole wymagane i puste to błąd, nie wyczyszczenie', () => {
  assert.throws(
    () => validate({ name: '' }, SCHEMA, { partial: true }),
    (err) => err.details.some((d) => d.field === 'name' && /wymagane/.test(d.message)),
  );
  assert.throws(
    () => validate({ name: '   ' }, SCHEMA, { partial: true }),
    (err) => err.details.some((d) => d.field === 'name'),
  );
});

test('zero i false nie są wartościami pustymi', () => {
  const out = validate({ name: 'X', count: 0, active: false, amount: 0 }, SCHEMA);
  assert.equal(out.count, 0);
  assert.equal(out.active, false);
  assert.equal(out.amount, 0);
});

test('bez partial pola nieobecne bez wartości domyślnej są pomijane', () => {
  const out = validate({ name: 'X' }, SCHEMA);
  assert.equal('note' in out, false, 'brak pola przy tworzeniu to brak, nie null');
  assert.equal(out.code, 'BRAK', 'pola z wartością domyślną są uzupełniane');
});

test('walidator zbiera wszystkie błędy naraz', () => {
  assert.throws(
    () => validate({ name: 'X'.repeat(30), count: 'nie liczba', day: '2026-13-45' }, SCHEMA),
    (err) => err.details.length === 3,
  );
});

test('metaznaki LIKE są neutralizowane, zwykły tekst zostaje bez zmian', () => {
  assert.equal(likePattern('A_B'), '%A\\_B%');
  assert.equal(likePattern('50%'), '%50\\%%');
  assert.equal(likePattern('C:\\dane'), '%C:\\\\dane%');
  assert.equal(likePattern('PZ/2026/000123'), '%PZ/2026/000123%');
  assert.equal(LIKE_ESCAPE, "ESCAPE '\\'");
});
