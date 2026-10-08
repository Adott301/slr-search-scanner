// background.js - Service Worker cho SLR Search Scanner
// Author: Nguyen Tien Dat - SWT301 RBL Group04

/**
 * Lắng nghe sự kiện khi extension được cài đặt hoặc cập nhật
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[SLR Scanner] Extension installed!', details.reason);

  if (details.reason === 'install') {
    // Khởi tạo storage với dữ liệu mặc định
    chrome.storage.local.set({
      papers: [],
      scanResults: [],
      settings: {
        minYear: 2018,
        maxYear: 2030,
        minScore: 70,
        defaultSearchString: '("Defects4J" OR "Java test generation") AND ("LLM" OR "ChatGPT" OR "Claude") AND ("JUnit" OR "unit test")'
      }
    }, () => {
      console.log('[SLR Scanner] Storage initialized with defaults.');
    });
  }
});

/**
 * Lắng nghe messages từ popup hoặc content scripts (nếu cần relay)
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[SLR Scanner] Background received message:', message.action);

  if (message.action === 'ping') {
    sendResponse({ status: 'ok', message: 'Background service worker is running.' });
  }

  // Trả về true để giữ channel mở cho async response (nếu cần)
  return true;
});
