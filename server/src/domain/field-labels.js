/**
 * Rejestr etykiet pól — po to, żeby historia zmian dała się czytać.
 *
 * Dziennik audytu zapisuje zmiany kluczami z API (`mpToTonne`, `isDefault`,
 * `rules.backdate_days`). Wystawienie tego wprost kontroli albo księgowej
 * mija się z celem: wpis ma odpowiadać na pytanie „co zmieniono”, a nie
 * zmuszać do zgadywania, co oznacza `tonneToGj`.
 *
 * Etykiety NIE są tu wpisywane ręcznie. Każde pole ma już polską nazwę
 * w schemacie walidacji (`label`), bo z tego samego schematu biorą się
 * komunikaty błędów formularza. Ten moduł jest wyłącznie miejscem, w którym
 * schematy ogłaszają swoje etykiety, żeby dziennik mógł z nich skorzystać.
 * Dzięki temu dodanie pola do kartoteki nie wymaga pamiętania o drugim
 * miejscu — nowe pole ma etykietę w dzienniku od pierwszego dnia.
 *
 * Moduł jest LIŚCIEM grafu importów (nic nie importuje) — dziennik audytu
 * może po niego sięgnąć bez ryzyka cyklu.
 */

/** `nazwaEncji → { poleApi: 'Etykieta po polsku' }`. */
const rejestr = new Map();

/**
 * Ogłasza etykiety pól jednej encji.
 *
 * @param {string} entity nazwa encji taka, jaka trafia do dziennika
 *   (zwykle nazwa tabeli: `products`, `users`, `settings`)
 * @param {object} schema schemat walidacji — czytane jest wyłącznie `label`
 * @param {Record<string,string>} [dodatkowe] pola spoza schematu, które
 *   pojawiają się w dzienniku (np. `haslo`, zapisywane jako sam fakt zmiany)
 */
export function registerLabels(entity, schema = {}, dodatkowe = {}) {
  const etykiety = rejestr.get(entity) ?? {};
  for (const [pole, regula] of Object.entries(schema)) {
    if (regula?.label) etykiety[pole] = regula.label;
  }
  Object.assign(etykiety, dodatkowe);
  rejestr.set(entity, etykiety);
}

/**
 * Etykieta pola. Bez wpisu w rejestrze zwraca sam klucz — historia ma być
 * wtedy mniej czytelna, ale nigdy pusta.
 */
export function labelFor(entity, field) {
  return rejestr.get(entity)?.[field] ?? field;
}

/** Komplet etykiet encji (na potrzeby diagnostyki i testów). */
export const labelsFor = (entity) => ({ ...(rejestr.get(entity) ?? {}) });

/** Encje, które zdążyły się zarejestrować — używane w teście kompletności. */
export const registeredEntities = () => [...rejestr.keys()];
