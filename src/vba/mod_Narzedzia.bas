Option Explicit

' ======================================================================
'  PRO-MAGAZYN  |  mod_Narzedzia
'  Funkcje pomocnicze używane w całym systemie: konwersje liczb i dat,
'  identyfikatory operacji, obsługa wydajności i komunikatów.
' ======================================================================

Private mStanEkranu As Boolean
Private mStanZdarzen As Boolean
Private mStanObliczen As XlCalculation
Private mZagniezdzenie As Long

' ----------------------------------------------------------------------
'  Konwersje liczbowe
' ----------------------------------------------------------------------

' Bezpieczna konwersja na liczbę. Akceptuje przecinek i kropkę jako
' separator dziesiętny oraz spacje jako separator tysięcy.
'
' Uwaga: w poprzedniej wersji systemu wartość operacji odczytywano
' z sformatowanej etykiety ("6 747,00 zł"), przez co IsNumeric zwracał
' False i do arkusza trafiało 0. Ta funkcja radzi sobie z takim tekstem,
' ale silnik i tak liczy wartość bezpośrednio z liczb.
Public Function LiczbaZTekstu(ByVal wartosc As Variant, Optional ByVal domyslna As Double = 0) As Double
    Dim tekst As String
    Dim i As Long
    Dim znak As String
    Dim oczyszczony As String
    Dim widzianoSeparator As Boolean

    If IsEmpty(wartosc) Or IsNull(wartosc) Then
        LiczbaZTekstu = domyslna
        Exit Function
    End If

    If IsNumeric(wartosc) And Not VarType(wartosc) = vbString Then
        LiczbaZTekstu = CDbl(wartosc)
        Exit Function
    End If

    tekst = Trim$(CStr(wartosc))
    If Len(tekst) = 0 Then
        LiczbaZTekstu = domyslna
        Exit Function
    End If

    For i = 1 To Len(tekst)
        znak = Mid$(tekst, i, 1)
        Select Case znak
            Case "0" To "9"
                oczyszczony = oczyszczony & znak
            Case "-"
                If Len(oczyszczony) = 0 Then oczyszczony = "-"
            Case ",", "."
                ' Pierwszy separator traktujemy jako dziesiętny, kolejne
                ' (separatory tysięcy) pomijamy.
                If Not widzianoSeparator Then
                    oczyszczony = oczyszczony & Application.DecimalSeparator
                    widzianoSeparator = True
                End If
            Case Else
                ' spacje, symbole walut i jednostki pomijamy
        End Select
    Next i

    If Len(oczyszczony) = 0 Or oczyszczony = "-" Then
        LiczbaZTekstu = domyslna
    ElseIf IsNumeric(oczyszczony) Then
        LiczbaZTekstu = CDbl(oczyszczony)
    Else
        LiczbaZTekstu = domyslna
    End If
End Function

' Zaokrąglenie kwotowe (2 miejsca) odporne na błąd bankierski VBA.
Public Function ZaokraglijKwote(ByVal wartosc As Double) As Double
    ZaokraglijKwote = Int(Abs(wartosc) * 100 + 0.5) / 100 * Sgn(wartosc)
End Function

Public Function ZaokraglijIlosc(ByVal wartosc As Double) As Double
    ZaokraglijIlosc = Int(Abs(wartosc) * 1000 + 0.5) / 1000 * Sgn(wartosc)
End Function

Public Function TekstKwoty(ByVal wartosc As Double) As String
    TekstKwoty = Format$(wartosc, "#,##0.00") & " zł"
End Function

' ----------------------------------------------------------------------
'  Daty
' ----------------------------------------------------------------------

' Konwersja na datę bez zgłaszania błędu wykonania.
Public Function DataZTekstu(ByVal wartosc As Variant, ByRef czyPoprawna As Boolean) As Date
    czyPoprawna = False

    If IsEmpty(wartosc) Or IsNull(wartosc) Then Exit Function
    If Len(Trim$(CStr(wartosc))) = 0 Then Exit Function

    If IsDate(wartosc) Then
        DataZTekstu = CDate(wartosc)
        czyPoprawna = True
    End If
End Function

' Cofa się o podaną liczbę dni roboczych (pomijając soboty i niedziele).
Public Function DataMinusDniRobocze(ByVal odData As Date, ByVal ileDni As Long) As Date
    Dim biezaca As Date
    Dim policzone As Long

    biezaca = odData
    If ileDni <= 0 Then
        DataMinusDniRobocze = biezaca
        Exit Function
    End If

    Do While policzone < ileDni
        biezaca = biezaca - 1
        If Weekday(biezaca, vbMonday) < 6 Then policzone = policzone + 1
    Loop

    DataMinusDniRobocze = biezaca
End Function

Public Function NazwaMiesiaca(ByVal numer As Long) As String
    Dim nazwy As Variant

    nazwy = Array("STYCZEŃ", "LUTY", "MARZEC", "KWIECIEŃ", "MAJ", "CZERWIEC", _
                  "LIPIEC", "SIERPIEŃ", "WRZESIEŃ", "PAŹDZIERNIK", "LISTOPAD", "GRUDZIEŃ")

    If numer >= 1 And numer <= 12 Then
        NazwaMiesiaca = nazwy(numer - 1)
    Else
        NazwaMiesiaca = ""
    End If
End Function

' ----------------------------------------------------------------------
'  Identyfikatory
' ----------------------------------------------------------------------

' Generuje identyfikator operacji w formacie OP-RRRRMMDD-HHMMSS-NNN.
' Licznik gwarantuje unikalność przy zapisie kilku wierszy w tej samej sekundzie.
Public Function NowyIdOperacji() As String
    Static licznik As Long

    licznik = (licznik + 1) Mod 1000
    NowyIdOperacji = "OP-" & Format$(Now, "yyyymmdd-hhnnss") & "-" & Format$(licznik, "000")
End Function

Public Function NowyIdPowiazania() As String
    Static licznik As Long

    licznik = (licznik + 1) Mod 1000
    NowyIdPowiazania = "PW-" & Format$(Now, "yyyymmdd-hhnnss") & "-" & Format$(licznik, "000")
End Function

' Nazwa użytkownika systemu Windows - propozycja dla pola "Utworzył".
Public Function UzytkownikSystemu() As String
    On Error Resume Next
    UzytkownikSystemu = Application.UserName
    If Len(Trim$(UzytkownikSystemu)) = 0 Then UzytkownikSystemu = Environ$("USERNAME")
    On Error GoTo 0
End Function

' ----------------------------------------------------------------------
'  Tekst
' ----------------------------------------------------------------------

Public Function Znormalizuj(ByVal wartosc As Variant) As String
    If IsEmpty(wartosc) Or IsNull(wartosc) Then
        Znormalizuj = ""
    Else
        Znormalizuj = Trim$(CStr(wartosc))
    End If
End Function

Public Function KluczPorownania(ByVal wartosc As Variant) As String
    KluczPorownania = UCase$(Znormalizuj(wartosc))
End Function

' Normalizuje numer rejestracyjny: wielkie litery, pojedyncze spacje.
Public Function NormalizujNrRejestracyjny(ByVal wartosc As Variant) As String
    Dim tekst As String

    tekst = UCase$(Znormalizuj(wartosc))
    Do While InStr(tekst, "  ") > 0
        tekst = Replace$(tekst, "  ", " ")
    Loop

    NormalizujNrRejestracyjny = tekst
End Function

' ----------------------------------------------------------------------
'  Wydajność i komunikaty
' ----------------------------------------------------------------------

' Wyłącza odświeżanie ekranu i zdarzenia na czas operacji masowych.
' Wywołania mogą być zagnieżdżone - stan przywraca dopiero ostatnie
' wywołanie WlaczEkran.
Public Sub WylaczEkran()
    If mZagniezdzenie = 0 Then
        mStanEkranu = Application.ScreenUpdating
        mStanZdarzen = Application.EnableEvents
        mStanObliczen = Application.Calculation
        Application.ScreenUpdating = False
        Application.EnableEvents = False
        Application.Calculation = xlCalculationManual
    End If
    mZagniezdzenie = mZagniezdzenie + 1
End Sub

Public Sub WlaczEkran()
    If mZagniezdzenie > 0 Then mZagniezdzenie = mZagniezdzenie - 1
    If mZagniezdzenie > 0 Then Exit Sub

    Application.Calculation = mStanObliczen
    Application.EnableEvents = mStanZdarzen
    Application.ScreenUpdating = mStanEkranu
End Sub

' Awaryjne przywrócenie stanu aplikacji po nieobsłużonym błędzie.
Public Sub PrzywrocAplikacje()
    mZagniezdzenie = 0
    Application.Calculation = xlCalculationAutomatic
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    Application.StatusBar = False
End Sub

Public Sub Informacja(ByVal tresc As String, Optional ByVal tytul As String = "")
    MsgBox tresc, vbInformation, IIf(Len(tytul) = 0, APP_NAZWA, tytul)
End Sub

Public Sub Ostrzezenie(ByVal tresc As String, Optional ByVal tytul As String = "")
    MsgBox tresc, vbExclamation, IIf(Len(tytul) = 0, APP_NAZWA, tytul)
End Sub

Public Function Potwierdz(ByVal tresc As String, Optional ByVal tytul As String = "") As Boolean
    Potwierdz = (MsgBox(tresc, vbQuestion + vbYesNo + vbDefaultButton2, _
                        IIf(Len(tytul) = 0, APP_NAZWA, tytul)) = vbYes)
End Function

Public Sub PokazBlad(ByVal zrodlo As String)
    PrzywrocAplikacje
    MsgBox "Wystąpił błąd podczas operacji: " & zrodlo & vbCrLf & vbCrLf & _
           "Opis: " & Err.Description & vbCrLf & _
           "Numer: " & Err.Number & vbCrLf & vbCrLf & _
           "Dane nie zostały zmienione lub zostały wycofane. " & _
           "Jeżeli błąd się powtarza, przywróć ostatnią kopię zapasową.", _
           vbCritical, APP_NAZWA & " - błąd"
End Sub

' Sprawdza, czy arkusz o podanej nazwie istnieje w skoroszycie.
Public Function ArkuszIstnieje(ByVal nazwa As String) As Boolean
    Dim ark As Object

    On Error Resume Next
    Set ark = ThisWorkbook.Sheets(nazwa)
    On Error GoTo 0
    ArkuszIstnieje = Not ark Is Nothing
End Function

' Zwraca folder skoroszytu albo folder Dokumenty, gdy plik nie był zapisany.
Public Function FolderSkoroszytu() As String
    If Len(ThisWorkbook.Path) > 0 Then
        FolderSkoroszytu = ThisWorkbook.Path
    Else
        FolderSkoroszytu = Environ$("USERPROFILE") & "\Documents"
    End If
End Function

' Tworzy folder wraz z brakującymi katalogami nadrzędnymi.
Public Function UtworzFolder(ByVal sciezka As String) As Boolean
    Dim fso As Object
    Dim rodzic As String

    On Error GoTo Nieudane
    Set fso = CreateObject("Scripting.FileSystemObject")

    If fso.FolderExists(sciezka) Then
        UtworzFolder = True
        Exit Function
    End If

    rodzic = fso.GetParentFolderName(sciezka)
    If Len(rodzic) > 0 Then
        If Not fso.FolderExists(rodzic) Then
            If Not UtworzFolder(rodzic) Then Exit Function
        End If
    End If

    fso.CreateFolder sciezka
    UtworzFolder = True
    Exit Function

Nieudane:
    UtworzFolder = False
End Function
