/**
 * Generator wersji jednoplikowej.
 *
 * ZAŁOŻENIE, KTÓRE DECYDUJE O CAŁEJ RESZCIE
 * Wersja jednoplikowa wykonuje **ten sam kod serwera**, co wersja sieciowa —
 * te same serwisy, te same migracje, te same wyzwalacze, te same raporty.
 * Nie ma drugiego silnika. Alternatywą było przepisanie księgowania dokumentów
 * i raportów nad tablicami JavaScriptu; dwa silniki liczące te same salda
 * rozjeżdżają się prędzej czy później, a rozjazd w systemie magazynowym
 * oznacza dwa różne stany magazynu i żadnego sposobu, żeby stwierdzić, który
 * jest prawdziwy.
 *
 * Warunkiem jest SQLite działający w przeglądarce — stąd `vendor/sql-wasm.*`.
 *
 * CO GENERATOR ROBI
 *  1. przechodzi graf modułów ES od `web/src/main.js`,
 *  2. podmienia pięć plików dotykających środowiska Node (baza, konfiguracja,
 *     kryptografia, dziennik, system plików) na odpowiedniki przeglądarkowe
 *     z `standalone/src/runtime/`; serwisy załączników i kopii zapasowych
 *     zostają BEZ ZMIAN, bo wirtualny system plików wystarcza im za dysk,
 *  3. zamienia moduły ES na rejestr funkcji (przeglądarka nie ma tu serwera,
 *     z którego mogłaby je dociągnąć),
 *  4. wkleja arkusze stylów, migracje SQL, dane demonstracyjne i silnik SQLite,
 *  5. zapisuje `dist/ResInvestERP.html`.
 *
 * Uruchomienie: `npm run build:html`
 */
import {
  readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const p = (...parts) => path.join(ROOT, ...parts);

/* ====================================================================
   Podmianki — jedyne miejsca, w których wersja jednoplikowa różni się
   od serwerowej. Wszystko poza tą tabelą jest wspólne.
   ==================================================================== */

const SUBSTITUTIONS = new Map([
  // Baza: SQLite w WebAssembly zamiast `node:sqlite`, ten sam interfejs fasady.
  [p('server/src/db/index.js'), p('standalone/src/runtime/db.js')],
  // Konfiguracja: stały obiekt zamiast pliku `.env`.
  [p('server/src/config/env.js'), p('standalone/src/runtime/config.js')],
  // Kryptografia: Web Crypto; wersja jednoplikowa nie wystawia tokenów sesji.
  [p('server/src/lib/crypto.js'), p('standalone/src/runtime/crypto.js')],
  // Dziennik techniczny: konsola przeglądarki zamiast pliku.
  [p('server/src/lib/logger.js'), p('standalone/src/runtime/logger.js')],
  // Klient API: wywołanie routera na miejscu zamiast żądania HTTP.
  [p('web/src/core/api.js'), p('standalone/src/api-local.js')],
  // Ekran startowy: wybór operatora zamiast logowania (nie ma czego chronić).
  [p('web/src/views/login.js'), p('standalone/src/views/login-local.js')],
]);

/** Moduły wbudowane Node zastąpione pełnoprawną implementacją, nie atrapą. */
const NODE_SUBSTITUTIONS = new Map([
  // System plików: załączniki trafiają do IndexedDB, a nie na dysk.
  ['node:fs', p('standalone/src/runtime/fs.js')],
]);

/** Moduły wbudowane Node — w przeglądarce zastępowane atrapami. */
const NODE_STUBS = {
  'node:http': 'export default { createServer() { throw new Error("Brak serwera HTTP w wersji jednoplikowej."); } };',
  'node:path': 'const join = (...s) => s.filter(Boolean).join("/").replace(/\\/+/g, "/");\n'
    + 'const extname = (f) => { const i = String(f).lastIndexOf("."); return i > 0 ? String(f).slice(i) : ""; };\n'
    + 'const dirname = (f) => String(f).split("/").slice(0, -1).join("/") || ".";\n'
    + 'const basename = (f) => String(f).split("/").pop();\n'
    + 'const normalize = (f) => String(f);\n'
    + 'export { join, extname, dirname, basename, normalize };\n'
    + 'export default { join, extname, dirname, basename, normalize };',
  'node:url': 'export const fileURLToPath = (u) => String(u);\n'
    + 'export default { fileURLToPath };',
  'node:crypto': 'export default {};',
};

/* ====================================================================
   Rozwiązywanie modułów
   ==================================================================== */

const isBuiltin = (spec) => spec.startsWith('node:');

function resolve(fromFile, spec) {
  if (isBuiltin(spec)) return NODE_SUBSTITUTIONS.get(spec) ?? spec;
  if (spec.startsWith('virtual:')) return spec;
  const abs = path.resolve(path.dirname(fromFile), spec);
  return SUBSTITUTIONS.get(abs) ?? abs;
}

/* ====================================================================
   Zamiana modułu ES na wpis rejestru
   ==================================================================== */

/**
 * Wycina instrukcje `import` (także wielowierszowe) i zwraca je osobno.
 * Parser jest celowo prosty — obsługuje wyłącznie formy używane w tym
 * projekcie. Nieznana forma przerywa budowanie zamiast po cichu wypaść.
 */
function extractImports(code, id) {
  const imports = [];
  let out = '';
  let i = 0;

  while (i < code.length) {
    const lineEnd = code.indexOf('\n', i);
    const stop = lineEnd === -1 ? code.length : lineEnd;
    const line = code.slice(i, stop);

    if (/^import[\s{*'"]/.test(line.trimStart()) && line.trimStart().startsWith('import')) {
      // Instrukcja może obejmować kilka wierszy — czytamy do zamykającego apostrofu.
      let stmt = line;
      let end = stop;
      while (!/from\s+['"][^'"]+['"]\s*;?\s*$/.test(stmt.trim())
             && !/^import\s+['"][^'"]+['"]\s*;?\s*$/.test(stmt.trim())) {
        const nextEnd = code.indexOf('\n', end + 1);
        if (nextEnd === -1 && end >= code.length) break;
        const nextLine = code.slice(end + 1, nextEnd === -1 ? code.length : nextEnd);
        stmt += `\n${nextLine}`;
        end = nextEnd === -1 ? code.length : nextEnd;
        if (stmt.length > 4000) throw new Error(`Nie udało się zamknąć instrukcji import w ${id}`);
      }
      imports.push(stmt.trim());
      out += '\n'.repeat((stmt.match(/\n/g) || []).length + 1);
      i = end + 1;
      continue;
    }

    out += `${line}\n`;
    i = stop + 1;
    if (lineEnd === -1) break;
  }
  return { imports, body: out };
}

/** Zamienia jedną instrukcję `import` na przypisanie z rejestru. */
function compileImport(stmt, id) {
  const bare = /^import\s+['"]([^'"]+)['"]\s*;?$/.exec(stmt);
  if (bare) return { spec: bare[1], code: `__imp(${JSON.stringify(bare[1])});` };

  const m = /^import\s+([\s\S]+?)\s+from\s+['"]([^'"]+)['"]\s*;?$/.exec(stmt);
  if (!m) throw new Error(`Nieobsługiwana forma importu w ${id}:\n${stmt}`);

  const [, clause, spec] = m;
  const ref = `__imp(${JSON.stringify(spec)})`;
  const parts = [];

  const ns = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(clause.trim());
  if (ns) return { spec, code: `const ${ns[1]} = ${ref};` };

  // `domyślny, { nazwane }` — kolejność jak w specyfikacji języka.
  const braceAt = clause.indexOf('{');
  const defaultPart = (braceAt === -1 ? clause : clause.slice(0, braceAt)).replace(/,\s*$/, '').trim();
  if (defaultPart) parts.push(`const ${defaultPart} = ${ref}.default;`);

  if (braceAt !== -1) {
    const named = clause.slice(braceAt + 1, clause.lastIndexOf('}'));
    const fields = named.split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => {
        const as = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(s);
        return as ? `${as[1]}: ${as[2]}` : s;
      });
    if (fields.length) parts.push(`const { ${fields.join(', ')} } = ${ref};`);
  }
  if (!parts.length) throw new Error(`Pusty import w ${id}: ${stmt}`);
  return { spec, code: parts.join(' ') };
}

/** Zamienia deklaracje `export` na rejestracje w obiekcie modułu. */
function compileExports(body, id) {
  const names = new Set();
  let out = body;

  // `export { a } from './x.js'` — ponowny eksport; rozwijany na import + eksport.
  const reexports = [];
  out = out.replace(/^export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?\s*$/gm, (_, list, spec) => {
    const fields = list.split(',').map((s) => s.trim()).filter(Boolean);
    reexports.push({ spec, fields });
    return '';
  });

  out = out.replace(/^export\s+(default\s+)?(async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
    (_, def, asyncKw, name) => {
      names.add(def ? `default:${name}` : name);
      return `${asyncKw || ''}function ${name}`;
    });

  out = out.replace(/^export\s+class\s+([A-Za-z_$][\w$]*)/gm, (_, name) => {
    names.add(name);
    return `class ${name}`;
  });

  out = out.replace(/^export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)/gm, (_, kind, name) => {
    names.add(name);
    return `${kind} ${name}`;
  });

  // `export default <cokolwiek>` — także literał obiektu albo wyrażenie
  // wielowierszowe; wartość ląduje w zmiennej pomocniczej.
  if (/^export\s+default\s/m.test(out)) {
    out = out.replace(/^export\s+default\s+/m, 'const __default__ = ');
    names.add('default:__default__');
  }

  out = out.replace(/^export\s*\{([^}]*)\}\s*;?\s*$/gm, (_, list) => {
    for (const item of list.split(',').map((s) => s.trim()).filter(Boolean)) {
      const as = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(item);
      names.add(as ? `${as[2]}:${as[1]}` : item);
    }
    return '';
  });

  if (/^export\s/m.test(out)) {
    const leftover = out.match(/^export\s.*$/m)[0];
    throw new Error(`Nieobsługiwana forma eksportu w ${id}:\n${leftover}`);
  }

  const registrations = [...names].map((entry) => {
    const [exported, local] = entry.includes(':') ? entry.split(':') : [entry, entry];
    return `  Object.defineProperty(__x, ${JSON.stringify(exported)}, `
      + `{ get: () => ${local}, enumerable: true, configurable: true });`;
  });

  return { body: out, registrations, reexports };
}

/* ====================================================================
   Graf modułów
   ==================================================================== */

const modules = new Map();      // id → { code, deps }
const virtualSources = new Map();

function load(id) {
  if (modules.has(id)) return;
  if (isBuiltin(id)) {
    if (!NODE_STUBS[id]) throw new Error(`Brak atrapy dla modułu wbudowanego: ${id}`);
    modules.set(id, compile(id, NODE_STUBS[id]));
    return;
  }
  const source = virtualSources.has(id) ? virtualSources.get(id) : readFileSync(id, 'utf8');
  const compiled = compile(id, source);
  modules.set(id, compiled);
  for (const dep of compiled.deps) load(dep);
}

function compile(id, source) {
  const { imports, body } = extractImports(source, id);
  const deps = [];
  const head = [];
  for (const stmt of imports) {
    const { spec, code } = compileImport(stmt, id);
    const resolved = resolve(id, spec);
    deps.push(resolved);
    head.push(code.replaceAll(JSON.stringify(spec), JSON.stringify(resolved)));
  }

  const { body: stripped, registrations, reexports } = compileExports(body, id);
  for (const { spec, fields } of reexports) {
    const resolved = resolve(id, spec);
    deps.push(resolved);
    for (const field of fields) {
      const as = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(field);
      const [from, to] = as ? [as[1], as[2]] : [field, field];
      registrations.push(`  Object.defineProperty(__x, ${JSON.stringify(to)}, `
        + `{ get: () => __imp(${JSON.stringify(resolved)}).${from}, enumerable: true, configurable: true });`);
    }
  }

  return {
    deps: [...new Set(deps)],
    code: `__def(${JSON.stringify(id)}, (__x, __imp) => {\n`
      + `${head.join('\n')}\n${stripped}\n${registrations.join('\n')}\n});`,
  };
}

/** Wykrywa cykle — rejestr znosi je gorzej niż natywne moduły ES. */
function findCycles() {
  const cycles = [];
  const state = new Map();
  const stack = [];
  const walk = (id) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'open') {
      cycles.push([...stack.slice(stack.indexOf(id)), id]);
      return;
    }
    state.set(id, 'open');
    stack.push(id);
    for (const dep of modules.get(id)?.deps ?? []) walk(dep);
    stack.pop();
    state.set(id, 'done');
  };
  for (const id of modules.keys()) walk(id);
  return cycles;
}

/* ====================================================================
   Budowanie
   ==================================================================== */

const rel = (id) => (id.startsWith(ROOT) ? id.slice(ROOT.length) : id);

function migrationsSource() {
  const dir = p('server/src/db/migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const entries = files.map((f) => `  { name: ${JSON.stringify(f)}, sql: ${JSON.stringify(readFileSync(path.join(dir, f), 'utf8'))} }`);
  return `/** Migracje wklejone przez generator — te same pliki, co w wersji serwerowej. */\n`
    + `export const MIGRATIONS = [\n${entries.join(',\n')}\n];\n`
    + `export default MIGRATIONS;\n`;
}

function demoSource() {
  const file = p('server/seed/demo-data.json');
  return `/** Dane demonstracyjne — ten sam plik, co w wersji serwerowej. */\n`
    + `export const DEMO = ${readFileSync(file, 'utf8')};\nexport default DEMO;\n`;
}

function build() {
  virtualSources.set('virtual:migrations', migrationsSource());
  virtualSources.set('virtual:demo-data', demoSource());

  const entry = p('web/src/main.js');
  load(entry);

  const cycles = findCycles();
  if (cycles.length) {
    console.warn('⚠ Wykryto cykle w grafie modułów:');
    for (const cycle of cycles) console.warn(`   ${cycle.map(rel).join(' → ')}`);
  }

  const runtime = `
/* Atrapy globali Node używanych przez kod serwera.
   \`Buffer\` pojawia się przy dekodowaniu załącznika i przy mierzeniu długości
   odpowiedzi; \`process\` wyłącznie w kontroli stanu (\`/health\`). */
const __enc = new TextEncoder();
const __dec = new TextDecoder();
globalThis.Buffer = globalThis.Buffer ?? {
  from(value, encoding) {
    if (value instanceof Uint8Array) return new Uint8Array(value);
    if (encoding === 'base64') {
      const bin = atob(String(value).replace(/[^A-Za-z0-9+/=]/g, ''));
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
      return out;
    }
    return __enc.encode(String(value));
  },
  byteLength: (value) => (value instanceof Uint8Array ? value.length : __enc.encode(String(value)).length),
  concat: (parts) => {
    const total = parts.reduce((a, x) => a + x.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length; }
    return out;
  },
  isBuffer: (value) => value instanceof Uint8Array,
};
globalThis.process = globalThis.process ?? {
  uptime: () => (performance.now() / 1000),
  env: {},
  stdout: { write: () => {} },
  stderr: { write: () => {} },
};

/* Rejestr modułów — zastępuje ładowanie plików przez przeglądarkę. */
const __registry = new Map();
const __cache = new Map();
function __def(id, factory) { __registry.set(id, factory); }
function __imp(id) {
  if (__cache.has(id)) return __cache.get(id);
  const factory = __registry.get(id);
  if (!factory) throw new Error('Brak modułu w pakiecie: ' + id);
  const exports = {};
  __cache.set(id, exports);
  factory(exports, __imp);
  return exports;
}
`;

  const bundle = [runtime, ...[...modules.values()].map((m) => m.code),
    `__imp(${JSON.stringify(entry)});`].join('\n');

  const css = [
    readFileSync(p('web/assets/app.css'), 'utf8'),
    readFileSync(p('web/assets/viz.css'), 'utf8'),
    readFileSync(p('standalone/src/styles.css'), 'utf8'),
  ].join('\n');

  const shell = readFileSync(p('web/index.html'), 'utf8');
  const bodyStart = shell.indexOf('<body');
  const body = shell.slice(shell.indexOf('>', bodyStart) + 1, shell.lastIndexOf('</body>'))
    .replace(/<script[\s\S]*?<\/script>/g, '');

  const sqlLoader = readFileSync(p('standalone/vendor/sql-wasm.js'), 'utf8');
  const wasm = readFileSync(p('standalone/vendor/sql-wasm.wasm')).toString('base64');
  const version = JSON.parse(readFileSync(p('package.json'), 'utf8')).version;

  const html = `<!doctype html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#F5F8F6">
<title>ResInvest ERP · Magazyn Biomasy (wersja jednoplikowa)</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet">
<style>
${css}
</style>
</head>
<body>
${body}
<script>window.__RESINVEST_WASM__ = "${wasm}";</script>
<script>${sqlLoader}</script>
<script>
/* ResInvest ERP ${version} — wersja jednoplikowa.
   Wygenerowane przez standalone/build.mjs z tych samych źródeł, co wersja
   sieciowa. Nie edytuj tego pliku ręcznie — zmiany nadpisze kolejne budowanie. */
${bundle}
</script>
</body>
</html>
`;

  mkdirSync(p('dist'), { recursive: true });
  const out = p('dist/ResInvestERP.html');
  writeFileSync(out, html);

  const kb = (n) => `${(n / 1024).toFixed(0)} kB`;
  const appBytes = Buffer.byteLength(bundle) + Buffer.byteLength(css);
  console.log(`\n╭─ Wersja jednoplikowa gotowa ────────────────────────────────╮`);
  console.log(`│  Plik      : dist/ResInvestERP.html`);
  console.log(`│  Rozmiar   : ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB`);
  console.log(`│  Moduły    : ${modules.size} (aplikacja ${kb(appBytes)})`);
  console.log(`│  Silnik    : SQLite w WebAssembly ${kb(Buffer.byteLength(wasm))} (base64)`);
  console.log(`│  Podmianki : ${SUBSTITUTIONS.size} plików środowiska`);
  console.log(`╰─────────────────────────────────────────────────────────────╯`);
  if (!existsSync(p('standalone/vendor/sql-wasm.wasm'))) {
    console.warn('⚠ Brak silnika SQLite w standalone/vendor/');
  }
}

build();
