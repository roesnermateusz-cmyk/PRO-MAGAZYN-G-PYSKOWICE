Option Explicit

' ======================================================================
'  PRO-MAGAZYN  |  mod_Magazyn
'  Wyliczanie stanu magazynowego w rozbiciu na lokalizacje i produkty.
'
'  POPRAWKI WZGLĘDEM POPRZEDNIEJ WERSJI
'  ------------------------------------
'  1. Przesunięcia MM są wreszcie uwzględniane: zdejmują towar z magazynu
'     źródłowego i dokładają do docelowego. Poprzednia formuła pomijała
'     typ MM, więc 78 przesunięć w kartotece nie zmieniało stanów.
'  2. Przeliczenie M3 -> tony szło wcześniej ścieżką "jak MP" (x 0,33),
'     pomijając przelicznik M3 -> MP. Teraz jest spójne: M3 -> MP -> tony.
'  3. Stan liczony jest per lokalizacja, a nie tylko globalnie.
' ======================================================================

Private Const WIERSZ_NAGLOWKA As Long = 6
Private Const PIERWSZY_WIERSZ As Long = 7

' ----------------------------------------------------------------------
'  Przeliczniki jednostek
' ----------------------------------------------------------------------

' Sprowadza dowolną jednostkę do metrów przestrzennych (MP).
Public Function PrzeliczNaMp(ByVal volumen As Double, ByVal jednostka As String) As Double
    Dim j As String

    j = UCase$(Trim$(jednostka))

    Select Case True
        Case InStr(j, "MP") > 0
            PrzeliczNaMp = volumen
        Case InStr(j, "TON") > 0, j = "T"
            PrzeliczNaMp = volumen / PrzelicznikMpNaTone()
        Case InStr(j, "M3") > 0
            PrzeliczNaMp = volumen * PrzelicznikM3NaMp()
        Case InStr(j, "GJ") > 0
            PrzeliczNaMp = volumen / PrzelicznikGjNaTone() / PrzelicznikMpNaTone()
        Case Else
            PrzeliczNaMp = volumen
    End Select
End Function

' Sprowadza dowolną jednostkę do ton.
Public Function PrzeliczNaTony(ByVal volumen As Double, ByVal jednostka As String) As Double
    Dim j As String

    j = UCase$(Trim$(jednostka))

    Select Case True
        Case InStr(j, "TON") > 0, j = "T"
            PrzeliczNaTony = volumen
        Case InStr(j, "GJ") > 0
            PrzeliczNaTony = volumen / PrzelicznikGjNaTone()
        Case Else
            ' MP, M3 i jednostki nieznane najpierw na MP, potem na tony.
            PrzeliczNaTony = PrzeliczNaMp(volumen, jednostka) * PrzelicznikMpNaTone()
    End Select
End Function

Public Function PrzeliczNaGj(ByVal volumen As Double, ByVal jednostka As String) As Double
    PrzeliczNaGj = PrzeliczNaTony(volumen, jednostka) * PrzelicznikGjNaTone()
End Function

' ----------------------------------------------------------------------
'  Kierunek ruchu magazynowego
' ----------------------------------------------------------------------

' Zwraca -1, 0 lub +1 dla magazynu wskazanego przez "lokalizacja".
Public Function KierunekRuchu(ByVal typ As String, ByVal czyMagazynowane As String, _
                              ByVal dostawca As String, ByVal odbiorca As String, _
                              ByVal lokalizacja As String) As Long
    Dim t As String

    t = UCase$(Trim$(typ))

    ' Operacja transportowa nie przesuwa towaru.
    If t = UCase$(OP_TRANSPORT) Then Exit Function

    ' Przesunięcie międzymagazynowe działa zawsze dwustronnie.
    If t = UCase$(OP_MM) Then
        If KluczPorownania(odbiorca) = KluczPorownania(lokalizacja) Then
            KierunekRuchu = 1
        ElseIf KluczPorownania(dostawca) = KluczPorownania(lokalizacja) Then
            KierunekRuchu = -1
        End If
        Exit Function
    End If

    ' Pozostałe typy zmieniają stan tylko wtedy, gdy wiersz jest oznaczony
    ' jako magazynowany. Operacje przelotowe (zakup od razu na sprzedaż)
    ' mają "NIE" i celowo nie ruszają stanu.
    If UCase$(Trim$(czyMagazynowane)) <> "TAK" Then Exit Function

    Select Case t
        Case UCase$(OP_ZAKUP), UCase$(OP_PRODUKCJA)
            If KluczPorownania(odbiorca) = KluczPorownania(lokalizacja) Then KierunekRuchu = 1
        Case UCase$(OP_SPRZEDAZ), UCase$(OP_ZUZYCIE)
            If KluczPorownania(dostawca) = KluczPorownania(lokalizacja) Then KierunekRuchu = -1
    End Select
End Function

' ----------------------------------------------------------------------
'  Raport stanu magazynowego
' ----------------------------------------------------------------------

' Przelicza stany i wypełnia arkusz MAGAZYN.
Public Sub OdswiezStanMagazynu()
    Dim tabela As ListObject
    Dim dane As Variant
    Dim wiersz As Long
    Dim stanyMp As Object
    Dim stanyT As Object
    Dim wartosci As Object
    Dim ostatnie As Object
    Dim klucz As String
    Dim lokalizacja As String
    Dim produkt As String
    Dim kierunek As Long
    Dim ilosc As Double

    On Error GoTo Blad
    WylaczEkran

    Set stanyMp = CreateObject("Scripting.Dictionary")
    Set stanyT = CreateObject("Scripting.Dictionary")
    Set wartosci = CreateObject("Scripting.Dictionary")
    Set ostatnie = CreateObject("Scripting.Dictionary")

    Set tabela = TabelaDanych()

    If tabela.ListRows.Count > 0 Then
        dane = tabela.DataBodyRange.Value

        For wiersz = 1 To UBound(dane, 1)
            If KluczPorownania(dane(wiersz, kolStatus)) <> UCase$(ST_SKORYGOWANY) Then
                produkt = Znormalizuj(dane(wiersz, kolProdukt))
                ilosc = LiczbaZTekstu(dane(wiersz, kolVolumen), 0)

                If Len(produkt) > 0 And ilosc <> 0 Then
                    ' Przychód do magazynu docelowego.
                    lokalizacja = Znormalizuj(dane(wiersz, kolOdbiorca))
                    kierunek = KierunekRuchu(CStr(dane(wiersz, kolTypOperacji)), _
                                             CStr(dane(wiersz, kolCzyMagazynowane)), _
                                             CStr(dane(wiersz, kolDostawca)), _
                                             CStr(dane(wiersz, kolOdbiorca)), lokalizacja)
                    If kierunek <> 0 And Len(lokalizacja) > 0 Then
                        klucz = UCase$(lokalizacja) & "|" & UCase$(produkt)
                        DodajDoSumy stanyMp, klucz, kierunek * PrzeliczNaMp(ilosc, CStr(dane(wiersz, kolJednostka)))
                        DodajDoSumy stanyT, klucz, kierunek * PrzeliczNaTony(ilosc, CStr(dane(wiersz, kolJednostka)))
                        DodajDoSumy wartosci, klucz, kierunek * LiczbaZTekstu(dane(wiersz, kolWartosc), 0)
                        ZapamietajOpis ostatnie, klucz, lokalizacja, produkt, dane(wiersz, kolDataOperacji)
                    End If

                    ' Rozchód z magazynu źródłowego. Gdy dostawca i odbiorca to
                    ' ten sam magazyn, pomijamy ten krok - inaczej ta sama operacja
                    ' podbiłaby stan dwukrotnie.
                    lokalizacja = Znormalizuj(dane(wiersz, kolDostawca))
                    kierunek = KierunekRuchu(CStr(dane(wiersz, kolTypOperacji)), _
                                             CStr(dane(wiersz, kolCzyMagazynowane)), _
                                             CStr(dane(wiersz, kolDostawca)), _
                                             CStr(dane(wiersz, kolOdbiorca)), lokalizacja)
                    If KluczPorownania(dane(wiersz, kolDostawca)) = _
                       KluczPorownania(dane(wiersz, kolOdbiorca)) Then kierunek = 0
                    If kierunek <> 0 And Len(lokalizacja) > 0 Then
                        klucz = UCase$(lokalizacja) & "|" & UCase$(produkt)
                        DodajDoSumy stanyMp, klucz, kierunek * PrzeliczNaMp(ilosc, CStr(dane(wiersz, kolJednostka)))
                        DodajDoSumy stanyT, klucz, kierunek * PrzeliczNaTony(ilosc, CStr(dane(wiersz, kolJednostka)))
                        ZapamietajOpis ostatnie, klucz, lokalizacja, produkt, dane(wiersz, kolDataOperacji)
                    End If
                End If
            End If
        Next wiersz
    End If

    WypelnijArkuszMagazyn stanyMp, stanyT, wartosci, ostatnie
    WlaczEkran
    Exit Sub

Blad:
    PokazBlad "przeliczanie stanu magazynowego"
End Sub

Private Sub DodajDoSumy(ByRef slownik As Object, ByVal klucz As String, ByVal wartosc As Double)
    If slownik.Exists(klucz) Then
        slownik(klucz) = slownik(klucz) + wartosc
    Else
        slownik.Add klucz, wartosc
    End If
End Sub

Private Sub ZapamietajOpis(ByRef slownik As Object, ByVal klucz As String, _
                           ByVal lokalizacja As String, ByVal produkt As String, _
                           ByVal dataOperacji As Variant)
    Dim opis As Variant

    opis = Array(lokalizacja, produkt, CDate(0))
    If IsDate(dataOperacji) Then opis(2) = CDate(dataOperacji)

    If slownik.Exists(klucz) Then
        If opis(2) > slownik(klucz)(2) Then slownik(klucz) = opis
    Else
        slownik.Add klucz, opis
    End If
End Sub

Private Sub WypelnijArkuszMagazyn(ByRef stanyMp As Object, ByRef stanyT As Object, _
                                  ByRef wartosci As Object, ByRef ostatnie As Object)
    Dim klucze As Variant
    Dim posortowane() As String
    Dim i As Long, j As Long
    Dim temp As String
    Dim wiersz As Long
    Dim klucz As String
    Dim sumaMp As Double, sumaT As Double, sumaWartosc As Double
    Dim ujemne As Long

    ' Czyścimy poprzedni wynik.
    wsMagazyn.Range(wsMagazyn.Cells(PIERWSZY_WIERSZ, 2), _
                    wsMagazyn.Cells(wsMagazyn.Rows.Count, 8)).ClearContents

    If stanyMp.Count = 0 Then
        wsMagazyn.Cells(PIERWSZY_WIERSZ, 2).Value = "Brak danych - kartoteka jest pusta."
        Exit Sub
    End If

    klucze = stanyMp.Keys
    ReDim posortowane(0 To UBound(klucze))
    For i = 0 To UBound(klucze)
        posortowane(i) = CStr(klucze(i))
    Next i

    ' Sortowanie po lokalizacji i produkcie (klucz ma format LOKALIZACJA|PRODUKT).
    For i = 0 To UBound(posortowane) - 1
        For j = i + 1 To UBound(posortowane)
            If posortowane(i) > posortowane(j) Then
                temp = posortowane(i)
                posortowane(i) = posortowane(j)
                posortowane(j) = temp
            End If
        Next j
    Next i

    wiersz = PIERWSZY_WIERSZ
    For i = 0 To UBound(posortowane)
        klucz = posortowane(i)
        ' Pomijamy pozycje wyzerowane - nie zaśmiecają raportu.
        If Abs(stanyMp(klucz)) > 0.0001 Then
            wsMagazyn.Cells(wiersz, 2).Value = ostatnie(klucz)(0)
            wsMagazyn.Cells(wiersz, 3).Value = ostatnie(klucz)(1)
            wsMagazyn.Cells(wiersz, 4).Value = ZaokraglijIlosc(stanyMp(klucz))
            wsMagazyn.Cells(wiersz, 5).Value = ZaokraglijIlosc(stanyT(klucz))
            wsMagazyn.Cells(wiersz, 6).Value = ZaokraglijIlosc(stanyT(klucz) * PrzelicznikGjNaTone())
            If wartosci.Exists(klucz) Then
                wsMagazyn.Cells(wiersz, 7).Value = ZaokraglijKwote(wartosci(klucz))
                sumaWartosc = sumaWartosc + wartosci(klucz)
            End If
            If ostatnie(klucz)(2) > 0 Then wsMagazyn.Cells(wiersz, 8).Value = ostatnie(klucz)(2)

            ' Stan ujemny oznacza lukę w ewidencji (np. wydania z magazynu,
            ' do którego towar nigdy formalnie nie wpłynął). Wyróżniamy go,
            ' żeby nie przeszedł niezauważony.
            If stanyMp(klucz) < 0 Then
                wsMagazyn.Range(wsMagazyn.Cells(wiersz, 2), _
                                wsMagazyn.Cells(wiersz, 8)).Interior.Color = RGB(255, 226, 226)
            Else
                wsMagazyn.Range(wsMagazyn.Cells(wiersz, 2), _
                                wsMagazyn.Cells(wiersz, 8)).Interior.ColorIndex = xlColorIndexNone
            End If

            sumaMp = sumaMp + stanyMp(klucz)
            sumaT = sumaT + stanyT(klucz)
            If stanyMp(klucz) < 0 Then ujemne = ujemne + 1
            wiersz = wiersz + 1
        End If
    Next i

    ' Kafelki podsumowania w wierszu 4.
    wsMagazyn.Cells(4, 3).Value = ZaokraglijIlosc(sumaMp)
    wsMagazyn.Cells(4, 5).Value = ZaokraglijIlosc(sumaT)
    wsMagazyn.Cells(4, 7).Value = ZaokraglijIlosc(sumaT * PrzelicznikGjNaTone())
    wsMagazyn.Cells(2, 7).Value = Now

    If ujemne > 0 Then
        wsMagazyn.Cells(2, 2).Value = "Uwaga: pozycji ze stanem ujemnym: " & ujemne & _
                                      " - sprawdź, czy przyjęcia trafiają do właściwego magazynu."
        wsMagazyn.Cells(2, 2).Font.Color = RGB(180, 30, 30)
    Else
        wsMagazyn.Cells(2, 2).ClearContents
    End If

    FormatujArkuszMagazyn wiersz - 1
End Sub

Private Sub FormatujArkuszMagazyn(ByVal ostatniWiersz As Long)
    If ostatniWiersz < PIERWSZY_WIERSZ Then Exit Sub

    With wsMagazyn.Range(wsMagazyn.Cells(PIERWSZY_WIERSZ, 4), wsMagazyn.Cells(ostatniWiersz, 6))
        .NumberFormat = "# ##0.000"
    End With
    With wsMagazyn.Range(wsMagazyn.Cells(PIERWSZY_WIERSZ, 7), wsMagazyn.Cells(ostatniWiersz, 7))
        .NumberFormat = "# ##0.00 zł"
    End With
    With wsMagazyn.Range(wsMagazyn.Cells(PIERWSZY_WIERSZ, 8), wsMagazyn.Cells(ostatniWiersz, 8))
        .NumberFormat = "dd.mm.yyyy"
    End With
    With wsMagazyn.Range(wsMagazyn.Cells(PIERWSZY_WIERSZ, 2), wsMagazyn.Cells(ostatniWiersz, 8))
        .Borders(xlEdgeLeft).LineStyle = xlContinuous
        .Borders(xlEdgeRight).LineStyle = xlContinuous
        .Borders(xlInsideVertical).LineStyle = xlContinuous
        .Borders(xlInsideHorizontal).LineStyle = xlContinuous
        .Borders(xlEdgeTop).LineStyle = xlContinuous
        .Borders(xlEdgeBottom).LineStyle = xlContinuous
    End With
End Sub

' Zwraca stan danego produktu w danej lokalizacji (w MP).
Public Function StanProduktu(ByVal lokalizacja As String, ByVal produkt As String) As Double
    Dim tabela As ListObject
    Dim dane As Variant
    Dim wiersz As Long
    Dim kierunek As Long
    Dim suma As Double

    Set tabela = TabelaDanych()
    If tabela.ListRows.Count = 0 Then Exit Function

    dane = tabela.DataBodyRange.Value

    For wiersz = 1 To UBound(dane, 1)
        If KluczPorownania(dane(wiersz, kolStatus)) <> UCase$(ST_SKORYGOWANY) Then
            If KluczPorownania(dane(wiersz, kolProdukt)) = KluczPorownania(produkt) Then
                kierunek = KierunekRuchu(CStr(dane(wiersz, kolTypOperacji)), _
                                         CStr(dane(wiersz, kolCzyMagazynowane)), _
                                         CStr(dane(wiersz, kolDostawca)), _
                                         CStr(dane(wiersz, kolOdbiorca)), lokalizacja)
                If kierunek <> 0 Then
                    suma = suma + kierunek * PrzeliczNaMp(LiczbaZTekstu(dane(wiersz, kolVolumen), 0), _
                                                          CStr(dane(wiersz, kolJednostka)))
                End If
            End If
        End If
    Next wiersz

    StanProduktu = ZaokraglijIlosc(suma)
End Function
