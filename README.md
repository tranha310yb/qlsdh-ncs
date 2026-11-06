# Quản lý NCS – Khoa Giáo dục, ĐHBK Hà Nội

## 👉 Dùng ngay trên web: https://tranha310yb.github.io/qlsdh-ncs/

Phiên bản web nằm trong thư mục `docs/` và chạy trên **GitHub Pages**. Không cần cài đặt, không cần máy chủ: GitHub tự cập nhật trang mỗi khi mã trong `docs/` thay đổi.

- **Dữ liệu không đưa lên GitHub hay bất kỳ máy chủ nào.** Dữ liệu nằm ngay trong trình duyệt (IndexedDB), tắt máy hay đóng trình duyệt cũng không mất.
- **Nên làm:** vào **Dữ liệu → Tạo file dữ liệu mới** (dùng Chrome hoặc Edge). Ứng dụng sẽ tự ghi mọi thay đổi vào một file `.json` trên máy. Đặt file này trong OneDrive hoặc Google Drive để luôn có bản sao, và để mở được trên máy khác (dùng nút **Mở file dữ liệu có sẵn**).
- Mỗi lần mở lại trình duyệt, bấm **Kết nối lại file** một lần để cấp lại quyền ghi.
- Trình duyệt tự giữ bản sao lưu hằng ngày (30 ngày gần nhất). Có thể nhập file Excel theo dõi NCS hiện có và xuất ra Excel.
- Lưu ý: dữ liệu gắn với từng trình duyệt trên từng máy. Muốn dùng chung giữa nhiều người hay nhiều máy, hãy dùng chung file `.json` (ví dụ qua OneDrive), hoặc dùng phiên bản máy chủ bên dưới.

---

## Phiên bản chạy trên máy cá nhân / máy chủ (Python Flask)

Ứng dụng web chạy trên máy cá nhân, dùng để quản lý hồ sơ và theo dõi tiến độ nghiên cứu sinh. Ứng dụng thay cho file Excel “Theo dõi tiến độ NCS”.

- Chạy hoàn toàn trên máy của bạn, không cần Internet hay máy chủ.
- Dữ liệu lưu trong file văn bản `data/db.json`. Tắt máy hoặc khởi động lại **không mất dữ liệu**.
- Mỗi ngày tự sao lưu một bản vào `data/backups/` (giữ 60 bản gần nhất). Mọi thao tác được ghi vào `data/nhat_ky.txt`.
- Nhập dữ liệu từ file Excel hiện có. Xuất toàn bộ hoặc từng danh sách ra Excel.

## Chức năng

| Màn hình | Nội dung |
|---|---|
| **Tổng quan** | Số NCS theo khoá, nhóm, trạng thái. Cảnh báo: quá hạn hoặc sắp hết hạn đào tạo, mốc trễ hạn, chưa nộp báo cáo 6 tháng, hồ sơ thiếu thông tin |
| **Hồ sơ NCS** | Tìm kiếm, lọc theo khoá / nhóm CM / CBHD / trạng thái; thêm, sửa, xoá; tự tính hạn kết thúc (ngày QĐ + thời gian đào tạo, hoặc ngày gia hạn) |
| **Chi tiết NCS** | Thông tin, dòng thời gian các mốc, lịch sử báo cáo 6 tháng; tạo lộ trình mốc chuẩn tự động |
| **Bảng tiến độ** | Mỗi dòng một NCS, mỗi cột một mốc; tô màu đã xong / trễ / dự kiến |
| **Báo cáo 6 tháng** | Chọn kỳ (ví dụ T6/2026), danh sách NCS phải nộp, tích đã nộp, xuất Excel |
| **Hội đồng & thanh toán** | Hoạt động có GV ngoài theo đợt thanh toán (ví dụ 9.2026); đánh dấu đã thanh toán, xuất Excel |
| **Cán bộ hướng dẫn** | Danh mục, số NCS đang hướng dẫn, gộp bản ghi trùng tên |
| **Nhập / Xuất / Sao lưu** | Nhập Excel, xuất Excel, tải file dữ liệu, sao lưu thủ công |
| **Cài đặt** | Lộ trình mốc chuẩn (tên mốc + số tháng sau QĐ), nhóm chuyên môn, trạng thái, số tháng cảnh báo |

## Cài đặt và chạy

**Yêu cầu:** Python 3.10 trở lên ([python.org](https://www.python.org/downloads/)). Trên Windows, nhớ tick **“Add Python to PATH”** khi cài.

### Windows
1. Tải mã nguồn: trên GitHub bấm **Code → Download ZIP**, rồi giải nén. Hoặc dùng `git clone`.
2. Nháy đúp file **`run_windows.bat`**.
   - Lần đầu, ứng dụng tự cài thư viện (khoảng 1 phút).
   - Trình duyệt tự mở địa chỉ http://127.0.0.1:5000.
3. Để dừng ứng dụng: đóng cửa sổ đen, hoặc nhấn `Ctrl+C` trong cửa sổ đó.

### macOS / Linux
```bash
chmod +x run_mac_linux.sh
./run_mac_linux.sh
```

### Chạy thủ công
```bash
pip install -r requirements.txt
python app.py
```

## Lần đầu sử dụng
1. Vào **Nhập / Xuất / Sao lưu**, chọn file Excel theo dõi NCS, bấm **Nhập dữ liệu**.
2. Đọc mục **“Cần kiểm tra lại”** trong kết quả nhập (ví dụ số điện thoại bị ghi nhầm thành ngày sinh).
3. Vào **Cán bộ hướng dẫn** để rà soát: gộp các bản ghi trùng tên, đánh dấu cán bộ ngoài trường.
4. Vào **Cài đặt**, chỉnh **Lộ trình mốc chuẩn** cho khớp quy định đào tạo tiến sĩ hiện hành của Trường.
5. Mở từng NCS, bấm **Tạo lộ trình mốc chuẩn** để sinh hạn dự kiến cho các mốc.

## Quy tắc khi nhập từ Excel
- Dòng nhóm `NCS 2025` được dùng làm **Khoá** của các NCS bên dưới.
- Cột **D–E** (dưới ô “Thanh toán 9.2026”) được chuyển thành các **mốc / hoạt động**:
  - Loại mốc nhận theo từ khoá: Xét tuyển, Tổng quan, Chuyên đề, Seminar nhóm nhỏ, Seminar cấp Khoa.
  - Ngày ở đầu đoạn văn bản được lấy làm ngày thực hiện.
  - Phần sau dấu `:` được lấy làm GV ngoài.
  - Đợt thanh toán được gán là **9.2026**.
- Cột **N** có dấu `x`: được hiểu là **CBHD 2 ngoài trường**.
- Ô có hai email được tách thành email cá nhân và email SIS. Ô CBHD có hai tên được tách thành CBHD 1 và CBHD 2.
- Chữ “Đã bảo vệ” hoặc “hết hạn” ở cột tiến độ được chuyển thành trạng thái tương ứng.
- Có thể nhập lại nhiều lần: NCS trùng Mã NCS sẽ được cập nhật, không bị nhân đôi. Ứng dụng tự sao lưu trước mỗi lần nhập.

## Sao lưu và khôi phục
- Dữ liệu chỉ nằm trong thư mục `data/`. Muốn chuyển sang máy khác, chép cả thư mục này.
- Muốn khôi phục một bản sao lưu:
  1. Tắt ứng dụng.
  2. Chép file `data/backups/db-YYYY-MM-DD.json` đè lên `data/db.json`.
  3. Chạy lại ứng dụng.
- **Bảo mật:** thư mục `data/` và mọi file Excel đã nằm trong `.gitignore`, nên không bị đẩy lên GitHub. Hãy để repository ở chế độ **Private**.

## Đưa lên web (truy cập qua trình duyệt từ bất cứ đâu)

> ⚠️ Dữ liệu NCS là thông tin cá nhân. Khi đưa lên web **bắt buộc đặt mật khẩu** (`QLSDH_PASSWORD`); `wsgi.py` sẽ từ chối chạy nếu thiếu.
> Nên hỏi ý kiến Trường về việc lưu dữ liệu cá nhân trên máy chủ ở nước ngoài; phương án thay thế là cài lên máy chủ của Trường/Khoa.

Khuyến nghị **PythonAnywhere** (gói miễn phí có ổ đĩa lưu bền nên file `data/db.json` không bị xoá; các dịch vụ như Render/Railway gói miễn phí sẽ **mất dữ liệu** mỗi lần khởi động lại).

1. Đăng ký tài khoản miễn phí tại https://www.pythonanywhere.com (gói *Beginner*). Địa chỉ web sẽ là `https://<tên-tài-khoản>.pythonanywhere.com`.
2. Mở **Consoles → Bash**, chạy:
   ```bash
   git clone https://github.com/tranha310yb/qlsdh-ncs.git
   cd qlsdh-ncs
   pip3.10 install --user -r requirements.txt
   ```
   (Repo Private: dùng `git clone https://<tên-github>:<personal-access-token>@github.com/tranha310yb/qlsdh-ncs.git`.)
3. Vào **Web → Add a new web app → Manual configuration → Python 3.10**.
4. Trong mục **Code**, bấm vào file *WSGI configuration file*, xoá hết nội dung và dán:
   ```python
   import os, sys
   os.environ["QLSDH_PASSWORD"] = "ĐẶT-MẬT-KHẨU-MẠNH-Ở-ĐÂY"
   os.environ["QLSDH_HTTPS"] = "1"
   sys.path.insert(0, "/home/<tên-tài-khoản>/qlsdh-ncs")
   from wsgi import application
   ```
5. Mục **Static files**: URL `/static/` → Directory `/home/<tên-tài-khoản>/qlsdh-ncs/static`.
6. Bật **Force HTTPS**, bấm **Reload**. Mở địa chỉ web, đăng nhập bằng mật khẩu vừa đặt, rồi vào **Nhập / Xuất** để nhập file Excel.
7. Gói miễn phí yêu cầu đăng nhập PythonAnywhere và bấm **“Run until 3 months from today”** mỗi 3 tháng để web không bị tạm dừng.

**Cập nhật phiên bản mới** (khi mã trên GitHub thay đổi): Bash console → `cd qlsdh-ncs && git pull` → tab Web bấm **Reload**. Dữ liệu trong `data/` không bị ảnh hưởng.

**Sao lưu dữ liệu trên web**: vào **Nhập / Xuất → Tải file dữ liệu (JSON)** hoặc **Xuất toàn bộ ra Excel** định kỳ về máy.

## Tuỳ chọn nâng cao (biến môi trường)
| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `QLSDH_PASSWORD` | (trống) | Mật khẩu đăng nhập. Trống = không cần đăng nhập (chỉ dùng trên máy cá nhân) |
| `QLSDH_HTTPS` | (trống) | Đặt `1` khi chạy qua HTTPS để cookie đăng nhập an toàn hơn |
| `QLSDH_PORT` | `5000` | Cổng web |
| `QLSDH_HOST` | `127.0.0.1` | Đặt `0.0.0.0` để máy khác trong mạng LAN truy cập được (nhớ đặt mật khẩu) |
| `QLSDH_DATA_DIR` | `./data` | Thư mục lưu dữ liệu, ví dụ đặt trong OneDrive để tự đồng bộ |

## Cấu trúc mã nguồn
```
app.py        # web (Flask): các màn hình, đăng nhập
wsgi.py       # điểm vào khi chạy trên máy chủ web
storage.py    # lưu/đọc data/db.json, sao lưu, nhật ký
logic.py      # tính hạn, chu kỳ báo cáo, cảnh báo, chuẩn hoá ngày
importer.py   # nhập Excel hiện có
exporter.py   # xuất Excel
templates/    # giao diện HTML
static/       # CSS
```
