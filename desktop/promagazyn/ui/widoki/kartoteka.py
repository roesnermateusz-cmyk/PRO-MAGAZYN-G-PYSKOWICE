"""Kartoteka - przeglądanie, filtrowanie i korekta operacji."""

from __future__ import annotations

from datetime import date

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QComboBox,
    QHBoxLayout,
    QInputDialog,
    QLabel,
    QLineEdit,
    QMessageBox,
    QWidget,
)

from ...model import raporty as model_raporty
from ...model.operacja import Operacja, Status, TypOperacji
from ..widgety.podstawowe import Karta
from ..widgety.powloka import przycisk
from ..widgety.tabela import TabelaOperacji
from .bazowy import Widok


class WidokKartoteka(Widok):
    tytul = "Kartoteka operacji"
    podtytul = "Pełna ewidencja z możliwością korekty"

    zmieniono = Signal()
    kopiuj_do_formularza = Signal(object)

    def __init__(self, kartoteka, paleta, parent=None) -> None:
        super().__init__(kartoteka, paleta, parent)

        karta = Karta()
        karta.dodaj_uklad(self._pasek_filtrow())

        self.tabela = TabelaOperacji(paleta)
        self.tabela.doubleClicked.connect(lambda *_: self._menu_wiersza())
        self.tabela.selectionModel().selectionChanged.connect(self._aktualizuj_przyciski)
        karta.dodaj(self.tabela, 1)

        self.podsumowanie = QLabel("")
        self.podsumowanie.setObjectName("PodpowiedzPola")
        karta.dodaj(self.podsumowanie)

        self.uklad.addWidget(karta, 1)

    def _pasek_filtrow(self) -> QHBoxLayout:
        pasek = QHBoxLayout()
        pasek.setSpacing(10)

        self.szukaj = QLineEdit()
        self.szukaj.setPlaceholderText("Szukaj: produkt, kontrahent, nr WZ, pojazd, osoba…")
        self.szukaj.setClearButtonEnabled(True)
        self.szukaj.textChanged.connect(self.odswiez)
        self.szukaj.setMinimumWidth(320)

        self.filtr_typu = QComboBox()
        self.filtr_typu.addItem("Wszystkie typy")
        self.filtr_typu.addItems([t.value for t in TypOperacji])
        self.filtr_typu.currentIndexChanged.connect(self.odswiez)

        self.filtr_roku = QComboBox()
        self.filtr_roku.currentIndexChanged.connect(self.odswiez)

        self.filtr_statusu = QComboBox()
        self.filtr_statusu.addItems(["Bez skorygowanych", "Wszystkie", "Tylko skorygowane"])
        self.filtr_statusu.currentIndexChanged.connect(self.odswiez)

        pasek.addWidget(self.szukaj, 1)
        pasek.addWidget(self.filtr_typu)
        pasek.addWidget(self.filtr_roku)
        pasek.addWidget(self.filtr_statusu)
        return pasek

    def akcje_paska(self) -> list[QWidget]:
        self.guzik_korekta = przycisk("Koryguj", "korekta", "Ostrzegawczy", self.paleta.ostrzezenie)
        self.guzik_korekta.clicked.connect(self._koryguj)
        self.guzik_korekta.setEnabled(False)

        self.guzik_kopiuj = przycisk("Kopiuj do formularza", "plus", "", self.paleta.tekst_przygaszony)
        self.guzik_kopiuj.clicked.connect(self._kopiuj)
        self.guzik_kopiuj.setEnabled(False)

        return [self.guzik_kopiuj, self.guzik_korekta]

    # ------------------------------------------------------------------

    def odswiez(self) -> None:
        self._odswiez_lata()

        operacje = self.kartoteka.operacje
        fraza = self.szukaj.text().strip().lower()
        typ = self.filtr_typu.currentText()
        rok = self.filtr_roku.currentText()
        status = self.filtr_statusu.currentText()

        wynik = []
        for operacja in operacje:
            if status == "Bez skorygowanych" and operacja.status is Status.SKORYGOWANY:
                continue
            if status == "Tylko skorygowane" and operacja.status is not Status.SKORYGOWANY:
                continue
            if typ != "Wszystkie typy" and operacja.typ.value != typ:
                continue
            if rok != "Wszystkie lata" and operacja.data_operacji:
                if str(operacja.data_operacji.year) != rok:
                    continue
            if fraza and fraza not in self._tekst_wyszukiwania(operacja):
                continue
            wynik.append(operacja)

        wynik.sort(key=lambda o: o.data_operacji or date.min, reverse=True)
        self.tabela.ustaw_dane(wynik)

        podsumowanie = model_raporty.podsumuj(wynik, self.kartoteka.ustawienia)
        def liczba(wartosc: float, miejsca: int = 2) -> str:
            return f"{wartosc:,.{miejsca}f}".replace(",", " ").replace(".", ",")

        self.podsumowanie.setText(
            f"Wyświetlono {len(wynik)} z {len(operacje)} operacji   •   "
            f"wolumen {liczba(podsumowanie.wolumen_mp, 1)} MP   •   "
            f"zakup {liczba(podsumowanie.zakup)} zł   •   "
            f"sprzedaż {liczba(podsumowanie.sprzedaz)} zł   •   "
            f"transport {liczba(podsumowanie.transport)} zł"
        )
        self._aktualizuj_przyciski()

    @staticmethod
    def _tekst_wyszukiwania(operacja: Operacja) -> str:
        return " ".join([
            operacja.produkt, operacja.dostawca, operacja.odbiorca, operacja.nr_wz,
            operacja.przewoznik, operacja.nr_rejestracyjny, operacja.uwagi,
            operacja.utworzyl, operacja.id_operacji, operacja.miejsce_zaladunku,
        ]).lower()

    def _odswiez_lata(self) -> None:
        lata = sorted(
            {op.data_operacji.year for op in self.kartoteka.operacje if op.data_operacji},
            reverse=True,
        )
        pozycje = ["Wszystkie lata"] + [str(rok) for rok in lata]
        if [self.filtr_roku.itemText(i) for i in range(self.filtr_roku.count())] == pozycje:
            return

        biezacy = self.filtr_roku.currentText()
        self.filtr_roku.blockSignals(True)
        self.filtr_roku.clear()
        self.filtr_roku.addItems(pozycje)
        if biezacy in pozycje:
            self.filtr_roku.setCurrentText(biezacy)
        self.filtr_roku.blockSignals(False)

    def _aktualizuj_przyciski(self) -> None:
        if not hasattr(self, "guzik_korekta"):
            return
        operacja = self.tabela.zaznaczona()
        mozna = operacja is not None and not self.kartoteka.tylko_odczyt
        self.guzik_korekta.setEnabled(mozna and operacja.status is not Status.SKORYGOWANY)
        self.guzik_kopiuj.setEnabled(operacja is not None)

    def _menu_wiersza(self) -> None:
        operacja = self.tabela.zaznaczona()
        if operacja is None:
            return

        okno = QMessageBox(self)
        okno.setWindowTitle("Operacja")
        okno.setText(operacja.opis_skrocony())
        okno.setInformativeText("Co chcesz zrobić z tym wpisem?")
        guzik_korekty = okno.addButton("Koryguj (storno)", QMessageBox.DestructiveRole)
        guzik_kopii = okno.addButton("Kopiuj do formularza", QMessageBox.AcceptRole)
        okno.addButton("Zamknij", QMessageBox.RejectRole)
        okno.exec()

        if okno.clickedButton() is guzik_korekty:
            self._koryguj()
        elif okno.clickedButton() is guzik_kopii:
            self._kopiuj()

    def _kopiuj(self) -> None:
        operacja = self.tabela.zaznaczona()
        if operacja is not None:
            self.kopiuj_do_formularza.emit(operacja)

    def _koryguj(self) -> None:
        operacja = self.tabela.zaznaczona()
        if operacja is None:
            return

        if operacja.status is Status.SKORYGOWANY:
            QMessageBox.information(self, "Korekta", "Ta operacja została już skorygowana.")
            return

        powod, zatwierdzono = QInputDialog.getText(
            self,
            "Korekta operacji",
            "Podaj powód korekty (trafi do dziennika zdarzeń):",
            QLineEdit.Normal,
            "Korekta błędnego wpisu",
        )
        if not zatwierdzono:
            return

        odpowiedz = QMessageBox.question(
            self,
            "Potwierdzenie korekty",
            f"{operacja.opis_skrocony()}\n\n"
            "Wpis zostanie oznaczony jako SKORYGOWANY, a system dopisze wiersz "
            "odwracający jego skutki. Wiersz pierwotny zostaje w kartotece.\n\nKontynuować?",
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.No,
        )
        if odpowiedz != QMessageBox.Yes:
            return

        storno = self.kartoteka.koryguj(operacja, powod.strip() or "brak podanego powodu")
        QMessageBox.information(
            self,
            "Korekta zapisana",
            "Dopisano wpis odwracający:\n\n" + storno.opis_skrocony(),
        )
        self.zmieniono.emit()
        self.odswiez()
