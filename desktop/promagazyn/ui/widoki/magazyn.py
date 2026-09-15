"""Stan magazynowy w rozbiciu na lokalizacje i produkty."""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QFont
from PySide6.QtWidgets import (
    QComboBox,
    QGridLayout,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QTableWidget,
    QTableWidgetItem,
    QWidget,
)

from ...model import magazyn as model_magazyn
from ..widgety.podstawowe import Karta, NaglowekSekcji, Wskaznik
from .bazowy import Widok

NAGLOWKI = ["Lokalizacja", "Produkt", "Stan [MP]", "Stan [tony]", "Stan [GJ]",
            "Wartość przyjęć", "Ostatnia operacja"]


def _liczba(wartosc: float, miejsca: int = 2) -> str:
    return f"{wartosc:,.{miejsca}f}".replace(",", " ").replace(".", ",")


class WidokMagazyn(Widok):
    tytul = "Stan magazynowy"
    podtytul = "Ewidencja wg lokalizacji i produktu"

    def __init__(self, kartoteka, paleta, parent=None) -> None:
        super().__init__(kartoteka, paleta, parent)

        siatka = QGridLayout()
        siatka.setSpacing(14)
        self.w_mp = Wskaznik("Stan łączny", "MP", paleta.akcent)
        self.w_tony = Wskaznik("Stan łączny", "ton")
        self.w_gj = Wskaznik("Energia", "GJ")
        self.w_ujemne = Wskaznik("Pozycje ujemne", "")
        for numer, wskaznik in enumerate((self.w_mp, self.w_tony, self.w_gj, self.w_ujemne)):
            siatka.addWidget(wskaznik, 0, numer)
        self.uklad.addLayout(siatka)

        karta = Karta()
        pasek = QHBoxLayout()
        pasek.setSpacing(10)
        self.filtr_lokalizacji = QComboBox()
        self.filtr_lokalizacji.currentIndexChanged.connect(self._wypelnij_tabele)
        pasek.addWidget(QLabel("Lokalizacja"))
        pasek.addWidget(self.filtr_lokalizacji)
        pasek.addStretch(1)
        self.info = QLabel("")
        self.info.setObjectName("PodpowiedzPola")
        pasek.addWidget(self.info)
        karta.dodaj_uklad(pasek)

        self.tabela = QTableWidget(0, len(NAGLOWKI))
        self.tabela.setHorizontalHeaderLabels(NAGLOWKI)
        self.tabela.verticalHeader().setVisible(False)
        self.tabela.setShowGrid(False)
        self.tabela.setAlternatingRowColors(True)
        self.tabela.setEditTriggers(QTableWidget.NoEditTriggers)
        self.tabela.setSelectionBehavior(QTableWidget.SelectRows)
        self.tabela.verticalHeader().setDefaultSectionSize(34)
        self.tabela.horizontalHeader().setSectionResizeMode(QHeaderView.Interactive)
        self.tabela.horizontalHeader().setStretchLastSection(True)
        for numer, szerokosc in enumerate([215, 270, 118, 118, 110, 140, 130]):
            self.tabela.setColumnWidth(numer, szerokosc)
        self.tabela.setSortingEnabled(True)
        karta.dodaj(self.tabela, 1)

        self.uklad.addWidget(karta, 1)
        self._pozycje: list = []

    def odswiez(self) -> None:
        ustawienia = self.kartoteka.ustawienia
        self._pozycje = model_magazyn.policz_stany(self.kartoteka.operacje, ustawienia)
        podsumowanie = model_magazyn.podsumuj(self._pozycje, ustawienia)

        self.w_mp.ustaw(_liczba(podsumowanie.mp, 1))
        self.w_tony.ustaw(_liczba(podsumowanie.tony, 1))
        self.w_gj.ustaw(_liczba(podsumowanie.gj, 0))
        self.w_ujemne.ustaw(str(podsumowanie.ujemnych), f"{podsumowanie.pozycji} pozycji łącznie")
        self.w_ujemne.ustaw_kolor(
            self.paleta.blad if podsumowanie.ujemnych else self.paleta.tekst
        )

        lokalizacje = ["Wszystkie"] + sorted({p.lokalizacja for p in self._pozycje})
        biezaca = self.filtr_lokalizacji.currentText()
        self.filtr_lokalizacji.blockSignals(True)
        self.filtr_lokalizacji.clear()
        self.filtr_lokalizacji.addItems(lokalizacje)
        if biezaca in lokalizacje:
            self.filtr_lokalizacji.setCurrentText(biezaca)
        self.filtr_lokalizacji.blockSignals(False)

        self._wypelnij_tabele()

    def _wypelnij_tabele(self) -> None:
        wybrana = self.filtr_lokalizacji.currentText()
        pozycje = [
            p for p in self._pozycje
            if wybrana in ("", "Wszystkie") or p.lokalizacja == wybrana
        ]

        self.tabela.setSortingEnabled(False)
        self.tabela.setRowCount(len(pozycje))

        for wiersz, pozycja in enumerate(pozycje):
            wartosci = [
                pozycja.lokalizacja,
                pozycja.produkt,
                _liczba(pozycja.mp, 2),
                _liczba(pozycja.tony, 2),
                _liczba(pozycja.gj, 0),
                _liczba(pozycja.wartosc, 0) + " zł" if pozycja.wartosc else "—",
                pozycja.ostatnia_operacja.strftime("%d.%m.%Y") if pozycja.ostatnia_operacja else "—",
            ]
            for kolumna, wartosc in enumerate(wartosci):
                element = QTableWidgetItem(wartosc)
                if kolumna >= 2:
                    element.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
                if pozycja.ujemna:
                    element.setForeground(QColor(self.paleta.blad))
                    czcionka = QFont()
                    czcionka.setBold(True)
                    element.setFont(czcionka)
                self.tabela.setItem(wiersz, kolumna, element)

        self.tabela.setSortingEnabled(True)

        ujemne = sum(1 for p in pozycje if p.ujemna)
        if ujemne:
            self.info.setText(
                f"Pozycji ze stanem ujemnym: {ujemne} — sprawdź, czy przyjęcia "
                "wskazują właściwy magazyn."
            )
            self.info.setStyleSheet(f"color: {self.paleta.ostrzezenie}; font-weight: 600;")
        else:
            self.info.setText(f"Pozycji: {len(pozycje)}")
            self.info.setStyleSheet(f"color: {self.paleta.tekst_slaby};")
