Option Explicit

' ======================================================================
'  PRO-MAGAZYN  |  mod_Korekty
'  Korekty operacji metodą storno.
'
'  Wiersz kartoteki nigdy nie jest kasowany ani nadpisywany. Korekta
'  oznacza wiersz pierwotny jako SKORYGOWANY i dopisuje wiersz KOREKTA
'  z odwrotnym znakiem, a następnie - opcjonalnie - poprawny wpis.
'  Dzięki temu zachowana zostaje pełna ścieżka audytu.
' ======================================================================

' Koryguje operację w zaznaczonym wierszu arkusza Dane.
Public Sub KorygujZaznaczonyWiersz()
    Dim tabela As ListObject
    Dim wiersz As Long

    On Error GoTo Blad

    Set tabela = TabelaDanych()

    If Intersect(ActiveCell, tabela.DataBodyRange) Is Nothing Then
        Ostrzezenie "Zaznacz najpierw dowolną komórkę w wierszu operacji, " & _
                    "którą chcesz skorygować."
        Exit Sub
    End If

    wiersz = ActiveCell.Row - tabela.DataBodyRange.Row + 1
    KorygujWiersz wiersz
    Exit Sub

Blad:
    PokazBlad "korekta operacji"
End Sub

' Wykonuje storno wskazanego wiersza tabeli.
Public Sub KorygujWiersz(ByVal numerWiersza As Long)
    Dim tabela As ListObject
    Dim zrodlo As Range
    Dim op As Operacja
    Dim idPierwotny As String
    Dim powod As String

    Set tabela = TabelaDanych()

    If numerWiersza < 1 Or numerWiersza > tabela.ListRows.Count Then
        Ostrzezenie "Nieprawidłowy numer wiersza operacji."
        Exit Sub
    End If

    Set zrodlo = tabela.ListRows(numerWiersza).Range

    If KluczPorownania(zrodlo.Cells(1, kolStatus).Value) = UCase$(ST_SKORYGOWANY) Then
        Ostrzezenie "Ta operacja została już skorygowana."
        Exit Sub
    End If

    If KluczPorownania(zrodlo.Cells(1, kolStatus).Value) = UCase$(ST_KOREKTA) Then
        If Not Potwierdz("Wskazany wiersz jest wpisem korygującym." & vbCrLf & _
                         "Czy na pewno chcesz go wystornować?") Then Exit Sub
    End If

    idPierwotny = Znormalizuj(zrodlo.Cells(1, kolIdOperacji).Value)

    powod = InputBox("Podaj powód korekty (trafi do dziennika zdarzeń):", _
                     APP_NAZWA & " - korekta operacji", "Korekta błędnego wpisu")
    If StrPtr(powod) = 0 Then Exit Sub   ' użytkownik kliknął Anuluj

    If Not Potwierdz("Operacja:" & vbCrLf & _
                     zrodlo.Cells(1, kolTypOperacji).Value & " | " & _
                     zrodlo.Cells(1, kolProdukt).Value & " | " & _
                     zrodlo.Cells(1, kolVolumen).Value & " " & _
                     zrodlo.Cells(1, kolJednostka).Value & vbCrLf & vbCrLf & _
                     "Zostanie oznaczona jako SKORYGOWANA, a system dopisze wpis " & _
                     "odwracający jej skutki." & vbCrLf & vbCrLf & "Kontynuować?", _
                     APP_NAZWA & " - potwierdzenie korekty") Then Exit Sub

    On Error GoTo Blad
    WylaczEkran

    ' --- Wczytanie operacji pierwotnej ---------------------------------
    WczytajOperacjeZWiersza zrodlo, op

    ' --- Storno: ten sam wiersz z odwrotnym wolumenem i wartością ------
    op.Volumen = -op.Volumen
    op.KosztTransportu = -op.KosztTransportu
    op.KosztRabania = -op.KosztRabania
    op.Status = ST_KOREKTA
    op.IdPowiazania = idPierwotny
    op.Uwagi = "KOREKTA (storno) wpisu " & idPierwotny & ". Powód: " & powod
    op.Utworzyl = UzytkownikSystemu()
    op.DataOperacji = zrodlo.Cells(1, kolDataOperacji).Value

    ZapiszWiersz op

    ' --- Oznaczenie wiersza pierwotnego --------------------------------
    zrodlo.Cells(1, kolStatus).Value = ST_SKORYGOWANY
    zrodlo.Interior.Color = RGB(255, 235, 235)
    zrodlo.Font.Strikethrough = True

    ZapisDoHistorii "KOREKTA", idPierwotny, CStr(zrodlo.Cells(1, kolTypOperacji).Value), _
                    UzytkownikSystemu(), "Storno wiersza " & numerWiersza & ". Powód: " & powod

    OdswiezStanMagazynu
    WlaczEkran

    Informacja "Korekta zapisana." & vbCrLf & vbCrLf & _
               "Wiersz pierwotny oznaczono jako SKORYGOWANY, " & _
               "a system dopisał wpis odwracający jego skutki." & vbCrLf & vbCrLf & _
               "Poprawny wpis wprowadź normalnie przez formularz."
    Exit Sub

Blad:
    PokazBlad "korekta operacji"
End Sub

' Odczytuje operację z wiersza kartoteki do struktury.
Public Sub WczytajOperacjeZWiersza(ByVal zrodlo As Range, ByRef op As Operacja)
    op.Typ = Znormalizuj(zrodlo.Cells(1, kolTypOperacji).Value)

    If IsDate(zrodlo.Cells(1, kolDataOperacji).Value) Then
        op.DataOperacji = CDate(zrodlo.Cells(1, kolDataOperacji).Value)
    End If

    If IsDate(zrodlo.Cells(1, kolDataZaladunku).Value) Then
        op.DataZaladunku = CDate(zrodlo.Cells(1, kolDataZaladunku).Value)
        op.MaDateZaladunku = True
    End If

    op.MiejsceZaladunku = Znormalizuj(zrodlo.Cells(1, kolMiejsceZaladunku).Value)
    op.Dostawca = Znormalizuj(zrodlo.Cells(1, kolDostawca).Value)
    op.Odbiorca = Znormalizuj(zrodlo.Cells(1, kolOdbiorca).Value)
    op.NrWZ = Znormalizuj(zrodlo.Cells(1, kolNrWZ).Value)
    op.CzyMagazynowane = Znormalizuj(zrodlo.Cells(1, kolCzyMagazynowane).Value)
    op.Deklaracja = Znormalizuj(zrodlo.Cells(1, kolDeklaracja).Value)
    op.Produkt = Znormalizuj(zrodlo.Cells(1, kolProdukt).Value)
    op.Volumen = LiczbaZTekstu(zrodlo.Cells(1, kolVolumen).Value, 0)
    op.Jednostka = Znormalizuj(zrodlo.Cells(1, kolJednostka).Value)
    op.CenaZakupu = LiczbaZTekstu(zrodlo.Cells(1, kolCenaZakupu).Value, 0)
    op.CenaSprzedazy = LiczbaZTekstu(zrodlo.Cells(1, kolCenaSprzedazy).Value, 0)
    op.RodzajZrebki = Znormalizuj(zrodlo.Cells(1, kolRodzajZrebki).Value)
    op.Rabanie = Znormalizuj(zrodlo.Cells(1, kolRabanie).Value)
    op.KosztRabania = LiczbaZTekstu(zrodlo.Cells(1, kolKosztRabania).Value, 0)
    op.Przewoznik = Znormalizuj(zrodlo.Cells(1, kolPrzewoznik).Value)
    op.NrRejestracyjny = Znormalizuj(zrodlo.Cells(1, kolNrRejestracyjny).Value)
    op.Odleglosc = LiczbaZTekstu(zrodlo.Cells(1, kolOdleglosc).Value, 0)
    op.StawkaKm = LiczbaZTekstu(zrodlo.Cells(1, kolStawkaKm).Value, 0)
    op.KosztTransportu = LiczbaZTekstu(zrodlo.Cells(1, kolKosztTransportu).Value, 0)
    op.MiejscePochodzenia = Znormalizuj(zrodlo.Cells(1, kolMiejscePochodzenia).Value)
    op.Uwagi = Znormalizuj(zrodlo.Cells(1, kolUwagi).Value)
    op.Utworzyl = Znormalizuj(zrodlo.Cells(1, kolUtworzyl).Value)
    op.Status = Znormalizuj(zrodlo.Cells(1, kolStatus).Value)
End Sub

' Kopiuje zaznaczoną operację do formularza - wygodne przy powtórnym wpisie
' po korekcie oraz przy operacjach seryjnych.
Public Sub SkopiujDoFormularza()
    Dim tabela As ListObject
    Dim op As Operacja
    Dim zrodlo As Range

    On Error GoTo Blad

    Set tabela = TabelaDanych()
    If Intersect(ActiveCell, tabela.DataBodyRange) Is Nothing Then
        Ostrzezenie "Zaznacz komórkę w wierszu operacji, którą chcesz skopiować do formularza."
        Exit Sub
    End If

    Set zrodlo = tabela.ListRows(ActiveCell.Row - tabela.DataBodyRange.Row + 1).Range
    WczytajOperacjeZWiersza zrodlo, op

    WyczyscFormularz

    UstawWartoscPola POLE_TYP, op.Typ
    UstawWartoscPola POLE_DATA_OP, Date
    If op.MaDateZaladunku Then UstawWartoscPola POLE_DATA_ZAL, op.DataZaladunku
    UstawWartoscPola POLE_MIEJSCE_ZAL, op.MiejsceZaladunku
    UstawWartoscPola POLE_DOSTAWCA, op.Dostawca
    UstawWartoscPola POLE_ODBIORCA, op.Odbiorca
    UstawWartoscPola POLE_NR_WZ, op.NrWZ
    UstawWartoscPola POLE_CZY_MAG, op.CzyMagazynowane
    UstawWartoscPola POLE_DEKLARACJA, op.Deklaracja
    UstawWartoscPola POLE_PRODUKT, op.Produkt
    UstawWartoscPola POLE_VOLUMEN, Abs(op.Volumen)
    UstawWartoscPola POLE_JEDNOSTKA, op.Jednostka
    UstawWartoscPola POLE_CENA_ZAKUPU, op.CenaZakupu
    UstawWartoscPola POLE_CENA_SPRZEDAZY, op.CenaSprzedazy
    UstawWartoscPola POLE_ZREBKA, op.RodzajZrebki
    UstawWartoscPola POLE_RABANIE, op.Rabanie
    UstawWartoscPola POLE_KOSZT_RABANIA, Abs(op.KosztRabania)
    UstawWartoscPola POLE_PRZEWOZNIK, op.Przewoznik
    UstawWartoscPola POLE_NR_REJ, op.NrRejestracyjny
    UstawWartoscPola POLE_ODLEGLOSC, op.Odleglosc
    UstawWartoscPola POLE_STAWKA_KM, IIf(op.StawkaKm > 0, op.StawkaKm, StawkaZaKm())
    UstawWartoscPola POLE_MIEJSCE_POCH, op.MiejscePochodzenia

    wsFormularz.Activate
    Informacja "Dane operacji skopiowano do formularza. " & _
               "Sprawdź datę i zatwierdź, gdy wszystko się zgadza."
    Exit Sub

Blad:
    PokazBlad "kopiowanie operacji do formularza"
End Sub

' Przywraca wiersz omyłkowo oznaczony jako skorygowany.
Public Sub CofnijOznaczenieKorekty()
    Dim tabela As ListObject
    Dim zrodlo As Range

    On Error GoTo Blad

    Set tabela = TabelaDanych()
    If Intersect(ActiveCell, tabela.DataBodyRange) Is Nothing Then
        Ostrzezenie "Zaznacz komórkę w wierszu operacji."
        Exit Sub
    End If

    Set zrodlo = tabela.ListRows(ActiveCell.Row - tabela.DataBodyRange.Row + 1).Range

    If KluczPorownania(zrodlo.Cells(1, kolStatus).Value) <> UCase$(ST_SKORYGOWANY) Then
        Ostrzezenie "Ten wiersz nie jest oznaczony jako skorygowany."
        Exit Sub
    End If

    If Not Potwierdz("Przywrócić wiersz do stanu AKTYWNY?" & vbCrLf & vbCrLf & _
                     "Uwaga: wpis storno pozostanie w kartotece - usuń go ręcznie, " & _
                     "jeżeli korekta była pomyłką.") Then Exit Sub

    zrodlo.Cells(1, kolStatus).Value = ST_AKTYWNY
    zrodlo.Interior.ColorIndex = xlColorIndexNone
    zrodlo.Font.Strikethrough = False

    ZapisDoHistorii "COFNIECIE KOREKTY", Znormalizuj(zrodlo.Cells(1, kolIdOperacji).Value), _
                    CStr(zrodlo.Cells(1, kolTypOperacji).Value), UzytkownikSystemu(), _
                    "Przywrócono status AKTYWNY"

    OdswiezStanMagazynu
    Informacja "Wiersz przywrócony do stanu AKTYWNY."
    Exit Sub

Blad:
    PokazBlad "cofanie oznaczenia korekty"
End Sub
