"""Ustawienia systemu - parametry biznesowe i techniczne.

Przechowywane w arkuszu USTAWIENIA pliku danych, dzięki czemu aplikacja
i skoroszyt Excela czytają dokładnie te same wartości.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# (klucz, wartość domyślna, opis)
DOMYSLNE: list[tuple[str, object, str]] = [
    ("FIRMA", "ResInvest Commodities", "Nazwa firmy drukowana na raportach"),
    ("MAGAZYN", "Magazyn Pyskowice", "Domyślna lokalizacja tego stanowiska"),
    ("STAWKA_TRANSPORT_KM", 5.0, "Stawka za kilometr transportu [zł/km]"),
    ("PRZELICZNIK_MP_TONA", 0.33, "Ile ton waży 1 metr przestrzenny"),
    ("PRZELICZNIK_M3_MP", 4.0, "Ile MP daje 1 m3"),
    ("PRZELICZNIK_GJ_TONA", 8.5, "Ile GJ energii daje 1 tona"),
    ("MAX_DNI_ROBOCZYCH_WSTECZ", 2, "Limit wstecznego datowania (0 = bez limitu)"),
    ("MAX_DNI_WPRZOD", 30, "Limit datowania w przód (0 = bez limitu)"),
    ("FOLDER_KOPII", "", "Folder kopii zapasowych (puste = podfolder obok pliku)"),
    ("KOPIA_AUTOMATYCZNA", "TAK", "Kopia zapasowa przy pierwszym zapisie w dniu"),
    ("KOPIE_DO_ZACHOWANIA", 30, "Ile ostatnich kopii zachować"),
    ("WYMAGAJ_POLA_UTWORZYL", "TAK", "Czy pole 'Utworzył' jest obowiązkowe"),
    ("OSTRZEGAJ_O_DUBLACH", "TAK", "Ostrzeganie przy powtórzonym numerze WZ"),
    ("DOMYSLNY_AUTOR", "", "Podpowiedź do pola 'Utworzył'"),
    ("SUROWIEC_DOMYSLNY", "Zrzyna", "Surowiec zużywany automatycznie przy produkcji"),
    ("OSTATNIA_KOPIA", "", "Data ostatniej kopii automatycznej"),
    ("MOTYW", "ciemny", "Motyw interfejsu: ciemny albo jasny"),
]


def _liczba(wartosc: object, domyslna: float) -> float:
    if isinstance(wartosc, (int, float)):
        return float(wartosc)
    tekst = str(wartosc or "").strip().replace(" ", "").replace(",", ".")
    try:
        return float(tekst)
    except ValueError:
        return domyslna


@dataclass
class Ustawienia:
    """Zestaw ustawień z dostępem po kluczu i przez właściwości."""

    wartosci: dict[str, object] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for klucz, domyslna, _ in DOMYSLNE:
            self.wartosci.setdefault(klucz, domyslna)

    # --- dostęp surowy -------------------------------------------------
    def get(self, klucz: str, domyslna: object = "") -> object:
        return self.wartosci.get(klucz.upper(), domyslna)

    def ustaw(self, klucz: str, wartosc: object) -> None:
        self.wartosci[klucz.upper()] = wartosc

    def liczba(self, klucz: str, domyslna: float) -> float:
        return _liczba(self.get(klucz, domyslna), domyslna)

    def tak(self, klucz: str, domyslna: bool = True) -> bool:
        surowa = str(self.get(klucz, "TAK" if domyslna else "NIE")).strip().upper()
        return surowa in ("TAK", "PRAWDA", "TRUE", "1")

    def tekst(self, klucz: str, domyslna: str = "") -> str:
        return str(self.get(klucz, domyslna) or "").strip()

    # --- parametry biznesowe -------------------------------------------
    @property
    def stawka_km(self) -> float:
        wartosc = self.liczba("STAWKA_TRANSPORT_KM", 5.0)
        return wartosc if wartosc > 0 else 5.0

    @property
    def mp_na_tone(self) -> float:
        wartosc = self.liczba("PRZELICZNIK_MP_TONA", 0.33)
        return wartosc if wartosc > 0 else 0.33

    @property
    def m3_na_mp(self) -> float:
        wartosc = self.liczba("PRZELICZNIK_M3_MP", 4.0)
        return wartosc if wartosc > 0 else 4.0

    @property
    def gj_na_tone(self) -> float:
        wartosc = self.liczba("PRZELICZNIK_GJ_TONA", 8.5)
        return wartosc if wartosc > 0 else 8.5

    @property
    def dni_wstecz(self) -> int:
        return int(self.liczba("MAX_DNI_ROBOCZYCH_WSTECZ", 2))

    @property
    def dni_wprzod(self) -> int:
        return int(self.liczba("MAX_DNI_WPRZOD", 30))

    @property
    def wymagaj_autora(self) -> bool:
        return self.tak("WYMAGAJ_POLA_UTWORZYL", True)

    @property
    def ostrzegaj_o_dublach(self) -> bool:
        return self.tak("OSTRZEGAJ_O_DUBLACH", True)

    @property
    def surowiec_domyslny(self) -> str:
        return self.tekst("SUROWIEC_DOMYSLNY", "Zrzyna") or "Zrzyna"

    @property
    def motyw(self) -> str:
        return self.tekst("MOTYW", "ciemny").lower() or "ciemny"

    def opisy(self) -> dict[str, str]:
        return {klucz: opis for klucz, _, opis in DOMYSLNE}
