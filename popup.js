(function () {
  'use strict';

  const elements = {
    btnExtract: document.getElementById('btn-extract'),
    btnExportXlsx: document.getElementById('btn-export-xlsx'),
    btnVisualize: document.getElementById('btn-visualize'),
    emptyMessage: document.getElementById('empty-message'),
    tableWrapper: document.getElementById('table-wrapper'),
    periodSection: document.getElementById('period-section'),
    periodSelect: document.getElementById('period-select'),
    historySelect: document.getElementById('history-select'),
    periodBadge: document.getElementById('period-badge'),
    placeSection: document.getElementById('place-section'),
    placeChannelWrapper: document.getElementById('place-channel-wrapper'),
    placeKeywordWrapper: document.getElementById('place-keyword-wrapper'),
  };

  let extractedData = null;
  let extractionHistory = [];
  let placeData = null;

  function loadStoredData() {
    chrome.storage.local.get(['nspExtractedData', 'nspExtractionHistory', 'nspPlaceData'], (result) => {
      extractedData = result.nspExtractedData;
      extractionHistory = Array.isArray(result.nspExtractionHistory) ? result.nspExtractionHistory : [];
      placeData = result.nspPlaceData || null;

      var hasReportRows = extractedData && extractedData.rows && extractedData.rows.length > 0;
      if (hasReportRows) {
        if (elements.emptyMessage) elements.emptyMessage.style.display = 'none';
        if (elements.tableWrapper) elements.tableWrapper.style.display = '';
        renderPreview(getFilteredRows());
        elements.btnExportXlsx.disabled = false;
        elements.btnVisualize.disabled = false;
        elements.periodSection.style.display = 'flex';
        updateHistorySelect();
        updatePeriodBadge();
      } else {
        if (elements.emptyMessage) elements.emptyMessage.style.display = 'block';
        if (elements.tableWrapper) elements.tableWrapper.style.display = 'none';
        elements.btnExportXlsx.disabled = true;
        elements.btnVisualize.disabled = true;
      }

      if (placeData) {
        renderPlaceData(placeData);
      }
    });
  }

  function getFilteredRows() {
    const period = elements.periodSelect?.value || 'all';
    const historyId = elements.historySelect?.value || 'latest';
    if (historyId !== 'latest' && extractionHistory.length > 0) {
      const item = extractionHistory.find((h) => h.extractedAt === historyId) || extractionHistory[0];
      let rows = item.rows || [];
      if (period !== 'all') rows = rows.filter((r) => (r.기간 || '').includes(period) || item.period === period);
      return rows;
    }
    if (!extractedData || !extractedData.rows) return [];
    let rows = extractedData.rows;
    if (period !== 'all') {
      rows = rows.filter((r) => (r.기간 || '').includes(period) || extractedData.period === period);
    }
    return rows;
  }

  function getDataForExport() {
    const rows = toCleanFormat(getFilteredRows());
    return { ...(extractedData || {}), rows };
  }

  function updateHistorySelect() {
    if (!elements.historySelect) return;
    elements.historySelect.innerHTML = '<option value="latest">최신 추출</option>';
    extractionHistory.forEach((h, i) => {
      const opt = document.createElement('option');
      opt.value = h.extractedAt || i;
      opt.textContent = `${h.period || '-'} / ${h.tab || '-'} ${h.dateRange || ''}`.trim() || `추출 ${i + 1}`;
      elements.historySelect.appendChild(opt);
    });
  }

  function updatePeriodBadge() {
    if (!elements.periodBadge) return;
    const period = elements.periodSelect?.value || 'all';
    const hid = elements.historySelect?.value;
    const data = hid === 'latest' ? extractedData : extractionHistory.find((h) => h.extractedAt === hid);
    const label = period === 'all' ? (data ? ` ${data.tab || ''} ${data.dateRange || ''}`.trim() : '') : ` (${period})`;
    elements.periodBadge.textContent = label;
  }

  function matchCategory(text) {
    const t = String(text || '');
    if (/유입/.test(t)) return '유입';
    if (/예약|주문/.test(t)) return '예약/주문';
    if (/스마트콜/.test(t)) return '스마트콜';
    if (/리뷰/.test(t)) return '리뷰';
    return null;
  }

  function toCleanFormat(rows) {
    const cleanCols = ['주간', '유입', '예약/주문', '스마트콜', '리뷰'];
    const validFallback = !!(extractedData?.dateRange && /^\d{4}-\d{2}-\d{2}\s*~\s*\d{4}-\d{2}-\d{2}$/.test(extractedData.dateRange));
    if (rows.some((r) => cleanCols.some((c) => c in r && r[c] !== ''))) {
      return rows.map((r) => {
        const period = String(r.주간 ?? '').trim();
        if ((!period || /^(주간|주별|월별)$/.test(period)) && validFallback) {
          return { ...r, 주간: extractedData.dateRange };
        }
        return r;
      });
    }
    const byPeriod = {};
    const defaultPeriod = validFallback ? extractedData.dateRange : '주간';
    rows.forEach((r) => {
      const key = String(r.구분 ?? '');
      let val = String(r.값 ?? r.회수 ?? '').replace(/[^\d]/g, '') || '';
      if (!val && key) val = (key.match(/(\d+)\s*회/) || key.match(/(\d+)/))?.[1] || '';
      const period = r.기간 || defaultPeriod;
      const target = matchCategory(key);
      if (target && val) {
        if (!byPeriod[period]) byPeriod[period] = { 주간: period, 유입: '', '예약/주문': '', 스마트콜: '', 리뷰: '' };
        byPeriod[period][target] = val;
      }
    });
    const out = Object.values(byPeriod).filter((r) => Object.values(r).some((v) => v));
    return out.length ? out : rows;
  }

  function addConversionRates(rows) {
    return rows.map(function(r) {
      var row = Object.assign({}, r);
      var inflow = parseFloat(String(row['유입'] || '0').replace(/[,]/g, '')) || 0;
      var order = parseFloat(String(row['예약/주문'] || '0').replace(/[,]/g, '')) || 0;
      var review = parseFloat(String(row['리뷰'] || '0').replace(/[,]/g, '')) || 0;
      row['전환율'] = inflow > 0 ? (order / inflow * 100).toFixed(1) + '%' : '-';
      row['리뷰전환율'] = order > 0 ? (review / order * 100).toFixed(1) + '%' : '-';
      return row;
    });
  }

  function renderPreview(rows) {
    elements.emptyMessage.style.display = 'none';
    elements.tableWrapper.style.display = 'block';

    const displayRows = addConversionRates(toCleanFormat(rows));
    const headers = ['주간', '유입', '예약/주문', '전환율', '스마트콜', '리뷰', '리뷰전환율'];
    let html = '<table class="preview-table"><thead><tr>';
    headers.forEach((h) => {
      html += `<th>${escapeHtml(h)}</th>`;
    });
    html += '</tr></thead><tbody>';

    displayRows.slice(0, 20).forEach((row) => {
      html += '<tr>';
      headers.forEach((h) => {
        html += `<td>${escapeHtml(String(row[h] ?? ''))}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    if (displayRows.length > 20) {
      html += `<p style="padding:8px;font-size:11px;color:#9ca3af">외 ${displayRows.length - 20}건...</p>`;
    }

    elements.tableWrapper.innerHTML = html;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function orderedHeaders(rows, priorityCols) {
    var allKeys = new Set();
    rows.forEach(function(r) { Object.keys(r || {}).forEach(function(k) { allKeys.add(k); }); });
    var headers = priorityCols.filter(function(h) { return allKeys.has(h); });
    var rest = [];
    allKeys.forEach(function(k) { if (headers.indexOf(k) === -1) rest.push(k); });
    var firstRow = rows[0] || {};
    rest.sort(function(a, b) {
      var va = parseFloat(String(firstRow[a] || '0').replace(/[,%]/g, '')) || 0;
      var vb = parseFloat(String(firstRow[b] || '0').replace(/[,%]/g, '')) || 0;
      return vb - va;
    });
    return headers.concat(rest);
  }

  function exportToXlsx() {
    if (typeof XlsxWriter === 'undefined') {
      alert('xlsx-writer.js를 불러올 수 없습니다.');
      return;
    }
    var sheets = [];

    // 시트 1: 주별 지표 — 전환율 포함
    const data = getDataForExport();
    if (data && data.rows && data.rows.length > 0) {
      sheets.push({
        name: '주별 지표',
        rows: addConversionRates(data.rows),
        headers: ['주간', '유입', '예약/주문', '전환율', '스마트콜', '리뷰', '리뷰전환율'],
      });
    }

    // 시트 2: 유입 채널 — 주간, 유입수, 나머지 채널(값 내림차순)
    if (placeData && Array.isArray(placeData.channels) && placeData.channels.length > 0) {
      sheets.push({
        name: '유입 채널',
        rows: placeData.channels,
        headers: orderedHeaders(placeData.channels, ['주간', '유입수']),
      });
    }

    // 시트 3: 유입 키워드 — 주간, 나머지 키워드(값 내림차순)
    if (placeData && Array.isArray(placeData.keywords) && placeData.keywords.length > 0) {
      sheets.push({
        name: '유입 키워드',
        rows: placeData.keywords,
        headers: orderedHeaders(placeData.keywords, ['주간']),
      });
    }

    XlsxWriter.saveXlsx(sheets, '\uC2A4\uB9C8\uD2B8\uD50C\uB808\uC774\uC2A4_\uD1B5\uACC4_' + formatDate(new Date()) + '.xlsx');
  }

  function formatDate(d) {
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function openVisualization() {
    const data = getDataForExport();
    let rows = data?.rows || [];
    if (rows.length === 0) rows = extractedData?.rows || [];

    const dateRange = extractedData?.dateRange || '';
    chrome.storage.local.set({ nspVisualizeData: rows, nspExtractedDateRange: dateRange }, () => {
      const url = (typeof FX_CLOUD !== 'undefined' && FX_CLOUD.DASHBOARD_URL)
        ? FX_CLOUD.DASHBOARD_URL
        : chrome.runtime.getURL('dashboard.html');
      chrome.tabs.create({ url: url });
    });
  }

  // === 추출 로직을 직접 주입 (캐시 우회) ===
  function injectedExtractFunction() {
    var NSP_VERSION = 'v7';

    function normalizeText(str) {
      return (str || '').replace(/[\s\u00a0\u200b\u200c\u200d\u2060\ufeff\u3000]+/g, ' ').trim();
    }

    function pad(n) { return String(n).padStart(2, '0'); }

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
      var active = document.querySelector('[class*="tab"][class*="active"], [aria-selected="true"]');
      var text = (active ? active.textContent : '') || '';
      if (/플레이스/.test(text)) return '플레이스';
      if (/리포트/.test(text)) return '리포트';
      return '통계';
    }

    // ===== 핵심 수정: 각 카테고리를 개별적으로 검색 =====
    function extractHoeCounts(dateRange) {
      var rows = [];
      var rawText = document.body.innerText || '';
      var lines = rawText.split(/\n/);
      var fallback = dateRange || '';

      // 각 카테고리별 패턴 (라벨 패턴 + 컬럼명)
      var labelMap = [
        { pattern: /플레이스\s*유입|유입\s*수|유입수/, col: '유입' },
        { pattern: /예약[\s·.\/:]*주문/, col: '예약/주문' },
        { pattern: /스마트콜/, col: '스마트콜' },
        { pattern: /리뷰\s*등록/, col: '리뷰' },
      ];

      // 각 카테고리를 독립적으로 검색
      for (var c = 0; c < labelMap.length; c++) {
        var found = false;
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!labelMap[c].pattern.test(line)) continue;

          // 이 줄에서 "N회" 찾기
          var numMatch = line.match(/(\d+)\s*회/);
          if (numMatch) {
            rows.push({ '구분': labelMap[c].col, '값': numMatch[1], '기간': fallback });
            found = true;
            break;
          }
          // 이 줄에 없으면 다음 3줄까지 검색
          for (var k = i + 1; k < Math.min(i + 4, lines.length); k++) {
            numMatch = lines[k].trim().match(/^(\d+)\s*회/);
            if (numMatch) {
              rows.push({ '구분': labelMap[c].col, '값': numMatch[1], '기간': fallback });
              found = true;
              break;
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

    // 실행
    var period = detectPeriod();
    var dateRange = detectDateRange();
    var tab = detectActiveTab();
    var hoeMatches = extractHoeCounts(dateRange);
    var cleanRows = pivotToWeeklyTable(hoeMatches, dateRange);
    var rows = cleanRows.length > 0 ? cleanRows : hoeMatches;

    var data = {
      extractedAt: new Date().toISOString(),
      period: period,
      dateRange: dateRange,
      tab: tab,
      rows: rows,
    };

    // 간결한 알림
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:12px;right:12px;background:rgba(0,0,0,0.75);color:#fff;padding:8px 16px;border-radius:6px;z-index:999999;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
    el.textContent = NSP_VERSION + ' ✓ ' + hoeMatches.length + '개 항목';
    document.body.appendChild(el);
    setTimeout(function() { el.remove(); }, 2500);

    return data;
  }

  elements.btnExtract.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) return;
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: injectedExtractFunction,
      }).then((results) => {
        const data = results[0]?.result;
        if (!data || !data.rows || data.rows.length === 0) return;
        // storage에 저장
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
            () => {
              extractedData = data;
              extractionHistory = trimmed;
              renderPreview(getFilteredRows());
              elements.btnExportXlsx.disabled = false;
              elements.btnVisualize.disabled = false;
              elements.periodSection.style.display = 'flex';
              updateHistorySelect();
              updatePeriodBadge();
            }
          );
        });
      }).catch((err) => {
        console.error('추출 실패:', err);
      });
    });
  });

  elements.btnExportXlsx.addEventListener('click', exportToXlsx);
  elements.btnVisualize.addEventListener('click', openVisualization);

  elements.periodSelect?.addEventListener('change', () => {
    const rows = getFilteredRows();
    if (rows.length) renderPreview(rows);
    updatePeriodBadge();
  });
  elements.historySelect?.addEventListener('change', () => {
    const rows = getFilteredRows();
    if (rows.length) renderPreview(rows);
    updatePeriodBadge();
  });

  // ===== 플레이스 데이터 렌더링 =====
  function renderPlaceData(data) {
    if (!data) return;
    elements.placeSection.style.display = 'block';
    elements.btnExportXlsx.disabled = false;
    elements.btnVisualize.disabled = false;

    // 채널 테이블
    var channels = Array.isArray(data.channels) ? data.channels : [];
    if (channels.length > 0) {
      elements.placeChannelWrapper.innerHTML = buildPlaceTable(channels);
    }

    // 키워드 테이블
    var keywords = Array.isArray(data.keywords) ? data.keywords : [];
    if (keywords.length > 0) {
      elements.placeKeywordWrapper.innerHTML = buildPlaceTable(keywords);
    }
  }

  function buildPlaceTable(rows) {
    if (!rows || rows.length === 0) return '<p style="color:#9ca3af;font-size:12px;">데이터 없음</p>';
    // 모든 행에서 키 수집
    var allKeys = new Set();
    rows.forEach(function(r) { Object.keys(r || {}).forEach(function(k) { allKeys.add(k); }); });
    // 주간, 유입수 우선 → 나머지는 첫 행의 값 크기순 (큰 값이 왼쪽)
    var priority = ['주간', '유입수'];
    var headers = priority.filter(function(h) { return allKeys.has(h); });
    var rest = [];
    allKeys.forEach(function(k) { if (headers.indexOf(k) === -1) rest.push(k); });
    // 나머지 컬럼은 첫 행 기준으로 값 내림차순 정렬
    var firstRow = rows[0] || {};
    rest.sort(function(a, b) {
      var va = parseFloat(String(firstRow[a] || '0').replace('%', '')) || 0;
      var vb = parseFloat(String(firstRow[b] || '0').replace('%', '')) || 0;
      return vb - va;
    });
    headers = headers.concat(rest);

    var html = '<table class="preview-table"><thead><tr>';
    headers.forEach(function(h) { html += '<th>' + escapeHtml(h) + '</th>'; });
    html += '</tr></thead><tbody>';
    rows.forEach(function(row) {
      html += '<tr>';
      headers.forEach(function(h) { html += '<td>' + escapeHtml(String(row[h] || '')) + '</td>'; });
      html += '</tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  // ===== 데이터 초기화 =====
  document.getElementById('btn-clear')?.addEventListener('click', () => {
    if (!confirm('모든 추출 데이터를 삭제하시겠습니까?')) return;
    chrome.storage.local.remove([
      'nspExtractedData', 'nspExtractionHistory', 'nspPlaceData', 'nspVisualizeData', 'nspExtractedDateRange'
    ], () => {
      extractedData = null;
      extractionHistory = [];
      placeData = null;
      elements.tableWrapper.style.display = 'none';
      elements.emptyMessage.style.display = 'block';
      elements.periodSection.style.display = 'none';
      elements.placeSection.style.display = 'none';
      elements.btnExportXlsx.disabled = true;
      elements.btnVisualize.disabled = true;
      alert('✅ 데이터가 초기화되었습니다.');
    });
  });

  // ===== 메시지 리스너 =====
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'DATA_EXTRACTED' && msg.data) {
      extractedData = msg.data;
      if (extractedData.rows && extractedData.rows.length > 0) {
        extractionHistory.unshift({
          period: extractedData.period,
          dateRange: extractedData.dateRange,
          tab: extractedData.tab,
          rows: extractedData.rows,
          extractedAt: extractedData.extractedAt,
        });
        extractionHistory = extractionHistory.slice(0, 50);
        renderPreview(getFilteredRows());
        elements.btnExportXlsx.disabled = false;
        elements.btnVisualize.disabled = false;
        elements.periodSection.style.display = 'flex';
        updateHistorySelect();
        updatePeriodBadge();
      }
    }
    if (msg.type === 'PLACE_DATA_EXTRACTED' && msg.data) {
      placeData = msg.data;
      renderPlaceData(placeData);
    }
  });

  loadStoredData();

  document.getElementById('btn-refresh-report').addEventListener('click', function () { loadStoredData(); });
  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg && (msg.type === 'DATA_EXTRACTED' || msg.type === 'PLACE_DATA_EXTRACTED')) loadStoredData();
  });

  // ===== 클라우드 동기화 =====
  var cloudProfile = null;
  var cloudBranches = [];

  function showCloudLogin(show) {
    document.getElementById('cloud-login-box').style.display = show ? 'block' : 'none';
    document.getElementById('cloud-logged-box').style.display = show ? 'none' : 'block';
    if (show) document.getElementById('cloud-login-error').textContent = '';
  }

  function showCloudLogged(name, brandName) {
    document.getElementById('cloud-user-name').textContent = name || '';
    document.getElementById('cloud-brand-name').textContent = brandName || '';
    var sel = document.getElementById('cloud-branch-select');
    sel.innerHTML = '';
    cloudBranches.forEach(function (b) {
      var opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.name;
      sel.appendChild(opt);
    });
    FXCloud.getBranchId().then(function (savedId) {
      if (savedId) sel.value = savedId;
      else if (cloudBranches.length) sel.value = cloudBranches[0].id;
    });
    showCloudLogin(false);
  }

  function loadCloudUI() {
    if (typeof FXCloud === 'undefined') return;
    FXCloud.getSession().then(function (token) {
      if (!token) {
        showCloudLogin(true);
        return;
      }
      FXCloud.getProfileAndBranches(token).then(function (data) {
        cloudProfile = data.profile;
        cloudBranches = data.branches || [];
        var brandName = cloudProfile.brands ? cloudProfile.brands.name : '';
        var userName = cloudProfile.name || cloudProfile.email || '';
        showCloudLogged(userName, brandName);
      }).catch(function (err) {
        FXCloud.signOut();
        showCloudLogin(true);
        document.getElementById('cloud-login-error').textContent = err.message || '세션 만료';
      });
    });
  }

  document.getElementById('btn-cloud-logout').addEventListener('click', function () {
    FXCloud.signOut();
    cloudProfile = null;
    cloudBranches = [];
    showCloudLogin(true);
  });

  document.getElementById('cloud-branch-select').addEventListener('change', function () {
    FXCloud.setBranchId(this.value || null);
  });

  document.getElementById('btn-cloud-sync').addEventListener('click', function () {
    var statusEl = document.getElementById('cloud-sync-status');
    var btn = document.getElementById('btn-cloud-sync');
    var branchId = document.getElementById('cloud-branch-select').value;
    if (!branchId) { statusEl.textContent = '지점을 선택하세요.'; return; }
    FXCloud.getStoredSession(function (token) {
      if (!token) { statusEl.textContent = '다시 로그인해 주세요.'; return; }
      statusEl.textContent = '업로드 중...';
      btn.disabled = true;

      var reportRows = addConversionRates(toCleanFormat(getFilteredRows()));
      var channels = (placeData && placeData.channels) ? placeData.channels : [];
      var keywords = (placeData && placeData.keywords) ? placeData.keywords : [];
      var brandKeywords = (cloudProfile && cloudProfile.brands && cloudProfile.brands.brand_keywords) ? cloudProfile.brands.brand_keywords : [];

      var p1 = reportRows.length ? FXCloud.upsertPlaceWeekly(branchId, reportRows, token) : Promise.resolve();
      var p2 = FXCloud.upsertPlaceChannels(branchId, channels, token);
      var p3 = FXCloud.upsertPlaceKeywords(branchId, keywords, brandKeywords, token);

      Promise.all([p1, p2, p3]).then(function () {
        statusEl.textContent = '✓ 업로드 완료 (리포트 ' + reportRows.length + '주, 채널 ' + channels.length + '주, 키워드 ' + keywords.length + '주)';
        statusEl.style.color = '#16a34a';
      }).catch(function (err) {
        statusEl.textContent = '업로드 실패: ' + (err.message || err);
        statusEl.style.color = '#dc2626';
      }).finally(function () {
        btn.disabled = false;
      });
    });
  });

  document.getElementById('btn-cloud-login').addEventListener('click', function () {
    var email = document.getElementById('cloud-email').value.trim();
    var password = document.getElementById('cloud-password').value;
    var errEl = document.getElementById('cloud-login-error');
    var btn = document.getElementById('btn-cloud-login');
    errEl.textContent = '';
    if (!email || !password) { errEl.textContent = '이메일과 비밀번호를 입력하세요.'; return; }
    btn.disabled = true;
    btn.textContent = '로그인 중...';
    FXCloud.signIn(email, password).then(function () {
      return FXCloud.getSession();
    }).then(function (token) {
      return FXCloud.getProfileAndBranches(token);
    }).then(function (data) {
      cloudProfile = data.profile;
      cloudBranches = data.branches || [];
      showCloudLogged(cloudProfile.name || cloudProfile.email, cloudProfile.brands ? cloudProfile.brands.name : '');
    }).catch(function (err) {
      errEl.textContent = err.message || '로그인 실패';
    }).finally(function () {
      btn.disabled = false;
      btn.textContent = '로그인';
    });
  });

  document.getElementById('btn-cloud-google-login').addEventListener('click', function () {
    var errEl = document.getElementById('cloud-login-error');
    errEl.textContent = '';
    if (typeof FX_CLOUD === 'undefined' || !FX_CLOUD.SUPABASE_URL) { errEl.textContent = '클라우드 설정이 없습니다.'; return; }
    var redirectTo = chrome.identity.getRedirectURL();
    var authUrl = FX_CLOUD.SUPABASE_URL + '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(redirectTo);
    chrome.tabs.create({ url: authUrl });
    errEl.textContent = '새 탭에서 Google 로그인을 완료한 뒤, 확장 프로그램 아이콘을 다시 클릭하세요.';
    errEl.style.color = '#64748b';
  });

  loadCloudUI();
})();
