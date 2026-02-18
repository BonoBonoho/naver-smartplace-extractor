(function () {
  'use strict';

  let rawData = [];

  function getData() {
    return new Promise((resolve) => {
      function doFetch(cb) {
        chrome.storage.local.get(['nspVisualizeData', 'nspExtractedData', 'nspExtractedDateRange'], (r) => {
          const data = r.nspVisualizeData || r.nspExtractedData?.rows || [];
          const dateRange = r.nspExtractedDateRange || r.nspExtractedData?.dateRange || '';
          cb(Array.isArray(data) ? data : [], dateRange);
        });
      }
      doFetch((rows, dateRange) => {
        if (rows.length > 0) return resolve({ rows, dateRange });
        setTimeout(() => doFetch((r, d) => resolve({ rows: Array.isArray(r) ? r : [], dateRange: d || '' })), 300);
      });
    });
  }

  function getAllHeaders(rows) {
    const keys = new Set();
    rows.forEach((r) => Object.keys(r || {}).forEach((k) => keys.add(k)));
    return [...keys];
  }

  function matchCategory(text) {
    const t = String(text || '');
    if (/유입/.test(t)) return '유입';
    if (/예약|주문/.test(t)) return '예약/주문';
    if (/스마트콜/.test(t)) return '스마트콜';
    if (/리뷰/.test(t)) return '리뷰';
    return null;
  }

  function toCleanTableFormat(rows, dateRangeFallback) {
    const cleanCols = ['주간', '유입', '예약/주문', '스마트콜', '리뷰'];
    const validFallback = !!(dateRangeFallback && /^\d{4}-\d{2}-\d{2}\s*~\s*\d{4}-\d{2}-\d{2}$/.test(dateRangeFallback));
    const hasClean = rows.some((r) => cleanCols.some((c) => c in r && r[c] !== ''));
    if (hasClean) {
      return rows.map((r) => {
        const period = String(r.주간 ?? '').trim();
        if ((!period || /^(주간|주별|월별)$/.test(period)) && validFallback) {
          return { ...r, 주간: dateRangeFallback };
        }
        return r;
      });
    }

    const byPeriod = {};
    const defaultPeriod = validFallback ? dateRangeFallback : '주간';
    rows.forEach((r) => {
      const key = String(r.구분 ?? '');
      let val = String(r.값 ?? r.회수 ?? '').replace(/[^\d]/g, '') || '';
      if (!val && key) val = (key.match(/(\d+)\s*회/) || key.match(/(\d+)/))?.[1] || '';
      const period = (r.기간 && /^\d{4}-\d{2}-\d{2}/.test(r.기간)) ? r.기간 : defaultPeriod;

      const targetCol = matchCategory(key);
      if (targetCol && val) {
        if (!byPeriod[period]) byPeriod[period] = { 주간: period, 유입: '', '예약/주문': '', 스마트콜: '', 리뷰: '' };
        byPeriod[period][targetCol] = val;
      }
    });
    return Object.values(byPeriod).filter((r) => Object.values(r).some((v) => v));
  }

  // ===== 전환율 계산 =====
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

  // ===== 인라인 바 차트 =====
  var COL_COLORS = {
    '유입': '3,199,90',        // 초록
    '예약/주문': '59,130,246',  // 파랑
    '스마트콜': '245,158,11',   // 주황
    '리뷰': '168,85,247',      // 보라
    '전환율': '236,72,153',     // 핑크
    '리뷰전환율': '20,184,166', // 틸
    '유입수': '3,199,90',
  };
  var DEFAULT_COLORS = [
    '3,199,90', '59,130,246', '245,158,11', '168,85,247',
    '236,72,153', '20,184,166', '99,102,241',
  ];

  function calcColumnMax(rows, numCols) {
    var maxes = {};
    numCols.forEach(function(col) {
      var vals = rows.map(function(r) {
        return parseFloat(String(r[col] || '0').replace(/[,%]/g, '')) || 0;
      });
      maxes[col] = Math.max.apply(null, vals) || 1;
    });
    return maxes;
  }

  function getColColor(colName, idx) {
    return COL_COLORS[colName] || DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
  }

  function barCell(numVal, displayText, maxVal, rgb) {
    var pct = Math.min(100, Math.round((numVal / maxVal) * 100));
    return '<td><div class="bar-cell">'
      + '<div class="bar-fill" style="width:' + pct + '%;background:rgba(' + rgb + ',0.25);"></div>'
      + '<span class="bar-value">' + escapeHtml(displayText) + '</span>'
      + '</div></td>';
  }

  function renderTable(rows) {
    const area = document.getElementById('table-area');
    if (!rows.length) { area.innerHTML = ''; return; }

    const cleanRows = addConversionRates(toCleanTableFormat(rows));
    const headers = ['주간', '유입', '예약/주문', '전환율', '스마트콜', '리뷰', '리뷰전환율'];
    const numCols = ['유입', '예약/주문', '스마트콜', '리뷰'];
    const pctCols = ['전환율', '리뷰전환율'];
    const maxes = calcColumnMax(cleanRows, numCols.concat(pctCols));

    let html = '<h3 class="table-title">주별 지표</h3><table><thead><tr>';
    headers.forEach((h) => { html += `<th>${escapeHtml(h)}</th>`; });
    html += '</tr></thead><tbody>';

    cleanRows.forEach((row) => {
      html += '<tr>';
      headers.forEach((h, ci) => {
        const rawVal = String(row[h] ?? '');
        const numVal = parseFloat(rawVal.replace(/[,%]/g, '')) || 0;
        if (numCols.includes(h) && numVal > 0) {
          html += barCell(numVal, String(Math.round(numVal)), maxes[h], getColColor(h, ci));
        } else if (pctCols.includes(h) && numVal > 0) {
          html += barCell(numVal, rawVal, maxes[h], getColColor(h, ci));
        } else {
          html += `<td>${escapeHtml(rawVal)}</td>`;
        }
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    area.innerHTML = html;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatDate() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // ===== Excel (xlsx) 다중 시트 내보내기 =====
  // 시각화 테이블과 동일한 컬럼 순서를 유지
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

  function exportXlsx() {
    if (typeof XlsxWriter === 'undefined') {
      alert('xlsx-writer.js를 불러올 수 없습니다.');
      return;
    }
    var sheets = [];

    // 시트 1: 주별 지표 — 전환율 포함
    if (rawData.length > 0) {
      sheets.push({
        name: '주별 지표',
        rows: addConversionRates(rawData),
        headers: ['주간', '유입', '예약/주문', '전환율', '스마트콜', '리뷰', '리뷰전환율'],
      });
    }

    // 시트 2: 유입 채널 — 주간, 유입수, 나머지 채널(값 내림차순)
    if (placeChannelData.length > 0) {
      sheets.push({
        name: '유입 채널',
        rows: placeChannelData,
        headers: orderedHeaders(placeChannelData, ['주간', '유입수']),
      });
    }

    // 시트 3: 유입 키워드 — 주간, 나머지 키워드(값 내림차순)
    if (placeKeywordData.length > 0) {
      sheets.push({
        name: '유입 키워드',
        rows: placeKeywordData,
        headers: orderedHeaders(placeKeywordData, ['주간']),
      });
    }

    XlsxWriter.saveXlsx(sheets, '\uC2A4\uB9C8\uD2B8\uD50C\uB808\uC774\uC2A4_\uD1B5\uACC4_' + formatDate() + '.xlsx');
  }

  // ===== 플레이스 데이터 렌더링 =====
  function getPlaceData() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['nspPlaceData'], (r) => {
        resolve(r.nspPlaceData || null);
      });
    });
  }

  function renderPlaceTable(containerId, title, rows) {
    const container = document.getElementById(containerId);
    if (!rows || rows.length === 0) { container.style.display = 'none'; return; }
    container.style.display = 'block';

    // 헤더 수집: 주간, 유입수 우선 → 나머지 값 내림차순
    const allKeys = new Set();
    rows.forEach((r) => Object.keys(r || {}).forEach((k) => allKeys.add(k)));
    const priority = ['주간', '유입수'];
    const headers = priority.filter((h) => allKeys.has(h));
    const rest = [];
    allKeys.forEach((k) => { if (!headers.includes(k)) rest.push(k); });
    const firstRow = rows[0] || {};
    rest.sort((a, b) => {
      const va = parseFloat(String(firstRow[a] || '0').replace('%', '')) || 0;
      const vb = parseFloat(String(firstRow[b] || '0').replace('%', '')) || 0;
      return vb - va;
    });
    const finalHeaders = headers.concat(rest);

    const numCols = finalHeaders.filter((h) => h !== '주간');
    const maxes = calcColumnMax(rows, numCols);

    let html = `<h3 class="table-title">${escapeHtml(title)}</h3><table><thead><tr>`;
    finalHeaders.forEach((h) => { html += `<th>${escapeHtml(h)}</th>`; });
    html += '</tr></thead><tbody>';
    rows.forEach((row) => {
      html += '<tr>';
      finalHeaders.forEach((h, ci) => {
        const rawVal = String(row[h] || '');
        const numVal = parseFloat(rawVal.replace(/[,%]/g, '')) || 0;
        if (h === '주간') {
          html += `<td>${escapeHtml(rawVal)}</td>`;
        } else if (numVal > 0 && maxes[h]) {
          const display = /%/.test(rawVal) ? rawVal : String(Math.round(numVal));
          html += barCell(numVal, display, maxes[h], getColColor(h, ci));
        } else {
          html += `<td style="text-align:center;">${escapeHtml(rawVal)}</td>`;
        }
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  let placeChannelData = [];
  let placeKeywordData = [];

  document.getElementById('btn-export-xlsx').addEventListener('click', exportXlsx);

  // ===== 초기화 =====
  Promise.all([getData(), getPlaceData()]).then(([reportRes, placeRes]) => {
    // 리포트 데이터
    const data = reportRes?.rows ?? reportRes;
    let rows = Array.isArray(data) ? data : [];
    const dateRange = reportRes?.dateRange ?? '';
    const clean = toCleanTableFormat(rows, dateRange);
    rawData = clean.length > 0 ? clean : rows;

    const emptyEl = document.getElementById('empty-state');
    const countEl = document.getElementById('data-count');

    // 플레이스 데이터
    if (placeRes) {
      placeChannelData = Array.isArray(placeRes.channels) ? placeRes.channels : [];
      placeKeywordData = Array.isArray(placeRes.keywords) ? placeRes.keywords : [];
    }

    const hasAnyData = rawData.length > 0 || placeChannelData.length > 0;

    if (countEl) {
      countEl.style.display = 'inline';
      const parts = [];
      if (rawData.length > 0) parts.push(`리포트 ${rawData.length}건`);
      if (placeChannelData.length > 0) parts.push(`채널 ${placeChannelData.length}건`);
      if (placeKeywordData.length > 0) parts.push(`키워드 ${placeKeywordData.length}건`);
      countEl.textContent = parts.length > 0 ? parts.join(', ') + ' 로드됨' : '';
    }

    if (!hasAnyData) {
      emptyEl.style.display = 'block';
      if (countEl) countEl.style.display = 'none';
      return;
    }
    emptyEl.style.display = 'none';

    // 리포트 테이블 (전환율 포함)
    if (rawData.length > 0) {
      renderTable(rawData);
    }

    // 플레이스 채널 + 키워드 테이블
    renderPlaceTable('place-channel-section', '📍 플레이스 유입 채널 (유입수 × 채널비율)', placeChannelData);
    renderPlaceTable('place-keyword-section', '🔍 플레이스 유입 키워드', placeKeywordData);
  });
})();
