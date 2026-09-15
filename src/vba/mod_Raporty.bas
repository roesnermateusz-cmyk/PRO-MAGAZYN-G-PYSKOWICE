Option Explicit

' ======================================================================
'  PRO-MAGAZYN  |  mod_Raporty
'  Raporty miesięczne i roczne z filtrowaniem historii operacji.
'
'  Raport buduje się w arkuszu RAPORTY na podstawie filtrów wpisanych
'  w jego nagłówku (rok, miesiąc, typ operacji, produkt, kontrahent).
' ======================================================================

' Komórki filtrów w arkuszu RAPORTY.
Private Const F_ROK As String = "C3"
Private Const F_MIESIAC As String = "E3"
Private Const F_TYP As String = "G3"
Private Const F_PRODUKT As String = "C4"
Private Const F_KONTRAHENT As String = "E4"
Private Const F_LOKALIZACJA As String = "G4"

Private Const WIERSZ_PODSUMOWANIA As Long = 7
Private Const WIERSZ_NAGLOWKA As Long = 10
Private Const PIERWSZY_WIERSZ As Long = 11

' ----------------------------------------------------------------------
'  Raport szczegółowy wg filtrów
' ----------------------------------------------------------------------

Public Sub GenerujRaport()
    Dim tabela As ListObject
    Dim dane As Variant
    Dim wiersz As Long
    Dim docelowy As Long
    Dim rok As String, miesiac As String, typ As String
    Dim produkt As String, kontrahent As String, lokalizacja As String
    Dim dataOperacji As Date
    Dim sumaMp As Double, sumaT As Double
    Dim sumaZakup As Double, sumaSprzedaz As Double
    Dim sumaTransport As Double, sumaRabanie As Double
    Dim policzone As Long

    On Error GoTo Blad
    WylaczEkran

    rok = Znormalizuj(wsRaporty.Range(F_ROK).Value)
    miesiac = Znormalizuj(wsRaporty.Range(F_MIESIAC).Value)
    typ = Znormalizuj(wsRaporty.Range(F_TYP).Value)
    produkt = Znormalizuj(wsRaporty.Range(F_PRODUKT).Value)
    kontrahent = Znormalizuj(wsRaporty.Range(F_KONTRAHENT).Value)
    lokalizacja = Znormalizuj(wsRaporty.Range(F_LOKALIZACJA).Value)

    WyczyscWynikRaportu

    Set tabela = TabelaDanych()
    If tabela.ListRows.Count = 0 Then
        wsRaporty.Cells(PIERWSZY_WIERSZ, 2).Value = "Kartoteka jest pusta."
        WlaczEkran
        Exit Sub
    End If

    dane = tabela.DataBodyRange.Value
    docelowy = PIERWSZY_WIERSZ

    For wiersz = 1 To UBound(dane, 1)
        If PasujeDoFiltra(dane, wiersz, rok, miesiac, typ, produkt, kontrahent, lokalizacja) Then
            dataOperacji = 0
            If IsDate(dane(wiersz, kolDataOperacji)) Then dataOperacji = CDate(dane(wiersz, kolDataOperacji))

            With wsRaporty
                .Cells(docelowy, 2).Value = dataOperacji
                .Cells(docelowy, 3).Value = dane(wiersz, kolTypOperacji)
                .Cells(docelowy, 4).Value = dane(wiersz, kolProdukt)
                .Cells(docelowy, 5).Value = LiczbaZTekstu(dane(wiersz, kolVolumen), 0)
                .Cells(docelowy, 6).Value = dane(wiersz, kolJednostka)
                .Cells(docelowy, 7).Value = LiczbaZTekstu(dane(wiersz, kolWartosc), 0)
                .Cells(docelowy, 8).Value = dane(wiersz, kolDostawca)
                .Cells(docelowy, 9).Value = dane(wiersz, kolOdbiorca)
                .Cells(docelowy, 10).Value = dane(wiersz, kolPrzewoznik)
                .Cells(docelowy, 11).Value = LiczbaZTekstu(dane(wiersz, kolKosztTransportu), 0)
                .Cells(docelowy, 12).Value = dane(wiersz, kolNrWZ)
                .Cells(docelowy, 13).Value = dane(wiersz, kolUtworzyl)
                .Cells(docelowy, 14).Value = dane(wiersz, kolStatus)
            End With

            sumaMp = sumaMp + PrzeliczNaMp(LiczbaZTekstu(dane(wiersz, kolVolumen), 0), _
                                           CStr(dane(wiersz, kolJednostka)))
            sumaT = sumaT + PrzeliczNaTony(LiczbaZTekstu(dane(wiersz, kolVolumen), 0), _
                                           CStr(dane(wiersz, kolJednostka)))

            Select Case KluczPorownania(dane(wiersz, kolTypOperacji))
                Case UCase$(OP_ZAKUP)
                    sumaZakup = sumaZakup + LiczbaZTekstu(dane(wiersz, kolWartosc), 0)
                Case UCase$(OP_SPRZEDAZ)
                    sumaSprzedaz = sumaSprzedaz + LiczbaZTekstu(dane(wiersz, kolWartosc), 0)
            End Select

            sumaTransport = sumaTransport + LiczbaZTekstu(dane(wiersz, kolKosztTransportu), 0)
            sumaRabanie = sumaRabanie + LiczbaZTekstu(dane(wiersz, kolKosztRabania), 0) * _
                          PrzeliczNaMp(LiczbaZTekstu(dane(wiersz, kolVolumen), 0), _
                                       CStr(dane(wiersz, kolJednostka)))

            docelowy = docelowy + 1
            policzone = policzone + 1
        End If
    Next wiersz

    ZapiszPodsumowanie policzone, sumaMp, sumaT, sumaZakup, sumaSprzedaz, sumaTransport, sumaRabanie
    FormatujWynik docelowy - 1

    WlaczEkran

    If policzone = 0 Then
        Informacja "Żadna operacja nie pasuje do wybranych filtrów."
    End If
    Exit Sub

Blad:
    PokazBlad "generowanie raportu"
End Sub

Private Function PasujeDoFiltra(ByRef dane As Variant, ByVal wiersz As Long, _
                                ByVal rok As String, ByVal miesiac As String, _
                                ByVal typ As String, ByVal produkt As String, _
                                ByVal kontrahent As String, ByVal lokalizacja As String) As Boolean
    Dim dataOperacji As Date

    If Not IsDate(dane(wiersz, kolDataOperacji)) Then Exit Function
    dataOperacji = CDate(dane(wiersz, kolDataOperacji))

    If Len(rok) > 0 And UCase$(rok) <> "WSZYSTKIE" Then
        If CStr(Year(dataOperacji)) <> rok Then Exit Function
    End If

    If Len(miesiac) > 0 And UCase$(miesiac) <> "WSZYSTKIE" Then
        If UCase$(NazwaMiesiaca(Month(dataOperacji))) <> UCase$(miesiac) Then Exit Function
    End If

    If Len(typ) > 0 And UCase$(typ) <> "WSZYSTKIE" Then
        If KluczPorownania(dane(wiersz, kolTypOperacji)) <> UCase$(typ) Then Exit Function
    End If

    If Len(produkt) > 0 And UCase$(produkt) <> "WSZYSTKIE" Then
        If KluczPorownania(dane(wiersz, kolProdukt)) <> UCase$(produkt) Then Exit Function
    End If

    If Len(kontrahent) > 0 And UCase$(kontrahent) <> "WSZYSTKIE" Then
        If KluczPorownania(dane(wiersz, kolDostawca)) <> UCase$(kontrahent) And _
           KluczPorownania(dane(wiersz, kolOdbiorca)) <> UCase$(kontrahent) Then Exit Function
    End If

    If Len(lokalizacja) > 0 And UCase$(lokalizacja) <> "WSZYSTKIE" Then
        If KluczPorownania(dane(wiersz, kolMiejsceZaladunku)) <> UCase$(lokalizacja) And _
           KluczPorownania(dane(wiersz, kolMiejscePochodzenia)) <> UCase$(lokalizacja) Then Exit Function
    End If

    PasujeDoFiltra = True
End Function

Private Sub ZapiszPodsumowanie(ByVal ile As Long, ByVal sumaMp As Double, ByVal sumaT As Double, _
                               ByVal sumaZakup As Double, ByVal sumaSprzedaz As Double, _
                               ByVal sumaTransport As Double, ByVal sumaRabanie As Double)
    With wsRaporty
        .Cells(WIERSZ_PODSUMOWANIA, 3).Value = ile
        .Cells(WIERSZ_PODSUMOWANIA, 5).Value = ZaokraglijIlosc(sumaMp)
        .Cells(WIERSZ_PODSUMOWANIA, 7).Value = ZaokraglijIlosc(sumaT)
        .Cells(WIERSZ_PODSUMOWANIA, 9).Value = ZaokraglijKwote(sumaZakup)
        .Cells(WIERSZ_PODSUMOWANIA, 11).Value = ZaokraglijKwote(sumaSprzedaz)
        .Cells(WIERSZ_PODSUMOWANIA, 13).Value = ZaokraglijKwote(sumaTransport)
        .Cells(WIERSZ_PODSUMOWANIA + 1, 13).Value = ZaokraglijKwote(sumaRabanie)
        .Cells(WIERSZ_PODSUMOWANIA + 1, 11).Value = ZaokraglijKwote(sumaSprzedaz - sumaZakup - sumaTransport - sumaRabanie)
    End With
End Sub

Private Sub WyczyscWynikRaportu()
    wsRaporty.Range(wsRaporty.Cells(PIERWSZY_WIERSZ, 2), _
                    wsRaporty.Cells(wsRaporty.Rows.Count, 14)).ClearContents
End Sub

Private Sub FormatujWynik(ByVal ostatniWiersz As Long)
    If ostatniWiersz < PIERWSZY_WIERSZ Then Exit Sub

    wsRaporty.Range(wsRaporty.Cells(PIERWSZY_WIERSZ, 2), _
                    wsRaporty.Cells(ostatniWiersz, 2)).NumberFormat = "dd.mm.yyyy"
    wsRaporty.Range(wsRaporty.Cells(PIERWSZY_WIERSZ, 5), _
                    wsRaporty.Cells(ostatniWiersz, 5)).NumberFormat = "# ##0.000"
    wsRaporty.Range(wsRaporty.Cells(PIERWSZY_WIERSZ, 7), _
                    wsRaporty.Cells(ostatniWiersz, 7)).NumberFormat = "# ##0.00 zł"
    wsRaporty.Range(wsRaporty.Cells(PIERWSZY_WIERSZ, 11), _
                    wsRaporty.Cells(ostatniWiersz, 11)).NumberFormat = "# ##0.00 zł"
End Sub

' ----------------------------------------------------------------------
'  Zestawienie roczne (12 miesięcy w jednym widoku)
' ----------------------------------------------------------------------

Public Sub RaportRoczny()
    Dim tabela As ListObject
    Dim dane As Variant
    Dim wiersz As Long
    Dim miesiac As Long
    Dim rok As Long
    Dim zakup(1 To 12) As Double
    Dim sprzedaz(1 To 12) As Double
    Dim transport(1 To 12) As Double
    Dim wolumen(1 To 12) As Double
    Dim liczba(1 To 12) As Long
    Dim dataOperacji As Date
    Dim docelowy As Long

    On Error GoTo Blad

    rok = CLng(LiczbaZTekstu(wsRaporty.Range(F_ROK).Value, Year(Date)))
    If rok < 2000 Then rok = Year(Date)

    WylaczEkran
    WyczyscWynikRaportu

    Set tabela = TabelaDanych()
    If tabela.ListRows.Count > 0 Then
        dane = tabela.DataBodyRange.Value

        For wiersz = 1 To UBound(dane, 1)
            If IsDate(dane(wiersz, kolDataOperacji)) Then
                dataOperacji = CDate(dane(wiersz, kolDataOperacji))
                If Year(dataOperacji) = rok Then
                    If KluczPorownania(dane(wiersz, kolStatus)) <> UCase$(ST_SKORYGOWANY) Then
                        miesiac = Month(dataOperacji)
                        liczba(miesiac) = liczba(miesiac) + 1
                        wolumen(miesiac) = wolumen(miesiac) + _
                            PrzeliczNaMp(LiczbaZTekstu(dane(wiersz, kolVolumen), 0), _
                                         CStr(dane(wiersz, kolJednostka)))
                        transport(miesiac) = transport(miesiac) + _
                            LiczbaZTekstu(dane(wiersz, kolKosztTransportu), 0)

                        Select Case KluczPorownania(dane(wiersz, kolTypOperacji))
                            Case UCase$(OP_ZAKUP)
                                zakup(miesiac) = zakup(miesiac) + LiczbaZTekstu(dane(wiersz, kolWartosc), 0)
                            Case UCase$(OP_SPRZEDAZ)
                                sprzedaz(miesiac) = sprzedaz(miesiac) + LiczbaZTekstu(dane(wiersz, kolWartosc), 0)
                        End Select
                    End If
                End If
            End If
        Next wiersz
    End If

    docelowy = PIERWSZY_WIERSZ
    For miesiac = 1 To 12
        With wsRaporty
            .Cells(docelowy, 2).Value = NazwaMiesiaca(miesiac)
            .Cells(docelowy, 3).Value = liczba(miesiac)
            .Cells(docelowy, 4).Value = "operacji"
            .Cells(docelowy, 5).Value = ZaokraglijIlosc(wolumen(miesiac))
            .Cells(docelowy, 6).Value = "MP"
            .Cells(docelowy, 7).Value = ZaokraglijKwote(zakup(miesiac))
            .Cells(docelowy, 8).Value = "zakup"
            .Cells(docelowy, 9).Value = ZaokraglijKwote(sprzedaz(miesiac))
            .Cells(docelowy, 10).Value = "sprzedaż"
            .Cells(docelowy, 11).Value = ZaokraglijKwote(transport(miesiac))
            .Cells(docelowy, 12).Value = "transport"
            .Cells(docelowy, 13).Value = ZaokraglijKwote(sprzedaz(miesiac) - zakup(miesiac) - transport(miesiac))
            .Cells(docelowy, 14).Value = "marża"
        End With
        docelowy = docelowy + 1
    Next miesiac

    wsRaporty.Range(wsRaporty.Cells(PIERWSZY_WIERSZ, 7), _
                    wsRaporty.Cells(docelowy - 1, 7)).NumberFormat = "# ##0.00 zł"
    wsRaporty.Range(wsRaporty.Cells(PIERWSZY_WIERSZ, 9), _
                    wsRaporty.Cells(docelowy - 1, 9)).NumberFormat = "# ##0.00 zł"
    wsRaporty.Range(wsRaporty.Cells(PIERWSZY_WIERSZ, 11), _
                    wsRaporty.Cells(docelowy - 1, 11)).NumberFormat = "# ##0.00 zł"
    wsRaporty.Range(wsRaporty.Cells(PIERWSZY_WIERSZ, 13), _
                    wsRaporty.Cells(docelowy - 1, 13)).NumberFormat = "# ##0.00 zł"

    WlaczEkran
    Informacja "Zestawienie roczne " & rok & " gotowe."
    Exit Sub

Blad:
    PokazBlad "zestawienie roczne"
End Sub

' ----------------------------------------------------------------------
'  Raport kosztów transportu
' ----------------------------------------------------------------------

' Zestawienie przewoźników: liczba kursów, kilometry, koszt, średnia stawka.
Public Sub RaportTransportu()
    Dim tabela As ListObject
    Dim dane As Variant
    Dim wiersz As Long
    Dim kursy As Object, kilometry As Object, koszty As Object
    Dim przewoznik As String
    Dim klucz As Variant
    Dim docelowy As Long

    On Error GoTo Blad
    WylaczEkran
    WyczyscWynikRaportu

    Set kursy = CreateObject("Scripting.Dictionary")
    Set kilometry = CreateObject("Scripting.Dictionary")
    Set koszty = CreateObject("Scripting.Dictionary")

    Set tabela = TabelaDanych()
    If tabela.ListRows.Count > 0 Then
        dane = tabela.DataBodyRange.Value

        For wiersz = 1 To UBound(dane, 1)
            przewoznik = Znormalizuj(dane(wiersz, kolPrzewoznik))
            If Len(przewoznik) > 0 Then
                If Not kursy.Exists(przewoznik) Then
                    kursy.Add przewoznik, 0
                    kilometry.Add przewoznik, 0#
                    koszty.Add przewoznik, 0#
                End If
                kursy(przewoznik) = kursy(przewoznik) + 1
                kilometry(przewoznik) = kilometry(przewoznik) + LiczbaZTekstu(dane(wiersz, kolOdleglosc), 0)
                koszty(przewoznik) = koszty(przewoznik) + LiczbaZTekstu(dane(wiersz, kolKosztTransportu), 0)
            End If
        Next wiersz
    End If

    docelowy = PIERWSZY_WIERSZ
    For Each klucz In kursy.Keys
        With wsRaporty
            .Cells(docelowy, 2).Value = klucz
            .Cells(docelowy, 3).Value = kursy(klucz)
            .Cells(docelowy, 4).Value = "kursów"
            .Cells(docelowy, 5).Value = ZaokraglijIlosc(kilometry(klucz))
            .Cells(docelowy, 6).Value = "km"
            .Cells(docelowy, 7).Value = ZaokraglijKwote(koszty(klucz))
            .Cells(docelowy, 8).Value = "koszt"
            If kilometry(klucz) > 0 Then
                .Cells(docelowy, 9).Value = ZaokraglijKwote(koszty(klucz) / kilometry(klucz))
            End If
            .Cells(docelowy, 10).Value = "zł/km (średnio)"
            .Cells(docelowy, 11).Value = TypTransportu(CStr(klucz))
        End With
        docelowy = docelowy + 1
    Next klucz

    wsRaporty.Range(wsRaporty.Cells(PIERWSZY_WIERSZ, 7), _
                    wsRaporty.Cells(docelowy - 1, 7)).NumberFormat = "# ##0.00 zł"
    wsRaporty.Range(wsRaporty.Cells(PIERWSZY_WIERSZ, 9), _
                    wsRaporty.Cells(docelowy - 1, 9)).NumberFormat = "# ##0.00 zł"

    WlaczEkran
    Informacja "Zestawienie transportu gotowe. Przewoźników: " & kursy.Count & "."
    Exit Sub

Blad:
    PokazBlad "zestawienie transportu"
End Sub

' Klasyfikuje przewoźnika jako własnego albo zewnętrznego.
'
' POPRAWKA: poprzednia formuła szukała wyłącznie fraz "ric pl" i
' "wojciechowski", przez co przewoźnicy zapisani jako "własny (Wilczak)",
' "własny (Kretek)" czy "własny (Chrzan)" byli klasyfikowani jako
' ZEWNĘTRZNI - dotyczyło to 196 wierszy kartoteki.
Public Function TypTransportu(ByVal przewoznik As String) As String
    Dim nazwa As String

    nazwa = LCase$(Trim$(przewoznik))

    If Len(nazwa) = 0 Then
        TypTransportu = ""
    ElseIf nazwa = "brak" Then
        TypTransportu = "Brak"
    ElseIf InStr(nazwa, "własn") > 0 Or InStr(nazwa, "wlasn") > 0 Then
        TypTransportu = "Własny"
    ElseIf InStr(nazwa, "wojciechowski") > 0 Then
        TypTransportu = "Własny"
    Else
        TypTransportu = "Zewnętrzny"
    End If
End Function
