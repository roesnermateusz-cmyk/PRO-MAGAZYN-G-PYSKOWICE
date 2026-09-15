Option Explicit

' ======================================================================
'  PRO-MAGAZYN  |  wsUstawienia - parametry systemu
'
'  Zmiana ustawienia unieważnia pamięć podręczną konfiguracji, więc
'  nowa wartość obowiązuje natychmiast, bez restartu skoroszytu.
' ======================================================================

Private Sub Worksheet_Change(ByVal Target As Range)
    If Application.EnableEvents = False Then Exit Sub
    If Intersect(Target, Me.Columns(3)) Is Nothing Then Exit Sub

    On Error GoTo Zakoncz
    Application.EnableEvents = False

    UniewaznijUstawienia
    WczytajUstawienia

    ZapisDoHistorii "USTAWIENIA", "", "", UzytkownikSystemu(), _
                    "Zmiana ustawienia w wierszu " & Target.Row

    ' Zmiana stawki transportu ma natychmiast trafić do formularza.
    UstawWartoscPola POLE_STAWKA_KM, StawkaZaKm()

Zakoncz:
    Application.EnableEvents = True
End Sub
