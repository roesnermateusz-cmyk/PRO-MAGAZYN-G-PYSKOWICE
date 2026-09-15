"""Reguły poprawności operacji magazynowych.

Ten sam zestaw reguł obowiązuje przy wpisie ręcznym w aplikacji
i przy imporcie z pliku - kartoteka nie przyjmie danych, których
formularz by nie przepuścił.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from .operacja import Operacja, OperacjeRownolegle, TypOperacji
from .ustawienia import Ustawienia


@dataclass
class WynikWalidacji:
    """Zebrane problemy wraz ze wskazaniem pól, których dotyczą."""

    bledy: list[str] = field(default_factory=list)
    pola: set[str] = field(default_factory=set)

    @property
    def poprawne(self) -> bool:
        return not self.bledy

    def dodaj(self, komunikat: str, *pola: str) -> None:
        self.bledy.append(komunikat)
        self.pola.update(pola)

    def tekst(self) -> str:
        return "\n".join(f"•  {blad}" for blad in self.bledy)


def data_minus_dni_robocze(od: date, ile: int) -> date:
    """Cofa się o podaną liczbę dni roboczych, pomijając weekendy."""
    biezaca = od
    policzone = 0
    while policzone < ile:
        biezaca -= timedelta(days=1)
        if biezaca.weekday() < 5:
            policzone += 1
    return biezaca


def sprawdz(op: Operacja, ust: Ustawienia, dzisiaj: date | None = None) -> WynikWalidacji:
    """Sprawdza pojedynczą operację."""
    wynik = WynikWalidacji()
    dzisiaj = dzisiaj or date.today()

    if op.typ is None:
        wynik.dodaj("Nie wybrano typu operacji.", "typ")

    if op.data_operacji is None:
        wynik.dodaj("Brak daty operacji.", "data_operacji")
    else:
        _sprawdz_date(op.data_operacji, ust, dzisiaj, wynik)

    if ust.wymagaj_autora and not op.utworzyl.strip():
        wynik.dodaj('Pole „Utworzył” jest wymagane (imię i nazwisko).', "utworzyl")

    if op.typ is TypOperacji.TRANSPORT:
        _sprawdz_transport(op, wynik)
    else:
        _sprawdz_towar(op, wynik)
        if op.typ is TypOperacji.MM:
            if op.dostawca.strip().upper() == op.odbiorca.strip().upper():
                wynik.dodaj(
                    "Przy przesunięciu MM magazyn źródłowy i docelowy muszą być różne.",
                    "dostawca",
                    "odbiorca",
                )

    if op.cena_zakupu < 0:
        wynik.dodaj("Cena zakupu nie może być ujemna.", "cena_zakupu")
    if op.cena_sprzedazy < 0:
        wynik.dodaj("Cena sprzedaży nie może być ujemna.", "cena_sprzedazy")
    if op.koszt_rabania < 0:
        wynik.dodaj("Koszt rąbania nie może być ujemny.", "koszt_rabania")

    if op.typ is TypOperacji.SPRZEDAZ and op.cena_sprzedazy <= 0:
        wynik.dodaj("Sprzedaż wymaga podania ceny sprzedaży.", "cena_sprzedazy")

    if op.odleglosc < 0:
        wynik.dodaj("Odległość nie może być ujemna.", "odleglosc")
    if op.stawka_km < 0:
        wynik.dodaj("Stawka za kilometr nie może być ujemna.", "stawka_km")
    if op.koszt_transportu < 0:
        wynik.dodaj("Koszt transportu nie może być ujemny.", "koszt_transportu")

    if op.nr_rejestracyjny.strip() and not op.przewoznik.strip():
        wynik.dodaj("Podano numer rejestracyjny bez przewoźnika.", "przewoznik")

    return wynik


def _sprawdz_date(data_operacji: date, ust: Ustawienia, dzisiaj: date, wynik: WynikWalidacji) -> None:
    if ust.dni_wstecz > 0:
        najwczesniejsza = data_minus_dni_robocze(dzisiaj, ust.dni_wstecz)
        if data_operacji < najwczesniejsza:
            wynik.dodaj(
                f"Data operacji jest starsza niż {ust.dni_wstecz} dni robocze wstecz "
                f"(najwcześniejsza dozwolona: {najwczesniejsza:%d.%m.%Y}).",
                "data_operacji",
            )
    if ust.dni_wprzod > 0:
        najpozniejsza = dzisiaj + timedelta(days=ust.dni_wprzod)
        if data_operacji > najpozniejsza:
            wynik.dodaj(
                f"Data operacji jest późniejsza niż {ust.dni_wprzod} dni w przód "
                f"(najpóźniejsza dozwolona: {najpozniejsza:%d.%m.%Y}).",
                "data_operacji",
            )


def _sprawdz_towar(op: Operacja, wynik: WynikWalidacji) -> None:
    if not op.produkt.strip():
        wynik.dodaj("Nie wybrano produktu.", "produkt")
    if op.volumen <= 0:
        wynik.dodaj("Wolumen musi być liczbą większą od zera.", "volumen")
    if not op.jednostka.strip():
        wynik.dodaj("Nie wybrano jednostki miary.", "jednostka")
    if not op.dostawca.strip():
        wynik.dodaj("Nie wybrano dostawcy / magazynu źródłowego.", "dostawca")
    if not op.odbiorca.strip():
        wynik.dodaj("Nie wybrano odbiorcy / magazynu docelowego.", "odbiorca")


def _sprawdz_transport(op: Operacja, wynik: WynikWalidacji) -> None:
    if not op.przewoznik.strip():
        wynik.dodaj("Operacja TRANSPORT wymaga wskazania przewoźnika.", "przewoznik")
    if not op.nr_rejestracyjny.strip():
        wynik.dodaj("Operacja TRANSPORT wymaga numeru rejestracyjnego.", "nr_rejestracyjny")
    if op.odleglosc <= 0 and op.koszt_transportu <= 0:
        wynik.dodaj(
            "Podaj odległość w km (koszt zostanie wyliczony) albo wpisz koszt transportu.",
            "odleglosc",
            "koszt_transportu",
        )


def sprawdz_rownolegle(rown: OperacjeRownolegle) -> WynikWalidacji:
    """Sprawdza komplet danych operacji równoległych."""
    wynik = WynikWalidacji()

    if rown.produkcja:
        if not rown.produkt_produkcji.strip():
            wynik.dodaj("Produkcja równoległa: nie wybrano produktu wyjściowego.", "produkt_produkcji")
        if rown.volumen_produkcji <= 0:
            wynik.dodaj("Produkcja równoległa: wolumen musi być większy od zera.", "volumen_produkcji")
        if not rown.jednostka_produkcji.strip():
            wynik.dodaj("Produkcja równoległa: nie wybrano jednostki miary.", "jednostka_produkcji")

    if rown.sprzedaz:
        if not rown.odbiorca_sprzedazy.strip():
            wynik.dodaj("Sprzedaż równoległa: nie wybrano odbiorcy końcowego.", "odbiorca_sprzedazy")
        if rown.cena_sprzedazy <= 0:
            wynik.dodaj("Sprzedaż równoległa: cena musi być większa od zera.", "cena_sprzedazy")

    if rown.transport:
        if not rown.przewoznik.strip():
            wynik.dodaj("Transport równoległy: nie wybrano przewoźnika.", "przewoznik")
        if not rown.nr_rejestracyjny.strip():
            wynik.dodaj("Transport równoległy: brak numeru rejestracyjnego.", "nr_rejestracyjny")
        if rown.odleglosc <= 0 and rown.koszt_transportu <= 0:
            wynik.dodaj("Transport równoległy: podaj odległość albo koszt transportu.", "odleglosc")

    return wynik
