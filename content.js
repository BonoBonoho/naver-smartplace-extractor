/**
 * 네이버 스마트플레이스 통계 데이터 추출 Content Script
 * 리포트/플레이스 탭의 N회 값, 유입 채널, 유입 키워드 등을 수집 (괄호 내용 제외)
 */

(function () {
  'use strict';

  function createExtractButton() {
    if (document.getElementById('nsp-extractor-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'nsp-extractor-btn';
    btn.innerHTML = '📊 통계 추출';
    btn.title = '이 페이지의 통계 데이터를 추출합니다';
    btn.className = 'nsp-extractor-button';
    btn.addEventListener('click', handleExtract);
    document.body.appendChild(btn);
  }

  async function handleExtract() {
    const btn = document.getElementById('nsp-extractor-btn');
    btn.disabled = true;
    btn.textContent = '추출 중...';
    try {
      const data = extractPageData();
      chrome.storage.local.get(['nspExtractionHistory'], (r) => {
        const history = Array.isArray(r.nspExtractionHistory) ? r.nspExtractionHistory : [];
        history.unshift({
          period: data.period,
          dateRange: data.dateRange,
          tab: data.tab,
          rows: data.rows,
          extractedAt: data.extractedAt,
        });
        const trimmed = history.slice(0, 50);
        chrome.storage.local.set(
          { nspExtractedData: data, nspExtractionHistory: trimmed },
          () => chrome.runtime.sendMessage({ type: 'DATA_EXTRACTED', data })
        );
      });
      showNotification('✅ ' + NSP_VERSION + ' | ' + data.rows.length + '개 추출 | 날짜: ' + (data.dateRange || '감지실패'));
    } catch (err) {
      showNotification('❌ 추출 실패: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '📊 통계 추출';
    }
  }

  function stripParentheses(str) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // ===== 버전 (디버그용) =====
  var NSP_VERSION = 'v5';

  // ===== 날짜 추출 =====
  // "26. 2. 2. 월 - 2. 8. 일" -> "2026-02-02 ~ 2026-02-08"

  // 보이지 않는 유니코드 문자를 모두 일반 공백으로 치환
  function normalizeText(str) {
    return (str || '').replace(/[\s\u00a0\u200b\u200c\u200d\u2060\ufeff\u3000]+/g, ' ').trim();
  }

  // 짧은 텍스트에서 날짜 범위 파싱 시도
  function tryParseDateRange(text) {
    if (!text) return null;
    var t = normalizeText(text);

    // Pattern 1: "26. 2. 2. 월 - 2. 8. 일" (한국어 요일 포함)
    // \D 를 사용하여 숫자가 아닌 모든 문자(특수 대시, 보이지 않는 문자 등)를 허용
    var m = t.match(/(\d{2})\D{1,5}(\d{1,2})\D{1,5}(\d{1,2})\D{1,10}[월화수목금토일]\D{1,15}(\d{1,2})\D{1,5}(\d{1,2})\D{1,10}[월화수목금토일]/);
    if (m && parseInt(m[1]) >= 20 && parseInt(m[1]) <= 35) {
      var y = '20' + m[1];
      return y + '-' + pad(m[2]) + '-' + pad(m[3]) + ' ~ ' + y + '-' + pad(m[4]) + '-' + pad(m[5]);
    }

    // Pattern 2: "2026-02-02 ~ 2026-02-08" (이미 포맷된 날짜)
    m = t.match(/(\d{4})\D(\d{1,2})\D(\d{1,2})\D{1,10}(\d{4})\D(\d{1,2})\D(\d{1,2})/);
    if (m && parseInt(m[1]) >= 2020) {
      return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]) + ' ~ ' + m[4] + '-' + pad(m[5]) + '-' + pad(m[6]);
    }

    // Pattern 3: "26. 2. 2 - 2. 8" (요일 없이 점으로 구분)
    m = t.match(/(\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})[^\d]{1,15}(\d{1,2})\.\s*(\d{1,2})/);
    if (m && parseInt(m[1]) >= 20 && parseInt(m[1]) <= 35) {
      var y2 = '20' + m[1];
      return y2 + '-' + pad(m[2]) + '-' + pad(m[3]) + ' ~ ' + y2 + '-' + pad(m[4]) + '-' + pad(m[5]);
    }

    return null;
  }

  function detectDateRange() {
    // === 전략 1: 날짜 관련 DOM 요소 직접 탐색 ===
    var selectors = [
      '[class*="date"]', '[class*="Date"]',
      '[class*="period"]', '[class*="Period"]',
      '[class*="calendar"]', '[class*="Calendar"]',
      '[class*="range"]', '[class*="Range"]',
      '[class*="navi"]', '[class*="Navi"]',
      '[class*="week"]', '[class*="Week"]',
      '[class*="term"]', '[class*="Term"]',
    ];
    for (var s = 0; s < selectors.length; s++) {
      try {
        var els = document.querySelectorAll(selectors[s]);
        for (var i = 0; i < els.length; i++) {
          var t = (els[i].textContent || '').trim();
          if (t.length >= 5 && t.length <= 80) {
            var result = tryParseDateRange(t);
            if (result) {
              console.log('[NSP ' + NSP_VERSION + '] 날짜 발견 (전략1):', selectors[s], JSON.stringify(t), '->', result);
              return result;
            }
          }
        }
      } catch(e) {}
    }

    // === 전략 2: 모든 요소의 직접 텍스트 노드 검색 ===
    // (자식 요소의 텍스트를 제외하고, 이 요소에 직접 속한 텍스트만)
    var allEls = document.querySelectorAll('span, button, a, div, p, td, th, label, strong, em, b, h1, h2, h3, h4, h5, h6');
    for (var j = 0; j < allEls.length; j++) {
      var el = allEls[j];
      // 이 요소의 textContent 가 짧고, 숫자 + 한국어 요일이 있는 경우만
      var tc = (el.textContent || '').trim();
      if (tc.length < 5 || tc.length > 80) continue;
      if (!/\d/.test(tc)) continue;
      if (!/[월화수목금토일]/.test(tc) && !/[-–—~]/.test(tc)) continue;
      var result2 = tryParseDateRange(tc);
      if (result2) {
        console.log('[NSP ' + NSP_VERSION + '] 날짜 발견 (전략2):', el.tagName, el.className, JSON.stringify(tc), '->', result2);
        return result2;
      }
    }

    // === 전략 3: 페이지 전체 텍스트에서 검색 ===
    var bodyText = normalizeText((document.body ? document.body.innerText : '') || '');
    var result3 = tryParseDateRange(bodyText);
    if (result3) {
      console.log('[NSP ' + NSP_VERSION + '] 날짜 발견 (전략3): bodyText ->', result3);
      return result3;
    }

    // === 전략 4: "월" 근처 텍스트만 잘라서 재시도 ===
    var monthIdx = bodyText.indexOf('월');
    if (monthIdx > 10) {
      var snippet = bodyText.substring(monthIdx - 30, monthIdx + 30);
      var result4 = tryParseDateRange(snippet);
      if (result4) {
        console.log('[NSP ' + NSP_VERSION + '] 날짜 발견 (전략4): snippet ->', result4);
        return result4;
      }
    }

    // 디버그: 날짜를 찾지 못한 경우, "월" 근처 텍스트를 로그에 출력
    console.log('[NSP ' + NSP_VERSION + '] 날짜 추출 실패. "월" 근처 텍스트:');
    var allMonthPositions = [];
    var searchFrom = 0;
    while (true) {
      var idx = bodyText.indexOf('월', searchFrom);
      if (idx === -1 || allMonthPositions.length >= 5) break;
      allMonthPositions.push(bodyText.substring(Math.max(0, idx - 25), Math.min(bodyText.length, idx + 25)));
      searchFrom = idx + 1;
    }
    console.log('[NSP ' + NSP_VERSION + '] "월" 근처 샘플들:', JSON.stringify(allMonthPositions));

    return '';
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function detectPeriod() {
    var text = (document.body ? document.body.innerText : '') || '';
    if (/월간|월별/.test(text)) return '월별';
    return '주별';
  }

  function detectActiveTab() {
    var active = document.querySelector('[class*="tab"][class*="active"], [aria-selected="true"]');
    var text = (active ? active.textContent : '') || '';
    if (/플레이스/.test(text)) return '플레이스';
    if (/리포트/.test(text)) return '리포트';
    return '통계';
  }

  // ===== 데이터 추출 =====
  function extractPageData() {
    var period = detectPeriod();
    var dateRange = detectDateRange();
    var tab = detectActiveTab();

    var hoeMatches = extractHoeCounts(dateRange);
    var cleanRows = pivotToWeeklyTable(hoeMatches, dateRange);

    if (cleanRows.length > 0) {
      return { extractedAt: new Date().toISOString(), period: period, dateRange: dateRange, tab: tab, rows: cleanRows };
    }

    var rows = hoeMatches.slice();
    var channels = extractChannelKeywordList('채널', '유입 채널', '유입채널');
    rows = rows.concat(channels);
    var keywords = extractChannelKeywordList('키워드', '유입 키워드', '유입키워드');
    rows = rows.concat(keywords);

    var pivoted = pivotToWeeklyTable(rows, dateRange);
    return {
      extractedAt: new Date().toISOString(),
      period: period,
      dateRange: dateRange,
      tab: tab,
      rows: pivoted.length > 0 ? pivoted : rows,
    };
  }

  function matchCategory(text) {
    var t = String(text || '');
    if (/유입/.test(t)) return '유입';
    if (/예약|주문/.test(t)) return '예약/주문';
    if (/스마트콜/.test(t)) return '스마트콜';
    if (/리뷰/.test(t)) return '리뷰';
    return null;
  }

  function pivotToWeeklyTable(rows, dateRange) {
    var byPeriod = {};
    var fallback = dateRange || '';
    rows.forEach(function(r) {
      var key = String(r.구분 || '');
      var val = String(r.값 || r.회수 || '').replace(/[^\d]/g, '');
      var period = r.기간 || fallback;
      var target = matchCategory(key);
      if (target && val) {
        if (!byPeriod[period]) byPeriod[period] = { 주간: period, 유입: '', '예약/주문': '', 스마트콜: '', 리뷰: '' };
        byPeriod[period][target] = val;
      }
    });
    return Object.values(byPeriod).filter(function(r) { return r.유입 || r['예약/주문'] || r.스마트콜 || r.리뷰; });
  }

  function extractHoeCounts(dateRange) {
    var rows = [];
    var text = document.body.innerText || '';
    var cleaned = stripParentheses(text);
    var fallback = dateRange || '';

    var labelMap = [
      { pattern: /플레이스\s*유입|유입\s*수|유입수|유입/, col: '유입' },
      { pattern: /예약\s*[·.]?\s*주문\s*신청|예약\s*\/\s*주문/, col: '예약/주문' },
      { pattern: /스마트콜\s*통화/, col: '스마트콜' },
      { pattern: /리뷰\s*등록/, col: '리뷰' },
    ];
    var parts = cleaned.split(/\n/);

    parts.forEach(function(line) {
      for (var i = 0; i < labelMap.length; i++) {
        if (!labelMap[i].pattern.test(line)) continue;
        var numMatch = line.match(/(\d+)\s*회/);
        if (numMatch) {
          rows.push({ 구분: labelMap[i].col, 값: numMatch[1], 기간: fallback });
          break;
        }
      }
    });

    if (!rows.some(function(r) { return r.구분 === '유입'; })) {
      var um = cleaned.match(/유입[^\d]*(\d+)\s*회|(\d+)\s*회[^\d]*유입/);
      if (um) rows.push({ 구분: '유입', 값: um[1] || um[2], 기간: fallback });
    }
    return rows;
  }

  function extractChannelKeywordList(type) {
    var rows = [];
    var re = /(\d+)\.\s*([^\d]+?)\s*(\d+\.?\d*)\s*%/g;
    var full = stripParentheses(document.body.innerText || '');
    var m;
    while ((m = re.exec(full)) !== null) {
      rows.push({ 구분: type, 항목: m[2].trim(), 비율: m[3] + '%' });
    }
    return rows;
  }

  function showNotification(msg) {
    var el = document.createElement('div');
    el.className = 'nsp-notification';
    el.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:12px 24px;border-radius:8px;z-index:999999;font-size:14px;max-width:90vw;word-break:break-all;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function() { el.remove(); }, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createExtractButton);
  } else {
    createExtractButton();
  }
})();
