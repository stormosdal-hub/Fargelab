@echo off
cd /d "%~dp0"

echo Starter Python-server på http://localhost:8000 ...
start "" http://localhost:8000

python server.py
pause