"""Pulpit - podsumowanie stanu magazynu i ostatnich operacji."""

from __future__ import annotations

from datetime import date, datetime

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QFrame, QGridLayout, QHBoxLayout, QLabel, QVBoxLayout, QWidget

from ...model import magazyn as model_magazyn
from ...model import raporty as model_raporty
from ...model.operacja import TypOperacji
from ..widgety.podstawowe import Karta, NaglowekSekcji, Wskaznik
from ..widgety.tabela import Kolumna, TabelaOperacji, ilosc, kwota
from .bazowy import Widok


def _pieniadze(wartosc: float) -> str:
    return f"{wartosc:,.0f}".replace(",", " ") + " zł"


def _ilosc(wartosc: float) -> str:
    return f"{wartosc:,.1f}".replace(",", " ").replace(".", ",")


class WidokPulpit(Widok):
    tytul = "Pulpit"
    podtytul = "Stan magazynu i bieżący obrót"

    def __init__(self, kartoteka, paleta, parent=None) -> None:
        super().__init__(kartoteka, paleta, parent)

        self.uklad.addWidget(NaglowekSekcji("Stan magazynowy"))
        siatka_stanu = QGridLayout()
        siatka_stanu.setSpacing(14)
        self.w_mp = Wskaznik("Stan łączny", "MP", paleta.akcent)
        self.w_tony = Wskaznik("Stan łączny", "ton")
        self.w_gj = Wskaznik("Energia", "GJ")
        self.w_pozycje = Wskaznik("Pozycje magazynowe", "")
        for numer, wskaznik in enumerate((self.w_mp, self.w_tony, self.w_gj, self.w_pozycje)):
            siatka_stanu.addWidget(wskaznik, 0, numer)
        self.uklad.addLayout(siatka_stanu)

        self.uklad.addWidget(NaglowekSekcji("Bieżący miesiąc"))
        siatka_obrotu = QGridLayout()
        siatka_obrotu.setSpacing(14)
        self.w_zakup = Wskaznik("Zakupy", "", paleta.niebieski)
        self.w_sprzedaz = Wskaznik("Sprzedaż", "", paleta.akcent)
        self.w_transport = Wskaznik("Koszt transportu", "", paleta.ostrzezenie)
        self.w_marza = Wskaznik("Marża", "")
        for numer, wskaznik in enumerate((self.w_zakup, self.w_sprzedaz, self.w_transport, self.w_marza)):
            siatka_obrotu.addWidget(wskaznik, 0, numer)
        self.uklad.addLayout(siatka_obrotu)

        self.ostrzezenie = self._zbuduj_ostrzezenie()
        self.uklad.addWidget(self.ostrzezenie)

        dol = QHBoxLayout()
        dol.setSpacing(14)

        karta_operacji = Karta("Ostatnie operacje")
        self.tabela = TabelaOperacji(
            paleta,
            [
                Kolumna("Data", lambda o: o.data_operacji.strftime("%d.%m") if o.data_operacji else "—", 62,
                        sortowanie=lambda o: o.data_operacji or date.min),
                Kolumna("Typ", lambda o: o.typ.value, 116),
                Kolumna("Produkt", lambda o: o.produkt or "—", 172),
                Kolumna("Wolumen", lambda o: ilosc(o.volumen), 88, Qt.AlignRight | Qt.AlignVCenter,
                        sortowanie=lambda o: o.volumen),
                Kolumna("Wartość", lambda o: kwota(o.wartosc), 112, Qt.AlignRight | Qt.AlignVCenter,
                        sortowanie=lambda o: o.wartosc),
                Kolumna("Utworzył", lambda o: o.utworzyl or "—", 152),
            ],
        )
        self.tabela.setSortingEnabled(False)
        self.tabela.setMinimumHeight(280)
        karta_operacji.dodaj(self.tabela, 1)
        dol.addWidget(karta_operacji, 3)

        karta_magazynu = Karta("Największe pozycje")
        self.lista_pozycji = QVBoxLayout()
        self.lista_pozycji.setSpacing(8)
        pojemnik = QWidget()
        pojemnik.setLayout(self.lista_pozycji)
        karta_magazynu.dodaj(pojemnik, 1)
        dol.addWidget(karta_magazynu, 2)

        self.uklad.addLayout(dol, 1)

    def _zbuduj_ostrzezenie(self) -> QFrame:
        ramka = QFrame()
        ramka.setObjectName("Karta")
        ramka.setStyleSheet(
            f"QFrame#Karta {{ background: {self.paleta.ostrzezenie}1A; "
            f"border: 1px solid {self.paleta.ostrzezenie}66; }}"
        )
        uklad = QHBoxLayout(ramka)
        uklad.setContentsMargins(16, 12, 16, 12)
        uklad.setSpacing(12)

        self.tekst_ostrzezenia = QLabel("")
        self.tekst_ostrzezenia.setWordWrap(True)
        self.tekst_ostrzezenia.setStyleSheet(f"color: {self.paleta.ostrzezenie}; font-weight: 500;")
        uklad.addWidget(self.tekst_ostrzezenia, 1)

        ramka.setVisible(False)
        return ramka

    def odswiez(self) -> None:
        ust = self.kartoteka.ustawienia
        operacje = self.kartoteka.operacje

        pozycje = model_magazyn.policz_stany(operacje, ust)
        podsumowanie = model_magazyn.podsumuj(pozycje, ust)

        self.w_mp.ustaw(_ilosc(podsumowanie.mp))
        self.w_tony.ustaw(_ilosc(podsumowanie.tony))
        self.w_gj.ustaw(_ilosc(podsumowanie.gj))
        self.w_pozycje.ustaw(str(podsumowanie.pozycji), f"{len(operacje)} operacji w kartotece")

        dzisiaj = date.today()
        biezace = [
            op for op in operacje
            if op.aktywna and op.data_operacji
            and op.data_operacji.year == dzisiaj.year
            and op.data_operacji.month == dzisiaj.month
        ]
        obrot = model_raporty.podsumuj(biezace, ust)
        nazwa_miesiaca = model_raporty.MIESIACE[dzisiaj.month - 1].capitalize()

        self.w_zakup.ustaw(_pieniadze(obrot.zakup), f"{nazwa_miesiaca} {dzisiaj.year}")
        self.w_sprzedaz.ustaw(_pieniadze(obrot.sprzedaz), f"{obrot.operacji} operacji")
        self.w_transport.ustaw(_pieniadze(obrot.transport), "")
        self.w_marza.ustaw(_pieniadze(obrot.marza), "sprzedaż − zakup − koszty")
        self.w_marza.ustaw_kolor(self.paleta.akcent if obrot.marza >= 0 else self.paleta.blad)

        if podsumowanie.ujemnych:
            self.tekst_ostrzezenia.setText(
                f"Pozycji ze stanem ujemnym: {podsumowanie.ujemnych}. "
                "Najczęściej oznacza to wydania z magazynu, do którego towar nigdy formalnie "
                "nie wpłynął — sprawdź, czy przyjęcia wskazują właściwą lokalizację."
            )
            self.ostrzezenie.setVisible(True)
        else:
            self.ostrzezenie.setVisible(False)

        ostatnie = sorted(
            [op for op in operacje if op.data_operacji],
            key=lambda op: (op.data_operacji, op.data_dodania or datetime.min),
            reverse=True,
        )[:12]
        self.tabela.ustaw_dane(ostatnie)

        self._odswiez_pozycje(pozycje)

    def _odswiez_pozycje(self, pozycje) -> None:
        while self.lista_pozycji.count():
            element = self.lista_pozycji.takeAt(0)
            widget = element.widget()
            if widget is not None:
                widget.setParent(None)

        najwieksze = sorted(pozycje, key=lambda p: -abs(p.mp))[:7]
        for pozycja in najwieksze:
            self.lista_pozycji.addWidget(self._wiersz_pozycji(pozycja))
        self.lista_pozycji.addStretch(1)

    def _wiersz_pozycji(self, pozycja) -> QWidget:
        widget = QWidget()
        uklad = QVBoxLayout(widget)
        uklad.setContentsMargins(0, 0, 0, 0)
        uklad.setSpacing(2)

        gora = QHBoxLayout()
        gora.setSpacing(8)
        nazwa = QLabel(pozycja.produkt)
        nazwa.setStyleSheet("font-weight: 600; font-size: 12.5px;")
        nazwa.setWordWrap(True)
        wartosc = QLabel(_ilosc(pozycja.mp) + " MP")
        kolor = self.paleta.blad if pozycja.ujemna else self.paleta.tekst
        wartosc.setStyleSheet(f"font-weight: 700; color: {kolor};")
        gora.addWidget(nazwa, 1)
        gora.addWidget(wartosc, 0, Qt.AlignRight)

        lokalizacja = QLabel(pozycja.lokalizacja)
        lokalizacja.setObjectName("PodpowiedzPola")

        uklad.addLayout(gora)
        uklad.addWidget(lokalizacja)
        return widget
