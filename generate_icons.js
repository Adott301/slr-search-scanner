/**
 * generate_icons.js - Tạo icon PNG cho SLR Search Scanner
 * Chạy bằng Node.js: node generate_icons.js
 * Không cần thư viện ngoài - dùng Canvas API qua @napi-rs/canvas hoặc
 * viết thẳng binary PNG bằng tay.
 *
 * Nếu không có Node.js, mở file generate_icons.html trong trình duyệt.
 */

// Nếu bạn có Node.js với canvas: npm install canvas  rồi chạy node generate_icons.js
// Nếu không, dùng generate_icons.html (đơn giản hơn).

const fs = require('fs');
const path = require('path');

try {
  const { createCanvas } = require('canvas');

  function createIcon(size, outPath) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#3498db';
    ctx.fillRect(0, 0, size, size);

    const cx = size * 0.44;
    const cy = size * 0.42;
    const r  = size * 0.28;
    const lw = Math.max(2, size / 14);

    // Kính lúp (vòng tròn)
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = lw;
    ctx.stroke();

    // Tay cầm
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.72, cy + r * 0.72);
    ctx.lineTo(size * 0.9, size * 0.92);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = lw;
    ctx.stroke();

    // 3 đường kẻ ngang bên trong
    if (size >= 32) {
      ctx.strokeStyle = '#2980b9';
      ctx.lineWidth = Math.max(1, size / 32);
      for (let i = 0; i < 3; i++) {
        const y = cy - r * 0.3 + i * r * 0.35;
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.65, y);
        ctx.lineTo(cx + r * 0.65, y);
        ctx.stroke();
      }
    }

    const buf = canvas.toBuffer('image/png');
    fs.writeFileSync(outPath, buf);
    console.log(`✅ Created: ${outPath}`);
  }

  const iconsDir = path.join(__dirname, 'icons');
  if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir);

  createIcon(16,  path.join(iconsDir, 'icon16.png'));
  createIcon(48,  path.join(iconsDir, 'icon48.png'));
  createIcon(128, path.join(iconsDir, 'icon128.png'));

  console.log('\n🎉 Icon đã tạo xong!');
} catch (e) {
  console.log('Node canvas không có sẵn. Hãy mở generate_icons.html trong trình duyệt.');
}
