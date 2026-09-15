Option Explicit

' ======================================================================
'  PRO-MAGAZYN  |  ThisWorkbook
'  Zdarzenia skoroszytu: start systemu, kopie zapasowe, sprzątanie.
' ======================================================================

Private Sub Workbook_Open()
    On Error Resume Next
    Application.StatusBar = APP_NAZWA & " " & APP_WERSJA & " - uruchamianie systemu..."
    On Error GoTo 0

    UruchomSystem

    On Error Resume Next
    Application.StatusBar = False
    On Error GoTo 0

    ZapisDoHistorii "OTWARCIE", "", "", UzytkownikSystemu(), _
                    "Otwarcie skoroszytu, wersja " & APP_WERSJA
End Sub

' Kopia zapasowa powstaje przed zapisem, najwyżej raz dziennie.
Private Sub Workbook_BeforeSave(ByVal SaveAsUI As Boolean, Cancel As Boolean)
    If SaveAsUI Then Exit Sub
    On Error Resume Next
    KopiaPrzyZapisie
    On Error GoTo 0
End Sub

Private Sub Workbook_BeforeClose(Cancel As Boolean)
    On Error Resume Next
    ZwolnijSkroty
    PrzywrocAplikacje
    ZapisDoHistorii "ZAMKNIECIE", "", "", UzytkownikSystemu(), "Zamknięcie skoroszytu"
    On Error GoTo 0
End Sub

' Po przełączeniu do innego skoroszytu zwalniamy skróty klawiszowe,
' żeby nie przechwytywały klawiszy w cudzych plikach.
Private Sub Workbook_Deactivate()
    On Error Resume Next
    ZwolnijSkroty
    On Error GoTo 0
End Sub

Private Sub Workbook_Activate()
    On Error Resume Next
    UstawSkroty
    On Error GoTo 0
End Sub
