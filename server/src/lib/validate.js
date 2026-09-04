/**
 * Lekki walidator danych wejściowych oparty na deklaratywnym schemacie.
 *
 * Celowo minimalny: pokrywa typy używane w API (string/number/int/bool/date/enum/array/object),
 * zwraca komplet błędów naraz i normalizuje wartości (trim, konwersja liczb, domyślne).
 *
 *   const schema = {
 *     name:   { type: 'string', required: true, max: 120 },
 *     qty:    { type: 'number', min: 0.0001 },
 *     unit:   { type: 'enum', values: ['M3','MP','TONA'], default: 'M3' },
 *     date:   { type: 'date', required: true },
 *   };
 *   const value = validate(input, schema);
 */
import { ValidationError } from './errors.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isValidDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function coerce(field, rule, value, errors) {
  const label = rule.label || field;

  // Wartości puste
  if (value === undefined || value === null || value === '') {
    if (rule.required) {
      errors.push({ field, message: `Pole „${label}” jest wymagane.` });
      return undefined;
    }
    return rule.default !== undefined ? rule.default : undefined;
  }

  switch (rule.type) {
    case 'string': {
      let v = String(value);
      if (rule.trim !== false) v = v.trim();
      if (rule.upper) v = v.toUpperCase();
      if (v === '' && rule.required) {
        errors.push({ field, message: `Pole „${label}” jest wymagane.` });
        return undefined;
      }
      if (rule.min !== undefined && v.length < rule.min) {
        errors.push({ field, message: `Pole „${label}” musi mieć co najmniej ${rule.min} znaków.` });
      }
      if (rule.max !== undefined && v.length > rule.max) {
        errors.push({ field, message: `Pole „${label}” może mieć najwyżej ${rule.max} znaków.` });
      }
      if (rule.pattern && !rule.pattern.test(v)) {
        errors.push({ field, message: rule.patternMessage || `Pole „${label}” ma nieprawidłowy format.` });
      }
      return v;
    }
    case 'email': {
      const v = String(value).trim().toLowerCase();
      if (!EMAIL_RE.test(v)) errors.push({ field, message: `Pole „${label}” musi być poprawnym adresem e-mail.` });
      return v;
    }
    case 'number':
    case 'int': {
      const v = typeof value === 'number' ? value : Number(String(value).replace(',', '.').trim());
      if (!Number.isFinite(v)) {
        errors.push({ field, message: `Pole „${label}” musi być liczbą.` });
        return undefined;
      }
      if (rule.type === 'int' && !Number.isInteger(v)) {
        errors.push({ field, message: `Pole „${label}” musi być liczbą całkowitą.` });
        return undefined;
      }
      if (rule.min !== undefined && v < rule.min) {
        errors.push({ field, message: `Pole „${label}” nie może być mniejsze niż ${rule.min}.` });
      }
      if (rule.max !== undefined && v > rule.max) {
        errors.push({ field, message: `Pole „${label}” nie może być większe niż ${rule.max}.` });
      }
      return v;
    }
    case 'bool': {
      if (typeof value === 'boolean') return value;
      const v = String(value).toLowerCase();
      if (['true', '1', 'yes', 'tak'].includes(v)) return true;
      if (['false', '0', 'no', 'nie'].includes(v)) return false;
      errors.push({ field, message: `Pole „${label}” musi być wartością logiczną.` });
      return undefined;
    }
    case 'date': {
      const v = String(value).trim().slice(0, 10);
      if (!isValidDate(v)) {
        errors.push({ field, message: `Pole „${label}” musi być datą w formacie RRRR-MM-DD.` });
        return undefined;
      }
      return v;
    }
    case 'month': {
      const v = String(value).trim().slice(0, 7);
      if (!MONTH_RE.test(v)) {
        errors.push({ field, message: `Pole „${label}” musi być miesiącem w formacie RRRR-MM.` });
        return undefined;
      }
      return v;
    }
    case 'enum': {
      const v = String(value).trim();
      if (!rule.values.includes(v)) {
        errors.push({ field, message: `Pole „${label}” musi mieć jedną z wartości: ${rule.values.join(', ')}.` });
        return undefined;
      }
      return v;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        errors.push({ field, message: `Pole „${label}” musi być listą.` });
        return undefined;
      }
      if (rule.max !== undefined && value.length > rule.max) {
        errors.push({ field, message: `Pole „${label}” może zawierać najwyżej ${rule.max} pozycji.` });
        return undefined;
      }
      if (!rule.item) return value;
      const out = [];
      value.forEach((entry, i) => {
        const sub = [];
        const coerced = rule.item.type === 'object'
          ? validate(entry ?? {}, rule.item.schema, { collect: sub })
          : coerce(`${field}[${i}]`, rule.item, entry, sub);
        sub.forEach((e) => errors.push({ ...e, field: `${field}[${i}].${e.field}`.replace(/\.$/, '') }));
        out.push(coerced);
      });
      return out;
    }
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) {
        errors.push({ field, message: `Pole „${label}” musi być obiektem.` });
        return undefined;
      }
      if (!rule.schema) return value;
      const sub = [];
      const coerced = validate(value, rule.schema, { collect: sub });
      sub.forEach((e) => errors.push({ ...e, field: `${field}.${e.field}` }));
      return coerced;
    }
    default:
      return value;
  }
}

/**
 * Waliduje i normalizuje obiekt wejściowy według schematu.
 * @param {object} input dane surowe
 * @param {object} schema mapa pole → reguła
 * @param {{collect?:Array, partial?:boolean}} [options] `partial` pomija pola nieobecne w wejściu
 * @returns {object} znormalizowane dane (tylko pola ze schematu)
 */
export function validate(input, schema, options = {}) {
  const errors = options.collect || [];
  const source = input && typeof input === 'object' ? input : {};
  const out = {};

  for (const [field, rule] of Object.entries(schema)) {
    if (options.partial && !(field in source)) continue;
    const value = coerce(field, rule, source[field], errors);
    if (value !== undefined) out[field] = value;
  }

  if (!options.collect && errors.length) {
    throw new ValidationError('Formularz zawiera błędy — popraw zaznaczone pola.', errors);
  }
  return out;
}

export { isValidDate };
