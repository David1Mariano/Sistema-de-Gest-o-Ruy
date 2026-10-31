; Use the official product identity and current-user registry. Repair the same
; shortcuts on upgrades too: electron-builder otherwise preserves deleted links.
!macro customInstall
  ReadRegStr $R0 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ReadRegStr $R1 HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  ${If} $R0 != "$INSTDIR"
    MessageBox MB_OK|MB_ICONSTOP "Registro da instalacao nao confirmado. Preserve os arquivos e solicite diagnostico."
    SetErrorLevel 1
    Abort
  ${EndIf}
  ${If} $R1 != '$\"$INSTDIR\${UNINSTALL_FILENAME}$\" /currentuser'
    MessageBox MB_OK|MB_ICONSTOP "Registro de desinstalacao nao confirmado. Nenhum reparo automatico foi executado."
    SetErrorLevel 1
    Abort
  ${EndIf}
  WriteRegStr HKCU "${UNINSTALL_REGISTRY_KEY}" "InstallLocation" "$INSTDIR"
  SetOutPath "$INSTDIR"
  !insertmacro createMenuDirectory
  ClearErrors
  CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "Nao foi possivel criar o atalho do Menu Iniciar. Os dados foram preservados."
    SetErrorLevel 1
    Abort
  ${EndIf}
  WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${IfNot} ${isNoDesktopShortcut}
    ClearErrors
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "Nao foi possivel criar o atalho da Area de Trabalho. Os dados foram preservados."
      SetErrorLevel 1
      Abort
    ${EndIf}
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${EndIf}
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  DetailPrint "Ruy: registro e atalhos oficiais conferidos. Perfis e dados preservados."
!macroend
