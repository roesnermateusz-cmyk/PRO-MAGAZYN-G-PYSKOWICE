Option Explicit

' ======================================================================
'  PRO-MAGAZYN  |  mod_Walidacja
'  Reguły poprawności operacji magazynowych.
'
'  Walidacja jest świadomie oddzielona od formularza - ten sam zestaw
'  reguł obowiązuje przy wpisie ręcznym, przy imporcie z pliku i przy
'  korektach.
' ======================================================================

' Sprawdza operację i zwraca True, gdy jest poprawna.
' Lista problemów trafia do parametru "bledy" (oddzielone znakiem nowej linii).
Public Function SprawdzOperacje(ByRef op As Operacja, ByRef bledy As String) As Boolean
    Dim lista As String

    lista = ""

    ' --- Pola obowiązkowe dla każdej operacji --------------------------
    If Len(Trim$(op.Typ)) = 0 Then
        lista = lista & "- Nie wybrano typu operacji." & vbCrLf
    ElseIf Not CzyZnanyTyp(op.Typ) Then
        lista = lista & "- Nieznany typ operacji: " & op.Typ & "." & vbCrLf
    End If

    If op.DataOperacji = 0 Then
        lista = lista & "- Brak daty operacji lub data ma nieprawidłowy format." & vbCrLf
    Else
        lista = lista & SprawdzZakresDaty(op.DataOperacji)
    End If

    If UstawienieTak(UST_WYMAGAJ_AUTORA, True) Then
        If Len(Trim$(op.Utworzyl)) = 0 Then
            lista = lista & "- Pole ""Utworzył"" jest wymagane (imię i nazwisko)." & vbCrLf
        End If
    End If

    ' --- Reguły zależne od typu operacji ------------------------------
    Select Case UCase$(op.Typ)
        Case UCase$(OP_TRANSPORT)
            lista = lista & SprawdzTransport(op)
        Case UCase$(OP_MM)
            lista = lista & SprawdzTowar(op)
            If KluczPorownania(op.Dostawca) = KluczPorownania(op.Odbiorca) Then
                lista = lista & "- Przy przesunięciu MM magazyn źródłowy i docelowy " & _
                                "muszą być różne." & vbCrLf
            End If
        Case Else
            lista = lista & SprawdzTowar(op)
    End Select

    ' --- Reguły cenowe -------------------------------------------------
    If op.CenaZakupu < 0 Then lista = lista & "- Cena zakupu nie może być ujemna." & vbCrLf
    If op.CenaSprzedazy < 0 Then lista = lista & "- Cena sprzedaży nie może być ujemna." & vbCrLf
    If op.KosztRabania < 0 Then lista = lista & "- Koszt rąbania nie może być ujemny." & vbCrLf

    If UCase$(op.Typ) = UCase$(OP_SPRZEDAZ) And op.CenaSprzedazy <= 0 Then
        lista = lista & "- Sprzedaż wymaga podania ceny sprzedaży." & vbCrLf
    End If

    ' --- Reguły transportowe (wspólne) --------------------------------
    If op.Odleglosc < 0 Then lista = lista & "- Odległość nie może być ujemna." & vbCrLf
    If op.StawkaKm < 0 Then lista = lista & "- Stawka za kilometr nie może być ujemna." & vbCrLf
    If op.KosztTransportu < 0 Then lista = lista & "- Koszt transportu nie może być ujemny." & vbCrLf

    If Len(Trim$(op.NrRejestracyjny)) > 0 And Len(Trim$(op.Przewoznik)) = 0 Then
        lista = lista & "- Podano numer rejestracyjny bez przewoźnika." & vbCrLf
    End If

    bledy = lista
    SprawdzOperacje = (Len(lista) = 0)
End Function

' Reguły dla operacji obracających towarem (ZAKUP, SPRZEDAŻ, PRODUKCJA, ZUŻYCIE, MM).
Private Function SprawdzTowar(ByRef op As Operacja) As String
    Dim lista As String

    If Len(Trim$(op.Produkt)) = 0 Then
        lista = lista & "- Nie wybrano produktu." & vbCrLf
    End If

    If op.Volumen <= 0 Then
        lista = lista & "- Wolumen musi być liczbą większą od zera." & vbCrLf
    End If

    If Len(Trim$(op.Jednostka)) = 0 Then
        lista = lista & "- Nie wybrano jednostki miary." & vbCrLf
    End If

    If Len(Trim$(op.Dostawca)) = 0 Then
        lista = lista & "- Nie wybrano dostawcy / magazynu źródłowego." & vbCrLf
    End If

    If Len(Trim$(op.Odbiorca)) = 0 Then
        lista = lista & "- Nie wybrano odbiorcy / magazynu docelowego." & vbCrLf
    End If

    SprawdzTowar = lista
End Function

' Reguły dla operacji TRANSPORT - czysty koszt logistyczny, bez towaru.
Private Function SprawdzTransport(ByRef op As Operacja) As String
    Dim lista As String

    If Len(Trim$(op.Przewoznik)) = 0 Then
        lista = lista & "- Operacja TRANSPORT wymaga wskazania przewoźnika." & vbCrLf
    End If

    If Len(Trim$(op.NrRejestracyjny)) = 0 Then
        lista = lista & "- Operacja TRANSPORT wymaga numeru rejestracyjnego pojazdu." & vbCrLf
    End If

    If op.Odleglosc <= 0 And op.KosztTransportu <= 0 Then
        lista = lista & "- Podaj odległość w km (koszt zostanie wyliczony) " & _
                        "albo wpisz koszt transportu ręcznie." & vbCrLf
    End If

    SprawdzTransport = lista
End Function

' Data operacji nie może być zbyt stara ani zbyt odległa w przyszłości.
Private Function SprawdzZakresDaty(ByVal dataOperacji As Date) As String
    Dim dniWstecz As Long
    Dim dniWprzod As Long
    Dim najwczesniejsza As Date
    Dim najpozniejsza As Date
    Dim lista As String

    dniWstecz = CLng(UstawienieLiczba(UST_DNI_WSTECZ, 2))
    dniWprzod = CLng(UstawienieLiczba(UST_DNI_WPRZOD, 30))

    If dniWstecz > 0 Then
        najwczesniejsza = DataMinusDniRobocze(Date, dniWstecz)
        If dataOperacji < najwczesniejsza Then
            lista = lista & "- Data operacji jest starsza niż " & dniWstecz & _
                            " dni robocze wstecz (najwcześniejsza dozwolona: " & _
                            Format$(najwczesniejsza, "dd.mm.yyyy") & ")." & vbCrLf
        End If
    End If

    If dniWprzod > 0 Then
        najpozniejsza = Date + dniWprzod
        If dataOperacji > najpozniejsza Then
            lista = lista & "- Data operacji jest późniejsza niż " & dniWprzod & _
                            " dni w przód (najpóźniejsza dozwolona: " & _
                            Format$(najpozniejsza, "dd.mm.yyyy") & ")." & vbCrLf
        End If
    End If

    SprawdzZakresDaty = lista
End Function

Public Function CzyZnanyTyp(ByVal typ As String) As Boolean
    Select Case UCase$(Trim$(typ))
        Case UCase$(OP_ZAKUP), UCase$(OP_SPRZEDAZ), UCase$(OP_PRODUKCJA), _
             UCase$(OP_ZUZYCIE), UCase$(OP_MM), UCase$(OP_TRANSPORT)
            CzyZnanyTyp = True
        Case Else
            CzyZnanyTyp = False
    End Select
End Function

' Operacje, które fizycznie przesuwają towar w magazynie.
Public Function CzyOperacjaTowarowa(ByVal typ As String) As Boolean
    CzyOperacjaTowarowa = (UCase$(Trim$(typ)) <> UCase$(OP_TRANSPORT))
End Function

' ----------------------------------------------------------------------
'  Wykrywanie duplikatów
' ----------------------------------------------------------------------

' Szuka wiersza o tym samym numerze WZ, typie, produkcie i dacie.
' Zwraca numer wiersza tabeli (0 gdy brak duplikatu).
Public Function ZnajdzDuplikat(ByRef op As Operacja) As Long
    Dim tabela As ListObject
    Dim dane As Variant
    Dim wiersz As Long

    If Len(Trim$(op.NrWZ)) = 0 Then Exit Function

    Set tabela = TabelaDanych()
    If tabela.ListRows.Count = 0 Then Exit Function

    dane = tabela.DataBodyRange.Value

    For wiersz = 1 To UBound(dane, 1)
        If KluczPorownania(dane(wiersz, kolStatus)) <> UCase$(ST_SKORYGOWANY) Then
            If KluczPorownania(dane(wiersz, kolNrWZ)) = KluczPorownania(op.NrWZ) Then
                If KluczPorownania(dane(wiersz, kolTypOperacji)) = KluczPorownania(op.Typ) Then
                    If KluczPorownania(dane(wiersz, kolProdukt)) = KluczPorownania(op.Produkt) Then
                        If IsDate(dane(wiersz, kolDataOperacji)) Then
                            If CDate(dane(wiersz, kolDataOperacji)) = op.DataOperacji Then
                                ZnajdzDuplikat = wiersz
                                Exit Function
                            End If
                        End If
                    End If
                End If
            End If
        End If
    Next wiersz
End Function
