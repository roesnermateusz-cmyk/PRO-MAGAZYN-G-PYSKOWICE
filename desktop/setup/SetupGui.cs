// =====================================================================
//  ResInvest ERP — okna kreatora instalacji
//
//  Tu jest wyłącznie warstwa widoczna. Cała logika siedzi w `Setup.cs`
//  i nie zna tego pliku — dzięki temu daje się sprawdzić bez pulpitu
//  (`/samokontrola`).
//
//  Kreator ma pięć ekranów. Kolejność jest celowa: najpierw mówimy, co
//  to jest, potem sprawdzamy środowisko (bo to jedyny moment, w którym
//  da się jeszcze wybrać wariant bez Node.js), dopiero potem pytamy
//  o katalog i opcje.
// =====================================================================
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Windows.Forms;

/// <summary>Barwy i kroje wspólne dla obu okien — zgodne z interfejsem systemu.</summary>
static class Styl
{
    public static readonly Color Tlo = Color.FromArgb(247, 246, 243);
    public static readonly Color Naglowek = Color.FromArgb(31, 59, 45);     // zieleń ResInvest
    public static readonly Color NaglowekTekst = Color.FromArgb(245, 247, 245);
    public static readonly Color Tekst = Color.FromArgb(28, 32, 30);
    public static readonly Color TekstSlaby = Color.FromArgb(96, 104, 100);
    public static readonly Color Akcent = Color.FromArgb(46, 110, 76);
    public static readonly Color Blad = Color.FromArgb(150, 42, 36);

    public static Font Duza { get { return new Font("Segoe UI", 15F, FontStyle.Bold); } }
    public static Font Srednia { get { return new Font("Segoe UI", 10.5F, FontStyle.Bold); } }
    public static Font Zwykla { get { return new Font("Segoe UI", 9.75F); } }
    public static Font Mala { get { return new Font("Segoe UI", 8.75F); } }
    public static Font Stala { get { return new Font("Consolas", 11F, FontStyle.Bold); } }

    public static Button Przycisk(string tekst, bool glowny)
    {
        var b = new Button
        {
            Text = tekst,
            Font = Zwykla,
            Height = 34,
            Width = 118,
            FlatStyle = FlatStyle.Flat,
            UseVisualStyleBackColor = false,
            BackColor = glowny ? Akcent : Color.White,
            ForeColor = glowny ? Color.White : Tekst,
            Cursor = Cursors.Hand,
        };
        b.FlatAppearance.BorderColor = glowny ? Akcent : Color.FromArgb(205, 208, 204);
        b.FlatAppearance.BorderSize = 1;
        return b;
    }

    public static Label Etykieta(string tekst, Font font, Color kolor, int x, int y, int szerokosc)
    {
        return new Label
        {
            Text = tekst, Font = font, ForeColor = kolor,
            Location = new Point(x, y), Width = szerokosc,
            AutoSize = false, Height = 0, BackColor = Color.Transparent,
        };
    }
}

// =====================================================================
//  Kreator instalacji
// =====================================================================

sealed class OknoKreatora : Form
{
    public int KodWyjscia = 1;

    Ladunek _ladunek;
    StanNode _node;
    readonly OpcjeInstalacji _opcje = new OpcjeInstalacji();
    WynikInstalacji _wynik;

    Panel _tresc;
    Label _tytul, _podtytul;
    Button _wstecz, _dalej, _anuluj;
    int _krok;

    // Sterowanie ekranu opcji — czytane przy przejściu dalej.
    TextBox _poleKatalog;
    CheckBox _demo, _pulpit, _menu, _autostart;
    ProgressBar _pasek;
    Label _etykietaPostepu;
    TextBox _dziennik;

    public OknoKreatora()
    {
        Text = "Instalacja " + Program.PRODUKT + " " + Program.WERSJA;
        ClientSize = new Size(660, 470);
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Styl.Tlo;
        Font = Styl.Zwykla;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        var pasekGorny = new Panel
        {
            Dock = DockStyle.Top, Height = 78, BackColor = Styl.Naglowek,
        };
        _tytul = new Label
        {
            Font = Styl.Duza, ForeColor = Styl.NaglowekTekst, BackColor = Color.Transparent,
            Location = new Point(24, 14), Size = new Size(610, 28), Text = Program.PRODUKT,
        };
        _podtytul = new Label
        {
            Font = Styl.Zwykla, ForeColor = Color.FromArgb(178, 196, 185), BackColor = Color.Transparent,
            Location = new Point(26, 44), Size = new Size(610, 22), Text = "Magazyn biomasy drzewnej",
        };
        pasekGorny.Controls.Add(_tytul);
        pasekGorny.Controls.Add(_podtytul);

        _tresc = new Panel
        {
            Location = new Point(0, 78), Size = new Size(660, 332), BackColor = Styl.Tlo,
        };

        var pasekDolny = new Panel
        {
            Dock = DockStyle.Bottom, Height = 60, BackColor = Color.FromArgb(240, 239, 235),
        };
        _anuluj = Styl.Przycisk("Anuluj", false);
        _anuluj.Location = new Point(18, 13);
        _anuluj.Click += delegate { Zamknij(); };

        _wstecz = Styl.Przycisk("Wstecz", false);
        _wstecz.Location = new Point(394, 13);
        _wstecz.Click += delegate { Wstecz(); };

        _dalej = Styl.Przycisk("Dalej", true);
        _dalej.Location = new Point(524, 13);
        _dalej.Click += delegate { Dalej(); };

        pasekDolny.Controls.Add(_anuluj);
        pasekDolny.Controls.Add(_wstecz);
        pasekDolny.Controls.Add(_dalej);

        Controls.Add(_tresc);
        Controls.Add(pasekGorny);
        Controls.Add(pasekDolny);

        PokazKrok(0);
    }

    void Zamknij()
    {
        if (_krok == 4) { KodWyjscia = _wynik != null && _wynik.Powodzenie ? 0 : 1; Close(); return; }
        if (_krok == 3) return;   // w trakcie instalacji nie przerywamy
        if (MessageBox.Show(this, "Przerwać instalację?", "Instalacja",
                MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes)
        { KodWyjscia = 2; Close(); }
    }

    void Wstecz() { if (_krok > 0 && _krok < 3) PokazKrok(_krok - 1); }

    void Dalej()
    {
        if (_krok == 2) ZbierzOpcje();
        if (_krok == 4) { KodWyjscia = 0; Close(); return; }
        if (_krok == 3) return;
        PokazKrok(_krok + 1);
    }

    void PokazKrok(int nr)
    {
        _krok = nr;
        _tresc.Controls.Clear();
        _wstecz.Enabled = nr > 0 && nr < 3;
        _dalej.Enabled = true;
        _dalej.Text = "Dalej";
        _anuluj.Text = "Anuluj";

        switch (nr)
        {
            case 0: EkranPowitania(); break;
            case 1: EkranSrodowiska(); break;
            case 2: EkranOpcji(); break;
            case 3: EkranInstalacji(); break;
            case 4: EkranZakonczenia(); break;
        }
    }

    /* ------------------------------ Ekran 1 ---------------------------- */

    void EkranPowitania()
    {
        _tytul.Text = "Instalacja systemu";
        _podtytul.Text = "ResInvest ERP " + Program.WERSJA + " — magazyn biomasy drzewnej";

        Dodaj(new Label
        {
            Text = "Ten kreator zainstaluje system magazynowy na tym komputerze.",
            Font = Styl.Srednia, ForeColor = Styl.Tekst,
            Location = new Point(28, 24), Size = new Size(600, 24),
        });

        Dodaj(new Label
        {
            Text =
                "Wszystko, czego system potrzebuje, jest w tym pliku — instalacja nie pobiera "
                + "niczego z internetu i działa na komputerze bez dostępu do sieci.\r\n\r\n"
                + "Program instaluje się w katalogu użytkownika, więc nie wymaga uprawnień "
                + "administratora.\r\n\r\n"
                + "Obsługuje dokumenty PZ, WZ, PW, RW, MM i BO, produkcję zrębki, raporty "
                + "miesięczne, korekty, okresy księgowe oraz kopie zapasowe.",
            Font = Styl.Zwykla, ForeColor = Styl.TekstSlaby,
            Location = new Point(28, 58), Size = new Size(600, 140),
        });

        var ramka = new Panel
        {
            Location = new Point(28, 208), Size = new Size(600, 88),
            BackColor = Color.White, BorderStyle = BorderStyle.FixedSingle,
        };
        ramka.Controls.Add(new Label
        {
            Text = "Zanim zaczniesz",
            Font = Styl.Srednia, ForeColor = Styl.Tekst,
            Location = new Point(14, 10), Size = new Size(560, 20),
        });
        ramka.Controls.Add(new Label
        {
            Text = "Do pracy pełnej wersji potrzebne jest środowisko Node.js 22 lub nowsze.\r\n"
                 + "Jeżeli go nie ma, kreator zaproponuje wersję jednoplikową, która działa\r\n"
                 + "w samej przeglądarce — bez instalowania czegokolwiek więcej.",
            Font = Styl.Mala, ForeColor = Styl.TekstSlaby,
            Location = new Point(14, 32), Size = new Size(570, 50),
        });
        Dodaj(ramka);
    }

    /* ------------------------------ Ekran 2 ---------------------------- */

    void EkranSrodowiska()
    {
        _tytul.Text = "Sprawdzanie środowiska";
        _podtytul.Text = "Czy komputer ma wszystko, czego system potrzebuje";

        var stan = new Label
        {
            Text = "Sprawdzanie…", Font = Styl.Srednia, ForeColor = Styl.TekstSlaby,
            Location = new Point(28, 28), Size = new Size(600, 24),
        };
        Dodaj(stan);
        _dalej.Enabled = false;
        Application.DoEvents();

        _node = Srodowisko.SprawdzNode();
        if (_ladunek == null)
        {
            try { _ladunek = Ladunek.ZZasobu(); }
            catch (Exception ex)
            {
                stan.Text = "Plik instalatora jest uszkodzony.";
                stan.ForeColor = Styl.Blad;
                Dodaj(new Label
                {
                    Text = ex.Message + "\r\n\r\nPobierz instalator ponownie i sprawdź sumę kontrolną SHA-256.",
                    Font = Styl.Zwykla, ForeColor = Styl.TekstSlaby,
                    Location = new Point(28, 60), Size = new Size(600, 80),
                });
                return;
            }
        }

        bool ok = _node.Wystarczajacy;
        stan.Text = ok
            ? "Środowisko Node.js " + _node.Opis + " — w porządku."
            : (_node.Jest
                ? "Node.js " + _node.Opis + " jest za stary (wymagana wersja "
                  + Program.WYMAGANY_NODE + " lub nowsza)."
                : "Nie znaleziono środowiska Node.js.");
        stan.ForeColor = ok ? Styl.Akcent : Styl.Blad;

        Dodaj(new Label
        {
            Text = "Zawartość instalatora: " + _ladunek.Wpisy.Count + " plików, "
                 + (_ladunek.RozmiarPoRozpakowaniu() / 1024 / 1024) + " MB po rozpakowaniu.",
            Font = Styl.Mala, ForeColor = Styl.TekstSlaby,
            Location = new Point(28, 56), Size = new Size(600, 20),
        });

        if (ok)
        {
            _opcje.TylkoJednoplikowa = false;
            Dodaj(new Label
            {
                Text = "Można instalować pełną wersję systemu.",
                Font = Styl.Zwykla, ForeColor = Styl.Tekst,
                Location = new Point(28, 92), Size = new Size(600, 24),
            });
            _dalej.Enabled = true;
            return;
        }

        // Brak Node.js — wybór zamiast ślepego zaułka.
        Dodaj(new Label
        {
            Text = "Masz dwie możliwości:",
            Font = Styl.Srednia, ForeColor = Styl.Tekst,
            Location = new Point(28, 90), Size = new Size(600, 22),
        });

        var wybor1 = new RadioButton
        {
            Text = "Zainstaluj wersję jednoplikową (zalecane teraz)",
            Font = Styl.Zwykla, ForeColor = Styl.Tekst, Checked = true,
            Location = new Point(28, 118), Size = new Size(600, 24),
        };
        Dodaj(wybor1);
        Dodaj(new Label
        {
            Text = "Cały system w jednym pliku HTML, otwierany dwuklikiem. Działa bez instalacji\r\n"
                 + "i bez internetu. Dane zostają w tej przeglądarce, na tym komputerze.",
            Font = Styl.Mala, ForeColor = Styl.TekstSlaby,
            Location = new Point(50, 142), Size = new Size(580, 38),
        });

        var wybor2 = new RadioButton
        {
            Text = "Najpierw zainstaluję Node.js, potem wrócę tutaj",
            Font = Styl.Zwykla, ForeColor = Styl.Tekst,
            Location = new Point(28, 186), Size = new Size(600, 24),
        };
        Dodaj(wybor2);
        Dodaj(new Label
        {
            Text = "Pełna wersja: praca wielu osób, kopie zapasowe, import i eksport danych.",
            Font = Styl.Mala, ForeColor = Styl.TekstSlaby,
            Location = new Point(50, 210), Size = new Size(580, 20),
        });

        var pobierz = Styl.Przycisk("Otwórz nodejs.org", false);
        pobierz.Width = 170;
        pobierz.Location = new Point(50, 234);
        pobierz.Click += delegate
        {
            try { Process.Start("https://nodejs.org/pl"); }
            catch
            {
                MessageBox.Show(this,
                    "Nie udało się otworzyć przeglądarki.\r\nWpisz adres ręcznie: https://nodejs.org/pl",
                    "Node.js", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        };
        Dodaj(pobierz);

        EventHandler zmiana = delegate
        {
            _opcje.TylkoJednoplikowa = wybor1.Checked;
            _dalej.Enabled = true;
        };
        wybor1.CheckedChanged += zmiana;
        wybor2.CheckedChanged += zmiana;
        _opcje.TylkoJednoplikowa = true;
        _dalej.Enabled = true;
    }

    /* ------------------------------ Ekran 3 ---------------------------- */

    void EkranOpcji()
    {
        _tytul.Text = "Miejsce i opcje";
        _podtytul.Text = _opcje.TylkoJednoplikowa
            ? "Wersja jednoplikowa — bez Node.js"
            : "Pełna wersja systemu";

        Dodaj(new Label
        {
            Text = "Katalog instalacji", Font = Styl.Srednia, ForeColor = Styl.Tekst,
            Location = new Point(28, 22), Size = new Size(400, 22),
        });

        string domyslny = Rejestr.PoprzedniKatalog();
        if (string.IsNullOrEmpty(domyslny))
            domyslny = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ResInvest ERP");

        _poleKatalog = new TextBox
        {
            Text = domyslny, Font = Styl.Zwykla,
            Location = new Point(28, 48), Size = new Size(490, 26),
        };
        Dodaj(_poleKatalog);

        var przegladaj = Styl.Przycisk("Zmień…", false);
        przegladaj.Width = 102;
        przegladaj.Height = 28;
        przegladaj.Location = new Point(526, 47);
        przegladaj.Click += delegate
        {
            using (var d = new FolderBrowserDialog())
            {
                d.Description = "Wybierz katalog instalacji";
                if (d.ShowDialog(this) == DialogResult.OK)
                    _poleKatalog.Text = Path.Combine(d.SelectedPath, "ResInvest ERP");
            }
        };
        Dodaj(przegladaj);

        Dodaj(new Label
        {
            Text = "Katalog w profilu użytkownika nie wymaga uprawnień administratora.",
            Font = Styl.Mala, ForeColor = Styl.TekstSlaby,
            Location = new Point(28, 78), Size = new Size(600, 20),
        });

        string poprzedni = Rejestr.PoprzedniKatalog();
        if (!string.IsNullOrEmpty(poprzedni) && Directory.Exists(poprzedni))
        {
            Dodaj(new Label
            {
                Text = "Wykryto wcześniejszą instalację — pliki programu zostaną zaktualizowane,\r\n"
                     + "a dane magazynowe i konfiguracja zachowane bez zmian.",
                Font = Styl.Mala, ForeColor = Styl.Akcent,
                Location = new Point(28, 98), Size = new Size(600, 36),
            });
        }

        int y = 142;
        Dodaj(new Label
        {
            Text = "Opcje", Font = Styl.Srednia, ForeColor = Styl.Tekst,
            Location = new Point(28, y), Size = new Size(400, 22),
        });
        y += 28;

        _pulpit = Pole("Skrót na pulpicie", true, ref y);
        _menu = Pole("Pozycja w menu Start", true, ref y);
        _autostart = Pole("Uruchamiaj automatycznie po zalogowaniu", false, ref y);

        if (!_opcje.TylkoJednoplikowa)
        {
            _demo = Pole("Wgraj dane demonstracyjne (do zapoznania się z systemem)", false, ref y);
            Dodaj(new Label
            {
                Text = "Dane demonstracyjne można później usunąć, czyszcząc rejestr dokumentów.",
                Font = Styl.Mala, ForeColor = Styl.TekstSlaby,
                Location = new Point(48, y), Size = new Size(580, 20),
            });
        }

        _dalej.Text = "Instaluj";
    }

    CheckBox Pole(string tekst, bool zaznaczone, ref int y)
    {
        var c = new CheckBox
        {
            Text = tekst, Checked = zaznaczone, Font = Styl.Zwykla, ForeColor = Styl.Tekst,
            Location = new Point(28, y), Size = new Size(600, 24),
        };
        Dodaj(c);
        y += 26;
        return c;
    }

    void ZbierzOpcje()
    {
        _opcje.Katalog = _poleKatalog.Text.Trim();
        _opcje.SkrotNaPulpicie = _pulpit.Checked;
        _opcje.WMenuStart = _menu.Checked;
        _opcje.Autostart = _autostart.Checked;
        _opcje.DaneDemonstracyjne = _demo != null && _demo.Checked;
    }

    /* ------------------------------ Ekran 4 ---------------------------- */

    void EkranInstalacji()
    {
        _tytul.Text = "Instalowanie";
        _podtytul.Text = "To potrwa kilkanaście sekund";
        _dalej.Enabled = false;
        _wstecz.Enabled = false;
        _anuluj.Enabled = false;

        _etykietaPostepu = new Label
        {
            Text = "Przygotowywanie…", Font = Styl.Zwykla, ForeColor = Styl.Tekst,
            Location = new Point(28, 30), Size = new Size(600, 22),
        };
        Dodaj(_etykietaPostepu);

        _pasek = new ProgressBar
        {
            Location = new Point(28, 58), Size = new Size(600, 18),
            Minimum = 0, Maximum = 100, Style = ProgressBarStyle.Continuous,
        };
        Dodaj(_pasek);

        _dziennik = new TextBox
        {
            Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical,
            Font = Styl.Mala, BackColor = Color.White, ForeColor = Styl.TekstSlaby,
            Location = new Point(28, 92), Size = new Size(600, 200),
            BorderStyle = BorderStyle.FixedSingle,
        };
        Dodaj(_dziennik);

        // Instalacja w osobnym wątku, żeby okno nie zamarzło na czas migracji.
        var watek = new Thread(delegate ()
        {
            var instalator = new Instalator(_ladunek, delegate (string tekst, int procent)
            {
                try { Invoke(new Action(delegate { Postep(tekst, procent); })); }
                catch { }
            });
            WynikInstalacji w = instalator.Wykonaj(_opcje);
            try { Invoke(new Action(delegate { Zakonczono(w); })); }
            catch { }
        });
        watek.IsBackground = true;
        watek.Start();
    }

    string _ostatniKrok = "";

    void Postep(string tekst, int procent)
    {
        _pasek.Value = Math.Max(0, Math.Min(100, procent));
        _etykietaPostepu.Text = tekst;
        // Nazwy kolejnych rozpakowywanych plików tylko migają w etykiecie;
        // do dziennika trafiają same etapy, żeby dało się go przeczytać.
        if (!tekst.StartsWith("Rozpakowywanie:") && tekst != _ostatniKrok)
        {
            _ostatniKrok = tekst;
            _dziennik.AppendText(tekst + "\r\n");
        }
    }

    void Zakonczono(WynikInstalacji w)
    {
        _wynik = w;
        _anuluj.Enabled = true;
        if (!w.Powodzenie)
        {
            _tytul.Text = "Instalacja nie powiodła się";
            _etykietaPostepu.Text = "Wystąpił błąd.";
            _etykietaPostepu.ForeColor = Styl.Blad;
            _dziennik.AppendText("\r\nBŁĄD: " + w.Blad + "\r\n");
            _anuluj.Text = "Zamknij";
            return;
        }
        PokazKrok(4);
    }

    /* ------------------------------ Ekran 5 ---------------------------- */

    void EkranZakonczenia()
    {
        _tytul.Text = "Gotowe";
        _podtytul.Text = "System jest zainstalowany";
        _wstecz.Enabled = false;
        _dalej.Text = "Zakończ";
        _dalej.Enabled = true;
        _anuluj.Enabled = true;
        _anuluj.Text = "Zamknij";

        int y = 22;
        Dodaj(new Label
        {
            Text = "Instalacja zakończona pomyślnie.",
            Font = Styl.Srednia, ForeColor = Styl.Akcent,
            Location = new Point(28, y), Size = new Size(600, 24),
        });
        y += 32;

        if (_wynik.Logowanie != null && _wynik.Logowanie.Nowa)
        {
            var ramka = new Panel
            {
                Location = new Point(28, y), Size = new Size(600, 116),
                BackColor = Color.White, BorderStyle = BorderStyle.FixedSingle,
            };
            ramka.Controls.Add(new Label
            {
                Text = "DANE PIERWSZEGO LOGOWANIA — ZAPISZ JE TERAZ",
                Font = Styl.Srednia, ForeColor = Styl.Blad,
                Location = new Point(14, 10), Size = new Size(570, 20),
            });
            ramka.Controls.Add(new Label
            {
                Text = "Login:", Font = Styl.Zwykla, ForeColor = Styl.TekstSlaby,
                Location = new Point(14, 38), Size = new Size(58, 20),
            });
            ramka.Controls.Add(new TextBox
            {
                Text = _wynik.Logowanie.Login, Font = Styl.Stala, ReadOnly = true,
                BorderStyle = BorderStyle.None, BackColor = Color.White, ForeColor = Styl.Tekst,
                Location = new Point(76, 37), Size = new Size(280, 22),
            });
            ramka.Controls.Add(new Label
            {
                Text = "Hasło:", Font = Styl.Zwykla, ForeColor = Styl.TekstSlaby,
                Location = new Point(14, 64), Size = new Size(58, 20),
            });
            ramka.Controls.Add(new TextBox
            {
                Text = _wynik.Logowanie.Haslo, Font = Styl.Stala, ReadOnly = true,
                BorderStyle = BorderStyle.None, BackColor = Color.White, ForeColor = Styl.Tekst,
                Location = new Point(76, 63), Size = new Size(280, 22),
            });
            ramka.Controls.Add(new Label
            {
                Text = "System poprosi o zmianę hasła przy pierwszym logowaniu.",
                Font = Styl.Mala, ForeColor = Styl.TekstSlaby,
                Location = new Point(14, 90), Size = new Size(430, 18),
            });

            var kopiuj = Styl.Przycisk("Kopiuj hasło", false);
            kopiuj.Width = 130;
            kopiuj.Height = 30;
            kopiuj.Location = new Point(452, 44);
            kopiuj.Click += delegate
            {
                try { Clipboard.SetText(_wynik.Logowanie.Haslo); kopiuj.Text = "Skopiowano"; }
                catch { kopiuj.Text = "Nie udało się"; }
            };
            ramka.Controls.Add(kopiuj);
            Dodaj(ramka);
            y += 126;

            if (!string.IsNullOrEmpty(_wynik.PlikZDanymi))
            {
                Dodaj(new Label
                {
                    Text = "Te same dane zapisano w pliku DANE-PIERWSZEGO-LOGOWANIA.txt\r\n"
                         + "w katalogu programu. Po zmianie hasła można go skasować.",
                    Font = Styl.Mala, ForeColor = Styl.TekstSlaby,
                    Location = new Point(28, y), Size = new Size(600, 34),
                });
                y += 40;
            }
        }
        else
        {
            Dodaj(new Label
            {
                Text = "Zachowano istniejącą konfigurację i dane magazynowe.\r\n"
                     + "Hasła logowania nie zmieniono.",
                Font = Styl.Zwykla, ForeColor = Styl.TekstSlaby,
                Location = new Point(28, y), Size = new Size(600, 40),
            });
            y += 48;
        }

        Dodaj(new Label
        {
            Text = _opcje.TylkoJednoplikowa
                ? "Uruchamianie: dwuklik w pliku ResInvestERP.html albo skrót na pulpicie."
                : "Uruchamianie: skrót „ResInvest ERP” na pulpicie.\r\n"
                  + "System otworzy się w przeglądarce pod adresem http://localhost:4173",
            Font = Styl.Zwykla, ForeColor = Styl.Tekst,
            Location = new Point(28, y), Size = new Size(600, 44),
        });
        y += 50;

        var uruchom = Styl.Przycisk("Uruchom teraz", true);
        uruchom.Width = 150;
        uruchom.Location = new Point(28, y);
        uruchom.Click += delegate
        {
            try
            {
                Process.Start(new ProcessStartInfo(_wynik.CoUruchomic)
                {
                    UseShellExecute = true,
                    WorkingDirectory = _opcje.Katalog,
                });
                KodWyjscia = 0;
                Close();
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "Nie udało się uruchomić:\r\n" + ex.Message,
                    "Uruchamianie", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        };
        Dodaj(uruchom);

        var katalog = Styl.Przycisk("Otwórz katalog", false);
        katalog.Width = 150;
        katalog.Location = new Point(188, y);
        katalog.Click += delegate
        {
            try { Process.Start("explorer.exe", "\"" + _opcje.Katalog + "\""); } catch { }
        };
        Dodaj(katalog);
    }

    void Dodaj(Control c) { _tresc.Controls.Add(c); }
}

// =====================================================================
//  Odinstalowanie
// =====================================================================

sealed class OknoOdinstalowania : Form
{
    public int KodWyjscia = 1;
    readonly CheckBox _usunDane;
    readonly string _katalog;

    public OknoOdinstalowania()
    {
        _katalog = Rejestr.PoprzedniKatalog();
        if (string.IsNullOrEmpty(_katalog))
            _katalog = Path.GetDirectoryName(Application.ExecutablePath);

        Text = "Odinstalowanie " + Program.PRODUKT;
        ClientSize = new Size(560, 300);
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Styl.Tlo;
        Font = Styl.Zwykla;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        var gora = new Panel { Dock = DockStyle.Top, Height = 60, BackColor = Styl.Naglowek };
        gora.Controls.Add(new Label
        {
            Text = "Odinstalowanie " + Program.PRODUKT,
            Font = Styl.Duza, ForeColor = Styl.NaglowekTekst, BackColor = Color.Transparent,
            Location = new Point(22, 16), Size = new Size(520, 30),
        });
        Controls.Add(gora);

        Controls.Add(new Label
        {
            Text = "Program zostanie usunięty z katalogu:",
            Font = Styl.Zwykla, ForeColor = Styl.Tekst,
            Location = new Point(24, 78), Size = new Size(510, 20),
        });
        Controls.Add(new TextBox
        {
            Text = _katalog, ReadOnly = true, Font = Styl.Mala,
            BorderStyle = BorderStyle.FixedSingle, BackColor = Color.White,
            Location = new Point(24, 100), Size = new Size(510, 24),
        });

        _usunDane = new CheckBox
        {
            Text = "Usuń także dane magazynowe i konfigurację",
            Checked = false, Font = Styl.Zwykla, ForeColor = Styl.Tekst,
            Location = new Point(24, 142), Size = new Size(510, 24),
        };
        Controls.Add(_usunDane);

        Controls.Add(new Label
        {
            Text = "Domyślnie katalog data\\ zostaje nietknięty — są w nim dokumenty magazynowe,\r\n"
                 + "kopie zapasowe i załączniki, których nie da się odtworzyć. Zaznacz to pole\r\n"
                 + "tylko wtedy, gdy masz pewność, że te dane nie będą już nigdy potrzebne.",
            Font = Styl.Mala, ForeColor = Styl.TekstSlaby,
            Location = new Point(44, 168), Size = new Size(500, 54),
        });

        var usun = Styl.Przycisk("Odinstaluj", true);
        usun.Location = new Point(300, 240);
        usun.Click += delegate { Wykonaj(); };
        Controls.Add(usun);

        var anuluj = Styl.Przycisk("Anuluj", false);
        anuluj.Location = new Point(424, 240);
        anuluj.Click += delegate { KodWyjscia = 2; Close(); };
        Controls.Add(anuluj);
    }

    void Wykonaj()
    {
        if (_usunDane.Checked)
        {
            var odp = MessageBox.Show(this,
                "Usunąć bezpowrotnie wszystkie dokumenty magazynowe, kopie zapasowe\r\n"
                + "i załączniki?\r\n\r\nTej operacji nie da się cofnąć.",
                "Usuwanie danych", MessageBoxButtons.YesNo, MessageBoxIcon.Warning,
                MessageBoxDefaultButton.Button2);
            if (odp != DialogResult.Yes) return;
        }

        string komunikat;
        bool ok = Odinstalowanie.Wykonaj(_katalog, _usunDane.Checked, out komunikat);
        MessageBox.Show(this, komunikat, "Odinstalowanie",
            MessageBoxButtons.OK, ok ? MessageBoxIcon.Information : MessageBoxIcon.Error);
        KodWyjscia = ok ? 0 : 1;
        Close();
    }
}
