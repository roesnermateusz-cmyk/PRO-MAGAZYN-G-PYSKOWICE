Option Explicit

' ======================================================================
'  PRO-MAGAZYN  |  mod_Formularz
'  Obsługa arkusza FORMULARZ - ekranu wprowadzania nowej operacji.
'
'  Formularz jest arkuszem, a nie oknem UserForm. Dzięki temu:
'   * każde pole ma natywną listę rozwijaną Excela wraz z autouzupełnianiem,
'   * ekran działa tak samo na komputerze, w przeglądarce i na telefonie,
'   * układ można rozbudować bez ingerencji w kod binarny formularza.
'
'  Pola są identyfikowane kluczem zapisanym w ukrytej kolumnie A, a nie
'  adresem komórki - przesunięcie wiersza nie psuje logiki.
' ======================================================================

' --- Klucze pól formularza -------------------------------------------
Public Const POLE_TYP As String = "TYP"
Public Const POLE_DATA_OP As String = "DATA_OP"
Public Const POLE_DATA_ZAL As String = "DATA_ZAL"
Public Const POLE_MIEJSCE_ZAL As String = "MIEJSCE_ZAL"
Public Const POLE_DOSTAWCA As String = "DOSTAWCA"
Public Const POLE_ODBIORCA As String = "ODBIORCA"
Public Const POLE_PRODUKT As String = "PRODUKT"
Public Const POLE_VOLUMEN As String = "VOLUMEN"
Public Const POLE_JEDNOSTKA As String = "JEDNOSTKA"
Public Const POLE_CENA_ZAKUPU As String = "CENA_ZAKUPU"
Public Const POLE_CENA_SPRZEDAZY As String = "CENA_SPRZEDAZY"
Public Const POLE_WARTOSC As String = "WARTOSC"
Public Const POLE_NR_WZ As String = "NR_WZ"
Public Const POLE_CZY_MAG As String = "CZY_MAG"
Public Const POLE_DEKLARACJA As String = "DEKLARACJA"
Public Const POLE_ZREBKA As String = "ZREBKA"
Public Const POLE_RABANIE As String = "RABANIE"
Public Const POLE_KOSZT_RABANIA As String = "KOSZT_RABANIA"
Public Const POLE_MIEJSCE_POCH As String = "MIEJSCE_POCH"
Public Const POLE_UWAGI As String = "UWAGI"
Public Const POLE_UTWORZYL As String = "UTWORZYL"

Public Const POLE_PRZEWOZNIK As String = "PRZEWOZNIK"
Public Const POLE_NR_REJ As String = "NR_REJ"
Public Const POLE_ODLEGLOSC As String = "ODLEGLOSC"
Public Const POLE_STAWKA_KM As String = "STAWKA_KM"
Public Const POLE_KOSZT_TRANSPORTU As String = "KOSZT_TRANSPORTU"

Public Const POLE_ROWN_PRODUKCJA As String = "ROWN_PRODUKCJA"
Public Const POLE_ROWN_PRODUKT As String = "ROWN_PRODUKT"
Public Const POLE_ROWN_VOLUMEN As String = "ROWN_VOLUMEN"
Public Const POLE_ROWN_JEDNOSTKA As String = "ROWN_JEDNOSTKA"
Public Const POLE_ROWN_SPRZEDAZ As String = "ROWN_SPRZEDAZ"
Public Const POLE_ROWN_ODBIORCA As String = "ROWN_ODBIORCA"
Public Const POLE_ROWN_CENA As String = "ROWN_CENA"
Public Const POLE_ROWN_TRANSPORT As String = "ROWN_TRANSPORT"
Public Const POLE_SUROWIEC As String = "SUROWIEC"
Public Const POLE_SUROWIEC_VOL As String = "SUROWIEC_VOL"

' Kolumny arkusza formularza.
Public Const KOL_KLUCZ As Long = 1      ' ukryta - klucz pola
Public Const KOL_ETYKIETA As Long = 2
Public Const KOL_WARTOSC As Long = 3
Public Const KOL_PODPOWIEDZ As Long = 4

Private mMapa As Object

' ----------------------------------------------------------------------
'  Dostęp do pól
' ----------------------------------------------------------------------

' Buduje mapę klucz -> numer wiersza (raz na sesję).
Private Sub ZbudujMape()
    Dim ostatni As Long
    Dim wiersz As Long
    Dim klucz As String

    Set mMapa = CreateObject("Scripting.Dictionary")
    ostatni = wsFormularz.Cells(wsFormularz.Rows.Count, KOL_KLUCZ).End(xlUp).Row

    For wiersz = 1 To ostatni
        klucz = UCase$(Trim$(CStr(wsFormularz.Cells(wiersz, KOL_KLUCZ).Value)))
        If Len(klucz) > 0 Then
            If Not mMapa.Exists(klucz) Then mMapa.Add klucz, wiersz
        End If
    Next wiersz
End Sub

Public Sub UniewaznijMapeFormularza()
    Set mMapa = Nothing
End Sub

' Zwraca komórkę wartości dla pola o podanym kluczu.
Public Function KomorkaPola(ByVal klucz As String) As Range
    If mMapa Is Nothing Then ZbudujMape
    If Not mMapa.Exists(UCase$(klucz)) Then
        ' Mapa mogła się zdezaktualizować po zmianie układu arkusza.
        ZbudujMape
        If Not mMapa.Exists(UCase$(klucz)) Then Exit Function
    End If

    Set KomorkaPola = wsFormularz.Cells(mMapa(UCase$(klucz)), KOL_WARTOSC)
End Function

Public Function WartoscPola(ByVal klucz As String) As String
    Dim komorka As Range

    Set komorka = KomorkaPola(klucz)
    If komorka Is Nothing Then Exit Function
    WartoscPola = Znormalizuj(komorka.Value)
End Function

Public Function LiczbaPola(ByVal klucz As String) As Double
    LiczbaPola = LiczbaZTekstu(WartoscPola(klucz), 0)
End Function

Public Function TakPola(ByVal klucz As String) As Boolean
    TakPola = (UCase$(WartoscPola(klucz)) = "TAK")
End Function

Public Sub UstawWartoscPola(ByVal klucz As String, ByVal wartosc As Variant)
    Dim komorka As Range

    Set komorka = KomorkaPola(klucz)
    If komorka Is Nothing Then Exit Sub
    komorka.Value = wartosc
End Sub

' Zaznacza pole jako brakujące (czerwone tło) lub przywraca wygląd domyślny.
Public Sub OznaczPole(ByVal klucz As String, ByVal czyBlad As Boolean)
    Dim komorka As Range

    Set komorka = KomorkaPola(klucz)
    If komorka Is Nothing Then Exit Sub

    If czyBlad Then
        komorka.Interior.Color = RGB(255, 205, 205)
    Else
        komorka.Interior.Color = RGB(255, 255, 255)
    End If
End Sub

Public Sub WyczyscOznaczenia()
    Dim klucz As Variant

    If mMapa Is Nothing Then ZbudujMape
    For Each klucz In mMapa.Keys
        wsFormularz.Cells(mMapa(klucz), KOL_WARTOSC).Interior.Color = RGB(255, 255, 255)
    Next klucz
End Sub

' ----------------------------------------------------------------------
'  Przeliczenia na żywo
' ----------------------------------------------------------------------

' Uruchamiane po każdej zmianie w kolumnie wartości formularza.
Public Sub PrzeliczFormularz()
    Dim volumen As Double
    Dim cena As Double
    Dim wartosc As Double
    Dim odleglosc As Double
    Dim stawka As Double

    On Error GoTo Zakoncz
    WylaczEkran

    ' --- Koszt transportu: odległość x stawka za kilometr -------------
    odleglosc = LiczbaPola(POLE_ODLEGLOSC)
    stawka = LiczbaPola(POLE_STAWKA_KM)

    If stawka <= 0 Then
        stawka = StawkaZaKm()
        UstawWartoscPola POLE_STAWKA_KM, stawka
    End If

    If odleglosc > 0 Then
        UstawWartoscPola POLE_KOSZT_TRANSPORTU, ZaokraglijKwote(odleglosc * stawka)
    End If

    ' --- Wartość operacji ----------------------------------------------
    volumen = LiczbaPola(POLE_VOLUMEN)

    If UCase$(WartoscPola(POLE_TYP)) = UCase$(OP_TRANSPORT) Then
        wartosc = LiczbaPola(POLE_KOSZT_TRANSPORTU)
    ElseIf LiczbaPola(POLE_CENA_SPRZEDAZY) > 0 Then
        cena = LiczbaPola(POLE_CENA_SPRZEDAZY)
        wartosc = ZaokraglijKwote(volumen * cena)
    ElseIf LiczbaPola(POLE_CENA_ZAKUPU) > 0 Then
        cena = LiczbaPola(POLE_CENA_ZAKUPU)
        wartosc = ZaokraglijKwote(volumen * cena)
    Else
        wartosc = 0
    End If

    UstawWartoscPola POLE_WARTOSC, wartosc

Zakoncz:
    WlaczEkran
End Sub

' Dostosowuje widoczność i dostępność pól do wybranego typu operacji.
Public Sub DostosujDoTypu()
    Dim typ As String

    typ = UCase$(WartoscPola(POLE_TYP))

    On Error GoTo Zakoncz
    WylaczEkran

    Select Case typ
        Case UCase$(OP_TRANSPORT)
            ' Operacja czysto kosztowa - pola towarowe nie są potrzebne.
            ZablokujPole POLE_CENA_ZAKUPU, True
            ZablokujPole POLE_CENA_SPRZEDAZY, True
            UstawWartoscPola POLE_CZY_MAG, "NIE"
            UstawWartoscPola POLE_ROWN_PRODUKCJA, "NIE"
            UstawWartoscPola POLE_ROWN_SPRZEDAZ, "NIE"
            UstawWartoscPola POLE_ROWN_TRANSPORT, "NIE"
            If LiczbaPola(POLE_STAWKA_KM) <= 0 Then UstawWartoscPola POLE_STAWKA_KM, StawkaZaKm()

        Case UCase$(OP_ZAKUP)
            ZablokujPole POLE_CENA_ZAKUPU, False
            ZablokujPole POLE_CENA_SPRZEDAZY, True
            UstawWartoscPola POLE_CENA_SPRZEDAZY, ""

        Case UCase$(OP_SPRZEDAZ)
            ZablokujPole POLE_CENA_ZAKUPU, True
            ZablokujPole POLE_CENA_SPRZEDAZY, False
            UstawWartoscPola POLE_CENA_ZAKUPU, ""
            UstawWartoscPola POLE_ROWN_PRODUKCJA, "NIE"
            UstawWartoscPola POLE_ROWN_SPRZEDAZ, "NIE"

        Case Else   ' PRODUKCJA, ZUŻYCIE, MM
            ZablokujPole POLE_CENA_ZAKUPU, True
            ZablokujPole POLE_CENA_SPRZEDAZY, True
            UstawWartoscPola POLE_CENA_ZAKUPU, ""
            UstawWartoscPola POLE_CENA_SPRZEDAZY, ""
            UstawWartoscPola POLE_ROWN_PRODUKCJA, "NIE"
            UstawWartoscPola POLE_ROWN_SPRZEDAZ, "NIE"
    End Select

    ' Operacje równoległe mają sens wyłącznie przy zakupie.
    PokazSekcjeRownolegle (typ = UCase$(OP_ZAKUP))

Zakoncz:
    WlaczEkran
    PrzeliczFormularz
End Sub

Private Sub ZablokujPole(ByVal klucz As String, ByVal czyZablokowane As Boolean)
    Dim komorka As Range

    Set komorka = KomorkaPola(klucz)
    If komorka Is Nothing Then Exit Sub

    If czyZablokowane Then
        komorka.Interior.Color = RGB(235, 235, 235)
        komorka.Locked = True
    Else
        komorka.Interior.Color = RGB(255, 255, 255)
        komorka.Locked = False
    End If
End Sub

Private Sub PokazSekcjeRownolegle(ByVal czyPokazac As Boolean)
    Dim klucze As Variant
    Dim i As Long
    Dim komorka As Range

    klucze = Array(POLE_ROWN_PRODUKCJA, POLE_ROWN_PRODUKT, POLE_ROWN_VOLUMEN, _
                   POLE_ROWN_JEDNOSTKA, POLE_ROWN_SPRZEDAZ, POLE_ROWN_ODBIORCA, _
                   POLE_ROWN_CENA, POLE_ROWN_TRANSPORT)

    For i = LBound(klucze) To UBound(klucze)
        Set komorka = KomorkaPola(CStr(klucze(i)))
        If Not komorka Is Nothing Then
            komorka.EntireRow.Hidden = Not czyPokazac
        End If
    Next i
End Sub

' ----------------------------------------------------------------------
'  Zbieranie danych z formularza
' ----------------------------------------------------------------------

Public Sub ZbierzOperacje(ByRef op As Operacja)
    Dim poprawna As Boolean

    op.Typ = UCase$(WartoscPola(POLE_TYP))
    op.DataOperacji = DataZTekstu(WartoscPola(POLE_DATA_OP), poprawna)
    If Not poprawna Then op.DataOperacji = 0

    op.DataZaladunku = DataZTekstu(WartoscPola(POLE_DATA_ZAL), poprawna)
    op.MaDateZaladunku = poprawna

    op.MiejsceZaladunku = WartoscPola(POLE_MIEJSCE_ZAL)
    op.Dostawca = WartoscPola(POLE_DOSTAWCA)
    op.Odbiorca = WartoscPola(POLE_ODBIORCA)
    op.NrWZ = WartoscPola(POLE_NR_WZ)
    op.CzyMagazynowane = UCase$(WartoscPola(POLE_CZY_MAG))
    If Len(op.CzyMagazynowane) = 0 Then op.CzyMagazynowane = "TAK"
    op.Deklaracja = WartoscPola(POLE_DEKLARACJA)
    op.Produkt = WartoscPola(POLE_PRODUKT)
    op.Volumen = LiczbaPola(POLE_VOLUMEN)
    op.Jednostka = UCase$(WartoscPola(POLE_JEDNOSTKA))
    op.CenaZakupu = LiczbaPola(POLE_CENA_ZAKUPU)
    op.CenaSprzedazy = LiczbaPola(POLE_CENA_SPRZEDAZY)
    op.RodzajZrebki = WartoscPola(POLE_ZREBKA)
    op.Rabanie = WartoscPola(POLE_RABANIE)
    op.KosztRabania = LiczbaPola(POLE_KOSZT_RABANIA)
    op.Przewoznik = WartoscPola(POLE_PRZEWOZNIK)
    op.NrRejestracyjny = NormalizujNrRejestracyjny(WartoscPola(POLE_NR_REJ))
    op.Odleglosc = LiczbaPola(POLE_ODLEGLOSC)
    op.StawkaKm = LiczbaPola(POLE_STAWKA_KM)
    op.KosztTransportu = LiczbaPola(POLE_KOSZT_TRANSPORTU)
    op.MiejscePochodzenia = WartoscPola(POLE_MIEJSCE_POCH)
    op.Uwagi = WartoscPola(POLE_UWAGI)
    op.Utworzyl = WartoscPola(POLE_UTWORZYL)
    op.Status = ST_AKTYWNY
End Sub

Public Sub ZbierzRownolegle(ByRef rown As OperacjeRownolegle)
    rown.Produkcja = TakPola(POLE_ROWN_PRODUKCJA)
    rown.ProduktProdukcji = WartoscPola(POLE_ROWN_PRODUKT)
    rown.VolumenProdukcji = LiczbaPola(POLE_ROWN_VOLUMEN)
    rown.JednostkaProdukcji = UCase$(WartoscPola(POLE_ROWN_JEDNOSTKA))

    rown.Sprzedaz = TakPola(POLE_ROWN_SPRZEDAZ)
    rown.OdbiorcaSprzedazy = WartoscPola(POLE_ROWN_ODBIORCA)
    rown.CenaSprzedazy = LiczbaPola(POLE_ROWN_CENA)

    rown.Transport = TakPola(POLE_ROWN_TRANSPORT)
    rown.Przewoznik = WartoscPola(POLE_PRZEWOZNIK)
    rown.NrRejestracyjny = NormalizujNrRejestracyjny(WartoscPola(POLE_NR_REJ))
    rown.Odleglosc = LiczbaPola(POLE_ODLEGLOSC)
    rown.StawkaKm = LiczbaPola(POLE_STAWKA_KM)
    rown.KosztTransportu = LiczbaPola(POLE_KOSZT_TRANSPORTU)
End Sub

' Sprawdza kompletność danych operacji równoległych.
Private Function SprawdzRownolegle(ByRef rown As OperacjeRownolegle) As String
    Dim lista As String

    If rown.Produkcja Then
        If Len(Trim$(rown.ProduktProdukcji)) = 0 Then
            lista = lista & "- Produkcja równoległa: nie wybrano produktu wyjściowego." & vbCrLf
        End If
        If rown.VolumenProdukcji <= 0 Then
            lista = lista & "- Produkcja równoległa: wolumen musi być większy od zera." & vbCrLf
        End If
        If Len(Trim$(rown.JednostkaProdukcji)) = 0 Then
            lista = lista & "- Produkcja równoległa: nie wybrano jednostki miary." & vbCrLf
        End If
    End If

    If rown.Sprzedaz Then
        If Len(Trim$(rown.OdbiorcaSprzedazy)) = 0 Then
            lista = lista & "- Sprzedaż równoległa: nie wybrano odbiorcy końcowego." & vbCrLf
        End If
        If rown.CenaSprzedazy <= 0 Then
            lista = lista & "- Sprzedaż równoległa: cena musi być większa od zera." & vbCrLf
        End If
    End If

    If rown.Transport Then
        If Len(Trim$(rown.Przewoznik)) = 0 Then
            lista = lista & "- Transport równoległy: nie wybrano przewoźnika." & vbCrLf
        End If
        If Len(Trim$(rown.NrRejestracyjny)) = 0 Then
            lista = lista & "- Transport równoległy: brak numeru rejestracyjnego." & vbCrLf
        End If
        If rown.Odleglosc <= 0 And rown.KosztTransportu <= 0 Then
            lista = lista & "- Transport równoległy: podaj odległość w km albo koszt transportu." & vbCrLf
        End If
    End If

    SprawdzRownolegle = lista
End Function

' ----------------------------------------------------------------------
'  Zapis operacji
' ----------------------------------------------------------------------

' Główna akcja przycisku "ZAPISZ OPERACJĘ".
Public Sub ZapiszZFormularza()
    Dim op As Operacja
    Dim rown As OperacjeRownolegle
    Dim bledy As String
    Dim bledyRown As String
    Dim dopisane As Long
    Dim duplikat As Long

    On Error GoTo Blad

    WyczyscOznaczenia
    ZbierzOperacje op
    ZbierzRownolegle rown

    ' --- Walidacja -----------------------------------------------------
    If Not SprawdzOperacje(op, bledy) Then
        PodswietlBraki op
        Ostrzezenie "Nie można zapisać operacji:" & vbCrLf & vbCrLf & bledy, _
                    APP_NAZWA & " - brak danych"
        Exit Sub
    End If

    If UCase$(op.Typ) = UCase$(OP_ZAKUP) Then
        bledyRown = SprawdzRownolegle(rown)
        If Len(bledyRown) > 0 Then
            Ostrzezenie "Nie można zapisać operacji równoległych:" & vbCrLf & vbCrLf & bledyRown, _
                        APP_NAZWA & " - brak danych"
            Exit Sub
        End If
    End If

    ' --- Ostrzeżenie o duplikacie --------------------------------------
    If UstawienieTak(UST_OSTRZEZ_DUBLE, True) Then
        duplikat = ZnajdzDuplikat(op)
        If duplikat > 0 Then
            If Not Potwierdz("W kartotece istnieje już operacja " & UCase$(op.Typ) & _
                             " z numerem WZ """ & op.NrWZ & """ dla produktu """ & op.Produkt & _
                             """ z dnia " & Format$(op.DataOperacji, "dd.mm.yyyy") & _
                             " (wiersz " & duplikat & ")." & vbCrLf & vbCrLf & _
                             "Czy mimo to zapisać nową operację?", _
                             APP_NAZWA & " - możliwy duplikat") Then
                Exit Sub
            End If
        End If
    End If

    ' --- Zapis ----------------------------------------------------------
    If UCase$(op.Typ) = UCase$(OP_PRODUKCJA) Then
        dopisane = ZapiszProdukcjeSamodzielna(op, WartoscPola(POLE_SUROWIEC), _
                                              LiczbaPola(POLE_SUROWIEC_VOL))
    ElseIf UCase$(op.Typ) = UCase$(OP_ZAKUP) Then
        dopisane = ZapiszOperacjeZlozona(op, rown)
    Else
        ZapiszWiersz op
        dopisane = 1
    End If

    OdswiezNazwaneZakresy
    OdswiezStanMagazynu

    Informacja "Operacja zapisana." & vbCrLf & vbCrLf & _
               "Dopisanych wierszy kartoteki: " & dopisane & vbCrLf & _
               OpisOperacji(op), APP_NAZWA
    WyczyscFormularz
    Exit Sub

Blad:
    PokazBlad "zapis operacji z formularza"
End Sub

' Podświetla pola, których brakuje - szybka informacja zwrotna dla operatora.
Private Sub PodswietlBraki(ByRef op As Operacja)
    OznaczPole POLE_TYP, (Len(Trim$(op.Typ)) = 0)
    OznaczPole POLE_DATA_OP, (op.DataOperacji = 0)
    OznaczPole POLE_UTWORZYL, (UstawienieTak(UST_WYMAGAJ_AUTORA, True) And Len(Trim$(op.Utworzyl)) = 0)

    If UCase$(op.Typ) = UCase$(OP_TRANSPORT) Then
        OznaczPole POLE_PRZEWOZNIK, (Len(Trim$(op.Przewoznik)) = 0)
        OznaczPole POLE_NR_REJ, (Len(Trim$(op.NrRejestracyjny)) = 0)
        OznaczPole POLE_ODLEGLOSC, (op.Odleglosc <= 0 And op.KosztTransportu <= 0)
    Else
        OznaczPole POLE_PRODUKT, (Len(Trim$(op.Produkt)) = 0)
        OznaczPole POLE_VOLUMEN, (op.Volumen <= 0)
        OznaczPole POLE_JEDNOSTKA, (Len(Trim$(op.Jednostka)) = 0)
        OznaczPole POLE_DOSTAWCA, (Len(Trim$(op.Dostawca)) = 0)
        OznaczPole POLE_ODBIORCA, (Len(Trim$(op.Odbiorca)) = 0)
    End If
End Sub

' ----------------------------------------------------------------------
'  Czyszczenie i przygotowanie formularza
' ----------------------------------------------------------------------

Public Sub WyczyscFormularz()
    Dim klucz As Variant
    Dim autor As String

    On Error GoTo Zakoncz
    WylaczEkran

    If mMapa Is Nothing Then ZbudujMape

    ' Autor pozostaje - ta sama osoba zwykle wprowadza serię operacji.
    autor = WartoscPola(POLE_UTWORZYL)

    For Each klucz In mMapa.Keys
        wsFormularz.Cells(mMapa(klucz), KOL_WARTOSC).ClearContents
    Next klucz

    WyczyscOznaczenia

    UstawWartoscPola POLE_TYP, OP_ZAKUP
    UstawWartoscPola POLE_DATA_OP, Date
    UstawWartoscPola POLE_DATA_ZAL, Date
    UstawWartoscPola POLE_CZY_MAG, "TAK"
    UstawWartoscPola POLE_STAWKA_KM, StawkaZaKm()
    UstawWartoscPola POLE_ROWN_PRODUKCJA, "NIE"
    UstawWartoscPola POLE_ROWN_SPRZEDAZ, "NIE"
    UstawWartoscPola POLE_ROWN_TRANSPORT, "NIE"

    If Len(autor) > 0 Then
        UstawWartoscPola POLE_UTWORZYL, autor
    Else
        UstawWartoscPola POLE_UTWORZYL, CStr(Ustawienie(UST_DOMYSLNY_AUTOR, UzytkownikSystemu()))
    End If

Zakoncz:
    WlaczEkran
    DostosujDoTypu
End Sub

' Zakłada listy rozwijane na wszystkich polach formularza.
Public Sub OdswiezListyFormularza()
    On Error GoTo Zakoncz
    WylaczEkran
    OdswiezNazwaneZakresy

    UstawListeRozwijana KomorkaPola(POLE_TYP), SL_TYP_OPERACJI, True
    UstawListeRozwijana KomorkaPola(POLE_MIEJSCE_ZAL), SL_MIEJSCE
    UstawListeRozwijana KomorkaPola(POLE_DOSTAWCA), SL_DOSTAWCA
    UstawListeRozwijana KomorkaPola(POLE_ODBIORCA), SL_ODBIORCA
    UstawListeRozwijana KomorkaPola(POLE_PRODUKT), SL_PRODUKT
    UstawListeRozwijana KomorkaPola(POLE_JEDNOSTKA), SL_JEDNOSTKA, True
    UstawListeRozwijana KomorkaPola(POLE_CZY_MAG), SL_TAKNIE, True
    UstawListeRozwijana KomorkaPola(POLE_DEKLARACJA), SL_DEKLARACJA
    UstawListeRozwijana KomorkaPola(POLE_ZREBKA), SL_ZREBKA
    UstawListeRozwijana KomorkaPola(POLE_RABANIE), SL_RABANIE
    UstawListeRozwijana KomorkaPola(POLE_MIEJSCE_POCH), SL_MIEJSCE
    UstawListeRozwijana KomorkaPola(POLE_UTWORZYL), SL_OPERATOR, False, _
                        "Wybierz z listy lub wpisz imię i nazwisko."
    UstawListeRozwijana KomorkaPola(POLE_PRZEWOZNIK), SL_PRZEWOZNIK
    UstawListeRozwijana KomorkaPola(POLE_NR_REJ), SL_POJAZD
    UstawListeRozwijana KomorkaPola(POLE_ROWN_PRODUKCJA), SL_TAKNIE, True
    UstawListeRozwijana KomorkaPola(POLE_ROWN_PRODUKT), SL_PRODUKT
    UstawListeRozwijana KomorkaPola(POLE_ROWN_JEDNOSTKA), SL_JEDNOSTKA, True
    UstawListeRozwijana KomorkaPola(POLE_ROWN_SPRZEDAZ), SL_TAKNIE, True
    UstawListeRozwijana KomorkaPola(POLE_ROWN_ODBIORCA), SL_ODBIORCA
    UstawListeRozwijana KomorkaPola(POLE_ROWN_TRANSPORT), SL_TAKNIE, True
    UstawListeRozwijana KomorkaPola(POLE_SUROWIEC), SL_PRODUKT

Zakoncz:
    WlaczEkran
End Sub

' Reakcja na zmianę pola - podpowiedzi autouzupełniania.
Public Sub ObsluzZmianePola(ByVal klucz As String)
    Select Case UCase$(klucz)
        Case UCase$(POLE_TYP)
            DostosujDoTypu
        Case UCase$(POLE_PRZEWOZNIK)
            PodpowiedzDlaPrzewoznika WartoscPola(POLE_PRZEWOZNIK)
        Case UCase$(POLE_NR_REJ)
            UstawWartoscPola POLE_NR_REJ, NormalizujNrRejestracyjny(WartoscPola(POLE_NR_REJ))
            PodpowiedzDlaPojazdu WartoscPola(POLE_NR_REJ)
        Case UCase$(POLE_DOSTAWCA)
            PodpowiedzDlaDostawcy WartoscPola(POLE_DOSTAWCA)
        Case UCase$(POLE_PRODUKT)
            PodpowiedzDlaProduktu WartoscPola(POLE_PRODUKT)
            PodpowiedzCeny
        Case UCase$(POLE_ODBIORCA)
            PodpowiedzCeny
        Case UCase$(POLE_ODLEGLOSC), UCase$(POLE_STAWKA_KM), UCase$(POLE_VOLUMEN), _
             UCase$(POLE_CENA_ZAKUPU), UCase$(POLE_CENA_SPRZEDAZY), UCase$(POLE_KOSZT_TRANSPORTU)
            PrzeliczFormularz
    End Select
End Sub

' Proponuje cenę na podstawie ostatniej transakcji z tym kontrahentem.
Private Sub PodpowiedzCeny()
    Dim cena As Double
    Dim typ As String

    typ = UCase$(WartoscPola(POLE_TYP))

    If typ = UCase$(OP_ZAKUP) And LiczbaPola(POLE_CENA_ZAKUPU) <= 0 Then
        cena = OstatniaCenaZakupu(WartoscPola(POLE_DOSTAWCA), WartoscPola(POLE_PRODUKT))
        If cena > 0 Then UstawWartoscPola POLE_CENA_ZAKUPU, cena
    ElseIf typ = UCase$(OP_SPRZEDAZ) And LiczbaPola(POLE_CENA_SPRZEDAZY) <= 0 Then
        cena = OstatniaCenaSprzedazy(WartoscPola(POLE_ODBIORCA), WartoscPola(POLE_PRODUKT))
        If cena > 0 Then UstawWartoscPola POLE_CENA_SPRZEDAZY, cena
    End If

    PrzeliczFormularz
End Sub

' Wstawia proponowany numer WZ na podstawie ostatniego numeru w kartotece.
Public Sub WstawNumerWZ()
    Dim prefiks As String

    If UCase$(WartoscPola(POLE_TYP)) = UCase$(OP_SPRZEDAZ) Then
        prefiks = "WZ"
    Else
        prefiks = "PZ"
    End If

    UstawWartoscPola POLE_NR_WZ, ProponujNumerWZ(prefiks)
End Sub
