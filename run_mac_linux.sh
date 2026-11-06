#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  echo "Đang cài đặt lần đầu, vui lòng chờ..."
  python3 -m venv .venv
  . .venv/bin/activate
  pip install --upgrade pip >/dev/null
  pip install -r requirements.txt
else
  . .venv/bin/activate
fi
python app.py
