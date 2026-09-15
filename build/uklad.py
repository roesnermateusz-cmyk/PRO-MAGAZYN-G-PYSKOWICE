"""Definicja ukladu skoroszytu PRO-MAGAZYN.

Wydzielona z generatora, zeby zmiana ukladu ekranu nie wymagala grzebania
w kodzie budujacym plik.
"""

from __future__ import annotations

# --- Kartoteka: naglowki kolumn wypelnianych przez silnik (1-30) -----------
KOLUMNY_DANE = [
    "Data załadunku",
    "Miejsce załadunku",
    "Data operacji",
    "Dostawca",
    "Typ operacji",
    "Nr WZ",
    "Czy magazynowane",
    "Deklaracja/KZR",
    "Volumen",
    "Jednostka miary",
    "Cena zakupu/produkcji",
    "Wartość",
    "Cena sprzedaży",
    "Produkt",
    "Rodzaj zrębki",
    "Rąbanie (kto)",
    "Koszt rąbania",
    "Przewoźnik",
    "Nr rejestracyjny",
    "Odległość km",
    "Stawka zł/km",
    "Koszt transportu",
    "Odbiorca",
    "Miejsce pochodzenia",
    "Uwagi",
    "Utworzył",
    "Data dodania wpisu",
    "ID operacji",
    "ID powiązania",
    "Status",
]

# --- Kartoteka: kolumny wyliczane formulami (31-43) ------------------------
# (naglowek, szablon formuly z {r} = numer wiersza, format liczbowy)
KOLUMNY_WYLICZANE = [
    (
        "Wolumen_MP",
        '=IF(I{r}="",0,IF(ISNUMBER(SEARCH("MP",UPPER(J{r}))),I{r},'
        'IF(ISNUMBER(SEARCH("TON",UPPER(J{r}))),I{r}/Przelicznik_MP_tona,'
        'IF(ISNUMBER(SEARCH("M3",UPPER(J{r}))),I{r}*Przelicznik_M3_MP,'
        'IF(ISNUMBER(SEARCH("GJ",UPPER(J{r}))),I{r}/Przelicznik_GJ_tona/Przelicznik_MP_tona,'
        "I{r})))))",
        "# ##0.000",
    ),
    (
        "Wolumen_t",
        # POPRAWKA: M3 przeliczane przez MP, a nie traktowane jak MP.
        '=IF(I{r}="",0,IF(ISNUMBER(SEARCH("TON",UPPER(J{r}))),I{r},'
        'IF(ISNUMBER(SEARCH("GJ",UPPER(J{r}))),I{r}/Przelicznik_GJ_tona,'
        "AE{r}*Przelicznik_MP_tona)))",
        "# ##0.000",
    ),
    ("Wolumen_GJ", "=AF{r}*Przelicznik_GJ_tona", "# ##0.000"),
    (
        "Ruch_magazyn_MP",
        '=IF(UPPER(AD{r})="SKORYGOWANY",0,'
        'IF(OR(UPPER(E{r})="TRANSPORT",UPPER(E{r})="MM"),0,'
        'IF(UPPER(G{r})<>"TAK",0,'
        'IF(OR(UPPER(E{r})="ZAKUP",UPPER(E{r})="PRODUKCJA"),AE{r},'
        'IF(OR(UPPER(E{r})="SPRZEDAŻ",UPPER(E{r})="ZUŻYCIE"),-AE{r},0)))))',
        "# ##0.000",
    ),
    (
        "Ruch_magazyn_t",
        '=IF(UPPER(AD{r})="SKORYGOWANY",0,'
        'IF(OR(UPPER(E{r})="TRANSPORT",UPPER(E{r})="MM"),0,'
        'IF(UPPER(G{r})<>"TAK",0,'
        'IF(OR(UPPER(E{r})="ZAKUP",UPPER(E{r})="PRODUKCJA"),AF{r},'
        'IF(OR(UPPER(E{r})="SPRZEDAŻ",UPPER(E{r})="ZUŻYCIE"),-AF{r},0)))))',
        "# ##0.000",
    ),
    (
        "Wartość_zakupu_zł",
        # POPRAWKA: mnozymy przez wolumen w jednostce ceny (I), nie po przeliczeniu na MP.
        '=IF(UPPER(AD{r})="SKORYGOWANY",0,IF(UPPER(E{r})="ZAKUP",'
        'IF(L{r}<>"",L{r},I{r}*K{r}),0))',
        "# ##0.00 zł",
    ),
    (
        "Wartość_sprzedaży_zł",
        '=IF(UPPER(AD{r})="SKORYGOWANY",0,IF(UPPER(E{r})="SPRZEDAŻ",'
        'IF(L{r}<>"",L{r},I{r}*M{r}),0))',
        "# ##0.00 zł",
    ),
    ("Koszt_rąbania_total", "=AE{r}*Q{r}", "# ##0.00 zł"),
    (
        "Typ_transportu",
        # POPRAWKA: rozpoznaje przewoznikow zapisanych jako "własny (...)".
        '=IF(R{r}="","",IF(LOWER(R{r})="brak","Brak",'
        'IF(OR(ISNUMBER(SEARCH("własn",LOWER(R{r}))),ISNUMBER(SEARCH("wlasn",LOWER(R{r}))),'
        'ISNUMBER(SEARCH("wojciechowski",LOWER(R{r})))),"Własny","Zewnętrzny")))',
        "General",
    ),
    ("Rok", '=IF(C{r}="","",YEAR(C{r}))', "0"),
    ("Miesiąc_nr", '=IF(C{r}="","",MONTH(C{r}))', "0"),
    ("Miesiąc_tekst", '=IF(C{r}="","",UPPER(TEXT(C{r},"mmmm")))', "General"),
    ("Kwartał", '=IF(C{r}="","","Q"&ROUNDUP(MONTH(C{r})/3,0))', "General"),
]

# --- Formularz: uklad ekranu ----------------------------------------------
# ("section", etykieta) | ("field", klucz, etykieta, podpowiedz, format) | ("blank",)
FORMULARZ = [
    ("section", "DANE PODSTAWOWE"),
    ("field", "TYP", "Typ operacji *", "ZAKUP / SPRZEDAŻ / PRODUKCJA / ZUŻYCIE / MM / TRANSPORT", "General"),
    ("field", "DATA_OP", "Data operacji *", "format dd.mm.rrrr", "dd.mm.yyyy"),
    ("field", "DATA_ZAL", "Data załadunku u klienta", "opcjonalna", "dd.mm.yyyy"),
    ("field", "NR_WZ", "Nr WZ / PZ", "przycisk podpowiada kolejny wolny numer", "General"),
    ("field", "UTWORZYL", "Utworzył *", "imię i nazwisko - z listy albo wpisz własne", "General"),
    ("blank",),
    ("section", "TOWAR"),
    ("field", "PRODUKT", "Produkt *", "lista rozwijana ze słownika", "General"),
    ("field", "VOLUMEN", "Wolumen *", "liczba większa od zera", "# ##0.000"),
    ("field", "JEDNOSTKA", "Jednostka miary *", "MP / TON / M3 / GJ", "General"),
    ("field", "CENA_ZAKUPU", "Cena zakupu/produkcji", "zł za jednostkę", "# ##0.00 zł"),
    ("field", "CENA_SPRZEDAZY", "Cena sprzedaży", "zł za jednostkę", "# ##0.00 zł"),
    ("field", "WARTOSC", "Wartość operacji", "wyliczana automatycznie", "# ##0.00 zł"),
    ("field", "CZY_MAG", "Czy magazynowane", "TAK = operacja zmienia stan magazynu", "General"),
    ("field", "DEKLARACJA", "Deklaracja / KZR", "", "General"),
    ("field", "ZREBKA", "Rodzaj zrębki", "A / B", "General"),
    ("field", "RABANIE", "Rąbanie (kto)", "", "General"),
    ("field", "KOSZT_RABANIA", "Koszt rąbania [zł/MP]", "", "# ##0.00 zł"),
    ("blank",),
    ("section", "KONTRAHENCI I LOKALIZACJE"),
    ("field", "DOSTAWCA", "Dostawca / magazyn źródłowy *", "wybór podpowiada miejsce i produkt", "General"),
    ("field", "ODBIORCA", "Odbiorca / magazyn docelowy *", "", "General"),
    ("field", "MIEJSCE_ZAL", "Miejsce załadunku", "", "General"),
    ("field", "MIEJSCE_POCH", "Miejsce pochodzenia", "", "General"),
    ("field", "UWAGI", "Uwagi", "", "General"),
    ("blank",),
    ("section", "TRANSPORT   (koszt = odległość × stawka za km)"),
    ("field", "PRZEWOZNIK", "Przewoźnik", "wybór podpowiada pojazd i stawkę", "General"),
    ("field", "NR_REJ", "Nr rejestracyjny", "zapisywany wielkimi literami", "General"),
    ("field", "ODLEGLOSC", "Odległość [km]", "", "# ##0.00"),
    ("field", "STAWKA_KM", "Stawka [zł/km]", "domyślnie 5,00 zł - zmienisz w USTAWIENIACH", "# ##0.00 zł"),
    ("field", "KOSZT_TRANSPORTU", "Koszt transportu [zł]", "wyliczany automatycznie, można nadpisać", "# ##0.00 zł"),
    ("blank",),
    ("section", "PRODUKCJA SAMODZIELNA   (dla typu PRODUKCJA)"),
    ("field", "SUROWIEC", "Surowiec zużyty", "puste = wartość z USTAWIEŃ", "General"),
    ("field", "SUROWIEC_VOL", "Wolumen surowca", "puste = tyle co wolumen produkcji", "# ##0.000"),
    ("blank",),
    ("section", "OPERACJE RÓWNOLEGŁE   (tylko przy ZAKUPIE)"),
    ("field", "ROWN_PRODUKCJA", "Produkcja równoległa", "TAK / NIE", "General"),
    ("field", "ROWN_PRODUKT", "     Produkt wyjściowy", "", "General"),
    ("field", "ROWN_VOLUMEN", "     Wolumen produkcji", "", "# ##0.000"),
    ("field", "ROWN_JEDNOSTKA", "     Jednostka produkcji", "", "General"),
    ("field", "ROWN_SPRZEDAZ", "Sprzedaż równoległa", "TAK / NIE", "General"),
    ("field", "ROWN_ODBIORCA", "     Odbiorca końcowy", "", "General"),
    ("field", "ROWN_CENA", "     Cena sprzedaży", "", "# ##0.00 zł"),
    ("field", "ROWN_TRANSPORT", "Transport równoległy", "TAK / NIE - użyje danych z sekcji TRANSPORT", "General"),
]

# Pole formularza -> klucz slownika listy rozwijanej.
LISTY_FORMULARZA = {
    "TYP": "TYP_OPERACJI",
    "PRODUKT": "PRODUKT",
    "JEDNOSTKA": "JEDNOSTKA",
    "DOSTAWCA": "DOSTAWCA",
    "ODBIORCA": "ODBIORCA",
    "MIEJSCE_ZAL": "MIEJSCE",
    "MIEJSCE_POCH": "MIEJSCE",
    "CZY_MAG": "TAK_NIE",
    "DEKLARACJA": "DEKLARACJA",
    "ZREBKA": "ZREBKA",
    "RABANIE": "RABANIE",
    "UTWORZYL": "OPERATOR",
    "PRZEWOZNIK": "PRZEWOZNIK",
    "NR_REJ": "POJAZD",
    "SUROWIEC": "PRODUKT",
    "ROWN_PRODUKCJA": "TAK_NIE",
    "ROWN_PRODUKT": "PRODUKT",
    "ROWN_JEDNOSTKA": "JEDNOSTKA",
    "ROWN_SPRZEDAZ": "TAK_NIE",
    "ROWN_ODBIORCA": "ODBIORCA",
    "ROWN_TRANSPORT": "TAK_NIE",
}

# Kolumna kartoteki (1-based) -> klucz slownika. Realizuje wymaganie
# "listy rozwijane we wszystkich kolumnach".
LISTY_KARTOTEKI = {
    2: "MIEJSCE",
    4: "DOSTAWCA",
    5: "TYP_OPERACJI",
    7: "TAK_NIE",
    8: "DEKLARACJA",
    10: "JEDNOSTKA",
    14: "PRODUKT",
    15: "ZREBKA",
    16: "RABANIE",
    18: "PRZEWOZNIK",
    19: "POJAZD",
    23: "ODBIORCA",
    24: "MIEJSCE",
    26: "OPERATOR",
    30: "STATUS",
}

# --- Slownik: kolumny i wartosci stale -------------------------------------
SLOWNIKI = [
    ("TYP_OPERACJI", ["ZAKUP", "SPRZEDAŻ", "PRODUKCJA", "ZUŻYCIE", "MM", "TRANSPORT"]),
    ("PRODUKT", []),
    ("JEDNOSTKA", ["MP", "TON", "M3", "GJ"]),
    ("DOSTAWCA", []),
    ("ODBIORCA", []),
    ("MIEJSCE", []),
    ("PRZEWOZNIK", []),
    ("POJAZD", []),
    ("OPERATOR", []),
    ("TAK_NIE", ["TAK", "NIE"]),
    ("DEKLARACJA", ["Deklaracja", "KZR"]),
    ("ZREBKA", ["A", "B"]),
    ("RABANIE", ["własne", "ECO-Rest"]),
    ("STATUS", ["AKTYWNY", "SKORYGOWANY", "KOREKTA"]),
]

# --- Ustawienia systemu ----------------------------------------------------
USTAWIENIA = [
    ("FIRMA", "ResInvest Commodities", "Nazwa firmy drukowana na raportach"),
    ("MAGAZYN", "Magazyn Pyskowice", "Domyślna lokalizacja tego egzemplarza systemu"),
    ("STAWKA_TRANSPORT_KM", 5, "Stawka za kilometr transportu [zł/km]"),
    ("PRZELICZNIK_MP_TONA", 0.33, "Ile ton waży 1 metr przestrzenny"),
    ("PRZELICZNIK_M3_MP", 4, "Ile MP daje 1 m3"),
    ("PRZELICZNIK_GJ_TONA", 8.5, "Ile GJ energii daje 1 tona"),
    ("MAX_DNI_ROBOCZYCH_WSTECZ", 2, "Ile dni roboczych wstecz wolno wpisać operację (0 = bez limitu)"),
    ("MAX_DNI_WPRZOD", 30, "Ile dni w przód wolno wpisać operację (0 = bez limitu)"),
    ("FOLDER_KOPII", "", "Folder kopii zapasowych (puste = podfolder 'Kopie zapasowe')"),
    ("KOPIA_AUTOMATYCZNA", "TAK", "Kopia zapasowa przy pierwszym zapisie w danym dniu"),
    ("KOPIE_DO_ZACHOWANIA", 30, "Ile ostatnich kopii zapasowych zachować"),
    ("WYMAGAJ_POLA_UTWORZYL", "TAK", "Czy pole 'Utworzył' jest obowiązkowe"),
    ("OSTRZEGAJ_O_DUBLACH", "TAK", "Ostrzeganie przy powtórzonym numerze WZ"),
    ("DOMYSLNY_AUTOR", "", "Podpowiedź do pola 'Utworzył' (puste = użytkownik Windows)"),
    ("SUROWIEC_DOMYSLNY", "Zrzyna", "Surowiec zużywany automatycznie przy produkcji"),
    ("OSTATNIA_KOPIA", "", "Data ostatniej kopii automatycznej - uzupełniana przez system"),
]

# Nazwy zakresow uzywane w formulach kartoteki -> klucz ustawienia.
NAZWY_PRZELICZNIKOW = {
    "Przelicznik_MP_tona": "PRZELICZNIK_MP_TONA",
    "Przelicznik_M3_MP": "PRZELICZNIK_M3_MP",
    "Przelicznik_GJ_tona": "PRZELICZNIK_GJ_TONA",
    "Stawka_za_km": "STAWKA_TRANSPORT_KM",
}

NAGLOWKI_MAGAZYN = [
    "Lokalizacja",
    "Produkt",
    "Stan [MP]",
    "Stan [tony]",
    "Stan [GJ]",
    "Wartość zakupu",
    "Ostatnia operacja",
]

NAGLOWKI_RAPORT = [
    "Data",
    "Typ",
    "Produkt",
    "Wolumen",
    "JM",
    "Wartość",
    "Dostawca",
    "Odbiorca",
    "Przewoźnik",
    "Koszt transportu",
    "Nr WZ",
    "Utworzył",
    "Status",
]

NAGLOWKI_HISTORIA = ["LP", "Data i godzina", "Użytkownik", "Zdarzenie", "Typ operacji", "ID operacji", "Opis"]
