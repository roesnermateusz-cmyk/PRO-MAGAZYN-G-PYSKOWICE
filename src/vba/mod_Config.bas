Option Explicit

' ======================================================================
'  PRO-MAGAZYN  |  mod_Config
'  Centralna konfiguracja systemu: stałe, układ tabeli danych oraz
'  dostęp do arkusza USTAWIENIA.
'
'  Zasada: żaden inny moduł nie zapisuje na sztywno numerów kolumn ani
'  parametrów biznesowych - wszystko przechodzi przez ten moduł.
' ======================================================================

Public Const APP_NAZWA As String = "PRO-MAGAZYN"
Public Const APP_WERSJA As String = "2.0.0"

' --- Nazwy obiektów skoroszytu ---------------------------------------
Public Const TABELA_DANE As String = "Tabela_dane"

' --- Typy operacji ----------------------------------------------------
Public Const OP_ZAKUP As String = "ZAKUP"
Public Const OP_SPRZEDAZ As String = "SPRZEDAŻ"
Public Const OP_PRODUKCJA As String = "PRODUKCJA"
Public Const OP_ZUZYCIE As String = "ZUŻYCIE"
Public Const OP_MM As String = "MM"
Public Const OP_TRANSPORT As String = "TRANSPORT"

' --- Statusy wiersza --------------------------------------------------
Public Const ST_AKTYWNY As String = "AKTYWNY"
Public Const ST_SKORYGOWANY As String = "SKORYGOWANY"
Public Const ST_KOREKTA As String = "KOREKTA"

' --- Układ kolumn tabeli Dane ----------------------------------------
' Kolumny 1-30 wypełnia silnik, kolumny 31+ to formuły przeliczeniowe.
Public Enum kolDane
    kolDataZaladunku = 1
    kolMiejsceZaladunku = 2
    kolDataOperacji = 3
    kolDostawca = 4
    kolTypOperacji = 5
    kolNrWZ = 6
    kolCzyMagazynowane = 7
    kolDeklaracja = 8
    kolVolumen = 9
    kolJednostka = 10
    kolCenaZakupu = 11
    kolWartosc = 12
    kolCenaSprzedazy = 13
    kolProdukt = 14
    kolRodzajZrebki = 15
    kolRabanie = 16
    kolKosztRabania = 17
    kolPrzewoznik = 18
    kolNrRejestracyjny = 19
    kolOdleglosc = 20
    kolStawkaKm = 21
    kolKosztTransportu = 22
    kolOdbiorca = 23
    kolMiejscePochodzenia = 24
    kolUwagi = 25
    kolUtworzyl = 26
    kolDataDodania = 27
    kolIdOperacji = 28
    kolIdPowiazania = 29
    kolStatus = 30
End Enum

' Ostatnia kolumna wypełniana przez silnik (dalej są formuły).
Public Const KOL_OSTATNIA_DANA As Long = 30

' --- Klucze ustawień --------------------------------------------------
Public Const UST_FIRMA As String = "FIRMA"
Public Const UST_MAGAZYN As String = "MAGAZYN"
Public Const UST_STAWKA_KM As String = "STAWKA_TRANSPORT_KM"
Public Const UST_MP_NA_TONE As String = "PRZELICZNIK_MP_TONA"
Public Const UST_M3_NA_MP As String = "PRZELICZNIK_M3_MP"
Public Const UST_GJ_NA_TONE As String = "PRZELICZNIK_GJ_TONA"
Public Const UST_DNI_WSTECZ As String = "MAX_DNI_ROBOCZYCH_WSTECZ"
Public Const UST_DNI_WPRZOD As String = "MAX_DNI_WPRZOD"
Public Const UST_KOPIA_FOLDER As String = "FOLDER_KOPII"
Public Const UST_KOPIA_AUTO As String = "KOPIA_AUTOMATYCZNA"
Public Const UST_KOPIA_ILE As String = "KOPIE_DO_ZACHOWANIA"
Public Const UST_WYMAGAJ_AUTORA As String = "WYMAGAJ_POLA_UTWORZYL"
Public Const UST_OSTRZEZ_DUBLE As String = "OSTRZEGAJ_O_DUBLACH"
Public Const UST_DOMYSLNY_AUTOR As String = "DOMYSLNY_AUTOR"
Public Const UST_SUROWIEC As String = "SUROWIEC_DOMYSLNY"


' ----------------------------------------------------------------------
'  Kontrakt danych: pojedyncza operacja magazynowa
' ----------------------------------------------------------------------
'  Struktura przekazywana pomiędzy formularzem, walidacją i silnikiem
'  zapisu. Dzięki niej dodanie nowego pola wymaga zmiany w jednym miejscu.
Public Type Operacja
    Typ As String
    DataOperacji As Date
    DataZaladunku As Date
    MaDateZaladunku As Boolean
    MiejsceZaladunku As String
    Dostawca As String
    Odbiorca As String
    NrWZ As String
    CzyMagazynowane As String
    Deklaracja As String
    Produkt As String
    Volumen As Double
    Jednostka As String
    CenaZakupu As Double
    CenaSprzedazy As Double
    RodzajZrebki As String
    Rabanie As String
    KosztRabania As Double
    Przewoznik As String
    NrRejestracyjny As String
    Odleglosc As Double
    StawkaKm As Double
    KosztTransportu As Double
    MiejscePochodzenia As String
    Uwagi As String
    Utworzyl As String
    IdPowiazania As String
    Status As String
End Type

Private mUstawienia As Object

' ----------------------------------------------------------------------
'  Dostęp do arkusza USTAWIENIA
' ----------------------------------------------------------------------

' Zwraca wartość ustawienia; gdy klucza brak - wartość domyślną.
Public Function Ustawienie(ByVal klucz As String, Optional ByVal domyslna As Variant = "") As Variant
    If mUstawienia Is Nothing Then WczytajUstawienia

    If mUstawienia.Exists(UCase$(klucz)) Then
        Ustawienie = mUstawienia(UCase$(klucz))
    Else
        Ustawienie = domyslna
    End If
End Function

Public Function UstawienieLiczba(ByVal klucz As String, ByVal domyslna As Double) As Double
    UstawienieLiczba = LiczbaZTekstu(Ustawienie(klucz, domyslna), domyslna)
End Function

Public Function UstawienieTak(ByVal klucz As String, Optional ByVal domyslna As Boolean = True) As Boolean
    Dim surowa As String

    surowa = UCase$(Trim$(CStr(Ustawienie(klucz, IIf(domyslna, "TAK", "NIE")))))
    UstawienieTak = (surowa = "TAK" Or surowa = "PRAWDA" Or surowa = "TRUE" Or surowa = "1")
End Function

' Odczytuje cały arkusz ustawień do pamięci podręcznej.
Public Sub WczytajUstawienia()
    Dim wiersz As Long
    Dim ostatni As Long
    Dim klucz As String

    Set mUstawienia = CreateObject("Scripting.Dictionary")

    On Error Resume Next
    ostatni = wsUstawienia.Cells(wsUstawienia.Rows.Count, 2).End(xlUp).Row
    On Error GoTo 0
    If ostatni < 2 Then Exit Sub

    For wiersz = 2 To ostatni
        klucz = UCase$(Trim$(CStr(wsUstawienia.Cells(wiersz, 2).Value)))
        If Len(klucz) > 0 Then mUstawienia(klucz) = wsUstawienia.Cells(wiersz, 3).Value
    Next wiersz
End Sub

' Zapisuje ustawienie do arkusza i odświeża pamięć podręczną.
Public Sub ZapiszUstawienie(ByVal klucz As String, ByVal wartosc As Variant)
    Dim wiersz As Long
    Dim ostatni As Long

    ostatni = wsUstawienia.Cells(wsUstawienia.Rows.Count, 2).End(xlUp).Row
    If ostatni < 2 Then ostatni = 1

    For wiersz = 2 To ostatni
        If UCase$(Trim$(CStr(wsUstawienia.Cells(wiersz, 2).Value))) = UCase$(klucz) Then
            wsUstawienia.Cells(wiersz, 3).Value = wartosc
            WczytajUstawienia
            Exit Sub
        End If
    Next wiersz

    wsUstawienia.Cells(ostatni + 1, 2).Value = UCase$(klucz)
    wsUstawienia.Cells(ostatni + 1, 3).Value = wartosc
    WczytajUstawienia
End Sub

' Unieważnia pamięć podręczną - wywoływane po ręcznej edycji arkusza.
Public Sub UniewaznijUstawienia()
    Set mUstawienia = Nothing
End Sub

' ----------------------------------------------------------------------
'  Parametry biznesowe (czytelne skróty dla silnika)
' ----------------------------------------------------------------------

' Stawka za kilometr transportu. Domyślnie 5 zł/km.
Public Function StawkaZaKm() As Double
    StawkaZaKm = UstawienieLiczba(UST_STAWKA_KM, 5#)
    If StawkaZaKm <= 0 Then StawkaZaKm = 5#
End Function

Public Function PrzelicznikMpNaTone() As Double
    PrzelicznikMpNaTone = UstawienieLiczba(UST_MP_NA_TONE, 0.33)
    If PrzelicznikMpNaTone <= 0 Then PrzelicznikMpNaTone = 0.33
End Function

Public Function PrzelicznikM3NaMp() As Double
    PrzelicznikM3NaMp = UstawienieLiczba(UST_M3_NA_MP, 4#)
    If PrzelicznikM3NaMp <= 0 Then PrzelicznikM3NaMp = 4#
End Function

Public Function PrzelicznikGjNaTone() As Double
    PrzelicznikGjNaTone = UstawienieLiczba(UST_GJ_NA_TONE, 8.5)
    If PrzelicznikGjNaTone <= 0 Then PrzelicznikGjNaTone = 8.5
End Function

' Zwraca tabelę główną (ListObject) albo zgłasza czytelny błąd.
Public Function TabelaDanych() As ListObject
    On Error Resume Next
    Set TabelaDanych = wsDane.ListObjects(TABELA_DANE)
    On Error GoTo 0

    If TabelaDanych Is Nothing Then
        Err.Raise vbObjectError + 1001, "mod_Config.TabelaDanych", _
                  "Nie znaleziono tabeli """ & TABELA_DANE & """ w arkuszu Dane. " & _
                  "Skoroszyt jest uszkodzony - przywróć kopię zapasową."
    End If
End Function
