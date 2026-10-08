// popup.js - SLR Search Scanner Popup Logic
// Author: Nguyen Tien Dat - SWT301 RBL Group04

'use strict';

// ============================================================
// GLOBALS
// ============================================================

/** Lưu toàn bộ kết quả scan gốc (chưa filter) */
let allScanResults = [];

/** Kết quả đang hiển thị trong bảng (sau filter) */
let displayedResults = [];

/** Sort state */
let sortState = { col: 'score', dir: 'desc' };

/** Flag chặn double-click scan */
let scanInProgress = false;

/** Hook được initSearchScanner gán; gọi khi content script ghi scanResults */
let onScanFinished = null;

// ============================================================
// REAL-TIME PROGRESS via chrome.storage.onChanged
// ============================================================

/**
 * Lắng nghe thay đổi scanProgress từ content script.
 * Content script ghi vào storage; popup cập nhật progress bar.
 */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  // Kết quả cuối cùng do content script ghi vào storage
  if (changes.scanResults && changes.scanResults.newValue &&
      typeof onScanFinished === 'function') {
    onScanFinished(changes.scanResults.newValue);
  }

  if (!changes.scanProgress) return;
  const p = changes.scanProgress.newValue;
  if (!p) return;

  const label   = document.getElementById('progress-label');
  const bar     = document.getElementById('progress-bar');
  const sub     = document.getElementById('progress-sub');
  const detail  = document.getElementById('progress-page-detail');
  if (!label || !bar) return;

  const pct = p.totalPages > 0 ? Math.round((p.currentPage / p.totalPages) * 100) : 0;
  bar.style.width = `${Math.min(pct, 99)}%`; // 99 – không đến 100 cho đến khi done
  label.textContent = `Đang quét... Trang ${p.currentPage}/${p.totalPages} — ${p.papersFound} papers`;

  if (p.status === 'scanning') {
    sub.textContent = `Đang scroll trang ${p.currentPage} để load lazy content...`;
  } else if (p.status === 'extracted') {
    sub.textContent = `Đã extract trang ${p.currentPage}. ${p.papersFound} papers tích lũy.`;
  } else if (p.status === 'done') {
    bar.style.width = '100%';
    label.textContent = `✅ Hoàn tất! ${p.papersFound} papers được quét.`;
    sub.textContent   = 'Đang chấm điểm IC/EC và hiển thị kết quả...';
  }

  if (detail) {
    detail.textContent = p.totalPages > 1
      ? `📄 Trang ${p.currentPage} / ${p.totalPages}  ·  🔎 Papers tích lũy: ${p.papersFound}`
      : '';
  }
});



// ============================================================
// HELPERS
// ============================================================

/**
 * Tạo paper ID dạng S001, S002...
 * @param {number} index - 0-based index
 * @param {string} [prefix='S'] - tiền tố
 */
function generatePaperId(index, prefix = 'S') {
  return prefix + String(index + 1).padStart(3, '0');
}

/**
 * Tạo tên file từ metadata
 * @param {Object} metadata
 * @param {number} index - 1-based
 */
function generateFileName(metadata, index) {
  const safeTitle = (metadata.title || 'unknown')
    .substring(0, 30)
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return `${index}_${safeTitle}.pdf`;
}

/**
 * Chấm điểm mức độ liên quan (logic giống content.js, chạy ở popup context)
 * @param {Object} metadata
 * @returns {{ score: number, decision: string, matchedCriteria: string[] }}
 */
function scoreRelevance(metadata) {
  let score = 0;
  const matchedCriteria = [];
  const titleLower = (metadata.title || '').toLowerCase();
  const abstractLower = (metadata.abstract || '').toLowerCase();
  const combined = titleLower + ' ' + abstractLower;
  const year = parseInt(metadata.year) || 0;

  // IC-P: Java / unit test
  if (combined.includes('java') || combined.includes('unit test') || combined.includes('unit testing')) {
    score += 20;
    matchedCriteria.push('IC-P: Java/unit test (+20)');
  }
  // IC-I: LLM / ChatGPT / Claude / GPT
  if (combined.includes('llm') || combined.includes('chatgpt') || combined.includes('claude') ||
      combined.includes('large language model') || combined.includes('gpt')) {
    score += 20;
    matchedCriteria.push('IC-I: LLM/ChatGPT/Claude (+20)');
  }
  // IC-C: EvoSuite / comparison
  if (combined.includes('evosuite') || combined.includes('comparison') ||
      combined.includes('compare') || combined.includes('versus') || combined.includes('benchmark')) {
    score += 15;
    matchedCriteria.push('IC-C: Comparison/EvoSuite (+15)');
  }
  // IC-O: coverage / compile / mutation / executable
  if (combined.includes('coverage') || combined.includes('compile') || combined.includes('compilation') ||
      combined.includes('mutation') || combined.includes('success rate') ||
      combined.includes('executable') || combined.includes('correctness')) {
    score += 15;
    matchedCriteria.push('IC-O: Coverage/compile/executable (+15)');
  }
  // IC-T: Year >= 2018
  if (year >= 2018) {
    score += 10;
    matchedCriteria.push(`IC-T: Year ${year} >= 2018 (+10)`);
  }
  // IC-L: Latin characters
  if (/[a-zA-Z]/.test(metadata.title || '')) {
    score += 10;
    matchedCriteria.push('IC-L: English/Latin (+10)');
  }
  // IC-E: DOI available
  if (metadata.doi && metadata.doi.trim() !== '') {
    score += 10;
    matchedCriteria.push('IC-E: DOI available (+10)');
  }
  // EC-N: survey / review (not SLR)
  const isSurveyOrReview =
    (combined.includes('survey') || combined.includes('review')) &&
    !combined.includes('systematic literature review');
  if (isSurveyOrReview) {
    score -= 50;
    matchedCriteria.push('EC-N: Survey/review → -50');
  }
  // EC-Y: Year < 2018
  if (year > 0 && year < 2018) {
    score -= 100;
    matchedCriteria.push(`EC-Y: Year ${year} < 2018 → -100`);
  }

  score = Math.max(0, Math.min(100, score));
  const decision = score >= 70 ? 'INCLUDE' : 'EXCLUDE';
  return { score, decision, matchedCriteria };
}

/**
 * Tạo nội dung CSV từ mảng papers (với header)
 * @param {Array} papers - mảng { metadata, scored, id }
 * @param {string} searchString
 * @returns {string} CSV string
 */
function buildCSV(papers, searchString = '') {
  const safeStr = (str) => {
    const s = String(str || '').replace(/"/g, '""');
    return `"${s}"`;
  };

  const header = 'paper_id,file_name,title,authors,year,venue,doi,url,source,search_string,abstract,decision,score';
  const rows = papers.map((item, idx) => {
    const m = item.metadata;
    const s = item.scored;
    const fileName = generateFileName(m, idx + 1);
    return [
      safeStr(item.id || generatePaperId(idx)),
      safeStr(fileName),
      safeStr(m.title),
      safeStr(m.authors),
      safeStr(m.year),
      safeStr(m.venue),
      safeStr(m.doi),
      safeStr(m.url),
      safeStr(m.source || 'ACM'),
      safeStr(searchString),
      safeStr(m.abstract),
      safeStr(s ? s.decision : ''),
      safeStr(s ? s.score : '')
    ].join(',');
  });

  return header + '\n' + rows.join('\n');
}

/**
 * Download chuỗi nội dung dạng file
 * @param {string} content
 * @param {string} filename
 * @param {string} mimeType
 */
function downloadFile(content, filename, mimeType = 'text/csv;charset=utf-8;') {
  const blob = new Blob(['\uFEFF' + content], { type: mimeType }); // BOM for Excel UTF-8
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Copy text vào clipboard
 * @param {string} text
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'absolute';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    return true;
  }
}

/**
 * Hiển thị thông báo trạng thái
 * @param {string} id - id của element status
 * @param {string} msg
 * @param {'success'|'error'|'info'} type
 */
function showStatus(id, msg, type = 'info') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `status-msg ${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

/**
 * Lấy score class cho màu sắc
 * @param {number} score
 */
function getScoreClass(score) {
  if (score >= 70) return 'score-high';
  if (score >= 40) return 'score-mid';
  return 'score-low';
}

// ============================================================
// TAB SWITCHING
// ============================================================

function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;

      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.add('hidden'));

      btn.classList.add('active');
      document.getElementById(target)?.classList.remove('hidden');

      // Load history khi chuyển sang tab history
      if (target === 'tab-history') {
        loadHistory();
      }
    });
  });
}

// ============================================================
// TAB 1: SINGLE PAPER
// ============================================================

function initSinglePaper() {
  const extractBtn   = document.getElementById('extract-btn');
  const copyCsvBtn   = document.getElementById('copy-csv-btn');
  const copyMdBtn    = document.getElementById('copy-md-btn');
  const saveBtn      = document.getElementById('save-btn');
  const singleResult = document.getElementById('single-result');

  let currentMetadata = null;

  // ---- Extract ----
  extractBtn.addEventListener('click', async () => {
    extractBtn.disabled = true;
    extractBtn.textContent = '⏳ Đang extract...';
    showStatus('extract-status', 'Đang lấy metadata...', 'info');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Inject content script nếu chưa có (cho các trang match)
      let response;
      try {
        response = await chrome.tabs.sendMessage(tab.id, { action: 'extractSingle' });
      } catch {
        // Content script chưa load → inject thủ công
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        await new Promise(r => setTimeout(r, 500));
        response = await chrome.tabs.sendMessage(tab.id, { action: 'extractSingle' });
      }

      if (!response || !response.success) {
        throw new Error(response?.error || 'Không thể extract metadata. Vui lòng mở trang paper ACM.');
      }

      currentMetadata = response.data;
      const scored = scoreRelevance(currentMetadata);

      // Fill fields
      document.getElementById('f-title').value    = currentMetadata.title    || '';
      document.getElementById('f-authors').value  = currentMetadata.authors  || '';
      document.getElementById('f-year').value     = currentMetadata.year     || '';
      document.getElementById('f-source').value   = currentMetadata.source   || 'ACM';
      document.getElementById('f-venue').value    = currentMetadata.venue    || '';
      document.getElementById('f-doi').value      = currentMetadata.doi      || '';
      document.getElementById('f-url').value      = currentMetadata.url      || '';
      document.getElementById('f-abstract').value = currentMetadata.abstract || '';

      // Score display
      const scoreEl    = document.getElementById('single-score');
      const decisionEl = document.getElementById('single-decision');
      const criteriaEl = document.getElementById('single-criteria');
      scoreEl.textContent    = scored.score;
      scoreEl.className      = 'score-value ' + getScoreClass(scored.score);
      decisionEl.textContent = scored.decision;
      decisionEl.className   = 'score-decision ' + scored.decision.toLowerCase();
      criteriaEl.textContent = scored.matchedCriteria.join(' · ');

      singleResult.classList.remove('hidden');
      showStatus('extract-status', '✅ Extract thành công!', 'success');

    } catch (err) {
      console.error('[Popup] Extract error:', err);
      showStatus('extract-status', '❌ ' + err.message, 'error');
    } finally {
      extractBtn.disabled = false;
      extractBtn.textContent = '🔍 Extract từ trang hiện tại';
    }
  });

  // ---- Copy CSV ----
  copyCsvBtn.addEventListener('click', async () => {
    if (!currentMetadata) return;
    const scored = scoreRelevance(currentMetadata);
    const csv = buildCSV([{ metadata: currentMetadata, scored, id: 'P001' }]);
    await copyToClipboard(csv);
    showStatus('extract-status', '📋 Đã copy CSV vào clipboard!', 'success');
  });

  // ---- Copy Markdown ----
  copyMdBtn.addEventListener('click', async () => {
    if (!currentMetadata) return;
    const scored = scoreRelevance(currentMetadata);
    const md = [
      `## ${currentMetadata.title}`,
      `- **Authors**: ${currentMetadata.authors}`,
      `- **Year**: ${currentMetadata.year}`,
      `- **Venue**: ${currentMetadata.venue}`,
      `- **DOI**: ${currentMetadata.doi ? `[${currentMetadata.doi}](https://doi.org/${currentMetadata.doi})` : 'N/A'}`,
      `- **Source**: ${currentMetadata.source}`,
      `- **Score**: ${scored.score}/100 → **${scored.decision}**`,
      `- **Criteria**: ${scored.matchedCriteria.join(', ')}`,
      '',
      currentMetadata.abstract ? `> ${currentMetadata.abstract}` : ''
    ].join('\n');
    await copyToClipboard(md);
    showStatus('extract-status', '📝 Đã copy Markdown!', 'success');
  });

  // ---- Save to Storage ----
  saveBtn.addEventListener('click', async () => {
    if (!currentMetadata) return;
    try {
      const scored = scoreRelevance(currentMetadata);
      const stored = await chrome.storage.local.get('papers');
      const papers = stored.papers || [];
      const entry = {
        id: generatePaperId(papers.length, 'P'),
        metadata: currentMetadata,
        scored,
        savedAt: new Date().toISOString()
      };
      papers.push(entry);
      await chrome.storage.local.set({ papers });
      showStatus('extract-status', `💾 Đã lưu! Tổng: ${papers.length} paper(s).`, 'success');
    } catch (err) {
      showStatus('extract-status', '❌ Lỗi khi lưu: ' + err.message, 'error');
    }
  });
}

// ============================================================
// TAB 2: SEARCH SCANNER – DETAILED LIST HELPERS
// ============================================================

/**
 * Render danh sách chi tiết dạng card cho từng paper.
 * @param {Array} results - mảng { id, metadata, scored }
 */
function renderDetailedList(results) {
  const listContainer = document.getElementById('detailed-list');
  if (!listContainer) return;

  if (results.length === 0) {
    listContainer.innerHTML = '<div style="color:#7f8c8d;padding:16px;text-align:center;">Không có kết quả phù hợp với bộ lọc.</div>';
    return;
  }

  listContainer.innerHTML = results.map((item, index) => {
    const m = item.metadata;
    const s = item.scored;
    const scoreClass  = s.score >= 70 ? 'score-high' : 'score-low';
    const decClass    = s.decision.toLowerCase();
    const safeTitle   = escapeHtml(m.title   || 'Unknown Title');
    const safeAuthors = escapeHtml(m.authors || 'N/A');
    const safeYear    = escapeHtml(m.year    || 'N/A');
    const safeVenue   = escapeHtml(m.venue   || 'N/A');
    const safeDoi     = escapeHtml(m.doi     || 'N/A');
    const safeUrl     = escapeHtml(m.url     || '');
    const safeCriteria = (s.matchedCriteria || []).map(c => escapeHtml(c)).join(' • ');

    return `
      <div class="paper-card ${decClass}" data-list-idx="${index}">
        <div class="paper-header">
          <span class="paper-index">#${index + 1} · ${escapeHtml(item.id)}</span>
          <span class="paper-score ${scoreClass}">${s.score}/100</span>
          <span class="paper-decision ${decClass}">${s.decision}</span>
        </div>

        <h3 class="paper-title">
          ${m.url ? `<a href="${safeUrl}" target="_blank">${safeTitle}</a>` : safeTitle}
        </h3>

        <div class="paper-meta">
          <div class="meta-row">
            <span class="meta-label">👥 Tác giả:</span>
            <span class="meta-value">${safeAuthors}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">📅 Năm:</span>
            <span class="meta-value">${safeYear}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">🏛️ Venue:</span>
            <span class="meta-value">${safeVenue}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">🔗 DOI:</span>
            <span class="meta-value">${m.doi ? `<a href="https://doi.org/${m.doi}" target="_blank">${safeDoi}</a>` : 'N/A'}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">🌐 URL:</span>
            <span class="meta-value">${m.url ? `<a href="${safeUrl}" target="_blank">${safeUrl}</a>` : 'N/A'}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">✅ Tiêu chí:</span>
            <span class="meta-value criteria-text">${safeCriteria || '—'}</span>
          </div>
        </div>

        <div class="paper-actions">
          <button class="btn-copy-link" data-url="${safeUrl}" title="Copy URL vào clipboard">🔗 Copy link</button>
          <button class="btn-google" data-title="${escapeHtml(m.title || '')}" title="Tìm kiếm trên Google">🔍 Tìm trên Google</button>
          <button class="btn-toggle-decision" data-list-idx="${index}" title="Đổi quyết định Include/Exclude">
            ${s.decision === 'INCLUDE' ? '❌ Mark Exclude' : '✅ Mark Include'}
          </button>
        </div>
      </div>
    `;
  }).join('');

  attachListEventListeners(results);
}

/**
 * Gắn event listeners cho các button trong detailed list.
 * @param {Array} results - mảng displayedResults hiện tại
 */
function attachListEventListeners(results) {
  // Copy link
  document.querySelectorAll('.btn-copy-link').forEach(btn => {
    btn.addEventListener('click', async () => {
      const url = btn.dataset.url;
      if (!url) { alert('Paper này không có URL.'); return; }
      try {
        await navigator.clipboard.writeText(url);
        btn.textContent = '✅ Đã copy!';
        setTimeout(() => { btn.textContent = '🔗 Copy link'; }, 1800);
      } catch {
        alert('❌ Không thể copy. Trình duyệt chặn clipboard API.');
      }
    });
  });

  // Tìm trên Google
  document.querySelectorAll('.btn-google').forEach(btn => {
    btn.addEventListener('click', () => {
      const title = btn.dataset.title;
      if (!title) return;
      const query = encodeURIComponent(title);
      window.open(`https://www.google.com/search?q=${query}`, '_blank');
    });
  });

  // Toggle decision
  document.querySelectorAll('.btn-toggle-decision').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.listIdx);
      const item = results[idx];
      if (!item) return;
      // Đổi decision trong memory
      if (item.scored.decision === 'INCLUDE') {
        item.scored.decision = 'EXCLUDE';
        item.scored.score = Math.max(0, item.scored.score - 70);
      } else {
        item.scored.decision = 'INCLUDE';
        item.scored.score = Math.min(100, item.scored.score + 70);
      }
      // Re-render chỉ card này
      renderDetailedList(results);
    });
  });
}

/**
 * Copy tất cả URL của papers vào clipboard.
 * @param {Array} results
 */
async function copyAllLinks(results) {
  if (results.length === 0) { alert('Không có dữ liệu!'); return; }
  const links = results.map(r => r.metadata.url || '').filter(u => u).join('\n');
  if (!links) { alert('Các paper này không có URL.'); return; }
  try {
    await navigator.clipboard.writeText(links);
    alert(`✅ Đã copy ${results.filter(r => r.metadata.url).length} links vào clipboard!`);
  } catch {
    alert('❌ Không thể copy. Vui lòng thử lại.');
  }
}

/**
 * Copy danh sách chi tiết dạng text vào clipboard.
 * @param {Array} results
 */
async function copyDetailedList(results) {
  if (results.length === 0) { alert('Không có dữ liệu!'); return; }
  const text = results.map((item, i) => {
    const m = item.metadata;
    const s = item.scored;
    return [
      `#${i + 1} [${s.decision}] Score: ${s.score}/100`,
      `Title  : ${m.title   || 'N/A'}`,
      `Authors: ${m.authors || 'N/A'}`,
      `Year   : ${m.year    || 'N/A'}`,
      `Venue  : ${m.venue   || 'N/A'}`,
      `DOI    : ${m.doi     || 'N/A'}`,
      `URL    : ${m.url     || 'N/A'}`,
      `Criteria: ${(s.matchedCriteria || []).join(', ')}`,
      '='.repeat(80)
    ].join('\n');
  }).join('\n\n');

  try {
    await navigator.clipboard.writeText(text);
    alert(`✅ Đã copy danh sách chi tiết ${results.length} papers vào clipboard!`);
  } catch {
    alert('❌ Không thể copy. Vui lòng thử lại.');
  }
}

// ============================================================
// TAB 2: SEARCH SCANNER
// ============================================================

function initSearchScanner() {
  const scanBtn         = document.getElementById('scan-btn');
  const progressWrap    = document.getElementById('scan-progress-wrap');
  const progressLabel   = document.getElementById('progress-label');
  const progressBar     = document.getElementById('progress-bar');
  const progressSub     = document.getElementById('progress-sub');
  const filterSection   = document.getElementById('filter-section');
  const statsBox        = document.getElementById('stats-box');
  const tableActions    = document.getElementById('table-actions');
  const viewToggleBar   = document.getElementById('view-toggle-bar');
  const viewTableCont   = document.getElementById('view-table-container');
  const viewListCont    = document.getElementById('view-list-container');
  const tbody           = document.getElementById('results-tbody');
  const masterCheck     = document.getElementById('master-check');

  // ---- VIEW TOGGLE ----
  document.getElementById('view-table-btn').addEventListener('click', () => {
    viewTableCont.classList.remove('hidden');
    viewListCont.classList.add('hidden');
    document.getElementById('view-table-btn').classList.add('active');
    document.getElementById('view-list-btn').classList.remove('active');
  });
  document.getElementById('view-list-btn').addEventListener('click', () => {
    viewTableCont.classList.add('hidden');
    viewListCont.classList.remove('hidden');
    document.getElementById('view-list-btn').classList.add('active');
    document.getElementById('view-table-btn').classList.remove('active');
    renderDetailedList(displayedResults);
  });

  // ---- SCAN ----
  scanBtn.addEventListener('click', async () => {
    if (scanInProgress) {
      alert('⏳ Scan đang chạy. Vui lòng chờ...');
      return;
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Kiểm tra đúng trang search
      if (!tab.url || !tab.url.includes('/action/doSearch')) {
        alert('⚠️ Vui lòng mở trang search ACM trước!\n\nURL phải chứa: dl.acm.org/action/doSearch');
        return;
      }

      // Reset UI
      scanInProgress = true;
      allScanResults = [];
      displayedResults = [];
      tbody.innerHTML = '';
      scanBtn.disabled = true;
      scanBtn.textContent = '⏳ Đang quét tất cả trang...';
      progressWrap.classList.remove('hidden');
      filterSection.classList.add('hidden');
      statsBox.classList.add('hidden');
      tableActions.classList.add('hidden');
      viewToggleBar.classList.add('hidden');
      viewTableCont.classList.add('hidden');
      viewListCont.classList.add('hidden');

      // Xóa progress cũ trong storage
      await chrome.storage.local.remove('scanProgress');

      // Cập nhật UI ban đầu
      progressLabel.textContent  = '🔍 Đang kết nối content script...';
      progressSub.textContent    = 'Đang chuẩn bị quét toàn bộ trang kết quả...';
      progressBar.style.width    = '2%';
      const detailEl = document.getElementById('progress-page-detail');
      if (detailEl) detailEl.textContent = '';

      // Inject content script nếu cần
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      } catch { /* already injected */ }
      await new Promise(r => setTimeout(r, 400));

      progressLabel.textContent = '🚀 Bắt đầu scan – đang chờ content script...';
      progressBar.style.width   = '5%';

      // Chỉ gửi lệnh BẮT ĐẦU – content script trả lời ngay.
      // Kết quả đến qua chrome.storage.onChanged (onScanFinished).
      let response;
      try {
        response = await chrome.tabs.sendMessage(tab.id, { action: 'scanSearch' });
      } catch (err) {
        throw new Error('Không thể giao tiếp với content script: ' + err.message);
      }
      if (!response || !response.success) {
        throw new Error(response?.error || 'Scan thất bại.');
      }
      progressLabel.textContent = '⏳ Đang quét từng trang (có thể đóng popup, kết quả sẽ được lưu lại)...';
      progressBar.style.width   = '5%';

    } catch (err) {
      console.error('[Popup] Scan error:', err);
      alert('❌ Lỗi khi scan: ' + err.message);
      progressWrap.classList.add('hidden');
      resetScanButton();
    }
  });

  function resetScanButton() {
    scanInProgress = false;
    scanBtn.disabled = false;
    scanBtn.textContent = '🚀 Scan All Results (All Pages)';
  }

  /** Chấm điểm + hiển thị danh sách paper đã quét */
  function showScanResults(rawResults) {
    progressLabel.textContent = `⚙️ Đang chấm điểm IC/EC cho ${rawResults.length} papers...`;
    progressBar.style.width   = '95%';

    allScanResults = rawResults.map((metadata, idx) => {
      const scored = scoreRelevance(metadata);
      return { id: generatePaperId(idx), metadata, scored };
    });
    allScanResults.sort((a, b) => b.scored.score - a.scored.score);

    progressLabel.textContent = `✅ Hoàn tất! ${allScanResults.length} papers.`;
    progressBar.style.width   = '100%';

    const onlyInclude = document.getElementById('only-include-checkbox')?.checked ?? true;
    displayedResults = onlyInclude
      ? allScanResults.filter(r => r.scored.decision === 'INCLUDE')
      : [...allScanResults];

    renderTable(displayedResults);
    updateStats(displayedResults);

    filterSection.classList.remove('hidden');
    statsBox.classList.remove('hidden');
    tableActions.classList.remove('hidden');
    viewToggleBar.classList.remove('hidden');
    viewTableCont.classList.remove('hidden');
    document.getElementById('view-table-btn').classList.add('active');
    document.getElementById('view-list-btn').classList.remove('active');
  }

  // Content script ghi scanResults -> popup nhận ở đây
  onScanFinished = (res) => {
    if (res.status === 'error') {
      alert('❌ Lỗi khi scan: ' + (res.error || 'unknown'));
      progressWrap.classList.add('hidden');
      resetScanButton();
      return;
    }
    if (res.status !== 'completed') return;
    showScanResults(res.papers || []);
    resetScanButton();
    setTimeout(() => progressWrap.classList.add('hidden'), 4000);
  };

  // Mở lại popup giữa chừng: khôi phục trạng thái (scan đang chạy / đã xong)
  (async () => {
    try {
      const { scanState, scanResults } = await chrome.storage.local.get(['scanState', 'scanResults']);
      const fresh = scanState?.active && (Date.now() - (scanState.updatedAt || 0) < 3 * 60 * 1000);
      if (fresh) {
        scanInProgress = true;
        scanBtn.disabled = true;
        scanBtn.textContent = '⏳ Đang quét tất cả trang...';
        progressWrap.classList.remove('hidden');
        progressLabel.textContent = `Đang quét... Trang ${scanState.page + 1} — ${scanState.papers?.length || 0} papers`;
      } else if (scanResults && scanResults.status === 'completed' &&
                 Array.isArray(scanResults.papers) && allScanResults.length === 0) {
        showScanResults(scanResults.papers);
        progressWrap.classList.add('hidden');
      }
    } catch (e) { console.error('[Popup] restore error:', e); }
  })();

  function updateProgress(pct, count, sub) {
    progressBar.style.width   = pct + '%';
    progressLabel.textContent = `Đang quét... ${count} papers`;
    progressSub.textContent   = sub;
  }


  // ---- RENDER TABLE ----
  function renderTable(results) {
    tbody.innerHTML = '';

    if (results.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="8" style="text-align:center;padding:20px;color:#7f8c8d;">Không có kết quả phù hợp với bộ lọc.</td>';
      tbody.appendChild(tr);
      return;
    }

    results.forEach((item, idx) => {
      const m = item.metadata;
      const s = item.scored;
      const tr = document.createElement('tr');
      tr.dataset.idx = idx;

      const shortDoi = m.doi ? m.doi.replace('10.1145/', '') : '—';
      const titleLink = m.url
        ? `<a href="${m.url}" target="_blank" title="${escapeHtml(m.title)}">${escapeHtml(truncate(m.title, 80))}</a>`
        : escapeHtml(truncate(m.title, 80));

      tr.innerHTML = `
        <td class="col-check"><input type="checkbox" class="row-check" data-idx="${idx}" ${s.decision === 'INCLUDE' ? 'checked' : ''} /></td>
        <td class="col-id">${escapeHtml(item.id)}</td>
        <td class="col-title cell-title">${titleLink}</td>
        <td class="col-authors">${escapeHtml(truncate(m.authors, 40))}</td>
        <td class="col-year" style="text-align:center">${escapeHtml(m.year)}</td>
        <td class="col-doi">${m.doi ? `<a href="https://doi.org/${m.doi}" target="_blank">${escapeHtml(shortDoi)}</a>` : '—'}</td>
        <td class="col-score ${getScoreClass(s.score)}">${s.score}</td>
        <td class="col-decision ${s.decision === 'INCLUDE' ? 'include' : 'exclude'}">${s.decision}</td>
      `;
      tbody.appendChild(tr);
    });

    // Update selected count on check change
    tbody.querySelectorAll('.row-check').forEach(cb => {
      cb.addEventListener('change', updateSelectedCount);
    });
    updateSelectedCount();
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function truncate(str, maxLen) {
    const s = String(str || '');
    return s.length > maxLen ? s.substring(0, maxLen) + '…' : s;
  }

  function updateStats(results) {
    const total   = results.length;
    const include = results.filter(r => r.scored.decision === 'INCLUDE').length;
    const exclude = total - include;
    document.getElementById('stat-total').textContent   = `Tổng: ${total}`;
    document.getElementById('stat-include').textContent = `INCLUDE: ${include}`;
    document.getElementById('stat-exclude').textContent = `EXCLUDE: ${exclude}`;
    updateSelectedCount();
  }

  function updateSelectedCount() {
    const checked = tbody.querySelectorAll('.row-check:checked').length;
    document.getElementById('stat-selected').textContent = `Đã chọn: ${checked}`;
  }

  // ---- MASTER CHECKBOX ----
  masterCheck.addEventListener('change', () => {
    tbody.querySelectorAll('.row-check').forEach(cb => {
      cb.checked = masterCheck.checked;
    });
    updateSelectedCount();
  });

  // ---- SELECT ALL INCLUDE ----
  document.getElementById('select-all-include-btn').addEventListener('click', () => {
    tbody.querySelectorAll('.row-check').forEach(cb => {
      const idx = parseInt(cb.dataset.idx);
      const item = displayedResults[idx];
      cb.checked = item && item.scored.decision === 'INCLUDE';
    });
    updateSelectedCount();
  });

  // ---- DESELECT ALL ----
  document.getElementById('deselect-all-btn').addEventListener('click', () => {
    tbody.querySelectorAll('.row-check').forEach(cb => { cb.checked = false; });
    masterCheck.checked = false;
    updateSelectedCount();
  });

  // ---- EXPORT SELECTED CSV ----
  document.getElementById('export-selected-btn').addEventListener('click', () => {
    const selected = [];
    tbody.querySelectorAll('.row-check:checked').forEach(cb => {
      const idx = parseInt(cb.dataset.idx);
      if (displayedResults[idx]) selected.push(displayedResults[idx]);
    });
    if (selected.length === 0) { alert('Chưa chọn paper nào!'); return; }
    const searchStr = document.getElementById('search-string').value;
    const csv = buildCSV(selected, searchStr);
    downloadFile(csv, `slr_selected_${Date.now()}.csv`);
  });

  // ---- EXPORT ALL CSV ----
  document.getElementById('export-all-btn').addEventListener('click', () => {
    if (displayedResults.length === 0) { alert('Không có dữ liệu!'); return; }
    const searchStr = document.getElementById('search-string').value;
    const csv = buildCSV(displayedResults, searchStr);
    downloadFile(csv, `slr_all_${Date.now()}.csv`);
  });

  // ---- COPY ALL LINKS ----
  document.getElementById('copy-all-links-btn').addEventListener('click', () => {
    copyAllLinks(displayedResults);
  });

  // ---- COPY DETAILED LIST ----
  document.getElementById('copy-detailed-list-btn').addEventListener('click', () => {
    copyDetailedList(displayedResults);
  });

  // ---- CLEAR RESULTS ----
  document.getElementById('clear-results-btn').addEventListener('click', () => {
    if (!confirm('Xóa toàn bộ kết quả scan?')) return;
    allScanResults = [];
    displayedResults = [];
    tbody.innerHTML = '';
    document.getElementById('detailed-list').innerHTML = '';
    filterSection.classList.add('hidden');
    statsBox.classList.add('hidden');
    tableActions.classList.add('hidden');
    viewToggleBar.classList.add('hidden');
    viewTableCont.classList.add('hidden');
    viewListCont.classList.add('hidden');
  });


  // ---- FILTER ----
  document.getElementById('apply-filter-btn').addEventListener('click', applyFilter);
  document.getElementById('filter-keyword').addEventListener('keyup', e => {
    if (e.key === 'Enter') applyFilter();
  });

  // ---- ONLY INCLUDE CHECKBOX ----
  // Click this checkbox → re-run filter instantly without touching other controls
  document.getElementById('only-include-checkbox')?.addEventListener('change', applyFilter);

  function applyFilter() {
    const minYear    = parseInt(document.getElementById('filter-min-year').value)  || 0;
    const maxYear    = parseInt(document.getElementById('filter-max-year').value)  || 9999;
    const minScore   = parseInt(document.getElementById('filter-min-score').value) || 0;
    const keyword    = document.getElementById('filter-keyword').value.toLowerCase().trim();
    const decisionF  = document.getElementById('filter-decision').value;
    const onlyInclude = document.getElementById('only-include-checkbox')?.checked ?? false;

    displayedResults = allScanResults.filter(item => {
      const m = item.metadata;
      const s = item.scored;
      const year = parseInt(m.year) || 0;
      const titleLower = (m.title || '').toLowerCase();

      // Quick filter: chỉ INCLUDE
      if (onlyInclude && s.decision !== 'INCLUDE') return false;

      if (year > 0 && (year < minYear || year > maxYear)) return false;
      if (s.score < minScore) return false;
      if (keyword && !titleLower.includes(keyword)) return false;
      if (decisionF !== 'ALL' && s.decision !== decisionF) return false;
      return true;
    });

    renderTable(displayedResults);
    updateStats(displayedResults);

    // Re-render danh sách chi tiết nếu đang hiển thị
    if (!viewListCont.classList.contains('hidden')) {
      renderDetailedList(displayedResults);
    }
  }

  // ---- SORT (click on th) ----
  document.querySelectorAll('#results-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortState.col === col) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      } else {
        sortState.col = col;
        sortState.dir = 'desc';
      }
      sortAndRender();
    });
  });

  function sortAndRender() {
    const { col, dir } = sortState;
    displayedResults.sort((a, b) => {
      let va, vb;
      switch (col) {
        case 'score':    va = a.scored.score;     vb = b.scored.score;     break;
        case 'year':     va = parseInt(a.metadata.year) || 0; vb = parseInt(b.metadata.year) || 0; break;
        case 'title':    va = (a.metadata.title || '').toLowerCase(); vb = (b.metadata.title || '').toLowerCase(); break;
        case 'decision': va = a.scored.decision;  vb = b.scored.decision;  break;
        case 'id':       va = a.id;               vb = b.id;               break;
        default:         va = 0; vb = 0;
      }
      if (va < vb) return dir === 'asc' ? -1 : 1;
      if (va > vb) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    renderTable(displayedResults);
  }
}

// ============================================================
// TAB 3: HISTORY
// ============================================================

async function loadHistory() {
  const historyList  = document.getElementById('history-list');
  const historyStats = document.getElementById('history-stats');

  try {
    const stored = await chrome.storage.local.get('papers');
    const papers = stored.papers || [];

    historyStats.textContent = `Tổng ${papers.length} paper(s) đã lưu.`;
    historyList.innerHTML = '';

    if (papers.length === 0) {
      historyList.innerHTML = '<div style="color:#7f8c8d;font-size:12px;">Chưa có paper nào được lưu.</div>';
      return;
    }

    // Hiển thị theo thứ tự ngược (mới nhất trước)
    [...papers].reverse().forEach(entry => {
      const m = entry.metadata;
      const s = entry.scored;
      const div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML = `
        <div class="hi-title">
          ${escapeHtml(m.title || 'Unknown')}
          <span class="hi-score ${s.decision === 'INCLUDE' ? 'include' : 'exclude'}">${s.score} · ${s.decision}</span>
        </div>
        <div class="hi-meta">${escapeHtml(m.authors || '')} · ${escapeHtml(m.year || '')} · ${escapeHtml(m.source || 'ACM')}</div>
        ${m.doi ? `<div class="hi-meta">DOI: <a href="https://doi.org/${m.doi}" target="_blank">${escapeHtml(m.doi)}</a></div>` : ''}
        <div class="hi-meta" style="font-size:10px;color:#aaa;">${entry.id || ''} · Saved: ${new Date(entry.savedAt || Date.now()).toLocaleString('vi-VN')}</div>
      `;
      historyList.appendChild(div);
    });

  } catch (err) {
    console.error('[Popup] loadHistory error:', err);
    historyStats.textContent = '❌ Lỗi khi tải history.';
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function initHistory() {
  document.getElementById('export-history-btn').addEventListener('click', async () => {
    const stored = await chrome.storage.local.get('papers');
    const papers = stored.papers || [];
    if (papers.length === 0) { alert('Không có paper nào để export!'); return; }
    const csv = buildCSV(papers.map(e => ({ metadata: e.metadata, scored: e.scored, id: e.id })));
    downloadFile(csv, `slr_history_${Date.now()}.csv`);
  });

  document.getElementById('clear-history-btn').addEventListener('click', async () => {
    if (!confirm('Xóa toàn bộ history? Không thể hoàn tác!')) return;
    await chrome.storage.local.set({ papers: [] });
    loadHistory();
  });
}

// ============================================================
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  console.log('[SLR Scanner Popup] Initializing...');
  initTabs();
  initSinglePaper();
  initSearchScanner();
  initHistory();
  console.log('[SLR Scanner Popup] Ready!');
});