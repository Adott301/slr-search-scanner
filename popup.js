// popup.js - SLR Search Scanner Popup Logic
// Author: Nguyen Tien Dat - SWT301 RBL Group04
// Updated: Đa nguồn, dropdown đổi text nút, giới hạn 500+ papers

'use strict';

// ============================================================
// CONFIG & GLOBALS
// ============================================================

/** Khóa SerpApi mặc định chạy ngầm */
const HARDCODED_SERPAPI_KEY = "772f2da637b469a9b87553d1043e8dbc1716044d1bced4846f7d230fd9e7e167";

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

/**
 * Cấu hình nguồn quét.
 * SerpApi không có engine riêng cho ACM/IEEE/Springer... nên dùng:
 *  - engine "google_scholar" cho Google Scholar
 *  - engine "google" + toán tử site: để quét từng nguồn
 * pageSize: số kết quả mỗi request (Scholar tối đa 20, Google dùng 10).
 */
const ALL_SITES_FILTER = '(' + [
  'dl.acm.org', 'ieeexplore.ieee.org', 'link.springer.com', 'sciencedirect.com',
  'arxiv.org', 'semanticscholar.org', 'dblp.org'
].map(d => `site:${d}`).join(' OR ') + ')';

const SOURCE_CONFIG = {
  // --- API học thuật gọi trực tiếp (không qua SerpApi, không tốn credit) ---
  'openalex_api':     { name: 'OpenAlex (API trực tiếp)',          engine: 'openalex', pageSize: 100,  siteFilter: null },
  's2_api':           { name: 'Semantic Scholar (API trực tiếp)',  engine: 's2',       pageSize: 1000, siteFilter: null },
  'all':              { name: 'Google Scholar',      engine: 'google_scholar', pageSize: 20, siteFilter: null },
  'all_google':       { name: 'Tất cả (Google Search)', engine: 'google',      pageSize: 10, siteFilter: ALL_SITES_FILTER },
  'acm':              { name: 'ACM Digital Library', engine: 'google',         pageSize: 10, siteFilter: 'site:dl.acm.org' },
  'ieee':             { name: 'IEEE Xplore',         engine: 'google',         pageSize: 10, siteFilter: 'site:ieeexplore.ieee.org' },
  'springer':         { name: 'Springer Link',       engine: 'google',         pageSize: 10, siteFilter: 'site:link.springer.com' },
  'sciencedirect':    { name: 'ScienceDirect',       engine: 'google',         pageSize: 10, siteFilter: 'site:sciencedirect.com' },
  'arxiv':            { name: 'arXiv',               engine: 'google',         pageSize: 10, siteFilter: 'site:arxiv.org' },
  'semantic_scholar': { name: 'Semantic Scholar',    engine: 'google',         pageSize: 10, siteFilter: 'site:semanticscholar.org' },
  'dblp':             { name: 'DBLP',                engine: 'google',         pageSize: 10, siteFilter: 'site:dblp.org' },
  // Các nguồn cũ (không có domain mở): giữ nguyên cách lọc source: trên Google Scholar
  'openalex_crossref':{ name: 'OpenAlex/Crossref (lọc qua Scholar)', engine: 'google_scholar', pageSize: 20, siteFilter: 'source:Crossref' },
  'pubmed':           { name: 'PubMed',              engine: 'google_scholar', pageSize: 20, siteFilter: 'source:PubMed' },
  'embase':           { name: 'Embase',              engine: 'google_scholar', pageSize: 20, siteFilter: 'source:Embase' },
  'cochrane':         { name: 'Cochrane',            engine: 'google_scholar', pageSize: 20, siteFilter: 'source:Cochrane' },
  'wos':              { name: 'Web of Science',      engine: 'google_scholar', pageSize: 20, siteFilter: 'source:"Web of Science"' },
  'scopus':           { name: 'Scopus',              engine: 'google_scholar', pageSize: 20, siteFilter: 'source:Scopus' }
};

function isApiSource(key) {
  const c = SOURCE_CONFIG[key];
  return !!c && (c.engine === 'openalex' || c.engine === 's2');
}

function getScanButtonText(key) {
  return isApiSource(key)
    ? `⚡ Quét ${getSourceName(key)}`
    : `⚡ Quét ${getSourceName(key)} bằng SerpApi`;
}

function getSourceName(key) {
  return (SOURCE_CONFIG[key] && SOURCE_CONFIG[key].name) || 'Database';
}

// ============================================================
// REAL-TIME PROGRESS
// ============================================================

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

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
  bar.style.width = `${Math.min(pct, 99)}%`;
  label.textContent = `Đang quét... Trang ${p.currentPage}/${p.totalPages} — ${p.papersFound} papers`;

  if (p.status === 'scanning') {
    sub.textContent = `Đang scroll trang ${p.currentPage} để load lazy content...`;
  } else if (p.status === 'extracted') {
    sub.textContent = `Đã extract trang ${p.currentPage}. ${p.papersFound} papers tích lũy.`;
  } else if (p.status === 'blocked') {
    sub.textContent = '⚠️ Google Scholar yêu cầu CAPTCHA – hãy giải CAPTCHA trong tab, scan sẽ tự tiếp tục.';
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

function generatePaperId(index, prefix = 'S') {
  return prefix + String(index + 1).padStart(3, '0');
}

function generateFileName(metadata, index) {
  const safeTitle = (metadata.title || 'unknown')
    .substring(0, 30)
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return `${index}_${safeTitle}.pdf`;
}

function scoreRelevance(metadata) {
  let score = 0;
  const matchedCriteria = [];
  const titleLower = (metadata.title || '').toLowerCase();
  const abstractLower = (metadata.abstract || '').toLowerCase();
  const combined = titleLower + ' ' + abstractLower;
  const year = parseInt(metadata.year) || 0;

  if (combined.includes('java') || combined.includes('unit test') || combined.includes('unit testing')) {
    score += 20;
    matchedCriteria.push('IC-P: Java/unit test (+20)');
  }
  if (combined.includes('llm') || combined.includes('chatgpt') || combined.includes('claude') ||
      combined.includes('large language model') || combined.includes('gpt')) {
    score += 20;
    matchedCriteria.push('IC-I: LLM/ChatGPT/Claude (+20)');
  }
  if (combined.includes('evosuite') || combined.includes('comparison') ||
      combined.includes('compare') || combined.includes('versus') || combined.includes('benchmark')) {
    score += 15;
    matchedCriteria.push('IC-C: Comparison/EvoSuite (+15)');
  }
  if (combined.includes('coverage') || combined.includes('compile') || combined.includes('compilation') ||
      combined.includes('mutation') || combined.includes('success rate') ||
      combined.includes('executable') || combined.includes('correctness')) {
    score += 15;
    matchedCriteria.push('IC-O: Coverage/compile/executable (+15)');
  }
  if (year >= 2018) {
    score += 10;
    matchedCriteria.push(`IC-T: Year ${year} >= 2018 (+10)`);
  }
  if (/[a-zA-Z]/.test(metadata.title || '')) {
    score += 10;
    matchedCriteria.push('IC-L: English/Latin (+10)');
  }
  if (metadata.doi && metadata.doi.trim() !== '') {
    score += 10;
    matchedCriteria.push('IC-E: DOI available (+10)');
  }
  const isSurveyOrReview =
    (combined.includes('survey') || combined.includes('review')) &&
    !combined.includes('systematic literature review');
  if (isSurveyOrReview) {
    score -= 50;
    matchedCriteria.push('EC-N: Survey/review → -50');
  }
  if (year > 0 && year < 2018) {
    score -= 100;
    matchedCriteria.push(`EC-Y: Year ${year} < 2018 → -100`);
  }

  score = Math.max(0, Math.min(100, score));
  const decision = score >= 70 ? 'INCLUDE' : 'EXCLUDE';
  return { score, decision, matchedCriteria };
}

function buildCSV(papers, searchString = '') {
  const safeStr = (str) => `"${String(str || '').replace(/"/g, '""')}"`;
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

function downloadFile(content, filename, mimeType = 'text/csv;charset=utf-8;') {
  const blob = new Blob(['\uFEFF' + content], { type: mimeType });
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

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
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

function showStatus(id, msg, type = 'info') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `status-msg ${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function getScoreClass(score) {
  if (score >= 70) return 'score-high';
  if (score >= 40) return 'score-mid';
  return 'score-low';
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

// ============================================================
// AUTO SYNC SEARCH QUERY FROM ACTIVE TAB
// ============================================================

async function syncSearchQueryFromActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;

    const url = new URL(tab.url);
    let detectedQuery = '';

    if (url.hostname.includes('dl.acm.org')) {
      detectedQuery = url.searchParams.get('AllField') || url.searchParams.get('fillQuickSearch') || '';
    } else if (url.hostname.includes('ieeexplore.ieee.org')) {
      detectedQuery = url.searchParams.get('queryText') || '';
    } else if (url.hostname.includes('scholar.google.com')) {
      detectedQuery = url.searchParams.get('q') || '';
    }

    if (!detectedQuery && (url.hostname.includes('acm.org') || url.hostname.includes('ieee.org') || url.hostname.includes('scholar.google.com'))) {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const input = document.querySelector(
            'input[name="AllField"], input[name="queryText"], input[name="q"], #gs_hdr_tsi, .search__field, input.query-field'
          );
          return input ? input.value : '';
        }
      }).catch(() => []);

      if (results && results[0] && results[0].result) {
        detectedQuery = results[0].result;
      }
    }

    if (detectedQuery && detectedQuery.trim()) {
      const queryEl = document.getElementById('search-string');
      if (queryEl) queryEl.value = detectedQuery.trim();
    }
  } catch (err) {
    console.warn('[Popup] Không thể tự động đồng bộ search query:', err);
  }
}

// ============================================================
// SERPAPI ENGINE INTEGRATION
// ============================================================

function parseSerpApiScholarItem(item) {
  const title = (item.title || 'Unknown Title').replace(/\[(PDF|HTML|BOOK|CITATION)\]/gi, '').trim();
  const url = item.link || '';
  const abstract = item.snippet || '';

  let authors = 'Unknown';
  let year = 'Unknown';
  let venue = 'Unknown';

  if (item.publication_info && item.publication_info.summary) {
    const summary = item.publication_info.summary;
    const parts = summary.split(/\s+-\s+/);
    if (parts.length > 0) authors = parts[0].replace(/…/g, '').trim();
    const yearMatch = summary.match(/\b((?:19|20)\d{2})\b/);
    if (yearMatch) year = yearMatch[1];
    if (parts.length > 1) {
      venue = parts[1].replace(/,?\s*(?:19|20)\d{2}/, '').replace(/…/g, '').trim() || 'Unknown';
    }
  }

  const doiRegex = /10\.\d{4,}\/[^\s?#]+/;
  const doiMatch = url.match(doiRegex) || abstract.match(doiRegex);
  const doi = doiMatch ? doiMatch[0] : '';

  return { title, authors, year, venue, doi, url, abstract, source: 'Google Scholar (SerpApi)' };
}

function parseSerpApiGoogleItem(item) {
  const title = (item.title || 'Unknown Title').trim();
  const url = item.link || '';
  const abstract = item.snippet || '';

  // Năm: ưu tiên trường date của Google, sau đó tới snippet
  const yearMatch = (item.date || '').match(/\b((?:19|20)\d{2})\b/) ||
                    abstract.match(/\b((?:19|20)\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : 'Unknown';

  const doiRegex = /10\.\d{4,}\/[^\s?#]+/;
  const doiMatch = url.match(doiRegex) || abstract.match(doiRegex);
  const doi = doiMatch ? doiMatch[0] : '';

  let source = 'Google Search';
  if (url.includes('dl.acm.org')) source = 'ACM';
  else if (url.includes('ieeexplore.ieee.org')) source = 'IEEE';
  else if (url.includes('link.springer.com')) source = 'Springer';
  else if (url.includes('sciencedirect.com')) source = 'ScienceDirect';
  else if (url.includes('arxiv.org')) source = 'arXiv';
  else if (url.includes('semanticscholar.org')) source = 'Semantic Scholar';
  else if (url.includes('dblp.org')) source = 'DBLP';

  return { title, authors: 'Unknown', year, venue: 'Unknown', doi, url, abstract, source };
}

const SERPAPI_TIMEOUT_MS = 20000; // tối đa 20s mỗi request
const SERPAPI_CONCURRENCY = 3; // số trang gọi song song mỗi đợt

/** Gọi 1 trang SerpApi, retry 1 lần. Trả về { data } hoặc { error } */
async function fetchSerpApiPage(config, finalQuery, apiKey, start) {
  const endpoint = new URL('https://serpapi.com/search.json');
  endpoint.searchParams.set('engine', config.engine);
  endpoint.searchParams.set('q', finalQuery);
  endpoint.searchParams.set('start', String(start));
  endpoint.searchParams.set('num', String(config.pageSize));
  endpoint.searchParams.set('api_key', apiKey);

  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SERPAPI_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint.toString(), { signal: controller.signal });
      const json = await response.json().catch(() => null);
      clearTimeout(timer);
      if (response.ok && json && !(json.error && !json.organic_results)) {
        return { data: json };
      }
      lastError = json?.error || `Lỗi HTTP ${response.status}: ${response.statusText}`;
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') {
        // Quá lâu -> không retry (retry sẽ chờ thêm lần nữa)
        return { error: `Quá ${SERPAPI_TIMEOUT_MS / 1000}s không phản hồi (query có thể quá dài/phức tạp)` };
      }
      lastError = e.message;
    }
    if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
  }
  return { error: lastError };
}

function paperDedupKey(p) {
  const t = String(p.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return (p.url || '') + '|' + t;
}

/**
 * Quét SerpApi, hỗ trợ quét tiếp.
 * @param opts.startPage  trang bắt đầu (0-based) – dùng khi "quét tiếp"
 * @param opts.seenKeys   Set các dedup-key đã có từ lần quét trước
 * @param opts.stateOut   object nhận { nextPage, exhausted } sau khi quét
 */
async function fetchPapersViaSerpApi(query, apiKey, targetLimit, onProgressUpdate, sourceKey = 'all', opts = {}) {
  const config = SOURCE_CONFIG[sourceKey] || SOURCE_CONFIG['all'];
  const results = [];
  const seenKeys = opts.seenKeys || new Set();
  const stateOut = opts.stateOut || {};
  const pageSize = config.pageSize;
  const startPage = opts.startPage || 0;
  const pagesToFetch = Math.ceil(targetLimit / pageSize);
  const endPage = startPage + pagesToFetch;            // không bao gồm
  const finalQuery = config.siteFilter ? `${query} ${config.siteFilter}` : query;

  if (config.engine === 'google' && finalQuery.length > 250) {
    onProgressUpdate(startPage + 1, endPage, 0,
      `⚠️ Query dài ${finalQuery.length} ký tự — Google Search thường chậm/lỗi với query dài. Nên rút gọn còn ~3 nhóm OR.`);
    await new Promise(r => setTimeout(r, 1500));
  }

  let nextPage = startPage;   // trang kế tiếp chưa xử lý
  let exhausted = false;      // Google/Scholar không còn kết quả

  while (!exhausted && nextPage < endPage) {
    const batchPages = [];
    for (let i = 0; i < SERPAPI_CONCURRENCY && nextPage + i < endPage; i++) {
      batchPages.push(nextPage + i);
    }
    onProgressUpdate(batchPages[0] + 1, endPage, results.length,
      `Đang gửi ${batchPages.length} request song song tới SerpApi (${config.engine})...`);

    const batch = await Promise.all(
      batchPages.map(p => fetchSerpApiPage(config, finalQuery, apiKey, p * pageSize))
    );

    for (let i = 0; i < batch.length; i++) {
      const pageNo = batchPages[i] + 1;
      const { data, error } = batch[i];

      if (error) {
        if (results.length > 0 || startPage > 0) {
          console.warn('[SerpApi] Dừng sớm ở trang', pageNo, ':', error);
          onProgressUpdate(pageNo, endPage, results.length,
            `⚠️ Dừng ở trang ${pageNo} (${error}). Giữ ${results.length} bài đã lấy.`);
          exhausted = true;
          stateOut.error = error;
          break;
        }
        throw new Error(error);
      }

      const items = data.organic_results || [];
      if (items.length === 0) { exhausted = true; break; }

      for (const item of items) {
        const paper = config.engine === 'google_scholar'
          ? parseSerpApiScholarItem(item)
          : parseSerpApiGoogleItem(item);
        const key = paperDedupKey(paper);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        results.push(paper);
      }

      nextPage = batchPages[i] + 1;   // trang này đã xử lý trọn vẹn
      onProgressUpdate(pageNo, endPage, results.length, `Đã lấy xong trang ${pageNo}.`);

      if (!data.serpapi_pagination || !data.serpapi_pagination.next) { exhausted = true; break; }
    }
  }

  stateOut.nextPage = nextPage;
  stateOut.exhausted = exhausted;
  return results;
}

// ============================================================
// METADATA ENRICHMENT (Semantic Scholar batch + OpenAlex fallback)
// Lấy abstract / authors / venue / year / DOI thật cho kết quả chỉ có snippet
// ============================================================

const DOI_REGEX = /10\.\d{4,}\/[^\s?#"<>]+/;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function cleanTitleForSearch(title) {
  return String(title || '')
    .replace(/\[(PDF|HTML|BOOK|CITATION)\]/gi, '')
    .replace(/(…|\.\.\.)\s*$/, '')
    .trim();
}

function titleSimilarity(a, b) {
  const tok = t => new Set(String(t || '').toLowerCase().match(/[a-z0-9]+/g) || []);
  const A = tok(a), B = tok(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach(x => { if (B.has(x)) inter++; });
  return inter / Math.min(A.size, B.size);
}

/** Tìm định danh dùng được cho Semantic Scholar batch */
function getS2Id(paper) {
  const url = paper.url || '';
  const arx = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}|[a-z\-]+(?:\.[A-Za-z]{2})?\/\d{7})/i);
  if (arx) return { id: `ARXIV:${arx[1]}`, arxivId: arx[1] };
  const s2 = url.match(/semanticscholar\.org\/paper\/(?:[^/]+\/)?([0-9a-f]{40})/i);
  if (s2) return { id: s2[1] };
  const doi = (paper.doi || '').replace(/[.,;)\]]+$/, '');
  if (doi) return { id: `DOI:${doi}` };
  return null;
}

function mergeEnrichedInfo(paper, info) {
  if (!info) return false;
  let changed = false;
  if (info.abstract && info.abstract.length > (paper.abstract || '').length) {
    paper.abstract = info.abstract; changed = true;
  }
  const noAuthors = !paper.authors || paper.authors === 'Unknown';
  if (noAuthors && info.authors && info.authors.length) {
    paper.authors = info.authors.join('; '); changed = true;
  }
  if ((!paper.year || paper.year === 'Unknown') && info.year) {
    paper.year = String(info.year); changed = true;
  }
  if ((!paper.venue || paper.venue === 'Unknown') && info.venue) {
    paper.venue = info.venue; changed = true;
  }
  if (!paper.doi && info.doi) {
    paper.doi = String(info.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''); changed = true;
  }
  if (/(…|\.\.\.)\s*$/.test(paper.title || '') && info.title) {
    paper.title = info.title; changed = true;
  }
  if (changed) paper.enriched = true;
  return changed;
}

/** Semantic Scholar: gửi theo lô tối đa 100 id/request */
async function enrichViaSemanticScholar(papers, onProgress) {
  const targets = [];
  papers.forEach(p => {
    const ref = getS2Id(p);
    if (ref) {
      if (ref.arxivId && !p.doi) p.doi = `10.48550/arXiv.${ref.arxivId}`;
      targets.push({ paper: p, id: ref.id });
    }
  });

  const CHUNK = 100;
  const fields = 'title,abstract,authors,year,venue,externalIds';
  for (let i = 0; i < targets.length; i += CHUNK) {
    const chunk = targets.slice(i, i + CHUNK);
    onProgress(`🧬 Semantic Scholar: ${Math.min(i + CHUNK, targets.length)}/${targets.length} bài...`);
    let data = null;
    for (let attempt = 1; attempt <= 2 && !data; attempt++) {
      try {
        const res = await fetch(
          `https://api.semanticscholar.org/graph/v1/paper/batch?fields=${fields}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: chunk.map(c => c.id) })
          }
        );
        if (res.status === 429) { await sleep(3000); continue; }
        if (!res.ok) break;
        data = await res.json();
      } catch (e) {
        console.warn('[Enrich] S2 lỗi:', e.message);
        break;
      }
    }
    if (!Array.isArray(data)) continue;
    data.forEach((info, idx) => {
      if (!info) return;
      mergeEnrichedInfo(chunk[idx].paper, {
        title: info.title,
        abstract: info.abstract,
        authors: (info.authors || []).map(a => a.name).filter(Boolean),
        year: info.year,
        venue: info.venue,
        doi: info.externalIds && info.externalIds.DOI
      });
    });
    await sleep(300);
  }
}

function openAlexAbstract(inv) {
  if (!inv) return '';
  const words = [];
  Object.keys(inv).forEach(w => inv[w].forEach(pos => { words[pos] = w; }));
  return words.join(' ').trim();
}

function openAlexToInfo(w) {
  return {
    title: w.title,
    abstract: openAlexAbstract(w.abstract_inverted_index),
    authors: (w.authorships || []).map(a => a.author && a.author.display_name).filter(Boolean),
    year: w.publication_year,
    venue: w.primary_location && w.primary_location.source && w.primary_location.source.display_name,
    doi: w.doi
  };
}

/** OpenAlex: theo DOI nếu có, không thì tìm theo title (có kiểm tra độ giống) */
async function enrichOneViaOpenAlex(paper) {
  const select = 'title,doi,publication_year,authorships,primary_location,abstract_inverted_index';
  try {
    if (paper.doi) {
      const res = await fetch(
        `https://api.openalex.org/works/doi:${encodeURIComponent(paper.doi)}?select=${select}`);
      if (res.ok) return mergeEnrichedInfo(paper, openAlexToInfo(await res.json()));
    }
    const q = cleanTitleForSearch(paper.title);
    if (q.length < 15) return false;
    const res = await fetch(
      `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=3&select=${select}`);
    if (!res.ok) return false;
    const json = await res.json();
    const best = (json.results || [])
      .map(w => ({ w, sim: titleSimilarity(q, w.title) }))
      .sort((a, b) => b.sim - a.sim)[0];
    if (best && best.sim >= 0.8) return mergeEnrichedInfo(paper, openAlexToInfo(best.w));
  } catch (e) {
    console.warn('[Enrich] OpenAlex lỗi:', e.message);
  }
  return false;
}

async function enrichViaOpenAlex(papers, onProgress) {
  const todo = papers.filter(p =>
    !p.abstract || p.abstract.length < 250 || !p.authors || p.authors === 'Unknown');
  const POOL = 4;
  let idx = 0, done = 0;
  async function worker() {
    while (idx < todo.length) {
      const p = todo[idx++];
      await enrichOneViaOpenAlex(p);
      done++;
      if (done % 5 === 0 || done === todo.length) {
        onProgress(`🧬 OpenAlex: ${done}/${todo.length} bài...`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(POOL, todo.length) }, worker));
}

/** Làm giàu metadata tại chỗ (mutate). Không bao giờ ném lỗi ra ngoài. */
async function enrichPapers(papers, onProgress = () => {}) {
  try {
    await enrichViaSemanticScholar(papers, onProgress);
    await enrichViaOpenAlex(papers, onProgress);
  } catch (e) {
    console.warn('[Enrich] Bỏ qua do lỗi:', e);
  }
  const n = papers.filter(p => p.enriched).length;
  onProgress(`🧬 Đã bổ sung metadata cho ${n}/${papers.length} bài.`);
  return n;
}

// ============================================================
// ACADEMIC API SOURCES (OpenAlex / Semantic Scholar) – gọi trực tiếp
// ============================================================

const OPENALEX_PER_PAGE = 100;

/** GET JSON có timeout + retry khi 429. Trả về { data } hoặc { error } */
async function getJsonWithRetry(url, retries429 = 2) {
  for (let attempt = 0; attempt <= retries429; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (res.status === 429 && attempt < retries429) { await sleep(3000 * (attempt + 1)); continue; }
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        return { error: (json && (json.error || json.message)) || `Lỗi HTTP ${res.status}: ${res.statusText}` };
      }
      return { data: json };
    } catch (e) {
      clearTimeout(timer);
      return { error: e.name === 'AbortError' ? 'Quá 30s không phản hồi' : e.message };
    }
  }
  return { error: 'Bị giới hạn tốc độ (429), thử lại sau ít phút' };
}

function openAlexWorkToPaper(w) {
  const info = openAlexToInfo(w);
  const doi = info.doi ? String(info.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') : '';
  const loc = w.primary_location || {};
  const url = loc.landing_page_url || (doi ? `https://doi.org/${doi}` : (w.id || ''));
  return {
    title: (info.title || 'Unknown Title').trim(),
    authors: info.authors.length ? info.authors.join('; ') : 'Unknown',
    year: info.year ? String(info.year) : 'Unknown',
    venue: info.venue || 'Unknown',
    doi, url,
    abstract: info.abstract || '',
    source: 'OpenAlex'
  };
}

async function fetchOpenAlexSearch(query, targetLimit, onProgress, opts) {
  const results = [];
  const seenKeys = opts.seenKeys || new Set();
  const stateOut = opts.stateOut || {};
  const startPage = opts.startPage || 0;
  const endPage = startPage + Math.ceil(targetLimit / OPENALEX_PER_PAGE);
  const cleaned = query.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

  const filters = [`title_and_abstract.search:${cleaned}`];
  if (opts.minYear) filters.push(`publication_year:>${opts.minYear - 1}`);
  const select = 'id,title,doi,publication_year,authorships,primary_location,abstract_inverted_index';

  let page = startPage, exhausted = false, total = null;
  while (!exhausted && page < endPage) {
    onProgress(page + 1, endPage, results.length,
      total != null ? `OpenAlex có ${total} bài khớp — đang lấy trang ${page + 1}...` : 'Đang gọi OpenAlex API...');
    const url = 'https://api.openalex.org/works?filter=' + encodeURIComponent(filters.join(',')) +
      `&per-page=${OPENALEX_PER_PAGE}&page=${page + 1}&select=${select}`;
    const { data, error } = await getJsonWithRetry(url);

    if (error) {
      if (results.length > 0 || startPage > 0) { exhausted = true; stateOut.error = error; break; }
      throw new Error(error);
    }
    const items = data.results || [];
    total = data.meta && data.meta.count;
    if (items.length === 0) { exhausted = true; break; }

    for (const w of items) {
      const paper = openAlexWorkToPaper(w);
      const key = paperDedupKey(paper);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      results.push(paper);
    }
    page++;
    onProgress(page, endPage, results.length, `Đã lấy xong trang ${page}.`);
    // OpenAlex chỉ cho phân trang cơ bản tới 10.000 kết quả
    if ((total != null && page * OPENALEX_PER_PAGE >= total) || page * OPENALEX_PER_PAGE >= 10000) {
      exhausted = true;
    }
    await sleep(150);
  }
  stateOut.nextPage = page;
  stateOut.exhausted = exhausted;
  stateOut.total = total;
  return results;
}

/** Chuyển cú pháp AND/OR/NOT sang cú pháp của Semantic Scholar bulk search */
function toS2Query(q) {
  return String(q).replace(/\bAND\b/g, '+').replace(/\bOR\b/g, '|').replace(/\bNOT\b/g, '-')
    .replace(/\s+/g, ' ').trim();
}

async function fetchS2BulkSearch(query, targetLimit, onProgress, opts) {
  const results = [];
  const seenKeys = opts.seenKeys || new Set();
  const stateOut = opts.stateOut || {};
  const fields = 'title,abstract,authors,year,venue,externalIds,url';
  const q = toS2Query(query);
  let token = opts.token || null;
  let calls = opts.startPage || 0;
  let exhausted = false;

  // Mỗi request bulk trả tối đa ~1000 bài; giữ trọn cả đợt để quét tiếp không bị mất bài
  while (!exhausted && results.length < targetLimit) {
    onProgress(calls + 1, calls + 1, results.length, 'Đang gọi Semantic Scholar API...');
    const url = 'https://api.semanticscholar.org/graph/v1/paper/search/bulk' +
      `?query=${encodeURIComponent(q)}&fields=${fields}` +
      (opts.minYear ? `&year=${opts.minYear}-` : '') +
      (token ? `&token=${encodeURIComponent(token)}` : '');
    const { data, error } = await getJsonWithRetry(url, 3);

    if (error) {
      if (results.length > 0 || calls > 0) { exhausted = true; stateOut.error = error; break; }
      throw new Error(error);
    }
    const items = data.data || [];
    for (const it of items) {
      const doi = (it.externalIds && it.externalIds.DOI) || '';
      const paper = {
        title: (it.title || 'Unknown Title').trim(),
        authors: (it.authors && it.authors.length) ? it.authors.map(a => a.name).filter(Boolean).join('; ') : 'Unknown',
        year: it.year ? String(it.year) : 'Unknown',
        venue: it.venue || 'Unknown',
        doi,
        url: it.url || (doi ? `https://doi.org/${doi}` : ''),
        abstract: it.abstract || '',
        source: 'Semantic Scholar'
      };
      const key = paperDedupKey(paper);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      results.push(paper);
    }
    calls++;
    token = data.token || null;
    onProgress(calls, calls, results.length, `Semantic Scholar: khớp ${data.total ?? '?'} bài, đã lấy ${results.length}.`);
    if (items.length === 0 || !token) exhausted = true;
    await sleep(500);
  }
  stateOut.nextPage = calls;
  stateOut.nextToken = token;
  stateOut.exhausted = exhausted;
  return results;
}

async function fetchPapersViaAcademicApi(query, targetLimit, onProgress, sourceKey, opts = {}) {
  const cfg = SOURCE_CONFIG[sourceKey];
  return cfg.engine === 'openalex'
    ? fetchOpenAlexSearch(query, targetLimit, onProgress, opts)
    : fetchS2BulkSearch(query, targetLimit, onProgress, opts);
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

      if (target === 'tab-history') loadHistory();
      if (target === 'tab-scan') syncSearchQueryFromActiveTab();
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

  extractBtn.addEventListener('click', async () => {
    extractBtn.disabled = true;
    extractBtn.textContent = '⏳ Đang extract...';
    showStatus('extract-status', 'Đang lấy metadata...', 'info');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      let response;
      try {
        response = await chrome.tabs.sendMessage(tab.id, { action: 'extractSingle' });
      } catch {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        await new Promise(r => setTimeout(r, 500));
        response = await chrome.tabs.sendMessage(tab.id, { action: 'extractSingle' });
      }

      if (!response || !response.success) {
        throw new Error(response?.error || 'Không thể extract metadata. Vui lòng mở trang paper ACM.');
      }

      currentMetadata = response.data;
      const scored = scoreRelevance(currentMetadata);

      document.getElementById('f-title').value    = currentMetadata.title    || '';
      document.getElementById('f-authors').value  = currentMetadata.authors  || '';
      document.getElementById('f-year').value     = currentMetadata.year     || '';
      document.getElementById('f-source').value   = currentMetadata.source   || 'ACM';
      document.getElementById('f-venue').value    = currentMetadata.venue    || '';
      document.getElementById('f-doi').value      = currentMetadata.doi      || '';
      document.getElementById('f-url').value      = currentMetadata.url      || '';
      document.getElementById('f-abstract').value = currentMetadata.abstract || '';

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

  copyCsvBtn.addEventListener('click', async () => {
    if (!currentMetadata) return;
    const scored = scoreRelevance(currentMetadata);
    const csv = buildCSV([{ metadata: currentMetadata, scored, id: 'P001' }]);
    await copyToClipboard(csv);
    showStatus('extract-status', '📋 Đã copy CSV vào clipboard!', 'success');
  });

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
// TAB 2: DETAILED LIST HELPERS
// ============================================================

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
          <div class="meta-row"><span class="meta-label">👥 Tác giả:</span><span class="meta-value">${safeAuthors}</span></div>
          <div class="meta-row"><span class="meta-label">📅 Năm:</span><span class="meta-value">${safeYear}</span></div>
          <div class="meta-row"><span class="meta-label">🏛️ Venue:</span><span class="meta-value">${safeVenue}</span></div>
          <div class="meta-row"><span class="meta-label">🔗 DOI:</span><span class="meta-value">${m.doi ? `<a href="https://doi.org/${m.doi}" target="_blank">${safeDoi}</a>` : 'N/A'}</span></div>
          <div class="meta-row"><span class="meta-label">🌐 URL:</span><span class="meta-value">${m.url ? `<a href="${safeUrl}" target="_blank">${safeUrl}</a>` : 'N/A'}</span></div>
          <div class="meta-row"><span class="meta-label">✅ Tiêu chí:</span><span class="meta-value criteria-text">${safeCriteria || '—'}</span></div>
        </div>
        <div class="paper-actions">
          <button class="btn-copy-link" data-url="${safeUrl}">🔗 Copy link</button>
          <button class="btn-google" data-title="${escapeHtml(m.title || '')}">🔍 Tìm trên Google</button>
          <button class="btn-toggle-decision" data-list-idx="${index}">
            ${s.decision === 'INCLUDE' ? '❌ Mark Exclude' : '✅ Mark Include'}
          </button>
        </div>
      </div>
    `;
  }).join('');

  attachListEventListeners(results);
}

function attachListEventListeners(results) {
  document.querySelectorAll('.btn-copy-link').forEach(btn => {
    btn.addEventListener('click', async () => {
      const url = btn.dataset.url;
      if (!url) { alert('Paper này không có URL.'); return; }
      try {
        await navigator.clipboard.writeText(url);
        btn.textContent = '✅ Đã copy!';
        setTimeout(() => { btn.textContent = '🔗 Copy link'; }, 1800);
      } catch { alert('❌ Không thể copy.'); }
    });
  });

  document.querySelectorAll('.btn-google').forEach(btn => {
    btn.addEventListener('click', () => {
      const title = btn.dataset.title;
      if (!title) return;
      window.open(`https://www.google.com/search?q=${encodeURIComponent(title)}`, '_blank');
    });
  });

  document.querySelectorAll('.btn-toggle-decision').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.listIdx);
      const item = results[idx];
      if (!item) return;
      if (item.scored.decision === 'INCLUDE') {
        item.scored.decision = 'EXCLUDE';
        item.scored.score = Math.max(0, item.scored.score - 70);
      } else {
        item.scored.decision = 'INCLUDE';
        item.scored.score = Math.min(100, item.scored.score + 70);
      }
      renderDetailedList(results);
    });
  });
}

async function copyAllLinks(results) {
  if (results.length === 0) { alert('Không có dữ liệu!'); return; }
  const links = results.map(r => r.metadata.url || '').filter(u => u).join('\n');
  if (!links) { alert('Các paper này không có URL.'); return; }
  try {
    await navigator.clipboard.writeText(links);
    alert(`✅ Đã copy ${results.filter(r => r.metadata.url).length} links!`);
  } catch { alert('❌ Không thể copy.'); }
}

async function copyDetailedList(results) {
  if (results.length === 0) { alert('Không có dữ liệu!'); return; }
  const text = results.map((item, i) => {
    const m = item.metadata, s = item.scored;
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
    alert(`✅ Đã copy ${results.length} papers!`);
  } catch { alert('❌ Không thể copy.'); }
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

  const scanSerpBtn    = document.getElementById('scan-serpapi-btn');
  const serpKeyInput   = document.getElementById('serpapi-key');
  const serpLimitInput = document.getElementById('serpapi-limit');
  const sourceSelect   = document.getElementById('serpapi-source');

  // ---- LOAD & SAVE CONFIG ----
  chrome.storage.local.get(['serpapiKey', 'serpapiLimit'], (res) => {
    if (serpKeyInput) serpKeyInput.value = res.serpapiKey || HARDCODED_SERPAPI_KEY;
    if (res.serpapiLimit && serpLimitInput) serpLimitInput.value = res.serpapiLimit;
  });

  if (serpKeyInput) {
    serpKeyInput.addEventListener('input', () => {
      chrome.storage.local.set({ serpapiKey: serpKeyInput.value.trim() });
    });
  }
  if (serpLimitInput) {
    serpLimitInput.addEventListener('input', () => {
      chrome.storage.local.set({ serpapiLimit: parseInt(serpLimitInput.value, 10) || 500 });
    });
  }

  // ---- ĐỔI TEXT NÚT KHI CHỌN NGUỒN ----
  if (sourceSelect && scanSerpBtn) {
    const updateButtonText = () => {
      const source = sourceSelect.value;
      const sourceName = getSourceName(source);
      scanSerpBtn.textContent = getScanButtonText(source);
    };
    updateButtonText();
    sourceSelect.addEventListener('change', updateButtonText);
  }

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

  // ---- SCAN SERPAPI (quét mới / quét tiếp) ----
  const scanContinueBtn = document.getElementById('scan-continue-btn');
  const serpStateInfo   = document.getElementById('serpapi-state-info');
  let serpState = null;   // { query, source, nextPage, exhausted, papers }

  function currentQuery()  { return (document.getElementById('search-string').value || '').trim(); }
  function currentSource() { return sourceSelect ? sourceSelect.value : 'all'; }

  function serpStateMatches() {
    return serpState && serpState.query === currentQuery() && serpState.source === currentSource();
  }

  function updateContinueButton() {
    if (!scanContinueBtn || !serpStateInfo) return;
    if (!serpState || !serpState.papers || serpState.papers.length === 0) {
      scanContinueBtn.classList.add('hidden');
      serpStateInfo.classList.add('hidden');
      return;
    }
    const cfg = SOURCE_CONFIG[serpState.source] || SOURCE_CONFIG['all'];
    const matches = serpStateMatches();
    serpStateInfo.classList.remove('hidden');
    serpStateInfo.textContent =
      `💾 Đã lưu ${serpState.papers.length} bài (${cfg.name}) — ` +
      (serpState.exhausted
        ? 'nguồn đã hết kết quả, không quét tiếp được.'
        : (isApiSource(serpState.source) ? 'bấm "Quét tiếp" để lấy thêm.' : `lần sau quét tiếp từ trang ${serpState.nextPage + 1}.`)) +
      (matches ? '' : ' Query/nguồn hiện tại khác lần quét đã lưu.');
    scanContinueBtn.classList.remove('hidden');
    scanContinueBtn.disabled = !matches || serpState.exhausted || scanInProgress;
    scanContinueBtn.textContent = serpState.exhausted
      ? '➕ Quét tiếp (nguồn đã hết kết quả)'
      : (isApiSource(serpState.source) ? '➕ Quét tiếp (lấy thêm)' : `➕ Quét tiếp (từ trang ${serpState.nextPage + 1})`);
  }

  function saveSerpState() {
    chrome.storage.local.set({ serpapiState: serpState }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[SerpApi] Không lưu được state:', chrome.runtime.lastError.message);
      }
    });
  }

  async function runSerpScan(mode) {
    const apiKey = (serpKeyInput && serpKeyInput.value.trim()) || HARDCODED_SERPAPI_KEY;
    const selectedSource = currentSource();
    const apiMode = isApiSource(selectedSource);
    if (!apiMode && !apiKey) { alert('⚠️ Chưa cấu hình SerpApi Key!'); return; }

    const query = currentQuery();
    if (!query) { alert('⚠️ Vui lòng nhập Search Query!'); return; }

    const limit = parseInt(serpLimitInput?.value, 10) || 500;
    const isContinue = mode === 'continue' && serpStateMatches() && !serpState.exhausted;

    const previousPapers = isContinue ? serpState.papers : [];
    const startPage      = isContinue ? serpState.nextPage : 0;
    const seenKeys       = new Set(previousPapers.map(paperDedupKey));

    scanInProgress = true;
    if (!isContinue) {
      allScanResults = [];
      displayedResults = [];
      tbody.innerHTML = '';
      filterSection.classList.add('hidden');
      statsBox.classList.add('hidden');
      tableActions.classList.add('hidden');
      viewToggleBar.classList.add('hidden');
      viewTableCont.classList.add('hidden');
      viewListCont.classList.add('hidden');
    }
    scanSerpBtn.disabled = true;
    if (scanContinueBtn) scanContinueBtn.disabled = true;
    if (scanBtn) scanBtn.disabled = true;
    progressWrap.classList.remove('hidden');
    progressBar.style.width = '2%';

    try {
      const stateOut = {};
      const onProg = (page, total, count, statusText) => {
        const done = Math.max(0, page - startPage);
        const span = Math.max(1, total - startPage);
        const pct = apiMode ? Math.min(85, 10 + done * 20) : Math.round((done / span) * 100);
        progressBar.style.width = `${Math.min(pct, 85)}%`;
        progressLabel.textContent =
          `Đang quét... ` + (apiMode ? '' : `Trang ${page}/${total} — `) + `Mới ${count} bài` +
          (isContinue ? ` (đã có ${previousPapers.length})` : '');
        progressSub.textContent = statusText;
      };
      const minYear = parseInt(document.getElementById('filter-min-year')?.value, 10) || 0;
      const newPapers = apiMode
        ? await fetchPapersViaAcademicApi(query, limit, onProg, selectedSource, {
            startPage, seenKeys, stateOut, minYear,
            token: isContinue ? serpState.nextToken : null
          })
        : await fetchPapersViaSerpApi(query, apiKey, limit, onProg, selectedSource,
            { startPage, seenKeys, stateOut });

      const enrichCb = document.getElementById('enrich-checkbox');
      if (!apiMode && enrichCb && enrichCb.checked && newPapers.length > 0) {
        progressBar.style.width = '90%';
        await enrichPapers(newPapers, (msg) => { progressLabel.textContent = msg; });
      }

      const merged = previousPapers.concat(newPapers);

      serpState = {
        query,
        source: selectedSource,
        nextPage: stateOut.nextPage,
        nextToken: stateOut.nextToken || null,
        exhausted: !!stateOut.exhausted,
        papers: merged,
        savedAt: Date.now()
      };
      saveSerpState();

      showScanResults(merged);

      const includeCount = allScanResults.filter(r => r.scored.decision === 'INCLUDE').length;
      progressLabel.textContent = isContinue
        ? `✅ Quét tiếp xong: +${newPapers.length} bài mới → tổng ${merged.length} bài, ${includeCount} đạt INCLUDE.`
        : `✅ Hoàn tất! ${merged.length} papers được quét, ${includeCount} đạt INCLUDE.`;
      progressBar.style.width = '100%';
      progressSub.textContent = stateOut.exhausted
        ? (stateOut.error ? `⚠️ Dừng do lỗi: ${stateOut.error}` : 'Nguồn đã hết kết quả.')
        : (apiMode ? 'Bấm "Quét tiếp" để lấy thêm kết quả.' : `Bấm "Quét tiếp" để lấy từ trang ${stateOut.nextPage + 1}.`);
    } catch (err) {
      console.error('[SerpApi] Lỗi:', err);
      alert('❌ Lỗi SerpApi: ' + err.message);
      if (!isContinue) progressWrap.classList.add('hidden');
    } finally {
      resetScanButton();
    }
  }

  if (scanSerpBtn) {
    scanSerpBtn.addEventListener('click', () => {
      if (serpState && serpState.papers.length > 0 &&
          !confirm('Quét mới sẽ xóa kết quả đã lưu và bắt đầu lại từ trang 1.\n\nNếu muốn lấy thêm bài, hãy bấm "➕ Quét tiếp".\n\nTiếp tục quét mới?')) {
        return;
      }
      runSerpScan('fresh');
    });
  }
  if (scanContinueBtn) {
    scanContinueBtn.addEventListener('click', () => runSerpScan('continue'));
  }

  // Cập nhật nút "Quét tiếp" khi đổi nguồn / query
  if (sourceSelect) sourceSelect.addEventListener('change', updateContinueButton);
  document.getElementById('search-string').addEventListener('input', updateContinueButton);

  // Khôi phục kết quả đã lưu khi mở lại popup
  chrome.storage.local.get(['serpapiState'], (res) => {
    const st = res.serpapiState;
    if (!st || !Array.isArray(st.papers) || st.papers.length === 0) return;
    serpState = st;
    if (sourceSelect && SOURCE_CONFIG[st.source]) sourceSelect.value = st.source;
    const qEl = document.getElementById('search-string');
    if (qEl && !qEl.value.trim()) qEl.value = st.query;
    if (!allScanResults.length) {
      showScanResults(st.papers);
      progressWrap.classList.remove('hidden');
      const includeCount = allScanResults.filter(r => r.scored.decision === 'INCLUDE').length;
      progressLabel.textContent = `💾 Khôi phục ${st.papers.length} bài đã quét, ${includeCount} đạt INCLUDE.`;
      progressBar.style.width = '100%';
      progressSub.textContent = '';
    }
    updateContinueButton();
  });

  // ---- SCAN DOM ----
  scanBtn.addEventListener('click', async () => {
    if (scanInProgress) { alert('⏳ Scan đang chạy.'); return; }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabUrl = tab.url || '';
      const isSupportedSearch =
        tabUrl.includes('dl.acm.org/action/doSearch') ||
        tabUrl.includes('ieeexplore.ieee.org/search/searchresult.jsp') ||
        tabUrl.includes('scholar.google.com/scholar?');
      if (!isSupportedSearch) {
        alert('⚠️ Vui lòng mở trang kết quả tìm kiếm trước!\n\nHỗ trợ:\n' +
              '• ACM: dl.acm.org/action/doSearch\n' +
              '• IEEE Xplore: ieeexplore.ieee.org/search/searchresult.jsp\n' +
              '• Google Scholar: scholar.google.com/scholar?...');
        return;
      }

      scanInProgress = true;
      allScanResults = [];
      displayedResults = [];
      tbody.innerHTML = '';
      scanBtn.disabled = true;
      if (scanSerpBtn) scanSerpBtn.disabled = true;
      scanBtn.textContent = '⏳ Đang quét tất cả trang...';
      progressWrap.classList.remove('hidden');
      filterSection.classList.add('hidden');
      statsBox.classList.add('hidden');
      tableActions.classList.add('hidden');
      viewToggleBar.classList.add('hidden');
      viewTableCont.classList.add('hidden');
      viewListCont.classList.add('hidden');

      await chrome.storage.local.remove('scanProgress');

      progressLabel.textContent  = '🔍 Đang kết nối content script...';
      progressSub.textContent    = 'Đang chuẩn bị quét toàn bộ trang kết quả...';
      progressBar.style.width    = '2%';

      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      } catch { /* already injected */ }
      await new Promise(r => setTimeout(r, 400));

      progressLabel.textContent = '🚀 Bắt đầu scan...';
      progressBar.style.width   = '5%';

      let response;
      try {
        response = await chrome.tabs.sendMessage(tab.id, { action: 'scanSearch' });
      } catch (err) {
        throw new Error('Không thể giao tiếp với content script: ' + err.message);
      }
      if (!response || !response.success) {
        throw new Error(response?.error || 'Scan thất bại.');
      }
      progressLabel.textContent = '⏳ Đang quét từng trang...';
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
    if (typeof updateContinueButton === 'function') updateContinueButton();
    if (scanBtn) {
      scanBtn.disabled = false;
      scanBtn.textContent = '🌐 Quét trang kết quả đang mở';
    }
    if (scanSerpBtn) {
      scanSerpBtn.disabled = false;
      const source = sourceSelect ? sourceSelect.value : 'all';
      const sourceName = getSourceName(source);
      scanSerpBtn.textContent = getScanButtonText(source);
    }
  }

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

    // Nếu lọc INCLUDE làm bảng rỗng dù đã quét được bài -> tự hiện tất cả
    if (onlyInclude && displayedResults.length === 0 && allScanResults.length > 0) {
      const cb = document.getElementById('only-include-checkbox');
      if (cb) cb.checked = false;
      displayedResults = [...allScanResults];
      progressLabel.textContent =
        `⚠️ Quét được ${allScanResults.length} bài nhưng 0 bài đạt INCLUDE (≥70) — đang hiển thị tất cả.`;
    }

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

  (async () => {
    try {
      const { scanState, scanResults } = await chrome.storage.local.get(['scanState', 'scanResults']);
      const fresh = scanState?.active && (Date.now() - (scanState.updatedAt || 0) < 3 * 60 * 1000);
      if (fresh) {
        scanInProgress = true;
        if (scanBtn) {
          scanBtn.disabled = true;
          scanBtn.textContent = '⏳ Đang quét tất cả trang...';
        }
        if (scanSerpBtn) scanSerpBtn.disabled = true;
        progressWrap.classList.remove('hidden');
        progressLabel.textContent = `Đang quét... Trang ${scanState.page + 1} — ${scanState.papers?.length || 0} papers`;
      } else if (scanResults && scanResults.status === 'completed' &&
                 Array.isArray(scanResults.papers) && allScanResults.length === 0) {
        showScanResults(scanResults.papers);
        progressWrap.classList.add('hidden');
      }
    } catch (e) { console.error('[Popup] restore error:', e); }
  })();

  function renderTable(results) {
    tbody.innerHTML = '';
    if (results.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="8" style="text-align:center;padding:20px;color:#7f8c8d;">Không có kết quả phù hợp với bộ lọc.</td>';
      tbody.appendChild(tr);
      return;
    }
    results.forEach((item, idx) => {
      const m = item.metadata, s = item.scored;
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
    tbody.querySelectorAll('.row-check').forEach(cb => {
      cb.addEventListener('change', updateSelectedCount);
    });
    updateSelectedCount();
  }

  function updateStats(results) {
    const base    = allScanResults.length ? allScanResults : results;
    const total   = base.length;
    const include = base.filter(r => r.scored.decision === 'INCLUDE').length;
    const exclude = total - include;
    const shown   = results.length;
    document.getElementById('stat-total').textContent   =
      shown === total ? `Tổng: ${total}` : `Tổng: ${total} (hiển thị ${shown})`;
    document.getElementById('stat-include').textContent = `INCLUDE: ${include}`;
    document.getElementById('stat-exclude').textContent = `EXCLUDE: ${exclude}`;
    updateSelectedCount();
  }

  function updateSelectedCount() {
    const checked = tbody.querySelectorAll('.row-check:checked').length;
    document.getElementById('stat-selected').textContent = `Đã chọn: ${checked}`;
  }

  masterCheck.addEventListener('change', () => {
    tbody.querySelectorAll('.row-check').forEach(cb => { cb.checked = masterCheck.checked; });
    updateSelectedCount();
  });

  document.getElementById('select-all-include-btn').addEventListener('click', () => {
    tbody.querySelectorAll('.row-check').forEach(cb => {
      const idx = parseInt(cb.dataset.idx);
      const item = displayedResults[idx];
      cb.checked = item && item.scored.decision === 'INCLUDE';
    });
    updateSelectedCount();
  });

  document.getElementById('deselect-all-btn').addEventListener('click', () => {
    tbody.querySelectorAll('.row-check').forEach(cb => { cb.checked = false; });
    masterCheck.checked = false;
    updateSelectedCount();
  });

  document.getElementById('export-selected-btn').addEventListener('click', () => {
    const selected = [];
    tbody.querySelectorAll('.row-check:checked').forEach(cb => {
      const idx = parseInt(cb.dataset.idx);
      if (displayedResults[idx]) selected.push(displayedResults[idx]);
    });
    if (selected.length === 0) { alert('Chưa chọn paper nào!'); return; }
    const searchStr = document.getElementById('search-string').value;
    downloadFile(buildCSV(selected, searchStr), `slr_selected_${Date.now()}.csv`);
  });

  document.getElementById('export-all-btn').addEventListener('click', () => {
    if (displayedResults.length === 0) { alert('Không có dữ liệu!'); return; }
    const searchStr = document.getElementById('search-string').value;
    downloadFile(buildCSV(displayedResults, searchStr), `slr_all_${Date.now()}.csv`);
  });

  document.getElementById('copy-all-links-btn').addEventListener('click', () => copyAllLinks(displayedResults));
  document.getElementById('copy-detailed-list-btn').addEventListener('click', () => copyDetailedList(displayedResults));

  document.getElementById('clear-results-btn').addEventListener('click', () => {
    if (!confirm('Xóa toàn bộ kết quả scan?')) return;
    allScanResults = [];
    displayedResults = [];
    tbody.innerHTML = '';
    document.getElementById('detailed-list').innerHTML = '';
    serpState = null;
    chrome.storage.local.remove('serpapiState');
    updateContinueButton();
    filterSection.classList.add('hidden');
    statsBox.classList.add('hidden');
    tableActions.classList.add('hidden');
    viewToggleBar.classList.add('hidden');
    viewTableCont.classList.add('hidden');
    viewListCont.classList.add('hidden');
  });

  document.getElementById('apply-filter-btn').addEventListener('click', applyFilter);
  document.getElementById('filter-keyword').addEventListener('keyup', e => {
    if (e.key === 'Enter') applyFilter();
  });
  document.getElementById('only-include-checkbox')?.addEventListener('change', applyFilter);

  function applyFilter() {
    const minYear     = parseInt(document.getElementById('filter-min-year').value)  || 0;
    const maxYear     = parseInt(document.getElementById('filter-max-year').value)  || 9999;
    const minScore    = parseInt(document.getElementById('filter-min-score').value) || 0;
    const keyword     = document.getElementById('filter-keyword').value.toLowerCase().trim();
    const decisionF   = document.getElementById('filter-decision').value;
    const onlyInclude = document.getElementById('only-include-checkbox')?.checked ?? false;

    displayedResults = allScanResults.filter(item => {
      const m = item.metadata, s = item.scored;
      const year = parseInt(m.year) || 0;
      const titleLower = (m.title || '').toLowerCase();
      if (onlyInclude && s.decision !== 'INCLUDE') return false;
      if (year > 0 && (year < minYear || year > maxYear)) return false;
      if (s.score < minScore) return false;
      if (keyword && !titleLower.includes(keyword)) return false;
      if (decisionF !== 'ALL' && s.decision !== decisionF) return false;
      return true;
    });

    renderTable(displayedResults);
    updateStats(displayedResults);
    if (!viewListCont.classList.contains('hidden')) renderDetailedList(displayedResults);
  }

  document.querySelectorAll('#results-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortState.col === col) sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      else { sortState.col = col; sortState.dir = 'desc'; }
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

    [...papers].reverse().forEach(entry => {
      const m = entry.metadata, s = entry.scored;
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
  syncSearchQueryFromActiveTab();
  console.log('[SLR Scanner Popup] Ready!');
});
