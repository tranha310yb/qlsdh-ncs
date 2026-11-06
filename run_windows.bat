@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv (
  echo Dang cai dat lan dau, vui long cho...
  python -m venv .venv || (echo Khong tim thay Python. Hay cai Python 3.10+ tu python.org va tick "Add to PATH". & pause & exit /b 1)
  call .venv\Scripts\activate.bat
  python -m pip install --upgrade pip >nul
  pip install -r requirements.txt || (pause & exit /b 1)
) else (
  call .venv\Scripts\activate.bat
)
python app.py
pause
