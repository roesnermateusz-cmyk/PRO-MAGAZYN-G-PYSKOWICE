"""Kartoteka - warstwa łącząca model domenowy z plikiem Excela.

Interfejs graficzny rozmawia wyłącznie z tą klasą: ona trzyma dane
w pamięci, pilnuje blokady pliku, wykonuje kopie zapasowe i zapisuje
zmiany atomowo.
"""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from ..model.audyt import Dziennik
from ..model.operacja import Operacja, OperacjeRownolegle, Status, TypOperacji
from ..model.silnik import (
    nowy_id_operacji,
    przygotuj,
    zbuduj_lancuch,
    zbuduj_produkcje_samodzielna,
    zbuduj_storno,
)
from ..model.slowniki import Podpowiedzi, Slowniki
from ..model.ustawienia import Ustawienia
from ..model.walidacja import WynikWalidacji, sprawdz, sprawdz_rownolegle
from . import kopie, odczyt, zapis
from .blokada import Blokada
from .sciezki import uzytkownik, zapamietaj_plik_danych


class BladZapisu(Exception):
    """Nie udało się zapisać pliku danych."""


@dataclass
class WynikZapisuOperacji:
    zapisane: list[Operacja] = field(default_factory=list)
    walidacja: WynikWalidacji | None = None
    duplikat: Operacja | None = None

    @property
    def udane(self) -> bool:
        return bool(self.zapisane)


class Kartoteka:
    """Repozytorium operacji magazynowych oparte na pliku Excela."""

    def __init__(self) -> None:
        self.sciezka: Path | None = None
        self.operacje: list[Operacja] = []
        self.slowniki = Slowniki()
        self.ustawienia = Ustawienia()
        self.dziennik = Dziennik()
        self.blokada: Blokada | None = None
        self.zmieniona = False
        self.tylko_odczyt = False

    # ------------------------------------------------------------------
    #  Otwieranie i zapis
    # ------------------------------------------------------------------

    def otworz(self, sciezka: Path) -> None:
        """Wczytuje plik danych i próbuje zająć blokadę edycji."""
        operacje, slowniki, ustawienia, zdarzenia = odczyt.wczytaj(sciezka)

        self.zwolnij_blokade()
        self.sciezka = sciezka
        self.operacje = operacje
        self.slowniki = slowniki
        self.ustawienia = ustawienia
        self.dziennik = Dziennik(zdarzenia)
        self.zmieniona = False

        self.blokada = Blokada(sciezka)
        self.tylko_odczyt = not self.blokada.zajmij()

        zapamietaj_plik_danych(sciezka)
        self.dziennik.zapisz(
            "OTWARCIE",
            uzytkownik(),
            f"Otwarto {sciezka.name}"
            + (" w trybie tylko do odczytu" if self.tylko_odczyt else ""),
        )

    def utworz_nowa(self, sciezka: Path) -> None:
        """Zakłada pusty plik danych."""
        self.zwolnij_blokade()
        self.sciezka = sciezka
        self.operacje = []
        self.slowniki = Slowniki()
        self.ustawienia = Ustawienia()
        self.dziennik = Dziennik()
        self.dziennik.zapisz("UTWORZENIE", uzytkownik(), f"Utworzono plik {sciezka.name}")
        self.blokada = Blokada(sciezka)
        self.tylko_odczyt = False
        self.zapisz(wymus=True)
        self.blokada.zajmij()
        zapamietaj_plik_danych(sciezka)

    def kto_blokuje(self) -> str:
        if self.blokada is None:
            return ""
        info = self.blokada.informacje()
        return info.opis() if info else ""

    def zwolnij_blokade(self) -> None:
        if self.blokada is not None:
            self.blokada.zwolnij()
            self.blokada = None

    def zapisz(self, wymus: bool = False) -> Path:
        """Zapisuje dane do pliku Excela. Zapis jest atomowy."""
        if self.sciezka is None:
            raise BladZapisu("Nie wskazano pliku danych.")
        if self.tylko_odczyt and not wymus:
            raise BladZapisu(
                "Plik jest otwarty w trybie tylko do odczytu - edytuje go "
                f"{self.kto_blokuje() or 'inny użytkownik'}."
            )

        self._kopia_automatyczna()

        skoroszyt = zapis.zbuduj_skoroszyt(
            self.operacje, self.slowniki, self.ustawienia, self.dziennik.zdarzenia
        )

        # Zapis przez plik tymczasowy w tym samym folderze: albo powstanie
        # kompletny plik, albo stary zostanie nienaruszony.
        folder = self.sciezka.parent
        folder.mkdir(parents=True, exist_ok=True)
        uchwyt, tymczasowy = tempfile.mkstemp(
            prefix=".promagazyn-", suffix=".xlsx", dir=str(folder)
        )
        os.close(uchwyt)
        tymczasowy_path = Path(tymczasowy)

        try:
            skoroszyt.save(tymczasowy_path)
            os.replace(tymczasowy_path, self.sciezka)
        except Exception as blad:  # noqa: BLE001
            tymczasowy_path.unlink(missing_ok=True)
            raise BladZapisu(f"Nie udało się zapisać pliku: {blad}") from blad

        self.zmieniona = False
        if self.blokada is not None:
            self.blokada.odswiez()
        return self.sciezka

    def zapisz_jako(self, sciezka: Path) -> Path:
        self.zwolnij_blokade()
        self.sciezka = sciezka
        self.tylko_odczyt = False
        self.blokada = Blokada(sciezka)
        wynik = self.zapisz(wymus=True)
        self.blokada.zajmij()
        zapamietaj_plik_danych(sciezka)
        return wynik

    def _kopia_automatyczna(self) -> None:
        if self.sciezka is None or not self.sciezka.exists():
            return
        if not self.ustawienia.tak("KOPIA_AUTOMATYCZNA", True):
            return
        if not kopie.kopia_potrzebna(self.ustawienia.tekst("OSTATNIA_KOPIA")):
            return

        utworzona = kopie.utworz_kopie(
            self.sciezka,
            self.ustawienia.tekst("FOLDER_KOPII"),
            int(self.ustawienia.liczba("KOPIE_DO_ZACHOWANIA", 30)),
        )
        if utworzona is not None:
            self.ustawienia.ustaw("OSTATNIA_KOPIA", date.today().isoformat())
            self.dziennik.zapisz(
                "KOPIA ZAPASOWA", uzytkownik(), f"Utworzono kopię {utworzona.name}"
            )

    def kopia_reczna(self) -> Path | None:
        if self.sciezka is None:
            return None
        utworzona = kopie.utworz_kopie(
            self.sciezka,
            self.ustawienia.tekst("FOLDER_KOPII"),
            int(self.ustawienia.liczba("KOPIE_DO_ZACHOWANIA", 30)),
        )
        if utworzona is not None:
            self.dziennik.zapisz(
                "KOPIA ZAPASOWA", uzytkownik(), f"Kopia na żądanie: {utworzona.name}"
            )
        return utworzona

    # ------------------------------------------------------------------
    #  Operacje
    # ------------------------------------------------------------------

    @property
    def podpowiedzi(self) -> Podpowiedzi:
        return Podpowiedzi(self.operacje)

    def znajdz_duplikat(self, op: Operacja) -> Operacja | None:
        """Szuka operacji o tym samym numerze WZ, typie, produkcie i dacie."""
        if not op.nr_wz.strip():
            return None
        for istniejaca in self.operacje:
            if istniejaca.status is Status.SKORYGOWANY:
                continue
            if (
                istniejaca.nr_wz.strip().upper() == op.nr_wz.strip().upper()
                and istniejaca.typ is op.typ
                and istniejaca.produkt.strip().upper() == op.produkt.strip().upper()
                and istniejaca.data_operacji == op.data_operacji
            ):
                return istniejaca
        return None

    def dodaj(
        self,
        op: Operacja,
        rown: OperacjeRownolegle | None = None,
        surowiec: str = "",
        volumen_surowca: float = 0.0,
        pomin_duplikat: bool = False,
    ) -> WynikZapisuOperacji:
        """Waliduje i dopisuje operację wraz z operacjami równoległymi."""
        rown = rown or OperacjeRownolegle()
        wynik = WynikZapisuOperacji()

        walidacja = sprawdz(op, self.ustawienia)
        if op.typ is TypOperacji.ZAKUP:
            dodatkowe = sprawdz_rownolegle(rown)
            walidacja.bledy.extend(dodatkowe.bledy)
            walidacja.pola.update(dodatkowe.pola)

        if not walidacja.poprawne:
            wynik.walidacja = walidacja
            return wynik

        if not pomin_duplikat and self.ustawienia.ostrzegaj_o_dublach:
            duplikat = self.znajdz_duplikat(op)
            if duplikat is not None:
                wynik.duplikat = duplikat
                return wynik

        if op.typ is TypOperacji.PRODUKCJA:
            nowe = zbuduj_produkcje_samodzielna(op, surowiec, volumen_surowca, self.ustawienia)
        elif op.typ is TypOperacji.ZAKUP:
            nowe = zbuduj_lancuch(op, rown, self.ustawienia)
        else:
            nowe = [przygotuj(op, self.ustawienia)]

        self._dopisz(nowe)
        wynik.zapisane = nowe
        return wynik

    def _dopisz(self, nowe: list[Operacja]) -> None:
        for operacja in nowe:
            if not operacja.id_operacji:
                operacja.id_operacji = nowy_id_operacji()
            if operacja.data_dodania is None:
                from datetime import datetime

                operacja.data_dodania = datetime.now()
            self.operacje.append(operacja)
            self.slowniki.uzupelnij_z_operacji(operacja)
            self.dziennik.zapisz(
                "DODANIE",
                operacja.utworzyl or uzytkownik(),
                operacja.opis_skrocony(),
                operacja.typ.value,
                operacja.id_operacji,
            )
        self.slowniki.posortuj()
        self.zmieniona = True

    def koryguj(self, operacja: Operacja, powod: str) -> Operacja:
        """Storno: oznacza wiersz jako skorygowany i dopisuje wpis odwracający."""
        operacja.status = Status.SKORYGOWANY
        storno = zbuduj_storno(operacja, powod, uzytkownik())
        self._dopisz([storno])
        self.dziennik.zapisz(
            "KOREKTA",
            uzytkownik(),
            f"Storno wpisu {operacja.id_operacji}. Powód: {powod}",
            operacja.typ.value,
            operacja.id_operacji,
        )
        self.zmieniona = True
        return storno

    def cofnij_korekte(self, operacja: Operacja) -> None:
        operacja.status = Status.AKTYWNY
        self.dziennik.zapisz(
            "COFNIECIE KOREKTY",
            uzytkownik(),
            f"Przywrócono status AKTYWNY wpisowi {operacja.id_operacji}",
            operacja.typ.value,
            operacja.id_operacji,
        )
        self.zmieniona = True

    def zaimportuj(self, nowe: list[Operacja]) -> int:
        """Dopisuje operacje z importu. Zwraca liczbę dopisanych wierszy."""
        przygotowane = [przygotuj(operacja, self.ustawienia) for operacja in nowe]
        self._dopisz(przygotowane)
        self.dziennik.zapisz("IMPORT", uzytkownik(), f"Zaimportowano {len(przygotowane)} operacji")
        return len(przygotowane)
