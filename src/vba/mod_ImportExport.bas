Option Explicit

' ======================================================================
'  PRO-MAGAZYN  |  mod_ImportExport
'  Wymiana danych z plikami CSV (UTF-8 z BOM, separator średnik).
'
'  Import przechodzi przez ten sam zestaw reguł walidacji co formularz -
'  do kartoteki nie trafiają dane, których system nie przyjąłby ręcznie.
' ======================================================================

Private Const SEPARATOR As String = ";"

' ----------------------------------------------------------------------
'  Eksport
' ----------------------------------------------------------------------

' Eksportuje całą kartotekę do pliku CSV.
Public Sub EksportujKartoteke()
    Dim tabela As ListObject
    Dim sciezka As String

    On Error GoTo Blad

    Set tabela = TabelaDanych()
    If tabela.ListRows.Count = 0 Then
        Informacja "Kartoteka jest pusta - nie ma czego wyeksportować."
        Exit Sub
    End If

    sciezka = ZapytajOPlikDoZapisu("Kartoteka_" & Format$(Now, "yyyymmdd_hhnnss") & ".csv")
    If Len(sciezka) = 0 Then Exit Sub

    ZapiszZakresDoCsv tabela.Range, sciezka

    ZapisDoHistorii "EKSPORT", "", "", UzytkownikSystemu(), _
                    "Eksport kartoteki (" & tabela.ListRows.Count & " wierszy) do " & sciezka

    Informacja "Kartoteka wyeksportowana." & vbCrLf & vbCrLf & _
               "Plik: " & sciezka & vbCrLf & _
               "Wierszy: " & tabela.ListRows.Count
    Exit Sub

Blad:
    PokazBlad "eksport kartoteki"
End Sub

' Zapisuje dowolny zakres do pliku CSV w kodowaniu UTF-8.
Public Sub ZapiszZakresDoCsv(ByVal zakres As Range, ByVal sciezka As String)
    Dim strumien As Object
    Dim dane As Variant
    Dim wiersz As Long, kolumna As Long
    Dim linia As String
    Dim komorka As Variant

    dane = zakres.Value

    Set strumien = CreateObject("ADODB.Stream")
    strumien.Type = 2                 ' tekst
    strumien.Charset = "UTF-8"
    strumien.Open

    If Not IsArray(dane) Then
        strumien.WriteText CStr(dane) & vbCrLf
    Else
        For wiersz = LBound(dane, 1) To UBound(dane, 1)
            linia = ""
            For kolumna = LBound(dane, 2) To UBound(dane, 2)
                komorka = dane(wiersz, kolumna)
                If kolumna > LBound(dane, 2) Then linia = linia & SEPARATOR
                linia = linia & PoleCsv(komorka)
            Next kolumna
            strumien.WriteText linia & vbCrLf
        Next wiersz
    End If

    strumien.SaveToFile sciezka, 2    ' nadpisz
    strumien.Close
End Sub

' Formatuje pojedynczą wartość do postaci pola CSV.
Private Function PoleCsv(ByVal wartosc As Variant) As String
    Dim tekst As String

    If IsEmpty(wartosc) Or IsNull(wartosc) Then
        PoleCsv = ""
        Exit Function
    End If

    If IsDate(wartosc) Then
        tekst = Format$(wartosc, "yyyy-mm-dd hh:nn:ss")
    ElseIf IsNumeric(wartosc) And VarType(wartosc) <> vbString Then
        ' Kropka dziesiętna - plik jest niezależny od ustawień regionalnych.
        tekst = Replace$(CStr(wartosc), ",", ".")
    Else
        tekst = CStr(wartosc)
    End If

    If InStr(tekst, SEPARATOR) > 0 Or InStr(tekst, """") > 0 Or _
       InStr(tekst, vbCr) > 0 Or InStr(tekst, vbLf) > 0 Then
        tekst = """" & Replace$(tekst, """", """""") & """"
    End If

    PoleCsv = tekst
End Function

' ----------------------------------------------------------------------
'  Import
' ----------------------------------------------------------------------

' Wczytuje operacje z pliku CSV o układzie zgodnym z eksportem.
Public Sub ImportujKartoteke()
    Dim sciezka As String
    Dim strumien As Object
    Dim tresc As String
    Dim linie As Variant
    Dim i As Long
    Dim pola As Variant
    Dim op As Operacja
    Dim bledy As String
    Dim wczytane As Long, pominiete As Long
    Dim raport As String
    Dim poprawna As Boolean

    On Error GoTo Blad

    sciezka = ZapytajOPlikDoOdczytu()
    If Len(sciezka) = 0 Then Exit Sub

    If Not Potwierdz("Import dopisze operacje z pliku do kartoteki." & vbCrLf & vbCrLf & _
                     "Przed importem system wykona kopię zapasową." & vbCrLf & vbCrLf & _
                     "Kontynuować?") Then Exit Sub

    UtworzKopieZapasowa True

    Set strumien = CreateObject("ADODB.Stream")
    strumien.Type = 2
    strumien.Charset = "UTF-8"
    strumien.Open
    strumien.LoadFromFile sciezka
    tresc = strumien.ReadText
    strumien.Close

    tresc = Replace$(tresc, vbCrLf, vbLf)
    tresc = Replace$(tresc, vbCr, vbLf)
    linie = Split(tresc, vbLf)

    WylaczEkran

    For i = LBound(linie) + 1 To UBound(linie)   ' pomijamy wiersz nagłówka
        If Len(Trim$(CStr(linie(i)))) > 0 Then
            pola = PodzielLinieCsv(CStr(linie(i)))

            If UBound(pola) >= kolStatus - 1 Then
                ZbudujOperacjeZPol pola, op

                If SprawdzOperacjeImportu(op, bledy) Then
                    ZapiszWiersz op
                    wczytane = wczytane + 1
                Else
                    pominiete = pominiete + 1
                    If pominiete <= 10 Then
                        raport = raport & "Wiersz " & (i + 1) & ": " & _
                                 Replace$(bledy, vbCrLf, " ") & vbCrLf
                    End If
                End If
            Else
                pominiete = pominiete + 1
            End If
        End If
    Next i

    OdswiezNazwaneZakresy
    OdswiezStanMagazynu
    WlaczEkran

    ZapisDoHistorii "IMPORT", "", "", UzytkownikSystemu(), _
                    "Import z " & sciezka & ": wczytano " & wczytane & ", pominięto " & pominiete

    Informacja "Import zakończony." & vbCrLf & vbCrLf & _
               "Wczytanych operacji: " & wczytane & vbCrLf & _
               "Pominiętych wierszy: " & pominiete & _
               IIf(Len(raport) > 0, vbCrLf & vbCrLf & "Pierwsze problemy:" & vbCrLf & raport, "")
    Exit Sub

Blad:
    PokazBlad "import kartoteki"
End Sub

' Import ma łagodniejsze reguły dat - wczytujemy także dane archiwalne.
Private Function SprawdzOperacjeImportu(ByRef op As Operacja, ByRef bledy As String) As Boolean
    bledy = ""

    If Not CzyZnanyTyp(op.Typ) Then
        bledy = "nieznany typ operacji """ & op.Typ & """"
        Exit Function
    End If

    If op.DataOperacji = 0 Then
        bledy = "brak poprawnej daty operacji"
        Exit Function
    End If

    If CzyOperacjaTowarowa(op.Typ) Then
        If Len(Trim$(op.Produkt)) = 0 Then
            bledy = "brak produktu"
            Exit Function
        End If
        If op.Volumen = 0 Then
            bledy = "zerowy wolumen"
            Exit Function
        End If
    End If

    SprawdzOperacjeImportu = True
End Function

' Mapuje pola CSV na strukturę operacji (układ zgodny z kolumnami kartoteki).
Private Sub ZbudujOperacjeZPol(ByRef pola As Variant, ByRef op As Operacja)
    Dim poprawna As Boolean

    op.DataZaladunku = DataZTekstu(Pole(pola, kolDataZaladunku), poprawna)
    op.MaDateZaladunku = poprawna
    op.MiejsceZaladunku = Pole(pola, kolMiejsceZaladunku)
    op.DataOperacji = DataZTekstu(Pole(pola, kolDataOperacji), poprawna)
    If Not poprawna Then op.DataOperacji = 0
    op.Dostawca = Pole(pola, kolDostawca)
    op.Typ = UCase$(Pole(pola, kolTypOperacji))
    op.NrWZ = Pole(pola, kolNrWZ)
    op.CzyMagazynowane = UCase$(Pole(pola, kolCzyMagazynowane))
    op.Deklaracja = Pole(pola, kolDeklaracja)
    op.Volumen = LiczbaZTekstu(Pole(pola, kolVolumen), 0)
    op.Jednostka = UCase$(Pole(pola, kolJednostka))
    op.CenaZakupu = LiczbaZTekstu(Pole(pola, kolCenaZakupu), 0)
    op.CenaSprzedazy = LiczbaZTekstu(Pole(pola, kolCenaSprzedazy), 0)
    op.Produkt = Pole(pola, kolProdukt)
    op.RodzajZrebki = Pole(pola, kolRodzajZrebki)
    op.Rabanie = Pole(pola, kolRabanie)
    op.KosztRabania = LiczbaZTekstu(Pole(pola, kolKosztRabania), 0)
    op.Przewoznik = Pole(pola, kolPrzewoznik)
    op.NrRejestracyjny = NormalizujNrRejestracyjny(Pole(pola, kolNrRejestracyjny))
    op.Odleglosc = LiczbaZTekstu(Pole(pola, kolOdleglosc), 0)
    op.StawkaKm = LiczbaZTekstu(Pole(pola, kolStawkaKm), 0)
    op.KosztTransportu = LiczbaZTekstu(Pole(pola, kolKosztTransportu), 0)
    op.Odbiorca = Pole(pola, kolOdbiorca)
    op.MiejscePochodzenia = Pole(pola, kolMiejscePochodzenia)
    op.Uwagi = Pole(pola, kolUwagi)
    op.Utworzyl = Pole(pola, kolUtworzyl)
    If Len(Trim$(op.Utworzyl)) = 0 Then op.Utworzyl = "Import CSV"
    op.Status = ST_AKTYWNY
End Sub

Private Function Pole(ByRef pola As Variant, ByVal numer As Long) As String
    If numer - 1 <= UBound(pola) And numer - 1 >= LBound(pola) Then
        Pole = Trim$(CStr(pola(numer - 1)))
    Else
        Pole = ""
    End If
End Function

' Dzieli wiersz CSV z poszanowaniem cudzysłowów.
Public Function PodzielLinieCsv(ByVal linia As String) As Variant
    Dim wynik() As String
    Dim bufor As String
    Dim i As Long
    Dim znak As String
    Dim wCudzyslowie As Boolean
    Dim ile As Long

    ReDim wynik(0 To 200)

    For i = 1 To Len(linia)
        znak = Mid$(linia, i, 1)

        If wCudzyslowie Then
            If znak = """" Then
                If i < Len(linia) And Mid$(linia, i + 1, 1) = """" Then
                    bufor = bufor & """"
                    i = i + 1
                Else
                    wCudzyslowie = False
                End If
            Else
                bufor = bufor & znak
            End If
        Else
            If znak = """" Then
                wCudzyslowie = True
            ElseIf znak = SEPARATOR Then
                If ile > UBound(wynik) Then ReDim Preserve wynik(0 To ile + 50)
                wynik(ile) = bufor
                ile = ile + 1
                bufor = ""
            Else
                bufor = bufor & znak
            End If
        End If
    Next i

    If ile > UBound(wynik) Then ReDim Preserve wynik(0 To ile + 1)
    wynik(ile) = bufor
    ReDim Preserve wynik(0 To ile)

    PodzielLinieCsv = wynik
End Function

' ----------------------------------------------------------------------
'  Okna wyboru plików
' ----------------------------------------------------------------------

Public Function ZapytajOPlikDoZapisu(ByVal domyslnaNazwa As String) As String
    Dim wybrana As Variant

    wybrana = Application.GetSaveAsFilename( _
        InitialFileName:=FolderSkoroszytu() & "\" & domyslnaNazwa, _
        FileFilter:="Plik CSV (*.csv),*.csv", _
        Title:=APP_NAZWA & " - zapisz plik")

    If VarType(wybrana) = vbBoolean Then
        ZapytajOPlikDoZapisu = ""
    Else
        ZapytajOPlikDoZapisu = CStr(wybrana)
    End If
End Function

Public Function ZapytajOPlikDoOdczytu() As String
    Dim wybrana As Variant

    wybrana = Application.GetOpenFilename( _
        FileFilter:="Plik CSV (*.csv),*.csv", _
        Title:=APP_NAZWA & " - wybierz plik do importu")

    If VarType(wybrana) = vbBoolean Then
        ZapytajOPlikDoOdczytu = ""
    Else
        ZapytajOPlikDoOdczytu = CStr(wybrana)
    End If
End Function
