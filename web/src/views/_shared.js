/**
 * Wspólne elementy widoków.
 *
 * Wzorce powtarzały się w kilku ekranach naraz: obsługa pobierania pliku
 * (pięć kopii tego samego `try/catch/toast`) i etykiety jednostek (trzy różne
 * zapisy tego samego mapowania). Zebrane tutaj mają jedno miejsce zmiany.
 */
import api from '../core/api.js';
import { toast, toastError } from '../core/ui.js';

/** Etykiety jednostek — jedno źródło dla całego interfejsu. */
export const UNIT_LABEL = Object.freeze({ M3: 'm³', MP: 'MP', TONA: 't' });

/** `M3` → `m³`; nieznana jednostka wraca bez zmian. */
export const unitLabel = (unit) => UNIT_LABEL[unit] ?? unit ?? '';

/**
 * Pobranie pliku z API wraz z obsługą powiadomień.
 * Zwraca funkcję gotową do podpięcia pod `click`.
 *
 * @param {string} path ścieżka API
 * @param {() => object} getQuery parametry liczone w chwili kliknięcia (aktualne filtry)
 * @param {string} filename nazwa zastępcza, gdy serwer jej nie poda
 * @param {string} [message] treść powiadomienia po sukcesie
 */
export function downloadHandler(path, getQuery, filename, message = 'Plik został pobrany') {
  return async () => {
    try {
      await api.download(path, typeof getQuery === 'function' ? getQuery() : getQuery, filename);
      toast(message);
    } catch (err) {
      toastError(err);
    }
  };
}


