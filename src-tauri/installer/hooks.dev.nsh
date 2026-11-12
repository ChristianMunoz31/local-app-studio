; Local App Studio Dev installs next to Local App Studio and keeps its own data in $APPDATA\Local App Studio Dev. The Tauri app-data
; folder uses a different name (com.neuralfoundry.localappstudio.dev), so neither the installer nor the uninstaller ever
; touches the Local App Studio Dev data, and nothing here touches Local App Studio or its data in $APPDATA\Local App Studio.
;
; Safety net: the install folder must not be, lie inside, or contain a folder that belongs to Local App Studio or holds
; its data. The folder is normalized first (full path, no trailing backslash, long names), then compared with
; $APPDATA\Local App Studio, $LOCALAPPDATA\Local App Studio, the Local App Studio Dev data folder and the install folder Local App Studio recorded.
; Local App Studio (publisher "Local App Studio", product "Local App Studio", per-user install) records its folder in
; HKCU "Software\Local App Studio\Local App Studio" (default value) and HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Local App Studio"
; (InstallLocation, quoted); see the NSIS template of Tauri 2.12.1.

Var BdIn
Var BdOut
Var BdInst
Var BdTmp
Var BdLen
Var BdHead
Var BdPre
Var BdHit

; In: $BdIn. Out: $BdOut = the folder without surrounding quotes, as a full path, without a trailing backslash.
Function AppDevNormalize
  StrCpy $BdOut $BdIn
  StrCmp $BdIn "" app_dev_norm_done
  ; Registry values such as InstallLocation are quoted.
  StrCpy $BdTmp $BdOut 1
  StrCmp $BdTmp "$\"" 0 app_dev_norm_unquoted
    StrCpy $BdOut $BdOut "" 1
    StrCpy $BdTmp $BdOut 1 -1
    StrCmp $BdTmp "$\"" 0 app_dev_norm_unquoted
      StrCpy $BdOut $BdOut -1
  app_dev_norm_unquoted:
  ClearErrors
  GetFullPathName $BdTmp $BdOut
  IfErrors app_dev_norm_trim
  StrCmp $BdTmp "" app_dev_norm_trim
    StrCpy $BdOut $BdTmp
  app_dev_norm_trim:
  StrCpy $BdTmp $BdOut 1 -1
  StrCmp $BdTmp "\" 0 app_dev_norm_done
    StrCpy $BdOut $BdOut -1
    Goto app_dev_norm_trim
  app_dev_norm_done:
FunctionEnd

; In: $BdIn (a folder to protect, may be empty) and $BdInst (the normalized install folder).
; Out: $BdHit = "1" when the install folder equals, lies inside, or contains it. NSIS compares strings
; case-insensitively with StrCmp.
Function AppDevCheckCandidate
  StrCpy $BdHit ""
  Call AppDevNormalize
  StrCmp $BdOut "" app_dev_check_done
  StrCmp $BdInst "" app_dev_check_done
  StrCmp $BdInst $BdOut app_dev_check_hit
  ; The install folder lies inside the candidate: it starts with "<candidate>\".
  StrLen $BdLen $BdOut
  IntOp $BdLen $BdLen + 1
  StrCpy $BdHead $BdInst $BdLen
  StrCpy $BdPre "$BdOut\"
  StrCmp $BdHead $BdPre app_dev_check_hit
  ; The install folder contains the candidate: the candidate starts with "<install folder>\".
  StrLen $BdLen $BdInst
  IntOp $BdLen $BdLen + 1
  StrCpy $BdHead $BdOut $BdLen
  StrCpy $BdPre "$BdInst\"
  StrCmp $BdHead $BdPre app_dev_check_hit
  Goto app_dev_check_done
  app_dev_check_hit:
    StrCpy $BdHit "1"
  app_dev_check_done:
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  StrCpy $BdIn "$INSTDIR"
  Call AppDevNormalize
  StrCpy $BdInst $BdOut

  StrCpy $BdIn "$APPDATA\Local App Studio Dev"
  Call AppDevCheckCandidate
  StrCmp $BdHit "1" app_dev_refuse
  StrCpy $BdIn "$APPDATA\Local App Studio"
  Call AppDevCheckCandidate
  StrCmp $BdHit "1" app_dev_refuse
  StrCpy $BdIn "$LOCALAPPDATA\Local App Studio"
  Call AppDevCheckCandidate
  StrCmp $BdHit "1" app_dev_refuse
  ReadRegStr $BdIn HKCU "Software\Local App Studio\Local App Studio" ""
  Call AppDevCheckCandidate
  StrCmp $BdHit "1" app_dev_refuse
  ReadRegStr $BdIn HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Local App Studio" "InstallLocation"
  Call AppDevCheckCandidate
  StrCmp $BdHit "1" app_dev_refuse
  Goto app_dev_allowed
  app_dev_refuse:
    MessageBox MB_OK|MB_ICONSTOP "Local App Studio Dev cannot be installed into $INSTDIR, because that folder belongs to Local App Studio or holds Local App Studio data. Choose another folder." /SD IDOK
    Abort
  app_dev_allowed:
  DetailPrint "Your Local App Studio Dev data in $APPDATA\Local App Studio Dev is kept on update and uninstall. Local App Studio and its data are not touched."
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
    ; %APPDATA%\Local App Studio Dev (app.db, backups, secrets.key) is named after the app, never after the identifier,
    ; and is never touched here.
    SetShellVarContext current
    RmDir /r "$LOCALAPPDATA\${BUNDLEID}\logs"
    Delete "$APPDATA\${BUNDLEID}\.window-state.json"
    RmDir "$LOCALAPPDATA\${BUNDLEID}"
    RmDir "$APPDATA\${BUNDLEID}"
    DeleteRegKey HKCU "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty HKCU "${MANUKEY}"
    MessageBox MB_OK|MB_ICONINFORMATION "Your Local App Studio Dev data in $APPDATA\Local App Studio Dev was kept." /SD IDOK
  ${EndIf}
!macroend
