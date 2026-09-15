"""Komponenty wielokrotnego użytku: karty, wskaźniki, pola formularza."""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QFont
from PySide6.QtWidgets import (
    QComboBox,
    QCompleter,
    QDateEdit,
    QDoubleSpinBox,
    QFrame,
    QGraphicsDropShadowEffect,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)
from PySide6.QtGui import QColor

from ..styl import Paleta


class Karta(QFrame):
    """Panel z obramowaniem i delikatnym cieniem."""

    def __init__(self, tytul: str = "", parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("Karta")

        self.uklad = QVBoxLayout(self)
        self.uklad.setContentsMargins(18, 16, 18, 18)
        self.uklad.setSpacing(12)

        self.naglowek = QHBoxLayout()
        self.naglowek.setSpacing(10)
        if tytul:
            etykieta = QLabel(tytul)
            etykieta.setObjectName("TytulKarty")
            self.naglowek.addWidget(etykieta)
            self.naglowek.addStretch(1)
            self.uklad.addLayout(self.naglowek)

    def dodaj(self, widget: QWidget, rozciagliwy: int = 0) -> None:
        self.uklad.addWidget(widget, rozciagliwy)

    def dodaj_uklad(self, uklad) -> None:
        self.uklad.addLayout(uklad)


class Wskaznik(QFrame):
    """Kafelek z jedną liczbą - używany na pulpicie i w nagłówkach widoków."""

    def __init__(
        self,
        etykieta: str,
        jednostka: str = "",
        kolor: str | None = None,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.setObjectName("KartaWskaznika")
        self.setMinimumHeight(96)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)

        uklad = QVBoxLayout(self)
        uklad.setContentsMargins(18, 14, 18, 14)
        uklad.setSpacing(3)

        self._etykieta = QLabel(etykieta.upper())
        self._etykieta.setObjectName("EtykietaWskaznika")

        wiersz = QHBoxLayout()
        wiersz.setSpacing(6)
        self._wartosc = QLabel("—")
        self._wartosc.setObjectName("WartoscWskaznika")
        if kolor:
            self._wartosc.setStyleSheet(f"color: {kolor};")
        self._jednostka = QLabel(jednostka)
        self._jednostka.setObjectName("JednostkaWskaznika")
        wiersz.addWidget(self._wartosc)
        wiersz.addWidget(self._jednostka, 0, Qt.AlignBottom)
        wiersz.addStretch(1)

        self._opis = QLabel("")
        self._opis.setObjectName("PodpowiedzPola")

        uklad.addWidget(self._etykieta)
        uklad.addLayout(wiersz)
        uklad.addWidget(self._opis)

    def ustaw(self, wartosc: str, opis: str = "") -> None:
        self._wartosc.setText(wartosc)
        self._opis.setText(opis)

    def ustaw_kolor(self, kolor: str) -> None:
        self._wartosc.setStyleSheet(f"color: {kolor};")


class Znacznik(QLabel):
    """Kolorowa etykieta statusu (np. typ operacji)."""

    def __init__(self, tekst: str = "", kolor: str = "#4C8DF6", parent: QWidget | None = None) -> None:
        super().__init__(tekst, parent)
        self.setObjectName("Znacznik")
        self.ustaw_kolor(kolor)
        self.setAlignment(Qt.AlignCenter)

    def ustaw_kolor(self, kolor: str) -> None:
        self.setStyleSheet(
            f"background: {kolor}22; color: {kolor}; border: 1px solid {kolor}55;"
        )


class Separator(QFrame):
    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("Separator")
        self.setFixedHeight(1)


class NaglowekSekcji(QLabel):
    def __init__(self, tekst: str, parent: QWidget | None = None) -> None:
        super().__init__(tekst.upper(), parent)
        self.setObjectName("NaglowekSekcji")


class Pole(QWidget):
    """Etykieta, kontrolka i podpowiedź w jednym bloku.

    Klasa zna stan błędu: ``oznacz_blad(True)`` podświetla kontrolkę
    i pokazuje komunikat pod nią.
    """

    zmieniono = Signal()

    def __init__(
        self,
        etykieta: str,
        kontrolka: QWidget,
        podpowiedz: str = "",
        wymagane: bool = False,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.kontrolka = kontrolka
        self.wymagane = wymagane

        uklad = QVBoxLayout(self)
        uklad.setContentsMargins(0, 0, 0, 0)
        uklad.setSpacing(4)

        self._etykieta = QLabel(etykieta + (" *" if wymagane else ""))
        self._etykieta.setObjectName(
            "EtykietaPolaWymagana" if wymagane else "EtykietaPola"
        )

        self._podpowiedz = QLabel(podpowiedz)
        self._podpowiedz.setObjectName("PodpowiedzPola")
        self._podpowiedz.setWordWrap(True)
        self._domyslna_podpowiedz = podpowiedz
        self._podpowiedz.setVisible(bool(podpowiedz))

        uklad.addWidget(self._etykieta)
        uklad.addWidget(kontrolka)
        uklad.addWidget(self._podpowiedz)

        self._podepnij_sygnal()

    def _podepnij_sygnal(self) -> None:
        kontrolka = self.kontrolka
        if isinstance(kontrolka, QComboBox):
            kontrolka.currentTextChanged.connect(lambda *_: self.zmieniono.emit())
        elif isinstance(kontrolka, QLineEdit):
            kontrolka.textChanged.connect(lambda *_: self.zmieniono.emit())
        elif isinstance(kontrolka, QDoubleSpinBox):
            kontrolka.valueChanged.connect(lambda *_: self.zmieniono.emit())
        elif isinstance(kontrolka, QDateEdit):
            kontrolka.dateChanged.connect(lambda *_: self.zmieniono.emit())

    def oznacz_blad(self, czy_blad: bool, komunikat: str = "") -> None:
        self.kontrolka.setProperty("blad", "true" if czy_blad else "false")
        self.kontrolka.style().unpolish(self.kontrolka)
        self.kontrolka.style().polish(self.kontrolka)

        if czy_blad and komunikat:
            self._podpowiedz.setText(komunikat)
            self._podpowiedz.setVisible(True)
        else:
            self._podpowiedz.setText(self._domyslna_podpowiedz)
            self._podpowiedz.setVisible(bool(self._domyslna_podpowiedz))

    def ustaw_widocznosc(self, widoczne: bool) -> None:
        self.setVisible(widoczne)

    def ustaw_aktywne(self, aktywne: bool) -> None:
        self.kontrolka.setEnabled(aktywne)


def pole_tekstowe(placeholder: str = "") -> QLineEdit:
    kontrolka = QLineEdit()
    kontrolka.setPlaceholderText(placeholder)
    return kontrolka


def pole_listy(pozycje: list[str], edytowalne: bool = True) -> QComboBox:
    """Lista rozwijana z autouzupełnianiem podczas pisania."""
    kontrolka = QComboBox()
    kontrolka.setEditable(edytowalne)
    kontrolka.addItems(pozycje)
    kontrolka.setInsertPolicy(QComboBox.NoInsert)
    if edytowalne:
        kontrolka.setCurrentText("")
        uzupelnianie = kontrolka.completer()
        if uzupelnianie is not None:
            # Podpowiadamy pozycje zawierające wpisany fragment, nie tylko
            # zaczynające się od niego - szybciej trafia się w długie nazwy.
            uzupelnianie.setCaseSensitivity(Qt.CaseInsensitive)
            uzupelnianie.setFilterMode(Qt.MatchContains)
            uzupelnianie.setCompletionMode(QCompleter.PopupCompletion)
    return kontrolka


def pole_liczbowe(
    maksimum: float = 9_999_999.0, miejsca: int = 3, sufiks: str = ""
) -> QDoubleSpinBox:
    kontrolka = QDoubleSpinBox()
    kontrolka.setRange(-maksimum, maksimum)
    kontrolka.setDecimals(miejsca)
    kontrolka.setGroupSeparatorShown(True)
    kontrolka.setButtonSymbols(QDoubleSpinBox.NoButtons)
    kontrolka.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
    if sufiks:
        kontrolka.setSuffix(f" {sufiks}")
    return kontrolka


def pole_kwoty(sufiks: str = "zł") -> QDoubleSpinBox:
    return pole_liczbowe(99_999_999.0, 2, sufiks)


def pole_daty() -> QDateEdit:
    from PySide6.QtCore import QDate

    kontrolka = QDateEdit()
    kontrolka.setCalendarPopup(True)
    kontrolka.setDisplayFormat("dd.MM.yyyy")
    kontrolka.setDate(QDate.currentDate())
    return kontrolka


def dodaj_cien(widget: QWidget, paleta: Paleta) -> None:
    """Delikatny cień pod kartą - nadaje głębi bez ozdobników."""
    cien = QGraphicsDropShadowEffect(widget)
    cien.setBlurRadius(26)
    cien.setXOffset(0)
    cien.setYOffset(3)
    cien.setColor(QColor(0, 0, 0, 70 if paleta.nazwa == "ciemny" else 26))
    widget.setGraphicsEffect(cien)
