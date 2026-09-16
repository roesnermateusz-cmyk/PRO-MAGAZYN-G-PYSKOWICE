# Wdrożenie na Windows

Dokument opisuje budowę instalatora, instalację, pracę wielostanowiskową,
aktualizacje i konserwację systemu.

---

## 1. Model wdrożenia

```
        ┌──────────────────────────────────────────┐
        │  STANOWISKO SERWEROWE (biuro)            │
        │  ResInvest ERP — instalacja .exe         │
        │  ┌────────────────────────────────────┐  │
        │  │ Serwer API + baza + aplikacja      │  │
        │  │ C:\ProgramData\ResInvestERP        │  │
        │  │ nasłuch 0.0.0.0:4000               │  │
        │  └────────────────────────────────────┘  │
        └────────────────┬─────────────────────────┘
                         │ sieć lokalna firmy
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   Magazynier       Magazynier        Manager
   RiC Zabrze       RiC Rokitki       (telefon)
   przeglądarka     przeglądarka      przeglądarka
```

Program instaluje się **na jednym komputerze**, który pełni rolę serwera.
Pozostałe stanowiska nie wymagają instalacji — łączą się przeglądarką.

Wymagania dla stanowiska serwerowego:

| Element | Minimum | Zalecane |
|---|---|---|
| System | Windows 10 64-bit | Windows 11 lub Windows Server 2019+ |
| Pamięć | 4 GB | 8 GB |
| Dysk | 2 GB wolnego | SSD, 10 GB (baza + skany + kopie) |
| Sieć | stały adres IP w sieci lokalnej | rezerwacja adresu na routerze |

Komputer serwerowy powinien być włączony w godzinach pracy firmy.

---

## 2. Budowanie instalatora

> Instalator buduje się **na maszynie Windows**. `electron-builder` kompiluje
> moduł natywny bazy danych pod docelową architekturę — budowanie z Linuksa
> nie da poprawnego pliku `.exe`.

### Przygotowanie

Zainstaluj na maszynie budującej:

- [Node.js 22 LTS](https://nodejs.org/) (zawiera npm),
- [Git](https://git-scm.com/download/win),
- **Visual Studio Build Tools** z komponentem *Desktop development with C++*
  (wymagane do kompilacji `better-sqlite3`).

### Budowanie

```powershell
git clone <adres-repozytorium> resinvest-erp
cd resinvest-erp

npm install
npm run verify            # typecheck + lint + 84 testy + build

cd desktop
npm install               # pobiera Electron i przebudowuje moduł natywny
npm run dist
```

Wynik: `desktop\release\ResInvest-ERP-Setup-1.0.0.exe` — jeden plik,
bez dodatkowych zależności.

> `npm run verify` musi zakończyć się powodzeniem. Nie buduj instalatora
> z kodu, w którym testy lub build nie przechodzą.

### Suma kontrolna

```powershell
Get-FileHash .\release\ResInvest-ERP-Setup-1.0.0.exe -Algorithm SHA256
```

Zapisz wynik razem z plikiem instalatora — pozwala zweryfikować, że plik
przekazany użytkownikowi nie został zmieniony.

### Podpis kodu (opcjonalnie)

Bez podpisu Windows SmartScreen wyświetli ostrzeżenie przy pierwszej instalacji.
Po zakupie certyfikatu odkomentuj w `desktop/electron-builder.yml`:

```yaml
win:
  certificateFile: build/certyfikat.pfx
  certificatePassword: ${env.CERT_PASSWORD}
```

---

## 3. Instalacja

1. Uruchom `ResInvest-ERP-Setup-1.0.0.exe` **jako administrator**.
2. Wybierz katalog instalacji (domyślnie `C:\Program Files\ResInvest ERP`).
3. Instalator:
   - kopiuje program,
   - tworzy katalog danych `C:\ProgramData\ResInvestERP`,
   - dodaje regułę zapory Windows dla portu 4000 (profil prywatny i domenowy),
   - tworzy skróty na pulpicie i w menu Start.
4. Po zakończeniu program uruchamia się automatycznie.

### Pierwsze uruchomienie

1. Program tworzy pustą bazę danych i wykonuje migracje schematu.
2. Zaloguj się kontem `admin`.
3. System wymusi zmianę hasła — ustaw silne hasło administratora.
4. Przejdź do *Administracja → Ustawienia* i uzupełnij:
   - **dane firmy** (trafiają na wydruki dokumentów),
   - **przeliczniki jednostek**, jeśli inne niż domyślne,
   - **stawki**: transport zł/km, rąbanie zł/jednostkę.
5. *Administracja → Magazyny* — sprawdź lub uzupełnij listę magazynów.
6. *Administracja → Produkty* i *Kontrahenci* — wprowadź dane firmy.
7. *Administracja → Użytkownicy* — załóż konta pracownikom i przypisz magazyny.

> Jeśli instalowano wersję z danymi przykładowymi, przed rozpoczęciem pracy
> produkcyjnej usuń konta demonstracyjne i przykładowych kontrahentów.

---

## 4. Praca wielostanowiskowa

### Udostępnienie adresu

Na stanowisku serwerowym: menu **Narzędzia → Adres dla innych stanowisk**.
Program pokaże i skopiuje do schowka adres, np. `http://192.168.1.10:4000`.

Pozostali pracownicy wpisują ten adres w przeglądarce (Chrome, Edge, Firefox)
i logują się własnymi kontami. Działa również na telefonie w sieci Wi-Fi firmy.

### Stały adres IP

Adres serwera nie może się zmieniać. Ustaw rezerwację adresu na routerze
(po adresie MAC) albo stały adres w systemie:

*Panel sterowania → Sieć → Zmień ustawienia karty sieciowej →
Właściwości → Protokół IPv4 → Użyj następującego adresu IP*

### Ręczna reguła zapory

Jeśli instalator nie dodał reguły (brak uprawnień), wykonaj w PowerShell
jako administrator:

```powershell
New-NetFirewallRule -DisplayName "ResInvest ERP" -Direction Inbound `
  -Protocol TCP -LocalPort 4000 -Action Allow -Profile Private,Domain
```

### Zmiana portu

Ustaw zmienną środowiskową systemową `RESINVEST_PORT` i dodaj regułę zapory
dla nowego portu. Zmienna `RESINVEST_DATA_DIR` zmienia katalog danych.

---

## 5. Kopie zapasowe

### Automatyczne

Co 12 godzin w `C:\ProgramData\ResInvestERP\backups`. Przechowywane jest
ostatnich 30 plików. Kopia wykonywana jest mechanizmem `VACUUM INTO` SQLite —
spójny obraz bazy **bez przerywania pracy użytkowników**.

### Na żądanie

*Administracja → Ustawienia → Kopie zapasowe → Utwórz kopię zapasową*

### Kopia poza komputerem

Kopie lokalne nie chronią przed awarią dysku, kradzieżą ani zalaniem.
Skonfiguruj codzienne kopiowanie katalogu `backups` na dysk sieciowy,
zewnętrzny lub do chmury. Przykładowe zadanie (Harmonogram zadań Windows,
codziennie po godzinach pracy):

```powershell
robocopy "C:\ProgramData\ResInvestERP\backups" "\\serwer-nas\kopie\resinvest" /MIR /R:2 /W:5
```

### Odtworzenie bazy

1. Zamknij program na stanowisku serwerowym.
2. Zmień nazwę obecnej bazy (zachowaj ją na wypadek pomyłki):
   ```powershell
   cd C:\ProgramData\ResInvestERP
   Rename-Item resinvest.sqlite resinvest-przed-odtworzeniem.sqlite
   Remove-Item resinvest.sqlite-wal, resinvest.sqlite-shm -ErrorAction SilentlyContinue
   ```
3. Skopiuj wybraną kopię pod nazwą `resinvest.sqlite`:
   ```powershell
   Copy-Item .\backups\resinvest-auto-2026-09-16T06-00-00-000Z.sqlite resinvest.sqlite
   ```
4. Uruchom program i sprawdź stany magazynowe oraz ostatnie dokumenty.

---

## 6. Aktualizacja

1. Wykonaj kopię zapasową (*Ustawienia → Kopie zapasowe*).
2. Zamknij program na stanowisku serwerowym.
3. Uruchom nowy instalator — zainstaluje się na poprzedniej wersji.
4. Uruchom program. Nowe migracje schematu wykonają się automatycznie
   przy starcie, z zachowaniem danych.
5. Sprawdź *Pomoc → O programie* — numer wersji powinien być nowy.

Katalog `C:\ProgramData\ResInvestERP` **nie jest naruszany** podczas aktualizacji.

---

## 7. Deinstalacja

*Panel sterowania → Programy → ResInvest ERP → Odinstaluj*

Deinstalator usuwa program i regułę zapory. **Dane pozostają** w
`C:\ProgramData\ResInvestERP` — usuń ten katalog ręcznie dopiero wtedy,
gdy masz pewność, że dane nie będą potrzebne.

---

## 8. Diagnostyka

| Objaw | Przyczyna | Rozwiązanie |
|---|---|---|
| „Serwer nie odpowiedział w wyznaczonym czasie” | Port 4000 zajęty przez inny program | Sprawdź `netstat -ano \| findstr :4000`; zmień `RESINVEST_PORT` lub zatrzymaj kolidujący program |
| Inne stanowiska nie łączą się | Brak reguły zapory lub zmieniony adres IP | Sprawdź regułę (sekcja 4); sprawdź `ipconfig` na serwerze |
| Program nie startuje | Uszkodzona instalacja lub brak uprawnień do katalogu danych | Zajrzyj do `C:\ProgramData\ResInvestERP\resinvest-erp.log`; zainstaluj ponownie |
| Wolne działanie przy dużej liczbie dokumentów | Rozrost pliku dziennika WAL | Zamknij i uruchom program — przy zamknięciu wykonywany jest checkpoint |
| Błąd zapisu | Brak miejsca na dysku | Zwolnij miejsce; sprawdź rozmiar katalogu `attachments` |

**Dziennik zdarzeń:** menu *Narzędzia → Dziennik zdarzeń* lub plik
`C:\ProgramData\ResInvestERP\resinvest-erp.log`.

**Kontrola spójności danych:** zalogowany administrator, adres
`http://localhost:4000/api/stock/integrity` — odpowiedź `{"consistent": true,
"mismatches": []}` oznacza, że salda zgadzają się z księgą ruchów.

---

## 9. Alternatywa: uruchomienie jako usługa

Jeśli serwer ma działać bez zalogowanego użytkownika (np. na Windows Server),
zamiast powłoki desktopowej uruchom sam serwer jako usługę:

```powershell
# Jednorazowo: build i przygotowanie katalogu
npm install
npm run build
npm run db:migrate

# Rejestracja usługi (przykład z NSSM)
nssm install ResInvestERP "C:\Program Files\nodejs\node.exe" `
  "C:\resinvest-erp\server\dist\index.js"
nssm set ResInvestERP AppDirectory "C:\resinvest-erp"
nssm set ResInvestERP AppEnvironmentExtra `
  NODE_ENV=production `
  PORT=4000 `
  HOST=0.0.0.0 `
  DATA_DIR=C:\ProgramData\ResInvestERP `
  SERVE_CLIENT=true `
  CLIENT_DIST=C:\resinvest-erp\client\dist
nssm start ResInvestERP
```

Sekrety `JWT_SECRET` i `REFRESH_SECRET` zostaną wygenerowane i utrwalone
w katalogu danych przy pierwszym starcie. Można je też podać jawnie w
`AppEnvironmentExtra`.

---

## 10. Odbiór instalatora

Lista kontrolna przed przekazaniem instalatora użytkownikom.
**Każdą pozycję należy sprawdzić na maszynie Windows** — poniższe punkty
nie są zweryfikowane w środowisku, w którym powstał kod.

- [ ] `npm run verify` kończy się powodzeniem (typecheck, lint, 84 testy, build)
- [ ] `npm run dist` tworzy jeden plik `.exe`
- [ ] Zapisano sumę SHA-256 pliku instalatora
- [ ] Instalacja na czystym systemie Windows kończy się powodzeniem
- [ ] Program uruchamia się i wyświetla ekran logowania
- [ ] Logowanie kontem `admin` działa, wymuszenie zmiany hasła działa
- [ ] Utworzenie i zatwierdzenie dokumentu PZ zmienia stan magazynowy
- [ ] Produkcja zdejmuje surowiec i dodaje wyrób
- [ ] Wydruk dokumentu otwiera poprawny arkusz A4
- [ ] Dodanie skanu i jego pobranie działa
- [ ] Drugie stanowisko łączy się przez przeglądarkę i widzi te same dane
- [ ] Reguła zapory istnieje (`Get-NetFirewallRule -DisplayName "ResInvest ERP"`)
- [ ] Kopia zapasowa tworzy się w katalogu `backups`
- [ ] Zamknięcie programu nie pozostawia procesu w tle (Menedżer zadań)
- [ ] Ponowne uruchomienie zachowuje wprowadzone dane
- [ ] Deinstalacja usuwa program i **zachowuje** katalog danych
- [ ] Wersja w *Pomoc → O programie* zgadza się z numerem wydania
