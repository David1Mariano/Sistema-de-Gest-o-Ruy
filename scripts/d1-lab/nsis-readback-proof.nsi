Unicode true
!include "LogicLib.nsh"
!define INSTALL_REGISTRY_KEY "Software\RuyPostR3CompileProof"
!define UNINSTALL_REGISTRY_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\RuyPostR3CompileProof"
!define UNINSTALL_FILENAME "Uninstall Ruy compile proof.exe"
!include "..\..\desktop\nsis-current-user-readback.nsh"
Name "Ruy NSIS readback compile proof - not an installer candidate"
OutFile "..\..\artifacts\agente5-i5r4-dev-20261020\nsis-readback-proof.exe"
RequestExecutionLevel user
Section
  !insertmacro customInstall
SectionEnd
