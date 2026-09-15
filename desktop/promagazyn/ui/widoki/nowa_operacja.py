"""Formularz nowej operacji magazynowej."""

from __future__ import annotations

from datetime import date

from PySide6.QtCore import QDate, Qt, Signal
from PySide6.QtWidgets import (
    QComboBox,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QVBoxLayout,
    QWidget,
)

from ...model.operacja import Operacja, OperacjeRownolegle, TypOperacji
from ...model.silnik import przelicz_transport, wartosc_operacji
from ..widgety.podstawowe import (
    Karta,
    Pole,
    Separator,
    pole_daty,
    pole_kwoty,
    pole_liczbowe,
    pole_listy,
    pole_tekstowe,
)
from ..widgety.powloka import przycisk
from .bazowy import Widok


class WidokNowaOperacja(Widok):
    tytul = "Nowa operacja"
    podtytul = "Wprowadzenie operacji magazynowej"

    zapisano = Signal()

    def __init__(self, kartoteka, paleta, parent=None) -> None:
        super().__init__(kartoteka, paleta, parent)
        self._blokada_przeliczania = False

        kolumny = QHBoxLayout()
        kolumny.setSpacing(16)

        lewa = QVBoxLayout()
        lewa.setSpacing(16)
        lewa.addWidget(self._karta_podstawowa())
        lewa.addWidget(self._karta_towaru())
        lewa.addWidget(self._karta_kontrahentow())
        lewa.addStretch(1)

        prawa = QVBoxLayout()
        prawa.setSpacing(16)
        prawa.addWidget(self._karta_transportu())
        prawa.addWidget(self._karta_rownoleglych())
        prawa.addWidget(self._karta_podsumowania())
        prawa.addStretch(1)

        kolumny.addLayout(lewa, 3)
        kolumny.addLayout(prawa, 2)
        self.uklad.addLayout(kolumny)

        self._podepnij_zdarzenia()
        self.przeladuj_slowniki()
        self.wyczysc()

    # ------------------------------------------------------------------
    #  Karty formularza
    # ------------------------------------------------------------------

    def _karta_podstawowa(self) -> Karta:
        karta = Karta("Dane podstawowe")
        siatka = QGridLayout()
        siatka.setHorizontalSpacing(14)
        siatka.setVerticalSpacing(12)

        self.p_typ = Pole("Typ operacji", pole_listy([t.value for t in TypOperacji], False),
                          "decyduje, które pola są wymagane", True)
        self.p_data = Pole("Data operacji", pole_daty(), "", True)
        self.p_data_zal = Pole("Data załadunku", pole_daty(), "u klienta końcowego")
        self.p_wz = Pole("Nr WZ / PZ", pole_tekstowe("np. PZ/129"))
        self.p_utworzyl = Pole("Utworzył", pole_listy([]), "wybierz z listy albo wpisz własne", True)

        siatka.addWidget(self.p_typ, 0, 0)
        siatka.addWidget(self.p_data, 0, 1)
        siatka.addWidget(self.p_data_zal, 0, 2)
        siatka.addWidget(self.p_wz, 1, 0)
        siatka.addWidget(self.p_utworzyl, 1, 1, 1, 2)

        guzik_wz = przycisk("Podpowiedz numer", "odswiez", "Plaski", self.paleta.tekst_przygaszony)
        guzik_wz.clicked.connect(self._podpowiedz_numer_wz)
        siatka.addWidget(guzik_wz, 2, 0)

        karta.dodaj_uklad(siatka)
        return karta

    def _karta_towaru(self) -> Karta:
        karta = Karta("Towar")
        siatka = QGridLayout()
        siatka.setHorizontalSpacing(14)
        siatka.setVerticalSpacing(12)

        self.p_produkt = Pole("Produkt", pole_listy([]), "", True)
        self.p_volumen = Pole("Wolumen", pole_liczbowe(), "", True)
        self.p_jednostka = Pole("Jednostka", pole_listy(["MP", "TON", "M3", "GJ"], False), "", True)
        self.p_cena_zakupu = Pole("Cena zakupu / produkcji", pole_kwoty(), "za jednostkę")
        self.p_cena_sprzedazy = Pole("Cena sprzedaży", pole_kwoty(), "za jednostkę")
        self.p_magazynowane = Pole("Czy magazynowane", pole_listy(["TAK", "NIE"], False),
                                   "TAK = operacja zmienia stan magazynu")
        self.p_deklaracja = Pole("Deklaracja / KZR", pole_listy(["Deklaracja", "KZR"]))
        self.p_zrebka = Pole("Rodzaj zrębki", pole_listy(["A", "B"]))
        self.p_rabanie = Pole("Rąbanie (kto)", pole_listy([]))
        self.p_koszt_rabania = Pole("Koszt rąbania", pole_kwoty(), "zł za MP")

        siatka.addWidget(self.p_produkt, 0, 0, 1, 2)
        siatka.addWidget(self.p_volumen, 0, 2)
        siatka.addWidget(self.p_jednostka, 0, 3)
        siatka.addWidget(self.p_cena_zakupu, 1, 0)
        siatka.addWidget(self.p_cena_sprzedazy, 1, 1)
        siatka.addWidget(self.p_magazynowane, 1, 2)
        siatka.addWidget(self.p_deklaracja, 1, 3)
        siatka.addWidget(self.p_zrebka, 2, 0)
        siatka.addWidget(self.p_rabanie, 2, 1)
        siatka.addWidget(self.p_koszt_rabania, 2, 2)

        karta.dodaj_uklad(siatka)

        self.sekcja_surowca = QWidget()
        uklad_surowca = QGridLayout(self.sekcja_surowca)
        uklad_surowca.setContentsMargins(0, 6, 0, 0)
        uklad_surowca.setHorizontalSpacing(14)
        self.p_surowiec = Pole("Surowiec zużyty", pole_listy([]), "puste = wartość z ustawień")
        self.p_surowiec_vol = Pole("Wolumen surowca", pole_liczbowe(), "puste = tyle co produkcja")
        uklad_surowca.addWidget(self.p_surowiec, 0, 0)
        uklad_surowca.addWidget(self.p_surowiec_vol, 0, 1)
        karta.dodaj(self.sekcja_surowca)

        return karta

    def _karta_kontrahentow(self) -> Karta:
        karta = Karta("Kontrahenci i lokalizacje")
        siatka = QGridLayout()
        siatka.setHorizontalSpacing(14)
        siatka.setVerticalSpacing(12)

        self.p_dostawca = Pole("Dostawca / magazyn źródłowy", pole_listy([]),
                               "wybór podpowiada miejsce i produkt", True)
        self.p_odbiorca = Pole("Odbiorca / magazyn docelowy", pole_listy([]), "", True)
        self.p_miejsce_zal = Pole("Miejsce załadunku", pole_listy([]))
        self.p_miejsce_poch = Pole("Miejsce pochodzenia", pole_listy([]))
        self.p_uwagi = Pole("Uwagi", pole_tekstowe())

        siatka.addWidget(self.p_dostawca, 0, 0)
        siatka.addWidget(self.p_odbiorca, 0, 1)
        siatka.addWidget(self.p_miejsce_zal, 1, 0)
        siatka.addWidget(self.p_miejsce_poch, 1, 1)
        siatka.addWidget(self.p_uwagi, 2, 0, 1, 2)

        karta.dodaj_uklad(siatka)
        return karta

    def _karta_transportu(self) -> Karta:
        karta = Karta("Transport")
        opis = QLabel("Koszt liczy się sam: odległość × stawka za kilometr.")
        opis.setObjectName("PodpowiedzPola")
        karta.dodaj(opis)

        siatka = QGridLayout()
        siatka.setHorizontalSpacing(14)
        siatka.setVerticalSpacing(12)

        self.p_przewoznik = Pole("Przewoźnik", pole_listy([]), "podpowiada pojazd i stawkę")
        self.p_nr_rej = Pole("Nr rejestracyjny", pole_listy([]))
        self.p_odleglosc = Pole("Odległość", pole_liczbowe(99_999, 2, "km"))
        self.p_stawka = Pole("Stawka", pole_kwoty("zł/km"))
        self.p_koszt_transportu = Pole("Koszt transportu", pole_kwoty(), "można nadpisać ręcznie")
        self.p_koszt_transportu.kontrolka.setProperty("wyliczane", "true")

        siatka.addWidget(self.p_przewoznik, 0, 0)
        siatka.addWidget(self.p_nr_rej, 0, 1)
        siatka.addWidget(self.p_odleglosc, 1, 0)
        siatka.addWidget(self.p_stawka, 1, 1)
        siatka.addWidget(self.p_koszt_transportu, 2, 0, 1, 2)

        karta.dodaj_uklad(siatka)
        return karta

    def _karta_rownoleglych(self) -> Karta:
        self.karta_rownoleglych = Karta("Operacje równoległe")
        opis = QLabel(
            "Przy zakupie jednym zapisem powstaje cały łańcuch zdarzeń. "
            "Wiersze dostają wspólny identyfikator powiązania."
        )
        opis.setObjectName("PodpowiedzPola")
        opis.setWordWrap(True)
        self.karta_rownoleglych.dodaj(opis)

        siatka = QGridLayout()
        siatka.setHorizontalSpacing(14)
        siatka.setVerticalSpacing(10)

        self.p_r_produkcja = Pole("Produkcja", pole_listy(["NIE", "TAK"], False))
        self.p_r_produkt = Pole("Produkt wyjściowy", pole_listy([]))
        self.p_r_volumen = Pole("Wolumen produkcji", pole_liczbowe())
        self.p_r_jednostka = Pole("Jednostka", pole_listy(["MP", "TON", "M3", "GJ"], False))

        self.p_r_sprzedaz = Pole("Sprzedaż", pole_listy(["NIE", "TAK"], False))
        self.p_r_odbiorca = Pole("Odbiorca końcowy", pole_listy([]))
        self.p_r_cena = Pole("Cena sprzedaży", pole_kwoty())

        self.p_r_transport = Pole("Transport", pole_listy(["NIE", "TAK"], False),
                                  "użyje danych z karty Transport")

        siatka.addWidget(self.p_r_produkcja, 0, 0)
        siatka.addWidget(self.p_r_produkt, 0, 1)
        siatka.addWidget(self.p_r_volumen, 1, 0)
        siatka.addWidget(self.p_r_jednostka, 1, 1)
        siatka.addWidget(Separator(), 2, 0, 1, 2)
        siatka.addWidget(self.p_r_sprzedaz, 3, 0)
        siatka.addWidget(self.p_r_odbiorca, 3, 1)
        siatka.addWidget(self.p_r_cena, 4, 0)
        siatka.addWidget(Separator(), 5, 0, 1, 2)
        siatka.addWidget(self.p_r_transport, 6, 0, 1, 2)

        self.karta_rownoleglych.dodaj_uklad(siatka)
        return self.karta_rownoleglych

    def _karta_podsumowania(self) -> Karta:
        karta = Karta()
        uklad = QVBoxLayout()
        uklad.setSpacing(6)

        etykieta = QLabel("WARTOŚĆ OPERACJI")
        etykieta.setObjectName("EtykietaWskaznika")
        self.etykieta_wartosci = QLabel("—")
        self.etykieta_wartosci.setObjectName("WartoscWskaznika")
        self.etykieta_wartosci.setStyleSheet(f"color: {self.paleta.akcent};")
        self.etykieta_lancucha = QLabel("")
        self.etykieta_lancucha.setObjectName("PodpowiedzPola")
        self.etykieta_lancucha.setWordWrap(True)

        uklad.addWidget(etykieta)
        uklad.addWidget(self.etykieta_wartosci)
        uklad.addWidget(self.etykieta_lancucha)
        karta.dodaj_uklad(uklad)

        przyciski = QHBoxLayout()
        przyciski.setSpacing(10)
        self.guzik_zapisz = przycisk("Zapisz operację", "zapisz", "Glowny")
        self.guzik_zapisz.clicked.connect(self.zapisz_operacje)
        guzik_wyczysc = przycisk("Wyczyść", "odswiez", "", self.paleta.tekst_przygaszony)
        guzik_wyczysc.clicked.connect(self.wyczysc)
        przyciski.addWidget(self.guzik_zapisz, 2)
        przyciski.addWidget(guzik_wyczysc, 1)
        karta.dodaj_uklad(przyciski)

        return karta

    # ------------------------------------------------------------------
    #  Zdarzenia i przeliczenia
    # ------------------------------------------------------------------

    def _podepnij_zdarzenia(self) -> None:
        self.p_typ.zmieniono.connect(self._dostosuj_do_typu)
        self.p_przewoznik.zmieniono.connect(self._podpowiedz_przewoznika)
        self.p_nr_rej.zmieniono.connect(self._podpowiedz_pojazdu)
        self.p_dostawca.zmieniono.connect(self._podpowiedz_dostawcy)
        self.p_produkt.zmieniono.connect(self._podpowiedz_produktu)
        self.p_odbiorca.zmieniono.connect(self._podpowiedz_ceny)

        for pole in (self.p_odleglosc, self.p_stawka):
            pole.zmieniono.connect(self._przelicz_transport)
        for pole in (self.p_volumen, self.p_cena_zakupu, self.p_cena_sprzedazy,
                     self.p_koszt_transportu):
            pole.zmieniono.connect(self._przelicz_wartosc)

        for pole in (self.p_r_produkcja, self.p_r_sprzedaz, self.p_r_transport):
            pole.zmieniono.connect(self._dostosuj_rownolegle)

    def _dostosuj_do_typu(self) -> None:
        typ = self._typ()
        transport = typ is TypOperacji.TRANSPORT
        zakup = typ is TypOperacji.ZAKUP
        produkcja = typ is TypOperacji.PRODUKCJA

        for pole in (self.p_produkt, self.p_volumen, self.p_jednostka,
                     self.p_deklaracja, self.p_zrebka, self.p_rabanie, self.p_koszt_rabania):
            pole.ustaw_widocznosc(not transport)

        self.p_cena_zakupu.ustaw_aktywne(zakup)
        self.p_cena_sprzedazy.ustaw_aktywne(typ is TypOperacji.SPRZEDAZ)
        if not zakup:
            self.p_cena_zakupu.kontrolka.setValue(0)
        if typ is not TypOperacji.SPRZEDAZ:
            self.p_cena_sprzedazy.kontrolka.setValue(0)

        self.sekcja_surowca.setVisible(produkcja)
        self.karta_rownoleglych.setVisible(zakup)

        if transport:
            self.p_magazynowane.kontrolka.setCurrentText("NIE")
            self.p_magazynowane.ustaw_aktywne(False)
            if self.p_stawka.kontrolka.value() <= 0:
                self.p_stawka.kontrolka.setValue(self.kartoteka.ustawienia.stawka_km)
        else:
            self.p_magazynowane.ustaw_aktywne(True)

        self._przelicz_wartosc()

    def _dostosuj_rownolegle(self) -> None:
        produkcja = self.p_r_produkcja.kontrolka.currentText() == "TAK"
        sprzedaz = self.p_r_sprzedaz.kontrolka.currentText() == "TAK"

        for pole in (self.p_r_produkt, self.p_r_volumen, self.p_r_jednostka):
            pole.ustaw_aktywne(produkcja)
        for pole in (self.p_r_odbiorca, self.p_r_cena):
            pole.ustaw_aktywne(sprzedaz)

        self._przelicz_wartosc()

    def _przelicz_transport(self) -> None:
        if self._blokada_przeliczania:
            return
        self._blokada_przeliczania = True
        try:
            odleglosc = self.p_odleglosc.kontrolka.value()
            stawka = self.p_stawka.kontrolka.value()
            if stawka <= 0:
                stawka = self.kartoteka.ustawienia.stawka_km
                self.p_stawka.kontrolka.setValue(stawka)
            if odleglosc > 0:
                self.p_koszt_transportu.kontrolka.setValue(round(odleglosc * stawka, 2))
        finally:
            self._blokada_przeliczania = False
        self._przelicz_wartosc()

    def _przelicz_wartosc(self) -> None:
        operacja = self._zbierz_operacje()
        wartosc = wartosc_operacji(operacja)
        self.etykieta_wartosci.setText(
            f"{wartosc:,.2f}".replace(",", " ").replace(".", ",") + " zł" if wartosc else "—"
        )
        self._opisz_lancuch()

    def _opisz_lancuch(self) -> None:
        if self._typ() is not TypOperacji.ZAKUP:
            liczba = 2 if self._typ() is TypOperacji.PRODUKCJA else 1
            self.etykieta_lancucha.setText(
                "Powstaną 2 wiersze: produkcja i automatyczne zużycie surowca."
                if liczba == 2 else "Powstanie 1 wiersz kartoteki."
            )
            return

        czesci = ["zakup"]
        if self.p_r_produkcja.kontrolka.currentText() == "TAK":
            czesci += ["produkcja", "zużycie"]
        if self.p_r_sprzedaz.kontrolka.currentText() == "TAK":
            czesci.append("sprzedaż")
        if self.p_r_transport.kontrolka.currentText() == "TAK":
            czesci.append("transport")

        self.etykieta_lancucha.setText(
            f"Powstanie {len(czesci)} wiersz(y) kartoteki: " + ", ".join(czesci) + "."
        )

    # ------------------------------------------------------------------
    #  Podpowiedzi
    # ------------------------------------------------------------------

    def _podpowiedz_przewoznika(self) -> None:
        przewoznik = self.p_przewoznik.kontrolka.currentText().strip()
        if not przewoznik:
            return
        podpowiedzi = self.kartoteka.podpowiedzi

        if not self.p_nr_rej.kontrolka.currentText().strip():
            pojazd = podpowiedzi.pojazd_przewoznika(przewoznik)
            if pojazd:
                self.p_nr_rej.kontrolka.setCurrentText(pojazd)

        if self.p_stawka.kontrolka.value() <= 0:
            stawka = podpowiedzi.stawka_przewoznika(przewoznik) or self.kartoteka.ustawienia.stawka_km
            self.p_stawka.kontrolka.setValue(stawka)

    def _podpowiedz_pojazdu(self) -> None:
        pojazd = self.p_nr_rej.kontrolka.currentText().strip()
        if not pojazd or self.p_przewoznik.kontrolka.currentText().strip():
            return
        przewoznik = self.kartoteka.podpowiedzi.przewoznik_pojazdu(pojazd)
        if przewoznik:
            self.p_przewoznik.kontrolka.setCurrentText(przewoznik)

    def _podpowiedz_dostawcy(self) -> None:
        dostawca = self.p_dostawca.kontrolka.currentText().strip()
        if not dostawca:
            return
        podpowiedzi = self.kartoteka.podpowiedzi

        if not self.p_miejsce_zal.kontrolka.currentText().strip():
            miejsce = podpowiedzi.miejsce_dostawcy(dostawca)
            if miejsce:
                self.p_miejsce_zal.kontrolka.setCurrentText(miejsce)

        if not self.p_produkt.kontrolka.currentText().strip():
            produkt = podpowiedzi.produkt_dostawcy(dostawca)
            if produkt:
                self.p_produkt.kontrolka.setCurrentText(produkt)

    def _podpowiedz_produktu(self) -> None:
        produkt = self.p_produkt.kontrolka.currentText().strip()
        if not produkt:
            return
        if not self.p_jednostka.kontrolka.currentText().strip():
            jednostka = self.kartoteka.podpowiedzi.jednostka_produktu(produkt)
            if jednostka:
                self.p_jednostka.kontrolka.setCurrentText(jednostka)
        self._podpowiedz_ceny()

    def _podpowiedz_ceny(self) -> None:
        typ = self._typ()
        produkt = self.p_produkt.kontrolka.currentText().strip()
        podpowiedzi = self.kartoteka.podpowiedzi

        if typ is TypOperacji.ZAKUP and self.p_cena_zakupu.kontrolka.value() <= 0:
            cena = podpowiedzi.cena_zakupu(self.p_dostawca.kontrolka.currentText(), produkt)
            if cena > 0:
                self.p_cena_zakupu.kontrolka.setValue(cena)
        elif typ is TypOperacji.SPRZEDAZ and self.p_cena_sprzedazy.kontrolka.value() <= 0:
            cena = podpowiedzi.cena_sprzedazy(self.p_odbiorca.kontrolka.currentText(), produkt)
            if cena > 0:
                self.p_cena_sprzedazy.kontrolka.setValue(cena)

    def _podpowiedz_numer_wz(self) -> None:
        prefiks = "WZ" if self._typ() is TypOperacji.SPRZEDAZ else "PZ"
        self.p_wz.kontrolka.setText(self.kartoteka.podpowiedzi.nastepny_numer_wz(prefiks))

    # ------------------------------------------------------------------
    #  Zbieranie i zapis
    # ------------------------------------------------------------------

    def _typ(self) -> TypOperacji:
        return TypOperacji.z_tekstu(self.p_typ.kontrolka.currentText()) or TypOperacji.ZAKUP

    def _zbierz_operacje(self) -> Operacja:
        data_zal = self.p_data_zal.kontrolka.date().toPython()
        return Operacja(
            typ=self._typ(),
            data_operacji=self.p_data.kontrolka.date().toPython(),
            data_zaladunku=data_zal,
            miejsce_zaladunku=self.p_miejsce_zal.kontrolka.currentText().strip(),
            dostawca=self.p_dostawca.kontrolka.currentText().strip(),
            odbiorca=self.p_odbiorca.kontrolka.currentText().strip(),
            nr_wz=self.p_wz.kontrolka.text().strip(),
            czy_magazynowane=self.p_magazynowane.kontrolka.currentText() != "NIE",
            deklaracja=self.p_deklaracja.kontrolka.currentText().strip(),
            produkt=self.p_produkt.kontrolka.currentText().strip(),
            volumen=self.p_volumen.kontrolka.value(),
            jednostka=self.p_jednostka.kontrolka.currentText().strip(),
            cena_zakupu=self.p_cena_zakupu.kontrolka.value(),
            cena_sprzedazy=self.p_cena_sprzedazy.kontrolka.value(),
            rodzaj_zrebki=self.p_zrebka.kontrolka.currentText().strip(),
            rabanie=self.p_rabanie.kontrolka.currentText().strip(),
            koszt_rabania=self.p_koszt_rabania.kontrolka.value(),
            przewoznik=self.p_przewoznik.kontrolka.currentText().strip(),
            nr_rejestracyjny=self.p_nr_rej.kontrolka.currentText().strip(),
            odleglosc=self.p_odleglosc.kontrolka.value(),
            stawka_km=self.p_stawka.kontrolka.value(),
            koszt_transportu=self.p_koszt_transportu.kontrolka.value(),
            miejsce_pochodzenia=self.p_miejsce_poch.kontrolka.currentText().strip(),
            uwagi=self.p_uwagi.kontrolka.text().strip(),
            utworzyl=self.p_utworzyl.kontrolka.currentText().strip(),
        )

    def _zbierz_rownolegle(self) -> OperacjeRownolegle:
        return OperacjeRownolegle(
            produkcja=self.p_r_produkcja.kontrolka.currentText() == "TAK",
            produkt_produkcji=self.p_r_produkt.kontrolka.currentText().strip(),
            volumen_produkcji=self.p_r_volumen.kontrolka.value(),
            jednostka_produkcji=self.p_r_jednostka.kontrolka.currentText().strip(),
            sprzedaz=self.p_r_sprzedaz.kontrolka.currentText() == "TAK",
            odbiorca_sprzedazy=self.p_r_odbiorca.kontrolka.currentText().strip(),
            cena_sprzedazy=self.p_r_cena.kontrolka.value(),
            transport=self.p_r_transport.kontrolka.currentText() == "TAK",
            przewoznik=self.p_przewoznik.kontrolka.currentText().strip(),
            nr_rejestracyjny=self.p_nr_rej.kontrolka.currentText().strip(),
            odleglosc=self.p_odleglosc.kontrolka.value(),
            stawka_km=self.p_stawka.kontrolka.value(),
            koszt_transportu=self.p_koszt_transportu.kontrolka.value(),
        )

    def _pola_wg_nazwy(self) -> dict[str, Pole]:
        return {
            "typ": self.p_typ, "data_operacji": self.p_data, "utworzyl": self.p_utworzyl,
            "produkt": self.p_produkt, "volumen": self.p_volumen, "jednostka": self.p_jednostka,
            "dostawca": self.p_dostawca, "odbiorca": self.p_odbiorca,
            "cena_zakupu": self.p_cena_zakupu, "cena_sprzedazy": self.p_cena_sprzedazy,
            "przewoznik": self.p_przewoznik, "nr_rejestracyjny": self.p_nr_rej,
            "odleglosc": self.p_odleglosc, "koszt_transportu": self.p_koszt_transportu,
            "koszt_rabania": self.p_koszt_rabania,
            "produkt_produkcji": self.p_r_produkt, "volumen_produkcji": self.p_r_volumen,
            "jednostka_produkcji": self.p_r_jednostka,
            "odbiorca_sprzedazy": self.p_r_odbiorca,
        }

    def zapisz_operacje(self) -> None:
        for pole in self._pola_wg_nazwy().values():
            pole.oznacz_blad(False)

        operacja = self._zbierz_operacje()
        rownolegle = self._zbierz_rownolegle()

        wynik = self.kartoteka.dodaj(
            operacja,
            rownolegle,
            surowiec=self.p_surowiec.kontrolka.currentText().strip(),
            volumen_surowca=self.p_surowiec_vol.kontrolka.value(),
        )

        if wynik.walidacja is not None:
            pola = self._pola_wg_nazwy()
            for nazwa in wynik.walidacja.pola:
                if nazwa in pola:
                    pola[nazwa].oznacz_blad(True)
            QMessageBox.warning(
                self,
                "Nie można zapisać operacji",
                "Uzupełnij poniższe braki:\n\n" + wynik.walidacja.tekst(),
            )
            return

        if wynik.duplikat is not None:
            odpowiedz = QMessageBox.question(
                self,
                "Możliwy duplikat",
                "W kartotece jest już operacja o tych samych danych:\n\n"
                f"{wynik.duplikat.opis_skrocony()}\n\nZapisać mimo to?",
                QMessageBox.Yes | QMessageBox.No,
                QMessageBox.No,
            )
            if odpowiedz != QMessageBox.Yes:
                return
            wynik = self.kartoteka.dodaj(
                operacja,
                rownolegle,
                surowiec=self.p_surowiec.kontrolka.currentText().strip(),
                volumen_surowca=self.p_surowiec_vol.kontrolka.value(),
                pomin_duplikat=True,
            )

        opis = "\n".join("•  " + op.opis_skrocony() for op in wynik.zapisane)
        QMessageBox.information(
            self,
            "Operacja zapisana",
            f"Dopisano wierszy kartoteki: {len(wynik.zapisane)}\n\n{opis}",
        )

        self.przeladuj_slowniki()
        self.wyczysc()
        self.zapisano.emit()

    # ------------------------------------------------------------------
    #  Stan formularza
    # ------------------------------------------------------------------

    def przeladuj_slowniki(self) -> None:
        """Odświeża zawartość list rozwijanych ze słowników kartoteki."""
        slowniki = self.kartoteka.slowniki
        mapowanie = [
            (self.p_produkt, "PRODUKT"), (self.p_dostawca, "DOSTAWCA"),
            (self.p_odbiorca, "ODBIORCA"), (self.p_miejsce_zal, "MIEJSCE"),
            (self.p_miejsce_poch, "MIEJSCE"), (self.p_przewoznik, "PRZEWOZNIK"),
            (self.p_nr_rej, "POJAZD"), (self.p_utworzyl, "OPERATOR"),
            (self.p_rabanie, "RABANIE"), (self.p_deklaracja, "DEKLARACJA"),
            (self.p_zrebka, "ZREBKA"), (self.p_surowiec, "PRODUKT"),
            (self.p_r_produkt, "PRODUKT"), (self.p_r_odbiorca, "ODBIORCA"),
        ]
        for pole, klucz in mapowanie:
            kontrolka: QComboBox = pole.kontrolka
            biezaca = kontrolka.currentText()
            kontrolka.blockSignals(True)
            kontrolka.clear()
            kontrolka.addItems(slowniki.lista(klucz))
            kontrolka.setCurrentText(biezaca)
            kontrolka.blockSignals(False)

    def wyczysc(self) -> None:
        autor = self.p_utworzyl.kontrolka.currentText().strip()

        for pole in (self.p_produkt, self.p_dostawca, self.p_odbiorca, self.p_miejsce_zal,
                     self.p_miejsce_poch, self.p_przewoznik, self.p_nr_rej, self.p_rabanie,
                     self.p_deklaracja, self.p_zrebka, self.p_surowiec,
                     self.p_r_produkt, self.p_r_odbiorca):
            pole.kontrolka.setCurrentText("")
            pole.oznacz_blad(False)

        for pole in (self.p_volumen, self.p_cena_zakupu, self.p_cena_sprzedazy,
                     self.p_koszt_rabania, self.p_odleglosc, self.p_koszt_transportu,
                     self.p_surowiec_vol, self.p_r_volumen, self.p_r_cena):
            pole.kontrolka.setValue(0)
            pole.oznacz_blad(False)

        self.p_wz.kontrolka.setText("")
        self.p_uwagi.kontrolka.setText("")
        self.p_typ.kontrolka.setCurrentText(TypOperacji.ZAKUP.value)
        self.p_jednostka.kontrolka.setCurrentText("MP")
        self.p_magazynowane.kontrolka.setCurrentText("TAK")
        self.p_data.kontrolka.setDate(QDate.currentDate())
        self.p_data_zal.kontrolka.setDate(QDate.currentDate())
        self.p_stawka.kontrolka.setValue(self.kartoteka.ustawienia.stawka_km)

        for pole in (self.p_r_produkcja, self.p_r_sprzedaz, self.p_r_transport):
            pole.kontrolka.setCurrentText("NIE")
        self.p_r_jednostka.kontrolka.setCurrentText("MP")

        domyslny = self.kartoteka.ustawienia.tekst("DOMYSLNY_AUTOR")
        self.p_utworzyl.kontrolka.setCurrentText(autor or domyslny)

        self._dostosuj_do_typu()
        self._dostosuj_rownolegle()

    def wczytaj_z_operacji(self, operacja: Operacja) -> None:
        """Wypełnia formularz danymi istniejącej operacji (kopiowanie wpisu)."""
        self.wyczysc()

        self.p_typ.kontrolka.setCurrentText(operacja.typ.value)
        if operacja.data_zaladunku:
            self.p_data_zal.kontrolka.setDate(QDate(operacja.data_zaladunku))
        self.p_miejsce_zal.kontrolka.setCurrentText(operacja.miejsce_zaladunku)
        self.p_dostawca.kontrolka.setCurrentText(operacja.dostawca)
        self.p_odbiorca.kontrolka.setCurrentText(operacja.odbiorca)
        self.p_wz.kontrolka.setText(operacja.nr_wz)
        self.p_magazynowane.kontrolka.setCurrentText("TAK" if operacja.czy_magazynowane else "NIE")
        self.p_deklaracja.kontrolka.setCurrentText(operacja.deklaracja)
        self.p_produkt.kontrolka.setCurrentText(operacja.produkt)
        self.p_volumen.kontrolka.setValue(abs(operacja.volumen))
        self.p_jednostka.kontrolka.setCurrentText(operacja.jednostka)
        self.p_cena_zakupu.kontrolka.setValue(operacja.cena_zakupu)
        self.p_cena_sprzedazy.kontrolka.setValue(operacja.cena_sprzedazy)
        self.p_zrebka.kontrolka.setCurrentText(operacja.rodzaj_zrebki)
        self.p_rabanie.kontrolka.setCurrentText(operacja.rabanie)
        self.p_koszt_rabania.kontrolka.setValue(abs(operacja.koszt_rabania))
        self.p_przewoznik.kontrolka.setCurrentText(operacja.przewoznik)
        self.p_nr_rej.kontrolka.setCurrentText(operacja.nr_rejestracyjny)
        self.p_odleglosc.kontrolka.setValue(operacja.odleglosc)
        self.p_stawka.kontrolka.setValue(operacja.stawka_km or self.kartoteka.ustawienia.stawka_km)
        self.p_miejsce_poch.kontrolka.setCurrentText(operacja.miejsce_pochodzenia)

        self._dostosuj_do_typu()

    def odswiez(self) -> None:
        self.przeladuj_slowniki()
        if self.p_stawka.kontrolka.value() <= 0:
            self.p_stawka.kontrolka.setValue(self.kartoteka.ustawienia.stawka_km)
        self.guzik_zapisz.setEnabled(not self.kartoteka.tylko_odczyt)
        self._przelicz_wartosc()
