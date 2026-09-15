"""Okno główne aplikacji."""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QSize, Qt, QTimer
from PySide6.QtGui import QCloseEvent, QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from .. import APP_NAZWA, APP_WERSJA
from ..dane import sciezki
from ..dane.kartoteka import BladZapisu, Kartoteka
from ..dane.odczyt import BladOdczytu
from . import ikony
from .styl import Paleta, arkusz_stylow, paleta
from .widgety.powloka import PasekBoczny, PasekGorny, przycisk
from .widoki.pulpit import WidokPulpit

POZYCJE_MENU = [
    ("pulpit", "Pulpit", "pulpit"),
    ("nowa", "Nowa operacja", "plus"),
    ("kartoteka", "Kartoteka", "kartoteka"),
    ("magazyn", "Magazyn", "magazyn"),
    ("raporty", "Raporty", "raporty"),
    ("historia", "Dziennik zdarzeń", "historia"),
    ("ustawienia", "Ustawienia", "ustawienia"),
]

ODSTEP_ODSWIEZANIA_BLOKADY = 120_000  # 2 minuty


class OknoGlowne(QWidget):
    """Powłoka aplikacji: menu boczne, pasek górny i stos widoków."""

    def __init__(self, kartoteka: Kartoteka) -> None:
        super().__init__()
        self.kartoteka = kartoteka
        self.paleta: Paleta = paleta(kartoteka.ustawienia.motyw)

        self.setObjectName("Okno")
        self.setWindowTitle(f"{APP_NAZWA} {APP_WERSJA}")
        self.setWindowIcon(ikony.ikona_aplikacji(self.paleta.akcent))
        self.resize(1440, 900)
        self.setMinimumSize(1160, 720)

        self._zbuduj_uklad()
        self._zbuduj_widoki()
        self._zbuduj_skroty()
        self.zastosuj_motyw()

        self.timer_blokady = QTimer(self)
        self.timer_blokady.timeout.connect(self._odswiez_blokade)
        self.timer_blokady.start(ODSTEP_ODSWIEZANIA_BLOKADY)

        self.przejdz("pulpit")

    # ------------------------------------------------------------------
    #  Budowa interfejsu
    # ------------------------------------------------------------------

    def _zbuduj_uklad(self) -> None:
        uklad = QHBoxLayout(self)
        uklad.setContentsMargins(0, 0, 0, 0)
        uklad.setSpacing(0)

        self.pasek_boczny = PasekBoczny(self.paleta)
        for klucz, etykieta, ikona in POZYCJE_MENU:
            self.pasek_boczny.dodaj_pozycje(klucz, etykieta, ikona)
        self.pasek_boczny.wybrano.connect(self.przejdz)
        uklad.addWidget(self.pasek_boczny)

        prawa = QVBoxLayout()
        prawa.setContentsMargins(0, 0, 0, 0)
        prawa.setSpacing(0)

        self.pasek_gorny = PasekGorny()
        prawa.addWidget(self.pasek_gorny)

        self.stos = QStackedWidget()
        prawa.addWidget(self.stos, 1)

        self.pasek_stanu = self._zbuduj_pasek_stanu()
        prawa.addWidget(self.pasek_stanu)

        uklad.addLayout(prawa, 1)

    def _zbuduj_pasek_stanu(self) -> QWidget:
        pasek = QWidget()
        pasek.setFixedHeight(32)
        pasek.setStyleSheet(
            f"background: {self.paleta.powierzchnia}; "
            f"border-top: 1px solid {self.paleta.obramowanie};"
        )
        uklad = QHBoxLayout(pasek)
        uklad.setContentsMargins(20, 0, 20, 0)
        uklad.setSpacing(16)

        self.etykieta_pliku = QLabel("")
        self.etykieta_pliku.setStyleSheet(f"color: {self.paleta.tekst_slaby}; font-size: 11.5px;")
        self.etykieta_zapisu = QLabel("")
        self.etykieta_zapisu.setStyleSheet(f"color: {self.paleta.tekst_slaby}; font-size: 11.5px;")

        uklad.addWidget(self.etykieta_pliku, 1)
        uklad.addWidget(self.etykieta_zapisu)
        return pasek

    def _zbuduj_widoki(self) -> None:
        from .widoki.historia import WidokHistoria
        from .widoki.kartoteka import WidokKartoteka
        from .widoki.magazyn import WidokMagazyn
        from .widoki.nowa_operacja import WidokNowaOperacja
        from .widoki.raporty import WidokRaporty
        from .widoki.ustawienia import WidokUstawienia

        self.widoki: dict[str, object] = {
            "pulpit": WidokPulpit(self.kartoteka, self.paleta),
            "nowa": WidokNowaOperacja(self.kartoteka, self.paleta),
            "kartoteka": WidokKartoteka(self.kartoteka, self.paleta),
            "magazyn": WidokMagazyn(self.kartoteka, self.paleta),
            "raporty": WidokRaporty(self.kartoteka, self.paleta),
            "historia": WidokHistoria(self.kartoteka, self.paleta),
            "ustawienia": WidokUstawienia(self.kartoteka, self.paleta),
        }

        for widok in self.widoki.values():
            self.stos.addWidget(widok)

        self.widoki["nowa"].zapisano.connect(self._po_zapisie_operacji)
        self.widoki["kartoteka"].zmieniono.connect(self._po_zmianie_danych)
        self.widoki["ustawienia"].zmieniono_motyw.connect(self.zmien_motyw)
        self.widoki["ustawienia"].zmieniono.connect(self._po_zmianie_danych)
        self.widoki["kartoteka"].kopiuj_do_formularza.connect(self._kopiuj_do_formularza)

    def _zbuduj_skroty(self) -> None:
        QShortcut(QKeySequence("Ctrl+S"), self, self.zapisz)
        QShortcut(QKeySequence("Ctrl+N"), self, lambda: self.przejdz("nowa"))
        QShortcut(QKeySequence("Ctrl+M"), self, lambda: self.przejdz("magazyn"))
        QShortcut(QKeySequence("Ctrl+R"), self, lambda: self.przejdz("raporty"))
        QShortcut(QKeySequence("Ctrl+K"), self, lambda: self.przejdz("kartoteka"))
        QShortcut(QKeySequence("F5"), self, self.odswiez_biezacy)

    # ------------------------------------------------------------------
    #  Motyw
    # ------------------------------------------------------------------

    def zastosuj_motyw(self) -> None:
        self.setStyleSheet(arkusz_stylow(self.paleta))

    def zmien_motyw(self, nazwa: str) -> None:
        self.kartoteka.ustawienia.ustaw("MOTYW", nazwa)
        self.kartoteka.zmieniona = True
        QMessageBox.information(
            self,
            APP_NAZWA,
            "Motyw zostanie zastosowany po ponownym uruchomieniu programu.",
        )

    # ------------------------------------------------------------------
    #  Nawigacja
    # ------------------------------------------------------------------

    def przejdz(self, klucz: str) -> None:
        widok = self.widoki.get(klucz)
        if widok is None:
            return

        self.stos.setCurrentWidget(widok)
        self.pasek_boczny.zaznacz(klucz)
        self.pasek_gorny.ustaw(widok.tytul, widok.podtytul)

        self.pasek_gorny.wyczysc_akcje()
        for akcja in widok.akcje_paska():
            self.pasek_gorny.dodaj_akcje(akcja)

        guzik_zapisu = przycisk("Zapisz", "zapisz", "Glowny")
        guzik_zapisu.setToolTip("Zapisz zmiany do pliku Excela  (Ctrl+S)")
        guzik_zapisu.clicked.connect(self.zapisz)
        self.pasek_gorny.dodaj_akcje(guzik_zapisu)

        widok.odswiez()
        self.aktualizuj_pasek_stanu()

    def odswiez_biezacy(self) -> None:
        widok = self.stos.currentWidget()
        if widok is not None:
            widok.odswiez()
        self.aktualizuj_pasek_stanu()

    def _po_zapisie_operacji(self) -> None:
        self._po_zmianie_danych()
        self.przejdz("pulpit")

    def _po_zmianie_danych(self) -> None:
        # Widoki przeliczają się przy wejściu, więc odświeżamy tylko bieżący,
        # a zmiany od razu trafiają do pliku - kartoteka magazynowa nie powinna
        # zależeć od tego, czy ktoś pamiętał o zapisaniu.
        self.odswiez_biezacy()
        self.zapisz(cicho=True)

    def _kopiuj_do_formularza(self, operacja) -> None:
        self.przejdz("nowa")
        self.widoki["nowa"].wczytaj_z_operacji(operacja)

    # ------------------------------------------------------------------
    #  Plik danych
    # ------------------------------------------------------------------

    def zapisz(self, cicho: bool = False) -> bool:
        if self.kartoteka.sciezka is None:
            return self.zapisz_jako()

        try:
            self.kartoteka.zapisz()
        except BladZapisu as blad:
            QMessageBox.warning(self, f"{APP_NAZWA} - zapis", str(blad))
            return False

        self.aktualizuj_pasek_stanu()
        if not cicho:
            self.etykieta_zapisu.setText("Zapisano")
        return True

    def zapisz_jako(self) -> bool:
        sciezka, _ = QFileDialog.getSaveFileName(
            self,
            f"{APP_NAZWA} - zapisz plik danych",
            str(sciezki.domyslny_plik_danych()),
            "Skoroszyt Excela (*.xlsx)",
        )
        if not sciezka:
            return False

        try:
            self.kartoteka.zapisz_jako(Path(sciezka))
        except BladZapisu as blad:
            QMessageBox.warning(self, f"{APP_NAZWA} - zapis", str(blad))
            return False

        self.aktualizuj_pasek_stanu()
        return True

    def otworz(self) -> None:
        sciezka, _ = QFileDialog.getOpenFileName(
            self,
            f"{APP_NAZWA} - otwórz plik danych",
            str(sciezki.katalog_danych()),
            "Pliki Excela (*.xlsx *.xlsm)",
        )
        if not sciezka:
            return

        if not self._potwierdz_porzucenie_zmian():
            return

        try:
            self.kartoteka.otworz(Path(sciezka))
        except BladOdczytu as blad:
            QMessageBox.warning(self, f"{APP_NAZWA} - odczyt", str(blad))
            return

        for widok in self.widoki.values():
            if hasattr(widok, "przeladuj_slowniki"):
                widok.przeladuj_slowniki()
        self.odswiez_biezacy()
        self.aktualizuj_pasek_stanu()

    def _odswiez_blokade(self) -> None:
        if self.kartoteka.blokada is not None:
            self.kartoteka.blokada.odswiez()

    def aktualizuj_pasek_stanu(self) -> None:
        sciezka = self.kartoteka.sciezka
        if sciezka is None:
            self.etykieta_pliku.setText("Brak otwartego pliku danych")
        else:
            tryb = "  •  TYLKO ODCZYT" if self.kartoteka.tylko_odczyt else ""
            self.etykieta_pliku.setText(f"{sciezka}{tryb}")

        if self.kartoteka.tylko_odczyt:
            kto = self.kartoteka.kto_blokuje()
            self.etykieta_zapisu.setText(f"Plik edytuje: {kto}" if kto else "Tylko odczyt")
            self.etykieta_zapisu.setStyleSheet(
                f"color: {self.paleta.ostrzezenie}; font-size: 11.5px; font-weight: 600;"
            )
        elif self.kartoteka.zmieniona:
            self.etykieta_zapisu.setText("Niezapisane zmiany")
            self.etykieta_zapisu.setStyleSheet(
                f"color: {self.paleta.ostrzezenie}; font-size: 11.5px;"
            )
        else:
            self.etykieta_zapisu.setText("Zapisano")
            self.etykieta_zapisu.setStyleSheet(
                f"color: {self.paleta.tekst_slaby}; font-size: 11.5px;"
            )

        tryb_pliku = "przenośny" if sciezki.tryb_przenosny() else "zainstalowany"
        self.pasek_boczny.ustaw_stopke(
            f"{sciezki.uzytkownik()} · {sciezki.stanowisko()}\n"
            f"tryb {tryb_pliku} · wersja {APP_WERSJA}"
        )

    def _potwierdz_porzucenie_zmian(self) -> bool:
        if not self.kartoteka.zmieniona:
            return True

        odpowiedz = QMessageBox.question(
            self,
            APP_NAZWA,
            "Masz niezapisane zmiany. Zapisać je przed zamknięciem pliku?",
            QMessageBox.Save | QMessageBox.Discard | QMessageBox.Cancel,
            QMessageBox.Save,
        )
        if odpowiedz == QMessageBox.Cancel:
            return False
        if odpowiedz == QMessageBox.Save:
            return self.zapisz()
        return True

    def closeEvent(self, zdarzenie: QCloseEvent) -> None:
        if not self._potwierdz_porzucenie_zmian():
            zdarzenie.ignore()
            return
        self.kartoteka.zwolnij_blokade()
        zdarzenie.accept()
