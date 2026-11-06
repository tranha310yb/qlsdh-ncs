"""Xuất dữ liệu ra file Excel."""
from io import BytesIO
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

from logic import enrich_student, fmt_date, cycle_label

HEAD_FILL = PatternFill("solid", fgColor="1F4E79")
HEAD_FONT = Font(bold=True, color="FFFFFF")


def _sheet(wb, title, headers, rows, widths=None):
    ws = wb.create_sheet(title)
    ws.append(headers)
    for c in ws[1]:
        c.fill = HEAD_FILL
        c.font = HEAD_FONT
        c.alignment = Alignment(wrap_text=True, vertical="center")
    for r in rows:
        ws.append(r)
    for i, h in enumerate(headers, 1):
        w = (widths or {}).get(h, max(12, min(45, len(h) + 4)))
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    return ws


def _sup_name(s):
    if not s:
        return ""
    return f"{s.get('hoc_ham_hoc_vi', '')} {s.get('ho_ten', '')}".strip()


def student_rows(db, students):
    rows = []
    for st in students:
        e = enrich_student(db, st)
        nm = e["next_milestone"]
        rows.append([
            e.get("khoa"), e.get("ma_ncs"), e.get("ho_ten"), fmt_date(e.get("ngay_sinh")), e.get("nhom_cm"),
            e.get("co_quan"), e.get("de_tai"), _sup_name(e["cbhd1"]), _sup_name(e["cbhd2"]),
            "x" if e.get("cbhd2_ngoai") else "", e.get("email_ca_nhan"), e.get("email_sis"), e.get("dien_thoai"),
            e.get("so_qd"), fmt_date(e.get("ngay_qd")), e.get("thoi_gian_dao_tao"), fmt_date(e.get("end_date")),
            e.get("months_left"), cycle_label(e["cycle"]), e.get("trang_thai"),
            e["last_milestone"]["loai"] if e["last_milestone"] else "",
            (f"{nm['loai']} ({fmt_date(nm.get('ngay_du_kien'))})" if nm else ""),
            e.get("ke_hoach"), e.get("ghi_chu"),
        ])
    return rows


STUDENT_HEADERS = ["Khoá", "Mã NCS", "Họ tên", "Ngày sinh", "Nhóm CM", "Cơ quan công tác", "Đề tài",
                   "CBHD 1", "CBHD 2", "CBHD2 ngoài trường", "Email cá nhân", "Email SIS", "Điện thoại",
                   "Số QĐ công nhận", "Ngày QĐ", "Thời gian ĐT (năm)", "Hạn kết thúc", "Số tháng còn lại",
                   "Chu kỳ BC 6 tháng", "Trạng thái", "Mốc gần nhất đã xong", "Mốc tiếp theo",
                   "Kế hoạch tiếp theo", "Ghi chú"]
STUDENT_WIDTHS = {"Họ tên": 24, "Đề tài": 50, "Cơ quan công tác": 30, "CBHD 1": 26, "CBHD 2": 26,
                  "Email cá nhân": 28, "Email SIS": 30, "Ghi chú": 40, "Kế hoạch tiếp theo": 30, "Mốc tiếp theo": 28}


def milestone_rows(db, milestones):
    st = {s["id"]: s for s in db["students"]}
    rows = []
    for m in milestones:
        s = st.get(m.get("student_id"), {})
        rows.append([s.get("ma_ncs"), s.get("ho_ten"), s.get("khoa"), m.get("loai"),
                     fmt_date(m.get("ngay_du_kien")), fmt_date(m.get("ngay_thuc_hien")), m.get("ket_qua"),
                     m.get("nguoi_danh_gia"), m.get("gv_ngoai"), m.get("dot_thanh_toan"),
                     "Đã TT" if m.get("da_thanh_toan") else "", m.get("ghi_chu")])
    return rows


MILESTONE_HEADERS = ["Mã NCS", "Họ tên NCS", "Khoá", "Mốc / hoạt động", "Hạn dự kiến", "Ngày thực hiện",
                     "Kết quả", "Hội đồng / người đánh giá", "GV ngoài trường", "Đợt thanh toán",
                     "Thanh toán", "Ghi chú"]
MILESTONE_WIDTHS = {"Họ tên NCS": 24, "Mốc / hoạt động": 24, "Hội đồng / người đánh giá": 30,
                    "GV ngoài trường": 32, "Ghi chú": 45}


def export_all(db, students=None):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    students = students if students is not None else db["students"]
    _sheet(wb, "NCS", STUDENT_HEADERS, student_rows(db, students), STUDENT_WIDTHS)
    ids = {s["id"] for s in students}
    ms = [m for m in db["milestones"] if m.get("student_id") in ids]
    _sheet(wb, "Mốc tiến độ", MILESTONE_HEADERS, milestone_rows(db, ms), MILESTONE_WIDTHS)
    sup_rows = []
    for s in db["supervisors"]:
        n1 = sum(1 for x in db["students"] if x.get("cbhd1_id") == s["id"])
        n2 = sum(1 for x in db["students"] if x.get("cbhd2_id") == s["id"])
        sup_rows.append([s.get("hoc_ham_hoc_vi"), s.get("ho_ten"), s.get("don_vi"),
                         "Ngoài trường" if s.get("ngoai_truong") else "Trong trường",
                         s.get("email"), s.get("dien_thoai"), n1, n2])
    _sheet(wb, "Cán bộ hướng dẫn", ["Học hàm/học vị", "Họ tên", "Đơn vị", "Trong/ngoài trường",
                                    "Email", "Điện thoại", "Số NCS (HD1)", "Số NCS (HD2)"], sup_rows,
           {"Họ tên": 26, "Đơn vị": 30, "Email": 28})
    return _to_bytes(wb)


def export_payments(db, milestones, batch):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    _sheet(wb, f"Thanh toán {batch}"[:31] if batch else "Thanh toán", MILESTONE_HEADERS,
           milestone_rows(db, milestones), MILESTONE_WIDTHS)
    return _to_bytes(wb)


def export_reports(db, rows, period):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    _sheet(wb, f"BC 6 thang {period}", ["Mã NCS", "Họ tên", "Khoá", "CBHD 1", "Đã nộp", "Ngày nộp", "Ghi chú"],
           [[r["st"].get("ma_ncs"), r["st"].get("ho_ten"), r["st"].get("khoa"), _sup_name(r["cbhd1"]),
             "x" if r["rep"].get("da_nop") else "", fmt_date(r["rep"].get("ngay_nop")), r["rep"].get("ghi_chu")]
            for r in rows], {"Họ tên": 24, "CBHD 1": 26, "Ghi chú": 40})
    return _to_bytes(wb)


def _to_bytes(wb):
    bio = BytesIO()
    wb.save(bio)
    bio.seek(0)
    return bio
