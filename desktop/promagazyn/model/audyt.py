"""Dziennik zdarzeń - ścieżka audytu systemu."""

from __future__ import annotations

from datetime import datetime

from .operacja import ZdarzenieAudytu


class Dziennik:
    """Rejestr zdarzeń. Wpisy są wyłącznie dopisywane."""

    def __init__(self, zdarzenia: list[ZdarzenieAudytu] | None = None) -> None:
        self.zdarzenia: list[ZdarzenieAudytu] = list(zdarzenia or [])

    def zapisz(
        self,
        zdarzenie: str,
        uzytkownik: str,
        opis: str = "",
        typ_operacji: str = "",
        id_operacji: str = "",
    ) -> ZdarzenieAudytu:
        wpis = ZdarzenieAudytu(
            data=datetime.now(),
            uzytkownik=uzytkownik or "nieznany",
            zdarzenie=zdarzenie.upper(),
            typ_operacji=typ_operacji,
            id_operacji=id_operacji,
            opis=opis,
        )
        self.zdarzenia.append(wpis)
        return wpis

    def ostatnie(self, ile: int = 100) -> list[ZdarzenieAudytu]:
        return list(reversed(self.zdarzenia[-ile:]))

    def __len__(self) -> int:
        return len(self.zdarzenia)
