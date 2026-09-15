Option Explicit

' ======================================================================
'  PRO-MAGAZYN  |  wsDane - kartoteka operacji
'
'  Podwójne kliknięcie wiersza otwiera menu czynności: korekta wpisu
'  albo skopiowanie go do formularza.
' ======================================================================

Private Sub Worksheet_BeforeDoubleClick(ByVal Target As Range, Cancel As Boolean)
    Dim tabela As ListObject
    Dim wybor As Long

    On Error GoTo Zakoncz

    Set tabela = TabelaDanych()
    If tabela.DataBodyRange Is Nothing Then Exit Sub
    If Intersect(Target, tabela.DataBodyRange) Is Nothing Then Exit Sub

    Cancel = True

    wybor = MsgBox("Wybierz czynność dla zaznaczonej operacji:" & vbCrLf & vbCrLf & _
                   "TAK  -  skoryguj wpis (storno)" & vbCrLf & _
                   "NIE  -  skopiuj dane do formularza" & vbCrLf & _
                   "ANULUJ  -  nic nie rób", _
                   vbQuestion + vbYesNoCancel, APP_NAZWA & " - kartoteka")

    Select Case wybor
        Case vbYes
            KorygujZaznaczonyWiersz
        Case vbNo
            SkopiujDoFormularza
    End Select

Zakoncz:
    On Error GoTo 0
End Sub

' Po ręcznej edycji kartoteki aktualizujemy słowniki i stan magazynu.
Private Sub Worksheet_Change(ByVal Target As Range)
    Dim tabela As ListObject

    If Application.EnableEvents = False Then Exit Sub

    On Error GoTo Zakoncz
    Set tabela = TabelaDanych()
    If tabela.DataBodyRange Is Nothing Then Exit Sub
    If Intersect(Target, tabela.DataBodyRange) Is Nothing Then Exit Sub

    Application.EnableEvents = False
    ZapisDoHistorii "EDYCJA RECZNA", "", "", UzytkownikSystemu(), _
                    "Zmiana w kartotece, zakres " & Target.Address(False, False)

Zakoncz:
    Application.EnableEvents = True
End Sub
