"""Motyw graficzny aplikacji: paleta, czcionki i arkusz stylów Qt."""

from __future__ import annotations

from dataclasses import dataclass

# Stos czcionek: Segoe UI na Windows, sensowne zamienniki gdzie indziej.
RODZINA = "Segoe UI, Inter, Noto Sans, DejaVu Sans, sans-serif"
RODZINA_LICZB = "Consolas, DejaVu Sans Mono, monospace"


@dataclass(frozen=True)
class Paleta:
    nazwa: str
    tlo: str
    powierzchnia: str
    powierzchnia2: str
    powierzchnia3: str
    obramowanie: str
    obramowanie_mocne: str
    tekst: str
    tekst_przygaszony: str
    tekst_slaby: str
    akcent: str
    akcent_ciemny: str
    akcent_jasny: str
    niebieski: str
    ostrzezenie: str
    blad: str
    pasek_boczny: str
    zaznaczenie: str
    cien: str


CIEMNA = Paleta(
    nazwa="ciemny",
    tlo="#0E1621",
    powierzchnia="#16202E",
    powierzchnia2="#1D2938",
    powierzchnia3="#243243",
    obramowanie="#263449",
    obramowanie_mocne="#35475F",
    tekst="#E6EDF5",
    tekst_przygaszony="#9DAFC4",
    tekst_slaby="#6B7C91",
    akcent="#17A67C",
    akcent_ciemny="#0F8463",
    akcent_jasny="#2FC397",
    niebieski="#4C8DF6",
    ostrzezenie="#E0A33E",
    blad="#E5484D",
    pasek_boczny="#0B121B",
    zaznaczenie="#1B3A5C",
    cien="rgba(0, 0, 0, 90)",
)

JASNA = Paleta(
    nazwa="jasny",
    tlo="#F2F5F9",
    powierzchnia="#FFFFFF",
    powierzchnia2="#F7F9FC",
    powierzchnia3="#EDF1F7",
    obramowanie="#DCE3EC",
    obramowanie_mocne="#C2CDDB",
    tekst="#15202E",
    tekst_przygaszony="#4F6076",
    tekst_slaby="#7A8AA0",
    akcent="#0F8463",
    akcent_ciemny="#0B6B50",
    akcent_jasny="#17A67C",
    niebieski="#2C6FD8",
    ostrzezenie="#B57414",
    blad="#C7383C",
    pasek_boczny="#15202E",
    zaznaczenie="#DCE9F8",
    cien="rgba(20, 35, 55, 28)",
)


def paleta(nazwa: str) -> Paleta:
    return JASNA if str(nazwa).strip().lower() == "jasny" else CIEMNA


def arkusz_stylow(p: Paleta) -> str:
    """Zwraca arkusz stylów Qt dla podanej palety."""
    return f"""
* {{
    font-family: {RODZINA};
    font-size: 13px;
    color: {p.tekst};
}}

QWidget#Okno, QStackedWidget {{
    background: {p.tlo};
}}

/* ---------- Pasek boczny ---------- */
QFrame#PasekBoczny {{
    background: {p.pasek_boczny};
    border: none;
}}
QLabel#Marka {{
    font-size: 17px;
    font-weight: 700;
    color: #FFFFFF;
    letter-spacing: 0.4px;
}}
QLabel#Podmarka {{
    font-size: 11px;
    color: {p.tekst_slaby};
}}
QToolButton#Nawigacja {{
    background: transparent;
    border: none;
    border-radius: 9px;
    padding: 10px 14px;
    text-align: left;
    font-size: 13.5px;
    font-weight: 500;
    color: #B9C7D8;
}}
QToolButton#Nawigacja:hover {{
    background: rgba(255, 255, 255, 0.07);
    color: #FFFFFF;
}}
QToolButton#Nawigacja:checked {{
    background: {p.akcent};
    color: #FFFFFF;
    font-weight: 600;
}}
QLabel#StopkaPaska {{
    color: {p.tekst_slaby};
    font-size: 11px;
}}

/* ---------- Pasek górny ---------- */
QFrame#PasekGorny {{
    background: {p.powierzchnia};
    border-bottom: 1px solid {p.obramowanie};
}}
QLabel#TytulWidoku {{
    font-size: 21px;
    font-weight: 700;
}}
QLabel#PodtytulWidoku {{
    font-size: 12px;
    color: {p.tekst_przygaszony};
}}

/* ---------- Karty ---------- */
QFrame#Karta {{
    background: {p.powierzchnia};
    border: 1px solid {p.obramowanie};
    border-radius: 14px;
}}
QFrame#KartaWskaznika {{
    background: {p.powierzchnia};
    border: 1px solid {p.obramowanie};
    border-radius: 14px;
}}
QLabel#EtykietaWskaznika {{
    font-size: 11px;
    font-weight: 600;
    color: {p.tekst_slaby};
    letter-spacing: 0.7px;
}}
QLabel#WartoscWskaznika {{
    font-size: 25px;
    font-weight: 700;
}}
QLabel#JednostkaWskaznika {{
    font-size: 12px;
    color: {p.tekst_przygaszony};
}}
QLabel#NaglowekSekcji {{
    font-size: 11px;
    font-weight: 700;
    color: {p.tekst_slaby};
    letter-spacing: 1.1px;
}}
QLabel#TytulKarty {{
    font-size: 15px;
    font-weight: 600;
}}

/* ---------- Pola formularza ---------- */
QLineEdit, QComboBox, QDateEdit, QDoubleSpinBox, QSpinBox, QPlainTextEdit, QTextEdit {{
    background: {p.powierzchnia2};
    border: 1px solid {p.obramowanie};
    border-radius: 8px;
    padding: 7px 10px;
    min-height: 19px;
    selection-background-color: {p.akcent};
    selection-color: #FFFFFF;
}}
QLineEdit:focus, QComboBox:focus, QDateEdit:focus,
QDoubleSpinBox:focus, QSpinBox:focus, QPlainTextEdit:focus {{
    border: 1px solid {p.akcent};
    background: {p.powierzchnia3};
}}
QLineEdit:disabled, QComboBox:disabled, QDoubleSpinBox:disabled, QDateEdit:disabled {{
    background: {p.tlo};
    color: {p.tekst_slaby};
    border: 1px dashed {p.obramowanie};
}}
QLineEdit[blad="true"], QComboBox[blad="true"], QDateEdit[blad="true"],
QDoubleSpinBox[blad="true"] {{
    border: 1px solid {p.blad};
    background: {p.powierzchnia3};
}}
QLineEdit[wyliczane="true"], QDoubleSpinBox[wyliczane="true"] {{
    background: {p.powierzchnia3};
    color: {p.akcent_jasny};
    font-weight: 600;
}}
QComboBox {{
    min-width: 96px;
}}
QComboBox QAbstractItemView {{
    background: {p.powierzchnia2};
    border: 1px solid {p.obramowanie_mocne};
    border-radius: 8px;
    padding: 4px;
    outline: none;
    selection-background-color: {p.akcent};
    selection-color: #FFFFFF;
}}
QDoubleSpinBox::up-button, QDoubleSpinBox::down-button,
QSpinBox::up-button, QSpinBox::down-button {{
    width: 0px;
    border: none;
}}
QLabel#EtykietaPola {{
    font-size: 12px;
    color: {p.tekst_przygaszony};
    font-weight: 500;
}}
QLabel#EtykietaPolaWymagana {{
    font-size: 12px;
    color: {p.tekst};
    font-weight: 600;
}}
QLabel#PodpowiedzPola {{
    font-size: 11px;
    color: {p.tekst_slaby};
}}

/* ---------- Przyciski ---------- */
QPushButton {{
    background: {p.powierzchnia3};
    border: 1px solid {p.obramowanie_mocne};
    border-radius: 8px;
    padding: 9px 18px;
    font-weight: 600;
}}
QPushButton:hover {{ background: {p.obramowanie}; }}
QPushButton:pressed {{ background: {p.obramowanie_mocne}; }}
QPushButton:disabled {{ color: {p.tekst_slaby}; background: {p.powierzchnia2}; }}

QPushButton#Glowny {{
    background: {p.akcent};
    border: 1px solid {p.akcent};
    color: #FFFFFF;
}}
QPushButton#Glowny:hover {{ background: {p.akcent_jasny}; border-color: {p.akcent_jasny}; }}
QPushButton#Glowny:pressed {{ background: {p.akcent_ciemny}; }}
QPushButton#Glowny:disabled {{ background: {p.obramowanie}; border-color: {p.obramowanie}; color: {p.tekst_slaby}; }}

QPushButton#Niebieski {{
    background: {p.niebieski};
    border: 1px solid {p.niebieski};
    color: #FFFFFF;
}}
QPushButton#Ostrzegawczy {{
    background: transparent;
    border: 1px solid {p.ostrzezenie};
    color: {p.ostrzezenie};
}}
QPushButton#Niebezpieczny {{
    background: transparent;
    border: 1px solid {p.blad};
    color: {p.blad};
}}
QPushButton#Plaski {{
    background: transparent;
    border: none;
    color: {p.tekst_przygaszony};
    padding: 7px 10px;
}}
QPushButton#Plaski:hover {{ color: {p.tekst}; background: {p.powierzchnia2}; }}

/* ---------- Tabele ---------- */
QTableView {{
    background: {p.powierzchnia};
    alternate-background-color: {p.powierzchnia2};
    border: 1px solid {p.obramowanie};
    border-radius: 12px;
    gridline-color: {p.obramowanie};
    selection-background-color: {p.zaznaczenie};
    selection-color: {p.tekst};
    outline: none;
}}
QTableView::item {{ padding: 6px 8px; border: none; }}
QTableView::item:selected {{ background: {p.zaznaczenie}; }}
QHeaderView::section {{
    background: {p.powierzchnia3};
    color: {p.tekst_przygaszony};
    border: none;
    border-right: 1px solid {p.obramowanie};
    border-bottom: 1px solid {p.obramowanie};
    padding: 9px 8px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.4px;
}}
QTableView QTableCornerButton::section {{
    background: {p.powierzchnia3};
    border: none;
}}

/* ---------- Zakładki ---------- */
QTabWidget::pane {{
    border: 1px solid {p.obramowanie};
    border-radius: 12px;
    background: {p.powierzchnia};
    top: -1px;
}}
QTabBar::tab {{
    background: transparent;
    color: {p.tekst_przygaszony};
    padding: 9px 18px;
    margin-right: 4px;
    border-top-left-radius: 9px;
    border-top-right-radius: 9px;
    font-weight: 600;
}}
QTabBar::tab:selected {{
    background: {p.powierzchnia};
    color: {p.tekst};
    border: 1px solid {p.obramowanie};
    border-bottom: 1px solid {p.powierzchnia};
}}
QTabBar::tab:hover:!selected {{ color: {p.tekst}; }}

/* ---------- Paski przewijania ---------- */
QScrollBar:vertical {{
    background: transparent;
    width: 11px;
    margin: 2px;
}}
QScrollBar::handle:vertical {{
    background: {p.obramowanie_mocne};
    border-radius: 5px;
    min-height: 28px;
}}
QScrollBar::handle:vertical:hover {{ background: {p.tekst_slaby}; }}
QScrollBar:horizontal {{
    background: transparent;
    height: 11px;
    margin: 2px;
}}
QScrollBar::handle:horizontal {{
    background: {p.obramowanie_mocne};
    border-radius: 5px;
    min-width: 28px;
}}
QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; width: 0; }}
QScrollBar::add-page, QScrollBar::sub-page {{ background: transparent; }}

/* ---------- Pozostałe ---------- */
QCheckBox {{ spacing: 9px; font-weight: 500; }}
QCheckBox::indicator {{
    width: 19px; height: 19px;
    border-radius: 5px;
    border: 1px solid {p.obramowanie_mocne};
    background: {p.powierzchnia2};
}}
QCheckBox::indicator:checked {{
    background: {p.akcent};
    border-color: {p.akcent};
    image: none;
}}
QFrame#Separator {{ background: {p.obramowanie}; max-height: 1px; border: none; }}
QLabel#Znacznik {{
    border-radius: 9px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 700;
}}
QToolTip {{
    background: {p.powierzchnia3};
    color: {p.tekst};
    border: 1px solid {p.obramowanie_mocne};
    padding: 6px 9px;
    border-radius: 6px;
}}
QStatusBar {{
    background: {p.powierzchnia};
    border-top: 1px solid {p.obramowanie};
    color: {p.tekst_przygaszony};
}}
QMessageBox, QDialog {{ background: {p.tlo}; }}
QProgressBar {{
    background: {p.powierzchnia3};
    border: none;
    border-radius: 4px;
    height: 6px;
    text-align: center;
}}
QProgressBar::chunk {{ background: {p.akcent}; border-radius: 4px; }}
"""
