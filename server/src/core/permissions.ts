/**
 * Katalog uprawnień. Uprawnienia są egzekwowane wyłącznie po stronie serwera;
 * interfejs jedynie ukrywa niedostępne akcje.
 */
export const PERMISSIONS = {
  // Dokumenty operacyjne
  'pz.view': 'Podgląd przyjęć PZ',
  'pz.manage': 'Tworzenie i edycja przyjęć PZ',
  'pz.post': 'Zatwierdzanie przyjęć PZ',
  'pz.cancel': 'Anulowanie przyjęć PZ',

  'wz.view': 'Podgląd wydań WZ',
  'wz.manage': 'Tworzenie i edycja wydań WZ',
  'wz.post': 'Zatwierdzanie wydań WZ',
  'wz.cancel': 'Anulowanie wydań WZ',

  'mm.view': 'Podgląd przesunięć MM',
  'mm.manage': 'Tworzenie i edycja przesunięć MM',
  'mm.post': 'Zatwierdzanie przesunięć MM',
  'mm.cancel': 'Anulowanie przesunięć MM',

  'prod.view': 'Podgląd produkcji',
  'prod.manage': 'Tworzenie i edycja produkcji',
  'prod.post': 'Zatwierdzanie produkcji',
  'prod.cancel': 'Anulowanie produkcji',

  'tr.view': 'Podgląd transportów',
  'tr.manage': 'Tworzenie i edycja transportów',
  'tr.post': 'Zatwierdzanie transportów',
  'tr.cancel': 'Anulowanie transportów',

  'sd.view': 'Podgląd sprzedaży bezpośredniej',
  'sd.manage': 'Tworzenie i edycja sprzedaży bezpośredniej',
  'sd.post': 'Zatwierdzanie sprzedaży bezpośredniej',
  'sd.cancel': 'Anulowanie sprzedaży bezpośredniej',

  // Dane i zestawienia
  'stock.view': 'Podgląd stanow magazynowych',
  'stock.allow_negative': 'Zgoda na stan ujemny (operacja wyjątkowa)',
  'reports.view': 'Dostęp do raportow',
  'reports.export': 'Eksport danych',
  'audit.view': 'Dostęp do historii zmian',
  'attachments.manage': 'Dodawanie i usuwanie załączników',

  // Administracja
  'admin.users': 'Zarządzanie uzytkownikami i rolami',
  'admin.warehouses': 'Zarządzanie magazynami',
  'admin.products': 'Zarządzanie produktami',
  'admin.partners': 'Zarządzanie kontrahentami',
  'admin.settings': 'Zarządzanie ustawieniami systemu',
  'admin.backup': 'Kopie zapasowe i konserwacja bazy',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function moduleOf(permission: Permission): string {
  const idx = permission.indexOf('.');
  return idx === -1 ? permission : permission.slice(0, idx);
}

export const DOC_PERMISSION_PREFIX = {
  PZ: 'pz',
  WZ: 'wz',
  MM: 'mm',
  PROD: 'prod',
  TR: 'tr',
  SD: 'sd',
} as const;

export type DocType = keyof typeof DOC_PERMISSION_PREFIX;

export const DOC_TYPES = Object.keys(DOC_PERMISSION_PREFIX) as DocType[];

export function docPermission(docType: DocType, action: 'view' | 'manage' | 'post' | 'cancel'): Permission {
  return `${DOC_PERMISSION_PREFIX[docType]}.${action}` as Permission;
}

/** Predefiniowane role systemowe wraz z przypisanymi uprawnieniami. */
export const ROLE_DEFINITIONS: Array<{
  code: string;
  name: string;
  description: string;
  permissions: Permission[];
}> = [
  {
    code: 'ADMIN',
    name: 'Administrator',
    description: 'Pełny dostęp do systemu, konfiguracji i uprawnień.',
    permissions: [...ALL_PERMISSIONS],
  },
  {
    code: 'MANAGER',
    name: 'Manager',
    description: 'Pełna obsługa operacyjna, raporty i historia zmian.',
    permissions: [
      'pz.view', 'pz.manage', 'pz.post', 'pz.cancel',
      'wz.view', 'wz.manage', 'wz.post', 'wz.cancel',
      'mm.view', 'mm.manage', 'mm.post', 'mm.cancel',
      'prod.view', 'prod.manage', 'prod.post', 'prod.cancel',
      'tr.view', 'tr.manage', 'tr.post', 'tr.cancel',
      'sd.view', 'sd.manage', 'sd.post', 'sd.cancel',
      'stock.view', 'reports.view', 'reports.export', 'audit.view',
      'attachments.manage', 'admin.products', 'admin.partners',
    ],
  },
  {
    code: 'WAREHOUSE',
    name: 'Magazynier',
    description: 'Operacje magazynowe w przypisanych magazynach.',
    permissions: [
      'pz.view', 'pz.manage', 'pz.post',
      'wz.view', 'wz.manage', 'wz.post',
      'mm.view', 'mm.manage', 'mm.post',
      'prod.view', 'prod.manage', 'prod.post',
      'tr.view', 'tr.manage', 'tr.post',
      'sd.view',
      'stock.view', 'reports.view', 'attachments.manage',
    ],
  },
  {
    code: 'VIEWER',
    name: 'Podgląd',
    description: 'Dostęp wyłącznie do odczytu.',
    permissions: [
      'pz.view', 'wz.view', 'mm.view', 'prod.view', 'tr.view', 'sd.view',
      'stock.view', 'reports.view',
    ],
  },
];
