"""Raporty: szczegółowy, roczny i zestawienie transportu."""

from __future__ import annotations

from datetime import date

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QFont
from PySide6.QtWidgets import (
    QComboBox,
    QFileDialog,
    QGridLayout,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QMessageBox,
    QTabWidget,
    QTableWidget,
    QTableWidgetItem,
    QWidget,
)

from ...dane import csv_io
from ...model import raporty as model_raporty
from ...model.operacja import TypOperacji
from ..widgety.podstawowe import Karta, Wskaznik
from ..widgety.powloka import przycisk
from ..widgety.tabela import TabelaOperacji
from .bazowy import Widok

WSZYSTKIE = model_raporty.WSZYSTKIE


def _kwota(wartosc: float) -> str:
    return f"{wartosc:,.2f}".replace(",", " ").replace(".", ",") + " zł"


def _liczba(wartosc: float, miejsca: int = 1) -> str:
    return f"{wartosc:,.{miejsca}f}".replace(",", " ").replace(".", ",")


class WidokRaporty(Widok):
    tytul = "Raporty"
    podtytul = "Zestawienia miesięczne, roczne i transportowe"

    def __init__(self, kartoteka, paleta, parent=None) -> None:
        super().__init__(kartoteka, paleta, parent)

        self.uklad.addWidget(self._karta_filtrow())

        siatka = QGridLayout()
        siatka.setSpacing(14)
        self.w_operacji = Wskaznik("Operacji", "")
        self.w_wolumen = Wskaznik("Wolumen", "MP")
        self.w_zakup = Wskaznik("Zakup", "", paleta.niebieski)
        self.w_sprzedaz = Wskaznik("Sprzedaż", "", paleta.akcent)
        self.w_transport = Wskaznik("Transport", "", paleta.ostrzezenie)
        self.w_marza = Wskaznik("Marża", "")
        # Sześć kafelków w jednym rzędzie nie mieści się na laptopie -
        # układamy je w dwóch rzędach po trzy.
        for numer, wskaznik in enumerate(
            (self.w_operacji, self.w_wolumen, self.w_zakup, self.w_sprzedaz,
             self.w_transport, self.w_marza)
        ):
            siatka.addWidget(wskaznik, numer // 3, numer % 3)
        self.uklad.addLayout(siatka)

        self.zakladki = QTabWidget()
        self.tabela_szczegolowa = TabelaOperacji(paleta)
        self.zakladki.addTab(self._w_karcie(self.tabela_szczegolowa), "Szczegółowy")

        self.tabela_roczna = self._pusta_tabela(
            ["Miesiąc", "Operacji", "Wolumen [MP]", "Zakup", "Sprzedaż", "Transport", "Marża"]
        )
        self.zakladki.addTab(self._w_karcie(self.tabela_roczna), "Roczny")

        self.tabela_transportu = self._pusta_tabela(
            ["Przewoźnik", "Rodzaj", "Kursów", "Kilometry", "Koszt", "Średnia stawka"]
        )
        self.zakladki.addTab(self._w_karcie(self.tabela_transportu), "Transport")

        self.zakladki.currentChanged.connect(self.odswiez)
        self.uklad.addWidget(self.zakladki, 1)

    def _w_karcie(self, widget: QWidget) -> QWidget:
        karta = Karta()
        karta.dodaj(widget, 1)
        return karta

    def _pusta_tabela(self, naglowki: list[str]) -> QTableWidget:
        tabela = QTableWidget(0, len(naglowki))
        tabela.setHorizontalHeaderLabels(naglowki)
        tabela.verticalHeader().setVisible(False)
        tabela.setShowGrid(False)
        tabela.setAlternatingRowColors(True)
        tabela.setEditTriggers(QTableWidget.NoEditTriggers)
        tabela.setSelectionBehavior(QTableWidget.SelectRows)
        tabela.verticalHeader().setDefaultSectionSize(34)
        tabela.horizontalHeader().setStretchLastSection(True)
        return tabela

    def _karta_filtrow(self) -> Karta:
        karta = Karta("Filtry")
        siatka = QGridLayout()
        siatka.setHorizontalSpacing(12)
        siatka.setVerticalSpacing(10)

        self.f_rok = QComboBox()
        self.f_miesiac = QComboBox()
        self.f_miesiac.addItems([WSZYSTKIE] + model_raporty.MIESIACE)
        self.f_typ = QComboBox()
        self.f_typ.addItems([WSZYSTKIE] + [t.value for t in TypOperacji])
        self.f_produkt = QComboBox()
        self.f_kontrahent = QComboBox()
        self.f_tekst = QLineEdit()
        self.f_tekst.setPlaceholderText("Szukaj w opisie…")
        self.f_tekst.setClearButtonEnabled(True)

        for kontrolka in (self.f_rok, self.f_miesiac, self.f_typ, self.f_produkt, self.f_kontrahent):
            kontrolka.currentIndexChanged.connect(self.odswiez)
        self.f_tekst.textChanged.connect(self.odswiez)

        etykiety = ["Rok", "Miesiąc", "Typ operacji", "Produkt", "Kontrahent", "Szukaj"]
        kontrolki = [self.f_rok, self.f_miesiac, self.f_typ, self.f_produkt,
                     self.f_kontrahent, self.f_tekst]

        for numer, (etykieta, kontrolka) in enumerate(zip(etykiety, kontrolki)):
            napis = QLabel(etykieta)
            napis.setObjectName("EtykietaPola")
            siatka.addWidget(napis, 0, numer)
            siatka.addWidget(kontrolka, 1, numer)

        karta.dodaj_uklad(siatka)
        return karta

    def akcje_paska(self) -> list[QWidget]:
        guzik = przycisk("Eksportuj CSV", "eksport", "", self.paleta.tekst_przygaszony)
        guzik.clicked.connect(self._eksportuj)
        return [guzik]

    # ------------------------------------------------------------------

    def odswiez(self) -> None:
        self._odswiez_listy()
        ustawienia = self.kartoteka.ustawienia

        filtr = model_raporty.Filtr(
            rok=self.f_rok.currentText(),
            miesiac=self.f_miesiac.currentText(),
            typ=self.f_typ.currentText(),
            produkt=self.f_produkt.currentText(),
            kontrahent=self.f_kontrahent.currentText(),
            tekst=self.f_tekst.text(),
        )
        self._wybrane = [
            op for op in model_raporty.filtruj(self.kartoteka.operacje, filtr) if op.aktywna
        ]
        podsumowanie = model_raporty.podsumuj(self._wybrane, ustawienia)

        self.w_operacji.ustaw(str(podsumowanie.operacji))
        self.w_wolumen.ustaw(_liczba(podsumowanie.wolumen_mp))
        self.w_zakup.ustaw(_kwota(podsumowanie.zakup))
        self.w_sprzedaz.ustaw(_kwota(podsumowanie.sprzedaz))
        self.w_transport.ustaw(_kwota(podsumowanie.transport))
        self.w_marza.ustaw(_kwota(podsumowanie.marza))
        self.w_marza.ustaw_kolor(
            self.paleta.akcent if podsumowanie.marza >= 0 else self.paleta.blad
        )

        zakladka = self.zakladki.currentIndex()
        if zakladka == 0:
            self.tabela_szczegolowa.ustaw_dane(
                sorted(self._wybrane, key=lambda o: o.data_operacji or date.min, reverse=True)
            )
        elif zakladka == 1:
            self._wypelnij_roczny()
        else:
            self._wypelnij_transport()

    def _odswiez_listy(self) -> None:
        lata = sorted(
            {op.data_operacji.year for op in self.kartoteka.operacje if op.data_operacji},
            reverse=True,
        )
        self._ustaw_liste(self.f_rok, [WSZYSTKIE] + [str(rok) for rok in lata])
        self._ustaw_liste(self.f_produkt, [WSZYSTKIE] + self.kartoteka.slowniki.lista("PRODUKT"))

        kontrahenci = sorted(
            set(self.kartoteka.slowniki.lista("DOSTAWCA"))
            | set(self.kartoteka.slowniki.lista("ODBIORCA"))
        )
        self._ustaw_liste(self.f_kontrahent, [WSZYSTKIE] + kontrahenci)

    @staticmethod
    def _ustaw_liste(kontrolka: QComboBox, pozycje: list[str]) -> None:
        obecne = [kontrolka.itemText(i) for i in range(kontrolka.count())]
        if obecne == pozycje:
            return
        biezaca = kontrolka.currentText()
        kontrolka.blockSignals(True)
        kontrolka.clear()
        kontrolka.addItems(pozycje)
        if biezaca in pozycje:
            kontrolka.setCurrentText(biezaca)
        kontrolka.blockSignals(False)

    def _wypelnij_roczny(self) -> None:
        rok_tekst = self.f_rok.currentText()
        rok = int(rok_tekst) if rok_tekst.isdigit() else date.today().year
        wiersze = model_raporty.raport_roczny(
            self.kartoteka.operacje, rok, self.kartoteka.ustawienia
        )

        self.tabela_roczna.setRowCount(len(wiersze))
        for numer, wiersz in enumerate(wiersze):
            wartosci = [
                wiersz.miesiac.capitalize(),
                str(wiersz.operacji),
                _liczba(wiersz.wolumen_mp),
                _kwota(wiersz.zakup),
                _kwota(wiersz.sprzedaz),
                _kwota(wiersz.transport),
                _kwota(wiersz.marza),
            ]
            for kolumna, wartosc in enumerate(wartosci):
                element = QTableWidgetItem(wartosc)
                if kolumna >= 1:
                    element.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
                if kolumna == 6:
                    element.setForeground(
                        QColor(self.paleta.akcent if wiersz.marza >= 0 else self.paleta.blad)
                    )
                    czcionka = QFont()
                    czcionka.setBold(True)
                    element.setFont(czcionka)
                self.tabela_roczna.setItem(numer, kolumna, element)

    def _wypelnij_transport(self) -> None:
        wiersze = model_raporty.raport_transportu(self._wybrane)
        self.tabela_transportu.setRowCount(len(wiersze))

        for numer, wiersz in enumerate(wiersze):
            wartosci = [
                wiersz.przewoznik,
                wiersz.rodzaj,
                str(wiersz.kursow),
                _liczba(wiersz.kilometry, 0) + " km",
                _kwota(wiersz.koszt),
                _kwota(wiersz.srednia_stawka) + "/km" if wiersz.kilometry else "—",
            ]
            for kolumna, wartosc in enumerate(wartosci):
                element = QTableWidgetItem(wartosc)
                if kolumna >= 2:
                    element.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
                if kolumna == 1:
                    element.setForeground(
                        QColor(self.paleta.akcent if wiersz.rodzaj == "Własny" else self.paleta.niebieski)
                    )
                self.tabela_transportu.setItem(numer, kolumna, element)

    def _eksportuj(self) -> None:
        if not getattr(self, "_wybrane", None):
            QMessageBox.information(self, "Eksport", "Brak operacji spełniających filtry.")
            return

        sciezka, _ = QFileDialog.getSaveFileName(
            self, "Eksport raportu", "raport.csv", "Plik CSV (*.csv)"
        )
        if not sciezka:
            return

        from pathlib import Path

        ile = csv_io.zapisz(Path(sciezka), self._wybrane)
        QMessageBox.information(
            self, "Eksport zakończony", f"Zapisano {ile} operacji do pliku:\n{sciezka}"
        )
