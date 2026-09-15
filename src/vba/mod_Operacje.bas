Option Explicit

' ======================================================================
'  PRO-MAGAZYN  |  mod_Operacje
'  Silnik zapisu operacji magazynowych.
'
'  Odpowiada za:
'   * przeliczenie wartości operacji i kosztu transportu,
'   * dopisanie wiersza do kartoteki w sposób bezpieczny dla danych,
'   * generowanie operacji równoległych (produkcja, sprzedaż, transport),
'   * powiązanie wygenerowanych wierszy wspólnym identyfikatorem.
'
'  POPRAWKI WZGLĘDEM POPRZEDNIEJ WERSJI
'  ------------------------------------
'  1. Nowy wiersz dopisuje ListObject.ListRows.Add zamiast wyliczania
'     "ostatniego wiersza" po kolumnie B. Kolumna B (Miejsce załadunku)
'     bywa pusta, przez co poprzedni kod potrafił nadpisać istniejące dane.
'  2. Wartość operacji liczona jest z liczb (wolumen * cena), a nie
'     parsowana z sformatowanej etykiety "1 234,56 zł" - tamta metoda
'     zwracała 0 dla każdej kwoty z separatorem tysięcy lub symbolem zł.
'  3. Każdy zapis jest transakcyjny: przy błędzie w połowie operacji
'     złożonej wszystkie dopisane wiersze są wycofywane.
' ======================================================================

' Parametry operacji równoległych wypełniane przez formularz.
Public Type OperacjeRownolegle
    Produkcja As Boolean
    ProduktProdukcji As String
    VolumenProdukcji As Double
    JednostkaProdukcji As String

    Sprzedaz As Boolean
    OdbiorcaSprzedazy As String
    CenaSprzedazy As Double

    Transport As Boolean
    Przewoznik As String
    NrRejestracyjny As String
    Odleglosc As Double
    StawkaKm As Double
    KosztTransportu As Double
End Type

' ----------------------------------------------------------------------
'  Przeliczenia
' ----------------------------------------------------------------------

' Uzupełnia koszt transportu: odległość * stawka za kilometr.
' Koszt wpisany ręcznie ma pierwszeństwo przed wyliczonym.
Public Sub PrzeliczTransport(ByRef op As Operacja, Optional ByVal wymusPrzeliczenie As Boolean = False)
    If op.StawkaKm <= 0 Then op.StawkaKm = StawkaZaKm()

    If op.Odleglosc > 0 Then
        If op.KosztTransportu <= 0 Or wymusPrzeliczenie Then
            op.KosztTransportu = ZaokraglijKwote(op.Odleglosc * op.StawkaKm)
        End If
    End If
End Sub

' Wylicza wartość operacji zgodnie z jej typem.
Public Function WartoscOperacji(ByRef op As Operacja) As Double
    Select Case UCase$(Trim$(op.Typ))
        Case UCase$(OP_ZAKUP)
            WartoscOperacji = ZaokraglijKwote(op.Volumen * op.CenaZakupu)
        Case UCase$(OP_SPRZEDAZ)
            WartoscOperacji = ZaokraglijKwote(op.Volumen * op.CenaSprzedazy)
        Case UCase$(OP_TRANSPORT)
            ' Operacja transportowa nie obraca towarem - jej wartością
            ' jest koszt usługi przewozu.
            WartoscOperacji = ZaokraglijKwote(op.KosztTransportu)
        Case Else
            ' PRODUKCJA, ZUŻYCIE, MM - ruch wewnętrzny bez wartości zakupu.
            WartoscOperacji = 0
    End Select
End Function

' ----------------------------------------------------------------------
'  Zapis pojedynczego wiersza
' ----------------------------------------------------------------------

' Dopisuje operację do kartoteki i zwraca numer dopisanego wiersza tabeli.
Public Function ZapiszWiersz(ByRef op As Operacja) As Long
    Dim tabela As ListObject
    Dim nowy As ListRow
    Dim idOperacji As String

    Set tabela = TabelaDanych()
    PrzeliczTransport op

    ' Zapis silnika prowadzimy z wyłączonymi zdarzeniami. Inaczej
    ' Worksheet_Change arkusza Dane potraktowałby go jak ręczną edycję
    ' i zaśmiecił dziennik zdarzeń fałszywymi wpisami.
    On Error GoTo Przywroc
    WylaczEkran

    ' ListRows.Add zawsze dopisuje na końcu tabeli - nie ma ryzyka
    ' nadpisania istniejących danych ani rozjechania formuł.
    Set nowy = tabela.ListRows.Add

    idOperacji = NowyIdOperacji()
    If Len(Trim$(op.Status)) = 0 Then op.Status = ST_AKTYWNY

    With nowy.Range
        If op.MaDateZaladunku Then .Cells(1, kolDataZaladunku).Value = op.DataZaladunku
        .Cells(1, kolMiejsceZaladunku).Value = op.MiejsceZaladunku
        .Cells(1, kolDataOperacji).Value = op.DataOperacji
        .Cells(1, kolDostawca).Value = op.Dostawca
        .Cells(1, kolTypOperacji).Value = UCase$(Trim$(op.Typ))
        .Cells(1, kolNrWZ).Value = op.NrWZ
        .Cells(1, kolCzyMagazynowane).Value = UCase$(op.CzyMagazynowane)
        .Cells(1, kolDeklaracja).Value = op.Deklaracja
        .Cells(1, kolVolumen).Value = ZaokraglijIlosc(op.Volumen)
        .Cells(1, kolJednostka).Value = UCase$(op.Jednostka)
        .Cells(1, kolCenaZakupu).Value = ZaokraglijKwote(op.CenaZakupu)
        .Cells(1, kolWartosc).Value = WartoscOperacji(op)
        .Cells(1, kolCenaSprzedazy).Value = ZaokraglijKwote(op.CenaSprzedazy)
        .Cells(1, kolProdukt).Value = op.Produkt
        .Cells(1, kolRodzajZrebki).Value = op.RodzajZrebki
        .Cells(1, kolRabanie).Value = op.Rabanie
        .Cells(1, kolKosztRabania).Value = ZaokraglijKwote(op.KosztRabania)
        .Cells(1, kolPrzewoznik).Value = op.Przewoznik
        .Cells(1, kolNrRejestracyjny).Value = NormalizujNrRejestracyjny(op.NrRejestracyjny)
        .Cells(1, kolOdleglosc).Value = op.Odleglosc
        .Cells(1, kolStawkaKm).Value = op.StawkaKm
        .Cells(1, kolKosztTransportu).Value = ZaokraglijKwote(op.KosztTransportu)
        .Cells(1, kolOdbiorca).Value = op.Odbiorca
        .Cells(1, kolMiejscePochodzenia).Value = op.MiejscePochodzenia
        .Cells(1, kolUwagi).Value = op.Uwagi
        .Cells(1, kolUtworzyl).Value = op.Utworzyl
        .Cells(1, kolDataDodania).Value = Now
        .Cells(1, kolIdOperacji).Value = idOperacji
        .Cells(1, kolIdPowiazania).Value = op.IdPowiazania
        .Cells(1, kolStatus).Value = op.Status
    End With

    ' Nowe wartości trafiają do słowników, żeby listy rozwijane były aktualne.
    UzupelnijSlownikiZOperacji op

    ZapisDoHistorii "DODANIE", idOperacji, op.Typ, op.Utworzyl, OpisOperacji(op)

    ZapiszWiersz = nowy.Index
    WlaczEkran
    Exit Function

Przywroc:
    ' Licznik zagnieżdżeń musi wrócić do równowagi, zanim błąd
    ' powędruje do procedury nadrzędnej.
    WlaczEkran
    Err.Raise Err.Number, "mod_Operacje.ZapiszWiersz", Err.Description
End Function

' Krótki, czytelny opis operacji - używany w dzienniku zdarzeń.
Public Function OpisOperacji(ByRef op As Operacja) As String
    Dim opis As String

    opis = UCase$(op.Typ) & " " & Format$(op.DataOperacji, "dd.mm.yyyy")

    If UCase$(op.Typ) = UCase$(OP_TRANSPORT) Then
        opis = opis & " | " & op.Przewoznik & " " & NormalizujNrRejestracyjny(op.NrRejestracyjny) & _
               " | " & Format$(op.Odleglosc, "0.##") & " km x " & Format$(op.StawkaKm, "0.00") & _
               " zł = " & TekstKwoty(op.KosztTransportu)
    Else
        opis = opis & " | " & op.Produkt & " " & Format$(op.Volumen, "0.###") & " " & op.Jednostka & _
               " | " & op.Dostawca & " -> " & op.Odbiorca
        If WartoscOperacji(op) > 0 Then opis = opis & " | " & TekstKwoty(WartoscOperacji(op))
    End If

    If Len(Trim$(op.NrWZ)) > 0 Then opis = opis & " | WZ: " & op.NrWZ

    OpisOperacji = opis
End Function

Private Sub UzupelnijSlownikiZOperacji(ByRef op As Operacja)
    DodajDoSlownika SL_PRODUKT, op.Produkt
    DodajDoSlownika SL_JEDNOSTKA, op.Jednostka
    DodajDoSlownika SL_DOSTAWCA, op.Dostawca
    DodajDoSlownika SL_ODBIORCA, op.Odbiorca
    DodajDoSlownika SL_MIEJSCE, op.MiejsceZaladunku
    DodajDoSlownika SL_MIEJSCE, op.MiejscePochodzenia
    DodajDoSlownika SL_PRZEWOZNIK, op.Przewoznik
    DodajDoSlownika SL_POJAZD, NormalizujNrRejestracyjny(op.NrRejestracyjny)
    DodajDoSlownika SL_OPERATOR, op.Utworzyl
    DodajDoSlownika SL_RABANIE, op.Rabanie
    DodajDoSlownika SL_DEKLARACJA, op.Deklaracja
    DodajDoSlownika SL_ZREBKA, op.RodzajZrebki
End Sub

' ----------------------------------------------------------------------
'  Operacja złożona: zakup + operacje równoległe
' ----------------------------------------------------------------------

' Zapisuje operację główną wraz z operacjami równoległymi.
' Zwraca liczbę dopisanych wierszy. Przy błędzie wycofuje wszystkie zmiany.
Public Function ZapiszOperacjeZlozona(ByRef op As Operacja, ByRef rown As OperacjeRownolegle) As Long
    Dim tabela As ListObject
    Dim wierszePrzed As Long
    Dim dopisane As Long
    Dim idPowiazania As String
    Dim glowna As Operacja

    Set tabela = TabelaDanych()
    wierszePrzed = tabela.ListRows.Count

    On Error GoTo Wycofaj
    WylaczEkran

    idPowiazania = ""
    If rown.Produkcja Or rown.Sprzedaz Or rown.Transport Then
        idPowiazania = NowyIdPowiazania()
    End If

    ' --- Wiersz główny ------------------------------------------------
    glowna = op
    glowna.IdPowiazania = idPowiazania

    ' Towar, który od razu idzie do produkcji lub na sprzedaż, nie trafia
    ' na stan magazynu - inaczej zostałby policzony podwójnie.
    If rown.Produkcja Or rown.Sprzedaz Then glowna.CzyMagazynowane = "NIE"

    ZapiszWiersz glowna
    dopisane = dopisane + 1

    ' --- Produkcja + automatyczne zużycie surowca ---------------------
    If rown.Produkcja Then
        dopisane = dopisane + ZapiszProdukcjeZZuzyciem(op, rown, idPowiazania)
    End If

    ' --- Sprzedaż ------------------------------------------------------
    If rown.Sprzedaz Then
        dopisane = dopisane + ZapiszSprzedazRownolegla(op, rown, idPowiazania)
    End If

    ' --- Transport -----------------------------------------------------
    If rown.Transport Then
        dopisane = dopisane + ZapiszTransportRownolegly(op, rown, idPowiazania)
    End If

    WlaczEkran
    ZapiszOperacjeZlozona = dopisane
    Exit Function

Wycofaj:
    ' Usuwamy wszystkie wiersze dopisane w tej transakcji.
    Dim i As Long
    On Error Resume Next
    For i = tabela.ListRows.Count To wierszePrzed + 1 Step -1
        tabela.ListRows(i).Delete
    Next i
    On Error GoTo 0
    WlaczEkran
    Err.Raise vbObjectError + 1100, "mod_Operacje.ZapiszOperacjeZlozona", _
              "Zapis operacji złożonej nie powiódł się - wszystkie wiersze zostały wycofane."
End Function

' Produkcja wyrobu + zużycie surowca kupionego w operacji głównej.
Private Function ZapiszProdukcjeZZuzyciem(ByRef op As Operacja, ByRef rown As OperacjeRownolegle, _
                                          ByVal idPowiazania As String) As Long
    Dim produkcja As Operacja
    Dim zuzycie As Operacja

    ' --- Wyrób gotowy --------------------------------------------------
    produkcja = op
    produkcja.Typ = OP_PRODUKCJA
    produkcja.Produkt = rown.ProduktProdukcji
    produkcja.Volumen = rown.VolumenProdukcji
    produkcja.Jednostka = rown.JednostkaProdukcji
    produkcja.CenaZakupu = 0
    produkcja.CenaSprzedazy = 0
    produkcja.CzyMagazynowane = IIf(rown.Sprzedaz, "NIE", "TAK")
    produkcja.Uwagi = "Produkcja z surowca zakupionego w tej samej operacji"
    produkcja.IdPowiazania = idPowiazania
    ZapiszWiersz produkcja

    ' --- Zużycie surowca ------------------------------------------------
    zuzycie = op
    zuzycie.Typ = OP_ZUZYCIE
    zuzycie.Produkt = op.Produkt
    zuzycie.Volumen = op.Volumen
    zuzycie.Jednostka = op.Jednostka
    zuzycie.CenaZakupu = 0
    zuzycie.CenaSprzedazy = 0
    zuzycie.CzyMagazynowane = "NIE"
    zuzycie.Uwagi = "Automatyczne zużycie surowca do produkcji"
    zuzycie.IdPowiazania = idPowiazania
    ZapiszWiersz zuzycie

    ZapiszProdukcjeZZuzyciem = 2
End Function

' Sprzedaż bezpośrednia - wyrobu z produkcji albo towaru z zakupu.
Private Function ZapiszSprzedazRownolegla(ByRef op As Operacja, ByRef rown As OperacjeRownolegle, _
                                          ByVal idPowiazania As String) As Long
    Dim sprzedaz As Operacja

    sprzedaz = op
    sprzedaz.Typ = OP_SPRZEDAZ
    sprzedaz.Dostawca = op.Odbiorca          ' sprzedaje magazyn, który przyjął towar
    sprzedaz.Odbiorca = rown.OdbiorcaSprzedazy
    sprzedaz.CenaZakupu = 0
    sprzedaz.CenaSprzedazy = rown.CenaSprzedazy
    sprzedaz.CzyMagazynowane = "NIE"
    sprzedaz.IdPowiazania = idPowiazania
    sprzedaz.Uwagi = "Sprzedaż bezpośrednia powiązana z zakupem"

    If rown.Produkcja Then
        sprzedaz.Produkt = rown.ProduktProdukcji
        sprzedaz.Volumen = rown.VolumenProdukcji
        sprzedaz.Jednostka = rown.JednostkaProdukcji
    Else
        sprzedaz.Produkt = op.Produkt
        sprzedaz.Volumen = op.Volumen
        sprzedaz.Jednostka = op.Jednostka
    End If

    ZapiszWiersz sprzedaz
    ZapiszSprzedazRownolegla = 1
End Function

' Transport jako osobna, powiązana operacja kosztowa.
Private Function ZapiszTransportRownolegly(ByRef op As Operacja, ByRef rown As OperacjeRownolegle, _
                                           ByVal idPowiazania As String) As Long
    Dim transport As Operacja

    transport = op
    transport.Typ = OP_TRANSPORT
    transport.CzyMagazynowane = "NIE"
    transport.Volumen = 0
    transport.Jednostka = ""
    transport.Produkt = ""
    transport.CenaZakupu = 0
    transport.CenaSprzedazy = 0
    transport.KosztRabania = 0
    transport.IdPowiazania = idPowiazania

    ' Dane przewozu z bloku transportowego formularza; gdy pola są puste,
    ' przejmujemy je z operacji głównej.
    transport.Przewoznik = PierwszyNiepusty(rown.Przewoznik, op.Przewoznik)
    transport.NrRejestracyjny = PierwszyNiepusty(rown.NrRejestracyjny, op.NrRejestracyjny)
    transport.Odleglosc = IIf(rown.Odleglosc > 0, rown.Odleglosc, op.Odleglosc)
    transport.StawkaKm = IIf(rown.StawkaKm > 0, rown.StawkaKm, op.StawkaKm)
    transport.KosztTransportu = IIf(rown.KosztTransportu > 0, rown.KosztTransportu, 0)

    ' Wymuszamy przeliczenie km * stawka, jeżeli koszt nie został podany ręcznie.
    PrzeliczTransport transport, (transport.KosztTransportu <= 0)

    transport.Uwagi = "Transport powiązany z operacją " & UCase$(op.Typ) & _
                      " (" & Format$(transport.Odleglosc, "0.##") & " km x " & _
                      Format$(transport.StawkaKm, "0.00") & " zł/km)"

    ZapiszWiersz transport
    ZapiszTransportRownolegly = 1
End Function

Private Function PierwszyNiepusty(ByVal pierwsza As String, ByVal druga As String) As String
    If Len(Trim$(pierwsza)) > 0 Then
        PierwszyNiepusty = pierwsza
    Else
        PierwszyNiepusty = druga
    End If
End Function

' ----------------------------------------------------------------------
'  Produkcja samodzielna
' ----------------------------------------------------------------------

' Dla operacji PRODUKCJA wprowadzonej wprost (bez zakupu) system dopisuje
' automatyczne zużycie surowca. Surowiec pochodzi z ustawień, a nie -
' jak poprzednio - z wpisanej na sztywno nazwy "Zrzyna".
Public Function ZapiszProdukcjeSamodzielna(ByRef op As Operacja, ByVal surowiec As String, _
                                           ByVal volumenSurowca As Double) As Long
    Dim tabela As ListObject
    Dim wierszePrzed As Long
    Dim idPowiazania As String
    Dim glowna As Operacja
    Dim zuzycie As Operacja
    Dim i As Long

    Set tabela = TabelaDanych()
    wierszePrzed = tabela.ListRows.Count

    On Error GoTo Wycofaj
    WylaczEkran

    idPowiazania = NowyIdPowiazania()

    glowna = op
    glowna.Typ = OP_PRODUKCJA
    glowna.IdPowiazania = idPowiazania
    ZapiszWiersz glowna

    If Len(Trim$(surowiec)) = 0 Then surowiec = CStr(Ustawienie(UST_SUROWIEC, "Zrzyna"))
    If volumenSurowca <= 0 Then volumenSurowca = op.Volumen

    zuzycie = op
    zuzycie.Typ = OP_ZUZYCIE
    zuzycie.Produkt = surowiec
    zuzycie.Volumen = volumenSurowca
    zuzycie.CenaZakupu = 0
    zuzycie.CenaSprzedazy = 0
    zuzycie.CzyMagazynowane = "NIE"
    zuzycie.Uwagi = "Automatyczne zużycie surowca do produkcji"
    zuzycie.IdPowiazania = idPowiazania
    ZapiszWiersz zuzycie

    WlaczEkran
    ZapiszProdukcjeSamodzielna = 2
    Exit Function

Wycofaj:
    On Error Resume Next
    For i = tabela.ListRows.Count To wierszePrzed + 1 Step -1
        tabela.ListRows(i).Delete
    Next i
    On Error GoTo 0
    WlaczEkran
    Err.Raise vbObjectError + 1101, "mod_Operacje.ZapiszProdukcjeSamodzielna", _
              "Zapis produkcji nie powiódł się - wiersze zostały wycofane."
End Function
