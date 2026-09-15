Option Explicit

' ======================================================================
'  PRO-MAGAZYN  |  wsSlownik - słowniki list rozwijanych
'
'  Po każdej zmianie w słowniku odświeżamy nazwane zakresy, żeby listy
'  rozwijane od razu pokazywały nową pozycję.
' ======================================================================

Private Sub Worksheet_Change(ByVal Target As Range)
    If Application.EnableEvents = False Then Exit Sub

    On Error GoTo Zakoncz
    Application.EnableEvents = False

    OdswiezNazwaneZakresy

Zakoncz:
    Application.EnableEvents = True
End Sub

Private Sub Worksheet_Deactivate()
    On Error Resume Next
    OdswiezNazwaneZakresy
    OdswiezListyFormularza
    On Error GoTo 0
End Sub
