/**
 * Katalog uprawnien. Uprawnienia sa egzekwowane wylacznie po stronie serwera;
 * interfejs jedynie ukrywa niedostepne akcje.
 */
export const PERMISSIONS = {
  // Dokumenty operacyjne
  'pz.view': 'Podglad przyjec PZ',
  'pz.manage': 'Tworzenie i edycja przyjec PZ',
  'pz.post': 'Zatwierdzanie przyjec PZ',
  'pz.cancel': 'Anulowanie przyjec PZ',

  'wz.view': 'Podglad wydan WZ',
  'wz.manage': 'Tworzenie i edycja wydan WZ',
  'wz.post': 'Zatwierdzanie wydan WZ',
  'wz.cancel': 'Anulowanie wydan WZ',

  'mm.view': 'Podglad przesuniec MM',
  'mm.manage': 'Tworzenie i edycja przesuniec MM',
  'mm.post': 'Zatwierdzanie przesuniec MM',
  'mm.cancel': 'Anulowanie przesuniec MM',

  'prod.view': 'Podglad produkcji',
  'prod.manage': 'Tworzenie i edycja produkcji',
  'prod.post': 'Zatwierdzanie produkcji',
  'prod.cancel': 'Anulowanie produkcji',

  'tr.view': 'Podglad transportow',
  'tr.manage': 'Tworzenie i edycja transportow',
  'tr.post': 'Zatwierdzanie transportow',
  'tr.cancel': 'Anulowanie transportow',

  'sd.view': 'Podglad sprzedazy bezposredniej',
  'sd.manage': 'Tworzenie i edycja sprzedazy bezposredniej',
  'sd.post': 'Zatwierdzanie sprzedazy bezposredniej',
  'sd.cancel': 'Anulowanie sprzedazy bezposredniej',

  // Dane i zestawienia
  'stock.view': 'Podglad stanow magazynowych',
  'stock.allow_negative': 'Zgoda na stan ujemny (operacja wyjatkowa)',
  'reports.view': 'Dostep do raportow',
  'reports.export': 'Eksport danych',
  'audit.view': 'Dostep do historii zmian',
  'attachments.manage': 'Dodawanie i usuwanie zalacznikow',

  // Administracja
  'admin.users': 'Zarzadzanie uzytkownikami i rolami',
  'admin.warehouses': 'Zarzadzanie magazynami',
  'admin.products': 'Zarzadzanie produktami',
  'admin.partners': 'Zarzadzanie kontrahentami',
  'admin.settings': 'Zarzadzanie ustawieniami systemu',
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
    description: 'Pelny dostep do systemu, konfiguracji i uprawnien.',
    permissions: [...ALL_PERMISSIONS],
  },
  {
    code: 'MANAGER',
    name: 'Manager',
    description: 'Pelna obsluga operacyjna, raporty i historia zmian.',
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
    name: 'Podglad',
    description: 'Dostep wylacznie do odczytu.',
    permissions: [
      'pz.view', 'wz.view', 'mm.view', 'prod.view', 'tr.view', 'sd.view',
      'stock.view', 'reports.view',
    ],
  },
];
