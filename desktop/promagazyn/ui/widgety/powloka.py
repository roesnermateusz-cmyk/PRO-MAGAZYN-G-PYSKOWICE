"""Powłoka okna: panel boczny nawigacji i pasek górny widoku."""

from __future__ import annotations

from PySide6.QtCore import QSize, Qt, Signal
from PySide6.QtWidgets import (
    QButtonGroup,
    QFrame,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QSizePolicy,
    QToolButton,
    QVBoxLayout,
    QWidget,
)

from .. import ikony
from ..styl import Paleta


class PasekBoczny(QFrame):
    """Pionowe menu główne aplikacji."""

    wybrano = Signal(str)

    def __init__(self, paleta: Paleta, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("PasekBoczny")
        self.setFixedWidth(242)
        self._paleta = paleta
        self._przyciski: dict[str, QToolButton] = {}

        uklad = QVBoxLayout(self)
        uklad.setContentsMargins(14, 20, 14, 16)
        uklad.setSpacing(4)

        uklad.addLayout(self._zbuduj_marke())
        uklad.addSpacing(22)

        self.grupa = QButtonGroup(self)
        self.grupa.setExclusive(True)
        self._uklad_pozycji = QVBoxLayout()
        self._uklad_pozycji.setSpacing(3)
        uklad.addLayout(self._uklad_pozycji)

        uklad.addStretch(1)

        self.stopka = QLabel("")
        self.stopka.setObjectName("StopkaPaska")
        self.stopka.setWordWrap(True)
        uklad.addWidget(self.stopka)

    def _zbuduj_marke(self) -> QHBoxLayout:
        wiersz = QHBoxLayout()
        wiersz.setSpacing(11)
        wiersz.setContentsMargins(6, 0, 0, 0)

        znak = QLabel()
        znak.setPixmap(ikony.ikona_aplikacji(self._paleta.akcent, 36).pixmap(36, 36))
        znak.setFixedSize(36, 36)

        napisy = QVBoxLayout()
        napisy.setSpacing(0)
        marka = QLabel("PRO-MAGAZYN")
        marka.setObjectName("Marka")
        podmarka = QLabel("ewidencja magazynowa")
        podmarka.setObjectName("Podmarka")
        napisy.addWidget(marka)
        napisy.addWidget(podmarka)

        wiersz.addWidget(znak)
        wiersz.addLayout(napisy)
        wiersz.addStretch(1)
        return wiersz

    def dodaj_pozycje(self, klucz: str, etykieta: str, ikona: str) -> QToolButton:
        przycisk = QToolButton()
        przycisk.setObjectName("Nawigacja")
        przycisk.setText("  " + etykieta)
        przycisk.setCheckable(True)
        przycisk.setToolButtonStyle(Qt.ToolButtonTextBesideIcon)
        przycisk.setIcon(
            ikony_pozycji := ikony.ikona(ikona, "#B9C7D8", 19, "#FFFFFF")
        )
        przycisk.setIconSize(QSize(19, 19))
        przycisk.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        przycisk.setCursor(Qt.PointingHandCursor)
        przycisk.clicked.connect(lambda: self.wybrano.emit(klucz))

        self.grupa.addButton(przycisk)
        self._uklad_pozycji.addWidget(przycisk)
        self._przyciski[klucz] = przycisk
        return przycisk

    def dodaj_odstep(self, etykieta: str = "") -> None:
        self._uklad_pozycji.addSpacing(14)
        if etykieta:
            naglowek = QLabel(etykieta.upper())
            naglowek.setObjectName("StopkaPaska")
            naglowek.setContentsMargins(14, 0, 0, 4)
            self._uklad_pozycji.addWidget(naglowek)

    def zaznacz(self, klucz: str) -> None:
        przycisk = self._przyciski.get(klucz)
        if przycisk is not None:
            przycisk.setChecked(True)

    def ustaw_stopke(self, tekst: str) -> None:
        self.stopka.setText(tekst)


class PasekGorny(QFrame):
    """Nagłówek widoku: tytuł, podtytuł i miejsce na akcje."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("PasekGorny")
        self.setFixedHeight(76)

        uklad = QHBoxLayout(self)
        uklad.setContentsMargins(26, 12, 22, 12)
        uklad.setSpacing(14)

        napisy = QVBoxLayout()
        napisy.setSpacing(1)
        self.tytul = QLabel("")
        self.tytul.setObjectName("TytulWidoku")
        self.podtytul = QLabel("")
        self.podtytul.setObjectName("PodtytulWidoku")
        napisy.addWidget(self.tytul)
        napisy.addWidget(self.podtytul)

        uklad.addLayout(napisy)
        uklad.addStretch(1)

        self.akcje = QHBoxLayout()
        self.akcje.setSpacing(9)
        uklad.addLayout(self.akcje)

    def ustaw(self, tytul: str, podtytul: str = "") -> None:
        self.tytul.setText(tytul)
        self.podtytul.setText(podtytul)

    def wyczysc_akcje(self) -> None:
        while self.akcje.count():
            element = self.akcje.takeAt(0)
            widget = element.widget()
            if widget is not None:
                widget.setParent(None)

    def dodaj_akcje(self, widget: QWidget) -> None:
        self.akcje.addWidget(widget)


def przycisk(
    etykieta: str,
    ikona_nazwa: str = "",
    rodzaj: str = "",
    kolor_ikony: str = "#FFFFFF",
) -> QPushButton:
    """Przycisk z opcjonalną ikoną wektorową."""
    guzik = QPushButton(etykieta)
    if rodzaj:
        guzik.setObjectName(rodzaj)
    if ikona_nazwa:
        guzik.setIcon(ikony.ikona(ikona_nazwa, kolor_ikony, 17))
        guzik.setIconSize(QSize(17, 17))
    guzik.setCursor(Qt.PointingHandCursor)
    return guzik
