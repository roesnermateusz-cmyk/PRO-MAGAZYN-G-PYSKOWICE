Option Explicit

' ======================================================================
'  PRO-MAGAZYN  |  mod_UI
'  Budowa interfejsu: przyciski na arkuszach, inicjalizacja systemu,
'  skróty klawiszowe.
'
'  Przyciski są rysowane przez VBA przy otwarciu skoroszytu. Dzięki temu
'  plik nie przechowuje obiektów graficznych, które łatwo uszkodzić,
'  a układ ekranu można zmienić w jednym miejscu.
' ======================================================================

Private Const WYS_PRZYCISKU As Single = 34
Private Const PREFIKS_PRZYCISKU As String = "btnPM_"

' ----------------------------------------------------------------------
'  Start systemu
' ----------------------------------------------------------------------

Public Sub UruchomSystem()
    On Error GoTo Blad

    WczytajUstawienia
    UniewaznijMapeFormularza
    OdswiezNazwaneZakresy
    OdswiezListyFormularza
    OdswiezListyKartoteki
    ZbudujPanelStartowy
    ZbudujPrzyciskiFormularza
    ZbudujPrzyciskiRaportow
    UstawSkroty

    If Len(WartoscPola(POLE_UTWORZYL)) = 0 Then
        UstawWartoscPola POLE_UTWORZYL, CStr(Ustawienie(UST_DOMYSLNY_AUTOR, UzytkownikSystemu()))
    End If

    OdswiezStanMagazynu
    Exit Sub

Blad:
    ' Błąd inicjalizacji nie może blokować dostępu do danych.
    PrzywrocAplikacje
End Sub

Public Sub UstawSkroty()
    On Error Resume Next
    Application.OnKey "^+n", "PokazFormularz"
    Application.OnKey "^+z", "ZapiszZFormularza"
    Application.OnKey "^+m", "PokazMagazyn"
    Application.OnKey "^+r", "PokazRaporty"
    On Error GoTo 0
End Sub

Public Sub ZwolnijSkroty()
    On Error Resume Next
    Application.OnKey "^+n"
    Application.OnKey "^+z"
    Application.OnKey "^+m"
    Application.OnKey "^+r"
    On Error GoTo 0
End Sub

' ----------------------------------------------------------------------
'  Nawigacja
' ----------------------------------------------------------------------

Public Sub PokazStart()
    wsStart.Activate
End Sub

Public Sub PokazFormularz()
    wsFormularz.Activate
    On Error Resume Next
    KomorkaPola(POLE_TYP).Select
    On Error GoTo 0
End Sub

Public Sub PokazKartoteke()
    wsDane.Activate
End Sub

Public Sub PokazMagazyn()
    OdswiezStanMagazynu
    wsMagazyn.Activate
End Sub

Public Sub PokazRaporty()
    wsRaporty.Activate
End Sub

Public Sub PokazHistorie()
    wsHistoria.Activate
End Sub

Public Sub PokazSlowniki()
    wsSlownik.Activate
End Sub

Public Sub PokazUstawienia()
    wsUstawienia.Activate
End Sub

Public Sub PokazPomoc()
    Informacja _
        APP_NAZWA & " " & APP_WERSJA & vbCrLf & String$(52, "-") & vbCrLf & vbCrLf & _
        "SKRÓTY KLAWISZOWE" & vbCrLf & _
        "  Ctrl+Shift+N   nowa operacja (formularz)" & vbCrLf & _
        "  Ctrl+Shift+Z   zapisz operację z formularza" & vbCrLf & _
        "  Ctrl+Shift+M   stan magazynowy" & vbCrLf & _
        "  Ctrl+Shift+R   raporty" & vbCrLf & vbCrLf & _
        "TYPY OPERACJI" & vbCrLf & _
        "  ZAKUP, SPRZEDAŻ, PRODUKCJA, ZUŻYCIE, MM, TRANSPORT" & vbCrLf & vbCrLf & _
        "TRANSPORT" & vbCrLf & _
        "  Koszt wyliczany jest automatycznie: odległość x stawka za km." & vbCrLf & _
        "  Stawkę zmienisz w arkuszu USTAWIENIA (klucz " & UST_STAWKA_KM & ")." & vbCrLf & vbCrLf & _
        "OPERACJE RÓWNOLEGŁE" & vbCrLf & _
        "  Przy zakupie możesz jednocześnie zapisać produkcję, sprzedaż" & vbCrLf & _
        "  i transport. System sam dopisze powiązane wiersze kartoteki.", _
        APP_NAZWA & " - pomoc"
End Sub

' ----------------------------------------------------------------------
'  Przyciski
' ----------------------------------------------------------------------

' Usuwa wcześniej narysowane przyciski systemu z danego arkusza.
Private Sub UsunPrzyciski(ByVal arkusz As Worksheet)
    Dim ksztalt As Shape
    Dim i As Long

    On Error Resume Next
    For i = arkusz.Shapes.Count To 1 Step -1
        Set ksztalt = arkusz.Shapes(i)
        If Left$(ksztalt.Name, Len(PREFIKS_PRZYCISKU)) = PREFIKS_PRZYCISKU Then
            ksztalt.Delete
        End If
    Next i
    On Error GoTo 0
End Sub

' Rysuje pojedynczy przycisk uruchamiający makro.
Private Sub DodajPrzycisk(ByVal arkusz As Worksheet, ByVal nazwa As String, _
                          ByVal etykieta As String, ByVal makro As String, _
                          ByVal lewo As Single, ByVal gora As Single, _
                          ByVal szerokosc As Single, ByVal kolor As Long)
    Dim ksztalt As Shape

    On Error GoTo Zakoncz

    Set ksztalt = arkusz.Shapes.AddShape(msoShapeRoundedRectangle, lewo, gora, szerokosc, WYS_PRZYCISKU)
    ksztalt.Name = PREFIKS_PRZYCISKU & nazwa
    ksztalt.OnAction = makro

    With ksztalt.Fill
        .Visible = msoTrue
        .ForeColor.RGB = kolor
        .Solid
    End With
    With ksztalt.Line
        .Visible = msoTrue
        .ForeColor.RGB = kolor
        .Weight = 1
    End With
    With ksztalt.TextFrame2.TextRange
        .Text = etykieta
        .Font.Size = 11
        .Font.Bold = msoTrue
        .Font.Name = "Segoe UI"
        .Font.Fill.ForeColor.RGB = RGB(255, 255, 255)
        .ParagraphFormat.Alignment = msoAlignCenter
    End With
    ksztalt.TextFrame2.VerticalAnchor = msoAnchorMiddle
    ksztalt.Placement = xlFreeFloating

Zakoncz:
    On Error GoTo 0
End Sub

Public Sub ZbudujPanelStartowy()
    Dim zielony As Long, niebieski As Long, szary As Long, pomaranczowy As Long
    Dim kolumna1 As Single, kolumna2 As Single, szerokosc As Single
    Dim gora As Single, odstep As Single

    zielony = RGB(16, 132, 90)
    niebieski = RGB(31, 90, 152)
    szary = RGB(90, 98, 110)
    pomaranczowy = RGB(191, 110, 20)

    UsunPrzyciski wsStart

    ' Pozycje bierzemy z komorek - panel dopasowuje sie do ukladu arkusza.
    kolumna1 = wsStart.Range("B10").Left
    kolumna2 = wsStart.Range("F10").Left
    szerokosc = wsStart.Range("B10:E10").Width
    gora = wsStart.Range("B10").Top
    odstep = 46

    DodajPrzycisk wsStart, "nowa", "NOWA OPERACJA  (Ctrl+Shift+N)", "PokazFormularz", _
                  kolumna1, gora, szerokosc, zielony
    DodajPrzycisk wsStart, "magazyn", "STAN MAGAZYNOWY", "PokazMagazyn", _
                  kolumna2, gora, szerokosc, zielony

    DodajPrzycisk wsStart, "kartoteka", "KARTOTEKA OPERACJI", "PokazKartoteke", _
                  kolumna1, gora + odstep, szerokosc, niebieski
    DodajPrzycisk wsStart, "raporty", "RAPORTY I ZESTAWIENIA", "PokazRaporty", _
                  kolumna2, gora + odstep, szerokosc, niebieski

    DodajPrzycisk wsStart, "slowniki", "SŁOWNIKI (listy rozwijane)", "PokazSlowniki", _
                  kolumna1, gora + odstep * 2, szerokosc, szary
    DodajPrzycisk wsStart, "historia", "DZIENNIK ZDARZEŃ", "PokazHistorie", _
                  kolumna2, gora + odstep * 2, szerokosc, szary

    DodajPrzycisk wsStart, "import", "IMPORT Z PLIKU CSV", "ImportujKartoteke", _
                  kolumna1, gora + odstep * 3, szerokosc, pomaranczowy
    DodajPrzycisk wsStart, "eksport", "EKSPORT DO PLIKU CSV", "EksportujKartoteke", _
                  kolumna2, gora + odstep * 3, szerokosc, pomaranczowy

    DodajPrzycisk wsStart, "kopia", "KOPIA ZAPASOWA", "WykonajKopie", _
                  kolumna1, gora + odstep * 4, szerokosc, szary
    DodajPrzycisk wsStart, "ustawienia", "USTAWIENIA SYSTEMU", "PokazUstawienia", _
                  kolumna2, gora + odstep * 4, szerokosc, szary

    DodajPrzycisk wsStart, "pomoc", "POMOC I SKRÓTY", "PokazPomoc", _
                  kolumna1, gora + odstep * 5, szerokosc, niebieski
    DodajPrzycisk wsStart, "odswiez", "ODŚWIEŻ SYSTEM", "UruchomSystem", _
                  kolumna2, gora + odstep * 5, szerokosc, niebieski
End Sub

Public Sub ZbudujPrzyciskiFormularza()
    Dim zielony As Long, szary As Long, niebieski As Long
    Dim gora As Single

    zielony = RGB(16, 132, 90)
    szary = RGB(90, 98, 110)
    niebieski = RGB(31, 90, 152)

    UsunPrzyciski wsFormularz

    Dim lewo As Single, szerokosc As Single

    lewo = wsFormularz.Range("F3").Left
    szerokosc = wsFormularz.Range("F3:G3").Width
    gora = wsFormularz.Range("F3").Top

    DodajPrzycisk wsFormularz, "zapisz", "ZAPISZ OPERACJĘ", "ZapiszZFormularza", _
                  lewo, gora, szerokosc, zielony
    DodajPrzycisk wsFormularz, "wyczysc", "WYCZYŚĆ FORMULARZ", "WyczyscFormularz", _
                  lewo, gora + 42, szerokosc, szary
    DodajPrzycisk wsFormularz, "wz", "PODPOWIEDZ NUMER WZ", "WstawNumerWZ", _
                  lewo, gora + 84, szerokosc, niebieski
    DodajPrzycisk wsFormularz, "powrot", "POWRÓT DO MENU", "PokazStart", _
                  lewo, gora + 126, szerokosc, szary
End Sub

Public Sub ZbudujPrzyciskiRaportow()
    Dim niebieski As Long, zielony As Long, szary As Long

    niebieski = RGB(31, 90, 152)
    zielony = RGB(16, 132, 90)
    szary = RGB(90, 98, 110)

    Dim lewo As Single, gora As Single, szerokosc As Single

    UsunPrzyciski wsRaporty

    lewo = wsRaporty.Range("P3").Left
    gora = wsRaporty.Range("P3").Top
    szerokosc = wsRaporty.Range("P3:R3").Width

    DodajPrzycisk wsRaporty, "generuj", "RAPORT SZCZEGÓŁOWY", "GenerujRaport", _
                  lewo, gora, szerokosc, zielony
    DodajPrzycisk wsRaporty, "roczny", "ZESTAWIENIE ROCZNE", "RaportRoczny", _
                  lewo, gora + 42, szerokosc, niebieski
    DodajPrzycisk wsRaporty, "transport", "KOSZTY TRANSPORTU", "RaportTransportu", _
                  lewo, gora + 84, szerokosc, niebieski
    DodajPrzycisk wsRaporty, "powrot", "POWRÓT DO MENU", "PokazStart", _
                  lewo, gora + 126, szerokosc, szary
End Sub

' ----------------------------------------------------------------------
'  Akcje przycisków
' ----------------------------------------------------------------------

Public Sub WykonajKopie()
    UtworzKopieZapasowa False
End Sub

' Zakłada listy rozwijane na wszystkich kolumnach kartoteki.
' To realizacja wymagania "listy rozwijane we wszystkich kolumnach" -
' także przy ręcznej edycji wiersza w arkuszu Dane.
Public Sub OdswiezListyKartoteki()
    Dim tabela As ListObject
    Dim zakres As Range

    On Error GoTo Zakoncz

    Set tabela = TabelaDanych()
    If tabela.ListRows.Count = 0 Then Exit Sub

    WylaczEkran
    Set zakres = tabela.DataBodyRange

    UstawListeRozwijana KolumnaTabeli(zakres, kolTypOperacji), SL_TYP_OPERACJI, True
    UstawListeRozwijana KolumnaTabeli(zakres, kolProdukt), SL_PRODUKT
    UstawListeRozwijana KolumnaTabeli(zakres, kolJednostka), SL_JEDNOSTKA, True
    UstawListeRozwijana KolumnaTabeli(zakres, kolDostawca), SL_DOSTAWCA
    UstawListeRozwijana KolumnaTabeli(zakres, kolOdbiorca), SL_ODBIORCA
    UstawListeRozwijana KolumnaTabeli(zakres, kolMiejsceZaladunku), SL_MIEJSCE
    UstawListeRozwijana KolumnaTabeli(zakres, kolMiejscePochodzenia), SL_MIEJSCE
    UstawListeRozwijana KolumnaTabeli(zakres, kolPrzewoznik), SL_PRZEWOZNIK
    UstawListeRozwijana KolumnaTabeli(zakres, kolNrRejestracyjny), SL_POJAZD
    UstawListeRozwijana KolumnaTabeli(zakres, kolUtworzyl), SL_OPERATOR
    UstawListeRozwijana KolumnaTabeli(zakres, kolCzyMagazynowane), SL_TAKNIE, True
    UstawListeRozwijana KolumnaTabeli(zakres, kolDeklaracja), SL_DEKLARACJA
    UstawListeRozwijana KolumnaTabeli(zakres, kolRodzajZrebki), SL_ZREBKA
    UstawListeRozwijana KolumnaTabeli(zakres, kolRabanie), SL_RABANIE
    UstawListeRozwijana KolumnaTabeli(zakres, kolStatus), SL_STATUS, True

Zakoncz:
    WlaczEkran
End Sub

Private Function KolumnaTabeli(ByVal zakres As Range, ByVal numer As Long) As Range
    Set KolumnaTabeli = zakres.Columns(numer)
End Function

' Odświeża cały system - dostępne także z menu Makra (Alt+F8).
Public Sub OdswiezWszystko()
    On Error GoTo Blad

    OdswiezSlownikiZDanych True
    OdswiezNazwaneZakresy
    OdswiezListyFormularza
    OdswiezListyKartoteki
    OdswiezStanMagazynu

    Informacja "System odświeżony." & vbCrLf & vbCrLf & _
               "Zaktualizowano słowniki, listy rozwijane i stan magazynowy."
    Exit Sub

Blad:
    PokazBlad "odświeżanie systemu"
End Sub
