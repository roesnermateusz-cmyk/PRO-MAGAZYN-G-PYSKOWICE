#!/usr/bin/env python3
"""Testy aplikacji PRO-MAGAZYN.

Uruchomienie:  python3 desktop/testy/test_promagazyn.py
"""

from __future__ import annotations

import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

KORZEN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(KORZEN))

from promagazyn.dane import csv_io, odczyt  # noqa: E402
from promagazyn.dane.blokada import Blokada  # noqa: E402
from promagazyn.dane.kartoteka import Kartoteka  # noqa: E402
from promagazyn.model import magazyn, raporty  # noqa: E402
from promagazyn.model.jednostki import na_mp, na_tony  # noqa: E402
from promagazyn.model.operacja import Operacja, OperacjeRownolegle, Status, TypOperacji  # noqa: E402
from promagazyn.model.silnik import przelicz_transport, wartosc_operacji, zbuduj_lancuch  # noqa: E402
from promagazyn.model.slowniki import Podpowiedzi, Slowniki  # noqa: E402
from promagazyn.model.ustawienia import Ustawienia  # noqa: E402
from promagazyn.model.walidacja import sprawdz  # noqa: E402

BLEDY: list[str] = []
UST = Ustawienia()


def sprawdz_ze(warunek: bool, opis: str) -> None:
    print(f"  [{'OK  ' if warunek else 'BLAD'}] {opis}")
    if not warunek:
        BLEDY.append(opis)


def rowne(a: float, b: float, tolerancja: float = 0.01) -> bool:
    return abs(a - b) <= tolerancja


def przyklad(**zmiany) -> Operacja:
    podstawa = dict(
        typ=TypOperacji.ZAKUP,
        data_operacji=date.today(),
        produkt="Drewno opałowe z lasu",
        volumen=100.0,
        jednostka="MP",
        cena_zakupu=78.0,
        dostawca="Lander Agro",
        odbiorca="Magazyn Zabrze",
        utworzyl="Roesner Mateusz",
    )
    podstawa.update(zmiany)
    return Operacja(**podstawa)


# ----------------------------------------------------------------------


def test_jednostki() -> None:
    print("Przeliczniki jednostek")
    sprawdz_ze(rowne(na_mp(10, "MP", UST), 10), "MP bez zmian")
    sprawdz_ze(rowne(na_mp(10, "TON", UST), 30.303), "tony na MP")
    sprawdz_ze(rowne(na_mp(10, "M3", UST), 40), "m3 na MP (x4)")
    # Poprawka: m3 idzie przez MP, a nie jak MP.
    sprawdz_ze(rowne(na_tony(10, "M3", UST), 13.2), "m3 na tony przez MP (40 x 0,33)")
    sprawdz_ze(rowne(na_tony(10, "MP", UST), 3.3), "MP na tony")


def test_wartosc_i_transport() -> None:
    print("Wartość operacji i koszt transportu")
    zakup = przyklad()
    sprawdz_ze(rowne(wartosc_operacji(zakup), 7800), "wartość zakupu = wolumen x cena")

    sprzedaz = przyklad(typ=TypOperacji.SPRZEDAZ, cena_zakupu=0, cena_sprzedazy=95)
    sprawdz_ze(rowne(wartosc_operacji(sprzedaz), 9500), "wartość sprzedaży")

    produkcja = przyklad(typ=TypOperacji.PRODUKCJA)
    sprawdz_ze(wartosc_operacji(produkcja) == 0, "produkcja bez wartości zakupu")

    transport = przelicz_transport(
        przyklad(typ=TypOperacji.TRANSPORT, odleglosc=150, stawka_km=0), UST
    )
    sprawdz_ze(rowne(transport.stawka_km, 5.0), "domyślna stawka 5 zł/km")
    sprawdz_ze(rowne(transport.koszt_transportu, 750), "koszt = 150 km x 5 zł")
    sprawdz_ze(rowne(wartosc_operacji(transport), 750), "wartość transportu = koszt przewozu")

    reczny = przelicz_transport(
        przyklad(typ=TypOperacji.TRANSPORT, odleglosc=150, koszt_transportu=600), UST
    )
    sprawdz_ze(rowne(reczny.koszt_transportu, 600), "ręczny koszt ma pierwszeństwo")


def test_lancuch_rownolegly() -> None:
    print("Operacje równoległe")
    rown = OperacjeRownolegle(
        produkcja=True, produkt_produkcji="Zrębka Produkcyjna Leśna",
        volumen_produkcji=95, jednostka_produkcji="MP",
        sprzedaz=True, odbiorca_sprzedazy="Re Alloys, Łaziska", cena_sprzedazy=110,
        transport=True, przewoznik="własny (Wilczak)", nr_rejestracyjny="sk 7j884",
        odleglosc=110,
    )
    lancuch = zbuduj_lancuch(przyklad(), rown, UST)

    sprawdz_ze(len(lancuch) == 5, f"powstaje 5 wierszy (jest {len(lancuch)})")
    typy = [op.typ for op in lancuch]
    sprawdz_ze(
        typy == [TypOperacji.ZAKUP, TypOperacji.PRODUKCJA, TypOperacji.ZUZYCIE,
                 TypOperacji.SPRZEDAZ, TypOperacji.TRANSPORT],
        "kolejność typów w łańcuchu",
    )
    sprawdz_ze(
        len({op.id_powiazania for op in lancuch}) == 1 and lancuch[0].id_powiazania != "",
        "wspólny identyfikator powiązania",
    )
    sprawdz_ze(
        all(not op.czy_magazynowane for op in lancuch),
        "towar tranzytowy nie wchodzi na stan",
    )
    sprawdz_ze(rowne(lancuch[4].koszt_transportu, 550), "transport 110 km x 5 zł = 550 zł")
    sprawdz_ze(lancuch[4].nr_rejestracyjny == "SK 7J884", "numer rejestracyjny wielkimi literami")
    sprawdz_ze(rowne(lancuch[3].wartosc, 95 * 110), "sprzedaż liczona z wolumenu produkcji")

    # Łańcuch musi się bilansować: przychód minus rozchód = 0.
    stany = magazyn.policz_stany(lancuch, UST)
    sprawdz_ze(
        all(abs(p.mp) < 0.001 for p in stany) or not stany,
        "łańcuch tranzytowy nie zmienia stanu magazynu",
    )


def test_magazyn() -> None:
    print("Stany magazynowe")
    operacje = [
        przyklad(volumen=100, czy_magazynowane=True),
        przyklad(typ=TypOperacji.MM, dostawca="Magazyn Zabrze",
                 odbiorca="Magazyn Pyskowice", volumen=40, czy_magazynowane=True),
    ]
    stany = {(p.lokalizacja, p.produkt): p.mp for p in magazyn.policz_stany(operacje, UST)}
    sprawdz_ze(rowne(stany.get(("Magazyn Zabrze", "Drewno opałowe z lasu"), 0), 60),
               "MM zdejmuje towar z magazynu źródłowego")
    sprawdz_ze(rowne(stany.get(("Magazyn Pyskowice", "Drewno opałowe z lasu"), 0), 40),
               "MM dokłada towar do magazynu docelowego")

    # Ta sama lokalizacja po obu stronach nie może liczyć się dwa razy.
    ta_sama = [przyklad(dostawca="Magazyn Zabrze", odbiorca="Magazyn Zabrze", volumen=50)]
    suma = sum(p.mp for p in magazyn.policz_stany(ta_sama, UST))
    sprawdz_ze(rowne(suma, 50), f"dostawca = odbiorca liczone raz (jest {suma})")

    # Transport nie rusza stanu.
    transport = [przyklad(typ=TypOperacji.TRANSPORT, odleglosc=100, volumen=0)]
    sprawdz_ze(not magazyn.policz_stany(transport, UST), "TRANSPORT nie zmienia stanu")

    # Wiersz skorygowany jest pomijany.
    skorygowany = [przyklad(volumen=100, status=Status.SKORYGOWANY)]
    sprawdz_ze(not magazyn.policz_stany(skorygowany, UST), "wiersz SKORYGOWANY pomijany")


def test_walidacja() -> None:
    print("Walidacja")
    sprawdz_ze(sprawdz(przyklad(), UST).poprawne, "poprawny zakup przechodzi")

    bez_autora = sprawdz(przyklad(utworzyl=""), UST)
    sprawdz_ze(not bez_autora.poprawne and "utworzyl" in bez_autora.pola,
               "brak pola Utworzył jest wykrywany")

    transport = sprawdz(przyklad(typ=TypOperacji.TRANSPORT, volumen=0, produkt=""), UST)
    sprawdz_ze(not transport.poprawne and "przewoznik" in transport.pola,
               "TRANSPORT wymaga przewoźnika")

    dobry_transport = sprawdz(
        przyklad(typ=TypOperacji.TRANSPORT, volumen=0, produkt="",
                 przewoznik="Nowatrans", nr_rejestracyjny="WND 3546F", odleglosc=80),
        UST,
    )
    sprawdz_ze(dobry_transport.poprawne, "kompletny TRANSPORT przechodzi")

    mm = sprawdz(przyklad(typ=TypOperacji.MM, dostawca="A", odbiorca="A"), UST)
    sprawdz_ze(not mm.poprawne, "MM z tym samym magazynem po obu stronach odrzucone")

    stara = sprawdz(przyklad(data_operacji=date.today() - timedelta(days=60)), UST)
    sprawdz_ze(not stara.poprawne, "zbyt stara data odrzucona")

    sprzedaz = sprawdz(przyklad(typ=TypOperacji.SPRZEDAZ, cena_zakupu=0), UST)
    sprawdz_ze(not sprzedaz.poprawne, "sprzedaż bez ceny odrzucona")


def test_raporty() -> None:
    print("Raporty")
    sprawdz_ze(raporty.typ_transportu("własny (Wilczak)") == "Własny",
               "przewoźnik własny rozpoznany")
    sprawdz_ze(raporty.typ_transportu("Nowatrans") == "Zewnętrzny",
               "przewoźnik zewnętrzny rozpoznany")
    sprawdz_ze(raporty.typ_transportu("brak") == "Brak", "wartość „brak” rozpoznana")

    operacje = [przyklad(), przyklad(typ=TypOperacji.SPRZEDAZ, cena_zakupu=0, cena_sprzedazy=95)]
    for operacja in operacje:
        operacja.wartosc = wartosc_operacji(operacja)
    podsumowanie = raporty.podsumuj(operacje, UST)
    sprawdz_ze(rowne(podsumowanie.zakup, 7800) and rowne(podsumowanie.sprzedaz, 9500),
               "podsumowanie rozdziela zakup i sprzedaż")
    sprawdz_ze(rowne(podsumowanie.marza, 1700), "marża = sprzedaż - zakup - koszty")


def test_podpowiedzi() -> None:
    print("Autouzupełnianie")
    historia = [
        przyklad(przewoznik="własny (Wilczak)", nr_rejestracyjny="SK 7J884",
                 stawka_km=5, miejsce_zaladunku="Chrzanów", nr_wz="PZ/128"),
        przyklad(przewoznik="własny (Wilczak)", nr_rejestracyjny="SK 7J884", stawka_km=5),
        przyklad(przewoznik="własny (Wilczak)", nr_rejestracyjny="SK 5L809", stawka_km=6),
    ]
    podpowiedzi = Podpowiedzi(historia)
    sprawdz_ze(podpowiedzi.pojazd_przewoznika("własny (Wilczak)") == "SK 7J884",
               "najczęstszy pojazd przewoźnika")
    sprawdz_ze(rowne(podpowiedzi.stawka_przewoznika("własny (Wilczak)"), 6),
               "ostatnia stawka przewoźnika")
    sprawdz_ze(podpowiedzi.miejsce_dostawcy("Lander Agro") == "Chrzanów",
               "miejsce załadunku dostawcy")
    sprawdz_ze(podpowiedzi.nastepny_numer_wz("PZ") == "PZ/129", "kolejny numer WZ")


def test_obieg_pliku() -> None:
    print("Zapis i odczyt pliku Excela")
    with tempfile.TemporaryDirectory() as katalog:
        sciezka = Path(katalog) / "dane.xlsx"

        kartoteka = Kartoteka()
        kartoteka.utworz_nowa(sciezka)
        sprawdz_ze(sciezka.exists(), "plik danych powstaje")

        wynik = kartoteka.dodaj(
            przyklad(nr_wz="PZ/1"),
            OperacjeRownolegle(transport=True, przewoznik="Nowatrans",
                               nr_rejestracyjny="WND 3546F", odleglosc=64),
        )
        sprawdz_ze(len(wynik.zapisane) == 2, f"zakup + transport = 2 wiersze (jest {len(wynik.zapisane)})")
        kartoteka.zapisz()

        # Duplikat musi zostać wykryty.
        powtorka = kartoteka.dodaj(przyklad(nr_wz="PZ/1"))
        sprawdz_ze(powtorka.duplikat is not None, "duplikat numeru WZ wykryty")

        # Korekta: wiersz pierwotny zostaje, dopisywane jest storno.
        pierwotny = kartoteka.operacje[0]
        storno = kartoteka.koryguj(pierwotny, "test")
        sprawdz_ze(pierwotny.status is Status.SKORYGOWANY, "wiersz oznaczony jako skorygowany")
        sprawdz_ze(rowne(storno.volumen, -100), "storno ma odwrotny wolumen")
        kartoteka.zapisz()
        kartoteka.zwolnij_blokade()

        # Odczyt ponowny musi odtworzyć wszystko.
        druga = Kartoteka()
        druga.otworz(sciezka)
        sprawdz_ze(len(druga.operacje) == 3, f"odczytano 3 operacje (jest {len(druga.operacje)})")
        sprawdz_ze(
            any(op.typ is TypOperacji.TRANSPORT and rowne(op.koszt_transportu, 320)
                for op in druga.operacje),
            "transport 64 km x 5 zł = 320 zł przetrwał zapis",
        )
        sprawdz_ze(
            sum(1 for op in druga.operacje if op.status is Status.SKORYGOWANY) == 1,
            "status SKORYGOWANY przetrwał zapis",
        )
        sprawdz_ze(len(druga.dziennik) >= 4, "dziennik zdarzeń przetrwał zapis")
        sprawdz_ze(rowne(druga.ustawienia.stawka_km, 5.0), "ustawienia przetrwały zapis")
        druga.zwolnij_blokade()


def test_blokada() -> None:
    print("Blokada pliku na dysku sieciowym")
    with tempfile.TemporaryDirectory() as katalog:
        plik = Path(katalog) / "dane.xlsx"
        plik.write_text("x")

        pierwsza, druga = Blokada(plik), Blokada(plik)
        sprawdz_ze(pierwsza.zajmij(), "pierwsze stanowisko zajmuje blokadę")
        sprawdz_ze(not druga.zajmij(), "drugie stanowisko nie przejmuje blokady")
        sprawdz_ze(pierwsza.informacje() is not None, "blokada mówi, kto ją trzyma")
        pierwsza.zwolnij()
        sprawdz_ze(druga.zajmij(), "po zwolnieniu blokada jest dostępna")
        druga.zwolnij()


def test_csv() -> None:
    print("Import i eksport CSV")
    with tempfile.TemporaryDirectory() as katalog:
        sciezka = Path(katalog) / "kartoteka.csv"
        zrodlo = [
            przyklad(nr_wz="PZ/1"),
            przyklad(typ=TypOperacji.TRANSPORT, produkt="", volumen=0,
                     przewoznik="Nowatrans", nr_rejestracyjny="WND 3546F",
                     odleglosc=64, stawka_km=5, koszt_transportu=320),
        ]
        csv_io.zapisz(sciezka, zrodlo)
        wczytane, pominiete = csv_io.wczytaj(sciezka)

        sprawdz_ze(len(wczytane) == 2, f"obieg CSV zachowuje operacje (jest {len(wczytane)})")
        sprawdz_ze(not pominiete, "żaden wiersz nie został pominięty")
        sprawdz_ze(wczytane[1].typ is TypOperacji.TRANSPORT, "typ TRANSPORT przetrwał CSV")
        sprawdz_ze(rowne(wczytane[1].koszt_transportu, 320), "koszt transportu przetrwał CSV")


def test_zgodnosc_ze_skoroszytem() -> None:
    print("Zgodność z plikiem skoroszytu z makrami")
    skoroszyt = KORZEN.parent / "dist" / "PRO-MAGAZYN.xlsm"
    if not skoroszyt.exists():
        print("  [----] pominięto - brak dist/PRO-MAGAZYN.xlsm")
        return

    operacje, slowniki, ustawienia, _ = odczyt.wczytaj(skoroszyt)
    sprawdz_ze(len(operacje) == 577, f"odczytano 577 operacji (jest {len(operacje)})")

    stany = magazyn.policz_stany(operacje, ustawienia)
    suma = sum(p.mp for p in stany)
    sprawdz_ze(rowne(suma, 35736.71, 0.5), f"stan globalny 35 736,71 MP (jest {suma:.2f})")
    sprawdz_ze(len(slowniki.lista("OPERATOR")) >= 2, "słownik operatorów wczytany")
    sprawdz_ze(rowne(ustawienia.stawka_km, 5.0), "stawka transportu z pliku")


def main() -> int:
    for test in (
        test_jednostki, test_wartosc_i_transport, test_lancuch_rownolegly, test_magazyn,
        test_walidacja, test_raporty, test_podpowiedzi, test_obieg_pliku, test_blokada,
        test_csv, test_zgodnosc_ze_skoroszytem,
    ):
        test()

    print()
    if BLEDY:
        print(f"NIEPOWODZENIE: {len(BLEDY)} test(ow)")
        for blad in BLEDY:
            print("  -", blad)
        return 1
    print("Wszystkie testy przeszly.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
