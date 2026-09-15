// =====================================================================
//  ResInvest ERP — kreator instalacji
//
//  Jeden plik wykonywalny, który niesie w sobie cały system. Nic nie
//  pobiera z sieci. Instaluje do katalogu użytkownika, więc nie pyta
//  o uprawnienia administratora i nie wywołuje okna UAC.
//
//  Tryby uruchomienia:
//    (bez argumentów)  kreator instalacji
//    /odinstaluj       usuwanie (kopia kreatora leży w katalogu programu)
//    /samokontrola     sprawdzenie ładunku i konfiguracji bez GUI
//
//  ┌── Podział na klasy nie jest kosmetyczny ────────────────────────┐
//  │ Logika (Ladunek, Konfiguracja, Instalator, Odinstalowanie) nie  │
//  │ dotyka WinForms. Dzięki temu `/samokontrola` sprawdza ją na     │
//  │ maszynie budującej, bez pulpitu — a to jedyna część, którą da   │
//  │ się sprawdzić automatycznie przed wydaniem.                     │
//  └─────────────────────────────────────────────────────────────────┘
// =====================================================================
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using Microsoft.Win32;

static class Program
{
    public const string WERSJA = "0.0.0";          // podstawiane przy budowaniu
    public const string PRODUKT = "ResInvest ERP";
    public const string KLUCZ_REJESTRU = "ResInvestERP";
    public const int WYMAGANY_NODE = 22;

    [STAThread]
    static int Main(string[] args)
    {
        string tryb = args.Length > 0 ? args[0].ToLowerInvariant() : "";

        if (tryb == "/samokontrola" || tryb == "--samokontrola")
            return Samokontrola.Uruchom();

        if (tryb == "/rozpakuj" || tryb == "--rozpakuj")
            return Rozpakowanie(args);

        if (tryb == "/odinstaluj" || tryb == "--odinstaluj")
            return UruchomGuiOdinstalowania();

        return UruchomGuiInstalacji();
    }

    /// <summary>
    /// `/rozpakuj &lt;katalog&gt;` — wypakowanie zawartości bez instalowania.
    ///
    /// Dla informatyka, który wdraża system na serwerze firmy albo chce
    /// zajrzeć do środka przed uruchomieniem czegokolwiek. Nie tworzy
    /// `.env`, nie dotyka rejestru i nie zakłada skrótów — sam zawartość.
    /// Tym samym trybem sprawdzamy przy wydaniu, że rozpakowany system
    /// naprawdę się uruchamia.
    /// </summary>
    static int Rozpakowanie(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("Użycie: ResInvest-ERP-Setup.exe /rozpakuj <katalog>");
            return 2;
        }
        try
        {
            string katalog = Path.GetFullPath(args[1]);
            Directory.CreateDirectory(katalog);
            Ladunek l = Ladunek.ZZasobu();
            l.RozpakujDo(katalog, null);
            Console.WriteLine("Rozpakowano " + l.Wpisy.Count + " plików do: " + katalog);
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("Nie udało się rozpakować: " + ex.Message);
            return 1;
        }
    }

    // Osobne metody, żeby typy WinForms rozwiązywały się dopiero przy wejściu
    // w tryb graficzny. `/samokontrola` ma działać tam, gdzie pulpitu nie ma.
    static int UruchomGuiInstalacji()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        var okno = new OknoKreatora();
        Application.Run(okno);
        return okno.KodWyjscia;
    }

    static int UruchomGuiOdinstalowania()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        var okno = new OknoOdinstalowania();
        Application.Run(okno);
        return okno.KodWyjscia;
    }
}

// =====================================================================
//  Ładunek — kontener RIEP1 osadzony w pliku wykonywalnym
// =====================================================================

/// <summary>Jeden plik w ładunku.</summary>
sealed class WpisLadunku
{
    public string Sciezka;      // ścieżka po instalacji, separator "/"
    public long Przesuniecie;   // pozycja w bloku danych
    public int Spakowane;       // długość strumienia deflate
    public int Rozpakowane;     // długość pliku (do kontroli)
}

/// <summary>
/// Odczyt kontenera `RIEP1`:
///   "RIEP1" | długość indeksu (uint32 LE) | indeks JSON | sklejone deflate
///
/// Format czyta tylko ta klasa. Zapisuje go `desktop/setup/build-setup.mjs`.
/// </summary>
sealed class Ladunek
{
    readonly byte[] _dane;
    readonly long _poczatekDanych;
    public readonly List<WpisLadunku> Wpisy = new List<WpisLadunku>();

    public Ladunek(byte[] surowe)
    {
        _dane = surowe;
        if (_dane.Length < 9 || Encoding.ASCII.GetString(_dane, 0, 5) != "RIEP1")
            throw new InvalidDataException("Ładunek instalatora jest uszkodzony (zły nagłówek).");

        int dlugoscIndeksu = BitConverter.ToInt32(_dane, 5);
        if (dlugoscIndeksu <= 0 || 9 + dlugoscIndeksu > _dane.Length)
            throw new InvalidDataException("Ładunek instalatora jest uszkodzony (zły indeks).");

        string json = Encoding.UTF8.GetString(_dane, 9, dlugoscIndeksu);
        _poczatekDanych = 9 + dlugoscIndeksu;
        Wpisy = ParsujIndeks(json);
    }

    /// <summary>Ładunek z zasobu osadzonego w tym pliku wykonywalnym.</summary>
    public static Ladunek ZZasobu()
    {
        var asm = Assembly.GetExecutingAssembly();
        using (var s = asm.GetManifestResourceStream("ladunek.bin"))
        {
            if (s == null)
                throw new InvalidDataException("Plik instalatora nie zawiera ładunku — pobierz go ponownie.");
            var bufor = new byte[s.Length];
            int wczytane = 0;
            while (wczytane < bufor.Length)
            {
                int n = s.Read(bufor, wczytane, bufor.Length - wczytane);
                if (n <= 0) break;
                wczytane += n;
            }
            return new Ladunek(bufor);
        }
    }

    /// <summary>
    /// Parser indeksu. Własny, bo format jest znany i płaski — a każdy
    /// zewnętrzny serializator to kolejny zestaw, który musiałby być
    /// na komputerze firmy.
    /// </summary>
    static List<WpisLadunku> ParsujIndeks(string json)
    {
        var lista = new List<WpisLadunku>();
        foreach (Match m in Regex.Matches(
            json,
            "\\{\\s*\"p\"\\s*:\\s*\"(?<p>(?:[^\"\\\\]|\\\\.)*)\"\\s*,\\s*\"o\"\\s*:\\s*(?<o>\\d+)\\s*,\\s*\"c\"\\s*:\\s*(?<c>\\d+)\\s*,\\s*\"u\"\\s*:\\s*(?<u>\\d+)\\s*\\}"))
        {
            lista.Add(new WpisLadunku
            {
                Sciezka = Regex.Unescape(m.Groups["p"].Value),
                Przesuniecie = long.Parse(m.Groups["o"].Value, CultureInfo.InvariantCulture),
                Spakowane = int.Parse(m.Groups["c"].Value, CultureInfo.InvariantCulture),
                Rozpakowane = int.Parse(m.Groups["u"].Value, CultureInfo.InvariantCulture),
            });
        }
        if (lista.Count == 0)
            throw new InvalidDataException("Ładunek instalatora jest pusty.");
        return lista;
    }

    /// <summary>Rozpakowuje jeden wpis do tablicy bajtów, kontrolując długość.</summary>
    public byte[] Odczytaj(WpisLadunku w)
    {
        var wynik = new byte[w.Rozpakowane];
        using (var zrodlo = new MemoryStream(_dane, (int)(_poczatekDanych + w.Przesuniecie), w.Spakowane, false))
        using (var deflate = new DeflateStream(zrodlo, CompressionMode.Decompress))
        {
            int wczytane = 0;
            while (wczytane < wynik.Length)
            {
                int n = deflate.Read(wynik, wczytane, wynik.Length - wczytane);
                if (n <= 0) break;
                wczytane += n;
            }
            if (wczytane != w.Rozpakowane)
                throw new InvalidDataException("Plik „" + w.Sciezka + "” rozpakował się niekompletnie.");
        }
        return wynik;
    }

    /// <summary>Łączna objętość po rozpakowaniu — do oszacowania miejsca na dysku.</summary>
    public long RozmiarPoRozpakowaniu()
    {
        long suma = 0;
        foreach (var w in Wpisy) suma += w.Rozpakowane;
        return suma;
    }

    /// <summary>Rozpakowuje całość do katalogu. `postep` dostaje (zrobione, wszystkie, nazwa).</summary>
    public void RozpakujDo(string katalog, Action<int, int, string> postep)
    {
        int i = 0;
        foreach (var w in Wpisy)
        {
            string cel = Path.Combine(katalog, w.Sciezka.Replace('/', Path.DirectorySeparatorChar));
            string nadrzedny = Path.GetDirectoryName(cel);
            if (!string.IsNullOrEmpty(nadrzedny)) Directory.CreateDirectory(nadrzedny);
            File.WriteAllBytes(cel, Odczytaj(w));
            i++;
            if (postep != null) postep(i, Wpisy.Count, w.Sciezka);
        }
    }
}

// =====================================================================
//  Konfiguracja pierwszego uruchomienia
// =====================================================================

/// <summary>Dane, które użytkownik musi zobaczyć po instalacji.</summary>
sealed class DaneLogowania
{
    public string Login;
    public string Haslo;
    public bool Nowa;          // false = .env już istniał, hasła nie zmieniano
}

static class Konfiguracja
{
    /// <summary>
    /// Losowy ciąg base64url z generatora kryptograficznego.
    /// `Random` tu nie wystarcza — z tego bierze się klucz podpisu sesji.
    /// </summary>
    public static string LosowyKlucz(int bajtow)
    {
        var bufor = new byte[bajtow];
        using (var rng = new RNGCryptoServiceProvider()) rng.GetBytes(bufor);
        return Convert.ToBase64String(bufor)
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');
    }

    /// <summary>
    /// Hasło pierwszego logowania: czytelne przez telefon, a mimo to losowe.
    /// Układ `Res-XXXXXXXX-2026A` spełnia regułę systemu (10+ znaków, wielka
    /// i mała litera, cyfra) i da się je podyktować bez pomyłki.
    /// </summary>
    public static string LosoweHaslo()
    {
        var bufor = new byte[4];
        using (var rng = new RNGCryptoServiceProvider()) rng.GetBytes(bufor);
        var sb = new StringBuilder("Res-");
        foreach (byte b in bufor) sb.Append(b.ToString("x2", CultureInfo.InvariantCulture));
        sb.Append("-2026A");
        return sb.ToString();
    }

    /// <summary>Reguła haseł systemu — powielona tu świadomie, patrz niżej.</summary>
    /// <remarks>
    /// Serwer sprawdza to ponownie przy pierwszym logowaniu (`passwordIssues`).
    /// Ta kopia istnieje po to, żeby instalator nie wygenerował hasła, które
    /// serwer zaraz odrzuci — użytkownik zostałby wtedy z kontem, do którego
    /// nie da się wejść, i bez żadnej wskazówki dlaczego.
    /// </remarks>
    public static bool HasloSpelniaReguly(string haslo)
    {
        if (string.IsNullOrEmpty(haslo) || haslo.Length < 10) return false;
        bool wielka = false, mala = false, cyfra = false;
        foreach (char c in haslo)
        {
            if (char.IsUpper(c)) wielka = true;
            else if (char.IsLower(c)) mala = true;
            else if (char.IsDigit(c)) cyfra = true;
        }
        return wielka && mala && cyfra;
    }

    /// <summary>
    /// Tworzy `.env` na podstawie `.env.example`, wstawiając klucz podpisu
    /// i hasło pierwszego logowania. Istniejącego pliku NIE rusza — przy
    /// aktualizacji nadpisanie klucza wylogowałoby wszystkich i, co gorsza,
    /// podmieniło hasło administratora bez uprzedzenia.
    /// </summary>
    public static DaneLogowania PrzygotujEnv(string katalog)
    {
        string env = Path.Combine(katalog, ".env");
        string wzor = Path.Combine(katalog, ".env.example");

        if (File.Exists(env))
            return new DaneLogowania { Login = OdczytajLogin(env), Haslo = null, Nowa = false };

        if (!File.Exists(wzor))
            throw new FileNotFoundException("Brak wzorca konfiguracji .env.example");

        string haslo = LosoweHaslo();
        if (!HasloSpelniaReguly(haslo))
            throw new InvalidOperationException("Wygenerowane hasło nie spełnia reguł systemu.");

        string tresc = File.ReadAllText(wzor, new UTF8Encoding(false));
        tresc = PodmienLinie(tresc, "AUTH_SECRET", LosowyKlucz(48));
        tresc = PodmienLinie(tresc, "BOOTSTRAP_ADMIN_PASSWORD", haslo);
        tresc = PodmienLinie(tresc, "NODE_ENV", "production");
        File.WriteAllText(env, tresc, new UTF8Encoding(false));

        return new DaneLogowania { Login = OdczytajLogin(env), Haslo = haslo, Nowa = true };
    }

    /// <summary>Podmienia wartość klucza w pliku .env; dopisuje, gdy klucza nie ma.</summary>
    public static string PodmienLinie(string tresc, string klucz, string wartosc)
    {
        var wzorzec = new Regex("^" + Regex.Escape(klucz) + "=.*$", RegexOptions.Multiline);
        string nowa = klucz + "=" + wartosc;
        if (wzorzec.IsMatch(tresc)) return wzorzec.Replace(tresc, nowa.Replace("$", "$$"), 1);
        return tresc.TrimEnd('\r', '\n') + Environment.NewLine + nowa + Environment.NewLine;
    }

    static string OdczytajLogin(string env)
    {
        foreach (string linia in File.ReadAllLines(env))
        {
            var m = Regex.Match(linia.Trim(), "^BOOTSTRAP_ADMIN_EMAIL=(.+)$");
            if (m.Success) return m.Groups[1].Value.Trim();
        }
        return "admin@resinvest.local";
    }

    /// <summary>
    /// Zapisuje dane logowania obok programu. Hasło pokazuje się raz, na
    /// ostatnim ekranie — a ten ekran ktoś zamknie odruchowo.
    /// </summary>
    public static string ZapiszDaneLogowania(string katalog, DaneLogowania dane)
    {
        string plik = Path.Combine(katalog, "DANE-PIERWSZEGO-LOGOWANIA.txt");
        var sb = new StringBuilder();
        sb.AppendLine("ResInvest ERP — dane pierwszego logowania");
        sb.AppendLine("=========================================");
        sb.AppendLine();
        sb.AppendLine("Adres      : http://localhost:4173");
        sb.AppendLine("Login      : " + dane.Login);
        sb.AppendLine("Hasło      : " + dane.Haslo);
        sb.AppendLine();
        sb.AppendLine("System poprosi o zmianę hasła przy pierwszym logowaniu.");
        sb.AppendLine("Po zmianie ten plik można skasować.");
        sb.AppendLine();
        sb.AppendLine("Instalacja : " + katalog);
        sb.AppendLine("Data       : " + DateTime.Now.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture));
        File.WriteAllText(plik, sb.ToString(), new UTF8Encoding(true));
        return plik;
    }
}

// =====================================================================
//  Środowisko — wykrycie Node.js
// =====================================================================

sealed class StanNode
{
    public bool Jest;
    public int Glowna;             // wersja główna, 0 gdy nie wykryto
    public string Opis;            // np. "v22.11.0"
    public bool Wystarczajacy { get { return Jest && Glowna >= Program.WYMAGANY_NODE; } }
}

static class Srodowisko
{
    /// <summary>
    /// Pyta `node` o własną wersję. Świadomie uruchamiamy program, a nie
    /// czytamy rejestru czy PATH-u: liczy się to, co naprawdę odpowie na
    /// wywołanie, bo tak samo uruchomi go potem launcher.
    /// </summary>
    public static StanNode SprawdzNode()
    {
        var stan = new StanNode { Jest = false, Glowna = 0, Opis = "nie znaleziono" };
        try
        {
            var psi = new ProcessStartInfo("node", "-p \"process.versions.node\"")
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            using (var p = Process.Start(psi))
            {
                string wyjscie = p.StandardOutput.ReadToEnd().Trim();
                p.WaitForExit(10000);
                if (p.ExitCode != 0 || wyjscie.Length == 0) return stan;

                stan.Jest = true;
                stan.Opis = "v" + wyjscie;
                string glowna = wyjscie.Split('.')[0];
                int n;
                if (int.TryParse(glowna, NumberStyles.Integer, CultureInfo.InvariantCulture, out n))
                    stan.Glowna = n;
            }
        }
        catch { /* brak node w PATH — stan zostaje „nie znaleziono” */ }
        return stan;
    }

    /// <summary>Uruchamia skrypt Node w katalogu programu i czeka na wynik.</summary>
    public static bool UruchomSkrypt(string katalog, string skrypt, out string wyjscie)
    {
        var psi = new ProcessStartInfo("node",
            "--disable-warning=ExperimentalWarning \"" + skrypt + "\"")
        {
            WorkingDirectory = katalog,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        try
        {
            using (var p = Process.Start(psi))
            {
                string se = p.StandardOutput.ReadToEnd();
                string be = p.StandardError.ReadToEnd();
                p.WaitForExit(10 * 60 * 1000);
                wyjscie = (se + be).Trim();
                return p.ExitCode == 0;
            }
        }
        catch (Exception ex)
        {
            wyjscie = ex.Message;
            return false;
        }
    }
}

// =====================================================================
//  Skróty i wpis w „Aplikacje i funkcje”
// =====================================================================

static class Skroty
{
    /// <summary>
    /// Tworzy skrót `.lnk` przez `WScript.Shell`. Wiązanie późne (ProgID +
    /// InvokeMember), bo referencja do biblioteki typów COM zmusiłaby do
    /// budowania instalatora wyłącznie na Windows — a budujemy go też
    /// na Linuksie, kompilatorem Mono.
    /// </summary>
    public static bool Utworz(string plikLnk, string cel, string katalogRoboczy, string ikona, string opis)
    {
        try
        {
            Type t = Type.GetTypeFromProgID("WScript.Shell");
            if (t == null) return false;
            object shell = Activator.CreateInstance(t);
            object lnk = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell,
                new object[] { plikLnk });
            Type tl = lnk.GetType();
            tl.InvokeMember("TargetPath", BindingFlags.SetProperty, null, lnk, new object[] { cel });
            tl.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, lnk, new object[] { katalogRoboczy });
            if (!string.IsNullOrEmpty(ikona))
                tl.InvokeMember("IconLocation", BindingFlags.SetProperty, null, lnk, new object[] { ikona });
            tl.InvokeMember("Description", BindingFlags.SetProperty, null, lnk, new object[] { opis });
            tl.InvokeMember("Save", BindingFlags.InvokeMethod, null, lnk, null);
            return File.Exists(plikLnk);
        }
        catch { return false; }
    }

    public static string Pulpit { get { return Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory); } }
    public static string MenuStart { get { return Environment.GetFolderPath(Environment.SpecialFolder.Programs); } }
    public static string Autostart { get { return Environment.GetFolderPath(Environment.SpecialFolder.Startup); } }
}

static class Rejestr
{
    const string GALAZ = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\";

    /// <summary>
    /// Wpis w „Aplikacje i funkcje”. HKCU, nie HKLM — instalacja jest
    /// dla jednego użytkownika i nie wymaga administratora.
    /// </summary>
    public static void Zapisz(string katalog, long rozmiarKb)
    {
        try
        {
            using (var k = Registry.CurrentUser.CreateSubKey(GALAZ + Program.KLUCZ_REJESTRU))
            {
                if (k == null) return;
                string odinstaluj = Path.Combine(katalog, "Odinstaluj.exe");
                k.SetValue("DisplayName", Program.PRODUKT + " — Magazyn Biomasy");
                k.SetValue("DisplayVersion", Program.WERSJA);
                k.SetValue("Publisher", "ResInvest Commodities PL");
                k.SetValue("InstallLocation", katalog);
                k.SetValue("UninstallString", "\"" + odinstaluj + "\" /odinstaluj");
                k.SetValue("DisplayIcon", Path.Combine(katalog, "ResInvestERP.exe"));
                k.SetValue("EstimatedSize", (int)rozmiarKb, RegistryValueKind.DWord);
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                k.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd", CultureInfo.InvariantCulture));
            }
        }
        catch { /* brak wpisu nie psuje instalacji */ }
    }

    public static void Usun()
    {
        try { Registry.CurrentUser.DeleteSubKeyTree(GALAZ + Program.KLUCZ_REJESTRU, false); }
        catch { }
    }

    /// <summary>Katalog poprzedniej instalacji albo null.</summary>
    public static string PoprzedniKatalog()
    {
        try
        {
            using (var k = Registry.CurrentUser.OpenSubKey(GALAZ + Program.KLUCZ_REJESTRU))
            {
                if (k == null) return null;
                return k.GetValue("InstallLocation") as string;
            }
        }
        catch { return null; }
    }
}

// =====================================================================
//  Instalator — logika bez GUI
// =====================================================================

sealed class OpcjeInstalacji
{
    public string Katalog;
    public bool DaneDemonstracyjne;
    public bool SkrotNaPulpicie = true;
    public bool WMenuStart = true;
    public bool Autostart;
    public bool TylkoJednoplikowa;   // komputer bez Node.js
}

sealed class WynikInstalacji
{
    public bool Powodzenie;
    public string Blad;
    public DaneLogowania Logowanie;
    public string PlikZDanymi;
    public string CoUruchomic;       // pełna ścieżka do pliku startowego
}

sealed class Instalator
{
    readonly Ladunek _ladunek;
    readonly Action<string, int> _postep;   // (komunikat, procent 0-100)

    public Instalator(Ladunek ladunek, Action<string, int> postep)
    {
        _ladunek = ladunek;
        _postep = postep;
    }

    void Krok(string tekst, int procent)
    {
        if (_postep != null) _postep(tekst, procent);
    }

    public WynikInstalacji Wykonaj(OpcjeInstalacji opcje)
    {
        var wynik = new WynikInstalacji();
        try
        {
            Directory.CreateDirectory(opcje.Katalog);

            // --- Wariant bez Node.js: tylko wersja jednoplikowa ---
            if (opcje.TylkoJednoplikowa)
            {
                Krok("Zapisywanie wersji jednoplikowej…", 30);
                WpisJednoplikowej(opcje.Katalog);
                Krok("Tworzenie skrótów…", 80);
                string html = Path.Combine(opcje.Katalog, "ResInvestERP.html");
                ZrobSkroty(opcje, html, null);
                Rejestr.Zapisz(opcje.Katalog, new FileInfo(html).Length / 1024);
                SkopiujOdinstalowanie(opcje.Katalog);
                Krok("Gotowe.", 100);
                wynik.Powodzenie = true;
                wynik.CoUruchomic = html;
                return wynik;
            }

            // --- Instalacja pełna ---
            Krok("Rozpakowywanie plików…", 5);
            _ladunek.RozpakujDo(opcje.Katalog, (zrobione, wszystkie, nazwa) =>
            {
                int procent = 5 + (int)(45.0 * zrobione / wszystkie);
                Krok("Rozpakowywanie: " + nazwa, procent);
            });

            foreach (string pod in new[] { "data", "data/backups", "data/attachments", "data/logs" })
                Directory.CreateDirectory(Path.Combine(opcje.Katalog, pod.Replace('/', Path.DirectorySeparatorChar)));

            Krok("Przygotowywanie konfiguracji…", 55);
            wynik.Logowanie = Konfiguracja.PrzygotujEnv(opcje.Katalog);

            Krok("Przygotowywanie bazy danych…", 62);
            string wyjscie;
            if (!Srodowisko.UruchomSkrypt(opcje.Katalog,
                    Path.Combine("server", "scripts", "migrate.mjs"), out wyjscie))
            {
                wynik.Blad = "Nie udało się przygotować bazy danych.\r\n\r\n" + Skroc(wyjscie);
                return wynik;
            }

            if (opcje.DaneDemonstracyjne)
            {
                Krok("Generowanie danych demonstracyjnych…", 72);
                string wy2;
                // Niepowodzenie danych demonstracyjnych nie przerywa instalacji —
                // system jest sprawny, brakuje tylko przykładów do obejrzenia.
                Srodowisko.UruchomSkrypt(opcje.Katalog,
                    Path.Combine("server", "scripts", "seed.mjs"), out wy2);
            }

            Krok("Tworzenie skrótów…", 85);
            string exe = Path.Combine(opcje.Katalog, "ResInvestERP.exe");
            string cel = File.Exists(exe) ? exe : Path.Combine(opcje.Katalog, "START.bat");
            ZrobSkroty(opcje, cel, File.Exists(exe) ? exe : null);

            Krok("Kończenie…", 93);
            if (wynik.Logowanie != null && wynik.Logowanie.Nowa)
                wynik.PlikZDanymi = Konfiguracja.ZapiszDaneLogowania(opcje.Katalog, wynik.Logowanie);

            Rejestr.Zapisz(opcje.Katalog, _ladunek.RozmiarPoRozpakowaniu() / 1024);
            SkopiujOdinstalowanie(opcje.Katalog);

            Krok("Gotowe.", 100);
            wynik.Powodzenie = true;
            wynik.CoUruchomic = cel;
            return wynik;
        }
        catch (Exception ex)
        {
            wynik.Blad = ex.Message;
            return wynik;
        }
    }

    /// <summary>Wypakowuje sam plik jednoplikowy (wariant bez Node.js).</summary>
    void WpisJednoplikowej(string katalog)
    {
        foreach (var w in _ladunek.Wpisy)
        {
            if (w.Sciezka == "ResInvestERP.html" || w.Sciezka == "LICENSE" || w.Sciezka == "README.md")
                File.WriteAllBytes(Path.Combine(katalog, w.Sciezka), _ladunek.Odczytaj(w));
        }
    }

    void ZrobSkroty(OpcjeInstalacji opcje, string cel, string ikona)
    {
        string opis = Program.PRODUKT + " — Magazyn Biomasy";
        if (opcje.SkrotNaPulpicie && Directory.Exists(Skroty.Pulpit))
            Skroty.Utworz(Path.Combine(Skroty.Pulpit, Program.PRODUKT + ".lnk"),
                cel, opcje.Katalog, ikona, opis);

        if (opcje.WMenuStart && Directory.Exists(Skroty.MenuStart))
            Skroty.Utworz(Path.Combine(Skroty.MenuStart, Program.PRODUKT + ".lnk"),
                cel, opcje.Katalog, ikona, opis);

        string autostart = Path.Combine(Skroty.Autostart, Program.PRODUKT + ".lnk");
        if (opcje.Autostart && Directory.Exists(Skroty.Autostart))
            Skroty.Utworz(autostart, cel, opcje.Katalog, ikona, opis);
        else if (File.Exists(autostart))
            try { File.Delete(autostart); } catch { }
    }

    /// <summary>
    /// Kopia kreatora zostaje w katalogu programu jako `Odinstaluj.exe`.
    /// Bez tego „Aplikacje i funkcje” miałyby wpis wskazujący na plik, który
    /// użytkownik dawno skasował z katalogu pobranych.
    /// </summary>
    static void SkopiujOdinstalowanie(string katalog)
    {
        try
        {
            string ja = Assembly.GetExecutingAssembly().Location;
            string cel = Path.Combine(katalog, "Odinstaluj.exe");
            if (!string.IsNullOrEmpty(ja) && File.Exists(ja)
                && !string.Equals(Path.GetFullPath(ja), Path.GetFullPath(cel), StringComparison.OrdinalIgnoreCase))
                File.Copy(ja, cel, true);
        }
        catch { }
    }

    static string Skroc(string tekst)
    {
        if (string.IsNullOrEmpty(tekst)) return "(brak szczegółów)";
        return tekst.Length <= 1200 ? tekst : tekst.Substring(0, 1200) + "…";
    }
}

// =====================================================================
//  Odinstalowanie
// =====================================================================

static class Odinstalowanie
{
    /// <summary>
    /// Usuwa program. `usunDane` domyślnie FAŁSZ i tak ma zostać:
    /// w `data\` leży księga magazynowa i dokumenty, których nie da się
    /// odtworzyć. Kasowanie ich „przy okazji” odinstalowania byłoby
    /// nieodwracalną stratą danych firmy.
    /// </summary>
    public static bool Wykonaj(string katalog, bool usunDane, out string komunikat)
    {
        var bledy = new List<string>();
        try
        {
            if (!Directory.Exists(katalog))
            {
                komunikat = "Katalog programu już nie istnieje.";
                Rejestr.Usun();
                UsunSkroty();
                return true;
            }

            foreach (string wpis in Directory.GetFileSystemEntries(katalog))
            {
                string nazwa = Path.GetFileName(wpis);

                if (!usunDane && string.Equals(nazwa, "data", StringComparison.OrdinalIgnoreCase)) continue;
                if (!usunDane && string.Equals(nazwa, ".env", StringComparison.OrdinalIgnoreCase)) continue;
                // Kopia kreatora kasuje samą siebie — patrz niżej.
                if (string.Equals(nazwa, "Odinstaluj.exe", StringComparison.OrdinalIgnoreCase)) continue;

                try
                {
                    if (Directory.Exists(wpis)) Directory.Delete(wpis, true);
                    else File.Delete(wpis);
                }
                catch (Exception ex) { bledy.Add(nazwa + ": " + ex.Message); }
            }

            UsunSkroty();
            Rejestr.Usun();
            ZaplanujUsuniecieSiebie(katalog, usunDane);

            komunikat = bledy.Count == 0
                ? (usunDane
                    ? "Program i dane zostały usunięte."
                    : "Program został usunięty. Dane magazynowe zostały zachowane w katalogu:\r\n" + Path.Combine(katalog, "data"))
                : "Program usunięto, ale kilku pozycji nie udało się skasować:\r\n" + string.Join("\r\n", bledy.ToArray());
            return true;
        }
        catch (Exception ex)
        {
            komunikat = "Nie udało się odinstalować: " + ex.Message;
            return false;
        }
    }

    static void UsunSkroty()
    {
        foreach (string katalog in new[] { Skroty.Pulpit, Skroty.MenuStart, Skroty.Autostart })
        {
            try
            {
                string lnk = Path.Combine(katalog, Program.PRODUKT + ".lnk");
                if (File.Exists(lnk)) File.Delete(lnk);
            }
            catch { }
        }
    }

    /// <summary>
    /// Działający plik `.exe` nie może skasować sam siebie, więc sprzątanie
    /// zleca się poleceniu `cmd`, które odczeka i usunie resztę po wyjściu.
    /// </summary>
    static void ZaplanujUsuniecieSiebie(string katalog, bool usunDane)
    {
        try
        {
            string exe = Path.Combine(katalog, "Odinstaluj.exe");
            string polecenie = usunDane
                ? "ping 127.0.0.1 -n 1 -w 2500 >nul & del /f /q \"" + exe + "\" & rd /s /q \"" + katalog + "\""
                : "ping 127.0.0.1 -n 1 -w 2500 >nul & del /f /q \"" + exe + "\"";
            var psi = new ProcessStartInfo("cmd.exe", "/c " + polecenie)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            Process.Start(psi);
        }
        catch { }
    }
}

// =====================================================================
//  Samokontrola — sprawdzenie logiki bez pulpitu
// =====================================================================

/// <summary>
/// Uruchamiana przy budowaniu (`/samokontrola`). Sprawdza wszystko, czego
/// nie widać po samej udanej kompilacji: czy ładunek się rozpakowuje w całości,
/// czy `.env` dostaje prawdziwy klucz i hasło zgodne z regułą systemu,
/// czy istniejąca konfiguracja nie zostaje nadpisana.
///
/// Nie sprawdza wyglądu okien — tego nie da się zrobić bez Windows.
/// </summary>
static class Samokontrola
{
    static int _bledy;

    static void Sprawdz(bool warunek, string opis)
    {
        Console.WriteLine((warunek ? "  [OK]   " : "  [BLAD] ") + opis);
        if (!warunek) _bledy++;
    }

    public static int Uruchom()
    {
        Console.WriteLine("Samokontrola instalatora ResInvest ERP " + Program.WERSJA);
        Console.WriteLine(new string('=', 62));

        string tmp = Path.Combine(Path.GetTempPath(), "riep-samokontrola-" + Guid.NewGuid().ToString("N"));
        try
        {
            // --- Ładunek ---
            Console.WriteLine("\n1. Ładunek osadzony w pliku wykonywalnym");
            Ladunek l = Ladunek.ZZasobu();
            Sprawdz(l.Wpisy.Count > 50, "indeks ma " + l.Wpisy.Count + " pozycji");

            var wymagane = new[] {
                "package.json", "LICENSE", ".env.example",
                "server/src/index.js", "server/src/app.js",
                "server/scripts/migrate.mjs", "server/scripts/seed.mjs",
                "web/index.html", "ResInvestERP.exe", "ResInvestERP.html",
                "server/src/db/migrations/004_audit_indexes.sql",
            };
            foreach (string potrzebny in wymagane)
            {
                bool jest = l.Wpisy.Exists(delegate (WpisLadunku w) { return w.Sciezka == potrzebny; });
                Sprawdz(jest, "w ładunku jest " + potrzebny);
            }

            // --- Rozpakowanie w całości ---
            Console.WriteLine("\n2. Rozpakowanie");
            Directory.CreateDirectory(tmp);
            int rozpakowanych = 0;
            l.RozpakujDo(tmp, delegate (int a, int b, string c) { rozpakowanych = a; });
            Sprawdz(rozpakowanych == l.Wpisy.Count,
                "rozpakowano " + rozpakowanych + " z " + l.Wpisy.Count + " plików");

            long naDysku = 0;
            bool zgodneDlugosci = true;
            foreach (var w in l.Wpisy)
            {
                var fi = new FileInfo(Path.Combine(tmp, w.Sciezka.Replace('/', Path.DirectorySeparatorChar)));
                if (!fi.Exists || fi.Length != w.Rozpakowane) zgodneDlugosci = false;
                if (fi.Exists) naDysku += fi.Length;
            }
            Sprawdz(zgodneDlugosci, "każdy plik ma długość zgodną z indeksem");
            Sprawdz(naDysku == l.RozmiarPoRozpakowaniu(),
                "łączna objętość zgadza się z zapowiedzianą (" + (naDysku / 1024 / 1024) + " MB)");

            // Plik tekstowy musi dać się odczytać jako poprawny UTF-8 z polskimi znakami.
            string pakiet = File.ReadAllText(Path.Combine(tmp, "package.json"), new UTF8Encoding(false));
            Sprawdz(pakiet.Contains("\"name\""), "package.json rozpakował się jako poprawny tekst");

            string html = Path.Combine(tmp, "ResInvestERP.html");
            Sprawdz(new FileInfo(html).Length > 1000000, "wersja jednoplikowa ma pełny rozmiar");
            Sprawdz(File.ReadAllText(html, new UTF8Encoding(false)).Contains("ResInvest"),
                "wersja jednoplikowa zawiera nazwę systemu");

            // --- Konfiguracja ---
            Console.WriteLine("\n3. Konfiguracja pierwszego uruchomienia");
            DaneLogowania dane = Konfiguracja.PrzygotujEnv(tmp);
            Sprawdz(dane.Nowa, "utworzono nowy plik .env");
            Sprawdz(Konfiguracja.HasloSpelniaReguly(dane.Haslo),
                "hasło „" + dane.Haslo + "” spełnia reguły systemu");

            string env = File.ReadAllText(Path.Combine(tmp, ".env"), new UTF8Encoding(false));
            var mSecret = Regex.Match(env, "^AUTH_SECRET=(.+)$", RegexOptions.Multiline);
            Sprawdz(mSecret.Success && mSecret.Groups[1].Value.Trim().Length >= 32,
                "AUTH_SECRET ma co najmniej 32 znaki (" +
                (mSecret.Success ? mSecret.Groups[1].Value.Trim().Length.ToString() : "0") + ")");
            Sprawdz(env.Contains("BOOTSTRAP_ADMIN_PASSWORD=" + dane.Haslo),
                "hasło trafiło do pliku .env");
            Sprawdz(Regex.IsMatch(env, "^NODE_ENV=production$", RegexOptions.Multiline),
                "tryb produkcyjny ustawiony");

            // Dwa wywołania muszą dać różne klucze — inaczej wszystkie instalacje
            // dzieliłyby jeden sekret podpisu sesji.
            Sprawdz(Konfiguracja.LosowyKlucz(48) != Konfiguracja.LosowyKlucz(48),
                "klucz jest losowy przy każdym wywołaniu");
            Sprawdz(Konfiguracja.LosoweHaslo() != Konfiguracja.LosoweHaslo(),
                "hasło jest losowe przy każdym wywołaniu");

            // --- Ponowna instalacja nie może nadpisać konfiguracji ---
            Console.WriteLine("\n4. Ponowna instalacja w tym samym katalogu");
            DaneLogowania drugie = Konfiguracja.PrzygotujEnv(tmp);
            Sprawdz(!drugie.Nowa, "istniejący .env został rozpoznany");
            Sprawdz(drugie.Haslo == null, "hasło nie zostało wygenerowane ponownie");
            string envPo = File.ReadAllText(Path.Combine(tmp, ".env"), new UTF8Encoding(false));
            Sprawdz(envPo == env, "zawartość .env nietknięta (klucz sesji zachowany)");

            // --- Reguła haseł ---
            Console.WriteLine("\n5. Reguła haseł");
            Sprawdz(!Konfiguracja.HasloSpelniaReguly("krotkie1A"), "odrzuca za krótkie");
            Sprawdz(!Konfiguracja.HasloSpelniaReguly("bezwielkich123"), "odrzuca bez wielkiej litery");
            Sprawdz(!Konfiguracja.HasloSpelniaReguly("BEZMALYCH123"), "odrzuca bez małej litery");
            Sprawdz(!Konfiguracja.HasloSpelniaReguly("BezCyfrLiter"), "odrzuca bez cyfry");
            Sprawdz(Konfiguracja.HasloSpelniaReguly("Res-a1b2c3d4-2026A"), "przyjmuje wzór instalatora");

            // --- Podmiana linii w .env ---
            Console.WriteLine("\n6. Podmiana wartości w .env");
            Sprawdz(Konfiguracja.PodmienLinie("A=1\nB=2\n", "B", "9") == "A=1\nB=9\n",
                "podmienia istniejący klucz");
            Sprawdz(Konfiguracja.PodmienLinie("A=1\n", "C", "3").Contains("C=3"),
                "dopisuje brakujący klucz");
            // Znak `$` w wartości nie może zostać wzięty za odwołanie do grupy.
            Sprawdz(Konfiguracja.PodmienLinie("K=1\n", "K", "a$1b").Contains("K=a$1b"),
                "wartość ze znakiem $ trafia dosłownie");
        }
        catch (Exception ex)
        {
            Console.WriteLine("  [WYJATEK] " + ex.GetType().Name + ": " + ex.Message);
            _bledy++;
        }
        finally
        {
            try { if (Directory.Exists(tmp)) Directory.Delete(tmp, true); } catch { }
        }

        Console.WriteLine("\n" + new string('=', 62));
        Console.WriteLine(_bledy == 0
            ? "SAMOKONTROLA ZALICZONA — ładunek i konfiguracja bez zastrzeżeń."
            : "SAMOKONTROLA NIEZALICZONA: " + _bledy + " błędów.");
        return _bledy == 0 ? 0 : 1;
    }
}
