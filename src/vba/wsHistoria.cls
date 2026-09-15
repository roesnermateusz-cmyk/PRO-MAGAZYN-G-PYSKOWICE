Option Explicit

' ======================================================================
'  PRO-MAGAZYN  |  wsHistoria - dziennik zdarzeń
'
'  Dziennik jest rejestrem tylko do odczytu. Wpisy dopisuje wyłącznie
'  moduł mod_Audyt.
' ======================================================================

Private Sub Worksheet_Activate()
    On Error Resume Next
    Me.Range("A1").Select
    On Error GoTo 0
End Sub

Private Sub Worksheet_BeforeDoubleClick(ByVal Target As Range, Cancel As Boolean)
    Cancel = True
    Informacja "Dziennik zdarzeń jest rejestrem tylko do odczytu." & vbCrLf & vbCrLf & _
               "Liczba zapisanych zdarzeń: " & LiczbaZdarzen() & vbCrLf & vbCrLf & _
               "Eksport do pliku CSV uruchomisz makrem EksportujHistorie (Alt+F8)."
End Sub
