# SLR Search Scanner - Chrome Extension

**SWT301 · Research-Based Learning · RBL Group04 · FA26-W5-11**

> Tool hỗ trợ tự động hóa giai đoạn **Screening** trong Systematic Literature Review, giúp quét toàn bộ kết quả tìm kiếm ACM, chấm điểm liên quan theo tiêu chí IC/EC, và xuất CSV sẵn sàng đưa vào Evidence Table.

---

## 🎯 Tính năng

### Mode 1 – 📄 Single Paper
- Mở trang chi tiết bất kỳ paper trên ACM (`dl.acm.org/doi/...`)
- Bấm **Extract** → tự động điền Title, Authors, Year, Venue, DOI, Abstract
- Chấm điểm IC/EC ngay lập tức → Hiển thị Score và Decision (INCLUDE/EXCLUDE)
- Copy ra CSV một dòng hoặc Markdown
- Lưu vào Storage để export sau

### Mode 2 – 🔍 Search Scanner
- Mở trang search ACM với query của bạn
- Bấm **Scan All Results** → tự động scroll để load hết kết quả (hỗ trợ lazy-load)
- Chấm điểm tất cả paper theo thuật toán scoreRelevance (IC/EC)
- Bảng kết quả có thể **sort theo cột**, **filter** theo năm/điểm/keyword/decision
- Tick chọn paper muốn giữ → **Export Selected CSV** hoặc **Export All CSV**

### Mode 3 – 💾 History
- Xem lại tất cả paper đã lưu bằng nút "💾 Lưu vào Storage"
- Export tổng hợp CSV
- Xóa history khi không cần

---

## ⚙️ Hướng dẫn cài đặt

1. Tải (hoặc clone) thư mục `slr-search-scanner/`
2. Tạo icon (xem phần dưới) nếu chưa có file PNG trong `icons/`
3. Mở Chrome → địa chỉ: `chrome://extensions/`
4. Bật **Developer mode** (góc trên phải)
5. Bấm **Load unpacked** → chọn thư mục `slr-search-scanner/`
6. Icon 🔬 sẽ xuất hiện trên thanh toolbar

---

## 🚀 Hướng dẫn sử dụng

### Single Paper Mode
```
1. Mở: https://dl.acm.org/doi/10.1145/3803437.3805260
2. Click icon extension trên toolbar
3. Tab "📄 Single Paper" → Bấm "🔍 Extract từ trang hiện tại"
4. Metadata tự động điền, Score hiện ra
5. Bấm "📋 Copy CSV" hoặc "💾 Lưu vào Storage"
```

### Search Scanner Mode
```
1. Mở trang search ACM (ví dụ URL dưới)
2. Click icon extension
3. Chuyển sang tab "🔍 Search Scanner"
4. Bấm "🚀 Scan All Results"
5. Đợi 1-3 phút (tùy số lượng kết quả)
6. Dùng bộ lọc để tinh chỉnh
7. Tick paper muốn giữ → "📥 Export Selected CSV"
```

**Sample search URL:**
```
https://dl.acm.org/action/doSearch?AllField=%28%22Defects4J%22+OR+%22Java+test+generation%22%29+AND+%28%22LLM%22+OR+%22ChatGPT%22+OR+%22Claude%22%29+AND+%28%22JUnit%22+OR+%22unit+test%22%29
```

---

## 📊 Thuật toán chấm điểm (scoreRelevance)

| Tiêu chí | Điều kiện | Điểm |
|----------|-----------|------|
| IC-P (Population) | Title/Abstract chứa "Java" hoặc "unit test" | +20 |
| IC-I (Intervention) | Chứa "LLM", "ChatGPT", "Claude", "GPT", "large language model" | +20 |
| IC-C (Comparison) | Chứa "EvoSuite", "comparison", "compare", "benchmark" | +15 |
| IC-O (Outcome) | Chứa "coverage", "compile", "mutation", "executable", "correctness" | +15 |
| IC-T (Time) | Year ≥ 2018 | +10 |
| IC-L (Language) | Title có ký tự Latin (tiếng Anh) | +10 |
| IC-E (Full-text) | DOI tồn tại | +10 |
| **EC-N** | Chứa "survey"/"review" (nhưng không phải SLR) | **-50** |
| **EC-Y** | Year < 2018 | **-100** |

**Decision**: Score ≥ 70 → **INCLUDE** | Score < 70 → **EXCLUDE**

Score được clamp trong khoảng [0, 100].

---

## 📁 Cấu trúc thư mục

```
slr-search-scanner/
├── manifest.json        # Extension config (Manifest V3)
├── popup.html           # UI với 3 tabs
├── popup.js             # Logic: extract, scan, score, export
├── content.js           # Chạy trên trang ACM: extract + scan DOM
├── background.js        # Service worker
├── styles.css           # Styling
├── create_icons.py      # Script Python tạo icon
├── README.md            # File này
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 🎨 Tạo icon

```bash
# Cài Pillow
pip install Pillow

# Chạy script tạo icon
python create_icons.py
```

---

## 📋 Format CSV output

```
paper_id,file_name,title,authors,year,venue,doi,url,source,search_string,abstract,decision,score
S001,1_Unit_Test_Generation_wi.pdf,"Unit Test Generation...",Author A; Author B,2024,ICSE,10.1145/...,https://...,ACM,"search string",,INCLUDE,85
```

---

## 🧪 Test Cases

| Test | URL | Kết quả mong đợi |
|------|-----|-----------------|
| Single Paper | `dl.acm.org/doi/10.1145/3803437.3805260` | Metadata hiện đúng, Score ≥ 0 |
| Search Scanner | URL search ACM với query Defects4J | Table hiện danh sách papers với score |
| Export CSV | Sau khi scan | File CSV tải về máy |

---

## 👤 Tác giả

- **Nguyen Tien Dat** - SWT301 RBL Group04 - FA26
- Đề tài: FA26-W5-11 – *Khả năng tạo bộ kiểm thử JUnit chạy được của ChatGPT và Claude*

---

## 📄 License

MIT License - Sử dụng tự do cho mục đích học thuật.
