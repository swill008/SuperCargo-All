; electron-builder NSIS include (electron-builder.yml nsis.include).
;
; Optional desktop shortcut, unticked by default, like Gremlin's installer
; ("Create a desktop shortcut", Flags: unchecked). electron-builder's own desktop
; shortcut handling is off (createDesktopShortcut: false), so only this file
; creates or removes it.
;
; - Setup wizard: a page after the folder page with the checkbox. Re-running
;   setup over an install starts the box at the earlier choice.
; - Silent update (electron-updater runs Setup.exe /S --updated): no page; an
;   existing shortcut is kept and refreshed, a missing one is not recreated.
; - Uninstall: removes the shortcut and the remembered choice. It never touches
;   the user's data folder (%USERPROFILE%\SuperCargo) or Electron's app data.

!define SC_SHORTCUT_KEY "Software\SuperCargo-OtherModes-Installer"

!macro customPageAfterChangeDir
  !include nsDialogs.nsh
  !include LogicLib.nsh

  Var scShortcutBox
  Var scShortcutWanted

  Page custom scShortcutPageCreate scShortcutPageLeave

  Function scShortcutPageCreate
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "Shortcuts" "Choose additional shortcuts."
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateCheckbox} 0 0 100% 12u "Create a desktop shortcut"
    Pop $scShortcutBox
    ReadRegStr $1 HKCU "${SC_SHORTCUT_KEY}" "DesktopShortcut"
    ${If} $1 == "1"
      ${NSD_Check} $scShortcutBox
    ${EndIf}
    nsDialogs::Show
  FunctionEnd

  Function scShortcutPageLeave
    ${NSD_GetState} $scShortcutBox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $scShortcutWanted "1"
    ${Else}
      StrCpy $scShortcutWanted "0"
    ${EndIf}
  FunctionEnd
!macroend

!macro customInstall
  ${If} ${isUpdated}
    ; keep what the user has: refresh an existing shortcut, never add one
    ${If} ${FileExists} "$newDesktopLink"
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    ${EndIf}
  ${Else}
    ; wizard install: the checkbox decides (empty on a silent fresh install = no)
    ${If} $scShortcutWanted == "1"
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
      WriteRegStr HKCU "${SC_SHORTCUT_KEY}" "DesktopShortcut" "1"
    ${Else}
      ${If} ${FileExists} "$newDesktopLink"
        WinShell::UninstShortcut "$newDesktopLink"
        Delete "$newDesktopLink"
      ${EndIf}
      WriteRegStr HKCU "${SC_SHORTCUT_KEY}" "DesktopShortcut" "0"
    ${EndIf}
  ${EndIf}
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  ; the old version's uninstaller runs during an update (--updated): leave the
  ; shortcut and the choice for the new version
  ${IfNot} ${isUpdated}
    StrCpy $0 "$DESKTOP\${SHORTCUT_NAME}.lnk"
    ${If} ${FileExists} "$0"
      WinShell::UninstShortcut "$0"
      Delete "$0"
    ${EndIf}
    DeleteRegKey HKCU "${SC_SHORTCUT_KEY}"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${EndIf}
!macroend
