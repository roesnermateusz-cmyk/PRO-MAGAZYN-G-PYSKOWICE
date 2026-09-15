Option Explicit

' ======================================================================
'  PRO-MAGAZYN  |  mod_Slowniki
'  Zarządzanie słownikami (listami rozwijanymi) systemu.
'
'  Każda kolumna kartoteki ma własny słownik w arkuszu SŁOWNIK.
'  Słowniki są automatycznie uzupełniane o wartości pojawiające się
'  w danych, dzięki czemu listy rozwijane nigdy się nie "starzeją".
' ======================================================================

' Nagłówki kolumn arkusza SŁOWNIK (wiersz 1). Kolejność decyduje o
' numerach kolumn i o nazwach zakresów sl_<KLUCZ>.
Public Const SL_TYP_OPERACJI As String = "TYP_OPERACJI"
Public Const SL_PRODUKT As String = "PRODUKT"
Public Const SL_JEDNOSTKA As String = "JEDNOSTKA"
Public Const SL_DOSTAWCA As String = "DOSTAWCA"
Public Const SL_ODBIORCA As String = "ODBIORCA"
Public Const SL_MIEJSCE As String = "MIEJSCE"
Public Const SL_PRZEWOZNIK As String = "PRZEWOZNIK"
Public Const SL_POJAZD As String = "POJAZD"
Public Const SL_OPERATOR As String = "OPERATOR"
Public Const SL_TAKNIE As String = "TAK_NIE"
Public Const SL_DEKLARACJA As String = "DEKLARACJA"
Public Const SL_ZREBKA As String = "ZREBKA"
Public Const SL_RABANIE As String = "RABANIE"
Public Const SL_STATUS As String = "STATUS"

Private Const PIERWSZY_WIERSZ As Long = 2

' ----------------------------------------------------------------------
'  Odczyt słowników
' ----------------------------------------------------------------------

' Zwraca numer kolumny słownika o podanym kluczu (0 gdy nie istnieje).
Public Function KolumnaSlownika(ByVal klucz As String) As Long
    Dim kolumna As Long
    Dim ostatnia As Long

    ostatnia = wsSlownik.Cells(1, wsSlownik.Columns.Count).End(xlToLeft).Column

    For kolumna = 1 To ostatnia
        If UCase$(Trim$(CStr(wsSlownik.Cells(1, kolumna).Value))) = UCase$(klucz) Then
            KolumnaSlownika = kolumna
            Exit Function
        End If
    Next kolumna

    KolumnaSlownika = 0
End Function

' Zwraca zakres z pozycjami słownika lub Nothing, gdy słownik jest pusty.
Public Function ZakresSlownika(ByVal klucz As String) As Range
    Dim kolumna As Long
    Dim ostatni As Long

    kolumna = KolumnaSlownika(klucz)
    If kolumna = 0 Then Exit Function

    ostatni = wsSlownik.Cells(wsSlownik.Rows.Count, kolumna).End(xlUp).Row
    If ostatni < PIERWSZY_WIERSZ Then Exit Function

    Set ZakresSlownika = wsSlownik.Range(wsSlownik.Cells(PIERWSZY_WIERSZ, kolumna), _
                                         wsSlownik.Cells(ostatni, kolumna))
End Function

' Zwraca pozycje słownika jako tablicę tekstów (pusta tablica gdy brak).
Public Function PozycjeSlownika(ByVal klucz As String) As Variant
    Dim zakres As Range
    Dim komorka As Range
    Dim wynik() As String
    Dim ile As Long

    Set zakres = ZakresSlownika(klucz)
    If zakres Is Nothing Then
        PozycjeSlownika = Array()
        Exit Function
    End If

    ReDim wynik(0 To zakres.Cells.Count - 1)
    For Each komorka In zakres.Cells
        If Len(Znormalizuj(komorka.Value)) > 0 Then
            wynik(ile) = Znormalizuj(komorka.Value)
            ile = ile + 1
        End If
    Next komorka

    If ile = 0 Then
        PozycjeSlownika = Array()
    Else
        ReDim Preserve wynik(0 To ile - 1)
        PozycjeSlownika = wynik
    End If
End Function

Public Function CzyWSlowniku(ByVal klucz As String, ByVal wartosc As String) As Boolean
    Dim pozycje As Variant
    Dim i As Long

    pozycje = PozycjeSlownika(klucz)
    If Not IsArray(pozycje) Then Exit Function
    If UBound(pozycje) < LBound(pozycje) Then Exit Function

    For i = LBound(pozycje) To UBound(pozycje)
        If KluczPorownania(pozycje(i)) = KluczPorownania(wartosc) Then
            CzyWSlowniku = True
            Exit Function
        End If
    Next i
End Function

' ----------------------------------------------------------------------
'  Zapis słowników
' ----------------------------------------------------------------------

' Dopisuje wartość do słownika, jeżeli jeszcze jej tam nie ma.
' Zwraca True, gdy nastąpił faktyczny zapis.
Public Function DodajDoSlownika(ByVal klucz As String, ByVal wartosc As Variant) As Boolean
    Dim kolumna As Long
    Dim ostatni As Long
    Dim tekst As String

    tekst = Znormalizuj(wartosc)
    If Len(tekst) = 0 Then Exit Function

    kolumna = KolumnaSlownika(klucz)
    If kolumna = 0 Then Exit Function
    If CzyWSlowniku(klucz, tekst) Then Exit Function

    ostatni = wsSlownik.Cells(wsSlownik.Rows.Count, kolumna).End(xlUp).Row
    If ostatni < PIERWSZY_WIERSZ - 1 Then ostatni = PIERWSZY_WIERSZ - 1

    wsSlownik.Cells(ostatni + 1, kolumna).Value = tekst
    DodajDoSlownika = True
End Function

' Sortuje alfabetycznie pozycje jednego słownika.
Public Sub PosortujSlownik(ByVal klucz As String)
    Dim zakres As Range

    Set zakres = ZakresSlownika(klucz)
    If zakres Is Nothing Then Exit Sub
    If zakres.Cells.Count < 2 Then Exit Sub

    zakres.Sort Key1:=zakres.Cells(1, 1), Order1:=xlAscending, Header:=xlNo, _
                Orientation:=xlSortColumns
End Sub

' ----------------------------------------------------------------------
'  Synchronizacja słowników z danymi
' ----------------------------------------------------------------------

' Uzupełnia słowniki o wszystkie wartości występujące w kartotece.
' Wywoływane po imporcie danych i przy otwarciu skoroszytu.
Public Sub OdswiezSlownikiZDanych(Optional ByVal cicho As Boolean = True)
    Dim tabela As ListObject
    Dim dane As Variant
    Dim wiersz As Long
    Dim dodane As Long

    Set tabela = TabelaDanych()
    If tabela.ListRows.Count = 0 Then
        If Not cicho Then Informacja "Kartoteka jest pusta - słowniki pozostały bez zmian."
        GoTo Zakoncz
    End If

    WylaczEkran
    dane = tabela.DataBodyRange.Value

    For wiersz = 1 To UBound(dane, 1)
        If DodajDoSlownika(SL_PRODUKT, dane(wiersz, kolProdukt)) Then dodane = dodane + 1
        If DodajDoSlownika(SL_JEDNOSTKA, dane(wiersz, kolJednostka)) Then dodane = dodane + 1
        If DodajDoSlownika(SL_DOSTAWCA, dane(wiersz, kolDostawca)) Then dodane = dodane + 1
        If DodajDoSlownika(SL_ODBIORCA, dane(wiersz, kolOdbiorca)) Then dodane = dodane + 1
        If DodajDoSlownika(SL_MIEJSCE, dane(wiersz, kolMiejsceZaladunku)) Then dodane = dodane + 1
        If DodajDoSlownika(SL_MIEJSCE, dane(wiersz, kolMiejscePochodzenia)) Then dodane = dodane + 1
        If DodajDoSlownika(SL_PRZEWOZNIK, dane(wiersz, kolPrzewoznik)) Then dodane = dodane + 1
        If DodajDoSlownika(SL_POJAZD, dane(wiersz, kolNrRejestracyjny)) Then dodane = dodane + 1
        If DodajDoSlownika(SL_OPERATOR, dane(wiersz, kolUtworzyl)) Then dodane = dodane + 1
        If DodajDoSlownika(SL_RABANIE, dane(wiersz, kolRabanie)) Then dodane = dodane + 1
        If DodajDoSlownika(SL_DEKLARACJA, dane(wiersz, kolDeklaracja)) Then dodane = dodane + 1
        If DodajDoSlownika(SL_ZREBKA, dane(wiersz, kolRodzajZrebki)) Then dodane = dodane + 1
    Next wiersz

    PosortujWszystkie
    WlaczEkran

    If Not cicho Then
        Informacja "Słowniki zaktualizowane." & vbCrLf & _
                   "Dopisano nowych pozycji: " & dodane & "."
    End If
    Exit Sub

Zakoncz:
End Sub

Public Sub PosortujWszystkie()
    PosortujSlownik SL_PRODUKT
    PosortujSlownik SL_DOSTAWCA
    PosortujSlownik SL_ODBIORCA
    PosortujSlownik SL_MIEJSCE
    PosortujSlownik SL_PRZEWOZNIK
    PosortujSlownik SL_POJAZD
    PosortujSlownik SL_OPERATOR
End Sub

' ----------------------------------------------------------------------
'  Listy rozwijane
' ----------------------------------------------------------------------

' Zakłada listę rozwijaną na zakresie, opartą o słownik.
' Lista jest "miękka" (ostrzega, ale pozwala wpisać nową wartość),
' bo kartoteka musi przyjmować nowych kontrahentów bez blokowania pracy.
Public Sub UstawListeRozwijana(ByVal cel As Range, ByVal kluczSlownika As String, _
                               Optional ByVal blokujObce As Boolean = False, _
                               Optional ByVal komunikat As String = "")
    Dim zakres As Range
    Dim formula As String

    Set zakres = ZakresSlownika(kluczSlownika)
    If zakres Is Nothing Then
        On Error Resume Next
        cel.Validation.Delete
        On Error GoTo 0
        Exit Sub
    End If

    formula = "=" & NazwaZakresu(kluczSlownika)

    On Error Resume Next
    cel.Validation.Delete
    On Error GoTo 0

    On Error GoTo Nieudane
    With cel.Validation
        .Add Type:=xlValidateList, _
             AlertStyle:=IIf(blokujObce, xlValidAlertStop, xlValidAlertInformation), _
             Operator:=xlBetween, Formula1:=formula
        .IgnoreBlank = True
        .InCellDropdown = True
        .ShowInput = (Len(komunikat) > 0)
        If Len(komunikat) > 0 Then
            .InputTitle = "Podpowiedź"
            .InputMessage = komunikat
        End If
        .ShowError = True
        .ErrorTitle = "Wartość spoza słownika"
        .ErrorMessage = "Ta pozycja nie występuje jeszcze w słowniku." & vbCrLf & _
                        IIf(blokujObce, "Wybierz wartość z listy.", _
                            "Możesz ją zatwierdzić - zostanie dopisana do słownika.")
    End With
Nieudane:
    On Error GoTo 0
End Sub

' Nazwa dynamicznego zakresu słownika używana w formułach sprawdzania poprawności.
Public Function NazwaZakresu(ByVal klucz As String) As String
    NazwaZakresu = "sl_" & UCase$(klucz)
End Function

' Tworzy/odświeża nazwane zakresy dynamiczne dla wszystkich słowników.
' Dzięki OFFSET+LICZ.ILE listy rosną automatycznie wraz ze słownikiem.
Public Sub OdswiezNazwaneZakresy()
    Dim klucze As Variant
    Dim i As Long
    Dim kolumna As Long
    Dim litera As String
    Dim nazwa As String
    Dim odwolanie As String

    klucze = Array(SL_TYP_OPERACJI, SL_PRODUKT, SL_JEDNOSTKA, SL_DOSTAWCA, SL_ODBIORCA, _
                   SL_MIEJSCE, SL_PRZEWOZNIK, SL_POJAZD, SL_OPERATOR, SL_TAKNIE, _
                   SL_DEKLARACJA, SL_ZREBKA, SL_RABANIE, SL_STATUS)

    For i = LBound(klucze) To UBound(klucze)
        kolumna = KolumnaSlownika(CStr(klucze(i)))
        If kolumna > 0 Then
            litera = Split(wsSlownik.Cells(1, kolumna).Address(True, False), "$")(0)
            nazwa = NazwaZakresu(CStr(klucze(i)))
            ' Zakres rośnie do ostatniej niepustej komórki kolumny.
            odwolanie = "=OFFSET('" & wsSlownik.Name & "'!$" & litera & "$" & PIERWSZY_WIERSZ & _
                        ",0,0,MAX(1,COUNTA('" & wsSlownik.Name & "'!$" & litera & ":$" & litera & ")-1),1)"
            On Error Resume Next
            ThisWorkbook.Names(nazwa).Delete
            On Error GoTo 0
            ThisWorkbook.Names.Add Name:=nazwa, RefersTo:=odwolanie
        End If
    Next i
End Sub
