#!/usr/bin/env python3
"""Uruchomienie aplikacji PRO-MAGAZYN z katalogu źródeł.

    python3 desktop/uruchom.py [sciezka/do/pliku.xlsx]
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from promagazyn.__main__ import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
