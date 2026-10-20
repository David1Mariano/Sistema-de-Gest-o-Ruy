; Readback only: use electron-builder's single official registration mechanism.
; A missing/wrong registration must not be reported as a successful installation.
!macro customInstall
  ReadRegStr $R0 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ReadRegStr $R1 HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  ${If} $R0 != "$INSTDIR"
    DetailPrint "Ruy: current-user installation registration could not be verified."
    MessageBox MB_OK|MB_ICONSTOP "Registro da instalacao nao confirmado. Preserve os arquivos e solicite diagnostico; nao reinstale automaticamente."
    SetErrorLevel 1
    Abort
  ${EndIf}
  ${If} $R1 != '$\"$INSTDIR\${UNINSTALL_FILENAME}$\" /currentuser'
    DetailPrint "Ruy: current-user uninstaller registration could not be verified."
    MessageBox MB_OK|MB_ICONSTOP "Registro de desinstalacao nao confirmado. Nenhum reparo automatico foi executado."
    SetErrorLevel 1
    Abort
  ${EndIf}
  DetailPrint "Ruy: independent current-user installation and uninstaller verified."
!macroend
