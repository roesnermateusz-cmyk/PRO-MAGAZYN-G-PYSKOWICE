/*
 * ResInvestERP.exe — launcher aplikacji dla systemu Windows.
 *
 * PO CO OSOBNY PROGRAM, A NIE PLIK .BAT
 * Plik wsadowy zostawia na ekranie czarne okno konsoli, które użytkownik
 * odruchowo zamyka — i wyłącza tym serwer w środku pracy magazynu. Dodatkowo
 * nie da się mu nadać ikony, nie widać go w zasobniku i podwójne kliknięcie
 * uruchamia drugą kopię serwera. Ten launcher rozwiązuje wszystkie cztery
 * rzeczy naraz i wygląda dla użytkownika jak zwykły program.
 *
 * DLACZEGO KOMPILACJA PRZY INSTALACJI, A NIE GOTOWY PLIK W ARCHIWUM
 * Produkt jest wdrażany na miejscu, bez dostępu do internetu i bez uprawnień
 * administratora. Gotowy plik .exe w archiwum wymagałby podpisu cyfrowego
 * (inaczej SmartScreen go zablokuje) albo zaufania użytkownika do binariów
 * z pliku ZIP. Kompilator C# (`csc.exe`) jest częścią systemu Windows od
 * wersji 8 — leży w katalogu .NET Framework i nie wymaga niczego instalować.
 * Plik zbudowany na miejscu jest lokalny, więc nie dziedziczy blokady
 * „pobrane z internetu”.
 *
 * CO ROBI
 *  1. Czyta port z pliku `.env`.
 *  2. Sprawdza, czy system już działa — jeśli tak, tylko otwiera przeglądarkę.
 *  3. Uruchamia serwer Node jako proces potomny BEZ okna konsoli.
 *  4. Czeka, aż serwer odpowie na kontrolę stanu.
 *  5. Otwiera przeglądarkę i zostaje w zasobniku systemowym.
 *  6. Przy zamknięciu zatrzymuje serwer.
 *
 * Kod celowo trzyma się składni C# 5 — tyle rozumie kompilator wbudowany
 * w .NET Framework 4, na którym ten plik ma się zbudować bez dodatków.
 */
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace ResInvest
{
    static class Program
    {
        const string AppName = "ResInvest ERP";
        const int DefaultPort = 4173;

        static Process server;
        static NotifyIcon tray;
        static string baseUrl;
        static string appDir;
        static string logPath;
        static readonly object logLock = new object();

        [STAThread]
        static void Main(string[] args)
        {
            appDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            Directory.SetCurrentDirectory(appDir);

            int port = ReadPort();
            baseUrl = "http://localhost:" + port;
            logPath = Path.Combine(appDir, "data", "launcher.log");

            // Tryb diagnostyczny: `ResInvestERP.exe --sprawdz` wypisuje stan
            // środowiska bez uruchamiania czegokolwiek. Pierwsze pytanie przy
            // każdym zgłoszeniu z magazynu brzmi „czy w ogóle jest Node i czy
            // port jest wolny” — ta opcja odpowiada na nie bez zdalnego dostępu.
            //
            // Kontrola idzie PRZED inicjalizacją interfejsu graficznego: ma
            // działać także wtedy, gdy zawodzi właśnie warstwa graficzna albo
            // gdy ktoś uruchamia ją zdalnie, z powłoki bez pulpitu.
            if (args.Length > 0 && (args[0] == "--sprawdz" || args[0] == "/sprawdz"))
            {
                SelfCheck(port);
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // Druga instancja nie uruchamia drugiego serwera — otwiera okno
            // przeglądarki i kończy pracę. Bez tego podwójne kliknięcie ikony
            // dawałoby konflikt o port i mylący komunikat błędu.
            string state = ProbeServer(1500);
            if (state == "ok") { OpenBrowser(); return; }
            if (state == "obcy")
            {
                Error("Port " + port + " jest zajęty przez inny program.\r\n\r\n"
                    + "Zmień wartość PORT w pliku .env albo zatrzymaj program, "
                    + "który zajmuje ten port.");
                return;
            }

            if (!File.Exists(Path.Combine(appDir, "server\\src\\index.js")))
            {
                Error("Pliki aplikacji są niekompletne.\r\n\r\n"
                    + "Rozpakuj archiwum ponownie i uruchom INSTALUJ.bat.");
                return;
            }
            if (!File.Exists(Path.Combine(appDir, ".env")))
            {
                Error("Brak pliku konfiguracyjnego .env.\r\n\r\nUruchom najpierw INSTALUJ.bat.");
                return;
            }

            string node = FindNode();
            if (node == null)
            {
                if (MessageBox.Show(
                        "Nie znaleziono środowiska Node.js, które jest wymagane do uruchomienia systemu.\r\n\r\n"
                        + "Otworzyć stronę pobierania?",
                        AppName, MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes)
                {
                    Process.Start("https://nodejs.org/pl");
                }
                return;
            }

            if (!StartServer(node)) return;

            SetupTray();

            if (!WaitForServer(45))
            {
                tray.Visible = false;
                StopServer();
                Error("Serwer nie odpowiedział w wyznaczonym czasie.\r\n\r\n"
                    + "Szczegóły znajdziesz w pliku:\r\n" + logPath);
                return;
            }

            tray.Text = AppName + " — działa na porcie " + port;
            Balloon("System działa", "Aplikacja otworzy się w przeglądarce. "
                + "Ikona w zasobniku pozostaje aktywna.");
            OpenBrowser();

            Application.ApplicationExit += delegate { StopServer(); };
            Application.Run();
        }

        /* ----------------------------- Diagnostyka -------------------------------- */

        /// Sprawdza środowisko i wypisuje wynik do okna oraz na standardowe wyjście.
        static void SelfCheck(int port)
        {
            StringBuilder report = new StringBuilder();
            report.AppendLine("ResInvest ERP — kontrola srodowiska");
            report.AppendLine("katalog        : " + appDir);
            report.AppendLine("port z .env    : " + port);

            string node = FindNode();
            report.AppendLine("node.exe       : " + (node == null ? "NIE ZNALEZIONO" : node));
            report.AppendLine("plik .env      : " + Yes(File.Exists(Path.Combine(appDir, ".env"))));
            report.AppendLine("serwer (pliki) : " + Yes(File.Exists(Path.Combine(appDir, "server\\src\\index.js"))));
            report.AppendLine("aplikacja www  : " + Yes(Directory.Exists(Path.Combine(appDir, "web"))));
            report.AppendLine("ikona          : " + Yes(File.Exists(Path.Combine(appDir, "ResInvestERP.ico"))));

            string state = ProbeServer(2000);
            string described = state == "ok" ? "dziala"
                : state == "obcy" ? "port zajety przez inny program"
                : "nie dziala (port wolny)";
            report.AppendLine("stan serwera   : " + described);
            report.AppendLine("adres          : " + baseUrl);

            string text = report.ToString();
            try { Console.Write(text); } catch { }
            try { Log("--- kontrola srodowiska ---\r\n" + text); } catch { }

            // Program jest zbudowany jako aplikacja okienkowa, więc uruchomiony
            // z Eksploratora nie ma konsoli i wypis nigdzie by nie trafił.
            // Wtedy — i tylko wtedy — pokazujemy okno.
            //
            // Całość w osłonie: narzędzie diagnostyczne nie ma prawa przewrócić
            // się samo, bo wtedy zamiast odpowiedzi zostawia kolejny błąd.
            try
            {
                if (GetConsoleWindow() == IntPtr.Zero)
                {
                    MessageBox.Show(text, AppName, MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
            }
            catch { }
        }

        [DllImport("kernel32.dll")]
        static extern IntPtr GetConsoleWindow();

        static string Yes(bool value) { return value ? "jest" : "BRAK"; }

        /* ------------------------------ Konfiguracja ------------------------------ */

        /// Odczytuje PORT z pliku .env; przy braku wpisu zwraca wartość domyślną.
        static int ReadPort()
        {
            try
            {
                string envFile = Path.Combine(appDir, ".env");
                if (!File.Exists(envFile)) return DefaultPort;
                foreach (string line in File.ReadAllLines(envFile))
                {
                    Match m = Regex.Match(line.Trim(), @"^PORT\s*=\s*(\d+)");
                    if (m.Success) return int.Parse(m.Groups[1].Value);
                }
            }
            catch { }
            return DefaultPort;
        }

        /// Szuka node.exe: najpierw w PATH, potem w typowych miejscach instalacji.
        static string FindNode()
        {
            string fromPath = Which("node.exe");
            if (fromPath != null) return fromPath;

            string[] candidates = {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs\\node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs\\node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs\\nodejs\\node.exe"),
            };
            foreach (string c in candidates) if (File.Exists(c)) return c;
            return null;
        }

        static string Which(string exe)
        {
            string path = Environment.GetEnvironmentVariable("PATH");
            if (path == null) return null;
            foreach (string dir in path.Split(';'))
            {
                if (dir.Length == 0) continue;
                try
                {
                    string full = Path.Combine(dir.Trim('"'), exe);
                    if (File.Exists(full)) return full;
                }
                catch { }
            }
            return null;
        }

        /* -------------------------------- Serwer --------------------------------- */

        /// Uruchamia serwer bez okna konsoli, z dziennikiem w pliku.
        static bool StartServer(string node)
        {
            try
            {
                Directory.CreateDirectory(Path.Combine(appDir, "data"));
                lock (logLock)
                {
                    File.WriteAllText(logPath,
                        "=== " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " uruchomienie ===\r\n",
                        Encoding.UTF8);
                }

                ProcessStartInfo info = new ProcessStartInfo();
                info.FileName = node;
                info.Arguments = "--disable-warning=ExperimentalWarning \"" + appDir + "\\server\\src\\index.js\"";
                info.WorkingDirectory = appDir;
                info.UseShellExecute = false;
                info.CreateNoWindow = true;
                // Strumienie MUSZĄ być czytane na bieżąco. Przekierowane i nieczytane
                // zapełniają bufor potoku, a wtedy serwer zatrzymuje się na zapisie
                // do dziennika — awaria trudna do zdiagnozowania, bo wygląda na zawis.
                info.RedirectStandardOutput = true;
                info.RedirectStandardError = true;
                info.StandardOutputEncoding = Encoding.UTF8;
                info.StandardErrorEncoding = Encoding.UTF8;

                server = new Process();
                server.StartInfo = info;
                server.EnableRaisingEvents = true;
                server.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { Log(e.Data); };
                server.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { Log(e.Data); };
                server.Exited += delegate { OnServerExited(); };

                server.Start();
                server.BeginOutputReadLine();
                server.BeginErrorReadLine();
                return true;
            }
            catch (Exception ex)
            {
                Error("Nie udało się uruchomić serwera.\r\n\r\n" + ex.Message);
                return false;
            }
        }

        static void Log(string line)
        {
            if (line == null) return;
            try
            {
                lock (logLock) { File.AppendAllText(logPath, line + "\r\n", Encoding.UTF8); }
            }
            catch { }
        }

        /// Serwer padł samoistnie — informujemy zamiast zostawiać martwą ikonę.
        static void OnServerExited()
        {
            if (tray == null || !tray.Visible) return;
            try
            {
                tray.ContextMenuStrip.Items[0].Enabled = false;
                Balloon("Serwer zatrzymany", "System przestał działać. Zajrzyj do dziennika: launcher.log");
                tray.Text = AppName + " — zatrzymany";
            }
            catch { }
        }

        /// Zatrzymuje serwer. Zamknięcie jest twarde, ale bezpieczne dla danych:
        /// baza pracuje w trybie WAL, a każdy zapis kończy się zatwierdzoną
        /// transakcją, więc utracić można najwyżej żądanie w locie.
        static void StopServer()
        {
            try
            {
                if (server != null && !server.HasExited)
                {
                    server.Kill();
                    server.WaitForExit(5000);
                }
            }
            catch { }
        }

        /// "ok" — nasz serwer; "obcy" — port zajęty przez coś innego; "brak" — wolny.
        static string ProbeServer(int timeoutMs)
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(baseUrl + "/api/v1/health");
                request.Timeout = timeoutMs;
                request.ReadWriteTimeout = timeoutMs;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                using (StreamReader reader = new StreamReader(response.GetResponseStream()))
                {
                    string body = reader.ReadToEnd();
                    return body.Contains("\"status\"") ? "ok" : "obcy";
                }
            }
            catch (WebException ex)
            {
                // Odpowiedź inna niż 200 oznacza, że coś na tym porcie jest — ale nie my.
                if (ex.Response != null) return "obcy";
                return "brak";
            }
            catch { return "brak"; }
        }

        static bool WaitForServer(int seconds)
        {
            for (int i = 0; i < seconds * 2; i++)
            {
                if (server != null && server.HasExited) return false;
                if (ProbeServer(700) == "ok") return true;
                Thread.Sleep(500);
            }
            return false;
        }

        /* ------------------------------- Zasobnik -------------------------------- */

        static void SetupTray()
        {
            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("Otwórz aplikację", null, delegate { OpenBrowser(); });
            menu.Items.Add("Folder z danymi", null, delegate { OpenFolder(Path.Combine(appDir, "data")); });
            menu.Items.Add("Dziennik serwera", null, delegate { OpenFile(logPath); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Zakończ pracę systemu", null, delegate { Quit(); });

            tray = new NotifyIcon();
            tray.Icon = LoadIcon();
            tray.Text = AppName;
            tray.ContextMenuStrip = menu;
            tray.Visible = true;
            tray.DoubleClick += delegate { OpenBrowser(); };
        }

        static Icon LoadIcon()
        {
            try
            {
                string ico = Path.Combine(appDir, "ResInvestERP.ico");
                if (File.Exists(ico)) return new Icon(ico);
                return Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            }
            catch { return SystemIcons.Application; }
        }

        static void Quit()
        {
            if (MessageBox.Show(
                    "Zakończyć pracę systemu?\r\n\r\n"
                    + "Aplikacja przestanie być dostępna, także dla pozostałych stanowisk w sieci.",
                    AppName, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;

            tray.Visible = false;
            StopServer();
            Application.Exit();
        }

        static void Balloon(string title, string text)
        {
            try
            {
                tray.BalloonTipTitle = title;
                tray.BalloonTipText = text;
                tray.BalloonTipIcon = ToolTipIcon.Info;
                tray.ShowBalloonTip(4000);
            }
            catch { }
        }

        /* -------------------------------- Pomoc ---------------------------------- */

        static void OpenBrowser() { Launch(baseUrl); }
        static void OpenFolder(string path) { try { Directory.CreateDirectory(path); Launch(path); } catch { } }
        static void OpenFile(string path) { if (File.Exists(path)) Launch(path); }

        static void Launch(string target)
        {
            try
            {
                ProcessStartInfo info = new ProcessStartInfo(target);
                info.UseShellExecute = true;
                Process.Start(info);
            }
            catch (Exception ex) { Error("Nie udało się otworzyć: " + target + "\r\n\r\n" + ex.Message); }
        }

        static void Error(string message)
        {
            MessageBox.Show(message, AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
