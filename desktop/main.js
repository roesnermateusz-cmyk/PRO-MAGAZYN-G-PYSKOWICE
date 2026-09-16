/**
 * ResInvest ERP - powłoka desktopowa (Electron).
 *
 * Aplikacja uruchamia wbudowany serwer API jako osobny proces potomny
 * i otwiera okno przeglądarki wskazujące na ten serwer. Serwer nasłuchuje
 * na wszystkich interfejsach, dzięki czemu to samo stanowisko pełni rolę
 * serwera firmowego - pozostali użytkownicy łączą się przeglądarką,
 * pracując na tej samej bazie danych.
 */
'use strict';

const { app, BrowserWindow, Menu, dialog, shell, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const http = require('node:http');

const DEFAULT_PORT = Number(process.env.RESINVEST_PORT || 4000);

/** Katalog danych wspólny dla wszystkich kont systemu Windows. */
function resolveDataDir() {
  if (process.env.RESINVEST_DATA_DIR) return path.resolve(process.env.RESINVEST_DATA_DIR);
  if (process.platform === 'win32') {
    const base = process.env.ProgramData || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'ResInvestERP');
  }
  return path.join(app.getPath('userData'), 'data');
}

/** Zasoby aplikacji: w wersji zainstalowanej leżą poza archiwum asar. */
function resourcePath(...parts) {
  const base = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked') : __dirname;
  return path.join(base, ...parts);
}

const dataDir = resolveDataDir();
const logFile = path.join(dataDir, 'resinvest-erp.log');

let serverProcess = null;
let mainWindow = null;
let serverPort = DEFAULT_PORT;
/** Dane pierwszego logowania odebrane z serwera, zanim powstało okno programu. */
let pendingFirstRun = null;

/**
 * Pokazuje dane logowania utworzone przy pierwszym uruchomieniu.
 * Hasło można skopiowac do schowka - jest losowe i nie da się go zgadnąć.
 */
function showFirstRunDialog() {
  if (!pendingFirstRun) return;
  const { login, password, file } = pendingFirstRun;
  pendingFirstRun = null;

  dialog
    .showMessageBox(mainWindow, {
      type: 'info',
      title: 'Pierwsze uruchomienie - konto administratora',
      message: 'Utworzono konto administratora systemu',
      detail:
        `Login:  ${login}\n` +
        `Hasło:  ${password}\n\n` +
        'Przy pierwszym logowaniu program poprosi o ustawienie własnego hasła.\n\n' +
        `Dane zapisano również w pliku:\n${file}\n` +
        'Plik zostanie usunięty automatycznie po zmianie hasła.',
      buttons: ['Kopiuj hasło', 'Zamknij'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    .then(({ response }) => {
      if (response === 0) clipboard.writeText(password);
    })
    .catch(() => {
      /* Okno zamknięte przez użytkownika - dane pozostają w pliku i dzienniku. */
    });
}

function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFileSync(logFile, line);
  } catch {
    // Brak możliwości zapisu logu nie może przerwać startu aplikacji.
  }
  process.stdout.write(line);
}

/**
 * Sekrety podpisu tokenów generowane są raz przy pierwszym uruchomieniu
 * i przechowywane w katalogu danych - nigdy nie są zaszyte w kodzie.
 */
function loadOrCreateSecret(fileName) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, fileName);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

function localAddresses() {
  const result = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) result.push(entry.address);
    }
  }
  return result;
}

function waitForServer(port, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 2000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on('error', retry);
      req.on('timeout', () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() > deadline) {
        reject(new Error('Serwer nie odpowiedział w wyznaczonym czasie.'));
        return;
      }
      setTimeout(attempt, 600);
    };
    attempt();
  });
}

function startServer() {
  const entry = resourcePath('server', 'index.js');
  if (!fs.existsSync(entry)) {
    throw new Error(`Nie znaleziono pliku serwera: ${entry}`);
  }

  const env = {
    ...process.env,
    // ELECTRON_RUN_AS_NODE uruchamia proces potomny jako zwykły Node.js.
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    // Numer wersji pochodzi z manifestu aplikacji - serwer raportuje go
    // w /api/health, dzięki czemu wersja widoczna w programie i w API są zgodne.
    APP_VERSION: app.getVersion(),
    HOST: '0.0.0.0',
    PORT: String(serverPort),
    DATA_DIR: dataDir,
    CLIENT_DIST: resourcePath('client'),
    SERVE_CLIENT: 'true',
    CORS_ORIGINS: `http://localhost:${serverPort},http://127.0.0.1:${serverPort}`,
    JWT_SECRET: loadOrCreateSecret('jwt.secret'),
    REFRESH_SECRET: loadOrCreateSecret('refresh.secret'),
    BACKUP_ENABLED: 'true',
  };

  log(`Uruchamianie serwera: ${entry} (port ${serverPort}, dane: ${dataDir})`);
  serverProcess = fork(entry, [], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });

  serverProcess.stdout?.on('data', (chunk) => log(`[serwer] ${String(chunk).trimEnd()}`));
  serverProcess.stderr?.on('data', (chunk) => log(`[serwer:blad] ${String(chunk).trimEnd()}`));

  // Pierwsze uruchomienie: serwer zakłada konto administratora z losowym hasłem.
  // Pokazujemy je w oknie, żeby administrator nie musiał szukać go w pliku.
  serverProcess.on('message', (message) => {
    if (!message || message.type !== 'first-run') return;
    pendingFirstRun = message;
    if (mainWindow) showFirstRunDialog();
  });

  serverProcess.on('exit', (code, signal) => {
    log(`Serwer zakończył pracę (kod ${code}, sygnał ${signal ?? 'brak'}).`);
    serverProcess = null;
  });
}

/**
 * Zatrzymuje serwer, dając mu czas na zamknięcie bazy danych
 * (obsługa SIGTERM wykonuje checkpoint WAL i zamyka połączenie).
 */
function stopServer() {
  return new Promise((resolve) => {
    const child = serverProcess;
    if (!child) {
      resolve();
      return;
    }
    log('Zatrzymywanie serwera...');

    const force = setTimeout(() => {
      log('Serwer nie zamknął się w czasie - wymuszam zakończenie.');
      child.kill('SIGKILL');
      resolve();
    }, 8000);

    child.once('exit', () => {
      clearTimeout(force);
      resolve();
    });

    serverProcess = null;
    child.kill('SIGTERM');
  });
}

function buildMenu() {
  const addresses = localAddresses();
  const lanUrl = addresses.length > 0 ? `http://${addresses[0]}:${serverPort}` : null;

  const template = [
    {
      label: 'Plik',
      submenu: [
        {
          label: 'Odśwież',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow?.reload(),
        },
        {
          label: 'Drukuj',
          accelerator: 'CmdOrCtrl+P',
          click: () => mainWindow?.webContents.print(),
        },
        { type: 'separator' },
        { label: 'Zakończ', role: 'quit' },
      ],
    },
    {
      label: 'Widok',
      submenu: [
        { label: 'Powiększ', role: 'zoomIn' },
        { label: 'Pomniejsz', role: 'zoomOut' },
        { label: 'Rozmiar domyślny', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Pełny ekran', role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Narzędzia',
      submenu: [
        {
          label: 'Katalog danych i kopii zapasowych',
          click: () => shell.openPath(dataDir),
        },
        {
          label: 'Dziennik zdarzeń',
          click: () => shell.openPath(logFile),
        },
        { type: 'separator' },
        {
          label: 'Adres dla innych stanowisk',
          enabled: lanUrl !== null,
          click: () => {
            if (!lanUrl) return;
            clipboard.writeText(lanUrl);
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Praca wielostanowiskowa',
              message: 'Adres skopiowany do schowka',
              detail:
                `Pozostali użytkownicy otwierają w przeglądarce:\n\n${lanUrl}\n\n` +
                'Wymagane jest zezwolenie w zaporze systemu Windows dla portu ' +
                `${serverPort} (instalator dodaje regułę automatycznie).`,
            });
          },
        },
      ],
    },
    {
      label: 'Pomoc',
      submenu: [
        {
          label: 'O programie',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'ResInvest ERP',
              message: `ResInvest ERP ${app.getVersion()}`,
              detail:
                `Katalog danych: ${dataDir}\n` +
                `Port serwera: ${serverPort}\n` +
                `Adres lokalny: http://localhost:${serverPort}` +
                (lanUrl ? `\nAdres w sieci firmowej: ${lanUrl}` : ''),
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0e1520',
    title: 'ResInvest ERP',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      // Okno wyświetla wyłącznie lokalną aplikację; integracja z Node
      // jest wyłączona, aby ograniczyć powierzchnię ataku.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    // Serwer startuje przed oknem, więc dane pierwszego logowania mogły
    // dotrzeć wcześniej - pokazujemy je dopiero, gdy jest w czym.
    showFirstRunDialog();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Odnośniki zewnętrzne otwieramy w domyślnej przeglądarce, nie w oknie aplikacji.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${serverPort}`) && !url.startsWith(`http://localhost:${serverPort}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
}

// Tylko jedna instancja - druga baza na tym samym pliku byłaby błędem.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      startServer();
      await waitForServer(serverPort);
      buildMenu();
      createWindow();
      log('Aplikacja gotowa do pracy.');
    } catch (err) {
      log(`Błąd startu: ${err.message}`);
      dialog.showErrorBox(
        'Nie udało się uruchomić ResInvest ERP',
        `${err.message}\n\nSzczegóły w pliku dziennika:\n${logFile}`,
      );
      await stopServer();
      app.exit(1);
    }
  });

  app.on('window-all-closed', () => app.quit());

  // Zamknięcie aplikacji wstrzymujemy do czasu bezpiecznego zamknięcia bazy.
  let shuttingDown = false;
  app.on('before-quit', (event) => {
    if (shuttingDown || !serverProcess) return;
    event.preventDefault();
    shuttingDown = true;
    stopServer().then(() => app.exit(0));
  });
}
