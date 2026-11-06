"""Điểm vào WSGI khi chạy trên máy chủ web (PythonAnywhere, gunicorn...).

Bắt buộc đặt biến môi trường QLSDH_PASSWORD trước khi đưa lên mạng, ví dụ trong file
WSGI của PythonAnywhere:

    import os, sys
    os.environ["QLSDH_PASSWORD"] = "mat-khau-manh-cua-ban"
    os.environ["QLSDH_HTTPS"] = "1"
    sys.path.insert(0, "/home/<tên-tài-khoản>/qlsdh-ncs")
    from wsgi import application
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import app as application  # noqa: E402

if not os.environ.get("QLSDH_PASSWORD"):
    raise RuntimeError("Chưa đặt mật khẩu QLSDH_PASSWORD – không chạy trên web khi chưa có đăng nhập.")
