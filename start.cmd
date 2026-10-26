@echo off
chcp 65001 >nul
pushd "%~dp0" || exit /b 1
where node >nul 2>nul
if errorlevel 1 (
  echo 源码启动需要 Node.js。无需安装环境请使用发布包中的 VIAPP 启动器。
  pause
  popd
  exit /b 1
)
node scripts\serve.mjs --open
if errorlevel 1 pause
popd
