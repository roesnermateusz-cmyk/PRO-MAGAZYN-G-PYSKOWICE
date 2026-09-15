"""Ikony rysowane wektorowo.

Program nie dołącza plików graficznych - ikony powstają z prymitywów
QPainter, dzięki czemu są ostre w każdej skali DPI, mają kolor zgodny
z motywem i nie zwiększają rozmiaru paczki instalacyjnej.
"""

from __future__ import annotations

from PySide6.QtCore import QRectF, QSize, Qt
from PySide6.QtGui import QColor, QIcon, QPainter, QPainterPath, QPen, QPixmap

SIATKA = 24.0


def _sciezka(nazwa: str) -> list[tuple[str, tuple]]:
    """Definicje ikon w siatce 24x24: linie, prostokąty, okręgi."""
    ikony: dict[str, list[tuple[str, tuple]]] = {
        "pulpit": [
            ("rect", (3, 3, 8, 8, 2)),
            ("rect", (13, 3, 8, 5, 2)),
            ("rect", (13, 10, 8, 11, 2)),
            ("rect", (3, 13, 8, 8, 2)),
        ],
        "plus": [
            ("line", (12, 5, 12, 19)),
            ("line", (5, 12, 19, 12)),
        ],
        "kartoteka": [
            ("line", (4, 6, 20, 6)),
            ("line", (4, 12, 20, 12)),
            ("line", (4, 18, 20, 18)),
            ("dot", (2, 6)),
            ("dot", (2, 12)),
            ("dot", (2, 18)),
        ],
        "magazyn": [
            ("path", ((3, 8), (12, 3), (21, 8), (21, 19), (3, 19), (3, 8))),
            ("line", (3, 8, 21, 8)),
            ("line", (12, 3, 12, 8)),
            ("rect", (9, 12, 6, 7, 1)),
        ],
        "raporty": [
            ("line", (4, 20, 20, 20)),
            ("rect", (5, 12, 3.6, 6, 1)),
            ("rect", (10.2, 7, 3.6, 11, 1)),
            ("rect", (15.4, 4, 3.6, 14, 1)),
        ],
        "historia": [
            ("circle", (12, 12, 8.5)),
            ("line", (12, 7.5, 12, 12)),
            ("line", (12, 12, 15.5, 14)),
        ],
        # Suwaki czytają się w małym rozmiarze lepiej niż koło zębate.
        "ustawienia": [
            ("line", (4, 7, 20, 7)),
            ("line", (4, 12, 20, 12)),
            ("line", (4, 17, 20, 17)),
            ("circle", (9, 7, 2.4)),
            ("circle", (15, 12, 2.4)),
            ("circle", (7.5, 17, 2.4)),
        ],
        "zapisz": [
            ("path", ((4, 4), (16, 4), (20, 8), (20, 20), (4, 20), (4, 4))),
            ("rect", (8, 4, 8, 6, 1)),
            ("rect", (7, 13, 10, 7, 1)),
        ],
        "szukaj": [
            ("circle", (10.5, 10.5, 6.5)),
            ("line", (15.2, 15.2, 20, 20)),
        ],
        "kopia": [
            ("path", ((12, 3), (20, 6), (20, 12), (12, 21), (4, 12), (4, 6), (12, 3))),
            ("path", ((8.5, 12), (11, 14.5), (15.5, 9.5))),
        ],
        "eksport": [
            ("line", (12, 4, 12, 15)),
            ("path", ((8, 11), (12, 15), (16, 11))),
            ("path", ((4, 18), (4, 20), (20, 20), (20, 18))),
        ],
        "import": [
            ("line", (12, 15, 12, 4)),
            ("path", ((8, 8), (12, 4), (16, 8))),
            ("path", ((4, 18), (4, 20), (20, 20), (20, 18))),
        ],
        "blokada": [
            ("rect", (5, 10, 14, 10, 2)),
            ("path", ((8.5, 10), (8.5, 7), (12, 4.5), (15.5, 7), (15.5, 10))),
        ],
        "korekta": [
            ("circle", (12, 12, 8.5)),
            ("line", (8.5, 12, 15.5, 12)),
        ],
        "odswiez": [
            ("arc", (12, 12, 8, 40, 260)),
            ("path", ((17, 4), (18.5, 8.5), (14, 9))),
        ],
        "plik": [
            ("path", ((6, 3), (14, 3), (19, 8), (19, 21), (6, 21), (6, 3))),
            ("path", ((14, 3), (14, 8), (19, 8))),
        ],
        "ostrzezenie": [
            ("path", ((12, 3.5), (21.5, 20), (2.5, 20), (12, 3.5))),
            ("line", (12, 10, 12, 14.5)),
            ("dot", (12, 17.2)),
        ],
    }
    return ikony.get(nazwa, ikony["pulpit"])


def rysuj(nazwa: str, kolor: str, rozmiar: int = 20, grubosc: float = 1.9) -> QPixmap:
    """Rysuje ikonę do mapy pikseli o podanym rozmiarze."""
    skala = 4  # rysujemy w nadpróbkowaniu i skalujemy - ostrzejsze krawędzie
    plotno = QPixmap(rozmiar * skala, rozmiar * skala)
    plotno.fill(Qt.transparent)

    malarz = QPainter(plotno)
    malarz.setRenderHint(QPainter.Antialiasing, True)
    wspolczynnik = (rozmiar * skala) / SIATKA
    malarz.scale(wspolczynnik, wspolczynnik)

    pioro = QPen(QColor(kolor))
    pioro.setWidthF(grubosc)
    pioro.setCapStyle(Qt.RoundCap)
    pioro.setJoinStyle(Qt.RoundJoin)
    malarz.setPen(pioro)
    malarz.setBrush(Qt.NoBrush)

    for rodzaj, dane in _sciezka(nazwa):
        if rodzaj == "line":
            malarz.drawLine(*[float(w) for w in dane])
        elif rodzaj == "rect":
            x, y, szer, wys, promien = dane
            malarz.drawRoundedRect(QRectF(x, y, szer, wys), promien, promien)
        elif rodzaj == "circle":
            x, y, promien = dane
            malarz.drawEllipse(QRectF(x - promien, y - promien, promien * 2, promien * 2))
        elif rodzaj == "path":
            sciezka = QPainterPath()
            sciezka.moveTo(*[float(w) for w in dane[0]])
            for punkt in dane[1:]:
                sciezka.lineTo(*[float(w) for w in punkt])
            malarz.drawPath(sciezka)
        elif rodzaj == "arc":
            x, y, promien, start, rozpietosc = dane
            malarz.drawArc(
                QRectF(x - promien, y - promien, promien * 2, promien * 2),
                int(start * 16),
                int(rozpietosc * 16),
            )
        elif rodzaj == "dot":
            x, y = dane
            malarz.setBrush(QColor(kolor))
            malarz.drawEllipse(QRectF(x - 1.15, y - 1.15, 2.3, 2.3))
            malarz.setBrush(Qt.NoBrush)

    malarz.end()
    return plotno.scaled(
        rozmiar, rozmiar, Qt.KeepAspectRatio, Qt.SmoothTransformation
    )


def ikona(nazwa: str, kolor: str, rozmiar: int = 20, kolor_aktywny: str | None = None) -> QIcon:
    """Zwraca ikonę, opcjonalnie z osobnym kolorem stanu aktywnego."""
    wynik = QIcon()
    wynik.addPixmap(rysuj(nazwa, kolor, rozmiar), QIcon.Normal, QIcon.Off)
    wynik.addPixmap(rysuj(nazwa, kolor_aktywny or kolor, rozmiar), QIcon.Normal, QIcon.On)
    wynik.addPixmap(rysuj(nazwa, kolor_aktywny or kolor, rozmiar), QIcon.Active, QIcon.Off)
    return wynik


def ikona_aplikacji(kolor_tla: str = "#17A67C", rozmiar: int = 256) -> QIcon:
    """Ikona programu: zaokrąglony kwadrat z symbolem magazynu."""
    plotno = QPixmap(rozmiar, rozmiar)
    plotno.fill(Qt.transparent)

    malarz = QPainter(plotno)
    malarz.setRenderHint(QPainter.Antialiasing, True)
    malarz.setPen(Qt.NoPen)
    malarz.setBrush(QColor(kolor_tla))
    malarz.drawRoundedRect(QRectF(0, 0, rozmiar, rozmiar), rozmiar * 0.22, rozmiar * 0.22)

    pioro = QPen(QColor("#FFFFFF"))
    pioro.setWidthF(rozmiar * 0.062)
    pioro.setCapStyle(Qt.RoundCap)
    pioro.setJoinStyle(Qt.RoundJoin)
    malarz.setPen(pioro)
    malarz.setBrush(Qt.NoBrush)

    jednostka = rozmiar / 24.0
    malarz.translate(rozmiar * 0.5, rozmiar * 0.52)
    malarz.scale(jednostka * 0.62, jednostka * 0.62)
    malarz.translate(-12, -12)

    sciezka = QPainterPath()
    sciezka.moveTo(3, 8)
    for punkt in ((12, 3), (21, 8), (21, 19), (3, 19), (3, 8)):
        sciezka.lineTo(*punkt)
    malarz.drawPath(sciezka)
    malarz.drawLine(3, 8, 21, 8)
    malarz.drawRoundedRect(QRectF(9, 12, 6, 7), 1, 1)
    malarz.end()

    return QIcon(plotno)
