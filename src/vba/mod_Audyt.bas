Option Explicit

' ======================================================================
'  PRO-MAGAZYN  |  mod_Audyt
'  Dziennik zdarzeń systemu (arkusz HISTORIA).
'
'  Każda zmiana w kartotece zostawia ślad: kto, kiedy, co i na czym.
'  Dziennik jest dopisywany tylko - wpisy nie są modyfikowane ani usuwane,
'  dzięki czemu stanowi wiarygodną ścieżkę audytu.
' ======================================================================

Private Const KOL_LP As Long = 1
Private Const KOL_DATA As Long = 2
Private Const KOL_UZYTKOWNIK As Long = 3
Private Const KOL_ZDARZENIE As Long = 4
Private Const KOL_TYP As Long = 5
Private Const KOL_ID As Long = 6
Private Const KOL_OPIS As Long = 7
Private Const PIERWSZY_WIERSZ As Long = 2

' Dopisuje zdarzenie do dziennika. Nigdy nie przerywa operacji nadrzędnej -
' awaria dziennika nie może blokować pracy magazynu.
Public Sub ZapisDoHistorii(ByVal zdarzenie As String, ByVal idOperacji As String, _
                           ByVal typOperacji As String, ByVal uzytkownik As String, _
                           ByVal opis As String)
    Dim wiersz As Long
    Dim lp As Long

    On Error GoTo Pomin

    wiersz = wsHistoria.Cells(wsHistoria.Rows.Count, KOL_DATA).End(xlUp).Row + 1
    If wiersz < PIERWSZY_WIERSZ Then wiersz = PIERWSZY_WIERSZ

    lp = wiersz - PIERWSZY_WIERSZ + 1
    If Len(Trim$(uzytkownik)) = 0 Then uzytkownik = UzytkownikSystemu()

    With wsHistoria
        .Cells(wiersz, KOL_LP).Value = lp
        .Cells(wiersz, KOL_DATA).Value = Now
        .Cells(wiersz, KOL_DATA).NumberFormat = "dd.mm.yyyy hh:mm:ss"
        .Cells(wiersz, KOL_UZYTKOWNIK).Value = uzytkownik
        .Cells(wiersz, KOL_ZDARZENIE).Value = UCase$(zdarzenie)
        .Cells(wiersz, KOL_TYP).Value = UCase$(typOperacji)
        .Cells(wiersz, KOL_ID).Value = idOperacji
        .Cells(wiersz, KOL_OPIS).Value = opis
    End With

Pomin:
    On Error GoTo 0
End Sub

' Liczba zdarzeń w dzienniku.
Public Function LiczbaZdarzen() As Long
    Dim ostatni As Long

    On Error Resume Next
    ostatni = wsHistoria.Cells(wsHistoria.Rows.Count, KOL_DATA).End(xlUp).Row
    On Error GoTo 0

    If ostatni < PIERWSZY_WIERSZ Then
        LiczbaZdarzen = 0
    Else
        LiczbaZdarzen = ostatni - PIERWSZY_WIERSZ + 1
    End If
End Function

' Eksportuje dziennik do pliku CSV - na potrzeby kontroli i archiwizacji.
Public Sub EksportujHistorie()
    Dim sciezka As String
    Dim ostatni As Long

    ostatni = wsHistoria.Cells(wsHistoria.Rows.Count, KOL_DATA).End(xlUp).Row
    If ostatni < PIERWSZY_WIERSZ Then
        Informacja "Dziennik zdarzeń jest pusty."
        Exit Sub
    End If

    sciezka = ZapytajOPlikDoZapisu("Historia_" & Format$(Now, "yyyymmdd_hhnnss") & ".csv")
    If Len(sciezka) = 0 Then Exit Sub

    ZapiszZakresDoCsv wsHistoria.Range(wsHistoria.Cells(1, KOL_LP), _
                                       wsHistoria.Cells(ostatni, KOL_OPIS)), sciezka
    Informacja "Dziennik zdarzeń zapisany:" & vbCrLf & sciezka
End Sub

' Czyści dziennik, zachowując wpisy z ostatnich N dni.
Public Sub ArchiwizujHistorie(ByVal zachowajDni As Long)
    Dim ostatni As Long
    Dim wiersz As Long
    Dim granica As Date
    Dim usuniete As Long

    ostatni = wsHistoria.Cells(wsHistoria.Rows.Count, KOL_DATA).End(xlUp).Row
    If ostatni < PIERWSZY_WIERSZ Then Exit Sub

    granica = Date - zachowajDni

    WylaczEkran
    For wiersz = ostatni To PIERWSZY_WIERSZ Step -1
        If IsDate(wsHistoria.Cells(wiersz, KOL_DATA).Value) Then
            If CDate(wsHistoria.Cells(wiersz, KOL_DATA).Value) < granica Then
                wsHistoria.Rows(wiersz).Delete
                usuniete = usuniete + 1
            End If
        End If
    Next wiersz
    PrzenumerujHistorie
    WlaczEkran

    Informacja "Zarchiwizowano dziennik." & vbCrLf & _
               "Usunięto wpisów starszych niż " & zachowajDni & " dni: " & usuniete & "."
End Sub

Private Sub PrzenumerujHistorie()
    Dim ostatni As Long
    Dim wiersz As Long

    ostatni = wsHistoria.Cells(wsHistoria.Rows.Count, KOL_DATA).End(xlUp).Row
    For wiersz = PIERWSZY_WIERSZ To ostatni
        wsHistoria.Cells(wiersz, KOL_LP).Value = wiersz - PIERWSZY_WIERSZ + 1
    Next wiersz
End Sub
