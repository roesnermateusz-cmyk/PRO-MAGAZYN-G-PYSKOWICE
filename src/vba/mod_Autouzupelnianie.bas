Option Explicit

' ======================================================================
'  PRO-MAGAZYN  |  mod_Autouzupelnianie
'  Propozycje uzupełnienia kolumn na podstawie historii operacji.
'
'  System uczy się z kartoteki: jeżeli dany przewoźnik zwykle jeździ
'  konkretnym pojazdem, a dostawca dostarcza konkretny produkt, to po
'  wybraniu jednej wartości pozostałe pola wypełniają się propozycją.
'
'  Propozycje są nieinwazyjne - nadpisują wyłącznie pola puste.
' ======================================================================

' Zwraca najczęstszą wartość kolumny "szukana" dla wierszy, w których
' kolumna "wedlug" ma zadaną wartość. Pusty tekst, gdy brak danych.
Public Function NajczestszaWartosc(ByVal kolumnaWedlug As Long, ByVal wartoscWedlug As String, _
                                   ByVal kolumnaSzukana As Long) As String
    Dim tabela As ListObject
    Dim dane As Variant
    Dim wiersz As Long
    Dim licznik As Object
    Dim pisownia As Object
    Dim klucz As String
    Dim wartosc As String
    Dim najlepszy As String
    Dim najlepszaLiczba As Long

    If Len(Trim$(wartoscWedlug)) = 0 Then Exit Function

    Set tabela = TabelaDanych()
    If tabela.ListRows.Count = 0 Then Exit Function

    Set licznik = CreateObject("Scripting.Dictionary")
    Set pisownia = CreateObject("Scripting.Dictionary")
    dane = tabela.DataBodyRange.Value

    For wiersz = 1 To UBound(dane, 1)
        If KluczPorownania(dane(wiersz, kolumnaWedlug)) = KluczPorownania(wartoscWedlug) Then
            wartosc = Znormalizuj(dane(wiersz, kolumnaSzukana))
            If Len(wartosc) > 0 Then
                klucz = UCase$(wartosc)
                If licznik.Exists(klucz) Then
                    licznik(klucz) = licznik(klucz) + 1
                Else
                    licznik.Add klucz, 1
                    ' Zapamiętujemy oryginalną pisownię pierwszego wystąpienia.
                    pisownia.Add klucz, wartosc
                End If
                If licznik(klucz) > najlepszaLiczba Then
                    najlepszaLiczba = licznik(klucz)
                    najlepszy = pisownia(klucz)
                End If
            End If
        End If
    Next wiersz

    NajczestszaWartosc = najlepszy
End Function

' Zwraca ostatnio użytą wartość liczbową kolumny dla danego klucza.
Public Function OstatniaLiczba(ByVal kolumnaWedlug As Long, ByVal wartoscWedlug As String, _
                               ByVal kolumnaSzukana As Long) As Double
    Dim tabela As ListObject
    Dim dane As Variant
    Dim wiersz As Long

    If Len(Trim$(wartoscWedlug)) = 0 Then Exit Function

    Set tabela = TabelaDanych()
    If tabela.ListRows.Count = 0 Then Exit Function

    dane = tabela.DataBodyRange.Value

    For wiersz = UBound(dane, 1) To 1 Step -1
        If KluczPorownania(dane(wiersz, kolumnaWedlug)) = KluczPorownania(wartoscWedlug) Then
            If LiczbaZTekstu(dane(wiersz, kolumnaSzukana), 0) > 0 Then
                OstatniaLiczba = LiczbaZTekstu(dane(wiersz, kolumnaSzukana), 0)
                Exit Function
            End If
        End If
    Next wiersz
End Function

' ----------------------------------------------------------------------
'  Propozycje dla formularza
' ----------------------------------------------------------------------

' Po wyborze przewoźnika: proponuje pojazd i stawkę za kilometr.
Public Sub PodpowiedzDlaPrzewoznika(ByVal przewoznik As String)
    Dim pojazd As String
    Dim stawka As Double

    If Len(Trim$(przewoznik)) = 0 Then Exit Sub

    If Len(Trim$(WartoscPola(POLE_NR_REJ))) = 0 Then
        pojazd = NajczestszaWartosc(kolPrzewoznik, przewoznik, kolNrRejestracyjny)
        If Len(pojazd) > 0 Then UstawWartoscPola POLE_NR_REJ, pojazd
    End If

    If LiczbaZTekstu(WartoscPola(POLE_STAWKA_KM), 0) <= 0 Then
        stawka = OstatniaLiczba(kolPrzewoznik, przewoznik, kolStawkaKm)
        If stawka <= 0 Then stawka = StawkaZaKm()
        UstawWartoscPola POLE_STAWKA_KM, stawka
    End If
End Sub

' Po wyborze dostawcy: proponuje miejsce załadunku, produkt i jednostkę.
Public Sub PodpowiedzDlaDostawcy(ByVal dostawca As String)
    Dim miejsce As String
    Dim produkt As String

    If Len(Trim$(dostawca)) = 0 Then Exit Sub

    If Len(Trim$(WartoscPola(POLE_MIEJSCE_ZAL))) = 0 Then
        miejsce = NajczestszaWartosc(kolDostawca, dostawca, kolMiejsceZaladunku)
        If Len(miejsce) > 0 Then UstawWartoscPola POLE_MIEJSCE_ZAL, miejsce
    End If

    If Len(Trim$(WartoscPola(POLE_PRODUKT))) = 0 Then
        produkt = NajczestszaWartosc(kolDostawca, dostawca, kolProdukt)
        If Len(produkt) > 0 Then
            UstawWartoscPola POLE_PRODUKT, produkt
            PodpowiedzDlaProduktu produkt
        End If
    End If
End Sub

' Po wyborze produktu: proponuje jednostkę miary i ostatnią cenę zakupu.
Public Sub PodpowiedzDlaProduktu(ByVal produkt As String)
    Dim jednostka As String

    If Len(Trim$(produkt)) = 0 Then Exit Sub

    If Len(Trim$(WartoscPola(POLE_JEDNOSTKA))) = 0 Then
        jednostka = NajczestszaWartosc(kolProdukt, produkt, kolJednostka)
        If Len(jednostka) > 0 Then UstawWartoscPola POLE_JEDNOSTKA, jednostka
    End If
End Sub

' Po wyborze pojazdu: uzupełnia przewoźnika, jeżeli pole jest jeszcze puste.
Public Sub PodpowiedzDlaPojazdu(ByVal pojazd As String)
    Dim przewoznik As String

    If Len(Trim$(pojazd)) = 0 Then Exit Sub
    If Len(Trim$(WartoscPola(POLE_PRZEWOZNIK))) > 0 Then Exit Sub

    przewoznik = NajczestszaWartosc(kolNrRejestracyjny, pojazd, kolPrzewoznik)
    If Len(przewoznik) > 0 Then UstawWartoscPola POLE_PRZEWOZNIK, przewoznik
End Sub

' Po wyborze odbiorcy: proponuje ostatnią cenę sprzedaży dla pary produkt/odbiorca.
Public Function OstatniaCenaSprzedazy(ByVal odbiorca As String, ByVal produkt As String) As Double
    Dim tabela As ListObject
    Dim dane As Variant
    Dim wiersz As Long

    Set tabela = TabelaDanych()
    If tabela.ListRows.Count = 0 Then Exit Function

    dane = tabela.DataBodyRange.Value

    For wiersz = UBound(dane, 1) To 1 Step -1
        If KluczPorownania(dane(wiersz, kolTypOperacji)) = UCase$(OP_SPRZEDAZ) Then
            If KluczPorownania(dane(wiersz, kolOdbiorca)) = KluczPorownania(odbiorca) Then
                If KluczPorownania(dane(wiersz, kolProdukt)) = KluczPorownania(produkt) Then
                    OstatniaCenaSprzedazy = LiczbaZTekstu(dane(wiersz, kolCenaSprzedazy), 0)
                    If OstatniaCenaSprzedazy > 0 Then Exit Function
                End If
            End If
        End If
    Next wiersz
End Function

' Ostatnia cena zakupu danego produktu u danego dostawcy.
Public Function OstatniaCenaZakupu(ByVal dostawca As String, ByVal produkt As String) As Double
    Dim tabela As ListObject
    Dim dane As Variant
    Dim wiersz As Long

    Set tabela = TabelaDanych()
    If tabela.ListRows.Count = 0 Then Exit Function

    dane = tabela.DataBodyRange.Value

    For wiersz = UBound(dane, 1) To 1 Step -1
        If KluczPorownania(dane(wiersz, kolTypOperacji)) = UCase$(OP_ZAKUP) Then
            If KluczPorownania(dane(wiersz, kolDostawca)) = KluczPorownania(dostawca) Then
                If KluczPorownania(dane(wiersz, kolProdukt)) = KluczPorownania(produkt) Then
                    OstatniaCenaZakupu = LiczbaZTekstu(dane(wiersz, kolCenaZakupu), 0)
                    If OstatniaCenaZakupu > 0 Then Exit Function
                End If
            End If
        End If
    Next wiersz
End Function

' Proponuje kolejny numer WZ na podstawie ostatniego numeru w kartotece.
' Rozpoznaje wzorzec "PREFIKS/NUMER" (np. PZ/128 -> PZ/129).
Public Function ProponujNumerWZ(ByVal prefiks As String) As String
    Dim tabela As ListObject
    Dim dane As Variant
    Dim wiersz As Long
    Dim numer As String
    Dim pozycja As Long
    Dim najwyzszy As Long
    Dim kandydat As Long

    Set tabela = TabelaDanych()
    If tabela.ListRows.Count = 0 Then
        ProponujNumerWZ = prefiks & "/1"
        Exit Function
    End If

    dane = tabela.DataBodyRange.Value

    For wiersz = 1 To UBound(dane, 1)
        numer = Znormalizuj(dane(wiersz, kolNrWZ))
        pozycja = InStrRev(numer, "/")
        If pozycja > 0 Then
            If UCase$(Left$(numer, pozycja - 1)) = UCase$(prefiks) Then
                If IsNumeric(Mid$(numer, pozycja + 1)) Then
                    kandydat = CLng(Mid$(numer, pozycja + 1))
                    If kandydat > najwyzszy Then najwyzszy = kandydat
                End If
            End If
        End If
    Next wiersz

    ProponujNumerWZ = prefiks & "/" & (najwyzszy + 1)
End Function
