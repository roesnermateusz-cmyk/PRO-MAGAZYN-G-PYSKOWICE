"""Model i widok tabeli operacji."""

from __future__ import annotations

from datetime import date, datetime
from typing import Callable

from PySide6.QtCore import QAbstractTableModel, QModelIndex, QSortFilterProxyModel, Qt
from PySide6.QtGui import QColor, QFont
from PySide6.QtWidgets import QAbstractItemView, QHeaderView, QTableView, QWidget

from ...model.operacja import Operacja, Status, TypOperacji
from ..styl import Paleta

KOLORY_TYPOW = {
    TypOperacji.ZAKUP: "#4C8DF6",
    TypOperacji.SPRZEDAZ: "#17A67C",
    TypOperacji.PRODUKCJA: "#A97BE0",
    TypOperacji.ZUZYCIE: "#E0A33E",
    TypOperacji.MM: "#5FB8C9",
    TypOperacji.TRANSPORT: "#E8734A",
}


def kwota(wartosc: float) -> str:
    if not wartosc:
        return "—"
    return f"{wartosc:,.2f}".replace(",", " ").replace(".", ",") + " zł"


def ilosc(wartosc: float) -> str:
    if not wartosc:
        return "—"
    return f"{wartosc:,.3f}".replace(",", " ").replace(".", ",").rstrip("0").rstrip(",")


class Kolumna:
    """Definicja kolumny: nagłówek, sposób odczytu i wyrównanie."""

    def __init__(
        self,
        naglowek: str,
        odczyt: Callable[[Operacja], object],
        szerokosc: int = 120,
        wyrownanie: Qt.AlignmentFlag = Qt.AlignLeft | Qt.AlignVCenter,
        sortowanie: Callable[[Operacja], object] | None = None,
    ) -> None:
        self.naglowek = naglowek
        self.odczyt = odczyt
        self.szerokosc = szerokosc
        self.wyrownanie = wyrownanie
        self.sortowanie = sortowanie or odczyt


KOLUMNY_KARTOTEKI: list[Kolumna] = [
    Kolumna("Data", lambda o: o.data_operacji.strftime("%d.%m.%Y") if o.data_operacji else "—", 104,
            sortowanie=lambda o: o.data_operacji or date.min),
    Kolumna("Typ", lambda o: o.typ.value, 116),
    Kolumna("Produkt", lambda o: o.produkt or "—", 200),
    Kolumna("Wolumen", lambda o: ilosc(o.volumen), 92, Qt.AlignRight | Qt.AlignVCenter,
            sortowanie=lambda o: o.volumen),
    Kolumna("JM", lambda o: o.jednostka or "—", 56),
    Kolumna("Wartość", lambda o: kwota(o.wartosc), 118, Qt.AlignRight | Qt.AlignVCenter,
            sortowanie=lambda o: o.wartosc),
    Kolumna("Dostawca", lambda o: o.dostawca or "—", 160),
    Kolumna("Odbiorca", lambda o: o.odbiorca or "—", 150),
    Kolumna("Przewoźnik", lambda o: o.przewoznik or "—", 145),
    Kolumna("Transport", lambda o: kwota(o.koszt_transportu), 108, Qt.AlignRight | Qt.AlignVCenter,
            sortowanie=lambda o: o.koszt_transportu),
    Kolumna("Nr WZ", lambda o: o.nr_wz or "—", 92),
    Kolumna("Utworzył", lambda o: o.utworzyl or "—", 145),
    Kolumna("Status", lambda o: o.status.value, 118),
]


class ModelOperacji(QAbstractTableModel):
    """Model tabeli operacji magazynowych."""

    def __init__(
        self,
        paleta: Paleta,
        kolumny: list[Kolumna] | None = None,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.paleta = paleta
        self.kolumny = kolumny or KOLUMNY_KARTOTEKI
        self.operacje: list[Operacja] = []

    def ustaw_dane(self, operacje: list[Operacja]) -> None:
        self.beginResetModel()
        self.operacje = list(operacje)
        self.endResetModel()

    def operacja(self, wiersz: int) -> Operacja | None:
        if 0 <= wiersz < len(self.operacje):
            return self.operacje[wiersz]
        return None

    def rowCount(self, parent: QModelIndex = QModelIndex()) -> int:
        return 0 if parent.isValid() else len(self.operacje)

    def columnCount(self, parent: QModelIndex = QModelIndex()) -> int:
        return 0 if parent.isValid() else len(self.kolumny)

    def headerData(self, sekcja: int, orientacja: Qt.Orientation, rola: int = Qt.DisplayRole):
        if orientacja == Qt.Horizontal and rola == Qt.DisplayRole:
            return self.kolumny[sekcja].naglowek
        if orientacja == Qt.Vertical and rola == Qt.DisplayRole:
            return str(sekcja + 1)
        return None

    def data(self, indeks: QModelIndex, rola: int = Qt.DisplayRole):
        if not indeks.isValid():
            return None

        operacja = self.operacje[indeks.row()]
        kolumna = self.kolumny[indeks.column()]

        if rola == Qt.DisplayRole:
            return str(kolumna.odczyt(operacja))

        if rola == Qt.TextAlignmentRole:
            return int(kolumna.wyrownanie)

        if rola == Qt.ForegroundRole:
            if operacja.status is Status.SKORYGOWANY:
                return QColor(self.paleta.tekst_slaby)
            if kolumna.naglowek == "Typ":
                return QColor(KOLORY_TYPOW.get(operacja.typ, self.paleta.tekst))
            if kolumna.naglowek == "Status":
                if operacja.status is Status.KOREKTA:
                    return QColor(self.paleta.ostrzezenie)
                return QColor(self.paleta.tekst_przygaszony)
            if kolumna.naglowek in ("Wartość", "Transport") and kolumna.odczyt(operacja) != "—":
                return QColor(self.paleta.tekst)
            return None

        if rola == Qt.FontRole:
            czcionka = QFont()
            if operacja.status is Status.SKORYGOWANY:
                czcionka.setStrikeOut(True)
            if kolumna.naglowek in ("Typ", "Wartość"):
                czcionka.setBold(True)
            return czcionka

        if rola == Qt.ToolTipRole:
            return operacja.opis_skrocony()

        if rola == Qt.UserRole:  # klucz sortowania
            return kolumna.sortowanie(operacja)

        return None

    def sort(self, kolumna: int, kolejnosc: Qt.SortOrder = Qt.AscendingOrder) -> None:
        klucz = self.kolumny[kolumna].sortowanie
        self.layoutAboutToBeChanged.emit()
        try:
            self.operacje.sort(
                key=lambda operacja: _klucz_sortowania(klucz(operacja)),
                reverse=kolejnosc == Qt.DescendingOrder,
            )
        finally:
            self.layoutChanged.emit()


def _klucz_sortowania(wartosc):
    """Sprowadza wartości do postaci porównywalnej między sobą."""
    if wartosc is None:
        return (0, "")
    if isinstance(wartosc, (int, float)):
        return (1, float(wartosc))
    if isinstance(wartosc, datetime):
        return (2, wartosc.timestamp())
    if isinstance(wartosc, date):
        return (2, datetime.combine(wartosc, datetime.min.time()).timestamp())
    return (3, str(wartosc).upper())


class TabelaOperacji(QTableView):
    """Tabela z gotową konfiguracją wyglądu i zachowania."""

    def __init__(
        self,
        paleta: Paleta,
        kolumny: list[Kolumna] | None = None,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.model_operacji = ModelOperacji(paleta, kolumny, self)
        self.setModel(self.model_operacji)

        self.setAlternatingRowColors(True)
        self.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.setSelectionMode(QAbstractItemView.SingleSelection)
        self.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.setSortingEnabled(True)
        self.setWordWrap(False)
        self.setShowGrid(False)
        self.verticalHeader().setVisible(False)
        self.verticalHeader().setDefaultSectionSize(34)
        self.horizontalHeader().setHighlightSections(False)
        self.horizontalHeader().setSectionResizeMode(QHeaderView.Interactive)
        self.horizontalHeader().setStretchLastSection(True)

        for numer, kolumna in enumerate(self.model_operacji.kolumny):
            self.setColumnWidth(numer, kolumna.szerokosc)

    def ustaw_dane(self, operacje: list[Operacja]) -> None:
        self.model_operacji.ustaw_dane(operacje)

    def zaznaczona(self) -> Operacja | None:
        indeksy = self.selectionModel().selectedRows()
        if not indeksy:
            return None
        return self.model_operacji.operacja(indeksy[0].row())
