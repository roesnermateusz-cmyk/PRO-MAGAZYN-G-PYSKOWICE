/// <reference types="vite/client" />

/**
 * Numer wersji wstrzykiwany przez Vite przy budowaniu (patrz vite.config.ts).
 * Pochodzi z client/package.json, dzięki czemu wersja pokazywana użytkownikowi
 * nie wymaga ręcznej aktualizacji w kodzie.
 */
declare const __APP_VERSION__: string;
