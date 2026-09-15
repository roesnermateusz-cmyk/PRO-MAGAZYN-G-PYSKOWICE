"""Dziennik zdarzeń - ścieżka audytu."""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QFileDialog,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QMessageBox,
    QTableWidget,
    QTableWidgetItem,
    QWidget,
)

from ..widgety.podstawowe import Karta
from ..widgety.powloka import przycisk
from .bazowy import Widok

NAGLOWKI = ["Data i godzina", "Użytkownik", "Zdarzenie", "Typ", "ID operacji", "Opis"]

KOLORY = {
    "DODANIE": "#17A67C",
    "KOREKTA": "#E0A33E",
    "IMPORT": "#4C8DF6",
    "KOPIA ZAPASOWA": "#5FB8C9",
    "OTWARCIE": "#8A9AAE",
    "UTWORZENIE": "#8A9AAE",
}


class WidokHistoria(Widok):
    tytul = "Dziennik zdarzeń"
    podtytul = "Kto, kiedy i co zmienił w kartotece"

    def __init__(self, kartoteka, paleta, parent=None) -> None:
        super().__init__(kartoteka, paleta, parent)

        karta = Karta()

        pasek = QHBoxLayout()
        pasek.setSpacing(10)
        self.szukaj = QLineEdit()
        self.szukaj.setPlaceholderText("Szukaj w dzienniku…")
        self.szukaj.setClearButtonEnabled(True)
        self.szukaj.textChanged.connect(self.odswiez)
        self.podsumowanie = QLabel("")
        self.podsumowanie.setObjectName("PodpowiedzPola")
        pasek.addWidget(self.szukaj, 1)
        pasek.addWidget(self.podsumowanie)
        karta.dodaj_uklad(pasek)

        self.tabela = QTableWidget(0, len(NAGLOWKI))
        self.tabela.setHorizontalHeaderLabels(NAGLOWKI)
        self.tabela.verticalHeader().setVisible(False)
        self.tabela.setShowGrid(False)
        self.tabela.setAlternatingRowColors(True)
        self.tabela.setEditTriggers(QTableWidget.NoEditTriggers)
        self.tabela.setSelectionBehavior(QTableWidget.SelectRows)
        self.tabela.verticalHeader().setDefaultSectionSize(32)
        self.tabela.horizontalHeader().setStretchLastSection(True)
        for numer, szerokosc in enumerate([150, 150, 150, 110, 190]):
            self.tabela.setColumnWidth(numer, szerokosc)
        karta.dodaj(self.tabela, 1)

        self.uklad.addWidget(karta, 1)

    def akcje_paska(self) -> list[QWidget]:
        guzik = przycisk("Eksportuj CSV", "eksport", "", self.paleta.tekst_przygaszony)
        guzik.clicked.connect(self._eksportuj)
        return [guzik]

    def odswiez(self) -> None:
        fraza = self.szukaj.text().strip().lower()
        zdarzenia = list(reversed(self.kartoteka.dziennik.zdarzenia))

        if fraza:
            zdarzenia = [
                z for z in zdarzenia
                if fraza in " ".join(
                    [z.uzytkownik, z.zdarzenie, z.typ_operacji, z.id_operacji, z.opis]
                ).lower()
            ]

        self.tabela.setRowCount(len(zdarzenia))
        for wiersz, wpis in enumerate(zdarzenia):
            wartosci = [
                wpis.data.strftime("%d.%m.%Y %H:%M:%S"),
                wpis.uzytkownik,
                wpis.zdarzenie,
                wpis.typ_operacji or "—",
                wpis.id_operacji or "—",
                wpis.opis,
            ]
            for kolumna, wartosc in enumerate(wartosci):
                element = QTableWidgetItem(wartosc)
                if kolumna == 2:
                    element.setForeground(QColor(KOLORY.get(wpis.zdarzenie, self.paleta.tekst)))
                self.tabela.setItem(wiersz, kolumna, element)

        self.podsumowanie.setText(
            f"Zdarzeń: {len(zdarzenia)} z {len(self.kartoteka.dziennik)}"
        )

    def _eksportuj(self) -> None:
        if not len(self.kartoteka.dziennik):
            QMessageBox.information(self, "Eksport", "Dziennik zdarzeń jest pusty.")
            return

        sciezka, _ = QFileDialog.getSaveFileName(
            self, "Eksport dziennika", "dziennik.csv", "Plik CSV (*.csv)"
        )
        if not sciezka:
            return

        import csv

        with Path(sciezka).open("w", encoding="utf-8", newline="") as plik:
            zapis = csv.writer(plik, delimiter=";")
            zapis.writerow(NAGLOWKI)
            for wpis in self.kartoteka.dziennik.zdarzenia:
                zapis.writerow([
                    wpis.data.strftime("%Y-%m-%d %H:%M:%S"), wpis.uzytkownik,
                    wpis.zdarzenie, wpis.typ_operacji, wpis.id_operacji, wpis.opis,
                ])

        QMessageBox.information(self, "Eksport zakończony", f"Zapisano dziennik do:\n{sciezka}")
