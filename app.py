"""Ứng dụng quản lý NCS – Khoa Giáo dục, ĐHBK Hà Nội.

Chạy:  python app.py   ->  mở http://127.0.0.1:5000
"""
import os
import sys
import tempfile
import threading
import webbrowser
from collections import Counter
from datetime import date

import hmac
import secrets
import time
from datetime import timedelta

from flask import (Flask, render_template, request, redirect, url_for, flash,
                   send_file, abort, session)

import storage
import importer
import exporter
from logic import (enrich_student, alerts, fmt_date, parse_date, parse_cycle, cycle_label,
                   add_months, to_date, period_label, student_cycle, due_periods)


def _secret_key():
    if os.environ.get("QLSDH_SECRET"):
        return os.environ["QLSDH_SECRET"]
    os.makedirs(storage.DATA_DIR, exist_ok=True)
    path = os.path.join(storage.DATA_DIR, "secret_key.txt")
    if not os.path.exists(path):
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(secrets.token_hex(32))
    with open(path, encoding="utf-8") as fh:
        return fh.read().strip()


app = Flask(__name__)
app.secret_key = _secret_key()
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(hours=12)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

# Mật khẩu đăng nhập: đặt biến môi trường QLSDH_PASSWORD.
# Không đặt -> không yêu cầu đăng nhập (chỉ nên dùng khi chạy trên máy cá nhân).
PASSWORD = os.environ.get("QLSDH_PASSWORD", "")
if os.environ.get("QLSDH_HTTPS") == "1":
    app.config["SESSION_COOKIE_SECURE"] = True


@app.before_request
def require_login():
    if not PASSWORD or request.endpoint in ("login", "static"):
        return None
    if session.get("auth") != "ok":
        return redirect(url_for("login", next=request.full_path))
    return None


@app.route("/dang-nhap", methods=["GET", "POST"])
def login():
    if not PASSWORD:
        return redirect(url_for("dashboard"))
    if request.method == "POST":
        if hmac.compare_digest(request.form.get("password", "").encode(), PASSWORD.encode()):
            session.clear()
            session["auth"] = "ok"
            session.permanent = True
            storage.log(f"Đăng nhập thành công từ {request.remote_addr}")
            nxt = request.args.get("next") or url_for("dashboard")
            return redirect(nxt if nxt.startswith("/") and not nxt.startswith("//") else url_for("dashboard"))
        storage.log(f"Đăng nhập sai mật khẩu từ {request.remote_addr}")
        time.sleep(1.5)
        flash("Sai mật khẩu.", "error")
    return render_template("login.html")


@app.route("/dang-xuat")
def logout():
    session.clear()
    return redirect(url_for("login"))

app.jinja_env.filters["d"] = fmt_date
app.jinja_env.filters["cycle"] = cycle_label
app.jinja_env.filters["period"] = period_label


@app.context_processor
def inject():
    return {"today": date.today().isoformat(), "sup_name": exporter._sup_name}


def _vn_name_key(name):
    """Sắp xếp theo tên (từ cuối) rồi họ đệm, như thói quen Việt Nam."""
    parts = (name or "").split()
    return [(parts[-1] if parts else "").lower(), (name or "").lower()]


def _form_bool(name):
    return request.form.get(name) in ("on", "1", "true", "x")


# ------------------------------------------------------------------ trang chủ

@app.route("/")
def dashboard():
    db = storage.load()
    settings = db["settings"]
    al = alerts(db)
    active = [s for s in db["students"] if (s.get("trang_thai") or "Đang đào tạo") in settings["active_statuses"]]
    by_status = Counter(s.get("trang_thai") or "Đang đào tạo" for s in db["students"])
    by_khoa = Counter(s.get("khoa") or "?" for s in active)
    by_group = Counter(s.get("nhom_cm") or "Chưa phân nhóm" for s in active)
    unpaid = [m for m in db["milestones"] if m.get("dot_thanh_toan") and not m.get("da_thanh_toan")]
    return render_template("dashboard.html", al=al, total=len(db["students"]), active=len(active),
                           by_status=sorted(by_status.items(), key=lambda x: -x[1]),
                           by_khoa=sorted(by_khoa.items(), reverse=True),
                           by_group=sorted(by_group.items(), key=lambda x: -x[1]),
                           unpaid=len(unpaid), settings=settings,
                           n_sup=len(db["supervisors"]))


# ------------------------------------------------------------------ NCS

@app.route("/ncs")
def student_list():
    db = storage.load()
    q = request.args.get("q", "").strip().lower()
    f_khoa = request.args.get("khoa", "")
    f_nhom = request.args.get("nhom", "")
    f_cbhd = request.args.get("cbhd", "")
    f_tt = request.args.get("tt", "")
    show_all = request.args.get("all") == "1"
    settings = db["settings"]
    items = []
    for st in db["students"]:
        e = enrich_student(db, st)
        if not show_all and not f_tt and not e["active"]:
            continue
        if q and q not in " ".join(str(st.get(k) or "") for k in ("ho_ten", "ma_ncs", "de_tai", "co_quan", "email_ca_nhan", "email_sis")).lower():
            continue
        if f_khoa and st.get("khoa") != f_khoa:
            continue
        if f_nhom and (st.get("nhom_cm") or "") != f_nhom:
            continue
        if f_cbhd and f_cbhd not in (st.get("cbhd1_id"), st.get("cbhd2_id")):
            continue
        if f_tt and (st.get("trang_thai") or "Đang đào tạo") != f_tt:
            continue
        items.append(e)
    items.sort(key=lambda e: (-(int(e.get("khoa")) if str(e.get("khoa") or "").isdigit() else 0), _vn_name_key(e.get("ho_ten"))))
    if request.args.get("export") == "1":
        raw = [storage.get(db, "students", e["id"]) for e in items]
        return send_file(exporter.export_all(db, raw), as_attachment=True,
                         download_name=f"DanhSachNCS_{date.today().isoformat()}.xlsx")
    khoas = sorted({s.get("khoa") for s in db["students"] if s.get("khoa")}, reverse=True)
    sups = sorted(db["supervisors"], key=lambda s: s.get("ho_ten", "").split()[-1:] + [s.get("ho_ten", "")])
    return render_template("students.html", items=items, khoas=khoas, sups=sups, settings=settings,
                           args=request.args, show_all=show_all)


def _student_from_form(existing=None):
    f = request.form
    tg = f.get("thoi_gian_dao_tao", "").strip().replace(",", ".")
    try:
        tg = float(tg) if tg else None
        if tg is not None and tg.is_integer():
            tg = int(tg)
    except ValueError:
        tg = None
    data = dict(existing or {})
    data.update({
        "ma_ncs": f.get("ma_ncs", "").strip(),
        "ho_ten": f.get("ho_ten", "").strip(),
        "khoa": f.get("khoa", "").strip(),
        "nhom_cm": f.get("nhom_cm", "").strip(),
        "ngay_sinh": parse_date(f.get("ngay_sinh")),
        "co_quan": f.get("co_quan", "").strip(),
        "de_tai": f.get("de_tai", "").strip(),
        "cbhd1_id": f.get("cbhd1_id", ""),
        "cbhd2_id": f.get("cbhd2_id", ""),
        "cbhd2_ngoai": _form_bool("cbhd2_ngoai"),
        "email_ca_nhan": f.get("email_ca_nhan", "").strip(),
        "email_sis": f.get("email_sis", "").strip(),
        "dien_thoai": f.get("dien_thoai", "").strip(),
        "so_qd": f.get("so_qd", "").strip(),
        "ngay_qd": parse_date(f.get("ngay_qd")),
        "thoi_gian_dao_tao": tg,
        "gia_han_den": parse_date(f.get("gia_han_den")),
        "chu_ky_bc": [int(m) for m in f.getlist("chu_ky_bc") if m.isdigit()],
        "trang_thai": f.get("trang_thai", "Đang đào tạo"),
        "ke_hoach": f.get("ke_hoach", "").strip(),
        "ghi_chu": f.get("ghi_chu", "").strip(),
    })
    return data


@app.route("/ncs/moi", methods=["GET", "POST"])
@app.route("/ncs/<sid>/sua", methods=["GET", "POST"])
def student_edit(sid=None):
    db = storage.load()
    st = storage.get(db, "students", sid) if sid else None
    if sid and not st:
        abort(404)
    if request.method == "POST":
        data = _student_from_form(st)
        if not data["ho_ten"]:
            flash("Vui lòng nhập Họ tên NCS.", "error")
        elif data["ma_ncs"] and any(s.get("ma_ncs") == data["ma_ncs"] and s["id"] != (sid or "") for s in db["students"]):
            flash(f"Mã NCS {data['ma_ncs']} đã tồn tại.", "error")
        else:
            item = storage.upsert(db, "students", data)
            storage.save(db, f"{'Sửa' if sid else 'Thêm'} NCS: {item['ho_ten']} ({item.get('ma_ncs', '')})")
            if not sid and request.form.get("tao_lo_trinh") and item.get("ngay_qd"):
                n = _generate_milestones(db, item)
                storage.save(db, f"Tạo {n} mốc chuẩn cho {item['ho_ten']}")
            flash("Đã lưu.", "ok")
            return redirect(url_for("student_detail", sid=item["id"]))
        st = data
    sups = sorted(db["supervisors"], key=lambda s: s.get("ho_ten", ""))
    return render_template("student_form.html", st=st or {"trang_thai": "Đang đào tạo", "thoi_gian_dao_tao": 3},
                           sups=sups, settings=db["settings"], is_new=not sid)


@app.route("/ncs/<sid>")
def student_detail(sid):
    db = storage.load()
    st = storage.get(db, "students", sid)
    if not st:
        abort(404)
    e = enrich_student(db, st)
    periods = due_periods(st)
    reps = {r["ky"]: r for r in db["reports"] if r.get("student_id") == sid}
    report_rows = [{"ky": p, "rep": reps.get(p, {})} for p in reversed(periods)]
    return render_template("student_detail.html", e=e, report_rows=report_rows, settings=db["settings"])


@app.route("/ncs/<sid>/xoa", methods=["POST"])
def student_delete(sid):
    db = storage.load()
    st = storage.get(db, "students", sid)
    if st:
        storage.delete(db, "students", sid)
        db["milestones"] = [m for m in db["milestones"] if m.get("student_id") != sid]
        db["reports"] = [r for r in db["reports"] if r.get("student_id") != sid]
        storage.save(db, f"Xoá NCS: {st['ho_ten']} ({st.get('ma_ncs', '')})")
        flash(f"Đã xoá NCS {st['ho_ten']}.", "ok")
    return redirect(url_for("student_list"))


def _generate_milestones(db, st):
    qd = to_date(st.get("ngay_qd"))
    if not qd:
        return 0
    have = {m.get("loai") for m in db["milestones"] if m.get("student_id") == st["id"]}
    n = 0
    for t in db["settings"]["milestone_types"]:
        if t["name"] in have:
            continue
        storage.upsert(db, "milestones", {
            "student_id": st["id"], "loai": t["name"],
            "ngay_du_kien": add_months(qd, int(t.get("offset_months") or 0)).isoformat(),
            "ngay_thuc_hien": None, "ket_qua": "", "nguoi_danh_gia": "", "gv_ngoai": "",
            "dot_thanh_toan": "", "da_thanh_toan": False, "ghi_chu": "",
        })
        n += 1
    return n


@app.route("/ncs/<sid>/tao-lo-trinh", methods=["POST"])
def student_generate(sid):
    db = storage.load()
    st = storage.get(db, "students", sid)
    if not st:
        abort(404)
    if not st.get("ngay_qd"):
        flash("NCS chưa có Ngày QĐ công nhận nên chưa tính được hạn dự kiến.", "error")
    else:
        n = _generate_milestones(db, st)
        storage.save(db, f"Tạo {n} mốc chuẩn cho {st['ho_ten']}")
        flash(f"Đã thêm {n} mốc chuẩn (bỏ qua các mốc đã có).", "ok")
    return redirect(url_for("student_detail", sid=sid))


# ------------------------------------------------------------------ mốc tiến độ

@app.route("/moc/moi", methods=["GET", "POST"])
@app.route("/moc/<mid>/sua", methods=["GET", "POST"])
def milestone_edit(mid=None):
    db = storage.load()
    m = storage.get(db, "milestones", mid) if mid else None
    if mid and not m:
        abort(404)
    sid = (m or {}).get("student_id") or request.values.get("student_id")
    st = storage.get(db, "students", sid)
    if not st:
        abort(404)
    if request.method == "POST":
        f = request.form
        loai = f.get("loai_khac", "").strip() or f.get("loai", "").strip()
        data = dict(m or {})
        data.update({
            "student_id": sid, "loai": loai,
            "ngay_du_kien": parse_date(f.get("ngay_du_kien")),
            "ngay_thuc_hien": parse_date(f.get("ngay_thuc_hien")),
            "ket_qua": f.get("ket_qua", "").strip(),
            "nguoi_danh_gia": f.get("nguoi_danh_gia", "").strip(),
            "gv_ngoai": f.get("gv_ngoai", "").strip(),
            "dot_thanh_toan": f.get("dot_thanh_toan", "").strip(),
            "da_thanh_toan": _form_bool("da_thanh_toan"),
            "ghi_chu": f.get("ghi_chu", "").strip(),
        })
        if not loai:
            flash("Vui lòng chọn hoặc nhập tên mốc.", "error")
        else:
            storage.upsert(db, "milestones", data)
            storage.save(db, f"{'Sửa' if mid else 'Thêm'} mốc '{loai}' – {st['ho_ten']}")
            flash("Đã lưu mốc.", "ok")
            return redirect(request.form.get("next") or url_for("student_detail", sid=sid))
        m = data
    types = [t["name"] for t in db["settings"]["milestone_types"]]
    return render_template("milestone_form.html", m=m or {}, st=st, types=types, is_new=not mid,
                           next=request.values.get("next", ""))


@app.route("/moc/<mid>/xoa", methods=["POST"])
def milestone_delete(mid):
    db = storage.load()
    m = storage.get(db, "milestones", mid)
    if not m:
        abort(404)
    storage.delete(db, "milestones", mid)
    st = storage.get(db, "students", m["student_id"]) or {}
    storage.save(db, f"Xoá mốc '{m.get('loai')}' – {st.get('ho_ten', '')}")
    flash("Đã xoá mốc.", "ok")
    return redirect(request.form.get("next") or url_for("student_detail", sid=m["student_id"]))


@app.route("/moc/<mid>/hoan-thanh", methods=["POST"])
def milestone_done(mid):
    db = storage.load()
    m = storage.get(db, "milestones", mid)
    if not m:
        abort(404)
    m["ngay_thuc_hien"] = parse_date(request.form.get("ngay")) or date.today().isoformat()
    storage.upsert(db, "milestones", m)
    st = storage.get(db, "students", m["student_id"]) or {}
    storage.save(db, f"Đánh dấu hoàn thành mốc '{m.get('loai')}' – {st.get('ho_ten', '')}")
    return redirect(request.form.get("next") or url_for("student_detail", sid=m["student_id"]))


@app.route("/tien-do")
def progress_board():
    """Bảng tổng: mỗi dòng 1 NCS, mỗi cột 1 mốc chuẩn."""
    db = storage.load()
    types = [t["name"] for t in db["settings"]["milestone_types"]]
    f_khoa = request.args.get("khoa", "")
    rows = []
    for st in db["students"]:
        e = enrich_student(db, st)
        if not e["active"] or (f_khoa and st.get("khoa") != f_khoa):
            continue
        cells = {}
        for m in e["milestones"]:
            prev = cells.get(m["loai"])
            if not prev or (m.get("ngay_thuc_hien") and not prev.get("ngay_thuc_hien")):
                cells[m["loai"]] = m
        rows.append((e, cells))
    rows.sort(key=lambda r: (r[0].get("khoa") or "", _vn_name_key(r[0].get("ho_ten"))))
    khoas = sorted({s.get("khoa") for s in db["students"] if s.get("khoa")}, reverse=True)
    return render_template("progress.html", rows=rows, types=types, khoas=khoas, f_khoa=f_khoa)


# ------------------------------------------------------------------ cán bộ hướng dẫn

@app.route("/cbhd")
def supervisor_list():
    db = storage.load()
    settings = db["settings"]
    items = []
    for s in db["supervisors"]:
        hd1 = [x for x in db["students"] if x.get("cbhd1_id") == s["id"]]
        hd2 = [x for x in db["students"] if x.get("cbhd2_id") == s["id"]]
        act = lambda L: sum(1 for x in L if (x.get("trang_thai") or "Đang đào tạo") in settings["active_statuses"])
        items.append({"s": s, "hd1": len(hd1), "hd2": len(hd2), "active": act(hd1) + act(hd2)})
    items.sort(key=lambda i: (-i["active"], i["s"].get("ho_ten", "")))
    return render_template("supervisors.html", items=items)


@app.route("/cbhd/moi", methods=["GET", "POST"])
@app.route("/cbhd/<cid>/sua", methods=["GET", "POST"])
def supervisor_edit(cid=None):
    db = storage.load()
    s = storage.get(db, "supervisors", cid) if cid else None
    if cid and not s:
        abort(404)
    if request.method == "POST":
        f = request.form
        data = dict(s or {})
        data.update({k: f.get(k, "").strip() for k in ("ho_ten", "hoc_ham_hoc_vi", "don_vi", "email", "dien_thoai", "ghi_chu")})
        data["ngoai_truong"] = _form_bool("ngoai_truong")
        if not data["ho_ten"]:
            flash("Vui lòng nhập họ tên.", "error")
        else:
            item = storage.upsert(db, "supervisors", data)
            storage.save(db, f"{'Sửa' if cid else 'Thêm'} cán bộ: {item['ho_ten']}")
            flash("Đã lưu.", "ok")
            return redirect(url_for("supervisor_list"))
        s = data
    students = []
    if cid:
        students = [enrich_student(db, x) for x in db["students"] if cid in (x.get("cbhd1_id"), x.get("cbhd2_id"))]
    return render_template("supervisor_form.html", s=s or {}, is_new=not cid, students=students)


@app.route("/cbhd/<cid>/xoa", methods=["POST"])
def supervisor_delete(cid):
    db = storage.load()
    s = storage.get(db, "supervisors", cid)
    if not s:
        abort(404)
    used = [x["ho_ten"] for x in db["students"] if cid in (x.get("cbhd1_id"), x.get("cbhd2_id"))]
    if used:
        flash(f"Không xoá được: cán bộ đang hướng dẫn {len(used)} NCS ({', '.join(used[:3])}...). "
              "Hãy đổi CBHD của các NCS này trước.", "error")
        return redirect(url_for("supervisor_edit", cid=cid))
    storage.delete(db, "supervisors", cid)
    storage.save(db, f"Xoá cán bộ: {s['ho_ten']}")
    flash("Đã xoá.", "ok")
    return redirect(url_for("supervisor_list"))


@app.route("/cbhd/gop", methods=["POST"])
def supervisor_merge():
    """Gộp 2 bản ghi cán bộ trùng nhau (do nhập Excel ghi tên khác nhau)."""
    db = storage.load()
    keep, drop = request.form.get("keep"), request.form.get("drop")
    a, b = storage.get(db, "supervisors", keep), storage.get(db, "supervisors", drop)
    if not a or not b or keep == drop:
        flash("Chọn 2 cán bộ khác nhau để gộp.", "error")
        return redirect(url_for("supervisor_list"))
    for x in db["students"]:
        if x.get("cbhd1_id") == drop:
            x["cbhd1_id"] = keep
        if x.get("cbhd2_id") == drop:
            x["cbhd2_id"] = keep
    for k in ("hoc_ham_hoc_vi", "don_vi", "email", "dien_thoai"):
        if not a.get(k) and b.get(k):
            a[k] = b[k]
    storage.delete(db, "supervisors", drop)
    storage.save(db, f"Gộp cán bộ '{b['ho_ten']}' vào '{a['ho_ten']}'")
    flash(f"Đã gộp '{b['ho_ten']}' vào '{a['ho_ten']}'.", "ok")
    return redirect(url_for("supervisor_list"))


# ------------------------------------------------------------------ báo cáo 6 tháng

def _default_period():
    t = date.today()
    return f"{t.year}-{t.month:02d}"


@app.route("/bao-cao", methods=["GET", "POST"])
def reports():
    db = storage.load()
    period = request.values.get("ky") or _default_period()
    try:
        y, mth = map(int, period.split("-"))
        pdate = date(y, mth, 1)
    except ValueError:
        abort(400)
    rows = []
    for st in db["students"]:
        e = enrich_student(db, st)
        if not e["active"] or mth not in student_cycle(st):
            continue
        qd = to_date(st.get("ngay_qd"))
        if not qd or date(qd.year, qd.month, 1) >= pdate:
            continue
        rep = next((r for r in db["reports"] if r.get("student_id") == st["id"] and r.get("ky") == period), None)
        rows.append({"st": st, "cbhd1": e["cbhd1"], "rep": rep or {}})
    rows.sort(key=lambda r: (r["st"].get("khoa") or "", r["st"].get("ho_ten") or ""))

    if request.method == "POST":
        changed = 0
        for r in rows:
            sid = r["st"]["id"]
            da_nop = request.form.get(f"nop_{sid}") == "on"
            ngay = parse_date(request.form.get(f"ngay_{sid}"))
            note = request.form.get(f"note_{sid}", "").strip()
            rep = r["rep"]
            if not rep and not da_nop and not note:
                continue
            if rep and rep.get("da_nop") == da_nop and rep.get("ghi_chu", "") == note and rep.get("ngay_nop") == ngay:
                continue
            if da_nop and not ngay:
                ngay = date.today().isoformat()
            storage.upsert(db, "reports", {**rep, "student_id": sid, "ky": period, "da_nop": da_nop,
                                           "ngay_nop": ngay if da_nop else None, "ghi_chu": note})
            changed += 1
        storage.save(db, f"Cập nhật báo cáo 6 tháng kỳ {period_label(period)}: {changed} NCS")
        flash(f"Đã lưu {changed} thay đổi cho kỳ {period_label(period)}.", "ok")
        return redirect(url_for("reports", ky=period))

    if request.args.get("export") == "1":
        return send_file(exporter.export_reports(db, rows, period), as_attachment=True,
                         download_name=f"BaoCao6Thang_{period}.xlsx")
    months = []
    d = add_months(date(date.today().year, date.today().month, 1), 3)
    for _ in range(30):
        months.append(f"{d.year}-{d.month:02d}")
        d = add_months(d, -1)
    done = sum(1 for r in rows if r["rep"].get("da_nop"))
    return render_template("reports.html", rows=rows, period=period, months=months, done=done)


# ------------------------------------------------------------------ thanh toán

@app.route("/thanh-toan", methods=["GET", "POST"])
def payments():
    db = storage.load()
    batches = sorted({m.get("dot_thanh_toan") for m in db["milestones"] if m.get("dot_thanh_toan")},
                     key=lambda b: tuple(reversed([int(x) for x in b.replace("/", ".").split(".") if x.isdigit()])),
                     reverse=True)
    batch = request.values.get("dot", batches[0] if batches else "")
    only_unpaid = request.values.get("chua") == "1"
    ms = [m for m in db["milestones"] if (m.get("dot_thanh_toan") or "") == batch]
    if only_unpaid:
        ms = [m for m in ms if not m.get("da_thanh_toan")]
    stmap = {s["id"]: s for s in db["students"]}
    ms.sort(key=lambda m: (stmap.get(m["student_id"], {}).get("khoa") or "", stmap.get(m["student_id"], {}).get("ho_ten") or ""))

    if request.method == "POST":
        n = 0
        for m in ms:
            paid = request.form.get(f"paid_{m['id']}") == "on"
            if bool(m.get("da_thanh_toan")) != paid:
                m["da_thanh_toan"] = paid
                storage.upsert(db, "milestones", m)
                n += 1
        storage.save(db, f"Cập nhật thanh toán đợt {batch}: {n} mục")
        flash(f"Đã cập nhật {n} mục.", "ok")
        return redirect(url_for("payments", dot=batch, chua=request.values.get("chua", "")))

    if request.args.get("export") == "1":
        return send_file(exporter.export_payments(db, ms, batch), as_attachment=True,
                         download_name=f"ThanhToan_{batch or 'all'}.xlsx")
    return render_template("payments.html", ms=ms, stmap=stmap, batches=batches, batch=batch,
                           only_unpaid=only_unpaid)


# ------------------------------------------------------------------ nhập / xuất

@app.route("/nhap-xuat", methods=["GET", "POST"])
def import_export():
    db = storage.load()
    result = None
    if request.method == "POST":
        f = request.files.get("file")
        if not f or not f.filename.lower().endswith((".xlsx", ".xlsm")):
            flash("Hãy chọn file Excel (.xlsx).", "error")
        else:
            backup = storage.manual_backup() if os.path.exists(storage.DB_FILE) else None
            fd, tmp = tempfile.mkstemp(suffix=".xlsx")
            os.close(fd)
            try:
                f.save(tmp)
                stats, warnings = importer.import_workbook(tmp, db)
                storage.save(db, f"Nhập Excel '{f.filename}': {stats}")
                result = {"stats": stats, "warnings": warnings, "backup": backup, "file": f.filename}
            except Exception as ex:  # noqa: BLE001
                flash(f"Không nhập được file: {ex}", "error")
            finally:
                os.remove(tmp)
    backups = sorted(os.listdir(storage.BACKUP_DIR), reverse=True)[:15] if os.path.isdir(storage.BACKUP_DIR) else []
    return render_template("import_export.html", result=result, backups=backups,
                           counts={k: len(db[k]) for k in storage.COLLECTIONS},
                           data_dir=storage.DATA_DIR)


@app.route("/xuat-excel")
def export_excel():
    db = storage.load()
    return send_file(exporter.export_all(db), as_attachment=True,
                     download_name=f"QLSDH_NCS_{date.today().isoformat()}.xlsx")


@app.route("/sao-luu", methods=["POST"])
def backup_now():
    name = storage.manual_backup()
    flash(f"Đã tạo bản sao lưu {name}.", "ok")
    return redirect(url_for("import_export"))


@app.route("/tai-du-lieu")
def download_db():
    storage.load()
    return send_file(storage.DB_FILE, as_attachment=True, download_name=f"db_{date.today().isoformat()}.json")


# ------------------------------------------------------------------ cài đặt & nhật ký

@app.route("/cai-dat", methods=["GET", "POST"])
def settings_page():
    db = storage.load()
    s = db["settings"]
    if request.method == "POST":
        f = request.form
        lines = lambda key: [x.strip() for x in f.get(key, "").splitlines() if x.strip()]
        types = []
        for line in lines("milestone_types"):
            if "|" in line:
                name, off = line.rsplit("|", 1)
                try:
                    off = int(off.strip())
                except ValueError:
                    off = 0
            else:
                name, off = line, 0
            types.append({"name": name.strip(), "offset_months": off})
        s["groups"] = lines("groups")
        s["statuses"] = lines("statuses") or s["statuses"]
        s["active_statuses"] = [x for x in f.getlist("active_statuses") if x in s["statuses"]]
        s["milestone_types"] = types
        try:
            s["warn_months_before_end"] = int(f.get("warn_months_before_end", 6))
        except ValueError:
            pass
        storage.save(db, "Cập nhật cài đặt")
        flash("Đã lưu cài đặt.", "ok")
        return redirect(url_for("settings_page"))
    return render_template("settings.html", s=s)


@app.route("/nhat-ky")
def log_page():
    lines = []
    if os.path.exists(storage.LOG_FILE):
        with open(storage.LOG_FILE, encoding="utf-8") as fh:
            lines = fh.readlines()[-300:]
    return render_template("log.html", lines=list(reversed(lines)))


@app.errorhandler(404)
def not_found(_):
    return render_template("message.html", title="Không tìm thấy", msg="Bản ghi không tồn tại hoặc đã bị xoá."), 404


def main():
    host = os.environ.get("QLSDH_HOST", "127.0.0.1")
    port = int(os.environ.get("QLSDH_PORT", "5000"))
    storage.load()
    url = f"http://{'127.0.0.1' if host == '0.0.0.0' else host}:{port}"
    print("=" * 60)
    print(" Ứng dụng Quản lý NCS đang chạy tại:", url)
    print(" Dữ liệu lưu ở:", storage.DB_FILE)
    print(" Nhấn Ctrl+C để dừng.")
    print("=" * 60)
    if "--no-browser" not in sys.argv:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    app.run(host=host, port=port, debug=False)


if __name__ == "__main__":
    main()
