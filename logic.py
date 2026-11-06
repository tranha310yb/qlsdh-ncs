"""Các phép tính nghiệp vụ: chuẩn hoá ngày, hạn đào tạo, chu kỳ báo cáo, cảnh báo."""
import re
from datetime import date, datetime

# ---------------- ngày tháng ----------------

def parse_date(value):
    """Nhận nhiều kiểu ngày (datetime Excel, 21/02/1981, 01.01.1976, 2021-05-20 ...) -> 'YYYY-MM-DD' hoặc None."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    s = str(value).strip().rstrip(".").strip()
    if not s:
        return None
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        y, mo, d = map(int, m.groups())
    else:
        m = re.match(r"^(\d{1,3})[/.\-](\d{1,2})[/.\-](\d{4})$", s)
        if not m:
            return None
        d, mo, y = map(int, m.groups())
    try:
        return date(y, mo, d).isoformat()
    except ValueError:
        return None


def to_date(iso):
    if not iso:
        return None
    try:
        return date.fromisoformat(iso)
    except (TypeError, ValueError):
        return None


def fmt_date(iso):
    d = to_date(iso) if isinstance(iso, str) else iso
    return d.strftime("%d/%m/%Y") if d else ""


def add_months(d, months):
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    days = [31, 29 if (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else 28,
            31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    return date(y, m, min(d.day, days))


def months_between(a, b):
    """Số tháng (làm tròn xuống) từ a đến b; âm nếu b < a."""
    n = (b.year - a.year) * 12 + (b.month - a.month)
    if b.day < a.day:
        n -= 1
    return n


# ---------------- chu kỳ báo cáo 6 tháng ----------------

def parse_cycle(text):
    """'T6 T12' / 'T10. T4' / 'T3-T9' -> [6, 12] (sắp xếp tăng)."""
    if not text:
        return []
    if isinstance(text, list):
        return sorted({int(x) for x in text if 1 <= int(x) <= 12})
    nums = [int(n) for n in re.findall(r"T\s*(\d{1,2})", str(text), flags=re.I)]
    return sorted({n for n in nums if 1 <= n <= 12})


def cycle_label(months):
    return " – ".join(f"T{m}" for m in months) if months else ""


def student_cycle(st):
    months = parse_cycle(st.get("chu_ky_bc"))
    if months:
        return months
    qd = to_date(st.get("ngay_qd"))
    if qd:
        a = qd.month
        b = (a + 6 - 1) % 12 + 1
        return sorted({a, b})
    return []


def due_periods(st, today=None):
    """Các kỳ báo cáo ('YYYY-MM') đã đến hạn từ khi có QĐ đến hôm nay."""
    today = today or date.today()
    qd = to_date(st.get("ngay_qd"))
    months = student_cycle(st)
    if not qd or not months:
        return []
    out = []
    d = date(qd.year, qd.month, 1)
    d = add_months(d, 1)  # kỳ đầu tiên sau tháng có QĐ
    end = date(today.year, today.month, 1)
    while d <= end:
        if d.month in months:
            out.append(f"{d.year}-{d.month:02d}")
        d = add_months(d, 1)
    return out


def period_label(p):
    y, m = p.split("-")
    return f"T{int(m)}/{y}"


# ---------------- hạn đào tạo ----------------

def end_date(st):
    if st.get("gia_han_den"):
        return to_date(st["gia_han_den"])
    qd = to_date(st.get("ngay_qd"))
    try:
        years = float(st.get("thoi_gian_dao_tao") or 0)
    except (TypeError, ValueError):
        years = 0
    if not qd or years <= 0:
        return None
    return add_months(qd, int(round(years * 12)))


def is_active(st, settings):
    return (st.get("trang_thai") or "Đang đào tạo") in settings.get("active_statuses", [])


# ---------------- tổng hợp cho từng NCS ----------------

def enrich_student(db, st, today=None):
    today = today or date.today()
    settings = db["settings"]
    sup = {s["id"]: s for s in db["supervisors"]}
    e = dict(st)
    e["cbhd1"] = sup.get(st.get("cbhd1_id"))
    e["cbhd2"] = sup.get(st.get("cbhd2_id"))
    ed = end_date(st)
    e["end_date"] = ed.isoformat() if ed else None
    e["months_left"] = months_between(today, ed) if ed else None
    e["active"] = is_active(st, settings)

    ms = [m for m in db["milestones"] if m.get("student_id") == st["id"]]
    ms.sort(key=lambda m: (m.get("ngay_thuc_hien") or m.get("ngay_du_kien") or "9999"))
    e["milestones"] = ms
    e["done_count"] = sum(1 for m in ms if m.get("ngay_thuc_hien"))
    pending = [m for m in ms if not m.get("ngay_thuc_hien")]
    pending.sort(key=lambda m: m.get("ngay_du_kien") or "9999")
    e["next_milestone"] = pending[0] if pending else None
    e["overdue_milestones"] = [m for m in pending if m.get("ngay_du_kien") and to_date(m["ngay_du_kien"]) < today]
    done = [m for m in ms if m.get("ngay_thuc_hien")]
    e["last_milestone"] = max(done, key=lambda m: m["ngay_thuc_hien"]) if done else None

    periods = due_periods(st, today)
    submitted = {r["ky"] for r in db["reports"] if r.get("student_id") == st["id"] and r.get("da_nop")}
    e["cycle"] = student_cycle(st)
    e["last_period"] = periods[-1] if periods else None
    e["last_period_ok"] = (periods[-1] in submitted) if periods else True
    return e


def alerts(db, today=None):
    today = today or date.today()
    settings = db["settings"]
    warn = int(settings.get("warn_months_before_end", 6))
    out = {"expired": [], "ending": [], "overdue": [], "no_report": [], "missing_data": []}
    for st in db["students"]:
        e = enrich_student(db, st, today)
        if not e["active"]:
            continue
        if e["months_left"] is not None:
            if e["months_left"] < 0:
                out["expired"].append(e)
            elif e["months_left"] <= warn:
                out["ending"].append(e)
        if e["overdue_milestones"]:
            out["overdue"].append(e)
        if not e["last_period_ok"]:
            out["no_report"].append(e)
        if not st.get("ngay_qd") or not st.get("ma_ncs") or not st.get("cbhd1_id") or not st.get("thoi_gian_dao_tao"):
            out["missing_data"].append(e)
    out["ending"].sort(key=lambda e: e["months_left"])
    out["expired"].sort(key=lambda e: e["months_left"])
    return out


# ---------------- tên cán bộ ----------------

TITLE_RE = re.compile(
    r"^\s*((PGS|GS|TSKH|TS|ThS|CN|KS)(?![A-Za-zÀ-ỹ])\s*[\.\s]*)+", re.I)


def split_title(fullname):
    """'PGS. TS Lê Hiếu Học' -> ('PGS.TS', 'Lê Hiếu Học')."""
    s = re.sub(r"\s+", " ", str(fullname or "")).strip().strip(",;")
    m = TITLE_RE.match(s)
    if not m:
        return "", s
    raw = m.group(0)
    parts = re.findall(r"PGS|GS|TSKH|TS|ThS|CN|KS", raw, flags=re.I)
    norm = {"gs": "GS", "pgs": "PGS", "tskh": "TSKH", "ts": "TS", "ths": "ThS", "cn": "CN", "ks": "KS"}
    title = ".".join(norm[p.lower()] for p in parts)
    return title, s[len(raw):].strip()


def title_rank(title):
    t = (title or "").upper()
    if t.startswith("GS"):
        return 4
    if t.startswith("PGS"):
        return 3
    if "TS" in t:
        return 2
    return 1 if t else 0


def name_key(name):
    return re.sub(r"\s+", " ", (name or "")).strip().lower()
