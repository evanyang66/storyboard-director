@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 分镜调度台 · 启动 AI

rem ============================================================
rem  启动 AI 编排：起本地代理 + 打开分镜调度台
rem  需要 Node.js 18+（代理只用内置模块，不用 npm install）
rem ============================================================

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [X] 没找到 Node.js
  echo.
  echo   AI 代理需要 Node.js 18 或更高版本。
  echo   装好后再运行本文件：https://nodejs.org/
  echo.
  pause
  exit /b 1
)

echo.
echo   正在启动 AI 代理...
echo   （会另开一个窗口，那个窗口要一直开着）
echo.

start "分镜调度台 · AI 代理" /D "%~dp0" cmd /k node ai-proxy.js

rem 等代理把端口监听起来，再开页面
timeout /t 2 /nobreak >nul

start "" "%~dp0index.html"
exit
