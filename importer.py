"""Nhập dữ liệu từ file Excel 'Theo dõi tiến độ NCS' hiện có.

Nhận diện:
- Dòng nhóm 'NCS 2025' -> khoá tuyển sinh.
- Dòng tiêu đề chứa 'Họ tên NCS'.
- Cột D–E (dưới tiêu đề 'Thanh toán ...') -> các hoạt động/mốc cần thanh toán.
- Cột N có 'x' -> đánh dấu CBHD 2 ngoài trường.
Nhập lại nhiều lần được: NCS trùng Mã NCS (hoặc trùng Họ tên + Khoá) sẽ được cập nhật, không nhân đôi.
"""
import re
import openpyxl

import storage
from logic import parse_date, parse_cycle, split_title, title_rank, name_key

HEADER_ALIASES = {
    "stt": "stt",
    "họ tên ncs": "ho_ten",
    "nhóm cm": "nhom_cm",
    "bc 6 tháng": "chu_ky_bc",
    "mã ncs": "ma_ncs",
    "ngày sinh": "ngay_sinh",
    "cơ quan công tác": "co_quan",
    "đề tài": "de_tai",
    "cb hướng dẫn": "cbhd1",
    "cbhd 2": "cbhd2",
    "email": "email",
    "điện thoại": "dien_thoai",
    "số qđ công nhận ncs": "so_qd",
    "ngày qđ công nhận": "ngay_qd",
    "thời gian đào tạo": "thoi_gian",
    "kế hoạch tiếp theo": "ke_hoach",
}


def _s(v):
    if v is None:
        return ""
    return re.sub(r"\s+", " ", str(v).replace("\t", " ")).strip()


def _find_header(ws):
    for r in range(1, min(ws.max_row, 15) + 1):
        vals = [_s(c.value).lower() for c in ws[r]]
        if "họ tên ncs" in vals:
            return r, vals
    raise ValueError("Không tìm thấy dòng tiêu đề có cột 'Họ tên NCS'.")


def _split_people(cell):
    """Tách ô có nhiều cán bộ: 'PGS. TS A, TS B (Viện X)' -> [('PGS.TS','A',''), ('TS','B','Viện X')]."""
    s = _s(cell)
    if not s:
        return []
    chunks = re.split(r"\s*[,;]\s*(?=(?:PGS|GS|TS|ThS)\b)", s)
    out = []
    for ch in chunks:
        unit = ""
        m = re.search(r"\(([^)]*)\)", ch)
        if m:
            unit = m.group(1).strip()
            ch = (ch[:m.start()] + ch[m.end():]).strip()
        title, name = split_title(ch)
        if name:
            out.append((title, name, unit))
    return out


def _supervisor_id(db, title, name, unit, stats):
    key = name_key(name)
    for s in db["supervisors"]:
        if name_key(s.get("ho_ten")) == key:
            if title_rank(title) > title_rank(s.get("hoc_ham_hoc_vi")):
                s["hoc_ham_hoc_vi"] = title
            if unit and not s.get("don_vi"):
                s["don_vi"] = unit
            return s["id"]
    item = storage.upsert(db, "supervisors", {
        "ho_ten": name, "hoc_ham_hoc_vi": title, "don_vi": unit,
        "ngoai_truong": False, "email": "", "dien_thoai": "", "ghi_chu": "",
    })
    stats["supervisors_added"] += 1
    return item["id"]


def _phone(raw, warnings, who):
    s = _s(raw)
    if not s:
        return ""
    if "/" in s or "." in s:
        warnings.append(f"{who}: ô Điện thoại có giá trị '{s}' không giống số điện thoại – đã bỏ trống, ghi vào ghi chú.")
        return None
    digits = re.sub(r"\D", "", s)
    if len(digits) == 9 and not digits.startswith("0"):
        digits = "0" + digits
    return digits


def _emails(raw):
    parts = [p.strip() for p in re.split(r"[;,\s]+", _s(raw)) if "@" in p]
    sis = [p for p in parts if "sis.hust" in p.lower()]
    other = [p for p in parts if p not in sis]
    return (other[0] if other else ""), (sis[0] if sis else ""), other[1:]


MILESTONE_RULES = [
    (r"xét tuyển", "Xét tuyển đầu vào"),
    (r"tổng quan", "Tiểu luận tổng quan"),
    (r"c\.?\s*đề|chuyên đề", "Báo cáo chuyên đề"),
    (r"nhóm nhỏ", "Seminar nhóm nhỏ"),
    (r"cấp khoa", "Seminar cấp Khoa"),
]


def _activity_segment(text, payment_batch, original):
    m = re.match(r"^(\d{1,2}/\d{1,2}/\d{4})\s*", text)
    done = parse_date(m.group(1)) if m else None
    body = text[m.end():] if m else text
    head, reviewer = (body.split(":", 1) + [""])[:2]
    reviewer = reviewer.strip().strip(";.").strip()
    if re.search(r"ko có|không có", reviewer, re.I):
        reviewer = ""
    low = head.lower()
    kinds = [name for pat, name in MILESTONE_RULES if re.search(pat, low)] or ["Hoạt động khác"]
    return [{
        "loai": k,
        "ngay_du_kien": None,
        "ngay_thuc_hien": done,
        "ket_qua": "",
        "nguoi_danh_gia": "",
        "gv_ngoai": reviewer,
        "dot_thanh_toan": payment_batch,
        "da_thanh_toan": False,
        "ghi_chu": f"Nhập từ Excel: {original}",
    } for k in kinds]


def _activity_milestones(text, payment_batch):
    """'29/5/2025 Seminar cấp Khoa: TS. A; 25/3/2025 Seminar nhóm nhỏ: TS. A' -> danh sách mốc."""
    text = _s(text)
    if not text:
        return []
    segments = re.split(r"\s*;\s*|\s+(?=\d{1,2}/\d{1,2}/\d{4}\b)", text)
    out = []
    for seg in segments:
        seg = seg.strip()
        if seg:
            out.extend(_activity_segment(seg, payment_batch, text))
    return out


def import_workbook(path, db):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.worksheets[0]
    header_row, header = _find_header(ws)
    col = {}
    for i, h in enumerate(header):
        if h in HEADER_ALIASES and HEADER_ALIASES[h] not in col:
            col[HEADER_ALIASES[h]] = i
    # Cột không có tiêu đề rõ ràng: D, E (tiến độ / thanh toán), N (dấu x), U (chu kỳ dự phòng)
    col.setdefault("act1", 3)
    col.setdefault("act2", 4)
    col.setdefault("flag_n", 13)
    col.setdefault("cycle_alt", 20)

    payment_batch = ""
    for r in range(1, header_row):
        for c in ws[r]:
            m = re.search(r"thanh toán\s*([\d./]+)", _s(c.value), re.I)
            if m:
                payment_batch = m.group(1).strip(".")

    stats = {"added": 0, "updated": 0, "skipped": 0, "supervisors_added": 0, "milestones_added": 0}
    warnings = []
    khoa = ""

    def g(row, key):
        i = col.get(key)
        return row[i] if i is not None and i < len(row) else None

    for r_idx, row in enumerate(ws.iter_rows(min_row=header_row + 1, values_only=True), header_row + 1):
        first = _s(row[0] if row else "")
        mk = re.match(r"^NCS\s*(\d{4})$", first, re.I)
        if mk:
            khoa = mk.group(1)
            continue
        name = _s(g(row, "ho_ten"))
        if not name:
            continue
        who = f"Dòng {r_idx} ({name})"

        email1, email_sis, extra = _emails(g(row, "email"))
        notes = []
        phone = _phone(g(row, "dien_thoai"), warnings, who)
        if phone is None:
            notes.append(f"SĐT trong file gốc: {_s(g(row, 'dien_thoai'))}")
            phone = ""
        if extra:
            notes.append("Email khác: " + ", ".join(extra))

        tg_raw = g(row, "thoi_gian")
        try:
            thoi_gian = float(str(tg_raw).strip()) if _s(tg_raw) else None
            if thoi_gian is not None and thoi_gian.is_integer():
                thoi_gian = int(thoi_gian)
        except ValueError:
            thoi_gian = None
            notes.append(f"Tiến độ (cột Thời gian đào tạo): {_s(tg_raw)}")

        ke_hoach = _s(g(row, "ke_hoach"))
        status = "Đang đào tạo"
        blob = (" ".join([_s(tg_raw), ke_hoach])).lower()
        if "đã bảo vệ" in blob:
            status = "Đã bảo vệ cấp trường"
        elif "hết hạn" in blob:
            status = "Hết hạn"

        people1 = _split_people(g(row, "cbhd1"))
        people2 = _split_people(g(row, "cbhd2"))
        if len(people1) > 1 and not people2:
            people2 = people1[1:2]
        cbhd1_id = _supervisor_id(db, *people1[0], stats) if people1 else ""
        cbhd2_id = _supervisor_id(db, *people2[0], stats) if people2 else ""
        if not people1:
            warnings.append(f"{who}: chưa có CB hướng dẫn.")

        cycle = parse_cycle(g(row, "chu_ky_bc")) or parse_cycle(g(row, "cycle_alt"))
        ngay_qd = parse_date(g(row, "ngay_qd"))
        if not ngay_qd and _s(g(row, "ngay_qd")):
            warnings.append(f"{who}: không đọc được Ngày QĐ '{_s(g(row, 'ngay_qd'))}'.")
        ngay_sinh = parse_date(g(row, "ngay_sinh"))
        if not ngay_sinh and _s(g(row, "ngay_sinh")):
            warnings.append(f"{who}: không đọc được Ngày sinh '{_s(g(row, 'ngay_sinh'))}'.")

        record = {
            "ma_ncs": _s(g(row, "ma_ncs")),
            "ho_ten": name,
            "khoa": khoa,
            "nhom_cm": _s(g(row, "nhom_cm")),
            "ngay_sinh": ngay_sinh,
            "co_quan": _s(g(row, "co_quan")),
            "de_tai": _s(g(row, "de_tai")),
            "cbhd1_id": cbhd1_id,
            "cbhd2_id": cbhd2_id,
            "cbhd2_ngoai": _s(g(row, "flag_n")).lower() == "x",
            "email_ca_nhan": email1,
            "email_sis": email_sis,
            "dien_thoai": phone,
            "so_qd": _s(g(row, "so_qd")),
            "ngay_qd": ngay_qd,
            "thoi_gian_dao_tao": thoi_gian,
            "gia_han_den": None,
            "chu_ky_bc": cycle,
            "trang_thai": status,
            "ke_hoach": ke_hoach,
            "ghi_chu": "; ".join(notes),
        }

        existing = None
        for s in db["students"]:
            if record["ma_ncs"] and s.get("ma_ncs") == record["ma_ncs"]:
                existing = s
                break
            if not record["ma_ncs"] and name_key(s.get("ho_ten")) == name_key(name) and s.get("khoa") == khoa:
                existing = s
                break
        if existing:
            for k, v in record.items():
                if v not in (None, "", [], False):
                    existing[k] = v
            st = storage.upsert(db, "students", existing)
            stats["updated"] += 1
        else:
            st = storage.upsert(db, "students", record)
            stats["added"] += 1

        for key in ("act1", "act2"):
            for ms in _activity_milestones(g(row, key), payment_batch):
                dup = any(m.get("student_id") == st["id"] and m.get("ghi_chu") == ms["ghi_chu"] and m.get("loai") == ms["loai"]
                          for m in db["milestones"])
                if not dup:
                    ms["student_id"] = st["id"]
                    storage.upsert(db, "milestones", ms)
                    stats["milestones_added"] += 1

    return stats, warnings
