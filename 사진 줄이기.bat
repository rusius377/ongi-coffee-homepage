@echo off
rem Ongi Coffee - double-click to run tools\resize-images.ps1
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\resize-images.ps1"
if not defined NOPAUSE pause
