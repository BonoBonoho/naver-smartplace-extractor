/**
 * Google OAuth 콜백: Supabase 리다이렉트 URL에서 access_token 추출 후 저장
 * cloud-api.js와 동일한 키 fx_cloud_session 사용
 */
var STORAGE_KEY = 'fx_cloud_session';

function parseUrlHash(url) {
  var u = new URL(url);
  var hash = (u.hash || '').slice(1);
  var map = {};
  hash.split('&').forEach(function (part) {
    var eq = part.indexOf('=');
    if (eq > 0) {
      var key = decodeURIComponent(part.slice(0, eq));
      var val = decodeURIComponent(part.slice(eq + 1));
      map[key] = val;
    }
  });
  return map;
}

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  var url = changeInfo.url || (tab && tab.url);
  if (!url) return;
  var redirectBase = chrome.identity.getRedirectURL();
  if (url.indexOf(redirectBase) !== 0) return;

  var hashMap = parseUrlHash(url);
  var access_token = hashMap.access_token;
  if (!access_token) return;

  chrome.storage.local.set({ [STORAGE_KEY]: access_token }, function () {
    chrome.tabs.update(tabId, { url: chrome.runtime.getURL('success.html') });
  });
});
