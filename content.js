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

/** Xác định database dựa trên hostname của trang hiện tại */
function getSource() {
  const h = location.hostname;
  if (h === 'dl.acm.org') return 'ACM';
  if (h === 'ieeexplore.ieee.org') return 'IEEE';
  if (h === 'scholar.google.com') return 'SCHOLAR';
  return null;
}

const DOI_REGEX = /10\.\d{4,}\/[^\s?#]+/;

/** Chuyển href tương đối -> tuyệt đối */
function absUrl(href) {
  if (!href) return '';
  try { return new URL(href, location.origin).href; } catch { return ''; }
}

const collapseWs = s => (s || '').replace(/\s+/g, ' ').trim();

/**
 * Trích xuất metadata từ một DOM element kết quả tìm kiếm.
 * Tự chọn parser theo database (ACM / IEEE Xplore / Google Scholar).
 * @param {Element} element - DOM element của một kết quả tìm kiếm
 * @returns {Object} metadata object chứa thông tin bài báo
 */
function extractMetadataFromSearchResult(element) {
  switch (getSource()) {
    case 'ACM':     return extractFromACM(element);
    case 'IEEE':    return extractFromIEEE(element);
    case 'SCHOLAR': return extractFromGoogleScholar(element);
    default:        return extractGeneric(element);
  }
}

function errorMetadata(source) {
  return {
    title: 'Error extracting', authors: '', year: '', venue: '',
    doi: '', url: '', abstract: '', source
  };
}

// ---------- IEEE Xplore ----------
function extractFromIEEE(element) {
  try {
    // Link tiêu đề trỏ tới /document/<id> -> dùng làm URL (KHÔNG dùng URL trang search,
    // vì paperKey khử trùng theo URL, dùng chung URL sẽ gộp mọi paper làm một).
    const titleLink = element.querySelector(
      'h3.result-item-title a, h2.document-title a, a[href*="/document/"]'
    );
    const titleEl = titleLink ||
      element.querySelector('h2.document-title, .document-title span, h3 a, h3');
    const title = titleEl ? collapseWs(titleEl.textContent) : 'Unknown Title';
    const url = titleLink ? absUrl(titleLink.getAttribute('href')) : '';

    // Authors
    let authorEls = element.querySelectorAll('.author a span, .authors-info .author-name');
    if (authorEls.length === 0) authorEls = element.querySelectorAll('.author');
    const names = Array.from(authorEls)
      .map(el => collapseWs(el.textContent).replace(/[;,\s]+$/, ''))
      .filter(Boolean);
    const authors = names.length ? Array.from(new Set(names)).join('; ') : 'Unknown';

    // Year
    const yearEl = element.querySelector('.doc-abstract-pubdate, .publication-year');
    const infoEl = element.querySelector('.publisher-info-container, .description');
    const yearMatch =
      (yearEl && yearEl.textContent.match(/\b((?:19|20)\d{2})\b/)) ||
      (infoEl && infoEl.textContent.match(/Year:\s*((?:19|20)\d{2})/i)) ||
      element.textContent.match(/\b((?:19|20)\d{2})\b/);
    const year = yearMatch ? yearMatch[1] : 'Unknown';

    // Venue
    const venueEl = element.querySelector(
      '.description a[href*="/xpl/"], .doc-abstract-conference, .publication-title'
    );
    const venue = venueEl ? collapseWs(venueEl.textContent) : 'Unknown';

    // DOI (trang search IEEE thường không có -> để rỗng nếu không tìm thấy)
    const doiText = Array.from(
      element.querySelectorAll('a[href*="doi.org"], .doc-abstract-doi')
    ).map(el => (el.getAttribute('href') || '') + ' ' + el.textContent).join(' ');
    const doiMatch = doiText.match(DOI_REGEX);
    const doi = doiMatch ? doiMatch[0] : '';

    // Abstract (chỉ có nếu đã được render trong DOM)
    const abstractEl = element.querySelector('.abstract-text, .doc-abstract, .js-displayer-content');
    const abstract = abstractEl ? collapseWs(abstractEl.textContent).replace(/^Abstract:?\s*/i, '') : '';

    return { title, authors, year, venue, doi, url, abstract, source: 'IEEE' };
  } catch (error) {
    console.error('[SLR Scanner] IEEE extract error:', error);
    return errorMetadata('IEEE');
  }
}

// ---------- Google Scholar ----------
const SCHOLAR_TITLE_PREFIX = /^\s*\[(?:PDF|HTML|BOOK|B|CITATION|C)\]\s*/i;

/**
 * Tách dòng .gs_a: "Tác giả A, Tác giả B - Venue, 2023 - publisher.com"
 * Dấu phân cách là " - " (có khoảng trắng, có thể là nbsp) nên tên có dấu gạch
 * nối (vd. "Smith-Jones") không bị cắt nhầm.
 */
function parseScholarMeta(text) {
  const parts = (text || '').split(/[\s\u00a0]+-[\s\u00a0]+/).map(s => s.trim());
  const authors = (parts[0] || '')
    .split(',').map(s => s.replace(/…$/, '').trim()).filter(Boolean).join('; ');
  const yearMatch = (parts[1] || text || '').match(/\b((?:19|20)\d{2})\b/);
  const venue = (parts[1] || '')
    .replace(/,?\s*(?:19|20)\d{2}\s*$/, '').replace(/…$/, '').trim();
  return {
    authors: authors || 'Unknown',
    year: yearMatch ? yearMatch[1] : 'Unknown',
    venue: venue && !/^(?:19|20)\d{2}$/.test(venue) ? venue : 'Unknown'
  };
}

function extractFromGoogleScholar(element) {
  try {
    const titleEl = element.querySelector('.gs_rt');
    const linkEl = titleEl ? titleEl.querySelector('a') : null;
    const rawTitle = titleEl ? collapseWs((linkEl || titleEl).textContent) : '';
    const title = rawTitle.replace(SCHOLAR_TITLE_PREFIX, '') || 'Unknown Title';

    const metaEl = element.querySelector('.gs_a');
    const meta = parseScholarMeta(collapseWs(metaEl ? metaEl.textContent : ''));

    const href = linkEl ? linkEl.getAttribute('href') : '';
    const url = href && !href.startsWith('/scholar') ? absUrl(href) : '';
    const doiMatch = url.match(DOI_REGEX);

    return {
      title, authors: meta.authors, year: meta.year, venue: meta.venue,
      doi: doiMatch ? doiMatch[0] : '', url, abstract: '', source: 'Google Scholar'
    };
  } catch (error) {
    console.error('[SLR Scanner] Scholar extract error:', error);
    return errorMetadata('Google Scholar');
  }
}

// ---------- Fallback ----------
function extractGeneric(element) {
  const el = element.querySelector('h1, h2, h3, .title');
  return {
    title: el ? collapseWs(el.textContent) : 'Unknown Title',
    authors: '', year: '', venue: '', doi: '', url: '', abstract: '', source: 'Unknown'
  };
}

// ---------- ACM (logic gốc, giữ nguyên) ----------
function extractFromACM(element) {
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
 * Tìm và click nút "Next page" theo database hiện tại.
 * Lưu ý: luồng scan chính dùng điều hướng bằng URL (xem runScanStep) vì ổn định hơn;
 * hàm này là phương án click thủ công khi cần.
 * @returns {boolean} true nếu tìm thấy và click được
 */
async function goToNextPage() {
  const NEXT_BY_SOURCE = {
    ACM: [
      'a[aria-label="Next Page"]', 'a[aria-label="Next"]',
      'button[aria-label="Next Page"]', 'button[aria-label="Next"]',
      '.pagination__btn--next', 'a.pagination__btn--next',
      'li.page-item.active + li.page-item a',
      '[class*="pagination"] [class*="next"]:not([disabled])',
      'a[rel="next"]'
    ],
    IEEE: [
      'a[aria-label="Next Page"]', 'button[aria-label="Next Page"]',
      'li.next-btn button', '.next-page-btn', 'button[class*="next"]'
    ],
    SCHOLAR: [
      'button[aria-label="Next"]', '.gs_btnPR', '#gs_n a:last-child'
    ]
  };
  const NEXT_SELECTORS = NEXT_BY_SOURCE[getSource()] || [];
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
// Kiến trúc: mỗi trang kết quả là một lần điều hướng THẬT => content script bị
// huỷ và nạp lại ở mỗi trang. Vì vậy KHÔNG giữ state trong biến JS mà lưu vào
// chrome.storage.local (key 'scanState'). Mỗi lần content script nạp lại sẽ
// tự đọc state và làm tiếp. Khi xong ghi 'scanResults' để popup nhận.

const MAX_PAGES = 200;  // chốt chặn an toàn

/**
 * Cấu hình theo database. Mỗi database có cách phân trang riêng trên URL:
 *   ACM:     startPage (0-based) + pageSize
 *   IEEE:    pageNumber (1-based); rowsPerPage lấy từ URL, mặc định 25
 *   Scholar: start (offset = trang × 10); Google chỉ cho xem tối đa 1000 kết quả
 */
const SOURCES = {
  ACM: {
    label: 'ACM',
    maxPages: MAX_PAGES,
    delay: [600, 1200],
    scroll: true,
    isSearchPage: () => location.pathname.includes('/action/doSearch'),
    getPerPage: () => 20,
    getPageIndex: (u) => parseInt(u.searchParams.get('startPage'), 10) || 0,
    setPage: (u, page, perPage) => {
      u.searchParams.set('startPage', String(page));
      u.searchParams.set('pageSize', String(perPage));
    },
    resultSelectors: [
      '.issue-item', 'li.search__item', '.search__item',
      'article.issue-item', '[class*="issue-item"]'
    ],
    countRegex: /([\d,]+)/,
    bodyCountRegexes: [/([\d,]+)\s+results?\b/i]
  },
  IEEE: {
    label: 'IEEE',
    maxPages: MAX_PAGES,
    delay: [1500, 2500],
    scroll: true,
    isSearchPage: () => location.pathname.includes('/search/searchresult.jsp'),
    getPerPage: (u) => parseInt(u.searchParams.get('rowsPerPage'), 10) || 25,
    getPageIndex: (u) => (parseInt(u.searchParams.get('pageNumber'), 10) || 1) - 1,
    setPage: (u, page) => u.searchParams.set('pageNumber', String(page + 1)),
    resultSelectors: ['xpl-results-item', '.List-results-items', 'div.result-item'],
    countRegex: /\bof\s+([\d,]+)/i,
    bodyCountRegexes: [
      /Showing\s+[\d,]+\s*[-–]\s*[\d,]+\s+of\s+([\d,]+)/i,
      /([\d,]+)\s+results?\s+for\b/i
    ]
  },
  SCHOLAR: {
    label: 'Google Scholar',
    maxPages: 100,                 // 1000 kết quả / 10 mỗi trang
    delay: [3000, 6000],           // chậm hơn để tránh CAPTCHA
    scroll: false,
    isSearchPage: () => location.pathname === '/scholar',
    getPerPage: () => 10,
    getPageIndex: (u, perPage) =>
      Math.floor((parseInt(u.searchParams.get('start'), 10) || 0) / perPage),
    setPage: (u, page, perPage) => u.searchParams.set('start', String(page * perPage)),
    resultSelectors: ['.gs_r.gs_or', '#gs_res_ccl_mid .gs_r', 'div.gs_ri'],
    countRegex: /([\d,]+)\s+results?\b/i,
    bodyCountRegexes: [/([\d,]+)\s+results?\b/i]
  }
};

const getCfg = () => SOURCES[getSource()] || null;

/** URL của trang kết quả thứ `page` (0-based), giữ nguyên query search */
function buildPageUrl(page, perPage) {
  const u = new URL(location.href);
  getCfg().setPage(u, page, perPage);
  return u.toString();
}

const COUNT_SELECTORS = [
  // ACM
  '.result__count', '.search__item-count', '.results-count',
  // IEEE
  '.results-actions-selectall-text', '.Dashboard-header', '.result-count',
  // Google Scholar
  '#gs_ab_md .gs_ab_mdw', '.gs_ab_mdw',
  // Generic
  '[class*="result-count"]', '.items-results', 'span[data-total]', 'h2.result__title'
];

const toInt = s => parseInt(String(s).replace(/,/g, ''), 10);

/** Lấy tổng số kết quả từ text, theo regex của database hiện tại */
function parseTotalCount(text, regex) {
  const m = (text || '').match(regex);
  return m ? toInt(m[1]) : 0;
}

function detectTotalResults() {
  const cfg = getCfg();
  for (const sel of COUNT_SELECTORS) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const n = parseTotalCount(el.textContent || el.getAttribute('data-total') || '', cfg.countRegex);
    if (n > 0) return n;
  }
  const body = document.body.innerText || '';
  for (const re of cfg.bodyCountRegexes) {
    const n = parseTotalCount(body, re);
    if (n > 0) return n;
  }
  return 0;
}

function findResultElements() {
  const cfg = getCfg();
  for (const sel of (cfg ? cfg.resultSelectors : [])) {
    const found = document.querySelectorAll(sel);
    if (found.length > 0) return Array.from(found);
  }
  return Array.from(document.querySelectorAll('article'));
}

/** Google Scholar chặn bằng CAPTCHA khi truy cập nhiều trang liên tiếp */
function isBlockedPage() {
  if (getSource() !== 'SCHOLAR') return false;
  if (document.querySelector('#gs_captcha_ccl, #recaptcha, iframe[src*="recaptcha"], form#captcha-form')) return true;
  return /unusual traffic|not a robot|automated queries/i.test(document.body.innerText || '');
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
    const srcKey = getSource();
    const cfg = getCfg();
    if (!cfg || !cfg.isSearchPage()) return;
    // Không nối tiếp scan của database khác
    if (state.source && state.source !== srcKey) return;

    const perPage = state.perPage || cfg.getPerPage(new URL(location.href));

    // Luôn quét từ trang 0; nếu URL không khớp state.page thì điều hướng đúng chỗ
    if (cfg.getPageIndex(new URL(location.href), perPage) !== state.page) {
      state.redirects = (state.redirects || 0) + 1;
      if (state.redirects > 3) throw new Error('Không thể điều hướng tới trang ' + (state.page + 1));
      await saveScanState(state);
      location.href = buildPageUrl(state.page, perPage);
      return;
    }
    state.redirects = 0;

    const page = state.page;
    await updateScanProgress({
      currentPage: page + 1, totalPages: state.totalPages || page + 1,
      papersFound: state.papers.length, status: 'scanning'
    });

    const ok = await waitForResults();

    // CAPTCHA (Scholar): giữ nguyên state, đợi người dùng giải. Sau khi giải, trang tải
    // lại -> content script nạp lại -> tự động quét tiếp.
    if (!ok && isBlockedPage()) {
      console.warn('[SLR Scanner] Bị chặn bởi CAPTCHA, đang chờ người dùng xử lý.');
      await updateScanProgress({
        currentPage: page + 1, totalPages: state.totalPages || page + 1,
        papersFound: state.papers.length, status: 'blocked'
      });
      return;
    }
    if (ok && cfg.scroll) await scrollToBottom();

    if (page === 0) {
      state.totalResults = detectTotalResults();
      state.totalPages   = state.totalResults > 0
        ? Math.min(Math.ceil(state.totalResults / perPage), cfg.maxPages) : 0;
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
      page + 1 >= cfg.maxPages;

    await updateScanProgress({
      currentPage: page + 1, totalPages: totalPages || page + 1,
      papersFound: state.papers.length, status: 'extracted'
    });

    if (isLast) {
      await finishScan(state, 'completed');
    } else {
      state.page = page + 1;
      await saveScanState(state);            // lưu TRƯỚC khi điều hướng
      const [lo, hi] = cfg.delay;
      await sleep(lo + Math.random() * (hi - lo)); // nhẹ tay với server
      location.href = buildPageUrl(state.page, perPage);
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
          const srcKey = getSource();
          const cfg = getCfg();
          if (!cfg || !cfg.isSearchPage()) {
            sendResponse({ success: false, error: 'Not a search page. Please open an ACM, IEEE Xplore or Google Scholar search results page first.' });
            break;
          }
          await chrome.storage.local.remove(['scanResults', 'scanProgress']);
          await saveScanState({
            active: true, source: srcKey,
            perPage: cfg.getPerPage(new URL(location.href)),
            page: 0, papers: [],
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
if (getCfg() && getCfg().isSearchPage()) {
  setTimeout(() => { runScanStep(); }, 500);
}

})();
