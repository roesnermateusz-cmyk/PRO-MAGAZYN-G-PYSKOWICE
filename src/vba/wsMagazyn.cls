Option Explicit

' ======================================================================
'  PRO-MAGAZYN  |  wsMagazyn - stan magazynowy
' ======================================================================

Private Sub Worksheet_Activate()
    On Error Resume Next
    OdswiezStanMagazynu
    On Error GoTo 0
End Sub

' Podwójne kliknięcie odświeża zestawienie bez wychodzenia z arkusza.
Private Sub Worksheet_BeforeDoubleClick(ByVal Target As Range, Cancel As Boolean)
    Cancel = True
    OdswiezStanMagazynu
End Sub
