Option Explicit

' ======================================================================
'  PRO-MAGAZYN  |  wsStart - panel główny
' ======================================================================

Private Sub Worksheet_Activate()
    On Error Resume Next
    Me.Range("A1").Select
    AktualizujKafelki
    On Error GoTo 0
End Sub

' Odświeża liczniki widoczne na panelu startowym.
Private Sub AktualizujKafelki()
    Dim tabela As ListObject

    On Error GoTo Zakoncz

    Set tabela = TabelaDanych()
    Me.Range("C7").Value = tabela.ListRows.Count
    Me.Range("E7").Value = LiczbaZdarzen()
    Me.Range("G7").Value = Now

Zakoncz:
    On Error GoTo 0
End Sub
