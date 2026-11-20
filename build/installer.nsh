; Adds and removes "Ask Exa" in the Explorer right-click menu for folders and files. Per user (HKCU): no administrator rights.
!macro customInstall
  WriteRegStr HKCU "Software\Classes\Directory\shell\AskExa" "" "Ask Exa"
  WriteRegStr HKCU "Software\Classes\Directory\shell\AskExa" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\Directory\shell\AskExa" "MultiSelectModel" "Single"
  WriteRegStr HKCU "Software\Classes\Directory\shell\AskExa\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --ask "%1"'
  WriteRegStr HKCU "Software\Classes\*\shell\AskExa" "" "Ask Exa"
  WriteRegStr HKCU "Software\Classes\*\shell\AskExa" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\*\shell\AskExa" "MultiSelectModel" "Single"
  WriteRegStr HKCU "Software\Classes\*\shell\AskExa\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --ask "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\Directory\shell\AskExa"
  DeleteRegKey HKCU "Software\Classes\*\shell\AskExa"
!macroend
