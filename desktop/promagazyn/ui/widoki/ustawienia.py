"""Ustawienia systemu i narzędzia obsługi pliku danych."""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QComboBox,
    QFileDialog,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QVBoxLayout,
    QWidget,
)

from ...dane import csv_io, kopie, sciezki
from ...model.ustawienia import DOMYSLNE
from ..widgety.podstawowe import Karta, Separator
from ..widgety.powloka import przycisk
from .bazowy import Widok

# Klucze pokazywane jako listy wyboru zamiast pól tekstowych.
LISTY = {
    "KOPIA_AUTOMATYCZNA": ["TAK", "NIE"],
    "WYMAGAJ_POLA_UTWORZYL": ["TAK", "NIE"],
    "OSTRZEGAJ_O_DUBLACH": ["TAK", "NIE"],
    "MOTYW": ["ciemny", "jasny"],
}

# Klucz uzupełniany przez system - nie ma sensu go edytować ręcznie.
UKRYTE = {"OSTATNIA_KOPIA"}

# Czytelne nazwy pól - klucze techniczne zostają w pliku Excela.
ETYKIETY = {
    "FIRMA": "Firma",
    "MAGAZYN": "Magazyn stanowiska",
    "STAWKA_TRANSPORT_KM": "Stawka transportu",
    "PRZELICZNIK_MP_TONA": "Przelicznik MP → tona",
    "PRZELICZNIK_M3_MP": "Przelicznik m³ → MP",
    "PRZELICZNIK_GJ_TONA": "Przelicznik tona → GJ",
    "MAX_DNI_ROBOCZYCH_WSTECZ": "Datowanie wstecz",
    "MAX_DNI_WPRZOD": "Datowanie w przód",
    "FOLDER_KOPII": "Folder kopii",
    "KOPIA_AUTOMATYCZNA": "Kopia automatyczna",
    "KOPIE_DO_ZACHOWANIA": "Kopii do zachowania",
    "WYMAGAJ_POLA_UTWORZYL": "Pole „Utworzył” wymagane",
    "OSTRZEGAJ_O_DUBLACH": "Ostrzeganie o duplikatach",
    "DOMYSLNY_AUTOR": "Domyślny autor",
    "SUROWIEC_DOMYSLNY": "Surowiec domyślny",
    "MOTYW": "Motyw interfejsu",
}


class WidokUstawienia(Widok):
    tytul = "Ustawienia"
    podtytul = "Parametry systemu i obsługa pliku danych"

    zmieniono = Signal()
    zmieniono_motyw = Signal(str)

    def __init__(self, kartoteka, paleta, parent=None) -> None:
        super().__init__(kartoteka, paleta, parent)
        self._kontrolki: dict[str, QWidget] = {}

        kolumny = QHBoxLayout()
        kolumny.setSpacing(16)
        kolumny.addWidget(self._karta_parametrow(), 3)

        prawa = QVBoxLayout()
        prawa.setSpacing(16)
        prawa.addWidget(self._karta_pliku())
        prawa.addWidget(self._karta_kopii())
        prawa.addWidget(self._karta_wymiany())
        prawa.addStretch(1)
        kolumny.addLayout(prawa, 2)

        self.uklad.addLayout(kolumny)

    def _karta_parametrow(self) -> Karta:
        karta = Karta("Parametry systemu")
        siatka = QGridLayout()
        siatka.setHorizontalSpacing(14)
        siatka.setVerticalSpacing(11)

        wiersz = 0
        for klucz, domyslna, opis in DOMYSLNE:
            if klucz in UKRYTE:
                continue

            etykieta = QLabel(ETYKIETY.get(klucz, klucz.replace("_", " ").capitalize()))
            etykieta.setObjectName("EtykietaPola")

            if klucz in LISTY:
                kontrolka = QComboBox()
                kontrolka.addItems(LISTY[klucz])
                kontrolka.currentTextChanged.connect(
                    lambda wartosc, k=klucz: self._zapisz(k, wartosc)
                )
            else:
                kontrolka = QLineEdit()
                kontrolka.setMinimumWidth(210)
                kontrolka.editingFinished.connect(
                    lambda k=klucz, w=kontrolka: self._zapisz(k, w.text())
                )

            podpowiedz = QLabel(opis)
            podpowiedz.setObjectName("PodpowiedzPola")
            podpowiedz.setWordWrap(True)

            siatka.addWidget(etykieta, wiersz, 0)
            siatka.addWidget(kontrolka, wiersz, 1)
            siatka.addWidget(podpowiedz, wiersz, 2)
            siatka.setColumnStretch(2, 1)

            self._kontrolki[klucz] = kontrolka
            wiersz += 1

        karta.dodaj_uklad(siatka)
        return karta

    def _karta_pliku(self) -> Karta:
        karta = Karta("Plik danych")
        self.etykieta_pliku = QLabel("")
        self.etykieta_pliku.setWordWrap(True)
        self.etykieta_pliku.setObjectName("PodpowiedzPola")
        karta.dodaj(self.etykieta_pliku)

        self.etykieta_trybu = QLabel("")
        self.etykieta_trybu.setWordWrap(True)
        karta.dodaj(self.etykieta_trybu)

        karta.dodaj(Separator())

        przyciski = QHBoxLayout()
        przyciski.setSpacing(9)
        guzik_otworz = przycisk("Otwórz inny plik", "plik", "", self.paleta.tekst_przygaszony)
        guzik_otworz.clicked.connect(self._otworz_plik)
        guzik_folder = przycisk("Pokaż folder", "kartoteka", "", self.paleta.tekst_przygaszony)
        guzik_folder.clicked.connect(self._pokaz_folder)
        przyciski.addWidget(guzik_otworz)
        przyciski.addWidget(guzik_folder)
        karta.dodaj_uklad(przyciski)
        return karta

    def _karta_kopii(self) -> Karta:
        karta = Karta("Kopie zapasowe")
        self.etykieta_kopii = QLabel("")
        self.etykieta_kopii.setObjectName("PodpowiedzPola")
        self.etykieta_kopii.setWordWrap(True)
        karta.dodaj(self.etykieta_kopii)

        guzik = przycisk("Wykonaj kopię teraz", "kopia", "Glowny")
        guzik.clicked.connect(self._kopia_teraz)
        karta.dodaj(guzik)
        return karta

    def _karta_wymiany(self) -> Karta:
        karta = Karta("Import i eksport")
        opis = QLabel(
            "Format CSV: UTF-8, separator średnik, kropka dziesiętna. "
            "Przed importem system wykonuje kopię zapasową."
        )
        opis.setObjectName("PodpowiedzPola")
        opis.setWordWrap(True)
        karta.dodaj(opis)

        przyciski = QHBoxLayout()
        przyciski.setSpacing(9)
        guzik_import = przycisk("Importuj CSV", "import", "", self.paleta.tekst_przygaszony)
        guzik_import.clicked.connect(self._importuj)
        guzik_eksport = przycisk("Eksportuj CSV", "eksport", "", self.paleta.tekst_przygaszony)
        guzik_eksport.clicked.connect(self._eksportuj)
        przyciski.addWidget(guzik_import)
        przyciski.addWidget(guzik_eksport)
        karta.dodaj_uklad(przyciski)
        return karta

    # ------------------------------------------------------------------

    def odswiez(self) -> None:
        ustawienia = self.kartoteka.ustawienia
        for klucz, kontrolka in self._kontrolki.items():
            wartosc = ustawienia.get(klucz, "")
            kontrolka.blockSignals(True)
            if isinstance(kontrolka, QComboBox):
                kontrolka.setCurrentText(str(wartosc))
            else:
                kontrolka.setText("" if wartosc is None else str(wartosc))
                kontrolka.setCursorPosition(0)  # pokazujemy początek, nie koniec
            kontrolka.blockSignals(False)

        sciezka = self.kartoteka.sciezka
        self.etykieta_pliku.setText(str(sciezka) if sciezka else "Brak otwartego pliku")

        tryb = "przenośny (dane obok programu)" if sciezki.tryb_przenosny() else "zainstalowany"
        if self.kartoteka.tylko_odczyt:
            kto = self.kartoteka.kto_blokuje()
            self.etykieta_trybu.setText(
                f"Tryb {tryb} • PLIK TYLKO DO ODCZYTU — edytuje go {kto or 'inny użytkownik'}"
            )
            self.etykieta_trybu.setStyleSheet(
                f"color: {self.paleta.ostrzezenie}; font-weight: 600;"
            )
        else:
            self.etykieta_trybu.setText(f"Tryb {tryb} • plik gotowy do edycji")
            self.etykieta_trybu.setStyleSheet(f"color: {self.paleta.akcent}; font-weight: 600;")

        self._odswiez_kopie()

    def _odswiez_kopie(self) -> None:
        if self.kartoteka.sciezka is None:
            self.etykieta_kopii.setText("Kopie będą dostępne po zapisaniu pliku danych.")
            return

        lista = kopie.lista_kopii(
            self.kartoteka.sciezka, self.kartoteka.ustawienia.tekst("FOLDER_KOPII")
        )
        if not lista:
            self.etykieta_kopii.setText("Brak kopii zapasowych.")
            return

        najnowsza = lista[0]
        folder = najnowsza.parent
        self.etykieta_kopii.setText(
            f"Kopii w folderze: {len(lista)}\nOstatnia: {najnowsza.name}\nFolder: {folder}"
        )

    def _zapisz(self, klucz: str, wartosc: str) -> None:
        poprzednia = str(self.kartoteka.ustawienia.get(klucz, ""))
        if poprzednia == wartosc:
            return

        # Liczby zapisujemy jako liczby, żeby arkusz Excela dostał właściwy typ.
        docelowa: object = wartosc
        domyslna = next((d for k, d, _ in DOMYSLNE if k == klucz), "")
        if isinstance(domyslna, (int, float)) and not isinstance(domyslna, bool):
            try:
                docelowa = float(wartosc.replace(",", ".")) if wartosc.strip() else domyslna
            except ValueError:
                QMessageBox.warning(
                    self, "Ustawienia", f"Wartość „{wartosc}” nie jest liczbą."
                )
                self.odswiez()
                return

        self.kartoteka.ustawienia.ustaw(klucz, docelowa)
        self.kartoteka.zmieniona = True

        if klucz == "MOTYW":
            self.zmieniono_motyw.emit(str(docelowa))
        self.zmieniono.emit()

    def _otworz_plik(self) -> None:
        okno = self.window()
        if hasattr(okno, "otworz"):
            okno.otworz()
            self.odswiez()

    def _pokaz_folder(self) -> None:
        folder = (
            self.kartoteka.sciezka.parent
            if self.kartoteka.sciezka
            else sciezki.katalog_danych()
        )
        QMessageBox.information(self, "Folder danych", str(folder))

    def _kopia_teraz(self) -> None:
        if self.kartoteka.sciezka is None:
            QMessageBox.information(self, "Kopia zapasowa", "Najpierw zapisz plik danych.")
            return

        utworzona = self.kartoteka.kopia_reczna()
        if utworzona is None:
            QMessageBox.warning(self, "Kopia zapasowa", "Nie udało się utworzyć kopii.")
            return

        QMessageBox.information(self, "Kopia zapasowa", f"Utworzono kopię:\n{utworzona}")
        self._odswiez_kopie()
        self.zmieniono.emit()

    def _eksportuj(self) -> None:
        sciezka, _ = QFileDialog.getSaveFileName(
            self, "Eksport kartoteki", "kartoteka.csv", "Plik CSV (*.csv)"
        )
        if not sciezka:
            return
        ile = csv_io.zapisz(Path(sciezka), self.kartoteka.operacje)
        QMessageBox.information(self, "Eksport", f"Zapisano {ile} operacji do:\n{sciezka}")

    def _importuj(self) -> None:
        if self.kartoteka.tylko_odczyt:
            QMessageBox.warning(
                self, "Import", "Plik jest otwarty tylko do odczytu - import niemożliwy."
            )
            return

        sciezka, _ = QFileDialog.getOpenFileName(
            self, "Import kartoteki", str(sciezki.katalog_danych()), "Plik CSV (*.csv)"
        )
        if not sciezka:
            return

        operacje, pominiete = csv_io.wczytaj(Path(sciezka))
        if not operacje:
            QMessageBox.warning(
                self, "Import", "Plik nie zawiera operacji możliwych do wczytania."
            )
            return

        odpowiedz = QMessageBox.question(
            self,
            "Import operacji",
            f"Wczytano {len(operacje)} operacji do dopisania"
            + (f", pominięto {len(pominiete)} wierszy." if pominiete else ".")
            + "\n\nPrzed importem powstanie kopia zapasowa. Kontynuować?",
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.No,
        )
        if odpowiedz != QMessageBox.Yes:
            return

        self.kartoteka.kopia_reczna()
        ile = self.kartoteka.zaimportuj(operacje)

        raport = "\n".join("•  " + opis for opis in pominiete[:8])
        QMessageBox.information(
            self,
            "Import zakończony",
            f"Dopisano operacji: {ile}\n"
            + (f"Pominięto wierszy: {len(pominiete)}\n\n{raport}" if pominiete else ""),
        )
        self.zmieniono.emit()
        self.odswiez()
