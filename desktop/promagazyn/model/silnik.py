"""Silnik operacji magazynowych.

Odpowiada za przeliczenia (wartość operacji, koszt transportu),
generowanie operacji równoległych oraz korekty metodą storno.
"""

from __future__ import annotations

from datetime import date, datetime

from .operacja import Operacja, OperacjeRownolegle, Status, TypOperacji
from .ustawienia import Ustawienia

_licznik_id = 0


def _nowy_identyfikator(prefiks: str) -> str:
    global _licznik_id
    _licznik_id = (_licznik_id + 1) % 1000
    return f"{prefiks}-{datetime.now():%Y%m%d-%H%M%S}-{_licznik_id:03d}"


def nowy_id_operacji() -> str:
    return _nowy_identyfikator("OP")


def nowy_id_powiazania() -> str:
    return _nowy_identyfikator("PW")


def zaokraglij_kwote(wartosc: float) -> float:
    return round(wartosc + (1e-9 if wartosc >= 0 else -1e-9), 2)


def zaokraglij_ilosc(wartosc: float) -> float:
    return round(wartosc + (1e-9 if wartosc >= 0 else -1e-9), 3)


# ----------------------------------------------------------------------
#  Przeliczenia
# ----------------------------------------------------------------------


def przelicz_transport(op: Operacja, ust: Ustawienia, wymus: bool = False) -> Operacja:
    """Uzupełnia stawkę i koszt transportu: koszt = odległość × stawka.

    Koszt wpisany ręcznie ma pierwszeństwo, chyba że wymuszono przeliczenie.
    """
    stawka = op.stawka_km if op.stawka_km > 0 else ust.stawka_km
    koszt = op.koszt_transportu

    if op.odleglosc > 0 and (koszt <= 0 or wymus):
        koszt = zaokraglij_kwote(op.odleglosc * stawka)

    return op.kopia(stawka_km=stawka, koszt_transportu=koszt)


def wartosc_operacji(op: Operacja) -> float:
    """Wylicza wartość operacji zgodnie z jej typem.

    Wartość liczona jest wprost z liczb - w wersji 1.x odczytywano ją
    ze sformatowanej etykiety, przez co do arkusza trafiało zero.
    """
    if op.typ is TypOperacji.ZAKUP:
        return zaokraglij_kwote(op.volumen * op.cena_zakupu)
    if op.typ is TypOperacji.SPRZEDAZ:
        return zaokraglij_kwote(op.volumen * op.cena_sprzedazy)
    if op.typ is TypOperacji.TRANSPORT:
        return zaokraglij_kwote(op.koszt_transportu)
    return 0.0


def przygotuj(op: Operacja, ust: Ustawienia) -> Operacja:
    """Normalizuje operację przed zapisem: przelicza transport i wartość."""
    gotowa = przelicz_transport(op, ust)
    gotowa = gotowa.kopia(
        nr_rejestracyjny=" ".join(gotowa.nr_rejestracyjny.upper().split()),
        jednostka=gotowa.jednostka.strip().upper(),
        volumen=zaokraglij_ilosc(gotowa.volumen),
        cena_zakupu=zaokraglij_kwote(gotowa.cena_zakupu),
        cena_sprzedazy=zaokraglij_kwote(gotowa.cena_sprzedazy),
        koszt_rabania=zaokraglij_kwote(gotowa.koszt_rabania),
    )
    return gotowa.kopia(wartosc=wartosc_operacji(gotowa))


# ----------------------------------------------------------------------
#  Operacje równoległe
# ----------------------------------------------------------------------


def zbuduj_lancuch(op: Operacja, rown: OperacjeRownolegle, ust: Ustawienia) -> list[Operacja]:
    """Zwraca komplet operacji do zapisania: główną i równoległe.

    Wszystkie wiersze łańcucha dostają wspólne ID powiązania, a towar
    przechodzący tranzytem jest oznaczany jako niemagazynowany, żeby
    nie został policzony dwa razy.
    """
    id_powiazania = nowy_id_powiazania() if rown.cokolwiek else ""

    glowna = op.kopia(id_powiazania=id_powiazania)
    if rown.produkcja or rown.sprzedaz:
        glowna = glowna.kopia(czy_magazynowane=False)
    wynik = [przygotuj(glowna, ust)]

    if rown.produkcja:
        wynik.append(
            przygotuj(
                op.kopia(
                    typ=TypOperacji.PRODUKCJA,
                    produkt=rown.produkt_produkcji,
                    volumen=rown.volumen_produkcji,
                    jednostka=rown.jednostka_produkcji,
                    cena_zakupu=0.0,
                    cena_sprzedazy=0.0,
                    czy_magazynowane=not rown.sprzedaz,
                    uwagi="Produkcja z surowca zakupionego w tej samej operacji",
                    id_powiazania=id_powiazania,
                ),
                ust,
            )
        )
        wynik.append(
            przygotuj(
                op.kopia(
                    typ=TypOperacji.ZUZYCIE,
                    cena_zakupu=0.0,
                    cena_sprzedazy=0.0,
                    czy_magazynowane=False,
                    uwagi="Automatyczne zużycie surowca do produkcji",
                    id_powiazania=id_powiazania,
                ),
                ust,
            )
        )

    if rown.sprzedaz:
        if rown.produkcja:
            produkt, volumen, jednostka = (
                rown.produkt_produkcji,
                rown.volumen_produkcji,
                rown.jednostka_produkcji,
            )
        else:
            produkt, volumen, jednostka = op.produkt, op.volumen, op.jednostka

        wynik.append(
            przygotuj(
                op.kopia(
                    typ=TypOperacji.SPRZEDAZ,
                    dostawca=op.odbiorca,
                    odbiorca=rown.odbiorca_sprzedazy,
                    produkt=produkt,
                    volumen=volumen,
                    jednostka=jednostka,
                    cena_zakupu=0.0,
                    cena_sprzedazy=rown.cena_sprzedazy,
                    czy_magazynowane=False,
                    uwagi="Sprzedaż bezpośrednia powiązana z zakupem",
                    id_powiazania=id_powiazania,
                ),
                ust,
            )
        )

    if rown.transport:
        transport = op.kopia(
            typ=TypOperacji.TRANSPORT,
            czy_magazynowane=False,
            produkt="",
            volumen=0.0,
            jednostka="",
            cena_zakupu=0.0,
            cena_sprzedazy=0.0,
            koszt_rabania=0.0,
            przewoznik=rown.przewoznik or op.przewoznik,
            nr_rejestracyjny=rown.nr_rejestracyjny or op.nr_rejestracyjny,
            odleglosc=rown.odleglosc or op.odleglosc,
            stawka_km=rown.stawka_km or op.stawka_km,
            koszt_transportu=rown.koszt_transportu,
            id_powiazania=id_powiazania,
        )
        # Koszt liczymy z kilometrów, chyba że podano go ręcznie.
        transport = przelicz_transport(transport, ust, wymus=transport.koszt_transportu <= 0)
        transport = transport.kopia(
            uwagi=(
                f"Transport powiązany z operacją {op.typ.value} "
                f"({transport.odleglosc:g} km × {transport.stawka_km:.2f} zł/km)"
            )
        )
        wynik.append(przygotuj(transport, ust))

    return wynik


def zbuduj_produkcje_samodzielna(
    op: Operacja, surowiec: str, volumen_surowca: float, ust: Ustawienia
) -> list[Operacja]:
    """Produkcja wprowadzona wprost - system dopisuje zużycie surowca."""
    id_powiazania = nowy_id_powiazania()
    surowiec = surowiec.strip() or ust.surowiec_domyslny
    volumen_surowca = volumen_surowca if volumen_surowca > 0 else op.volumen

    glowna = przygotuj(op.kopia(typ=TypOperacji.PRODUKCJA, id_powiazania=id_powiazania), ust)
    zuzycie = przygotuj(
        op.kopia(
            typ=TypOperacji.ZUZYCIE,
            produkt=surowiec,
            volumen=volumen_surowca,
            cena_zakupu=0.0,
            cena_sprzedazy=0.0,
            czy_magazynowane=False,
            uwagi="Automatyczne zużycie surowca do produkcji",
            id_powiazania=id_powiazania,
        ),
        ust,
    )
    return [glowna, zuzycie]


def zbuduj_storno(op: Operacja, powod: str, uzytkownik: str) -> Operacja:
    """Tworzy wpis odwracający skutki wskazanej operacji."""
    return op.kopia(
        volumen=-op.volumen,
        wartosc=-op.wartosc,
        koszt_transportu=-op.koszt_transportu,
        koszt_rabania=-op.koszt_rabania,
        status=Status.KOREKTA,
        id_operacji="",
        id_powiazania=op.id_operacji,
        utworzyl=uzytkownik or op.utworzyl,
        uwagi=f"KOREKTA (storno) wpisu {op.id_operacji}. Powód: {powod}",
    )
