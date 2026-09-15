Option Explicit

' ======================================================================
'  PRO-MAGAZYN  |  wsFormularz - ekran nowej operacji
'
'  Zdarzenie Worksheet_Change odczytuje klucz pola z ukrytej kolumny A
'  i przekazuje go do modułu formularza. Dzięki temu logika nie zależy
'  od adresów komórek.
' ======================================================================

Private Sub Worksheet_Change(ByVal Target As Range)
    Dim komorka As Range
    Dim klucz As String

    If Application.EnableEvents = False Then Exit Sub
    ' Reagujemy wyłącznie na kolumnę wartości formularza.
    If Intersect(Target, Me.Columns(KOL_WARTOSC)) Is Nothing Then Exit Sub

    On Error GoTo Zakoncz
    Application.EnableEvents = False

    ' Zdarzenia pozostają wyłączone przez cały czas obsługi. Podpowiedzi
    ' autouzupełniania same wpisują wartości do arkusza - włączenie zdarzeń
    ' w tym miejscu powodowałoby zagnieżdżone wywołania tej procedury.
    For Each komorka In Intersect(Target, Me.Columns(KOL_WARTOSC)).Cells
        klucz = Trim$(CStr(Me.Cells(komorka.Row, KOL_KLUCZ).Value))
        If Len(klucz) > 0 Then ObsluzZmianePola klucz
    Next komorka

Zakoncz:
    Application.EnableEvents = True
End Sub

Private Sub Worksheet_Activate()
    On Error Resume Next
    OdswiezListyFormularza
    On Error GoTo 0
End Sub
