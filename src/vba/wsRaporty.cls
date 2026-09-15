Option Explicit

' ======================================================================
'  PRO-MAGAZYN  |  wsRaporty - raporty i zestawienia
'
'  Zmiana dowolnego filtra w nagłówku przelicza raport szczegółowy.
' ======================================================================

Private Sub Worksheet_Change(ByVal Target As Range)
    If Application.EnableEvents = False Then Exit Sub
    If Intersect(Target, Me.Range("C3:G4")) Is Nothing Then Exit Sub

    On Error GoTo Zakoncz
    Application.EnableEvents = False
    GenerujRaport

Zakoncz:
    Application.EnableEvents = True
End Sub

Private Sub Worksheet_Activate()
    On Error Resume Next
    OdswiezListyRaportow
    On Error GoTo 0
End Sub

' Listy rozwijane filtrów budujemy przy każdym wejściu na arkusz,
' żeby obejmowały nowe produkty i kontrahentów.
Private Sub OdswiezListyRaportow()
    UstawListeRozwijana Me.Range("G3"), SL_TYP_OPERACJI
    UstawListeRozwijana Me.Range("C4"), SL_PRODUKT
    UstawListeRozwijana Me.Range("E4"), SL_DOSTAWCA
    UstawListeRozwijana Me.Range("G4"), SL_MIEJSCE
End Sub
