"""Punkt wejścia aplikacji PRO-MAGAZYN."""

from __future__ import annotations

import sys
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication, QMessageBox

from . import APP_NAZWA, APP_WERSJA, APP_WYDAWCA
from .dane import sciezki
from .dane.kartoteka import BladZapisu, Kartoteka
from .dane.odczyt import BladOdczytu
from .ui import ikony
from .ui.okno import OknoGlowne
from .ui.styl import paleta


def ustal_plik_danych() -> Path:
    """Wybiera plik danych: ostatnio używany, a w razie potrzeby domyślny."""
    ostatni = sciezki.ostatni_plik_danych()
    if ostatni is not None:
        return ostatni
    return sciezki.domyslny_plik_danych()


def przygotuj_kartoteke(sciezka: Path) -> tuple[Kartoteka, str]:
    """Otwiera plik danych albo zakłada nowy. Zwraca kartotekę i komunikat."""
    kartoteka = Kartoteka()

    if sciezka.exists():
        try:
            kartoteka.otworz(sciezka)
            return kartoteka, ""
        except BladOdczytu as blad:
            return kartoteka, f"Nie udało się otworzyć pliku danych:\n{blad}"

    try:
        kartoteka.utworz_nowa(sciezka)
        return kartoteka, ""
    except BladZapisu as blad:
        return kartoteka, f"Nie udało się utworzyć pliku danych:\n{blad}"


def main(argv: list[str] | None = None) -> int:
    argv = list(argv if argv is not None else sys.argv)

    QApplication.setApplicationName(APP_NAZWA)
    QApplication.setApplicationVersion(APP_WERSJA)
    QApplication.setOrganizationName(APP_WYDAWCA)

    aplikacja = QApplication(argv)
    aplikacja.setWindowIcon(ikony.ikona_aplikacji(paleta("ciemny").akcent))

    # Ścieżka podana w wierszu poleceń ma pierwszeństwo - pozwala otworzyć
    # plik z dysku firmowego skrótem albo podwójnym kliknięciem.
    wskazana = Path(argv[1]) if len(argv) > 1 and not argv[1].startswith("-") else None
    sciezka = wskazana or ustal_plik_danych()

    kartoteka, ostrzezenie = przygotuj_kartoteke(sciezka)

    okno = OknoGlowne(kartoteka)
    okno.show()

    if ostrzezenie:
        QMessageBox.warning(okno, APP_NAZWA, ostrzezenie)
    elif kartoteka.tylko_odczyt:
        QMessageBox.information(
            okno,
            f"{APP_NAZWA} - tryb tylko do odczytu",
            "Plik danych jest w tej chwili edytowany przez inną osobę:\n\n"
            f"{kartoteka.kto_blokuje()}\n\n"
            "Możesz przeglądać dane i raporty, ale zapis jest zablokowany, "
            "żeby zmiany się nie nadpisały.",
        )

    okno.aktualizuj_pasek_stanu()
    return aplikacja.exec()


if __name__ == "__main__":
    raise SystemExit(main())
