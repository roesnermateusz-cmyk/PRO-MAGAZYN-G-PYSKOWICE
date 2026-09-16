; Rozszerzenia instalatora NSIS dla ResInvest ERP.
;
; 1. Tworzy katalog danych wspólny dla wszystkich kont systemu Windows.
; 2. Dodaje regułę zapory dla portu 4000, aby pozostałe stanowiska firmy
;    mogły łączyć się z serwerem przez przeglądarkę.
; 3. Przy deinstalacji usuwa regułę zapory, ale ZACHOWUJE bazę danych
;    i kopie zapasowe - dane firmy nie mogą zniknąć wraz z programem.

!macro customInstall
  ; $COMMONAPPDATA wskazuje na C:\ProgramData
  CreateDirectory "$COMMONAPPDATA\ResInvestERP"
  CreateDirectory "$COMMONAPPDATA\ResInvestERP\attachments"
  CreateDirectory "$COMMONAPPDATA\ResInvestERP\backups"

  DetailPrint "Konfiguracja zapory systemu Windows (port 4000)..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="ResInvest ERP"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="ResInvest ERP" dir=in action=allow protocol=TCP localport=4000 profile=private,domain'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Nie udalo sie dodac reguly zapory. Dodaj ja recznie, jesli z systemu ma korzystac wiecej stanowisk."
  ${EndIf}
!macroend

!macro customUnInstall
  DetailPrint "Usuwanie reguly zapory..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="ResInvest ERP"'
  Pop $0

  ; Dane firmy pozostaja na dysku - informujemy o tym uzytkownika.
  MessageBox MB_ICONINFORMATION|MB_OK "Program zostal usuniety.$\r$\n$\r$\nBaza danych, zalaczniki i kopie zapasowe pozostaly w katalogu:$\r$\n$COMMONAPPDATA\ResInvestERP$\r$\n$\r$\nUsun ten katalog recznie, jesli dane nie sa juz potrzebne."
!macroend
