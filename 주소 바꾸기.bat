@echo off
rem Ongi Coffee - double-click to run tools\change-domain.ps1
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\change-domain.ps1"
if not defined NOPAUSE pause
