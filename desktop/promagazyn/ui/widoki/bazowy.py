"""Klasa bazowa widoków aplikacji."""

from __future__ import annotations

from PySide6.QtWidgets import QScrollArea, QVBoxLayout, QWidget

from ...dane.kartoteka import Kartoteka
from ..styl import Paleta


class Widok(QWidget):
    """Wspólna podstawa widoków: dostęp do kartoteki i motywu."""

    tytul = ""
    podtytul = ""

    def __init__(self, kartoteka: Kartoteka, paleta: Paleta, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.kartoteka = kartoteka
        self.paleta = paleta

        self._zewnetrzny = QVBoxLayout(self)
        self._zewnetrzny.setContentsMargins(0, 0, 0, 0)
        self._zewnetrzny.setSpacing(0)

        przewijanie = QScrollArea()
        przewijanie.setWidgetResizable(True)
        przewijanie.setFrameShape(QScrollArea.NoFrame)

        self.zawartosc = QWidget()
        self.uklad = QVBoxLayout(self.zawartosc)
        self.uklad.setContentsMargins(26, 22, 26, 26)
        self.uklad.setSpacing(18)

        przewijanie.setWidget(self.zawartosc)
        self._zewnetrzny.addWidget(przewijanie)

    def odswiez(self) -> None:
        """Wywoływane przy każdym wejściu na widok."""

    def akcje_paska(self) -> list[QWidget]:
        """Przyciski dokładane do paska górnego dla tego widoku."""
        return []
