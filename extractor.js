/**
 * 네이버 스마트플레이스 통계 데이터 추출 Content Script v8
 * - 리포트 탭: 유입/예약·주문/스마트콜/리뷰 → nspReportData
 * - 플레이스 탭: 유입수/유입채널/유입키워드 → nspPlaceData
 */
(function () {
  'use strict';
  var NSP_VERSION = 'v10';

  function createExtractButton() {
    if (document.getElementById('nsp-extractor-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'nsp-extractor-btn';
    btn.innerHTML = '📊 통계 추출';
    btn.title = '이 페이지의 통계 데이터를 추출합니다';
    btn.className = 'nsp-extractor-button';
    btn.addEventListener('click', handleExtract);
    document.body.appendChild(btn);
  }

  function handleExtract() {
    var btn = document.getElementById('nsp-extractor-btn');
    if (btn) { btn.disabled = true; btn.textContent = '추출 중...'; }
    try {
      var dateRange = detectDateRange();
      var period = detectPeriod();
      var tab = detectActiveTab();

      console.log('[NSP ' + NSP_VERSION + '] 탭 감지:', tab);
      if (tab === '플레이스') {
        handlePlaceExtract(dateRange, period, tab, btn);
      } else {
        handleReportExtract(dateRange, period, tab, btn);
      }
    } catch (err) {
      notify('❌ 추출 실패: ' + err.message);
      if (btn) { btn.disabled = false; btn.textContent = '📊 통계 추출'; }
    }
  }

  // ===== 리포트 탭 추출 + 저장 =====
  function handleReportExtract(dateRange, period, tab, btn) {
    var hoeMatches = extractHoeCounts(dateRange);
    var cleanRows = pivotToWeeklyTable(hoeMatches, dateRange);
    var rows = cleanRows.length > 0 ? cleanRows : hoeMatches;
    var data = { extractedAt: new Date().toISOString(), period: period, dateRange: dateRange, tab: tab, rows: rows };

    chrome.storage.local.get(['nspExtractedData', 'nspExtractionHistory'], function(r) {
      var existing = r.nspExtractedData || {};
      var existingRows = Array.isArray(existing.rows) ? existing.rows : [];
      var merged = mergeRowsByKey(existingRows, rows, '주간');
      merged.sort(sortByDate);

      var mergedData = { extractedAt: data.extractedAt, period: period, dateRange: dateRange, tab: tab, rows: merged };
      var history = Array.isArray(r.nspExtractionHistory) ? r.nspExtractionHistory : [];
      history.unshift({ period: period, dateRange: dateRange, tab: tab, rows: rows, extractedAt: data.extractedAt });

      chrome.storage.local.set(
        { nspExtractedData: mergedData, nspExtractionHistory: history.slice(0, 50) },
        function() {
          chrome.runtime.sendMessage({ type: 'DATA_EXTRACTED', data: mergedData });
          notify(NSP_VERSION + ' 리포트 ✓ ' + rows.length + '개 (총 ' + merged.length + '주)');
        }
      );
    });
    if (btn) { btn.disabled = false; btn.textContent = '📊 통계 추출'; }
  }

  // ===== 플레이스 탭 추출 + 저장 =====
  function handlePlaceExtract(dateRange, period, tab, btn) {
    var placeData = extractPlaceData(dateRange);

    chrome.storage.local.get(['nspPlaceData'], function(r) {
      var existing = r.nspPlaceData || {};
      var existingChannels = Array.isArray(existing.channels) ? existing.channels : [];
      var existingKeywords = Array.isArray(existing.keywords) ? existing.keywords : [];

      var mergedChannels = mergeRowsByKey(existingChannels, placeData.channelRows, '주간');
      mergedChannels.sort(sortByDate);

      var mergedKeywords = mergeRowsByKey(existingKeywords, placeData.keywordRows, '주간');
      mergedKeywords.sort(sortByDate);

      var saved = {
        extractedAt: new Date().toISOString(),
        channels: mergedChannels,
        keywords: mergedKeywords,
      };

      chrome.storage.local.set({ nspPlaceData: saved }, function() {
        chrome.runtime.sendMessage({ type: 'PLACE_DATA_EXTRACTED', data: saved });
        notify(NSP_VERSION + ' 플레이스 ✓ 채널 ' + mergedChannels.length + '주, 키워드 ' + mergedKeywords.length + '주');
      });
    });
    if (btn) { btn.disabled = false; btn.textContent = '📊 통계 추출'; }
  }

  // ===== 플레이스 탭 데이터 파싱 =====
  function extractPlaceData(dateRange) {
    var fallback = dateRange || '';
    var rawText = document.body.innerText || '';
    var lines = rawText.split(/\n/).map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });

    console.log('[NSP ' + NSP_VERSION + '] 플레이스 추출 시작');

    // 1. 유입수 추출
    var inflowCount = 0;
    for (var i = 0; i < lines.length; i++) {
      if (/유입\s*수/.test(lines[i])) {
        for (var k = i; k < Math.min(i + 5, lines.length); k++) {
          var nm = lines[k].match(/([\d,]+)\s*회/);
          if (nm) { inflowCount = parseInt(nm[1].replace(/,/g, ''), 10) || 0; break; }
        }
        break;
      }
    }
    console.log('[NSP] 유입수:', inflowCount);

    // 2. DOM 기반 추출 시도 (1차)
    var channelPairs = [];
    var keywordPairs = [];
    try {
      var domResult = extractPairsDOM();
      channelPairs = domResult.channels;
      keywordPairs = domResult.keywords;
      console.log('[NSP] DOM 추출 결과 - 채널:', channelPairs.length, '키워드:', keywordPairs.length);
    } catch (e) {
      console.warn('[NSP] DOM 추출 실패:', e.message);
    }

    // 3. 텍스트 기반 폴백 (2차)
    if (channelPairs.length === 0) {
      channelPairs = extractPairsText(lines, '채널');
      console.log('[NSP] 텍스트 폴백 채널:', channelPairs.length);
    }
    if (keywordPairs.length === 0) {
      keywordPairs = extractPairsText(lines, '키워드');
      console.log('[NSP] 텍스트 폴백 키워드:', keywordPairs.length);
    }

    // 4. 채널: 유입수 × 퍼센트 = 실제 유입수 계산
    var channelRow = { '주간': fallback, '유입수': String(inflowCount) };
    channelPairs.slice(0, 5).forEach(function(pair) {
      channelRow[pair.name] = String(Math.round(inflowCount * pair.pct / 100));
    });

    // 5. 키워드: 퍼센트 그대로
    var keywordRow = { '주간': fallback };
    keywordPairs.slice(0, 5).forEach(function(pair) {
      keywordRow[pair.name] = pair.pct + '%';
    });

    console.log('[NSP] 최종 채널 Row:', JSON.stringify(channelRow));
    console.log('[NSP] 최종 키워드 Row:', JSON.stringify(keywordRow));

    return {
      channelRows: [channelRow],
      keywordRows: [keywordRow],
    };
  }

  // ===== 방법 1: DOM 기반 추출 =====
  // 퍼센트가 표시된 DOM 요소를 직접 찾아서, 근처 요소에서 이름을 추출
  function extractPairsDOM() {
    var result = { channels: [], keywords: [] };

    // (a) 섹션 헤더 요소 찾기
    var channelHeaderEl = findHeaderElement(/유입\s*채널/);
    var keywordHeaderEl = findHeaderElement(/유입\s*키워드/);
    console.log('[NSP DOM] 채널 헤더:', !!channelHeaderEl, '키워드 헤더:', !!keywordHeaderEl);
    if (!channelHeaderEl && !keywordHeaderEl) return result;

    // (b) 퍼센트 표시 DOM 요소 모두 수집
    var pctElements = [];
    var allEls = document.body.querySelectorAll('span, div, p, td, li, a, em, strong, b, small, label');
    for (var i = 0; i < allEls.length; i++) {
      var el = allEls[i];
      var text = el.textContent.trim();
      if (text.length > 12 || text.length < 2) continue;
      var m = text.match(/^([\d.]+)\s*%$/);
      if (!m) continue;
      var pct = parseFloat(m[1]);
      if (pct <= 0 || pct > 100) continue;
      // 자식 요소 텍스트와 같으면 컨테이너 → 건너뛰기 (잎 노드만)
      if (el.children.length > 0) {
        var childText = '';
        for (var c = 0; c < el.children.length; c++) childText += el.children[c].textContent;
        if (childText.trim().length >= text.length * 0.8) continue;
      }
      pctElements.push({ el: el, pct: pct });
    }
    console.log('[NSP DOM] 퍼센트 요소 수:', pctElements.length);

    // (c) 각 퍼센트 요소가 어느 섹션에 속하는지 판별하고, 이름 추출
    for (var p = 0; p < pctElements.length; p++) {
      var info = pctElements[p];
      var section = classifySection(info.el, channelHeaderEl, keywordHeaderEl);
      if (!section) continue;

      var name = findNameNearElement(info.el);
      if (!name || name.length < 2) continue;

      if (section === 'channel' && result.channels.length < 5) {
        result.channels.push({ name: name, pct: info.pct });
      } else if (section === 'keyword' && result.keywords.length < 5) {
        result.keywords.push({ name: name, pct: info.pct });
      }
    }
    return result;
  }

  // 특정 패턴의 텍스트를 가진 헤더 요소 찾기
  function findHeaderElement(pattern) {
    var candidates = document.body.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span,p,strong,b,em,label');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      // 자체 텍스트 노드만 확인 (자식 제외)
      var ownText = '';
      for (var j = 0; j < el.childNodes.length; j++) {
        if (el.childNodes[j].nodeType === 3) ownText += el.childNodes[j].textContent;
      }
      ownText = ownText.trim();
      if (pattern.test(ownText) && ownText.length < 20) return el;
      // 짧은 textContent도 확인
      var full = el.textContent.trim();
      if (pattern.test(full) && full.length < 20) return el;
    }
    return null;
  }

  // 퍼센트 요소가 채널/키워드 섹션 중 어디에 속하는지 판별
  function classifySection(el, chHeader, kwHeader) {
    if (chHeader && kwHeader) {
      var afterCh = !!(chHeader.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
      var beforeKw = !!(el.compareDocumentPosition(kwHeader) & Node.DOCUMENT_POSITION_FOLLOWING);
      var afterKw = !!(kwHeader.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (afterCh && beforeKw) return 'channel';
      if (afterKw) return 'keyword';
    } else if (chHeader) {
      if (chHeader.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) return 'channel';
    } else if (kwHeader) {
      if (kwHeader.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) return 'keyword';
    }
    return null;
  }

  // 퍼센트 요소 근처에서 이름 텍스트 찾기 (DOM 트리 상향 탐색)
  function findNameNearElement(pctEl) {
    var badPat = /^[\d.%\s,회]+$|^(성별|나이대?|연령|남자|여자|도움말|더보기|시간별|요일별|\d+)$/;
    var container = pctEl.parentElement;

    for (var depth = 0; depth < 6; depth++) {
      if (!container || container === document.body) break;
      var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
      var node;
      while (node = walker.nextNode()) {
        var t = node.textContent.trim();
        if (t.length < 2 || t.length > 30) continue;
        if (badPat.test(t)) continue;
        if (/^[\d.]+\s*%$/.test(t)) continue;
        if (/^[\d,]+\s*회?$/.test(t)) continue;
        if (/[가-힣a-zA-Z]/.test(t)) {
          return t.replace(/^\d+\s*/, '').trim();
        }
      }
      container = container.parentElement;
    }
    return null;
  }

  // ===== 방법 2: 텍스트 기반 추출 (폴백) =====
  // 핵심 수정: stopWords로 섹션을 끊지 않음, 다음 주요 섹션 헤더만으로 종료
  function extractPairsText(lines, sectionType) {
    var isChannel = sectionType === '채널';
    var startRe = isChannel ? /유입\s*채널/ : /유입\s*키워드/;
    // 종료 조건: 오직 다음 주요 섹션 헤더만 (너무 넓은 패턴 제거)
    var endRe = isChannel
      ? /^유입\s*키워드/
      : /시간[\s·]*요일|^성별$|^나이대?$|^연령대?$/;
    var badNames = /^(성별|나이대?|연령|남자|여자|도움말|더보기|시간별|요일별|한\s*주간|\d+)$/;
    var limit = 5;

    // Step 1: 섹션 시작
    var startIdx = -1;
    for (var i = 0; i < lines.length; i++) {
      if (startRe.test(lines[i])) { startIdx = i; break; }
    }
    console.log('[NSP txt] ' + sectionType + ' 시작:', startIdx, startIdx >= 0 ? '"' + lines[startIdx] + '"' : '(없음)');
    if (startIdx < 0) return [];

    // Step 2: 섹션 줄 수집 (stopWords로 끊지 않음!)
    var sectionLines = [];
    for (var si = startIdx + 1; si < lines.length && sectionLines.length < 80; si++) {
      if (endRe.test(lines[si])) break;
      sectionLines.push(lines[si]);
    }
    console.log('[NSP txt] ' + sectionType + ' 줄 수:', sectionLines.length, '처음20줄:', JSON.stringify(sectionLines.slice(0, 20)));

    // Step 3: 퍼센트 줄 찾기
    var pctIndices = [];
    for (var pi = 0; pi < sectionLines.length; pi++) {
      if (/[\d.]+\s*%/.test(sectionLines[pi])) pctIndices.push(pi);
    }
    console.log('[NSP txt] ' + sectionType + ' 퍼센트 줄:', pctIndices.length, JSON.stringify(pctIndices));

    // Step 4: 이름 추출
    var pairs = [];
    for (var p = 0; p < pctIndices.length && pairs.length < limit; p++) {
      var pIdx = pctIndices[p];
      var pLine = sectionLines[pIdx];
      var pctMatch = pLine.match(/([\d.]+)\s*%/);
      if (!pctMatch) continue;
      var pctVal = parseFloat(pctMatch[1]);
      if (isNaN(pctVal) || pctVal <= 0 || pctVal > 100) continue;

      var name = null;

      // A: 같은 줄 "이름 NN.NN%" 또는 "N 이름 NN.NN%"
      var mA = pLine.match(/^(?:\d+\s+)?([가-힣a-zA-Z][가-힣a-zA-Z0-9\s·_.]+?)\s+([\d.]+)\s*%/);
      if (mA && mA[1].trim().length >= 2) name = mA[1].trim();

      // B: 이전 줄에서 이름 (순위+이름 또는 이름만)
      if (!name && pIdx > 0) {
        var prev = sectionLines[pIdx - 1];
        var mRN = prev.match(/^\d+\s+([가-힣a-zA-Z].*)/);
        if (mRN && mRN[1].trim().length >= 2) {
          name = mRN[1].trim();
        } else if (/[가-힣a-zA-Z]/.test(prev) && !/[\d.]+\s*%/.test(prev) && !/^\d+$/.test(prev) && prev.length >= 2) {
          name = prev.trim();
        }
      }

      // C: 2줄 전=순위, 1줄 전=이름
      if (!name && pIdx >= 2) {
        var p2 = sectionLines[pIdx - 2];
        var p1 = sectionLines[pIdx - 1];
        if (/^\d+$/.test(p2) && parseInt(p2) <= 20 && /[가-힣a-zA-Z]/.test(p1) && p1.length >= 2) {
          name = p1.replace(/^\d+\s*/, '').trim();
        }
      }

      if (name) {
        name = name.replace(/^\d+\s*/, '').trim();
        if (name.length >= 2 && !badNames.test(name)) {
          pairs.push({ name: name, pct: pctVal });
        }
      }
    }

    console.log('[NSP txt] ' + sectionType + ' 최종:', pairs.length + '개', JSON.stringify(pairs));
    return pairs;
  }

  // ===== 리포트 탭: 회수 추출 =====
  // 리포트 탭 전용 패턴 (플레이스의 "유입 수"와 구분하기 위해 구체적 패턴 사용)
  function extractHoeCounts(dateRange) {
    var rows = [];
    var rawText = document.body.innerText || '';
    var lines = rawText.split(/\n/);
    var fallback = dateRange || '';
    var labelMap = [
      { pattern: /플레이스\s*유입/, col: '유입' },
      { pattern: /예약[\s·.\/:]*주문\s*신청/, col: '예약/주문' },
      { pattern: /스마트콜\s*통화/, col: '스마트콜' },
      { pattern: /리뷰\s*등록/, col: '리뷰' },
    ];
    for (var c = 0; c < labelMap.length; c++) {
      var found = false;
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!labelMap[c].pattern.test(line)) continue;
        var numMatch = line.match(/(\d+)\s*회/);
        if (numMatch) {
          rows.push({ '구분': labelMap[c].col, '값': numMatch[1], '기간': fallback });
          found = true; break;
        }
        for (var k = i + 1; k < Math.min(i + 4, lines.length); k++) {
          numMatch = lines[k].trim().match(/^(\d+)\s*회/);
          if (numMatch) {
            rows.push({ '구분': labelMap[c].col, '값': numMatch[1], '기간': fallback });
            found = true; break;
          }
        }
        if (found) break;
      }
    }
    return rows;
  }

  function pivotToWeeklyTable(rows, dateRange) {
    var byPeriod = {};
    var fallback = dateRange || '';
    rows.forEach(function(r) {
      var key = String(r['구분'] || '');
      var val = String(r['값'] || '').replace(/[^\d]/g, '');
      var period = r['기간'] || fallback;
      if (key && val) {
        if (!byPeriod[period]) byPeriod[period] = { '주간': period, '유입': '', '예약/주문': '', '스마트콜': '', '리뷰': '' };
        byPeriod[period][key] = val;
      }
    });
    return Object.values(byPeriod).filter(function(r) { return r['유입'] || r['예약/주문'] || r['스마트콜'] || r['리뷰']; });
  }

  // ===== 공통 유틸 =====
  function mergeRowsByKey(existingRows, newRows, keyField) {
    var map = {};
    existingRows.forEach(function(row) {
      var k = String(row[keyField] || '').trim();
      if (k) map[k] = row;
    });
    newRows.forEach(function(row) {
      var k = String(row[keyField] || '').trim();
      if (k) map[k] = row;
    });
    return Object.values(map);
  }

  function sortByDate(a, b) {
    var da = String(a['주간'] || '').substring(0, 10);
    var db = String(b['주간'] || '').substring(0, 10);
    return da.localeCompare(db);
  }

  function normalizeText(str) {
    return (str || '').replace(/[\s\u00a0\u200b\u200c\u200d\u2060\ufeff\u3000]+/g, ' ').trim();
  }
  function pad(n) { return String(n).padStart(2, '0'); }

  function notify(msg) {
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:12px;right:12px;background:rgba(0,0,0,0.8);color:#fff;padding:8px 16px;border-radius:6px;z-index:999999;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function() { el.remove(); }, 2500);
  }

  // ===== 날짜 추출 =====
  function tryParseDateRange(text) {
    if (!text) return null;
    var t = normalizeText(text);
    var m = t.match(/(\d{2})\D{1,5}(\d{1,2})\D{1,5}(\d{1,2})\D{1,10}[월화수목금토일]\D{1,15}(\d{1,2})\D{1,5}(\d{1,2})\D{1,10}[월화수목금토일]/);
    if (m && parseInt(m[1]) >= 20 && parseInt(m[1]) <= 35) {
      return '20' + m[1] + '-' + pad(m[2]) + '-' + pad(m[3]) + ' ~ 20' + m[1] + '-' + pad(m[4]) + '-' + pad(m[5]);
    }
    m = t.match(/(\d{4})\D(\d{1,2})\D(\d{1,2})\D{1,10}(\d{4})\D(\d{1,2})\D(\d{1,2})/);
    if (m && parseInt(m[1]) >= 2020) {
      return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]) + ' ~ ' + m[4] + '-' + pad(m[5]) + '-' + pad(m[6]);
    }
    m = t.match(/(\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})[^\d]{1,15}(\d{1,2})\.\s*(\d{1,2})/);
    if (m && parseInt(m[1]) >= 20 && parseInt(m[1]) <= 35) {
      return '20' + m[1] + '-' + pad(m[2]) + '-' + pad(m[3]) + ' ~ 20' + m[1] + '-' + pad(m[4]) + '-' + pad(m[5]);
    }
    return null;
  }

  function detectDateRange() {
    var selectors = [
      '[class*="date"]', '[class*="Date"]', '[class*="period"]', '[class*="Period"]',
      '[class*="calendar"]', '[class*="Calendar"]', '[class*="range"]', '[class*="Range"]',
      '[class*="navi"]', '[class*="Navi"]', '[class*="week"]', '[class*="Week"]',
      '[class*="term"]', '[class*="Term"]',
    ];
    for (var s = 0; s < selectors.length; s++) {
      try {
        var els = document.querySelectorAll(selectors[s]);
        for (var i = 0; i < els.length; i++) {
          var t = (els[i].textContent || '').trim();
          if (t.length >= 5 && t.length <= 80) {
            var result = tryParseDateRange(t);
            if (result) return result;
          }
        }
      } catch(e) {}
    }
    var allEls = document.querySelectorAll('span, button, a, div, p, td, th, label, strong, em, b');
    for (var j = 0; j < allEls.length; j++) {
      var tc = (allEls[j].textContent || '').trim();
      if (tc.length < 5 || tc.length > 80 || !/\d/.test(tc)) continue;
      if (!/[월화수목금토일]/.test(tc) && !/[-–—~]/.test(tc)) continue;
      var r2 = tryParseDateRange(tc);
      if (r2) return r2;
    }
    var bodyText = normalizeText((document.body ? document.body.innerText : '') || '');
    return tryParseDateRange(bodyText) || '';
  }

  function detectPeriod() {
    var text = (document.body ? document.body.innerText : '') || '';
    return /월간|월별/.test(text) ? '월별' : '주별';
  }

  function detectActiveTab() {
    // 핵심: 페이지에 보이는 내용으로 판별
    // 리포트 탭 전용: "방문 전 지표", "방문 후 지표", "예약·주문 신청", "스마트콜 통화"
    // 플레이스 탭 전용: "유입 채널", "유입 키워드", "시간·요일별" (유입 수 차트와 함께)

    var bodyText = document.body.innerText || '';

    // 플레이스 탭 특징: "유입 채널"과 "유입 키워드"가 동시에 보임
    var hasChannel = /유입\s*채널/.test(bodyText);
    var hasKeyword = /유입\s*키워드/.test(bodyText);

    // 리포트 탭 특징: "방문 전 지표"와 "방문 후 지표"가 보임
    var hasVisitBefore = /방문\s*전\s*지표/.test(bodyText);
    var hasVisitAfter = /방문\s*후\s*지표/.test(bodyText);

    // 리포트 탭이 확실한 경우 (방문 전/후 지표가 보이면 리포트)
    if (hasVisitBefore || hasVisitAfter) return '리포트';

    // 플레이스 탭이 확실한 경우 (유입 채널 + 유입 키워드가 보이면 플레이스)
    if (hasChannel && hasKeyword) return '플레이스';

    // URL 체크 (보조)
    var url = window.location.href || '';
    if (/placeTab=inflow/i.test(url)) return '플레이스';
    if (/menu=reports/i.test(url) && !/placeTab/i.test(url)) return '리포트';

    // 기본값
    return '리포트';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createExtractButton);
  } else {
    createExtractButton();
  }
})();
