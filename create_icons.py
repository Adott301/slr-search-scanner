"""
create_icons.py - Tạo icon cho SLR Search Scanner Chrome Extension
Author: Nguyen Tien Dat - SWT301 RBL Group04

Yêu cầu: pip install Pillow
Chạy: python create_icons.py (trong thư mục slr-search-scanner)
"""

try:
    from PIL import Image, ImageDraw
except ImportError:
    print("ERROR: Pillow chưa được cài. Chạy: pip install Pillow")
    exit(1)

import os

# Đảm bảo thư mục icons tồn tại
os.makedirs("icons", exist_ok=True)


def create_icon(size: int, filename: str) -> None:
    """
    Tạo icon hình kính lúp trên nền xanh.
    
    Args:
        size: Kích thước icon (16, 48, 128)
        filename: Tên file output
    """
    # Màu nền chính
    BG_COLOR       = (52, 152, 219, 255)   # #3498db - xanh dương
    WHITE          = (255, 255, 255, 255)
    LINE_COLOR     = (41, 128, 185, 255)    # #2980b9 - xanh nhạt hơn

    img  = Image.new("RGBA", (size, size), BG_COLOR)
    draw = ImageDraw.Draw(img)

    # === Tính toán kích thước dựa trên size ===
    center    = size // 2
    radius    = int(size * 0.28)           # Bán kính vòng tròn kính lúp
    lw        = max(2, size // 14)         # Line width

    # === Vòng tròn kính lúp ===
    cx, cy = center - int(size * 0.06), center - int(size * 0.08)
    draw.ellipse(
        [cx - radius, cy - radius, cx + radius, cy + radius],
        outline=WHITE,
        width=lw
    )

    # === Tay cầm kính lúp ===
    handle_start = (cx + int(radius * 0.72), cy + int(radius * 0.72))
    handle_end   = (size - int(size * 0.1), size - int(size * 0.08))
    draw.line([handle_start, handle_end], fill=WHITE, width=lw)

    # === 3 đường kẻ ngang bên trong kính lúp ===
    if size >= 32:
        inner_margin = int(radius * 0.35)
        line_width_inner = max(1, size // 32)
        for i in range(3):
            y_offset = -int(radius * 0.3) + i * int(radius * 0.35)
            x_left   = cx - radius + inner_margin
            x_right  = cx + radius - inner_margin
            y        = cy + y_offset
            # Chỉ vẽ nếu nằm trong vòng tròn
            if cy - radius < y < cy + radius:
                draw.line(
                    [(x_left, y), (x_right, y)],
                    fill=LINE_COLOR,
                    width=line_width_inner
                )

    img.save(filename, "PNG")
    print(f"✅ Created: {filename} ({size}x{size})")


# Tạo 3 kích thước icon
create_icon(16,  "icons/icon16.png")
create_icon(48,  "icons/icon48.png")
create_icon(128, "icons/icon128.png")

print("\n🎉 Tất cả icon đã được tạo trong thư mục icons/")
print("   Bây giờ bạn có thể load extension vào Chrome!")
