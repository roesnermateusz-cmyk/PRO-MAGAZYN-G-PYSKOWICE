# ResInvest ERP — instrukcja obsługi

Instrukcja dla pracowników obsługujących magazyny, produkcję i sprzedaż.

---

## 1. Logowanie i wybór magazynu

1. Otwórz program (ikona **ResInvest ERP**) lub w przeglądarce adres podany
   przez administratora, np. `http://192.168.1.10:4000`.
2. Podaj **login** i **hasło**.
3. Przy pierwszym logowaniu system poprosi o zmianę hasła.
   Wymagania: minimum 10 znaków, mała litera, wielka litera, cyfra.
4. Jeśli masz dostęp do kilku magazynów, wybierz **magazyn roboczy**.

Magazyn roboczy można zmienić w każdej chwili — przycisk z nazwą magazynu
w górnym pasku. Wybór **Wszystkie magazyny** pokazuje dane zbiorcze.

**Język i motyw:** menu użytkownika (prawy górny róg) → sekcje *Język* i *Motyw*.
Ustawienie zapamiętuje się na koncie.

---

## 2. Pulpit

Pulpit pokazuje bieżącą sytuację wybranego magazynu:

- **Kafle stanów** — ilość każdego produktu w jednostce bazowej,
  pod spodem przeliczenie na pozostałe jednostki;
- **Operacje w okresie** — liczba dokumentów, ilości i wartości w wybranym
  miesiącu (pole wyboru miesiąca w prawym górnym rogu);
- **Ostatnie operacje** — dwanaście ostatnich dokumentów; kliknięcie wiersza
  otwiera szczegóły;
- **Alerty** — stan ujemny, produkty poniżej progu ostrzegawczego,
  dokumenty robocze oczekujące na zatwierdzenie.

---

## 3. Zasada pracy z dokumentami

Każdy dokument przechodzi przez dwa etapy:

| Status | Znaczenie |
|---|---|
| **Roboczy** | Dokument zapisany, **nie wpływa na stan magazynowy**. Można go dowolnie edytować lub usunąć. |
| **Zatwierdzony** | Dokument obowiązujący. Stan magazynowy został zaksięgowany. Edycja niemożliwa. |
| **Anulowany** | Dokument wycofany. Ruchy magazynowe zostały cofnięte stornem. |

> Dopóki dokument jest **roboczy**, nic się nie księguje. Zatwierdzenie to
> moment, w którym operacja staje się faktem — sprawdź dane przed kliknięciem.

---

## 4. Przyjęcie PZ — zakup drewna

*Operacje → Przyjęcia PZ → Dodaj*

**Podsumowanie**

| Pole | Uwagi |
|---|---|
| Data operacji | data faktycznego przyjęcia |
| Magazyn | magazyn przyjmujący (wymagane) |
| Dostawca | wybór z listy (wymagane) |
| Numer obcy | numer dokumentu dostawcy |

**Zakup od nadleśnictwa**

| Pole | Uwagi |
|---|---|
| Numer kwitu wywozowego | np. `KW/2026/00841` |
| Nadleśnictwo | uzupełnia się automatycznie po wyborze dostawcy oznaczonego jako nadleśnictwo |
| Leśnictwo | np. `Leśnictwo Sobieszowice` |

**Dane transportu** — numer rejestracyjny, kierowca (opcjonalnie).

**Pozycje dokumentu**

1. Wybierz **produkt** — jednostka ustawia się automatycznie.
2. Wpisz **ilość** w jednostce bazowej produktu.
3. Pod polem ilości pojawi się przeliczenie na m³, MP i tony.
4. Wpisz **cenę jednostkową** — wartość wyliczy się sama.

**Wartości rzeczywiste.** Aby wpisać zmierzoną masę lub objętość zamiast
wyliczonej, rozwiń *Wyliczane automatycznie z przeliczników…* pod pozycją
i wpisz wartość w odpowiednim polu (m³, MP lub t). Zostanie oznaczona jako
**ręcznie** i nie zmieni stanu magazynowego.

Na końcu: **Zapisz wersję roboczą** → sprawdź → **Zatwierdź**.

---

## 5. Produkcja zrębki

*Operacje → Produkcja → Dodaj*

Produkcja **automatycznie zdejmuje surowiec** ze stanu magazynu w chwili
zatwierdzenia.

**Rąbanie**

| Pole | Uwagi |
|---|---|
| Wykonawca | *Własne* lub *Firma zewnętrzna* |
| Nazwa firmy | wymagane przy wykonawcy zewnętrznym |
| Koszt rąbania | zł za jednostkę wyrobu; puste = stawka domyślna (10 zł) |
| Miejsce produkcji | np. `Plac składowy Zabrze` |

**Pozycje** — dwie role:

| Rola | Znaczenie |
|---|---|
| **Surowiec (zużycie)** | co zostaje zdjęte ze stanu |
| **Wyrób (produkcja)** | co zostaje dodane do stanu |

Przykład zgodny z przelicznikiem `1 m³ = 4 MP`:

```
Surowiec:  Drewno opałowe   100 m³   →  stan spadnie o 100 m³
Wyrób:     Zrębka drzewna   400 MP   →  stan wzrośnie o 400 MP
```

Koszt rąbania wyliczany jest z ilości wyrobu: `400 MP × 10 zł = 4 000 zł`.

> Jeśli surowca nie starczy, system **odrzuci zatwierdzenie** i poda, ile
> brakuje. Nic nie zostanie zapisane.

---

## 6. Wydanie WZ — sprzedaż z magazynu

*Operacje → Wydania WZ → Dodaj*

Wymagane: magazyn, odbiorca, pozycje z ilością i ceną sprzedaży.
Zatwierdzenie zdejmuje towar ze stanu.

---

## 7. Przesunięcie MM

*Operacje → Przesunięcia MM → Dodaj*

Wskaż **magazyn źródłowy** i **docelowy** (muszą być różne) oraz pozycje.

Zatwierdzenie wykonuje obie strony operacji **nierozłącznie** — nie wystąpi
sytuacja, w której towar zniknął z jednego magazynu i nie pojawił się w drugim.

---

## 8. Transport

*Operacje → Transport → Dodaj*

| Pole | Uwagi |
|---|---|
| Przewoźnik | wybór z listy; alternatywnie sam numer rejestracyjny |
| Miejsce załadunku / rozładunku | opis trasy |
| Odległość (km) | podstawa wyliczenia kosztu |
| Stawka (zł/km) | puste = stawka domyślna (5 zł/km) |
| Koszt transportu (zł) | puste = `km × stawka`; wpisanie wartości nadpisuje wyliczenie |

Po zatwierdzeniu na szczegółach dokumentu widoczne są wskaźniki:
**koszt/km**, **koszt/t**, **koszt/MP**, **koszt/m³** — wyliczane z ilości na
pozycjach. Transport **nie zmienia** stanów magazynowych.

---

## 9. Sprzedaż bezpośrednia

*Operacje → Sprzedaż bezpośrednia → Dodaj*

Dla towaru, który jedzie od dostawcy prosto do odbiorcy, bez wjazdu na magazyn.

Wskaż **dostawcę** i **odbiorcę**, a na pozycji podaj **cenę zakupu** oraz
**cenę sprzedaży**. System zarejestruje obie strony transakcji i marżę,
**nie tworząc sztucznego stanu magazynowego**.

---

## 10. Skany dokumentów

Na szczegółach dokumentu: sekcja **Skany dokumentu → Dodaj skan**.

- Formaty: JPG, PNG, WEBP, HEIC, PDF; do 15 MB.
- Skan można dodać do dokumentu roboczego i zatwierdzonego.
- Usunąć można skan dokumentu roboczego; przy zatwierdzonym — tylko administrator.
- **Pobierz** otwiera skan w nowej karcie.

---

## 11. Wydruk

Na szczegółach dokumentu: **Drukuj** — otwiera podgląd dokumentu w formacie A4.

Wydruk zawiera dane firmy, strony transakcji, dane transportu, tabelę pozycji
z przeliczeniami, uwagi i miejsca na podpisy. Wartości wpisane ręcznie oznaczone
są gwiazdką z objaśnieniem.

- Dokument **roboczy** drukuje się z adnotacją *WERSJA ROBOCZA — BEZ MOCY DOKUMENTU*.
- Dokument **anulowany** — z adnotacją *DOKUMENT ANULOWANY*.

Zapis do PDF: w oknie drukowania wybierz drukarkę **Microsoft Print to PDF**
(Windows) lub **Zapisz jako PDF**.

---

## 12. Poprawianie błędów

### Dokument roboczy

*Edytuj* — poprawa dowolnych danych. *Usuń* — całkowite usunięcie.

### Dokument zatwierdzony

Edycja jest niemożliwa. Dostępne są dwie ścieżki:

**Anuluj dokument** — gdy operacja w ogóle nie powinna była wystąpić.
Podaj przyczynę (min. 3 znaki). Ruchy magazynowe zostaną cofnięte.

**Wystaw korektę** — gdy operacja miała miejsce, ale z błędnymi danymi.
System anuluje oryginał i tworzy jego kopię w wersji roboczej. Popraw dane
i zatwierdź. Oba dokumenty pozostają powiązane i widoczne w historii.

> Jeśli towar z anulowanego przyjęcia został już wydany, system **nie pozwoli**
> anulować dokumentu — cofnięcie dałoby stan ujemny. Najpierw anuluj wydanie.

---

## 13. Stany magazynowe i kartoteka ruchów

**Dane → Stany magazynowe** — aktualny stan każdego produktu z przeliczeniem
na m³, MP i tony. Oznaczenia: *Niski stan* (poniżej progu), *Stan ujemny* (błąd
wymagający wyjaśnienia). Opcja *Pokaż pozycje zerowe* ujawnia produkty o stanie 0.

**Dane → Kartoteka ruchów** — pełna historia przychodów i rozchodów.
Filtry: produkt, zakres dat. Kolumna *Status* rozróżnia **Księgowanie**
(ruch pierwotny) i **Storno** (cofnięcie po anulowaniu). Kliknięcie wiersza
otwiera dokument źródłowy.

---

## 14. Raporty

**Dane → Raporty**. Okres: *Miesiąc*, *Rok* lub *Zakres dat*.

| Zakładka | Zawartość |
|---|---|
| **Zestawienie zbiorcze** | obroty wg typu dokumentu, wg produktu i wg miesiąca |
| **Produkcja** | zużycie surowca, ilość wyrobu, **wydajność**, koszt rąbania, wykonawca |
| **Transport** | trasy, kilometry, koszty i wskaźniki jednostkowe |
| **Kontrahenci** | wartość zakupów i sprzedaży w podziale na kontrahentów |

**Eksportuj CSV** — plik do arkusza kalkulacyjnego (średnik, kodowanie UTF-8,
przecinek dziesiętny — otwiera się poprawnie w Excelu).
**Drukuj** — wydruk widocznego zestawienia.

---

## 15. Historia zmian

**Dane → Historia zmian** — rejestr wszystkich operacji w systemie.

Każdy wpis zawiera: datę i godzinę, użytkownika, rodzaj operacji, moduł,
dokument oraz **wartości przed i po zmianie**.

Filtry: tekst, moduł, rodzaj operacji, użytkownik, zakres dat.

Przykład:

```
16.09.2026 08:42 · Jan Kowalski · Edycja · Produkcja · PROD/2026/ZAB/0124
   totalValue: 3 800,00 → 4 000,00
   quantityTotal: 380 → 400
```

Historia jest **niemodyfikowalna** — chroni ją baza danych, nie tylko aplikacja.

---

## 16. Administracja

Dostępna dla użytkowników z odpowiednimi uprawnieniami.

### Użytkownicy

Zakładka *Użytkownicy*: konto, rola, dostęp do magazynów, magazyn domyślny,
wymuszenie zmiany hasła, reset hasła.

Zakładka *Role i uprawnienia*: edycja zestawu uprawnień ról **Manager**,
**Magazynier** i **Podgląd**. Rola **Administrator** ma stały, pełny zestaw.

> Zmiana roli, magazynów lub dezaktywacja konta **natychmiast unieważnia
> aktywne sesje** danego użytkownika.

Role domyślne:

| Rola | Zakres |
|---|---|
| **Administrator** | pełny dostęp, konfiguracja, uprawnienia, kopie zapasowe |
| **Manager** | wszystkie operacje, raporty, historia zmian, produkty, kontrahenci |
| **Magazynier** | operacje w przypisanych magazynach, stany, podstawowe raporty |
| **Podgląd** | wyłącznie odczyt |

### Magazyny

Kod, nazwa, adres, status. Magazynu z historią operacji **nie usuwa się** —
należy go **dezaktywować**. Znika wtedy z list wyboru, a dokumenty historyczne
pozostają nienaruszone.

### Produkty

Kod, nazwa, typ, jednostka bazowa, przeliczniki indywidualne (puste = globalne).

> Jednostki bazowej **nie można zmienić** po wystąpieniu ruchów magazynowych —
> zafałszowałoby to całą historię. Utwórz nowy produkt.

### Kontrahenci

Dane adresowe, NIP, kontakt oraz role: *Dostawca*, *Odbiorca*, *Przewoźnik*,
*Nadleśnictwo*. Oznaczenie *Nadleśnictwo* włącza automatyczne uzupełnianie
nazwy w danych kwitu wywozowego. Wymagana co najmniej jedna z trzech pierwszych ról.

### Ustawienia

| Sekcja | Zawartość |
|---|---|
| **Dane firmy** | nazwa, NIP, adres, kontakt, rachunek — trafiają na wydruki |
| **Przeliczniki jednostek** | m³ na 1 MP (domyślnie 0,25), tony na 1 MP (domyślnie 0,33) |
| **Stawki domyślne** | transport zł/km (5), rąbanie zł/jednostkę (10), domyślny wykonawca rąbania |
| **Polityka stanów** | zgoda na stan ujemny, próg niskiego stanu |
| **Kopie zapasowe** | lista kopii i tworzenie kopii na żądanie |

> Zmiana przelicznika działa **od momentu zapisu** — dokumenty wystawione
> wcześniej zachowują wartości obliczone poprzednim przelicznikiem.

---

## 17. Najczęstsze komunikaty

| Komunikat | Przyczyna | Rozwiązanie |
|---|---|---|
| *Niewystarczający stan magazynowy* | Próba wydania lub zużycia większej ilości niż dostępna | Sprawdź stan; zatwierdź brakujące przyjęcie lub zmniejsz ilość |
| *Dokument został zmieniony przez innego użytkownika* | Ktoś zapisał zmiany w międzyczasie | Odśwież i wprowadź zmiany ponownie |
| *Operacja niedozwolona dla bieżącego statusu dokumentu* | Próba edycji dokumentu zatwierdzonego | Użyj korekty lub anulowania |
| *Brak uprawnień do tej operacji* | Rola nie obejmuje tej czynności | Skontaktuj się z administratorem |
| *Brak dostępu do wskazanego magazynu* | Magazyn nie jest przypisany do konta | Poproś administratora o nadanie dostępu |
| *Konto zostało tymczasowo zablokowane* | Seria nieudanych logowań | Odczekaj 15 minut lub poproś o reset hasła |

---

## 18. Praca na telefonie

Aplikacja działa na telefonie bez instalacji — wystarczy adres w przeglądarce.

- Menu otwiera przycisk **☰** w lewym górnym rogu.
- Tabele wyświetlają się jako **karty** — każdy rekord z etykietami pól.
- Formularze układają się w jednej kolumnie.
- Pola liczbowe otwierają klawiaturę numeryczną; akceptowany jest przecinek dziesiętny.
