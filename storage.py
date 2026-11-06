"""Lưu trữ dữ liệu bằng file JSON (văn bản thuần).

- Toàn bộ dữ liệu nằm trong data/db.json -> khởi động lại server không mất dữ liệu.
- Ghi an toàn: ghi ra file tạm rồi thay thế (không bị hỏng file nếu mất điện giữa chừng).
- Mỗi ngày tự sao lưu 1 bản vào data/backups/ (giữ 60 bản gần nhất).
- Mọi thay đổi được ghi nhật ký vào data/nhat_ky.txt.
"""
import json
import os
import shutil
import threading
import uuid
from datetime import datetime, date

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("QLSDH_DATA_DIR", os.path.join(BASE_DIR, "data"))
DB_FILE = os.path.join(DATA_DIR, "db.json")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
LOG_FILE = os.path.join(DATA_DIR, "nhat_ky.txt")
KEEP_BACKUPS = 60

COLLECTIONS = ["students", "supervisors", "milestones", "reports"]

DEFAULT_SETTINGS = {
    "groups": ["QLGD", "PPDH", "CNGD"],
    "statuses": [
        "Đang đào tạo",
        "Gia hạn",
        "Tạm dừng",
        "Đã bảo vệ cấp cơ sở",
        "Đã bảo vệ cấp trường",
        "Hết hạn",
        "Thôi học",
    ],
    # Các trạng thái được coi là "đang theo dõi" (tính cảnh báo)
    "active_statuses": ["Đang đào tạo", "Gia hạn", "Đã bảo vệ cấp cơ sở"],
    # Mốc chuẩn: tên + số tháng kể từ ngày QĐ công nhận (dùng để tạo hạn dự kiến)
    "milestone_types": [
        {"name": "Xét tuyển đầu vào", "offset_months": 0},
        {"name": "Học phần tiến sĩ", "offset_months": 12},
        {"name": "Tiểu luận tổng quan", "offset_months": 12},
        {"name": "Chuyên đề 1", "offset_months": 18},
        {"name": "Chuyên đề 2", "offset_months": 20},
        {"name": "Chuyên đề 3", "offset_months": 24},
        {"name": "Công bố khoa học", "offset_months": 30},
        {"name": "Seminar nhóm nhỏ", "offset_months": 30},
        {"name": "Seminar cấp Khoa", "offset_months": 32},
        {"name": "Bảo vệ cấp cơ sở", "offset_months": 33},
        {"name": "Phản biện độc lập", "offset_months": 34},
        {"name": "Bảo vệ cấp trường", "offset_months": 36},
    ],
    "warn_months_before_end": 6,
}

_lock = threading.RLock()


def _now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def new_id():
    return uuid.uuid4().hex[:10]


def _empty_db():
    db = {c: [] for c in COLLECTIONS}
    db["settings"] = json.loads(json.dumps(DEFAULT_SETTINGS))
    return db


def _ensure_dirs():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(BACKUP_DIR, exist_ok=True)


def load():
    with _lock:
        _ensure_dirs()
        if not os.path.exists(DB_FILE):
            db = _empty_db()
            _write(db)
            return db
        with open(DB_FILE, "r", encoding="utf-8") as f:
            db = json.load(f)
        for c in COLLECTIONS:
            db.setdefault(c, [])
        settings = db.setdefault("settings", {})
        for k, v in DEFAULT_SETTINGS.items():
            settings.setdefault(k, json.loads(json.dumps(v)))
        return db


def _write(db):
    tmp = DB_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2, default=str)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, DB_FILE)


def _daily_backup():
    if not os.path.exists(DB_FILE):
        return
    name = f"db-{date.today().isoformat()}.json"
    target = os.path.join(BACKUP_DIR, name)
    if not os.path.exists(target):
        shutil.copy2(DB_FILE, target)
        files = sorted(f for f in os.listdir(BACKUP_DIR) if f.startswith("db-"))
        for old in files[:-KEEP_BACKUPS]:
            try:
                os.remove(os.path.join(BACKUP_DIR, old))
            except OSError:
                pass


def save(db, message=None):
    with _lock:
        _ensure_dirs()
        _daily_backup()
        _write(db)
        if message:
            log(message)


def log(message):
    _ensure_dirs()
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(f"[{_now()}] {message}\n")


def manual_backup():
    with _lock:
        _ensure_dirs()
        name = f"manual-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
        shutil.copy2(DB_FILE, os.path.join(BACKUP_DIR, name))
        log(f"Sao lưu thủ công: {name}")
        return name


# ---------- tiện ích CRUD ----------

def get(db, coll, item_id):
    for it in db[coll]:
        if it.get("id") == item_id:
            return it
    return None


def upsert(db, coll, item):
    item = dict(item)
    if not item.get("id"):
        item["id"] = new_id()
        item["created_at"] = _now()
        db[coll].append(item)
    else:
        existing = get(db, coll, item["id"])
        if existing is None:
            item["created_at"] = _now()
            db[coll].append(item)
        else:
            existing.update(item)
            item = existing
    item["updated_at"] = _now()
    return item


def delete(db, coll, item_id):
    before = len(db[coll])
    db[coll] = [it for it in db[coll] if it.get("id") != item_id]
    return len(db[coll]) < before
