// content.js - SLR Search Scanner Content Script
// Author: Nguyen Tien Dat - SWT301 RBL Group04
// Chạy trên các trang ACM, IEEE, Google Scholar

(function () {
'use strict';
// Chống inject trùng (manifest + popup executeScript) -> tránh 2 vòng scan song song
if (window.__SLR_SCANNER_LOADED__) {
  console.log('[SLR Scanner] Already loaded, skip.');
  return;
}
window.__SLR_SCANNER_LOADED__ = true;

console.log('[SLR Scanner] Content script loaded!');

// ============================================================
// SECTION 1: EXTRACT METADATA TỪ MỘT ELEMENT KẾT QUẢ
// ============================================================

/**
 * Trích xuất metadata từ một DOM element đại diện cho một kết quả tìm kiếm ACM.
 * @param {Element} element - DOM element của một kết quả tìm kiếm
 * @returns {Object} metadata object chứa thông tin bài báo
 */
function extractMetadataFromSearchResult(element) {
  try {
    // --- TITLE ---
    const titleEl =
      element.querySelector('.issue-item__title h5') ||
      element.querySelector('.issue-item__title') ||
      element.querySelector('.hlFld-Title') ||
      element.querySelector('h5.issue-item__title') ||
      element.querySelector('h3') ||
      element.querySelector('h4') ||
      element.querySelector('h5');
    const title = titleEl ? titleEl.textContent.trim() : 'Unknown Title';

    // --- AUTHORS ---
    // Lấy tên tác giả, bỏ affiliation bằng cách split '\n' và lấy phần tử đầu
    const authorEls = element.querySelectorAll(
      '.issue-item__authors .author-name, ' +
      '.issue-item__authors span[class*="author"], ' +
      '.hlFld-ContribAuthor, ' +
      '.author-name'
    );
    let authors = 'Unknown';
    if (authorEls.length > 0) {
      const authorNames = Array.from(authorEls).map(el => {
        const text = el.textContent.trim();
        // Bỏ affiliation: split by '\n' và lấy phần tử đầu, rồi trim
        return text.split('\n')[0].trim().replace(/,$/, '').trim();
      }).filter(name => name.length > 0);
      authors = authorNames.join('; ');
    }

    // --- YEAR ---
    let year = 'Unknown';
    // Thử lấy từ citation date
    const citationEl =
      element.querySelector('.issue-item__citation .dot-separator') ||
      element.querySelector('.core-date-published') ||
      element.querySelector('.issue-item__citation') ||
      element.querySelector('[class*="citation"]');
    if (citationEl) {
      const yearMatch = citationEl.textContent.match(/\d{4}/);
      if (yearMatch) {
        year = yearMatch[0];
      }
    }
    // Fallback: tìm năm trong toàn bộ text của element
    if (year === 'Unknown') {
      const fullText = element.textContent;
      const yearMatches = fullText.match(/\b(19|20)\d{2}\b/g);
      if (yearMatches) {
        // Lấy năm hợp lý nhất (2000-2030)
        const validYears = yearMatches.filter(y => parseInt(y) >= 2000 && parseInt(y) <= 2030);
        if (validYears.length > 0) {
          year = validYears[0];
        }
      }
    }

    // --- VENUE ---
    const venueEl =
      element.querySelector('.issue-item__citation .epub-section__title') ||
      element.querySelector('.core-venue') ||
      element.querySelector('.issue-item__detail') ||
      element.querySelector('[class*="venue"]') ||
      element.querySelector('.issue-item__citation span:not(.dot-separator)');
    const venue = venueEl ? venueEl.textContent.trim() : 'Unknown';

    // --- DOI & URL ---
    let doi = '';
    let url = '';
    const doiLinks = element.querySelectorAll('a[href*="/doi/"]');
    if (doiLinks.length > 0) {
      for (const link of doiLinks) {
        const href = link.getAttribute('href');
        // Extract DOI bằng regex
        const doiMatch = href.match(/10\.\d{4,}\/[^\s?#]+/);
        if (doiMatch) {
          doi = doiMatch[0];
          // Tạo URL đầy đủ
          url = href.startsWith('http') ? href : `https://dl.acm.org${href}`;
          break;
        }
      }
    }

    // --- SOURCE ---
    const source = 'ACM';

    return {
      title,
      authors,
      year,
      venue,
      doi,
      url,
      abstract: '', // Không có trên trang search
      source
    };
  } catch (error) {
    console.error('[SLR Scanner] Error extracting metadata from element:', error);
    return {
      title: 'Error extracting',
      authors: '',
      year: '',
      venue: '',
      doi: '',
      url: '',
      abstract: '',
      source: 'ACM'
    };
  }
}

// ============================================================
// SECTION 2: EXTRACT METADATA TỪ TRANG CHI TIẾT PAPER
// ============================================================

/**
 * Trích xuất metadata từ trang chi tiết của một paper (ví dụ: dl.acm.org/doi/...)
 * @returns {Object} metadata object
 */
function extractMetadataFromPaperPage() {
  try {
    // Title
    const titleEl =
      document.querySelector('h1.citation__title') ||
      document.querySelector('.citation__title') ||
      document.querySelector('h1[class*="title"]') ||
      document.querySelector('h1');
    const title = titleEl ? titleEl.textContent.trim() : document.title.trim();

    // Authors
    const authorEls = document.querySelectorAll(
      '.citation__authors .author-name, ' +
      '.citation__authors a[class*="author"], ' +
      '.loa-authors .author-name, ' +
      'span.hlFld-ContribAuthor'
    );
    let authors = 'Unknown';
    if (authorEls.length > 0) {
      const authorNames = Array.from(authorEls).map(el => {
        return el.textContent.trim().split('\n')[0].trim();
      }).filter(name => name.length > 0);
      authors = authorNames.join('; ');
    }

    // Year
    let year = 'Unknown';
    const pubDateEl =
      document.querySelector('.core-date-published') ||
      document.querySelector('.citation__date') ||
      document.querySelector('[class*="pub-date"]') ||
      document.querySelector('span.epub-pub-date');
    if (pubDateEl) {
      const yearMatch = pubDateEl.textContent.match(/\d{4}/);
      if (yearMatch) year = yearMatch[0];
    }

    // Venue
    const venueEl =
      document.querySelector('.citation__venue') ||
      document.querySelector('.core-venue') ||
      document.querySelector('.epub-section__title') ||
      document.querySelector('[class*="publication-title"]');
    const venue = venueEl ? venueEl.textContent.trim() : 'Unknown';

    // DOI
    let doi = '';
    let url = window.location.href;
    const doiEl =
      document.querySelector('a[href*="doi.org"]') ||
      document.querySelector('.citation__doi a') ||
      document.querySelector('[class*="doi"] a');
    if (doiEl) {
      const doiMatch = doiEl.href.match(/10\.\d{4,}\/[^\s?#]+/);
      if (doiMatch) doi = doiMatch[0];
    }
    // Fallback: extract doi từ URL
    if (!doi) {
      const urlDoi = window.location.pathname.match(/10\.\d{4,}\/[^\s?#]+/);
      if (urlDoi) doi = urlDoi[0];
    }

    // Abstract
    const abstractEl =
      document.querySelector('.abstractSection p') ||
      document.querySelector('[class*="abstract"] p') ||
      document.querySelector('#abstract p') ||
      document.querySelector('.article-abstract p');
    const abstract = abstractEl ? abstractEl.textContent.trim() : '';

    return { title, authors, year, venue, doi, url, abstract, source: 'ACM' };
  } catch (error) {
    console.error('[SLR Scanner] Error extracting from paper page:', error);
    return null;
  }
}

// ============================================================
// SECTION 3: HELPERS (sleep / scroll / pagination)
// ============================================================

/** Chờ ms mili-giây */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Scroll xuống cuối trang để kích hoạt lazy-load, rồi scroll về đầu.
 */
async function scrollToBottom() {
  let lastHeight = -1;
  let attempts   = 0;
  const MAX = 4;
  while (attempts < MAX) {
    const h = document.body.scrollHeight;
    if (h === lastHeight) break;
    lastHeight = h;
    window.scrollTo(0, h);
    await sleep(1500);
    attempts++;
  }
  window.scrollTo(0, 0);
  await sleep(300);
}

/**
 * Tìm và click nút "Next page" của ACM.
 * @returns {boolean} true nếu tìm thấy và click được
 */
async function goToNextPage() {
  const NEXT_SELECTORS = [
    'a[aria-label="Next Page"]',
    'a[aria-label="Next"]',
    'button[aria-label="Next Page"]',
    'button[aria-label="Next"]',
    '.pagination__btn--next',
    'a.pagination__btn--next',
    'li.page-item.active + li.page-item a',
    '[class*="pagination"] [class*="next"]:not([disabled])',
    'a[rel="next"]',
  ];
  for (const sel of NEXT_SELECTORS) {
    const btn = document.querySelector(sel);
    if (btn && !btn.disabled && !btn.closest('[disabled]') &&
        !btn.classList.contains('disabled')) {
      console.log('[SLR Scanner] Clicking next page:', sel);
      btn.click();
      return true;
    }
  }
  // Fallback: text match
  for (const el of document.querySelectorAll('a, button')) {
    const txt = el.textContent.trim().toLowerCase();
    if ((txt === 'next' || txt === '›' || txt === '»') &&
        !el.disabled && !el.closest('[disabled]')) {
      console.log('[SLR Scanner] Clicking next via text match');
      el.click();
      return true;
    }
  }
  return false;
}

/** Đợi trang mới load xong */
async function waitForPageLoad(ms = 3500) {
  await sleep(ms);
  const spinner = document.querySelector('.loading, .spinner, [class*="loading"]');
  if (spinner) await sleep(1500);
}

/** Ghi tiến độ vào storage để popup cập nhật real-time */
async function updateScanProgress(progress) {
  try {
    await chrome.storage.local.set({ scanProgress: { ...progress, ts: Date.now() } });
  } catch { /* ignore */ }
}

// ============================================================
// SECTION 4: SCAN SEARCH RESULTS – RESUMABLE PAGINATION
// ============================================================
// Kiến trúc: mỗi trang ACM là một lần điều hướng THẬT => content script bị
// huỷ và nạp lại ở mỗi trang. Vì vậy KHÔNG giữ state trong biến JS mà lưu vào
// chrome.storage.local (key 'scanState'). Mỗi lần content script nạp lại sẽ
// tự đọc state và làm tiếp. Khi xong ghi 'scanResults' để popup nhận.

const PER_PAGE  = 20;   // số kết quả / trang
const MAX_PAGES = 200;  // chốt chặn an toàn

function getStartPageFromUrl() {
  const v = new URL(location.href).searchParams.get('startPage');
  return v ? (parseInt(v, 10) || 0) : 0;
}

/** URL của trang kết quả thứ `page` (0-based), giữ nguyên query search */
function buildPageUrl(page) {
  const u = new URL(location.href);
  u.searchParams.set('startPage', String(page));
  u.searchParams.set('pageSize', String(PER_PAGE));
  return u.toString();
}

function detectTotalResults() {
  const SELECTORS = [
    '.result__count', '.search__item-count', '.results-count',
    '[class*="result-count"]', '.items-results', 'span[data-total]', 'h2.result__title'
  ];
  for (const sel of SELECTORS) {
    const el = document.querySelector(sel);
    if (el) {
      const txt = el.textContent || el.getAttribute('data-total') || '';
      const m = txt.replace(/,/g, '').match(/(\d+)/);
      if (m) return parseInt(m[1], 10);
    }
  }
  const m = (document.body.innerText || '').match(/([\d,]+)\s+results?\b/i);
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
}

const RESULT_SELECTORS = [
  '.issue-item', 'li.search__item', '.search__item',
  'article.issue-item', '[class*="issue-item"]'
];

function findResultElements() {
  for (const sel of RESULT_SELECTORS) {
    const found = document.querySelectorAll(sel);
    if (found.length > 0) return Array.from(found);
  }
  return Array.from(document.querySelectorAll('article'));
}

/** Đợi kết quả xuất hiện trong DOM (tối đa ~15s) */
async function waitForResults(maxMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (findResultElements().length > 0) return true;
    await sleep(300);
  }
  return false;
}

function extractCurrentPagePapers() {
  const out = [];
  for (const el of findResultElements()) {
    try {
      const meta = extractMetadataFromSearchResult(el);
      if (!meta.title || meta.title === 'Error extracting' || meta.title === 'Unknown Title') continue;
      out.push(meta);
    } catch (err) {
      console.error('[SLR Scanner] Extract error:', err);
    }
  }
  return out;
}

const paperKey = p => p.url || p.doi || p.title;

async function getScanState() {
  const { scanState } = await chrome.storage.local.get('scanState');
  return scanState || null;
}
async function saveScanState(state) {
  await chrome.storage.local.set({ scanState: { ...state, updatedAt: Date.now() } });
}

let stepRunning = false;

/**
 * Xử lý MỘT trang rồi điều hướng sang trang kế (hoặc kết thúc).
 * Được gọi lại tự động mỗi khi content script nạp ở trang mới.
 */
async function runScanStep() {
  if (stepRunning) return;
  stepRunning = true;
  let state = null;
  try {
    state = await getScanState();
    if (!state || !state.active) return;
    if (!location.href.includes('/action/doSearch')) return;

    // Luôn quét từ trang 0; nếu URL không khớp state.page thì điều hướng đúng chỗ
    if (getStartPageFromUrl() !== state.page) {
      state.redirects = (state.redirects || 0) + 1;
      if (state.redirects > 3) throw new Error('Không thể điều hướng tới trang ' + (state.page + 1));
      await saveScanState(state);
      location.href = buildPageUrl(state.page);
      return;
    }
    state.redirects = 0;

    const page = state.page;
    await updateScanProgress({
      currentPage: page + 1, totalPages: state.totalPages || page + 1,
      papersFound: state.papers.length, status: 'scanning'
    });

    const ok = await waitForResults();
    if (ok) await scrollToBottom();

    if (page === 0) {
      state.totalResults = detectTotalResults();
      state.totalPages   = state.totalResults > 0 ? Math.ceil(state.totalResults / PER_PAGE) : 0;
      console.log(`[SLR Scanner] ${state.totalResults} results → ${state.totalPages} pages`);
    }

    // Gộp kết quả trang này (khử trùng)
    const pagePapers = extractCurrentPagePapers();
    const seen = new Set(state.papers.map(paperKey));
    let added = 0;
    for (const p of pagePapers) {
      const k = paperKey(p);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      state.papers.push(p);
      added++;
    }
    console.log(`[SLR Scanner] Page ${page + 1}: ${pagePapers.length} found, ${added} new, total ${state.papers.length}`);

    const totalPages = state.totalPages || 0;
    const isLast =
      pagePapers.length === 0 || added === 0 ||
      (totalPages > 0 && page + 1 >= totalPages) ||
      (state.totalResults > 0 && state.papers.length >= state.totalResults) ||
      page + 1 >= MAX_PAGES;

    await updateScanProgress({
      currentPage: page + 1, totalPages: totalPages || page + 1,
      papersFound: state.papers.length, status: 'extracted'
    });

    if (isLast) {
      await finishScan(state, 'completed');
    } else {
      state.page = page + 1;
      await saveScanState(state);            // lưu TRƯỚC khi điều hướng
      await sleep(600 + Math.random() * 600); // nhẹ tay với server ACM
      location.href = buildPageUrl(state.page);
    }
  } catch (err) {
    console.error('[SLR Scanner] Scan step error:', err);
    await finishScan(state || { papers: [] }, 'error', err.message);
  } finally {
    stepRunning = false;
  }
}

async function finishScan(state, status, errorMsg) {
  const papers = state.papers || [];
  const totalPages = state.totalPages || Math.max(1, (state.page || 0) + 1);
  await chrome.storage.local.set({
    scanState: { active: false, finishedAt: Date.now(), updatedAt: Date.now() },
    scanResults: {
      papers, count: papers.length,
      totalResults: state.totalResults || 0,
      completedAt: Date.now(), status,
      ...(errorMsg ? { error: errorMsg } : {})
    }
  });
  if (status === 'completed') {
    await updateScanProgress({
      currentPage: totalPages, totalPages,
      papersFound: papers.length, status: 'done'
    });
  }
  console.log(`[SLR Scanner] Scan ${status}: ${papers.length} papers.`);
}

// ============================================================
// SECTION 5: SCORE RELEVANCE (IC/EC CRITERIA)
// ============================================================

/**
 * Chấm điểm mức độ liên quan của một paper dựa trên tiêu chí IC/EC của SLR.
 * @param {Object} metadata - Metadata của paper
 * @returns {Object} { score, decision, matchedCriteria }
 */
function scoreRelevance(metadata) {
  let score = 0;
  const matchedCriteria = [];
  const titleLower = (metadata.title || '').toLowerCase();
  const abstractLower = (metadata.abstract || '').toLowerCase();
  const combinedText = titleLower + ' ' + abstractLower;
  const year = parseInt(metadata.year) || 0;

  // IC-P (Population): Java / unit test
  if (combinedText.includes('java') || combinedText.includes('unit test') || combinedText.includes('unit testing')) {
    score += 20;
    matchedCriteria.push('IC-P: Java/unit test');
  }
  // IC-I (Intervention): LLM / ChatGPT / Claude / GPT
  if (combinedText.includes('llm') || combinedText.includes('chatgpt') ||
      combinedText.includes('claude') || combinedText.includes('large language model') ||
      combinedText.includes('gpt') || combinedText.includes('gpt-4') || combinedText.includes('gpt-3')) {
    score += 20;
    matchedCriteria.push('IC-I: LLM/ChatGPT/Claude/GPT');
  }
  // IC-C (Comparison): EvoSuite / comparison
  if (combinedText.includes('evosuite') || combinedText.includes('comparison') ||
      combinedText.includes('compare') || combinedText.includes('vs.') ||
      combinedText.includes('versus') || combinedText.includes('benchmark')) {
    score += 15;
    matchedCriteria.push('IC-C: Comparison/EvoSuite');
  }
  // IC-O (Outcome): coverage / compile / mutation / executable
  if (combinedText.includes('coverage') || combinedText.includes('compile') ||
      combinedText.includes('compilation') || combinedText.includes('mutation') ||
      combinedText.includes('success rate') || combinedText.includes('executable') ||
      combinedText.includes('pass rate') || combinedText.includes('correctness')) {
    score += 15;
    matchedCriteria.push('IC-O: Coverage/compile/mutation/executable');
  }
  // IC-T (Time): Year >= 2018
  if (year >= 2018) {
    score += 10;
    matchedCriteria.push(`IC-T: Year ${year} >= 2018`);
  }
  // IC-L (Language): Latin characters
  if (/[a-zA-Z]/.test(metadata.title || '')) {
    score += 10;
    matchedCriteria.push('IC-L: English/Latin language');
  }
  // IC-E (Full-text): DOI available
  if (metadata.doi && metadata.doi.trim() !== '') {
    score += 10;
    matchedCriteria.push('IC-E: DOI available');
  }

  // EC-N: survey / review (not SLR)
  const isSurveyOrReview =
    (combinedText.includes('survey') || combinedText.includes('review')) &&
    !combinedText.includes('systematic literature review');
  if (isSurveyOrReview) {
    score -= 50;
    matchedCriteria.push('EC-N: Survey/review (not SLR) → -50');
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

// ============================================================
// SECTION 6: MESSAGE LISTENER
// ============================================================

/**
 * Lắng nghe messages từ popup.js và xử lý các action tương ứng.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[SLR Scanner] Content script received message:', message.action);

  (async () => {
    try {
      switch (message.action) {

        // ✅ PING HANDLER - Để popup kiểm tra content script đã load chưa
        case 'ping': {
          sendResponse({ status: 'pong' });
          break;
        }

        case 'extractSingle': {
          const metadata = extractMetadataFromPaperPage();
          if (!metadata) {
            sendResponse({ success: false, error: 'Could not extract metadata from this page.' });
          } else {
            sendResponse({ success: true, data: metadata });
          }
          break;
        }

        // scanSearch: Quét toàn bộ kết quả (multi-page)
        case 'scanSearch': {
          if (!location.href.includes('/action/doSearch')) {
            sendResponse({ success: false, error: 'Not a search page. Please open an ACM search results page first.' });
            break;
          }
          await chrome.storage.local.remove(['scanResults', 'scanProgress']);
          await saveScanState({
            active: true, page: 0, papers: [],
            totalResults: 0, totalPages: 0, redirects: 0,
            startedAt: Date.now(), searchUrl: location.href
          });
          // Trả lời NGAY – kết quả đi qua chrome.storage, không qua message channel
          sendResponse({ success: true, started: true });
          runScanStep(); // không await
          break;
        }

        case 'cancelScan': {
          const st = await getScanState();
          if (st) await saveScanState({ ...st, active: false });
          sendResponse({ success: true });
          break;
        }

        case 'scorePaper': {
          const scored = scoreRelevance(message.metadata);
          sendResponse({ success: true, data: scored });
          break;
        }

        default:
          sendResponse({ success: false, error: `Unknown action: ${message.action}` });
      }
    } catch (error) {
      console.error('[SLR Scanner] Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true; // Giữ channel mở cho async response
});

// ============================================================
// SECTION 7: AUTO-RESUME sau mỗi lần điều hướng trang
// ============================================================
if (location.href.includes('/action/doSearch')) {
  setTimeout(() => { runScanStep(); }, 500);
}

})();