@echo off
set "CODEX_BRIDGE_CODEX_EXE=C:\Users\15842\.codex\.sandbox-bin\codex.exe"
set "CODEX_BRIDGE_CODEX_HOME=C:\Users\15842\.codex"
set "CODEX_BRIDGE_CWD=D:\openclaw"
set "CODEX_BRIDGE_SANDBOX=workspace-write"
node "%~dp0server.mjs"
