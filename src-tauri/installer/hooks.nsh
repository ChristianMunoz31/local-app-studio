; Local App Studio keeps the user's data in $APPDATA\Local App Studio. The Tauri app-data folder uses a different name
; (com.neuralfoundry.localappstudio), so neither the installer nor the uninstaller ever touches the Local App Studio data.

!macro NSIS_HOOK_PREINSTALL
  StrCmp $INSTDIR "$APPDATA\Local App Studio" 0 +3
    MessageBox MB_OK|MB_ICONSTOP "Local App Studio cannot be installed into $APPDATA\Local App Studio, because that folder holds your Local App Studio data. Choose another folder." /SD IDOK
    Abort
  DetailPrint "Your Local App Studio data in $APPDATA\Local App Studio is kept on update and uninstall."
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !ifndef BUNDLEID
    !error "BUNDLEID is not defined"
  !endif
  !if "${BUNDLEID}" == ""
    !error "BUNDLEID is empty"
  !endif
  ${If} $UpdateMode <> 1
    ; The Tauri template only removes the identifier folders when the "Delete app data" box was ticked. Those folders hold
    ; the WebView2 profile (EBWebView), which is the Studio's browser storage (unsaved drafts, prompt words, pending
    ; settings), so they are never removed wholesale here: a manual upgrade runs this uninstaller without /UPDATE. Only the
    ; shell's own leftovers go (shell log, window state, install-folder key), then each folder only if it is now empty.
    ; %APPDATA%\Local App Studio (app.db, backups, secrets.key) is named after the app, never after the identifier,
    ; and is never touched here.
    SetShellVarContext current
    RmDir /r "$LOCALAPPDATA\${BUNDLEID}\logs"
    Delete "$APPDATA\${BUNDLEID}\.window-state.json"
    RmDir "$LOCALAPPDATA\${BUNDLEID}"
    RmDir "$APPDATA\${BUNDLEID}"
    DeleteRegKey HKCU "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty HKCU "${MANUKEY}"
    MessageBox MB_OK|MB_ICONINFORMATION "Your Local App Studio data in $APPDATA\Local App Studio was kept." /SD IDOK
  ${EndIf}
!macroend
