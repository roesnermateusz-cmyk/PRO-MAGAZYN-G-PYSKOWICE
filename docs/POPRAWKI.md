# Wykaz poprawek — z wersji „Magazyn Zabrze” do PRO-MAGAZYN 2.0.0

Dokument opisuje błędy znalezione w poprzedniej wersji systemu (makra `frmDane`
i `frmDodatkowe` oraz formuły kolumn wyliczanych), sposób ich naprawy i wpływ
na dane. Liczby pochodzą z analizy kartoteki liczącej **577 operacji**.

---

## 1. Wartość operacji zapisywana jako zero

**Gdzie:** `frmDane.CommandButton1_Click`

```vba
ws.Cells(lastRow, 12).Value = ValNum(lblWartosc.Caption)
```

**Na czym polegał błąd.** `lblWartosc.Caption` to sformatowany tekst,
np. `"6 747,00 zł"`. Funkcja `ValNum` sprawdzała `IsNumeric(txtValue)`, które dla
takiego ciągu zwraca `False`, więc do kolumny *Wartość* trafiało `0`.
Błąd nie występował przy operacjach równoległych, bo `frmDodatkowe` liczyło
wartość wprost (`Volumen * Cena`) — stąd niespójność w danych.

**Skutek w danych:** 7 wierszy `ZAKUP` z podaną ceną i zerową wartością.

**Poprawka.** Wartość liczy `mod_Operacje.WartoscOperacji` na podstawie liczb:

```vba
Case UCase$(OP_ZAKUP)
    WartoscOperacji = ZaokraglijKwote(op.Volumen * op.CenaZakupu)
```

Dodatkowo `mod_Narzedzia.LiczbaZTekstu` radzi sobie ze spacjami, symbolem waluty
i przecinkiem dziesiętnym, więc podobny tekst nie zwróci już zera.
Migracja przeliczyła 7 uszkodzonych wierszy.

---

## 2. Ryzyko nadpisania istniejących danych

**Gdzie:** `frmDane` i `frmDodatkowe`

```vba
lastRow = ws.Cells(ws.Rows.Count, 2).End(xlUp).Row + 1
```

**Na czym polegał błąd.** Numer pierwszego wolnego wiersza wyznaczano po
kolumnie **B** (*Miejsce załadunku*), która jest polem opcjonalnym — w kartotece
bywała pusta (m.in. we wszystkich automatycznych wpisach `PRODUKCJA`).
Jeżeli ostatnie wiersze miały pustą kolumnę B, `End(xlUp)` zatrzymywał się wyżej
i kolejna operacja **nadpisywała istniejące dane**.

**Poprawka.** Zapis korzysta z obiektu tabeli:

```vba
Set nowy = tabela.ListRows.Add
```

`ListRows.Add` zawsze dopisuje na końcu tabeli, niezależnie od pustych komórek,
i automatycznie rozciąga kolumny wyliczane.

---

## 3. Przesunięcia międzymagazynowe (MM) nie zmieniały stanów

**Gdzie:** kolumna `Ruch_magazyn_MP`

```
=IF(G2<>"TAK",0,IF(OR(E2="ZAKUP",E2="PRODUKCJA"),Z2,
   IF(OR(E2="SPRZEDAŻ",E2="ZUŻYCIE"),-Z2,0)))
```

**Na czym polegał błąd.** Formuła nie obsługiwała typu `MM`. Przesunięcie
towaru między magazynami nie zmniejszało stanu źródła ani nie zwiększało celu.

**Skutek w danych:** 78 przesunięć MM bez wpływu na ewidencję lokalizacji.

**Poprawka.** Stan liczony jest per lokalizacja w `mod_Magazyn.KierunekRuchu`:

```vba
If t = UCase$(OP_MM) Then
    If KluczPorownania(odbiorca) = KluczPorownania(lokalizacja) Then
        KierunekRuchu = 1
    ElseIf KluczPorownania(dostawca) = KluczPorownania(lokalizacja) Then
        KierunekRuchu = -1
    End If
    Exit Function
End If
```

Stan globalny pozostaje bez zmian (**35 736,71 MP**) — MM to przesunięcie
wewnętrzne. Zmienia się natomiast obraz poszczególnych magazynów.

---

## 4. Błędne przeliczenie M3 na tony

**Gdzie:** kolumna `Wolumen_t`

```
=IF(I2="",0,IF(ISNUMBER(SEARCH("mp",LOWER(J2))),I2*0.33,
   IF(ISNUMBER(SEARCH("ton",LOWER(J2))),I2,I2*0.33)))
```

**Na czym polegał błąd.** Jednostka `M3` wpadała do gałęzi końcowej `I2*0,33`,
czyli była liczona tak, jakby 1 m³ = 1 MP. Tymczasem kolumna `Wolumen_MP`
poprawnie stosowała przelicznik `M3 → MP = 4`. Obie kolumny opisywały więc
tę samą pozycję inaczej.

**Skutek w danych:** 111 wierszy w jednostce M3 z zaniżoną masą.

**Poprawka.** Tony liczone są zawsze przez metry przestrzenne:

```
=IF(I{r}="",0,IF(ISNUMBER(SEARCH("TON",UPPER(J{r}))),I{r},
   IF(ISNUMBER(SEARCH("GJ",UPPER(J{r}))),I{r}/Przelicznik_GJ_tona,
   AE{r}*Przelicznik_MP_tona)))
```

Masa całkowita rośnie z **9 540 t** do **11 793 t** — to nie jest zmiana stanu,
tylko usunięcie zaniżenia.

---

## 5. Wartość zakupu mnożona przez niewłaściwy wolumen

**Gdzie:** kolumna `Wartość_zakupu_zł_calc`

```
=IF(E2="ZAKUP",IF(L2<>"",L2,Z2*K2),0)
```

**Na czym polegał błąd.** `Z2` to wolumen przeliczony na MP, a `K2` to cena
w jednostce transakcji (zł/tona albo zł/MP). Dla pozycji rozliczanych w tonach
wartość wychodziła zawyżona ok. trzykrotnie.

**Poprawka.** Mnożymy przez wolumen w jednostce ceny (kolumna `I`):

```
=IF(UPPER(AD{r})="SKORYGOWANY",0,IF(UPPER(E{r})="ZAKUP",
   IF(L{r}<>"",L{r},I{r}*K{r}),0))
```

Ta sama poprawka dotyczy `Wartość_sprzedaży_zł`.

---

## 6. Błędna klasyfikacja transportu własnego

**Gdzie:** kolumna `Typ_transportu_heurystyka`

```
=IF(OR(ISNUMBER(SEARCH("ric pl",LOWER(R2))),
       ISNUMBER(SEARCH("wojciechowski",LOWER(R2)))),"Własny","Zewnętrzny")
```

**Na czym polegał błąd.** Reguła rozpoznawała tylko dwie nazwy, a przewoźnicy
w kartotece zapisani są jako `własny (Wilczak)`, `własny (Kretek)`,
`własny (Chrzan)`, `własny (Wiór)`.

**Skutek w danych:** 177 kursów własnych figurowało jako zewnętrzne.

| Klasyfikacja | Poprzednio | Po poprawce |
|---|---|---|
| Własny | 8 | 177 |
| Zewnętrzny | 196 | 27 |

**Poprawka.** Reguła rozpoznaje przedrostek `własn` / `wlasn`
(`mod_Raporty.TypTransportu` i kolumna `Typ_transportu`).

---

## 7. Nieskończona pętla w polu numeru rejestracyjnego

**Gdzie:** `frmDane.txtNrRej_Change`

```vba
Private Sub txtNrRej_Change()
    txtNrRej.Value = UCase(txtNrRej.Value)
End Sub
```

**Na czym polegał błąd.** Przypisanie wartości do pola wywołuje zdarzenie
`Change` ponownie — także wtedy, gdy wartość się nie zmieniła. Kod wywoływał
sam siebie aż do błędu „Out of stack space”, a przy okazji przy każdym znaku
przestawiał kursor na początek pola.

**Poprawka.** Normalizacja odbywa się w `mod_Narzedzia.NormalizujNrRejestracyjny`
i jest wywoływana z `mod_Formularz.ObsluzZmianePola` przy wyłączonych zdarzeniach.

---

## 8. Brak walidacji daty załadunku

**Gdzie:** `frmDane.CommandButton1_Click`

```vba
ws.Cells(lastRow, 1).Value = CDate(txtDataZal.Value)
```

**Na czym polegał błąd.** `CDate` wywołane na pustym lub błędnym tekście zgłasza
błąd wykonania 13 (*Type mismatch*) w połowie zapisu — część kolumn wiersza była
już wypełniona, reszta nie.

**Poprawka.** `mod_Narzedzia.DataZTekstu` zwraca flagę poprawności zamiast
zgłaszać błąd, a pole *Data załadunku* jest opcjonalne.

---

## 9. Sprzedaż i zużycie nie zdejmowały towaru ze stanu

**Gdzie:** formuła `Ruch_magazyn_MP` w zestawieniu z makrem `frmDodatkowe`

**Na czym polegał błąd.** Formuła wymagała `Czy magazynowane = "TAK"`, żeby
policzyć rozchód, ale `frmDodatkowe` wpisywało `"NIE"` we wszystkich generowanych
wierszach `SPRZEDAŻ` i `ZUŻYCIE`. Przy operacjach równoległych przychód był
księgowany, rozchód nie.

**Poprawka.** Znaczenie pola jest teraz jednoznaczne: *Czy magazynowane = TAK*
oznacza „ten wiersz zmienia stan magazynu”. Operacje przelotowe
(zakup od razu na sprzedaż) mają `NIE` **we wszystkich** wierszach łańcucha,
więc bilansują się do zera.

---

## 10. Pozostałe usprawnienia

| Obszar | Poprzednio | Teraz |
|---|---|---|
| Podpis operatora | doklejany do pola *Uwagi* jako tekst `Utworzył: …` | osobna kolumna **Utworzył** z listą rozwijaną (469 wpisów przeniesionych automatycznie) |
| Nazwa arkusza słownika | `Sheets("słownik")` wyszukiwane po nazwie | dostęp po nazwie kodowej `wsSlownik` — odporne na zmianę nazwy |
| Surowiec przy produkcji | nazwa `"Zrzyna"` wpisana na stałe w kodzie | parametr `SUROWIEC_DOMYSLNY` w arkuszu USTAWIENIA |
| Zapis operacji złożonej | brak wycofania przy błędzie w połowie | transakcja — przy błędzie wszystkie wiersze są usuwane |
| Blokada pola *Czy magazynowane* | raz zablokowane, nie wracało do stanu aktywnego | stan zależy wyłącznie od bieżącego typu operacji |
| Duplikaty | brak kontroli | ostrzeżenie przy powtórzonym numerze WZ dla tego samego produktu i daty |
| Ślad zmian | brak | dziennik zdarzeń (arkusz HISTORIA) |
| Usuwanie wpisów | nieodwracalne | storno z zachowaniem wiersza pierwotnego |

---

## Znalezisko w danych — do decyzji użytkownika

Po włączeniu ewidencji per lokalizacja widać, że **wszystkie 280 zakupów**
zapisano z odbiorcą `Magazyn Zabrze`, podczas gdy 54 przesunięcia MM wychodzą
z magazynu `Magazyn Pyskowice`. Towar nigdy formalnie nie wpłynął do Pyskowic,
więc ta lokalizacja wykazuje stan ujemny:

| Lokalizacja | Stan [MP] |
|---|---|
| Magazyn Zabrze | 40 495,89 |
| Magazyn Pyskowice | −4 270,30 |
| Magazyn Brąszewice | −424,00 |
| NDL Chrzanów, Leśnictwo Mętków+Szczakowa | −64,88 |

**Stan globalny (35 736,71 MP) jest prawidłowy** — problem dotyczy wyłącznie
przypisania do magazynów. Aby ewidencja lokalizacji była wiarygodna, przyjęcia
powinny wskazywać magazyn, który fizycznie przyjmuje towar.

Arkusz MAGAZYN oznacza takie pozycje na czerwono i wypisuje ostrzeżenie, więc
problem nie przejdzie niezauważony. System niczego tu nie poprawia samodzielnie —
to decyzja księgowa, nie techniczna.
