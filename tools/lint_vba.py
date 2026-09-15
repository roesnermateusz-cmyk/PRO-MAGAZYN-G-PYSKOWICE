#!/usr/bin/env python3
"""Statyczna kontrola zrodel VBA przed wbudowaniem ich w skoroszyt.

VBA nie daje sie skompilowac poza Excelem, dlatego najczestsze bledy
strukturalne wychwytujemy tutaj:

* deklaracje modulowe (Const / Dim / Type / Enum) po pierwszej procedurze,
* niedomkniete bloki (Sub, Function, If, For, With, Select Case, ...),
* zle zapisana kontynuacja wiersza,
* odwolania do nieistniejacych stalych, kolumn i arkuszy,
* duplikaty nazw procedur,
* przekroczenie limitu dlugosci wiersza VBA.

Uruchomienie:  python3 tools/lint_vba.py src/vba
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# Slowa kluczowe otwierajace i zamykajace bloki.
BLOCKS = {
    "sub": "end sub",
    "function": "end function",
    "property": "end property",
    "type": "end type",
    "enum": "end enum",
    "with": "end with",
    "select": "end select",
}

DECLARATIONS = re.compile(
    r"^\s*(?:public\s+|private\s+|global\s+)?"
    r"(?:const|type|enum|declare)\b|^\s*(?:dim|public|private)\s+\w+\s+as\b",
    re.IGNORECASE,
)

PROC_START = re.compile(
    r"^\s*(?:public\s+|private\s+|friend\s+|static\s+)*"
    r"(?:sub|function|property\s+(?:get|let|set))\s+(\w+)",
    re.IGNORECASE,
)

# Prefiksy identyfikatorow, ktorych istnienie weryfikujemy miedzy modulami.
TRACKED = re.compile(
    r"\b(ws[A-Z]\w*|kol[A-Z]\w*|OP_\w+|UST_\w+|SL_\w+|ST_\w+|APP_\w+|TABELA_\w+|KOL_\w+|POLE_\w+)\b"
)

VBA_MAX_LINE = 1023


def strip_code(line: str) -> str:
    """Usuwa komentarze i zawartosc literalow tekstowych."""
    out = []
    in_string = False
    i = 0
    while i < len(line):
        ch = line[i]
        if in_string:
            if ch == '"':
                if i + 1 < len(line) and line[i + 1] == '"':
                    i += 2
                    continue
                in_string = False
            i += 1
            continue
        if ch == '"':
            in_string = True
            out.append(" ")
            i += 1
            continue
        if ch == "'":
            break
        out.append(ch)
        i += 1
    text = "".join(out)
    if re.match(r"^\s*rem\b", text, re.IGNORECASE):
        return ""
    return text


def join_continuations(lines: list[str]) -> list[tuple[int, str]]:
    """Skleja wiersze rozdzielone znakiem kontynuacji; zwraca (nr_wiersza, tresc)."""
    joined: list[tuple[int, str]] = []
    buffer = ""
    start = 0
    for number, raw in enumerate(lines, start=1):
        code = strip_code(raw).rstrip()
        if not buffer:
            start = number
        if code.endswith(" _"):
            buffer += code[:-1]
            continue
        buffer += code
        joined.append((start, buffer))
        buffer = ""
    if buffer:
        joined.append((start, buffer))
    return joined


class Problem:
    def __init__(self, path: Path, line: int, message: str):
        self.path, self.line, self.message = path, line, message

    def __str__(self) -> str:
        return f"{self.path}:{self.line}: {self.message}"


def check_module(path: Path, defined: set[str], problems: list[Problem]) -> None:
    raw_lines = path.read_text(encoding="utf-8").split("\n")

    if not any(l.strip().lower() == "option explicit" for l in raw_lines[:5]):
        problems.append(Problem(path, 1, "brak 'Option Explicit' na poczatku modulu"))

    for number, raw in enumerate(raw_lines, start=1):
        if len(raw) > VBA_MAX_LINE:
            problems.append(
                Problem(path, number, f"wiersz dluzszy niz {VBA_MAX_LINE} znakow")
            )
        if raw.rstrip().endswith("_") and not raw.rstrip().endswith(" _"):
            if strip_code(raw).strip():
                problems.append(
                    Problem(path, number, "kontynuacja '_' musi byc poprzedzona spacja")
                )

    lines = join_continuations(raw_lines)

    stack: list[tuple[str, int]] = []
    first_proc: int | None = None
    seen_procs: dict[str, int] = {}

    for number, code in lines:
        low = code.strip().lower()
        if not low:
            continue

        match = PROC_START.match(code)
        if match and not low.startswith("end "):
            if first_proc is None:
                first_proc = number
            name = match.group(1).lower()
            if name in seen_procs:
                problems.append(
                    Problem(
                        path,
                        number,
                        f"procedura '{match.group(1)}' zdefiniowana ponownie "
                        f"(pierwszy raz w wierszu {seen_procs[name]})",
                    )
                )
            else:
                seen_procs[name] = number

        if DECLARATIONS.match(code) and first_proc is not None:
            if not low.startswith(("dim ", "static ")):
                problems.append(
                    Problem(
                        path,
                        number,
                        "deklaracja modulowa po pierwszej procedurze "
                        f"(procedury zaczynaja sie w wierszu {first_proc}) - "
                        "VBA wymaga ich w sekcji deklaracji",
                    )
                )

        # --- domykanie blokow ---
        head = re.sub(
            r"^(?:public|private|friend|static|global)\s+", "", low, flags=re.IGNORECASE
        )
        head = re.sub(r"^(?:public|private|friend|static)\s+", "", head)

        if head.startswith("declare "):
            continue

        for opener, closer in BLOCKS.items():
            if head.startswith(closer):
                if stack and stack[-1][0] == opener:
                    stack.pop()
                else:
                    problems.append(
                        Problem(path, number, f"'{closer}' bez pasujacego '{opener}'")
                    )
                break
            if re.match(rf"^{opener}\b", head):
                if opener == "select" and not head.startswith("select case"):
                    break
                if opener == "property":
                    stack.append((opener, number))
                    break
                stack.append((opener, number))
                break
        else:
            # If / For / Do maja wlasne reguly
            if re.match(r"^if\b.*\bthen\b", head):
                after_then = head.split(" then", 1)[1].strip()
                if not after_then:
                    stack.append(("if", number))
            elif head.startswith("end if"):
                if stack and stack[-1][0] == "if":
                    stack.pop()
                else:
                    problems.append(Problem(path, number, "'End If' bez 'If'"))
            elif re.match(r"^for\b", head):
                stack.append(("for", number))
            elif re.match(r"^next\b", head):
                if stack and stack[-1][0] == "for":
                    stack.pop()
                else:
                    problems.append(Problem(path, number, "'Next' bez 'For'"))
            elif re.match(r"^do\b", head):
                stack.append(("do", number))
            elif re.match(r"^loop\b", head):
                if stack and stack[-1][0] == "do":
                    stack.pop()
                else:
                    problems.append(Problem(path, number, "'Loop' bez 'Do'"))

    for kind, number in stack:
        problems.append(Problem(path, number, f"blok '{kind}' nie zostal domkniety"))


def collect_defined(paths: list[Path]) -> set[str]:
    """Zbiera nazwy zdefiniowane w projekcie (stale, enumy, typy, procedury, moduly)."""
    defined: set[str] = set()
    for path in paths:
        defined.add(path.stem)  # nazwa modulu = codeName arkusza dla plikow .cls
        text = path.read_text(encoding="utf-8")
        for line in text.split("\n"):
            code = strip_code(line)
            m = re.match(
                r"^\s*(?:public|private|global)?\s*const\s+(\w+)", code, re.IGNORECASE
            )
            if m:
                defined.add(m.group(1))
            m = PROC_START.match(code)
            if m:
                defined.add(m.group(1))
            m = re.match(r"^\s*(\w+)\s*=\s*-?\d+\s*$", code)  # pozycja Enum
            if m:
                defined.add(m.group(1))
            m = re.match(
                r"^\s*(?:public|private)?\s*(?:type|enum)\s+(\w+)", code, re.IGNORECASE
            )
            if m:
                defined.add(m.group(1))
    return defined


def check_references(path: Path, defined: set[str], problems: list[Problem]) -> None:
    for number, raw in enumerate(path.read_text(encoding="utf-8").split("\n"), start=1):
        code = strip_code(raw)
        for name in set(TRACKED.findall(code)):
            if name not in defined:
                problems.append(
                    Problem(path, number, f"odwolanie do niezdefiniowanej nazwy '{name}'")
                )


def main(argv: list[str]) -> int:
    root = Path(argv[1] if len(argv) > 1 else "src/vba")
    paths = sorted(list(root.glob("*.bas")) + list(root.glob("*.cls")))
    if not paths:
        print(f"Nie znaleziono zrodel VBA w {root}")
        return 1

    defined = collect_defined(paths)
    problems: list[Problem] = []
    for path in paths:
        check_module(path, defined, problems)
        check_references(path, defined, problems)

    for problem in problems:
        print(problem)

    total = sum(len(p.read_text(encoding="utf-8").split("\n")) for p in paths)
    print(f"\nSprawdzono {len(paths)} modulow, {total} wierszy.")
    if problems:
        print(f"Znaleziono {len(problems)} problem(ow).")
        return 1
    print("Nie znaleziono problemow.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
