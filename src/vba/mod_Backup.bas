Option Explicit

' ======================================================================
'  PRO-MAGAZYN  |  mod_Backup
'  Kopie zapasowe skoroszytu.
'
'  Kopia powstaje automatycznie przy pierwszym zapisie w danym dniu
'  oraz przed każdą operacją ryzykowną (import, czyszczenie kartoteki).
'  Stare kopie są kasowane zgodnie z ustawieniem KOPIE_DO_ZACHOWANIA.
' ======================================================================

' Zwraca folder kopii zapasowych, tworząc go w razie potrzeby.
Public Function FolderKopii() As String
    Dim folder As String

    folder = Znormalizuj(Ustawienie(UST_KOPIA_FOLDER, ""))
    If Len(folder) = 0 Then folder = FolderSkoroszytu() & "\Kopie zapasowe"

    If Not UtworzFolder(folder) Then folder = FolderSkoroszytu()

    FolderKopii = folder
End Function

' Tworzy kopię zapasową skoroszytu. Zwraca ścieżkę albo pusty tekst.
Public Function UtworzKopieZapasowa(Optional ByVal cicho As Boolean = False) As String
    Dim folder As String
    Dim nazwa As String
    Dim sciezka As String

    On Error GoTo Blad

    If Len(ThisWorkbook.Path) = 0 Then
        If Not cicho Then
            Ostrzezenie "Skoroszyt nie został jeszcze zapisany na dysku." & vbCrLf & _
                        "Zapisz go, zanim utworzysz kopię zapasową."
        End If
        Exit Function
    End If

    folder = FolderKopii()
    nazwa = Replace$(ThisWorkbook.Name, ".xlsm", "") & _
            "_kopia_" & Format$(Now, "yyyy-mm-dd_hhnnss") & ".xlsm"
    sciezka = folder & "\" & nazwa

    Application.DisplayAlerts = False
    ThisWorkbook.SaveCopyAs sciezka
    Application.DisplayAlerts = True

    UsunStareKopie folder

    ZapisDoHistorii "KOPIA ZAPASOWA", "", "", UzytkownikSystemu(), "Utworzono kopię: " & nazwa

    If Not cicho Then
        Informacja "Kopia zapasowa utworzona:" & vbCrLf & vbCrLf & sciezka
    End If

    UtworzKopieZapasowa = sciezka
    Exit Function

Blad:
    Application.DisplayAlerts = True
    If Not cicho Then
        Ostrzezenie "Nie udało się utworzyć kopii zapasowej." & vbCrLf & _
                    "Opis błędu: " & Err.Description
    End If
End Function

' Usuwa najstarsze kopie, zostawiając liczbę z ustawień.
Private Sub UsunStareKopie(ByVal folder As String)
    Dim fso As Object
    Dim pliki As Object
    Dim plik As Object
    Dim nazwy() As String
    Dim daty() As Date
    Dim ile As Long
    Dim i As Long, j As Long
    Dim tempNazwa As String
    Dim tempData As Date
    Dim doZachowania As Long

    doZachowania = CLng(UstawienieLiczba(UST_KOPIA_ILE, 30))
    If doZachowania <= 0 Then Exit Sub

    On Error GoTo Zakoncz
    Set fso = CreateObject("Scripting.FileSystemObject")
    If Not fso.FolderExists(folder) Then Exit Sub

    Set pliki = fso.GetFolder(folder).Files

    ReDim nazwy(0 To pliki.Count)
    ReDim daty(0 To pliki.Count)

    For Each plik In pliki
        If InStr(LCase$(plik.Name), "_kopia_") > 0 Then
            nazwy(ile) = plik.Path
            daty(ile) = plik.DateCreated
            ile = ile + 1
        End If
    Next plik

    If ile <= doZachowania Then Exit Sub

    ' Sortowanie od najnowszej do najstarszej.
    For i = 0 To ile - 2
        For j = i + 1 To ile - 1
            If daty(i) < daty(j) Then
                tempData = daty(i): daty(i) = daty(j): daty(j) = tempData
                tempNazwa = nazwy(i): nazwy(i) = nazwy(j): nazwy(j) = tempNazwa
            End If
        Next j
    Next i

    For i = doZachowania To ile - 1
        On Error Resume Next
        fso.DeleteFile nazwy(i), True
        On Error GoTo Zakoncz
    Next i

Zakoncz:
    On Error GoTo 0
End Sub

' Wywoływane przez zdarzenie zapisu skoroszytu.
' Kopia powstaje najwyżej raz dziennie, żeby nie spowalniać pracy.
Public Sub KopiaPrzyZapisie()
    Dim ostatnia As String

    If Not UstawienieTak(UST_KOPIA_AUTO, True) Then Exit Sub
    If Len(ThisWorkbook.Path) = 0 Then Exit Sub

    ostatnia = Znormalizuj(Ustawienie("OSTATNIA_KOPIA", ""))
    If ostatnia = Format$(Date, "yyyy-mm-dd") Then Exit Sub

    If Len(UtworzKopieZapasowa(True)) > 0 Then
        ZapiszUstawienie "OSTATNIA_KOPIA", Format$(Date, "yyyy-mm-dd")
    End If
End Sub

' Otwiera folder z kopiami zapasowymi w Eksploratorze Windows.
Public Sub OtworzFolderKopii()
    Dim folder As String

    folder = FolderKopii()
    On Error Resume Next
    Shell "explorer.exe """ & folder & """", vbNormalFocus
    On Error GoTo 0
End Sub

' Zestawia dostępne kopie zapasowe wraz z datami.
Public Sub PokazKopieZapasowe()
    Dim fso As Object
    Dim folder As String
    Dim plik As Object
    Dim lista As String
    Dim ile As Long

    folder = FolderKopii()

    On Error GoTo Blad
    Set fso = CreateObject("Scripting.FileSystemObject")

    If Not fso.FolderExists(folder) Then
        Informacja "Folder kopii zapasowych jeszcze nie istnieje."
        Exit Sub
    End If

    For Each plik In fso.GetFolder(folder).Files
        If InStr(LCase$(plik.Name), "_kopia_") > 0 Then
            ile = ile + 1
            If ile <= 15 Then
                lista = lista & Format$(plik.DateCreated, "dd.mm.yyyy hh:mm") & "   " & _
                        plik.Name & vbCrLf
            End If
        End If
    Next plik

    If ile = 0 Then
        Informacja "Brak kopii zapasowych w folderze:" & vbCrLf & folder
    Else
        Informacja "Folder kopii: " & folder & vbCrLf & _
                   "Liczba kopii: " & ile & vbCrLf & vbCrLf & _
                   "Ostatnie kopie:" & vbCrLf & lista
    End If
    Exit Sub

Blad:
    PokazBlad "odczyt listy kopii zapasowych"
End Sub
