"""Przeliczniki jednostek miary.

Poprawka względem arkusza w wersji 1.x: metry sześcienne przeliczane są
na tony przez metry przestrzenne (M3 → MP → tony), a nie tak, jakby
1 m3 równał się 1 MP.
"""

from __future__ import annotations

from .ustawienia import Ustawienia


def na_mp(volumen: float, jednostka: str, ust: Ustawienia) -> float:
    """Sprowadza dowolną jednostkę do metrów przestrzennych."""
    j = (jednostka or "").strip().upper()
    if not volumen:
        return 0.0
    if "MP" in j:
        return volumen
    if "TON" in j or j == "T":
        return volumen / ust.mp_na_tone
    if "M3" in j:
        return volumen * ust.m3_na_mp
    if "GJ" in j:
        return volumen / ust.gj_na_tone / ust.mp_na_tone
    return volumen


def na_tony(volumen: float, jednostka: str, ust: Ustawienia) -> float:
    """Sprowadza dowolną jednostkę do ton."""
    j = (jednostka or "").strip().upper()
    if not volumen:
        return 0.0
    if "TON" in j or j == "T":
        return volumen
    if "GJ" in j:
        return volumen / ust.gj_na_tone
    return na_mp(volumen, jednostka, ust) * ust.mp_na_tone


def na_gj(volumen: float, jednostka: str, ust: Ustawienia) -> float:
    return na_tony(volumen, jednostka, ust) * ust.gj_na_tone
