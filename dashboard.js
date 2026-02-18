(function () {
  'use strict';

  // ================================================================
  //  공통 유틸
  // ================================================================
  function esc(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
  function fmtDate() {
    var d = new Date();
    return d.getFullYear() + S(d.getMonth() + 1) + S(d.getDate()) + '_' + S(d.getHours()) + S(d.getMinutes());
  }
  function S(n) { return String(n).padStart(2, '0'); }
  function fmtNum(n) { return n == null ? '-' : Number(n).toLocaleString('ko-KR'); }
  function pctStr(n) { return n == null ? '-' : n.toFixed(1) + '%'; }

  var COL_COLORS = {
    '유입': '3,199,90', '예약/주문': '59,130,246', '스마트콜': '245,158,11',
    '리뷰': '168,85,247', '전환율': '236,72,153', '리뷰전환율': '20,184,166', '유입수': '3,199,90',
  };
  var DEF_COLORS = ['3,199,90', '59,130,246', '245,158,11', '168,85,247', '236,72,153', '20,184,166', '99,102,241'];

  function getCC(name, idx) { return COL_COLORS[name] || DEF_COLORS[idx % DEF_COLORS.length]; }
  function calcMax(rows, cols) {
    var m = {};
    cols.forEach(function (c) {
      var vals = rows.map(function (r) { return parseFloat(String(r[c] || '0').replace(/[,%]/g, '')) || 0; });
      m[c] = Math.max.apply(null, vals) || 1;
    });
    return m;
  }
  function barCell(val, txt, max, rgb) {
    var p = Math.min(100, Math.round((val / max) * 100));
    return '<td><div class="bar-cell"><div class="bar-fill" style="width:' + p + '%;background:rgba(' + rgb + ',0.25)"></div><span class="bar-value">' + esc(txt) + '</span></div></td>';
  }
  function getAllH(rows) {
    var k = [], s = {};
    rows.forEach(function (r) { Object.keys(r || {}).forEach(function (h) { if (!s[h]) { s[h] = 1; k.push(h); } }); });
    return k;
  }
  function ordH(rows, pri) {
    var all = new Set();
    rows.forEach(function (r) { Object.keys(r || {}).forEach(function (k) { all.add(k); }); });
    var h = pri.filter(function (p) { return all.has(p); }), rest = [];
    all.forEach(function (k) { if (h.indexOf(k) < 0) rest.push(k); });
    var f = rows[0] || {};
    rest.sort(function (a, b) { return (parseFloat(String(f[b] || '0').replace(/[,%]/g, '')) || 0) - (parseFloat(String(f[a] || '0').replace(/[,%]/g, '')) || 0); });
    return h.concat(rest);
  }

  // ===== 탭 =====
  document.querySelectorAll('.nav-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.nav-tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
  });

  // ================================================================
  //  플레이스 대시보드  (기존 로직 유지)
  // ================================================================
  var placeRaw = [], placeCh = [], placeKw = [];

  function addRates(rows) {
    return rows.map(function (r) {
      var o = Object.assign({}, r);
      var inf = parseFloat(String(o['유입'] || '0').replace(/,/g, '')) || 0;
      var ord = parseFloat(String(o['예약/주문'] || '0').replace(/,/g, '')) || 0;
      var rev = parseFloat(String(o['리뷰'] || '0').replace(/,/g, '')) || 0;
      o['전환율'] = inf > 0 ? (ord / inf * 100).toFixed(1) + '%' : '-';
      o['리뷰전환율'] = ord > 0 ? (rev / ord * 100).toFixed(1) + '%' : '-';
      return o;
    });
  }
  function matchCat(t) {
    t = String(t || '');
    if (/유입/.test(t)) return '유입'; if (/예약|주문/.test(t)) return '예약/주문';
    if (/스마트콜/.test(t)) return '스마트콜'; if (/리뷰/.test(t)) return '리뷰'; return null;
  }
  function cleanRows(rows, dr) {
    var cc = ['주간', '유입', '예약/주문', '스마트콜', '리뷰'];
    var vf = !!(dr && /^\d{4}-\d{2}-\d{2}\s*~\s*\d{4}-\d{2}-\d{2}$/.test(dr));
    if (rows.some(function (r) { return cc.some(function (c) { return c in r && r[c] !== ''; }); })) {
      return rows.map(function (r) {
        var p = String(r['주간'] || '').trim();
        return (!p || /^(주간|주별|월별)$/.test(p)) && vf ? Object.assign({}, r, { '주간': dr }) : r;
      });
    }
    var bp = {}, dp = vf ? dr : '주간';
    rows.forEach(function (r) {
      var k = String(r['구분'] || ''), v = String(r['값'] || r['회수'] || '').replace(/[^\d]/g, '') || '';
      if (!v && k) { var m = k.match(/(\d+)/); v = m ? m[1] : ''; }
      var per = (r['기간'] && /^\d{4}-\d{2}-\d{2}/.test(r['기간'])) ? r['기간'] : dp;
      var tc = matchCat(k);
      if (tc && v) { if (!bp[per]) bp[per] = { '주간': per, '유입': '', '예약/주문': '', '스마트콜': '', '리뷰': '' }; bp[per][tc] = v; }
    });
    return Object.values(bp).filter(function (r) { return Object.values(r).some(function (v) { return v; }); });
  }

  function renderPR(rows) {
    var a = document.getElementById('place-report');
    if (!rows.length) { a.innerHTML = ''; return; }
    var cr = addRates(cleanRows(rows));
    var hd = ['주간', '유입', '예약/주문', '전환율', '스마트콜', '리뷰', '리뷰전환율'];
    var nc = ['유입', '예약/주문', '스마트콜', '리뷰'], pc = ['전환율', '리뷰전환율'];
    var mx = calcMax(cr, nc.concat(pc));
    var h = '<h3 class="table-title">주별 지표</h3><table><thead><tr>';
    hd.forEach(function (x) { h += '<th>' + esc(x) + '</th>'; });
    h += '</tr></thead><tbody>';
    cr.forEach(function (r) {
      h += '<tr>'; hd.forEach(function (x, ci) {
        var rv = String(r[x] || ''), nv = parseFloat(rv.replace(/[,%]/g, '')) || 0;
        if (nc.indexOf(x) >= 0 && nv > 0) h += barCell(nv, String(Math.round(nv)), mx[x], getCC(x, ci));
        else if (pc.indexOf(x) >= 0 && nv > 0) h += barCell(nv, rv, mx[x], getCC(x, ci));
        else h += '<td>' + esc(rv) + '</td>';
      }); h += '</tr>';
    });
    h += '</tbody></table>'; a.innerHTML = h;
  }
  // ── 브랜드 / 일반 키워드 분류 ──
  var BRAND_PATTERNS = ['비무브', '비무브짐', 'bemove', 'bemovegym', 'be move'];
  function isBrandKeyword(name) {
    var lower = String(name || '').toLowerCase().replace(/\s+/g, '');
    for (var i = 0; i < BRAND_PATTERNS.length; i++) {
      if (lower.indexOf(BRAND_PATTERNS[i].replace(/\s+/g, '')) >= 0) return true;
    }
    return false;
  }

  function classifyKeywords(kwRows) {
    // 각 주차별로 브랜드/일반 키워드 비율 계산
    return kwRows.map(function (r) {
      var week = r['주간'] || '';
      var brandTotal = 0, genericTotal = 0;
      var brandKws = [], genericKws = [];
      Object.keys(r).forEach(function (k) {
        if (k === '주간') return;
        var v = parseFloat(String(r[k] || '0').replace(/[,%]/g, '')) || 0;
        if (isBrandKeyword(k)) { brandTotal += v; brandKws.push({ name: k, pct: v }); }
        else { genericTotal += v; genericKws.push({ name: k, pct: v }); }
      });
      return { week: week, brandPct: brandTotal, genericPct: genericTotal, brandKws: brandKws, genericKws: genericKws };
    });
  }

  function renderKwClassify(kwRows) {
    var el = document.getElementById('place-kw-classify');
    if (!kwRows || !kwRows.length) { el.style.display = 'none'; return; }

    var classified = classifyKeywords(kwRows);
    // 유효 데이터 확인
    var hasData = classified.some(function (c) { return c.brandPct > 0 || c.genericPct > 0; });
    if (!hasData) { el.style.display = 'none'; return; }

    el.style.display = 'block';
    var h = '<h3 class="table-title">🏷️ 브랜드 vs 일반 키워드 비율</h3>';
    h += '<table><thead><tr>';
    h += '<th style="text-align:left">주간</th>';
    h += '<th>브랜드</th><th>일반</th><th style="min-width:200px">비율</th>';
    h += '</tr></thead><tbody>';

    classified.forEach(function (c) {
      var total = c.brandPct + c.genericPct;
      var bPct = total > 0 ? c.brandPct / total * 100 : 0;
      var gPct = 100 - bPct;
      var brandNames = c.brandKws.map(function (b) { return b.name; }).join(', ');
      var genericNames = c.genericKws.sort(function (a, b) { return b.pct - a.pct; }).map(function (g) { return g.name; }).join(', ');

      h += '<tr>';
      h += '<td style="text-align:left;font-weight:600">' + esc(c.week) + '</td>';
      h += '<td style="color:#e87040;font-weight:700" title="' + esc(brandNames) + '">' + c.brandPct.toFixed(1) + '%</td>';
      h += '<td style="color:#3b82f6;font-weight:700" title="' + esc(genericNames) + '">' + c.genericPct.toFixed(1) + '%</td>';
      h += '<td><div class="funnel-bar-row" style="height:24px;margin:0">';
      h += '<div style="width:' + bPct.toFixed(1) + '%;background:rgba(232,112,64,0.75);font-size:10px">' + (bPct >= 15 ? '브랜드 ' + bPct.toFixed(0) + '%' : '') + '</div>';
      h += '<div style="width:' + gPct.toFixed(1) + '%;background:rgba(59,130,246,0.65);font-size:10px">' + (gPct >= 15 ? '일반 ' + gPct.toFixed(0) + '%' : '') + '</div>';
      h += '</div></td>';
      h += '</tr>';
    });

    // 평균 행
    var avgBrand = 0, avgGeneric = 0;
    classified.forEach(function (c) { avgBrand += c.brandPct; avgGeneric += c.genericPct; });
    avgBrand /= classified.length; avgGeneric /= classified.length;
    var avgTotal = avgBrand + avgGeneric;
    var avgBPct = avgTotal > 0 ? avgBrand / avgTotal * 100 : 0;
    var avgGPct = 100 - avgBPct;

    h += '<tr class="row-total"><td style="text-align:left;font-weight:800">평균</td>';
    h += '<td style="color:#e87040;font-weight:800">' + avgBrand.toFixed(1) + '%</td>';
    h += '<td style="color:#3b82f6;font-weight:800">' + avgGeneric.toFixed(1) + '%</td>';
    h += '<td><div class="funnel-bar-row" style="height:24px;margin:0">';
    h += '<div style="width:' + avgBPct.toFixed(1) + '%;background:rgba(232,112,64,0.85);font-size:10px;font-weight:700">' + (avgBPct >= 15 ? '브랜드 ' + avgBPct.toFixed(0) + '%' : '') + '</div>';
    h += '<div style="width:' + avgGPct.toFixed(1) + '%;background:rgba(59,130,246,0.75);font-size:10px;font-weight:700">' + (avgGPct >= 15 ? '일반 ' + avgGPct.toFixed(0) + '%' : '') + '</div>';
    h += '</div></td>';
    h += '</tr>';

    h += '</tbody></table>';

    // 일반 키워드 증가 추이 안내
    if (classified.length >= 2) {
      var first = classified[0], last = classified[classified.length - 1];
      var gDiff = last.genericPct - first.genericPct;
      if (Math.abs(gDiff) > 1) {
        var trendColor = gDiff > 0 ? '#16a34a' : '#ef4444';
        var trendText = gDiff > 0 ? '일반 키워드 비중이 증가하고 있습니다 — 자연 검색 유입이 늘어나는 긍정적 신호입니다!' : '일반 키워드 비중이 감소하고 있습니다 — 브랜드 의존도가 높아지고 있으니 콘텐츠/SEO 전략을 강화하세요.';
        h += '<div style="margin-top:12px;padding:10px 14px;border-radius:8px;background:rgba(0,0,0,0.03);font-size:12px;color:' + trendColor + ';font-weight:600">';
        h += (gDiff > 0 ? '📈' : '📉') + ' ' + trendText;
        h += '</div>';
      }
    }

    el.innerHTML = h;
  }

  function renderPS(id, title, rows) {
    var c = document.getElementById(id);
    if (!rows || !rows.length) { c.style.display = 'none'; return; }
    c.style.display = 'block';
    var fh = ordH(rows, ['주간', '유입수']), nc = fh.filter(function (h) { return h !== '주간'; }), mx = calcMax(rows, nc);
    var h = '<h3 class="table-title">' + esc(title) + '</h3><table><thead><tr>';
    fh.forEach(function (x) { h += '<th>' + esc(x) + '</th>'; });
    h += '</tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr>'; fh.forEach(function (x, ci) {
        var rv = String(r[x] || ''), nv = parseFloat(rv.replace(/[,%]/g, '')) || 0;
        if (x === '주간') h += '<td>' + esc(rv) + '</td>';
        else if (nv > 0 && mx[x]) { var d = /%/.test(rv) ? rv : String(Math.round(nv)); h += barCell(nv, d, mx[x], getCC(x, ci)); }
        else h += '<td style="text-align:center">' + esc(rv) + '</td>';
      }); h += '</tr>';
    });
    h += '</tbody></table>'; c.innerHTML = h;
  }
  function exportPlaceXlsx() {
    var sh = [];
    if (placeRaw.length) sh.push({ name: '주별 지표', rows: addRates(placeRaw), headers: ['주간', '유입', '예약/주문', '전환율', '스마트콜', '리뷰', '리뷰전환율'] });
    if (placeCh.length) sh.push({ name: '유입 채널', rows: placeCh, headers: ordH(placeCh, ['주간', '유입수']) });
    if (placeKw.length) sh.push({ name: '유입 키워드', rows: placeKw, headers: ordH(placeKw, ['주간']) });
    // 브랜드/일반 키워드 분류 시트
    if (placeKw.length) {
      var classified = classifyKeywords(placeKw);
      var kwClassRows = classified.map(function (c) {
        var total = c.brandPct + c.genericPct;
        return {
          '주간': c.week,
          '브랜드(%)': c.brandPct.toFixed(1),
          '일반(%)': c.genericPct.toFixed(1),
          '브랜드비율(%)': total > 0 ? (c.brandPct / total * 100).toFixed(1) : '0',
          '일반비율(%)': total > 0 ? (c.genericPct / total * 100).toFixed(1) : '0',
          '브랜드키워드': c.brandKws.map(function (b) { return b.name; }).join(', '),
          '일반키워드': c.genericKws.map(function (g) { return g.name; }).join(', '),
        };
      });
      sh.push({ name: '키워드 분류', rows: kwClassRows, headers: ['주간', '브랜드(%)', '일반(%)', '브랜드비율(%)', '일반비율(%)', '브랜드키워드', '일반키워드'] });
    }
    XlsxWriter.saveXlsx(sh, '플레이스_통계_' + fmtDate() + '.xlsx');
  }
  document.getElementById('btn-place-xlsx').addEventListener('click', exportPlaceXlsx);

  // ----- 플레이스 인사이트 생성 -----
  function renderPlaceInsights(raw, ch, kw) {
    var el = document.getElementById('place-insights');
    if (!raw.length && !ch.length) { el.innerHTML = ''; return; }

    var items = [];
    var rows = addRates(cleanRows(raw));

    // ── 1. 주별 지표 분석 ──
    if (rows.length >= 1) {
      // 숫자 파싱 헬퍼
      function pn(v) { return parseFloat(String(v || '0').replace(/[,%]/g, '')) || 0; }

      var last = rows[rows.length - 1];
      var prev = rows.length >= 2 ? rows[rows.length - 2] : null;

      // 평균 계산
      var avgInf = 0, avgOrd = 0, avgCall = 0, avgRev = 0, avgCvr = 0, avgRCvr = 0;
      rows.forEach(function (r) {
        avgInf += pn(r['유입']); avgOrd += pn(r['예약/주문']);
        avgCall += pn(r['스마트콜']); avgRev += pn(r['리뷰']);
      });
      var n = rows.length;
      avgInf /= n; avgOrd /= n; avgCall /= n; avgRev /= n;
      avgCvr = avgInf > 0 ? avgOrd / avgInf * 100 : 0;
      avgRCvr = avgOrd > 0 ? avgRev / avgOrd * 100 : 0;

      // 최근 주 vs 전주 추이
      if (prev) {
        var lInf = pn(last['유입']), pInf = pn(prev['유입']);
        if (pInf > 0) {
          var infChg = (lInf - pInf) / pInf * 100;
          items.push('<span class="tag tag-' + (infChg >= 0 ? 'up' : 'down') + '">' + (infChg >= 0 ? '▲' : '▼') + '</span>' +
            '<strong>' + esc(String(last['주간'] || '')) + '</strong> 유입이 전주 대비 <strong>' + Math.abs(infChg).toFixed(1) + '%</strong> ' +
            (infChg >= 0 ? '증가' : '감소') + ' (' + fmtNum(Math.round(pInf)) + ' → ' + fmtNum(Math.round(lInf)) + ')');
        }

        var lOrd = pn(last['예약/주문']), pOrd = pn(prev['예약/주문']);
        if (pOrd > 0) {
          var ordChg = (lOrd - pOrd) / pOrd * 100;
          items.push('<span class="tag tag-' + (ordChg >= 0 ? 'up' : 'down') + '">' + (ordChg >= 0 ? '▲' : '▼') + '</span>' +
            '예약/주문 <strong>' + fmtNum(Math.round(pOrd)) + ' → ' + fmtNum(Math.round(lOrd)) + '</strong> (' +
            (ordChg >= 0 ? '+' : '') + ordChg.toFixed(1) + '%)');
        }
      }

      // 전환율 추이
      var lCvr = pn(last['전환율']), lRCvr = pn(last['리뷰전환율']);
      if (prev) {
        var pCvr = pn(prev['전환율']);
        if (pCvr > 0 && Math.abs(lCvr - pCvr) > 0.3) {
          var cvrDiff = lCvr - pCvr;
          items.push('<span class="tag tag-' + (cvrDiff > 0 ? 'up' : 'down') + '">' + (cvrDiff > 0 ? '▲' : '▼') + '</span>' +
            '전환율 <strong>' + pCvr.toFixed(1) + '% → ' + lCvr.toFixed(1) + '%</strong> (' +
            (cvrDiff > 0 ? '+' : '') + cvrDiff.toFixed(1) + '%p)' +
            (lCvr > avgCvr ? ' — 평균(' + avgCvr.toFixed(1) + '%) 이상입니다.' : ' — 평균(' + avgCvr.toFixed(1) + '%) 미만입니다.'));
        }
      }

      // 최근 주 vs 평균 비교
      var lInfV = pn(last['유입']);
      if (avgInf > 0) {
        var infVsAvg = (lInfV - avgInf) / avgInf * 100;
        items.push('<span class="tag tag-info">📊</span>' +
          '최근 유입 <strong>' + fmtNum(Math.round(lInfV)) + '</strong>은 전체 평균(' + fmtNum(Math.round(avgInf)) + ') 대비 <strong>' +
          (infVsAvg >= 0 ? '+' : '') + infVsAvg.toFixed(1) + '%</strong>');
      }

      // 최고/최저 유입 주
      var maxW = rows[0], minW = rows[0];
      rows.forEach(function (r) {
        if (pn(r['유입']) > pn(maxW['유입'])) maxW = r;
        if (pn(r['유입']) < pn(minW['유입']) && pn(r['유입']) > 0) minW = r;
      });
      if (maxW !== minW) {
        items.push('<span class="tag tag-info">📈</span>' +
          '최고 유입: <strong>' + esc(String(maxW['주간'] || '')) + '</strong> (' + fmtNum(Math.round(pn(maxW['유입']))) + ') / ' +
          '최저: <strong>' + esc(String(minW['주간'] || '')) + '</strong> (' + fmtNum(Math.round(pn(minW['유입']))) + ')');
      }

      // 전체 요약
      var totalInf = 0, totalOrd = 0, totalCall = 0, totalRev = 0;
      rows.forEach(function (r) { totalInf += pn(r['유입']); totalOrd += pn(r['예약/주문']); totalCall += pn(r['스마트콜']); totalRev += pn(r['리뷰']); });
      var totalCvr = totalInf > 0 ? totalOrd / totalInf * 100 : 0;
      var totalRCvr = totalOrd > 0 ? totalRev / totalOrd * 100 : 0;
      items.push('<span class="tag tag-warn">📋</span>' +
        '전체 ' + n + '주간: 유입 <strong>' + fmtNum(Math.round(totalInf)) + '</strong> · ' +
        '예약/주문 <strong>' + fmtNum(Math.round(totalOrd)) + '</strong> · ' +
        '전환율 <strong>' + totalCvr.toFixed(1) + '%</strong> · ' +
        '리뷰 <strong>' + fmtNum(Math.round(totalRev)) + '</strong> · ' +
        '리뷰전환율 <strong>' + totalRCvr.toFixed(1) + '%</strong>');
    }

    // ── 2. 유입 채널 분석 ──
    if (ch.length >= 1) {
      items.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.15);margin:8px 0">');
      items.push('<span class="tag tag-warn">📍</span><strong>유입 채널 분석</strong>');

      // 채널명 추출 (주간, 유입수 제외)
      var chNames = [];
      var chKeys = {};
      ch.forEach(function (r) { Object.keys(r).forEach(function (k) { if (k !== '주간' && k !== '유입수') chKeys[k] = true; }); });
      chNames = Object.keys(chKeys);

      if (chNames.length && ch.length >= 2) {
        var lastCh = ch[ch.length - 1];
        var prevCh = ch[ch.length - 2];

        // 최근 주 1위 채널
        var topCh = null, topVal = 0;
        chNames.forEach(function (cn) {
          var v = parseFloat(String(lastCh[cn] || '0').replace(/,/g, '')) || 0;
          if (v > topVal) { topVal = v; topCh = cn; }
        });
        if (topCh) {
          items.push('<span class="tag tag-info">🥇</span>' +
            '최근 주 1위 채널: <strong>' + esc(topCh) + '</strong> (' + fmtNum(Math.round(topVal)) + '명)');
        }

        // 채널별 증감
        chNames.forEach(function (cn) {
          var lv = parseFloat(String(lastCh[cn] || '0').replace(/,/g, '')) || 0;
          var pv = parseFloat(String(prevCh[cn] || '0').replace(/,/g, '')) || 0;
          if (pv > 0) {
            var chg = (lv - pv) / pv * 100;
            if (Math.abs(chg) > 5) {
              items.push('<span class="tag tag-' + (chg > 0 ? 'up' : 'down') + '">' + (chg > 0 ? '▲' : '▼') + '</span>' +
                esc(cn) + ': <strong>' + fmtNum(Math.round(pv)) + ' → ' + fmtNum(Math.round(lv)) + '</strong> (' +
                (chg > 0 ? '+' : '') + chg.toFixed(1) + '%)');
            }
          }
        });

        // 전체 기간 채널 점유율
        var chTotals = {};
        var chGrandTotal = 0;
        chNames.forEach(function (cn) { chTotals[cn] = 0; });
        ch.forEach(function (r) {
          chNames.forEach(function (cn) {
            var v = parseFloat(String(r[cn] || '0').replace(/,/g, '')) || 0;
            chTotals[cn] += v; chGrandTotal += v;
          });
        });
        if (chGrandTotal > 0) {
          var sorted = chNames.slice().sort(function (a, b) { return chTotals[b] - chTotals[a]; });
          var shareStr = sorted.slice(0, 5).map(function (cn) {
            return esc(cn) + ' <strong>' + (chTotals[cn] / chGrandTotal * 100).toFixed(1) + '%</strong>';
          }).join(' · ');
          items.push('<span class="tag tag-info">📊</span>전체 채널 점유율: ' + shareStr);
        }
      }
    }

    // ── 3. 키워드 분석 ──
    if (kw.length >= 1) {
      items.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.15);margin:8px 0">');
      items.push('<span class="tag tag-warn">🔍</span><strong>유입 키워드 분석</strong>');

      // 키워드명 추출
      var kwNames = [];
      var kwKeys = {};
      kw.forEach(function (r) { Object.keys(r).forEach(function (k) { if (k !== '주간') kwKeys[k] = true; }); });
      kwNames = Object.keys(kwKeys);

      if (kwNames.length && kw.length >= 2) {
        var lastKw = kw[kw.length - 1];
        var prevKw = kw[kw.length - 2];

        // 최근 주 1위 키워드
        var topKw = null, topKwVal = 0;
        kwNames.forEach(function (kn) {
          var v = parseFloat(String(lastKw[kn] || '0').replace(/[,%]/g, '')) || 0;
          if (v > topKwVal) { topKwVal = v; topKw = kn; }
        });
        if (topKw) {
          items.push('<span class="tag tag-info">🥇</span>' +
            '최근 주 1위 키워드: <strong>' + esc(topKw) + '</strong> (' + topKwVal.toFixed(1) + '%)' +
            (isBrandKeyword(topKw) ? ' <span style="color:#e87040;font-size:10px">[브랜드]</span>' : ' <span style="color:#3b82f6;font-size:10px">[일반]</span>'));
        }

        // 키워드별 비중 변화
        kwNames.forEach(function (kn) {
          var lv = parseFloat(String(lastKw[kn] || '0').replace(/[,%]/g, '')) || 0;
          var pv = parseFloat(String(prevKw[kn] || '0').replace(/[,%]/g, '')) || 0;
          if (pv > 0) {
            var diff = lv - pv;
            if (Math.abs(diff) > 1) {
              var kwTag = isBrandKeyword(kn) ? '<span style="color:#e87040;font-size:10px"> [브랜드]</span>' : '<span style="color:#3b82f6;font-size:10px"> [일반]</span>';
              items.push('<span class="tag tag-' + (diff > 0 ? 'up' : 'down') + '">' + (diff > 0 ? '▲' : '▼') + '</span>' +
                esc(kn) + kwTag + ': <strong>' + pv.toFixed(1) + '% → ' + lv.toFixed(1) + '%</strong> (' +
                (diff > 0 ? '+' : '') + diff.toFixed(1) + '%p)');
            }
          }
        });

        // 전체 기간 평균 키워드 비중
        var kwAvg = {};
        kwNames.forEach(function (kn) { kwAvg[kn] = 0; });
        kw.forEach(function (r) {
          kwNames.forEach(function (kn) {
            kwAvg[kn] += parseFloat(String(r[kn] || '0').replace(/[,%]/g, '')) || 0;
          });
        });
        var kwn = kw.length;
        var kwSorted = kwNames.slice().sort(function (a, b) { return kwAvg[b] - kwAvg[a]; });
        var kwStr = kwSorted.slice(0, 5).map(function (kn) {
          var tag = isBrandKeyword(kn) ? '<span style="color:#e87040;font-size:10px">[B]</span>' : '<span style="color:#3b82f6;font-size:10px">[G]</span>';
          return esc(kn) + tag + ' <strong>' + (kwAvg[kn] / kwn).toFixed(1) + '%</strong>';
        }).join(' · ');
        items.push('<span class="tag tag-info">📊</span>평균 키워드 비중: ' + kwStr);

        // 새로 등장/사라진 키워드
        if (kw.length >= 3) {
          var firstKw = kw[0];
          kwNames.forEach(function (kn) {
            var fv = parseFloat(String(firstKw[kn] || '0').replace(/[,%]/g, '')) || 0;
            var lv2 = parseFloat(String(lastKw[kn] || '0').replace(/[,%]/g, '')) || 0;
            if (fv === 0 && lv2 > 3) {
              items.push('<span class="tag tag-up">🆕</span>' +
                '<strong>' + esc(kn) + '</strong> 키워드가 새로 등장했습니다. (현재 ' + lv2.toFixed(1) + '%)');
            } else if (fv > 3 && lv2 === 0) {
              items.push('<span class="tag tag-down">❌</span>' +
                '<strong>' + esc(kn) + '</strong> 키워드가 사라졌습니다. (이전 ' + fv.toFixed(1) + '%)');
            }
          });
        }
      }

      // ── 3-2. 브랜드 vs 일반 키워드 추이 분석 ──
      var kwClassified = classifyKeywords(kw);
      if (kwClassified.length >= 2) {
        items.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:6px 0">');
        items.push('<span class="tag tag-warn">🏷️</span><strong>브랜드 vs 일반 키워드 분석</strong>');

        var kwFirst = kwClassified[0], kwLast = kwClassified[kwClassified.length - 1];
        var fTotal = kwFirst.brandPct + kwFirst.genericPct;
        var lTotal = kwLast.brandPct + kwLast.genericPct;
        var fGenRatio = fTotal > 0 ? kwFirst.genericPct / fTotal * 100 : 0;
        var lGenRatio = lTotal > 0 ? kwLast.genericPct / lTotal * 100 : 0;
        var genRatioDiff = lGenRatio - fGenRatio;

        items.push('<span class="tag tag-info">📍</span>' +
          '최근 주: 브랜드 <strong style="color:#e87040">' + kwLast.brandPct.toFixed(1) + '%</strong> / 일반 <strong style="color:#3b82f6">' + kwLast.genericPct.toFixed(1) + '%</strong>');

        if (Math.abs(genRatioDiff) > 0.5) {
          var gTag = genRatioDiff > 0 ? 'up' : 'down';
          var gText = genRatioDiff > 0
            ? '일반 키워드 비율이 <strong>' + fGenRatio.toFixed(1) + '% → ' + lGenRatio.toFixed(1) + '%</strong>로 증가 — 자연 검색 유입이 늘어나는 <strong style="color:#16a34a">긍정적 신호</strong>입니다!'
            : '일반 키워드 비율이 <strong>' + fGenRatio.toFixed(1) + '% → ' + lGenRatio.toFixed(1) + '%</strong>로 감소 — 브랜드 의존도가 높아지고 있습니다.';
          items.push('<span class="tag tag-' + gTag + '">' + (genRatioDiff > 0 ? '📈' : '📉') + '</span>' + gText);
        }

        // 일반 키워드 중 가장 성장한 키워드
        if (kwClassified.length >= 2) {
          var lastGenKws = kwLast.genericKws;
          var prevClassified = kwClassified[kwClassified.length - 2];
          var prevGenMap = {};
          prevClassified.genericKws.forEach(function (g) { prevGenMap[g.name] = g.pct; });
          var bestGrowth = null, bestGrowthVal = 0;
          lastGenKws.forEach(function (g) {
            var prevPct = prevGenMap[g.name] || 0;
            var growth = g.pct - prevPct;
            if (growth > bestGrowthVal) { bestGrowthVal = growth; bestGrowth = g.name; }
          });
          if (bestGrowth && bestGrowthVal > 0.5) {
            items.push('<span class="tag tag-up">⭐</span>' +
              '가장 성장한 일반 키워드: <strong style="color:#3b82f6">' + esc(bestGrowth) + '</strong> (+' + bestGrowthVal.toFixed(1) + '%p)');
          }
        }
      }
    }

    // ── 4. 종합 진단 ──
    if (rows.length >= 2) {
      items.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.15);margin:8px 0">');
      function pnv(r, k) { return parseFloat(String(r[k] || '0').replace(/[,%]/g, '')) || 0; }
      var lst = rows[rows.length - 1];
      var strengths2 = [], weaknesses2 = [];

      // 유입 트렌드 (최근 3주 평균 vs 이전)
      if (rows.length >= 4) {
        var recent3 = 0, older = 0, r3n = Math.min(3, rows.length), oldn = rows.length - r3n;
        for (var ri = rows.length - r3n; ri < rows.length; ri++) recent3 += pnv(rows[ri], '유입');
        for (var oi = 0; oi < rows.length - r3n; oi++) older += pnv(rows[oi], '유입');
        recent3 /= r3n; older /= Math.max(oldn, 1);
        if (older > 0 && recent3 > older * 1.1) strengths2.push('유입 상승세');
        if (older > 0 && recent3 < older * 0.9) weaknesses2.push('유입 하락세');
      }

      // 전환율
      var lstCvr = pnv(lst, '전환율');
      if (lstCvr > avgCvr * 1.1) strengths2.push('높은 전환율');
      if (lstCvr > 0 && lstCvr < avgCvr * 0.9) weaknesses2.push('낮은 전환율');

      // 리뷰 전환율
      var lstRCvr = pnv(lst, '리뷰전환율');
      if (lstRCvr > avgRCvr * 1.1) strengths2.push('리뷰 전환 양호');
      if (lstRCvr > 0 && lstRCvr < avgRCvr * 0.9) weaknesses2.push('리뷰 전환 저조');

      if (strengths2.length || weaknesses2.length) {
        var diag2 = '';
        if (strengths2.length) diag2 += '강점: <strong style="color:#22c55e">' + strengths2.join(', ') + '</strong>';
        if (strengths2.length && weaknesses2.length) diag2 += ' | ';
        if (weaknesses2.length) diag2 += '개선 필요: <strong style="color:#ef4444">' + weaknesses2.join(', ') + '</strong>';
        items.push('<span class="tag tag-info">🎯</span>' + diag2);
      }
    }

    if (!items.length) { el.innerHTML = ''; return; }
    var html = '<div class="insights-card"><h3>💡 플레이스 인사이트</h3>';
    items.forEach(function (item) {
      if (item.indexOf('<hr') === 0) html += item;
      else html += '<div class="insight-item">' + item + '</div>';
    });
    html += '</div>';
    el.innerHTML = html;
  }

  Promise.all([
    new Promise(function (res) {
      chrome.storage.local.get(['nspVisualizeData', 'nspExtractedData', 'nspExtractedDateRange'], function (r) {
        var d = r.nspVisualizeData || (r.nspExtractedData ? r.nspExtractedData.rows : []) || [];
        res({ rows: Array.isArray(d) ? d : [], dateRange: r.nspExtractedDateRange || (r.nspExtractedData ? r.nspExtractedData.dateRange : '') || '' });
      });
    }),
    new Promise(function (res) { chrome.storage.local.get(['nspPlaceData'], function (r) { res(r.nspPlaceData || null); }); }),
  ]).then(function (res) {
    var rr = res[0], pr = res[1], rows = rr.rows, cl = cleanRows(rows, rr.dateRange);
    placeRaw = cl.length ? cl : rows;
    if (pr) { placeCh = Array.isArray(pr.channels) ? pr.channels : []; placeKw = Array.isArray(pr.keywords) ? pr.keywords : []; }
    var has = placeRaw.length > 0 || placeCh.length > 0;
    document.getElementById('place-empty').style.display = has ? 'none' : 'block';
    var ct = document.getElementById('place-count'), pts = [];
    if (placeRaw.length) pts.push('리포트 ' + placeRaw.length + '건');
    if (placeCh.length) pts.push('채널 ' + placeCh.length + '건');
    if (placeKw.length) pts.push('키워드 ' + placeKw.length + '건');
    ct.textContent = pts.join(', ');
    if (placeRaw.length) renderPR(placeRaw);
    renderPS('place-channel', '📍 플레이스 유입 채널 (유입수 × 채널비율)', placeCh);
    renderPS('place-keyword', '🔍 플레이스 유입 키워드', placeKw);
    renderKwClassify(placeKw);
    renderPlaceInsights(placeRaw, placeCh, placeKw);
    if (typeof renderOverview === 'function') renderOverview();
  });

  // ================================================================
  //  매출 관리 대시보드
  // ================================================================
  var salesRawRows = []; // 원본 행 전체
  var salesAnalysis = null; // 분석 결과

  // ----- 업로드 -----
  var upZone = document.getElementById('sales-upload');
  var fInput = document.getElementById('sales-file-input');
  var folderInput = document.getElementById('sales-folder-input');

  // 파일 선택 버튼
  document.getElementById('btn-upload-files').addEventListener('click', function (e) {
    e.stopPropagation(); fInput.click();
  });
  // 폴더 선택 버튼
  document.getElementById('btn-upload-folder').addEventListener('click', function (e) {
    e.stopPropagation(); folderInput.click();
  });
  // 드래그&드롭
  upZone.addEventListener('dragover', function (e) { e.preventDefault(); upZone.classList.add('dragover'); });
  upZone.addEventListener('dragleave', function () { upZone.classList.remove('dragover'); });
  upZone.addEventListener('drop', function (e) { e.preventDefault(); upZone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });
  fInput.addEventListener('change', function () { handleFiles(fInput.files); fInput.value = ''; });
  folderInput.addEventListener('change', function () { handleFiles(folderInput.files); folderInput.value = ''; });

  async function handleFiles(files) {
    if (!files || !files.length) return;
    // 폴더 업로드 시 xlsx, csv, xls 파일만 필터링
    var filtered = [];
    for (var i = 0; i < files.length; i++) {
      var name = files[i].name.toLowerCase();
      if (name.endsWith('.xlsx') || name.endsWith('.csv') || name.endsWith('.xls')) {
        filtered.push(files[i]);
      }
    }
    if (!filtered.length) { alert('지원되는 파일(xlsx, csv)이 없습니다.'); return; }
    upZone.querySelector('h3').textContent = filtered.length + '개 파일 읽는 중...';
    try {
      var res = await XlsxReader.readFiles(filtered);
      if (!res.allSheets.length) { alert('읽을 수 있는 데이터가 없습니다.'); return; }

      // 파일 칩 표시 & 파일명으로 신규/재등록 태그
      var chipHtml = '';
      res.allSheets.forEach(function (s) {
        // macOS는 파일명을 NFD(분해형)로 저장하므로 NFC로 정규화 필요
        var fn = String(s.fileName || '').normalize('NFC');
        var regType = '기타';
        // 파일명 앞부분에 "신규" 또는 "재등록"이 포함되어 있으면 분류
        if (/^신규/i.test(fn) || /[_\-\s]신규[_\-\s]/.test(fn)) regType = '신규';
        else if (/^재등록/i.test(fn) || /[_\-\s]재등록[_\-\s]/.test(fn)) regType = '재등록';
        console.log('[FormulaX] 파일:', fn, '→ 분류:', regType, '행수:', s.rows.length);
        s.rows.forEach(function (row) { row.__regType__ = regType; });
        salesRawRows = salesRawRows.concat(s.rows);
        var badge = regType === '신규' ? '🟢 신규' : regType === '재등록' ? '🔵 재등록' : '';
        chipHtml += '<div class="file-chip">📄 ' + esc(fn) + ' — ' + esc(s.name) +
          (badge ? ' <span class="reg-badge">' + badge + '</span>' : '') +
          ' <span class="rows-count">' + s.rows.length + '행</span></div>';
      });
      document.getElementById('sales-file-list').innerHTML += chipHtml;

      analyzeSalesData();
    } catch (err) {
      console.error(err);
      alert('파일 처리 오류: ' + err.message);
    }
    upZone.querySelector('h3').textContent = '매출 엑셀 파일을 업로드하세요';
  }

  // ----- 컬럼 자동 감지 -----
  function detectColumns(rows) {
    if (!rows.length) return null;
    var headers = getAllH(rows);
    var col = { date: null, branch: null, product: null, revenue: null, count: null, member: null };

    // 1순위: "결제일시" 정확히 매칭
    var dateExact = /^결제일시$/;
    var dateRe = /결제일시|결제일|날짜|일자|년월|기간|date|period/i;
    var branchRe = /지점|매장|점포|센터|branch|store|location/i;
    var productExact = /^판매상품$/;
    var productRe = /판매상품|상품|유형|구분|종류|타입|product|type|item|category|이용권/i;
    var revenueRe = /매출|금액|결제금액|결제액|수입|revenue|amount|sales|합계금액|총액|판매금액/i;
    var countRe = /건수|수량|횟수|count|qty|quantity|결제건/i;
    var memberRe = /회원|고객|인원|member|client|customer/i;

    // 정확한 매칭 우선
    headers.forEach(function (h) {
      if (!col.date && dateExact.test(h)) col.date = h;
      if (!col.product && productExact.test(h)) col.product = h;
    });

    // 나머지 패턴 매칭
    headers.forEach(function (h) {
      if (!col.date && dateRe.test(h)) col.date = h;
      if (!col.branch && branchRe.test(h)) col.branch = h;
      if (!col.product && productRe.test(h)) col.product = h;
      if (!col.revenue && revenueRe.test(h)) col.revenue = h;
      if (!col.count && countRe.test(h)) col.count = h;
      if (!col.member && memberRe.test(h)) col.member = h;
    });

    // 매출 컬럼 미감지 시 → 숫자가 큰 컬럼 사용
    if (!col.revenue) {
      var best = null, bestAvg = 0;
      headers.forEach(function (h) {
        if (h === col.date || h === col.branch || h === col.product) return;
        var sum = 0, cnt = 0;
        rows.forEach(function (r) {
          var v = parseFloat(String(r[h] || '').replace(/[,\s]/g, ''));
          if (!isNaN(v) && v > 0) { sum += v; cnt++; }
        });
        var avg = cnt > 0 ? sum / cnt : 0;
        if (avg > bestAvg) { bestAvg = avg; best = h; }
      });
      if (best) col.revenue = best;
    }

    console.log('[FormulaX] 컬럼 감지:', JSON.stringify(col));
    return col;
  }

  // ----- PT / FC 분류 -----
  // 판매상품에 "PT"가 들어가면 PT, 나머지는 전부 FC
  function classifyPTFC(text) {
    var t = String(text || '').toUpperCase();
    if (t.indexOf('PT') >= 0) return 'PT';
    return 'FC';
  }

  // ----- 결제일시 → Date 파싱 -----
  // 지원 형식:
  //   "2025. 1. 1 (수) 오전 10:05"  (한국어 로케일)
  //   "2025-01-03 14:30:00"
  //   "2025.01.03", "2025/1/3", "2025. 01. 03"
  //   "20250103" (연속 8자리)
  //   Excel 시리얼 숫자 (예: 45658)
  function parseDate(dateStr) {
    var s = String(dateStr || '').trim();
    if (!s) return null;

    // Excel 날짜 숫자 (예: 45658 → 2025-01-03)
    if (/^\d{5}$/.test(s)) {
      var serial = parseInt(s);
      var d = new Date((serial - 25569) * 86400000);
      if (!isNaN(d.getTime())) return d;
    }

    // 유연한 YYYY MM DD 추출 (구분자: . - / 와 공백 허용)
    // "2025. 1. 1 (수) 오전 10:05" → 2025, 1, 1
    // "2025-01-03 14:30:00"       → 2025, 01, 03
    // "2025.01.03"                → 2025, 01, 03
    var m = s.match(/^(\d{4})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})/);
    if (m) {
      var d2 = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
      if (!isNaN(d2.getTime())) return d2;
    }

    // "20250103" 연속 8자리
    m = s.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) {
      var d3 = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
      if (!isNaN(d3.getTime())) return d3;
    }
    return null;
  }

  // ----- Date → 기간키 변환 -----
  function toMonthKey(dateStr) {
    var d = parseDate(dateStr);
    if (d) return d.getFullYear() + '-' + S(d.getMonth() + 1);
    // 이미 "2025-01" 형태인 경우
    var m = String(dateStr || '').match(/(\d{4})\D?(\d{1,2})/);
    if (m) return m[1] + '-' + S(parseInt(m[2]));
    return String(dateStr || '') || 'Unknown';
  }

  function toWeekKey(dateStr) {
    var d = parseDate(dateStr);
    if (!d) return toMonthKey(dateStr);
    // 해당 주 월요일 기준으로 주간 범위 표시
    var day = d.getDay(); // 0=일, 1=월, ...
    var diffToMon = day === 0 ? -6 : 1 - day; // 월요일까지 차이
    var mon = new Date(d.getTime() + diffToMon * 86400000);
    var sun = new Date(mon.getTime() + 6 * 86400000);
    return mon.getFullYear() + '-' + S(mon.getMonth() + 1) + '-' + S(mon.getDate()) +
      ' ~ ' + sun.getFullYear() + '-' + S(sun.getMonth() + 1) + '-' + S(sun.getDate());
  }

  // ----- 빈 버킷 생성 -----
  function emptyBucket() {
    return { totRev: 0, ptRev: 0, fcRev: 0, ptCnt: 0, fcCnt: 0, newRev: 0, reRev: 0, newCnt: 0, reCnt: 0, members: {} };
  }
  function mergeBucket(t, b) {
    t.totRev += b.totRev; t.ptRev += b.ptRev; t.fcRev += b.fcRev;
    t.ptCnt += b.ptCnt; t.fcCnt += b.fcCnt;
    t.newRev += b.newRev; t.reRev += b.reRev;
    t.newCnt += b.newCnt; t.reCnt += b.reCnt;
    Object.keys(b.members).forEach(function (m) { t.members[m] = true; });
  }

  // ----- 집계 -----
  function aggregateData(rows, cols, periodType) {
    var data = {}; // { branchName: { periodKey: bucket } }
    var allPeriods = new Set();
    var allBranches = new Set();

    rows.forEach(function (r) {
      var branch = cols.branch ? String(r[cols.branch] || '').trim() : '전체';
      if (!branch) branch = '전체';
      allBranches.add(branch);

      var dateVal = cols.date ? String(r[cols.date] || '').trim() : '';
      var periodKey = periodType === 'weekly' ? toWeekKey(dateVal) : toMonthKey(dateVal);
      allPeriods.add(periodKey);

      var product = cols.product ? String(r[cols.product] || '').trim() : '';
      var type = classifyPTFC(product);
      var regType = r.__regType__ || '기타';

      var rev = parseFloat(String(r[cols.revenue] || '').replace(/[,\s]/g, '')) || 0;
      var cnt = cols.count ? (parseFloat(String(r[cols.count] || '').replace(/[,\s]/g, '')) || 1) : 1;
      var memberId = cols.member ? String(r[cols.member] || '').trim() : '';

      if (!data[branch]) data[branch] = {};
      if (!data[branch][periodKey]) data[branch][periodKey] = emptyBucket();
      var bucket = data[branch][periodKey];
      bucket.totRev += rev;
      if (type === 'PT') { bucket.ptRev += rev; bucket.ptCnt += cnt; }
      else { bucket.fcRev += rev; bucket.fcCnt += cnt; }
      if (regType === '신규') { bucket.newRev += rev; bucket.newCnt += cnt; }
      else if (regType === '재등록') { bucket.reRev += rev; bucket.reCnt += cnt; }
      if (memberId) bucket.members[memberId] = true;
    });

    // 전체 통합 계산
    var periods = Array.from(allPeriods).sort();
    var branches = Array.from(allBranches).sort();
    var totalData = {};
    periods.forEach(function (p) { totalData[p] = emptyBucket(); });
    branches.forEach(function (br) {
      periods.forEach(function (p) {
        var b = (data[br] || {})[p];
        if (b) mergeBucket(totalData[p], b);
      });
    });
    data['__all__'] = totalData;

    return { data: data, periods: periods, branches: branches };
  }

  // ----- 분석 실행 -----
  function analyzeSalesData() {
    var cols = detectColumns(salesRawRows);
    if (!cols || !cols.revenue) {
      alert('매출 컬럼을 자동 감지할 수 없습니다. 데이터를 확인해주세요.');
      return;
    }

    var periodType = document.getElementById('sel-period').value;
    salesAnalysis = aggregateData(salesRawRows, cols, periodType);
    salesAnalysis.cols = cols;

    // 지점 셀렉터 업데이트
    var selBranch = document.getElementById('sel-branch');
    selBranch.innerHTML = '<option value="__all__">전체 통합</option>';
    salesAnalysis.branches.forEach(function (br) {
      selBranch.innerHTML += '<option value="' + esc(br) + '">' + esc(br) + '</option>';
    });

    // 종합 대시보드용 캐시 초기화 및 지점 셀렉터 리셋
    overviewWeeklyCache = null;
    var selOvBranch = document.getElementById('sel-overview-branch');
    selOvBranch.innerHTML = '<option value="__all__">전체 통합</option>';

    document.getElementById('sales-filter').style.display = 'flex';
    renderSalesView();
    if (typeof renderOverview === 'function') renderOverview();
  }

  // ----- 렌더링 -----
  function renderSalesView() {
    if (!salesAnalysis) return;
    var branch = document.getElementById('sel-branch').value;
    var branchData = salesAnalysis.data[branch] || {};
    var periods = salesAnalysis.periods;
    var branchLabel = branch === '__all__' ? '전체 통합' : branch;

    // 행 데이터 만들기
    var tableRows = [];
    var totals = { totRev: 0, ptRev: 0, fcRev: 0, ptCnt: 0, fcCnt: 0, newRev: 0, reRev: 0, newCnt: 0, reCnt: 0, memberSet: {} };

    periods.forEach(function (p) {
      var d = branchData[p] || emptyBucket();
      var ptPct = d.totRev > 0 ? d.ptRev / d.totRev * 100 : 0;
      var fcPct = d.totRev > 0 ? d.fcRev / d.totRev * 100 : 0;
      var newPct = d.totRev > 0 ? d.newRev / d.totRev * 100 : 0;
      var rePct = d.totRev > 0 ? d.reRev / d.totRev * 100 : 0;
      var memCnt = Object.keys(d.members).length;
      var ptUnit = d.ptCnt > 0 ? Math.round(d.ptRev / d.ptCnt) : 0;
      var fcUnit = d.fcCnt > 0 ? Math.round(d.fcRev / d.fcCnt) : 0;

      tableRows.push({
        period: p, totRev: d.totRev, ptRev: d.ptRev, fcRev: d.fcRev,
        ptPct: ptPct, fcPct: fcPct, memberCnt: memCnt || d.ptCnt + d.fcCnt,
        ptUnit: ptUnit, fcUnit: fcUnit,
        newRev: d.newRev, reRev: d.reRev, newPct: newPct, rePct: rePct,
      });

      totals.totRev += d.totRev; totals.ptRev += d.ptRev; totals.fcRev += d.fcRev;
      totals.ptCnt += d.ptCnt; totals.fcCnt += d.fcCnt;
      totals.newRev += d.newRev; totals.reRev += d.reRev;
      totals.newCnt += d.newCnt; totals.reCnt += d.reCnt;
      Object.keys(d.members).forEach(function (m) { totals.memberSet[m] = true; });
    });

    // 합계 행
    var tPtPct = totals.totRev > 0 ? totals.ptRev / totals.totRev * 100 : 0;
    var tFcPct = totals.totRev > 0 ? totals.fcRev / totals.totRev * 100 : 0;
    var tNewPct = totals.totRev > 0 ? totals.newRev / totals.totRev * 100 : 0;
    var tRePct = totals.totRev > 0 ? totals.reRev / totals.totRev * 100 : 0;
    var tMemCnt = Object.keys(totals.memberSet).length || (totals.ptCnt + totals.fcCnt);
    var tPtUnit = totals.ptCnt > 0 ? Math.round(totals.ptRev / totals.ptCnt) : 0;
    var tFcUnit = totals.fcCnt > 0 ? Math.round(totals.fcRev / totals.fcCnt) : 0;

    // 신규/재등록 데이터 존재 여부 (하나라도 있으면 컬럼 표시)
    var hasReg = totals.newRev > 0 || totals.reRev > 0;

    // 최대값 (바 스케일용)
    var mx = { rev: 1, pt: 1, fc: 1, mem: 1, ptU: 1, fcU: 1, nw: 1, re: 1 };
    tableRows.forEach(function (r) {
      if (r.totRev > mx.rev) mx.rev = r.totRev;
      if (r.ptRev > mx.pt) mx.pt = r.ptRev;
      if (r.fcRev > mx.fc) mx.fc = r.fcRev;
      if (r.memberCnt > mx.mem) mx.mem = r.memberCnt;
      if (r.ptUnit > mx.ptU) mx.ptU = r.ptUnit;
      if (r.fcUnit > mx.fcU) mx.fcU = r.fcUnit;
      if (r.newRev > mx.nw) mx.nw = r.newRev;
      if (r.reRev > mx.re) mx.re = r.reRev;
    });

    // HTML 빌드
    var isWeekly = document.getElementById('sel-period').value === 'weekly';
    var html = '<div class="section-card">';
    html += '<h3 class="table-title">' + esc(branchLabel) + ' · ' + (isWeekly ? '주차별' : '월별') + '</h3>';
    html += '<table><thead><tr>';
    html += '<th style="text-align:left">' + (isWeekly ? '주간' : '월') + '</th><th>매출</th><th>PT</th><th>FC</th>';
    html += '<th style="min-width:180px">PT / FC 비중</th>';
    if (hasReg) {
      html += '<th>신규</th><th>재등록</th>';
      html += '<th style="min-width:180px">신규 / 재등록 비중</th>';
    }
    html += '<th>회원수</th><th>PT 객단가</th><th>FC 객단가</th>';
    html += '</tr></thead><tbody>';

    tableRows.forEach(function (r) {
      html += buildSalesRow(r, mx, hasReg, false);
    });

    // 합계
    html += buildSalesRow({
      period: '합계', totRev: totals.totRev, ptRev: totals.ptRev, fcRev: totals.fcRev,
      ptPct: tPtPct, fcPct: tFcPct, memberCnt: tMemCnt, ptUnit: tPtUnit, fcUnit: tFcUnit,
      newRev: totals.newRev, reRev: totals.reRev, newPct: tNewPct, rePct: tRePct,
    }, mx, hasReg, true);

    html += '</tbody></table>';
    html += '<div class="legend"><div class="legend-item"><div class="legend-dot" style="background:rgba(232,112,64,0.7)"></div>PT</div>';
    html += '<div class="legend-item"><div class="legend-dot" style="background:rgba(59,130,246,0.6)"></div>FC</div>';
    if (hasReg) {
      html += '<div class="legend-item"><div class="legend-dot" style="background:rgba(34,197,94,0.7)"></div>신규</div>';
      html += '<div class="legend-item"><div class="legend-dot" style="background:rgba(168,85,247,0.7)"></div>재등록</div>';
    }
    html += '<div class="legend-item"><div class="legend-dot" style="background:transparent;border:1.5px solid #64748b;border-radius:50%"></div>전체</div></div>';
    html += '</div>';

    document.getElementById('sales-table-area').innerHTML = html;

    // 인사이트
    var isBranch = branch !== '__all__';
    renderInsights(tableRows, totals, branchLabel, hasReg, isBranch, salesAnalysis);
  }

  function buildSalesRow(r, mx, hasReg, isTotal) {
    var cls = isTotal ? ' class="row-total"' : '';
    var h = '<tr' + cls + '>';

    // 기간
    h += '<td style="text-align:left;font-weight:600">' + esc(r.period) + '</td>';

    // 매출 (검정 바)
    h += salesBarTd(r.totRev, mx.rev, '30,41,59', 'c-total');
    // PT (오렌지 바)
    h += salesBarTd(r.ptRev, mx.pt, '232,112,64', 'c-pt');
    // FC (파랑 바)
    h += salesBarTd(r.fcRev, mx.fc, '59,130,246', 'c-fc');

    // PT/FC 비중 바
    h += ratioBarTd(r.ptPct, r.fcPct, 'c-pt', 'c-fc', 'pt-part', 'fc-part');

    if (hasReg) {
      // 신규 (초록 바)
      h += salesBarTd(r.newRev, mx.nw, '34,197,94', 'c-new');
      // 재등록 (보라 바)
      h += salesBarTd(r.reRev, mx.re, '168,85,247', 'c-re');
      // 신규/재등록 비중 바
      h += ratioBarTd(r.newPct, r.rePct, 'c-new', 'c-re', 'new-part', 're-part');
    }

    // 회원수 (초록)
    h += salesBarTd(r.memberCnt, mx.mem, '34,197,94', 'c-member');
    // PT 객단가
    h += salesBarTd(r.ptUnit, mx.ptU, '232,112,64', 'c-pt');
    // FC 객단가
    h += salesBarTd(r.fcUnit, mx.fcU, '59,130,246', 'c-fc');

    h += '</tr>';
    return h;
  }

  function ratioBarTd(pctA, pctB, clsA, clsB, partA, partB) {
    var h = '<td><div class="ratio-cell">';
    h += '<span class="ratio-pct ' + clsA + '">' + pctStr(pctA) + '</span>';
    h += '<div class="ratio-bar" style="width:120px">';
    h += '<div class="' + partA + '" style="width:' + pctA.toFixed(1) + '%"></div>';
    h += '<div class="' + partB + '" style="width:' + pctB.toFixed(1) + '%"></div>';
    h += '</div>';
    h += '<span class="ratio-pct ' + clsB + '">' + pctStr(pctB) + '</span>';
    h += '</div></td>';
    return h;
  }

  function salesBarTd(val, max, rgb, colorClass) {
    var pct = max > 0 ? Math.min(100, Math.round(val / max * 100)) : 0;
    return '<td><div class="bar-cell">' +
      '<div class="bar-fill" style="width:' + pct + '%;background:rgba(' + rgb + ',0.22)"></div>' +
      '<span class="bar-value ' + colorClass + '">' + fmtNum(Math.round(val)) + '</span>' +
      '</div></td>';
  }

  // ----- 전체 평균 계산 헬퍼 -----
  function calcAllAvg(analysis) {
    if (!analysis) return null;
    var allData = analysis.data['__all__'] || {};
    var periods = analysis.periods;
    var numBranches = analysis.branches.length || 1;
    var t = { totRev: 0, ptRev: 0, fcRev: 0, ptCnt: 0, fcCnt: 0, newRev: 0, reRev: 0, memSet: {} };
    periods.forEach(function (p) {
      var d = allData[p];
      if (!d) return;
      t.totRev += d.totRev; t.ptRev += d.ptRev; t.fcRev += d.fcRev;
      t.ptCnt += d.ptCnt; t.fcCnt += d.fcCnt;
      t.newRev += d.newRev; t.reRev += d.reRev;
      Object.keys(d.members).forEach(function (m) { t.memSet[m] = true; });
    });
    var avgRev = t.totRev / numBranches;
    var avgPtPct = t.totRev > 0 ? t.ptRev / t.totRev * 100 : 0;
    var avgNewPct = t.totRev > 0 ? t.newRev / t.totRev * 100 : 0;
    var avgPtUnit = t.ptCnt > 0 ? t.ptRev / t.ptCnt : 0;
    var avgFcUnit = t.fcCnt > 0 ? t.fcRev / t.fcCnt : 0;
    var avgMem = Object.keys(t.memSet).length / numBranches;
    return {
      avgRev: avgRev, avgPtPct: avgPtPct, avgNewPct: avgNewPct,
      avgPtUnit: avgPtUnit, avgFcUnit: avgFcUnit, avgMem: avgMem,
      totalRev: t.totRev, ptRev: t.ptRev, fcRev: t.fcRev,
      newRev: t.newRev, reRev: t.reRev, numBranches: numBranches,
      ptCnt: t.ptCnt, fcCnt: t.fcCnt,
    };
  }

  // ----- 지점 순위 계산 -----
  function calcBranchRanks(analysis, currentBranch) {
    if (!analysis) return null;
    var branches = analysis.branches;
    var ranks = [];
    branches.forEach(function (br) {
      var bd = analysis.data[br] || {};
      var tot = 0, pt = 0, fc = 0, nw = 0, re = 0, ptC = 0, fcC = 0;
      analysis.periods.forEach(function (p) {
        var d = bd[p];
        if (!d) return;
        tot += d.totRev; pt += d.ptRev; fc += d.fcRev;
        nw += d.newRev; re += d.reRev;
        ptC += d.ptCnt; fcC += d.fcCnt;
      });
      ranks.push({
        name: br, totRev: tot, ptRev: pt, fcRev: fc, newRev: nw, reRev: re,
        ptPct: tot > 0 ? pt / tot * 100 : 0,
        ptUnit: ptC > 0 ? pt / ptC : 0,
        fcUnit: fcC > 0 ? fc / fcC : 0,
      });
    });
    ranks.sort(function (a, b) { return b.totRev - a.totRev; });
    var myRank = -1;
    ranks.forEach(function (r, i) { if (r.name === currentBranch) myRank = i; });
    return { ranks: ranks, myRank: myRank, total: ranks.length };
  }

  // ----- 인사이트 생성 -----
  function renderInsights(tableRows, totals, branchLabel, hasReg, isBranch, analysis) {
    if (tableRows.length < 1) {
      document.getElementById('sales-insights').innerHTML = '';
      return;
    }

    var items = [];
    var last = tableRows[tableRows.length - 1];
    var prev = tableRows.length >= 2 ? tableRows[tableRows.length - 2] : null;
    var branch = document.getElementById('sel-branch').value;

    // ── 공통: 추이 분석 ──
    if (prev && prev.totRev > 0) {
      var revChange = (last.totRev - prev.totRev) / prev.totRev * 100;
      var tag = revChange >= 0 ? 'up' : 'down';
      items.push('<span class="tag tag-' + tag + '">' + (revChange >= 0 ? '▲' : '▼') + '</span>' +
        '<strong>' + esc(last.period) + '</strong> 총 매출이 전기 대비 <strong>' + Math.abs(revChange).toFixed(1) + '%</strong> ' +
        (revChange >= 0 ? '증가' : '감소') + '했습니다. (' + fmtNum(Math.round(prev.totRev)) + ' → ' + fmtNum(Math.round(last.totRev)) + ')');
    }

    // PT 비중 변화
    if (prev && prev.ptPct > 0) {
      var ptDiff = last.ptPct - prev.ptPct;
      if (Math.abs(ptDiff) > 0.5) {
        items.push('<span class="tag tag-' + (ptDiff > 0 ? 'up' : 'down') + '">' + (ptDiff > 0 ? '▲' : '▼') + '</span>' +
          'PT 매출 비중이 <strong>' + pctStr(prev.ptPct) + ' → ' + pctStr(last.ptPct) + '</strong>로 ' +
          Math.abs(ptDiff).toFixed(1) + '%p ' + (ptDiff > 0 ? '상승' : '하락') + '했습니다.');
      }
    }

    // 신규/재등록 추이
    if (hasReg && prev && prev.newRev > 0) {
      var newRevChg = (last.newRev - prev.newRev) / prev.newRev * 100;
      items.push('<span class="tag tag-' + (newRevChg >= 0 ? 'up' : 'down') + '">' + (newRevChg >= 0 ? '▲' : '▼') + '</span>' +
        '신규 매출 <strong class="c-new">' + fmtNum(Math.round(prev.newRev)) + ' → ' + fmtNum(Math.round(last.newRev)) + '</strong> (' +
        (newRevChg >= 0 ? '+' : '') + newRevChg.toFixed(1) + '%), ' +
        '재등록 <strong class="c-re">' + fmtNum(Math.round(prev.reRev)) + ' → ' + fmtNum(Math.round(last.reRev)) + '</strong>');
    }

    // PT 객단가 추이
    if (prev && prev.ptUnit > 0 && last.ptUnit > 0) {
      var ptUnitChange = (last.ptUnit - prev.ptUnit) / prev.ptUnit * 100;
      if (Math.abs(ptUnitChange) > 3) {
        items.push('<span class="tag tag-info">💰</span>' +
          'PT 객단가 <strong>' + fmtNum(prev.ptUnit) + ' → ' + fmtNum(last.ptUnit) + '</strong> (' +
          (ptUnitChange >= 0 ? '+' : '') + ptUnitChange.toFixed(1) + '%)');
      }
    }

    // 최고/최저 매출 기간
    var maxRow = tableRows[0], minRow = tableRows[0];
    tableRows.forEach(function (r) {
      if (r.totRev > maxRow.totRev) maxRow = r;
      if (r.totRev < minRow.totRev && r.totRev > 0) minRow = r;
    });
    if (maxRow !== minRow) {
      items.push('<span class="tag tag-info">📊</span>' +
        '최고 매출: <strong>' + esc(maxRow.period) + '</strong> (' + fmtNum(Math.round(maxRow.totRev)) + ') / ' +
        '최저 매출: <strong>' + esc(minRow.period) + '</strong> (' + fmtNum(Math.round(minRow.totRev)) + ')');
    }

    // 비율 요약
    var ptFcSummary = 'PT <strong class="c-pt">' + pctStr(totals.totRev > 0 ? totals.ptRev / totals.totRev * 100 : 0) + '</strong> / ' +
      'FC <strong class="c-fc">' + pctStr(totals.totRev > 0 ? totals.fcRev / totals.totRev * 100 : 0) + '</strong>';
    if (hasReg) {
      ptFcSummary += ' | 신규 <strong class="c-new">' + pctStr(totals.totRev > 0 ? totals.newRev / totals.totRev * 100 : 0) + '</strong> / ' +
        '재등록 <strong class="c-re">' + pctStr(totals.totRev > 0 ? totals.reRev / totals.totRev * 100 : 0) + '</strong>';
    }
    ptFcSummary += ' | 총 매출 <strong>' + fmtNum(Math.round(totals.totRev)) + '</strong>';
    items.push('<span class="tag tag-warn">📋</span>' + ptFcSummary);

    // PT vs FC 객단가
    var tPtU = totals.ptCnt > 0 ? totals.ptRev / totals.ptCnt : 0;
    var tFcU = totals.fcCnt > 0 ? totals.fcRev / totals.fcCnt : 0;
    if (tFcU > 0 && tPtU > 0) {
      var mult = tPtU / tFcU;
      items.push('<span class="tag tag-info">💡</span>' +
        'PT 객단가는 FC 대비 <strong>' + mult.toFixed(1) + '배</strong>입니다. ' +
        (mult > 5 ? 'PT 고가 전략이 효과적입니다.' : mult > 2 ? 'PT 프리미엄이 적절한 수준입니다.' : 'PT 가격 전략 재검토를 권장합니다.'));
    }

    // ── 지점별: 전체 평균 대비 분석 ──
    if (isBranch && analysis && analysis.branches.length > 1) {
      var avg = calcAllAvg(analysis);
      var rankInfo = calcBranchRanks(analysis, branch);

      if (avg && rankInfo) {
        items.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.15);margin:8px 0">');
        items.push('<span class="tag tag-warn">🏢</span><strong>' + esc(branchLabel) + '</strong> 지점 전체 평균 대비 분석');

        // 1. 매출 순위
        var rank = rankInfo.myRank + 1;
        var numBr = rankInfo.total;
        var rankEmoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '📍';
        items.push('<span class="tag tag-info">' + rankEmoji + '</span>' +
          '매출 순위 <strong>' + rank + '위</strong> / ' + numBr + '개 지점');

        // 2. 전체 평균 대비 매출 비교
        if (avg.avgRev > 0) {
          var revDiffPct = (totals.totRev - avg.avgRev) / avg.avgRev * 100;
          var revTag = revDiffPct >= 0 ? 'up' : 'down';
          items.push('<span class="tag tag-' + revTag + '">' + (revDiffPct >= 0 ? '▲' : '▼') + '</span>' +
            '총 매출 <strong>' + fmtNum(Math.round(totals.totRev)) + '</strong>은 전체 지점 평균(' + fmtNum(Math.round(avg.avgRev)) + ') 대비 <strong>' +
            (revDiffPct >= 0 ? '+' : '') + revDiffPct.toFixed(1) + '%</strong>입니다.');
        }

        // 3. PT 비중 전체 평균 대비
        var myPtPct = totals.totRev > 0 ? totals.ptRev / totals.totRev * 100 : 0;
        var ptPctDiff = myPtPct - avg.avgPtPct;
        if (Math.abs(ptPctDiff) > 0.3) {
          items.push('<span class="tag tag-' + (ptPctDiff > 0 ? 'up' : 'down') + '">' + (ptPctDiff > 0 ? '▲' : '▼') + '</span>' +
            'PT 비중 <strong class="c-pt">' + pctStr(myPtPct) + '</strong>은 전체 평균(' + pctStr(avg.avgPtPct) + ') 대비 ' +
            '<strong>' + (ptPctDiff > 0 ? '+' : '') + ptPctDiff.toFixed(1) + '%p</strong> ' +
            (ptPctDiff > 0 ? '— PT 매출이 강한 지점입니다.' : '— FC 중심 매출 구조입니다.'));
        }

        // 4. PT 객단가 전체 평균 대비
        if (tPtU > 0 && avg.avgPtUnit > 0) {
          var ptUDiff = (tPtU - avg.avgPtUnit) / avg.avgPtUnit * 100;
          if (Math.abs(ptUDiff) > 3) {
            items.push('<span class="tag tag-' + (ptUDiff > 0 ? 'up' : 'down') + '">' + (ptUDiff > 0 ? '▲' : '▼') + '</span>' +
              'PT 객단가 <strong>' + fmtNum(Math.round(tPtU)) + '</strong>은 전체 평균(' + fmtNum(Math.round(avg.avgPtUnit)) + ') 대비 <strong>' +
              (ptUDiff > 0 ? '+' : '') + ptUDiff.toFixed(1) + '%</strong>' +
              (ptUDiff > 10 ? ' — 프리미엄 가격 전략이 잘 작동합니다.' : ptUDiff < -10 ? ' — 가격 인상 검토가 필요합니다.' : ''));
          }
        }

        // 5. FC 객단가 전체 평균 대비
        if (tFcU > 0 && avg.avgFcUnit > 0) {
          var fcUDiff = (tFcU - avg.avgFcUnit) / avg.avgFcUnit * 100;
          if (Math.abs(fcUDiff) > 3) {
            items.push('<span class="tag tag-' + (fcUDiff > 0 ? 'up' : 'down') + '">' + (fcUDiff > 0 ? '▲' : '▼') + '</span>' +
              'FC 객단가 <strong>' + fmtNum(Math.round(tFcU)) + '</strong>은 전체 평균(' + fmtNum(Math.round(avg.avgFcUnit)) + ') 대비 <strong>' +
              (fcUDiff > 0 ? '+' : '') + fcUDiff.toFixed(1) + '%</strong>');
          }
        }

        // 6. 신규/재등록 비중 전체 평균 대비
        if (hasReg && avg.avgNewPct > 0) {
          var myNewPct = totals.totRev > 0 ? totals.newRev / totals.totRev * 100 : 0;
          var newPctDiff = myNewPct - avg.avgNewPct;
          if (Math.abs(newPctDiff) > 0.5) {
            items.push('<span class="tag tag-' + (newPctDiff > 0 ? 'up' : 'down') + '">' + (newPctDiff > 0 ? '▲' : '▼') + '</span>' +
              '신규 비중 <strong class="c-new">' + pctStr(myNewPct) + '</strong>은 전체 평균(' + pctStr(avg.avgNewPct) + ') 대비 ' +
              '<strong>' + (newPctDiff > 0 ? '+' : '') + newPctDiff.toFixed(1) + '%p</strong>' +
              (newPctDiff > 5 ? ' — 신규 유치가 활발한 지점입니다.' : newPctDiff < -5 ? ' — 신규 유치 전략 강화가 필요합니다.' : ''));
          }
        }

        // 7. 종합 강점/약점 진단
        var strengths = [], weaknesses = [];
        if (avg.avgRev > 0 && totals.totRev > avg.avgRev * 1.1) strengths.push('매출');
        if (avg.avgRev > 0 && totals.totRev < avg.avgRev * 0.9) weaknesses.push('매출');
        if (myPtPct > avg.avgPtPct + 3) strengths.push('PT 비중');
        if (myPtPct < avg.avgPtPct - 3) weaknesses.push('PT 비중');
        if (tPtU > avg.avgPtUnit * 1.1) strengths.push('PT 객단가');
        if (tPtU < avg.avgPtUnit * 0.9) weaknesses.push('PT 객단가');
        if (hasReg) {
          var myNP = totals.totRev > 0 ? totals.newRev / totals.totRev * 100 : 0;
          if (myNP > avg.avgNewPct + 3) strengths.push('신규 유치');
          if (myNP < avg.avgNewPct - 3) weaknesses.push('신규 유치');
        }

        if (strengths.length || weaknesses.length) {
          var diag = '';
          if (strengths.length) diag += '강점: <strong style="color:#22c55e">' + strengths.join(', ') + '</strong>';
          if (strengths.length && weaknesses.length) diag += ' | ';
          if (weaknesses.length) diag += '개선 필요: <strong style="color:#ef4444">' + weaknesses.join(', ') + '</strong>';
          items.push('<span class="tag tag-info">🎯</span>' + diag);
        }
      }
    }

    var html = '<div class="insights-card"><h3>💡 Formula X 인사이트' +
      (isBranch ? ' — ' + esc(branchLabel) : '') + '</h3>';
    items.forEach(function (item) {
      if (item.indexOf('<hr') === 0) html += item;
      else html += '<div class="insight-item">' + item + '</div>';
    });
    html += '</div>';
    document.getElementById('sales-insights').innerHTML = html;
  }

  // ----- 이벤트 -----
  document.getElementById('sel-branch').addEventListener('change', function () {
    renderSalesView();
    // 매출 관리에서 지점 변경 시 종합 대시보드도 동기화
    var salesBranch = document.getElementById('sel-branch').value;
    var selOvBranch = document.getElementById('sel-overview-branch');
    if (selOvBranch) {
      // 해당 지점이 옵션에 있으면 선택
      for (var i = 0; i < selOvBranch.options.length; i++) {
        if (selOvBranch.options[i].value === salesBranch) {
          selOvBranch.value = salesBranch;
          break;
        }
      }
    }
  });
  document.getElementById('sel-period').addEventListener('change', function () {
    if (salesRawRows.length > 0) analyzeSalesData();
  });

  document.getElementById('btn-sales-xlsx').addEventListener('click', function () {
    if (!salesAnalysis) return;
    var branch = document.getElementById('sel-branch').value;
    var branchData = salesAnalysis.data[branch] || {};
    var periods = salesAnalysis.periods;
    var label = branch === '__all__' ? '전체' : branch;
    var isW = document.getElementById('sel-period').value === 'weekly';
    var periodLabel = isW ? '주간' : '월';

    // 신규/재등록 데이터 존재 여부
    var hasReg = false;
    periods.forEach(function (p) {
      var d = branchData[p];
      if (d && (d.newRev > 0 || d.reRev > 0)) hasReg = true;
    });

    var rows = [];
    periods.forEach(function (p) {
      var d = branchData[p] || emptyBucket();
      var memCnt = Object.keys(d.members).length || (d.ptCnt + d.fcCnt);
      var row = {};
      row[periodLabel] = p;
      row['매출'] = Math.round(d.totRev);
      row['PT'] = Math.round(d.ptRev);
      row['FC'] = Math.round(d.fcRev);
      row['PT비중'] = d.totRev > 0 ? (d.ptRev / d.totRev * 100).toFixed(1) + '%' : '0%';
      row['FC비중'] = d.totRev > 0 ? (d.fcRev / d.totRev * 100).toFixed(1) + '%' : '0%';
      if (hasReg) {
        row['신규'] = Math.round(d.newRev);
        row['재등록'] = Math.round(d.reRev);
        row['신규비중'] = d.totRev > 0 ? (d.newRev / d.totRev * 100).toFixed(1) + '%' : '0%';
        row['재등록비중'] = d.totRev > 0 ? (d.reRev / d.totRev * 100).toFixed(1) + '%' : '0%';
      }
      row['회원수'] = memCnt;
      row['PT객단가'] = d.ptCnt > 0 ? Math.round(d.ptRev / d.ptCnt) : 0;
      row['FC객단가'] = d.fcCnt > 0 ? Math.round(d.fcRev / d.fcCnt) : 0;
      rows.push(row);
    });

    var headers = [periodLabel, '매출', 'PT', 'FC', 'PT비중', 'FC비중'];
    if (hasReg) headers = headers.concat(['신규', '재등록', '신규비중', '재등록비중']);
    headers = headers.concat(['회원수', 'PT객단가', 'FC객단가']);

    XlsxWriter.saveXlsx([{
      name: label,
      rows: rows,
      headers: headers,
    }], '매출_' + label + '_' + fmtDate() + '.xlsx');
  });

  document.getElementById('btn-sales-clear').addEventListener('click', function () {
    if (!confirm('업로드된 매출 데이터를 모두 삭제하시겠습니까?')) return;
    salesRawRows = [];
    salesAnalysis = null;
    overviewWeeklyCache = null;
    var selOvBranch = document.getElementById('sel-overview-branch');
    selOvBranch.innerHTML = '<option value="__all__">전체 통합</option>';
    document.getElementById('sales-file-list').innerHTML = '';
    document.getElementById('sales-filter').style.display = 'none';
    document.getElementById('sales-table-area').innerHTML = '';
    document.getElementById('sales-insights').innerHTML = '';
    renderOverview();
  });

  // ================================================================
  //  종합 대시보드
  // ================================================================
  // 종합 대시보드용 주간 집계 캐시
  var overviewWeeklyCache = null;

  function renderOverview() {
    var hasPlace = placeRaw.length > 0;
    var hasSales = salesRawRows.length > 0;
    var emptyEl = document.getElementById('overview-empty');
    var filterEl = document.getElementById('overview-filter');

    if (!hasPlace && !hasSales) {
      emptyEl.style.display = 'block';
      filterEl.style.display = 'none';
      document.getElementById('overview-kpi').innerHTML = '';
      document.getElementById('overview-funnel').innerHTML = '';
      document.getElementById('overview-timeline').innerHTML = '';
      document.getElementById('overview-insights').innerHTML = '';
      return;
    }
    emptyEl.style.display = 'none';

    // ── 데이터 수집 ──
    function pn(v) { return parseFloat(String(v || '0').replace(/[,%]/g, '')) || 0; }
    var pr = addRates(cleanRows(placeRaw));

    // 플레이스 집계
    var pTotInf = 0, pTotOrd = 0, pTotCall = 0, pTotRev = 0;
    pr.forEach(function (r) {
      pTotInf += pn(r['유입']); pTotOrd += pn(r['예약/주문']);
      pTotCall += pn(r['스마트콜']); pTotRev += pn(r['리뷰']);
    });
    var pCvr = pTotInf > 0 ? pTotOrd / pTotInf * 100 : 0;
    var pRCvr = pTotOrd > 0 ? pTotRev / pTotOrd * 100 : 0;
    var pLast = pr.length ? pr[pr.length - 1] : null;
    var pPrev = pr.length >= 2 ? pr[pr.length - 2] : null;

    // 매출 집계 — 항상 주간(weekly) 기준, 선택된 지점 기준
    var weeklyAnalysis = null;
    var sAvg = null;
    var sTotRev = 0, sPtPct = 0, sNewPct = 0;
    var sAllData = {}, sPeriods = [], sLast = null, sPrev = null;
    var selectedBranch = document.getElementById('sel-overview-branch').value;

    if (hasSales) {
      var cols = detectColumns(salesRawRows);
      if (cols && cols.revenue) {
        // 캐시가 없으면 주간 집계 실행
        if (!overviewWeeklyCache) {
          overviewWeeklyCache = aggregateData(salesRawRows, cols, 'weekly');
        }
        weeklyAnalysis = overviewWeeklyCache;

        // 지점 셀렉터 업데이트 (최초 또는 변경 시)
        var selOvBranch = document.getElementById('sel-overview-branch');
        var existingOptions = selOvBranch.options.length;
        var needsRefresh = existingOptions <= 1 && weeklyAnalysis.branches.length > 0;
        if (needsRefresh) {
          var prevVal = selOvBranch.value;
          selOvBranch.innerHTML = '<option value="__all__">전체 통합</option>';
          weeklyAnalysis.branches.forEach(function (br) {
            selOvBranch.innerHTML += '<option value="' + esc(br) + '">' + esc(br) + '</option>';
          });
          // 이전 선택값 복원
          if (prevVal && prevVal !== '__all__') {
            selOvBranch.value = prevVal;
            selectedBranch = selOvBranch.value;
          }
        }
        filterEl.style.display = hasSales ? 'flex' : 'none';

        // 선택된 지점의 데이터 사용
        var branchKey = selectedBranch;
        var branchData = weeklyAnalysis.data[branchKey] || weeklyAnalysis.data['__all__'] || {};
        sAllData = branchData;
        sPeriods = weeklyAnalysis.periods;

        // 선택된 지점의 총 집계
        var st = { totRev: 0, ptRev: 0, fcRev: 0, ptCnt: 0, fcCnt: 0, newRev: 0, reRev: 0, memSet: {} };
        sPeriods.forEach(function (p) {
          var d = sAllData[p];
          if (!d) return;
          st.totRev += d.totRev; st.ptRev += d.ptRev; st.fcRev += d.fcRev;
          st.ptCnt += d.ptCnt; st.fcCnt += d.fcCnt;
          st.newRev += d.newRev; st.reRev += d.reRev;
          Object.keys(d.members).forEach(function (m) { st.memSet[m] = true; });
        });

        sAvg = {
          totalRev: st.totRev, ptRev: st.ptRev, fcRev: st.fcRev,
          newRev: st.newRev, reRev: st.reRev,
          avgPtPct: st.totRev > 0 ? st.ptRev / st.totRev * 100 : 0,
          avgNewPct: st.totRev > 0 ? st.newRev / st.totRev * 100 : 0,
          avgPtUnit: st.ptCnt > 0 ? st.ptRev / st.ptCnt : 0,
          avgFcUnit: st.fcCnt > 0 ? st.fcRev / st.fcCnt : 0,
          numBranches: weeklyAnalysis.branches.length,
          ptCnt: st.ptCnt, fcCnt: st.fcCnt,
        };

        sTotRev = sAvg.totalRev;
        sPtPct = sAvg.avgPtPct;
        sNewPct = sAvg.avgNewPct;
        sLast = sPeriods.length ? sAllData[sPeriods[sPeriods.length - 1]] : null;
        sPrev = sPeriods.length >= 2 ? sAllData[sPeriods[sPeriods.length - 2]] : null;

        // 힌트 텍스트
        var hintEl = document.getElementById('overview-branch-hint');
        if (selectedBranch === '__all__') {
          hintEl.textContent = '플레이스와 매칭하려면 해당 지점을 선택하세요';
        } else {
          hintEl.textContent = '✓ ' + selectedBranch + ' 매출 ↔ 플레이스 유입 연결 중';
        }
      }
    } else {
      filterEl.style.display = 'none';
    }

    // ── KPI 카드 ──
    var kpis = [];

    if (hasSales) {
      var sBranchLabel = selectedBranch === '__all__' ? '' : ' (' + selectedBranch + ')';
      var sRevChg = sPrev && sPrev.totRev > 0 ? ((sLast.totRev - sPrev.totRev) / sPrev.totRev * 100) : null;
      kpis.push({ label: '총 매출' + sBranchLabel, value: fmtNum(Math.round(sTotRev)), color: 'green',
        sub: sPeriods.length + '개 기간', change: sRevChg, changeSuffix: '% (최근기)' });
      kpis.push({ label: 'PT 비중' + sBranchLabel, value: pctStr(sPtPct), color: 'orange',
        sub: 'PT ' + fmtNum(Math.round(sAvg.ptRev)) + ' / FC ' + fmtNum(Math.round(sAvg.fcRev)) });
      if (sAvg.newRev > 0 || sAvg.reRev > 0) {
        kpis.push({ label: '신규 비중' + sBranchLabel, value: pctStr(sNewPct), color: 'purple',
          sub: '신규 ' + fmtNum(Math.round(sAvg.newRev)) + ' / 재등록 ' + fmtNum(Math.round(sAvg.reRev)) });
      }
      kpis.push({ label: 'PT 객단가' + sBranchLabel, value: fmtNum(Math.round(sAvg.avgPtUnit)), color: 'orange',
        sub: 'FC 객단가 ' + fmtNum(Math.round(sAvg.avgFcUnit)) });
    }

    if (hasPlace) {
      var infChg = pPrev ? ((pn(pLast['유입']) - pn(pPrev['유입'])) / pn(pPrev['유입']) * 100) : null;
      kpis.push({ label: '총 유입', value: fmtNum(Math.round(pTotInf)), color: 'cyan',
        sub: pr.length + '주간 누적', change: infChg, changeSuffix: '% (전주비)' });
      kpis.push({ label: '전환율', value: pCvr.toFixed(1) + '%', color: 'blue',
        sub: '예약/주문 ' + fmtNum(Math.round(pTotOrd)) + '건' });
      kpis.push({ label: '리뷰전환율', value: pRCvr.toFixed(1) + '%', color: 'rose',
        sub: '리뷰 ' + fmtNum(Math.round(pTotRev)) + '건' });
    }

    var kpiHtml = '';
    kpis.forEach(function (k) {
      kpiHtml += '<div class="kpi-card kpi-' + k.color + '">';
      kpiHtml += '<div class="kpi-label">' + esc(k.label) + '</div>';
      kpiHtml += '<div class="kpi-value">' + k.value + '</div>';
      if (k.sub) kpiHtml += '<div class="kpi-sub">' + k.sub + '</div>';
      if (k.change != null) {
        var cls = k.change >= 0 ? 'up' : 'down';
        kpiHtml += '<div class="kpi-change ' + cls + '">' + (k.change >= 0 ? '▲ +' : '▼ ') + k.change.toFixed(1) + (k.changeSuffix || '%') + '</div>';
      }
      kpiHtml += '</div>';
    });
    document.getElementById('overview-kpi').innerHTML = kpiHtml;

    // ── 퍼널 시각화 ──
    var funnelEl = document.getElementById('overview-funnel');
    if (hasPlace || hasSales) {
      var fBrLabel = hasSales && selectedBranch !== '__all__' ? ' (' + esc(selectedBranch) + ')' : '';
      var fh = '<div class="funnel-card">';
      fh += '<h3>📊 전환 퍼널' + fBrLabel + '</h3>';
      fh += '<div class="funnel-layout">';

      // ── 왼쪽: 깔때기형 플레이스 퍼널 ──
      if (hasPlace) {
        fh += '<div class="funnel-left"><div class="vfunnel">';

        // 전환율 계산
        var cvrCls = pCvr >= 8 ? 'good' : pCvr >= 4 ? 'warn' : 'bad';
        var rCvr = pTotOrd > 0 ? pTotRev / pTotOrd * 100 : 0;
        var rCvrCls = rCvr >= 8 ? 'good' : rCvr >= 3 ? 'warn' : 'bad';

        // 깔때기 너비: 항상 단계별로 확실히 좁아지도록 고정 비율 + 실제 비율 혼합
        var w1 = 100; // 유입: 100%
        var w2 = 58;  // 예약/주문: 기본 58%
        var w3 = 28;  // 리뷰: 기본 28%
        // 실제 비율 반영 (±10% 범위 보정, 단 항상 줄어들게)
        if (pTotInf > 0) {
          var realOrdRatio = pTotOrd / pTotInf;
          w2 = Math.max(40, Math.min(70, 55 + realOrdRatio * 100));
        }
        if (pTotOrd > 0) {
          var realRevRatio = pTotRev / pTotOrd;
          w3 = Math.max(18, Math.min(w2 - 15, 25 + realRevRatio * 30));
        }

        // Step 1: 유입
        fh += '<div class="vfunnel-step">';
        fh += '<div class="vfunnel-bar" style="width:' + w1 + '%;background:linear-gradient(135deg,#22d3ee,#06b6d4)">';
        fh += '<div class="vfunnel-bar-inner">';
        fh += '<span class="vf-label">유입</span>';
        fh += '<span class="vf-value">' + fmtNum(Math.round(pTotInf)) + '</span>';
        fh += '<span class="vf-sub">' + pr.length + '주 누적</span>';
        fh += '</div></div></div>';

        // Arrow: 전환율
        fh += '<div class="vfunnel-arrow">';
        fh += '<div class="vfa-line"></div>';
        fh += '<div class="vfa-badge ' + cvrCls + '">▼ 전환율 ' + pCvr.toFixed(1) + '%</div>';
        fh += '<div class="vfa-line"></div>';
        fh += '</div>';

        // Step 2: 예약/주문
        fh += '<div class="vfunnel-step">';
        fh += '<div class="vfunnel-bar" style="width:' + w2.toFixed(0) + '%;background:linear-gradient(135deg,#3b82f6,#2563eb)">';
        fh += '<div class="vfunnel-bar-inner">';
        fh += '<span class="vf-label">예약/주문</span>';
        fh += '<span class="vf-value">' + fmtNum(Math.round(pTotOrd)) + '</span>';
        fh += '<span class="vf-sub">스마트콜 ' + fmtNum(Math.round(pTotCall)) + '</span>';
        fh += '</div></div></div>';

        // Arrow: 리뷰전환율
        fh += '<div class="vfunnel-arrow">';
        fh += '<div class="vfa-line"></div>';
        fh += '<div class="vfa-badge ' + rCvrCls + '">▼ 리뷰전환율 ' + rCvr.toFixed(1) + '%</div>';
        fh += '<div class="vfa-line"></div>';
        fh += '</div>';

        // Step 3: 리뷰
        fh += '<div class="vfunnel-step">';
        fh += '<div class="vfunnel-bar" style="width:' + w3.toFixed(0) + '%;background:linear-gradient(135deg,#8b5cf6,#7c3aed)">';
        fh += '<div class="vfunnel-bar-inner">';
        fh += '<span class="vf-label">리뷰</span>';
        fh += '<span class="vf-value">' + fmtNum(Math.round(pTotRev)) + '</span>';
        fh += '</div></div></div>';

        fh += '</div></div>'; // vfunnel + funnel-left
      }

      // ── 오른쪽: 매출 구성 ──
      if (hasSales && sAvg) {
        var sBrLabel2 = selectedBranch === '__all__' ? '' : ' (' + esc(selectedBranch) + ')';
        fh += '<div class="funnel-right">';
        fh += '<div style="font-size:13px;font-weight:700;color:#475569;margin-bottom:12px">💰 매출 구성' + sBrLabel2 + '</div>';

        // 총 매출
        fh += '<div class="sales-side-card" style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border-color:#bbf7d0">';
        fh += '<div class="ss-label">총 매출</div>';
        fh += '<div class="ss-value" style="color:#16a34a">' + fmtNum(Math.round(sTotRev)) + '</div>';
        fh += '<div class="ss-sub">' + sPeriods.length + '주간 누적</div>';
        fh += '</div>';

        // PT / FC 카드 (나란히)
        fh += '<div style="display:flex;gap:10px">';
        fh += '<div class="sales-side-card" style="flex:1">';
        fh += '<div class="ss-label">🏋️ PT</div>';
        fh += '<div class="ss-value c-pt" style="font-size:18px">' + fmtNum(Math.round(sAvg.ptRev)) + '</div>';
        fh += '<div class="ss-sub">' + pctStr(sPtPct) + '</div>';
        fh += '</div>';
        fh += '<div class="sales-side-card" style="flex:1">';
        fh += '<div class="ss-label">🏃 FC</div>';
        fh += '<div class="ss-value c-fc" style="font-size:18px">' + fmtNum(Math.round(sAvg.fcRev)) + '</div>';
        fh += '<div class="ss-sub">' + pctStr(100 - sPtPct) + '</div>';
        fh += '</div>';
        fh += '</div>';

        // PT/FC 비율 바
        var ptAmt = sAvg.ptRev;
        var fcAmt = sAvg.fcRev;
        var ptW = sTotRev > 0 ? ptAmt / sTotRev * 100 : 50;
        var fcW = 100 - ptW;
        fh += '<div style="margin-top:12px;font-size:11px;font-weight:600;color:#64748b;margin-bottom:4px">PT / FC 비중</div>';
        fh += '<div class="funnel-bar-row">';
        fh += '<div style="width:' + ptW.toFixed(1) + '%;background:rgba(232,112,64,0.75)">PT ' + ptW.toFixed(0) + '%</div>';
        fh += '<div style="width:' + fcW.toFixed(1) + '%;background:rgba(59,130,246,0.65)">FC ' + fcW.toFixed(0) + '%</div>';
        fh += '</div>';

        // 신규/재등록 비율 바
        var newAmt = sAvg.newRev || 0;
        var reAmt = sAvg.reRev || 0;
        if (newAmt > 0 || reAmt > 0) {
          var nW = sTotRev > 0 ? newAmt / sTotRev * 100 : 50;
          var rW = 100 - nW;
          fh += '<div style="margin-top:8px;font-size:11px;font-weight:600;color:#64748b;margin-bottom:4px">신규 / 재등록</div>';
          fh += '<div class="funnel-bar-row">';
          fh += '<div style="width:' + nW.toFixed(1) + '%;background:rgba(34,197,94,0.7)">신규 ' + nW.toFixed(0) + '%</div>';
          fh += '<div style="width:' + rW.toFixed(1) + '%;background:rgba(168,85,247,0.65)">재등록 ' + rW.toFixed(0) + '%</div>';
          fh += '</div>';
        }

        fh += '</div>'; // funnel-right
      }

      fh += '</div>'; // funnel-layout
      fh += '</div>'; // funnel-card
      funnelEl.innerHTML = fh;
    } else {
      funnelEl.innerHTML = '';
    }

    // ── 통합 타임라인: 유입 + 매출 연결 테이블 ──
    var tlEl = document.getElementById('overview-timeline');
    if (hasPlace && pr.length) {
      var ovBrLabel = selectedBranch === '__all__' ? '' : ' (' + esc(selectedBranch) + ')';
      var th = '<h3 class="table-title">주간 플레이스 × 매출' + ovBrLabel + ' 추이</h3><table><thead><tr>';
      th += '<th style="text-align:left">주간</th>';
      th += '<th>유입</th><th>예약/주문</th><th>전환율</th><th>리뷰</th>';
      if (hasSales) {
        th += '<th class="c-pt">PT</th><th class="c-fc">FC</th>';
      }
      th += '</tr></thead><tbody>';

      // 매출 데이터를 주간 키로 매핑 — 시작 날짜 기준으로도 매칭
      var salesByWeek = {};
      var salesByStart = {};
      function extractStart(key) {
        var m = String(key || '').match(/(\d{4}-\d{2}-\d{2})/);
        return m ? m[1] : '';
      }
      if (hasSales) {
        sPeriods.forEach(function (p) {
          salesByWeek[p] = sAllData[p] || emptyBucket();
          var start = extractStart(p);
          if (start) salesByStart[start] = sAllData[p] || emptyBucket();
        });
      }

      function findSalesMatch(weekKey) {
        // 1순위: 정확한 키 매칭
        if (salesByWeek[weekKey]) return salesByWeek[weekKey];
        // 2순위: 시작 날짜 매칭
        var start = extractStart(weekKey);
        if (start && salesByStart[start]) return salesByStart[start];
        return null;
      }

      // 매칭된 매출 합계
      var matchedSalesTotal = 0, matchedPt = 0, matchedFc = 0, matchCount = 0;

      // 1차 패스: 데이터 수집 + 최대값 계산 (바 비율용)
      var tlRows = [];
      pr.forEach(function (r) {
        var week = String(r['주간'] || '');
        var inf = pn(r['유입']), ord = pn(r['예약/주문']), rev = pn(r['리뷰']);
        var cvr = r['전환율'] || '-';
        var cvrNum = parseFloat(String(cvr).replace('%', '')) || 0;
        var sd = hasSales ? findSalesMatch(week) : null;
        var ptVal = 0, fcVal = 0, hasMatch = false;
        if (sd && sd.totRev > 0) {
          matchedSalesTotal += sd.totRev; matchedPt += sd.ptRev; matchedFc += sd.fcRev; matchCount++;
          ptVal = sd.ptRev; fcVal = sd.fcRev; hasMatch = true;
        }
        tlRows.push({ week: week, inf: inf, ord: ord, cvr: cvr, cvrNum: cvrNum, rev: rev, pt: ptVal, fc: fcVal, hasMatch: hasMatch });
      });

      var maxInf = 1, maxOrd = 1, maxRev = 1, maxCvr = 1, maxPt = 1, maxFc = 1;
      tlRows.forEach(function (r) {
        if (r.inf > maxInf) maxInf = r.inf;
        if (r.ord > maxOrd) maxOrd = r.ord;
        if (r.rev > maxRev) maxRev = r.rev;
        if (r.cvrNum > maxCvr) maxCvr = r.cvrNum;
        if (r.pt > maxPt) maxPt = r.pt;
        if (r.fc > maxFc) maxFc = r.fc;
      });

      // 바 셀 헬퍼
      function ovBar(val, max, rgb, txt, cls) {
        var p = max > 0 ? Math.min(100, Math.round(val / max * 100)) : 0;
        return '<td><div class="bar-cell"><div class="bar-fill" style="width:' + p + '%;background:rgba(' + rgb + ',0.22)"></div>' +
          '<span class="bar-value' + (cls ? ' ' + cls : '') + '">' + txt + '</span></div></td>';
      }

      // 2차 패스: 렌더링
      tlRows.forEach(function (r) {
        th += '<tr><td style="text-align:left;font-weight:600">' + esc(r.week) + '</td>';
        th += ovBar(r.inf, maxInf, '34,211,238', fmtNum(Math.round(r.inf)), '');
        th += ovBar(r.ord, maxOrd, '59,130,246', fmtNum(Math.round(r.ord)), '');
        th += ovBar(r.cvrNum, maxCvr, '99,102,241', esc(String(r.cvr)), '');
        th += ovBar(r.rev, maxRev, '244,63,94', fmtNum(Math.round(r.rev)), '');
        if (hasSales) {
          if (r.hasMatch) {
            th += ovBar(r.pt, maxPt, '232,112,64', fmtNum(Math.round(r.pt)), 'c-pt');
            th += ovBar(r.fc, maxFc, '59,130,246', fmtNum(Math.round(r.fc)), 'c-fc');
          } else {
            th += '<td style="text-align:center;color:#94a3b8">—</td>';
            th += '<td style="text-align:center;color:#94a3b8">—</td>';
          }
        }
        th += '</tr>';
      });

      // 합계 행
      var salesTotalForTable = matchCount > 0 ? matchedSalesTotal : sTotRev;
      var ptTotalForTable = matchCount > 0 ? matchedPt : (sAvg ? sAvg.ptRev : 0);
      var fcTotalForTable = matchCount > 0 ? matchedFc : (sAvg ? sAvg.fcRev : 0);

      th += '<tr class="row-total"><td style="text-align:left;font-weight:800">합계</td>';
      th += '<td><strong>' + fmtNum(Math.round(pTotInf)) + '</strong></td>';
      th += '<td><strong>' + fmtNum(Math.round(pTotOrd)) + '</strong></td>';
      th += '<td><strong>' + pCvr.toFixed(1) + '%</strong></td>';
      th += '<td><strong>' + fmtNum(Math.round(pTotRev)) + '</strong></td>';
      if (hasSales) {
        th += '<td><strong class="c-pt">' + fmtNum(Math.round(ptTotalForTable)) + '</strong></td>';
        th += '<td><strong class="c-fc">' + fmtNum(Math.round(fcTotalForTable)) + '</strong></td>';
      }
      th += '</tr>';
      if (hasSales && matchCount === 0 && sPeriods.length > 0) {
        th += '<tr><td colspan="' + (hasSales ? 7 : 5) + '" style="text-align:center;color:#94a3b8;font-size:12px;padding:12px">';
        th += '💡 매출 주간 키가 플레이스 주간과 매칭되지 않았습니다. 매출 데이터의 결제일시 기간을 확인하세요.';
        th += '</td></tr>';
      }

      th += '</tbody></table>';
      tlEl.innerHTML = th;
    } else if (hasSales && sPeriods.length) {
      // 플레이스 없이 매출만 있을 때
      var th2 = '<h3 class="table-title">기간별 매출 추이</h3><table><thead><tr>';
      th2 += '<th style="text-align:left">기간</th><th>매출</th><th>PT</th><th>FC</th><th>PT비중</th>';
      th2 += '</tr></thead><tbody>';
      sPeriods.slice(-8).forEach(function (p) {
        var d = sAllData[p] || emptyBucket();
        var pp = d.totRev > 0 ? (d.ptRev / d.totRev * 100).toFixed(1) + '%' : '-';
        th2 += '<tr><td style="text-align:left;font-weight:600">' + esc(p) + '</td>';
        th2 += '<td>' + fmtNum(Math.round(d.totRev)) + '</td>';
        th2 += '<td class="c-pt">' + fmtNum(Math.round(d.ptRev)) + '</td>';
        th2 += '<td class="c-fc">' + fmtNum(Math.round(d.fcRev)) + '</td>';
        th2 += '<td>' + pp + '</td></tr>';
      });
      th2 += '</tbody></table>';
      tlEl.innerHTML = th2;
    } else {
      tlEl.innerHTML = '';
    }

    // ── AI 종합 인사이트 ──
    renderOverviewInsights(pr, placeCh, placeKw, weeklyAnalysis, sAvg, selectedBranch);
  }

  function renderOverviewInsights(pr, ch, kw, analysis, sAvg, branchKey) {
    var items = [];
    function pn(v) { return parseFloat(String(v || '0').replace(/[,%]/g, '')) || 0; }
    var hasPlace = pr.length > 0;
    var hasSales = !!analysis;

    // ── 비즈니스 상태 종합 ──
    var branchLabel = (!branchKey || branchKey === '__all__') ? '전체' : branchKey;
    items.push('<span class="tag tag-warn">🤖</span><strong>Formula X AI 종합 분석 (' + esc(branchLabel) + ')</strong>');

    // 1. 매출 트렌드 요약
    if (hasSales) {
      var sPeriods = analysis.periods;
      var sAll = analysis.data[branchKey || '__all__'] || analysis.data['__all__'] || {};

      if (sPeriods.length >= 3) {
        var recent = sPeriods.slice(-3);
        var older = sPeriods.slice(0, -3);
        var rAvg = 0, oAvg = 0;
        recent.forEach(function (p) { rAvg += (sAll[p] || emptyBucket()).totRev; });
        older.forEach(function (p) { oAvg += (sAll[p] || emptyBucket()).totRev; });
        rAvg /= recent.length; oAvg /= Math.max(older.length, 1);
        if (oAvg > 0) {
          var trend = (rAvg - oAvg) / oAvg * 100;
          var tLabel = trend > 10 ? '성장세' : trend > 0 ? '소폭 성장' : trend > -10 ? '소폭 하락' : '하락세';
          items.push('<span class="tag tag-' + (trend >= 0 ? 'up' : 'down') + '">' + (trend >= 0 ? '▲' : '▼') + '</span>' +
            '매출 트렌드: <strong>' + tLabel + '</strong> (최근 3기 평균 vs 이전 평균 <strong>' +
            (trend >= 0 ? '+' : '') + trend.toFixed(1) + '%</strong>)');
        }
      }

      // PT/FC 구조 분석
      if (sAvg) {
        var ptR = sAvg.avgPtPct;
        var ptStr2 = ptR > 55 ? 'PT 중심' : ptR > 45 ? '균형' : 'FC 중심';
        items.push('<span class="tag tag-info">💼</span>' +
          '매출 구조: <strong>' + ptStr2 + '</strong> (PT <strong class="c-pt">' + ptR.toFixed(1) + '%</strong> / FC <strong class="c-fc">' + (100 - ptR).toFixed(1) + '%</strong>) | ' +
          '지점 <strong>' + sAvg.numBranches + '개</strong> · 총 매출 <strong>' + fmtNum(Math.round(sAvg.totalRev)) + '</strong>');

        // 신규/재등록
        if (sAvg.newRev > 0 || sAvg.reRev > 0) {
          var nR = sAvg.totalRev > 0 ? sAvg.newRev / sAvg.totalRev * 100 : 0;
          var nLabel = nR > 40 ? '신규 유치 활발' : nR > 25 ? '양호' : '재등록 의존 구조';
          items.push('<span class="tag tag-info">🆕</span>' +
            '신규/재등록: <strong>' + nLabel + '</strong> (신규 <strong class="c-new">' + nR.toFixed(1) + '%</strong> / 재등록 <strong class="c-re">' + (100 - nR).toFixed(1) + '%</strong>)');
        }
      }
    }

    // 2. 플레이스 트렌드
    if (hasPlace && pr.length >= 2) {
      items.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.15);margin:8px 0">');

      var pLast = pr[pr.length - 1], pPrev = pr[pr.length - 2];
      var lInf = pn(pLast['유입']), pInf = pn(pPrev['유입']);
      var lCvr = pn(pLast['전환율']), pCvr2 = pn(pPrev['전환율']);

      // 유입 트렌드
      if (pr.length >= 4) {
        var pR3 = 0, pO3 = 0, pRn = Math.min(3, pr.length), pOn = pr.length - pRn;
        for (var pi = pr.length - pRn; pi < pr.length; pi++) pR3 += pn(pr[pi]['유입']);
        for (var pj = 0; pj < pr.length - pRn; pj++) pO3 += pn(pr[pj]['유입']);
        pR3 /= pRn; pO3 /= Math.max(pOn, 1);
        if (pO3 > 0) {
          var pTrend = (pR3 - pO3) / pO3 * 100;
          var pTLabel = pTrend > 10 ? '유입 성장' : pTrend > 0 ? '소폭 증가' : pTrend > -10 ? '소폭 감소' : '유입 감소';
          items.push('<span class="tag tag-' + (pTrend >= 0 ? 'up' : 'down') + '">' + (pTrend >= 0 ? '▲' : '▼') + '</span>' +
            '플레이스 유입 트렌드: <strong>' + pTLabel + '</strong> (최근 3주 평균 vs 이전 <strong>' +
            (pTrend >= 0 ? '+' : '') + pTrend.toFixed(1) + '%</strong>)');
        }
      }

      // 전환율 평가
      var avgCvrAll = 0;
      pr.forEach(function (r) { avgCvrAll += pn(r['전환율']); });
      avgCvrAll /= pr.length;
      items.push('<span class="tag tag-info">🎯</span>' +
        '평균 전환율 <strong>' + avgCvrAll.toFixed(1) + '%</strong> | ' +
        '최근 주 <strong>' + lCvr.toFixed(1) + '%</strong>' +
        (lCvr > avgCvrAll ? ' (평균 이상 — 양호)' : ' (평균 미만 — 개선 필요)'));
    }

    // 3. 교차 분석 (플레이스 + 매출)
    if (hasPlace && hasSales) {
      items.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.15);margin:8px 0">');
      items.push('<span class="tag tag-warn">🔗</span><strong>교차 분석: 플레이스 × 매출</strong>');

      // 채널-매출 기여도
      if (ch.length) {
        var chNames2 = [];
        ch.forEach(function (r) { Object.keys(r).forEach(function (k) { if (k !== '주간' && k !== '유입수' && chNames2.indexOf(k) < 0) chNames2.push(k); }); });
        var chTot2 = {}, chGrand = 0;
        chNames2.forEach(function (cn) { chTot2[cn] = 0; });
        ch.forEach(function (r) {
          chNames2.forEach(function (cn) { var v = pn(r[cn]); chTot2[cn] += v; chGrand += v; });
        });
        if (chGrand > 0 && sAvg) {
          var sorted2 = chNames2.slice().sort(function (a, b) { return chTot2[b] - chTot2[a]; });
          var topName = sorted2[0];
          var topShare = chTot2[topName] / chGrand * 100;
          var estRev = sAvg.totalRev * topShare / 100;
          items.push('<span class="tag tag-info">📍</span>' +
            '1위 채널 <strong>' + esc(topName) + '</strong>(' + topShare.toFixed(1) + '%)의 추정 매출 기여: <strong>' +
            fmtNum(Math.round(estRev)) + '원</strong>');
        }
      }

      // 키워드 매출 연결
      if (kw.length) {
        var kwNames2 = [];
        kw.forEach(function (r) { Object.keys(r).forEach(function (k) { if (k !== '주간' && kwNames2.indexOf(k) < 0) kwNames2.push(k); }); });
        var kwAvg2 = {};
        kwNames2.forEach(function (kn) { kwAvg2[kn] = 0; });
        kw.forEach(function (r) { kwNames2.forEach(function (kn) { kwAvg2[kn] += pn(r[kn]); }); });
        var kwn2 = kw.length;
        var kwSort = kwNames2.slice().sort(function (a, b) { return kwAvg2[b] - kwAvg2[a]; });
        if (kwSort.length) {
          var topKw2 = kwSort[0];
          var topKwPct = kwAvg2[topKw2] / kwn2;
          var topKwType = isBrandKeyword(topKw2) ? ' [브랜드]' : ' [일반]';
          items.push('<span class="tag tag-info">🔍</span>' +
            '1위 키워드 <strong>' + esc(topKw2) + '</strong>' + topKwType + '(평균 ' + topKwPct.toFixed(1) + '%)가 유입의 핵심 동력입니다.');
        }

        // 브랜드 vs 일반 키워드 분석
        var ovKwClass = classifyKeywords(kw);
        if (ovKwClass.length >= 2) {
          var ovKwLast = ovKwClass[ovKwClass.length - 1];
          var ovKwFirst = ovKwClass[0];
          var ovLTotal = ovKwLast.brandPct + ovKwLast.genericPct;
          var ovFTotal = ovKwFirst.brandPct + ovKwFirst.genericPct;
          var ovLGenR = ovLTotal > 0 ? ovKwLast.genericPct / ovLTotal * 100 : 0;
          var ovFGenR = ovFTotal > 0 ? ovKwFirst.genericPct / ovFTotal * 100 : 0;
          var ovGenDiff = ovLGenR - ovFGenR;
          items.push('<span class="tag tag-info">🏷️</span>' +
            '키워드 구성: 브랜드 <strong style="color:#e87040">' + (100 - ovLGenR).toFixed(0) + '%</strong> / 일반 <strong style="color:#3b82f6">' + ovLGenR.toFixed(0) + '%</strong>' +
            (Math.abs(ovGenDiff) > 1 ? (ovGenDiff > 0 ? ' (일반 ▲ — 자연 유입 증가 추세)' : ' (일반 ▼ — 브랜드 의존도 증가)') : ''));
        }
      }
    }

    // 4. 종합 진단 & 제언
    items.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.15);margin:8px 0">');
    items.push('<span class="tag tag-warn">🎯</span><strong>종합 진단 및 제언</strong>');

    var recs = [];
    if (hasPlace) {
      var avgCvrFinal = 0;
      pr.forEach(function (r) { avgCvrFinal += pn(r['전환율']); });
      avgCvrFinal /= pr.length;
      if (avgCvrFinal < 5) recs.push('전환율이 낮습니다. 플레이스 프로필(사진/메뉴/혜택)을 보강해 전환율 개선을 권장합니다.');
      else if (avgCvrFinal > 10) recs.push('전환율이 우수합니다. 현재 플레이스 운영 전략을 유지하세요.');

      if (pr.length >= 4) {
        var rInf = 0, oInf2 = 0, rn2 = Math.min(3, pr.length), on2 = pr.length - rn2;
        for (var i2 = pr.length - rn2; i2 < pr.length; i2++) rInf += pn(pr[i2]['유입']);
        for (var j2 = 0; j2 < pr.length - rn2; j2++) oInf2 += pn(pr[j2]['유입']);
        rInf /= rn2; oInf2 /= Math.max(on2, 1);
        if (oInf2 > 0 && rInf < oInf2 * 0.9) recs.push('유입이 감소 추세입니다. 키워드 SEO와 블로그/리뷰 활동을 강화하세요.');
      }
    }

    if (hasSales && sAvg) {
      if (sAvg.avgPtPct < 40) recs.push('PT 비중이 낮습니다. PT 프로모션과 체험 이벤트를 통해 PT 매출 확대를 고려하세요.');
      if (sAvg.avgPtPct > 60) recs.push('PT 의존도가 높습니다. FC 상품 라인업 확대로 안정적 수익 구조를 만드세요.');
      if (sAvg.newRev > 0 && sAvg.avgNewPct < 25) recs.push('신규 유치 비중이 낮습니다. 마케팅 투자와 체험 프로그램을 확대하세요.');
      if (sAvg.newRev > 0 && sAvg.avgNewPct > 50) recs.push('신규 유치가 활발하지만 재등록률 관리도 중요합니다. 기존 회원 리텐션 프로그램을 점검하세요.');
    }

    if (hasPlace && hasSales) {
      recs.push('플레이스 유입과 실매출 간의 연결 고리를 강화하세요. 온라인 유입 → 방문 → 결제 퍼널을 정기적으로 모니터링하는 것을 권장합니다.');
    }

    if (!recs.length) recs.push('데이터가 충분히 쌓이면 더 정확한 분석과 제언이 가능합니다.');

    recs.forEach(function (r) {
      items.push('<span class="tag tag-info">💡</span>' + r);
    });

    var html = '<div class="insights-card"><h3>🤖 Formula X AI 종합 인사이트</h3>';
    items.forEach(function (item) {
      if (item.indexOf('<hr') === 0) html += item;
      else html += '<div class="insight-item">' + item + '</div>';
    });
    html += '</div>';
    document.getElementById('overview-insights').innerHTML = html;
  }

  // 종합 대시보드 지점 선택 변경 시 재렌더
  document.getElementById('sel-overview-branch').addEventListener('change', function () {
    renderOverview();
  });

  // 종합 대시보드 탭 전환 시 자동 업데이트
  document.querySelectorAll('.nav-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      if (tab.dataset.tab === 'overview') renderOverview();
    });
  });

  // 초기 렌더링 (데이터 로드 후)
  setTimeout(renderOverview, 500);

})();
