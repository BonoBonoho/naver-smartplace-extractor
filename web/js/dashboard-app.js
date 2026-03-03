// ============================================================
// Formula X Cloud - Dashboard App
// ============================================================

var Dashboard = (function () {
  'use strict';

  var _profile = null;
  var _branches = [];
  var _currentBranch = '__all__';
  var _currentTab = 'overview';
  var _renderVersion = 0;
  var _eventsBound = false;
  var _hasInited = false;
  var _overviewRangePreset = '30d';
  var _overviewFromDate = '';
  var _overviewToDate = '';
  var _overviewCacheKey = '';
  var _overviewCacheData = null;
  var _overviewCachePromise = null;
  var _overviewCachePromiseKey = '';
  var _branchGroups = {};
  var _branchIdToGroupValue = {};
  var _salesTargetSelectedMonth = ''; // YYYY-MM, 빈 값이면 당월
  var _activitySelectedMonth = ''; // YYYY-MM, 활동 실적 탭 월
  var _goalAchievementSelectedMonth = ''; // YYYY-MM, 목표 달성율 탭 월
  var _formulaQueryService = null;
  var SALES_PT = '#e87040';
  var SALES_FC = '#3b82f6';
  var SALES_NEW = '#22c55e';
  var SALES_RE = '#a855f7';

  function isRenderActive(renderVersion) {
    return renderVersion === _renderVersion;
  }

  function getFormulaQueryService() {
    if (_formulaQueryService) return _formulaQueryService;
    var formulaApi = (typeof DataGateway !== 'undefined' && DataGateway.create) ? DataGateway.create().formula : FX;
    if (typeof FormulaQueryService !== 'undefined' && FormulaQueryService.create) {
      _formulaQueryService = FormulaQueryService.create(formulaApi);
      return _formulaQueryService;
    }
    _formulaQueryService = {
      getPlaceBundle: async function (branchIds) {
        var ids = branchIds || [];
        var weekly = [];
        var channels = [];
        var keywords = [];
        for (var i = 0; i < ids.length; i++) {
          weekly = weekly.concat(await formulaApi.getPlaceWeekly(ids[i]));
          channels = channels.concat(await formulaApi.getPlaceChannels(ids[i]));
          keywords = keywords.concat(await formulaApi.getPlaceKeywords(ids[i]));
        }
        return { weekly: weekly, channels: channels, keywords: keywords, byBranch: {} };
      },
      listBranchDailyActivities: function (branchIds, fromDate, toDate) {
        return formulaApi.listBranchDailyActivities(branchIds, fromDate, toDate);
      },
      listBranchMonthlyActivityTargets: function (branchIds, month) {
        return formulaApi.listBranchMonthlyActivityTargets(branchIds, month);
      },
      listBranchWeeklyTargets: function (branchIds, fromDate, toDate) {
        return formulaApi.listBranchWeeklyTargets(branchIds, fromDate, toDate);
      },
      getSalesAggregated: function (branchIds, fromStr, toStr, options) {
        return formulaApi.getSalesAggregated(branchIds, fromStr, toStr, options || {});
      },
      getSalesByBranchBatch: async function (branchIds, fromStr, toStr, options) {
        var byBranch = {};
        for (var i = 0; i < (branchIds || []).length; i++) {
          var id = branchIds[i];
          var agg = await formulaApi.getSalesAggregated([id], fromStr, toStr, options || {});
          byBranch[id] = { weekly: (agg && agg.weekly) || [], monthly: (agg && agg.monthly) || [] };
        }
        return { byBranch: byBranch };
      },
      getOverviewBaseData: async function (branchIds, options) {
        var rows = await formulaApi.getAllSalesRecords(branchIds, '2000-01-01', '2100-12-31', options || {});
        var bundle = await this.getPlaceBundle(branchIds || []);
        return { placeWeeklyAll: bundle.weekly || [], salesRowsAll: rows || [] };
      },
      prefetchMonthBundle: function () { return Promise.resolve(true); },
      createStatsSnapshot: function () { return { requests: 0, hits: 0, misses: 0 }; },
      diffStatsSnapshot: function () { return { request_count: 0, cache_hit_count: 0, cache_miss_count: 0, cache_hit_ratio: 0 }; },
      invalidateAll: function () {},
      invalidateByMetric: function () {},
      invalidateByBranch: function () {}
    };
    return _formulaQueryService;
  }

  function perfNow() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
    return Date.now();
  }

  function createTabPerfContext(tabKey, branchIds) {
    var svc = getFormulaQueryService();
    return {
      tab: tabKey,
      branch_count: (branchIds || []).length,
      startedAt: perfNow(),
      before: svc ? svc.createStatsSnapshot() : null
    };
  }

  function flushTabPerfContext(ctx) {
    if (!ctx) return;
    var svc = getFormulaQueryService();
    var elapsed = Math.max(0, Math.round(perfNow() - (ctx.startedAt || perfNow())));
    var delta = svc && ctx.before ? svc.diffStatsSnapshot(ctx.before) : {
      request_count: 0,
      cache_hit_count: 0,
      cache_hit_ratio: 0
    };
    console.info('[FormulaX][perf]', {
      tab: ctx.tab,
      load_ms: elapsed,
      request_count: delta.request_count || 0,
      cache_hit_ratio: Math.round(((delta.cache_hit_ratio || 0) * 1000)) / 10,
      branch_count: ctx.branch_count
    });
  }

  function toYYYYMMDDLocal(d) {
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  function toYYYYMMLocal(d) {
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    return y + '-' + (m < 10 ? '0' + m : m);
  }

  function getMondayOfWeekLocal(d) {
    var date = new Date(d);
    var day = date.getDay();
    var diff = date.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(date.getFullYear(), date.getMonth(), diff);
  }

  function getMonthRangeInfo(yyyyMm) {
    var now = new Date();
    var ym = String(yyyyMm || '').trim() || toYYYYMMLocal(now);
    var year = parseInt(ym.slice(0, 4), 10);
    var monthNum = parseInt(ym.slice(5, 7), 10);
    var firstDay = new Date(year, monthNum - 1, 1);
    var lastDay = new Date(year, monthNum, 0);
    var firstDayMinus3 = new Date(firstDay.getTime());
    firstDayMinus3.setDate(firstDayMinus3.getDate() - 3);
    var fromMonday = getMondayOfWeekLocal(firstDayMinus3);
    var toMonday = getMondayOfWeekLocal(lastDay);
    return {
      month: ym,
      firstDay: firstDay,
      lastDay: lastDay,
      monthFirstStr: toYYYYMMDDLocal(firstDay),
      monthLastStr: toYYYYMMDDLocal(lastDay),
      targetFromStr: toYYYYMMDDLocal(fromMonday),
      targetToStr: toYYYYMMDDLocal(toMonday)
    };
  }

  function prefetchFormulaMonthData(renderVersion) {
    if (!isRenderActive(renderVersion)) return;
    if (!(_currentTab === 'sales_target' || _currentTab === 'goal_achievement' || _currentTab === 'activity')) return;
    var branchIds = getSelectedBranchIds();
    if (!branchIds.length) return;
    var month = _goalAchievementSelectedMonth || _salesTargetSelectedMonth || _activitySelectedMonth || toYYYYMMLocal(new Date());
    var range = getMonthRangeInfo(month);
    var svc = getFormulaQueryService();
    if (!svc || !svc.prefetchMonthBundle) return;
    svc.prefetchMonthBundle({
      branchIds: branchIds,
      month: range.month,
      monthFirstStr: range.monthFirstStr,
      monthLastStr: range.monthLastStr,
      targetFromStr: range.targetFromStr,
      targetToStr: range.targetToStr,
      salesOptions: {}
    }).catch(function (e) {
      console.warn('월 기준 프리패치 실패:', e && e.message ? e.message : e);
    });
  }

  function normalizeBranchNameForGrouping(name) {
    return String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^0-9a-z가-힣]+/g, '')
      .replace(/(지점|점)$/g, '');
  }

  function normalizePlaceUrlForGrouping(url) {
    var s = String(url || '').trim().toLowerCase();
    if (!s) return '';
    s = s.replace(/^https?:\/\//, '');
    s = s.replace(/^www\./, '');
    s = s.replace(/[?#].*$/, '');
    s = s.replace(/\/+$/, '');
    return s;
  }

  function getBranchGroupKey(b) {
    if (!b) return '';
    // 동명이점 병합 시 서버(041)는 지점명만으로 그룹. 클라이언트도 지점명만 사용해야 구영점 등 2배 합산 방지.
    return 'name::' + normalizeBranchNameForGrouping(b.name || '');
  }

  /** 현재 달이 아직 안 지났으면 { isPartial: true, periodLabel, daysElapsed, daysInMonth, noteForAI } 반환. 아니면 { isPartial: false } */
  function getPartialMonthInfo(periodYYYYMM) {
    if (!periodYYYYMM || periodYYYYMM.length < 7) return { isPartial: false };
    var now = new Date();
    var y = now.getFullYear();
    var m = now.getMonth() + 1;
    var current = y + '-' + String(m).padStart(2, '0');
    if (periodYYYYMM !== current) return { isPartial: false };
    var daysInMonth = new Date(y, m, 0).getDate();
    var dayToday = now.getDate();
    var periodLabel = m + '월(' + dayToday + '일까지 기준, 진행 중)';
    var noteForAI = '현재 월(' + periodYYYYMM + ')은 아직 종료되지 않았습니다. 위 월별 데이터 중 해당 월은 ' + dayToday + '일까지의 부분 기간(일할) 기준이므로, 전월 전체와 비교할 때 일할/부분 기준으로 해석하여 조언해 주세요. 해당 월을 28일/30일/31일 전체로 가정하지 마세요.';
    return { isPartial: true, periodLabel: periodLabel, daysElapsed: dayToday, daysInMonth: daysInMonth, noteForAI: noteForAI };
  }

  function rebuildBranchGroups() {
    _branchGroups = {};
    _branchIdToGroupValue = {};
    (_branches || []).forEach(function (b) {
      if (!b || !b.id) return;
      var label = String(b.name || '이름없음').replace(/\s+/g, ' ').trim() || '이름없음';
      // 우선순위: place_url 기준 병합, 없으면 정규화 지점명 기준
      var key = getBranchGroupKey(b) || String(b.id);
      var groupValue = '__grp__:' + key;
      if (!_branchGroups[groupValue]) {
        _branchGroups[groupValue] = { value: groupValue, name: label, ids: [] };
      }
      if (_branchGroups[groupValue].ids.indexOf(b.id) < 0) {
        _branchGroups[groupValue].ids.push(b.id);
      }
      _branchIdToGroupValue[b.id] = groupValue;
    });
  }

  function getGroupedBranchOptions() {
    if (!_branchGroups || !Object.keys(_branchGroups).length) rebuildBranchGroups();
    return Object.keys(_branchGroups)
      .sort(function (a, b) {
        return String(_branchGroups[a].name).localeCompare(String(_branchGroups[b].name), 'ko');
      })
      .map(function (k) { return _branchGroups[k]; });
  }

  function buildBranchNameMapById(branchIds) {
    var allowed = null;
    if (Array.isArray(branchIds) && branchIds.length) {
      allowed = {};
      branchIds.forEach(function (id) { allowed[id] = true; });
    }
    var map = {};
    (_branches || []).forEach(function (b) {
      if (!b || !b.id) return;
      if (allowed && !allowed[b.id]) return;
      map[b.id] = getBranchGroupKey(b);
    });
    return map;
  }

  function needsSalesDedupForBranchIds(branchIds) {
    var nameMap = {};
    (branchIds || []).forEach(function (id) {
      var b = (_branches || []).find(function (x) { return x.id === id; });
      var n = getBranchGroupKey(b);
      if (!n) return;
      nameMap[n] = (nameMap[n] || 0) + 1;
    });
    return Object.keys(nameMap).some(function (k) { return nameMap[k] > 1; });
  }

  function buildSalesRowDedupKey(r, normalizedBranchName) {
    var paymentDateRaw = String(r && r.payment_date ? r.payment_date : '').trim();
    var paymentDate = paymentDateRaw ? paymentDateRaw.slice(0, 10) : '';
    var productName = String(r && r.product_name ? r.product_name : '').trim().toLowerCase();
    var amount = String(parseInt((r && r.amount) || 0, 10) || 0);
    var productType = String(r && r.product_type ? r.product_type : '').trim().toUpperCase();
    var memberName = String(r && r.member_name ? r.member_name : '').trim().toLowerCase();
    return [normalizedBranchName || '', paymentDate, productName, amount, productType, memberName].join('|');
  }

  function dedupeSalesRecordsByMergedBranch(records, branchIds) {
    var branchNameMap = buildBranchNameMapById(branchIds);
    var map = new Map();
    (records || []).forEach(function (r) {
      if (!r) return;
      var normalizedBranchName = branchNameMap[r.branch_id] || '';
      var key = buildSalesRowDedupKey(r, normalizedBranchName);
      if (!map.has(key)) {
        map.set(key, r);
      } else {
        var prev = map.get(key);
        var prevTs = prev && prev.created_at ? Date.parse(prev.created_at) : 0;
        var currTs = r && r.created_at ? Date.parse(r.created_at) : 0;
        if (currTs >= prevTs) map.set(key, r);
      }
    });
    return Array.from(map.values());
  }

  /** 플레이스 동명 그룹 선택 시 같은 week_key(또는 week_key+channel/keyword)가 여러 branch로 있으면 2배 합산되므로, 키별 1건만 유지(updated_at 최신) */
  function dedupePlaceRowsByKey(rows, keyField1, keyField2) {
    if (!rows || !rows.length) return rows;
    var map = new Map();
    rows.forEach(function (r) {
      if (!r) return;
      var k = String(r[keyField1] || '');
      if (keyField2) k += '\0' + String(r[keyField2] || '');
      var ts = r.updated_at ? Date.parse(r.updated_at) : 0;
      if (!map.has(k) || (map.get(k).updated_at ? Date.parse(map.get(k).updated_at) : 0) < ts) map.set(k, r);
    });
    return Array.from(map.values());
  }

  function shouldDedupForCurrentGroup(branchIds) {
    var ids = branchIds || [];
    if (!ids.length) return false;
    if (_currentBranch === '__all__') {
      // 전체 통합에서도 동명이점(중복 branch_id) 존재 시 dedup 적용
      return needsSalesDedupForBranchIds(ids);
    }
    return String(_currentBranch).indexOf('__grp__:') === 0 && ids.length > 1;
  }

  function getSelectedLogicalBranchCount(selectedIds) {
    var ids = selectedIds || [];
    if (!ids.length) return 0;
    if (_currentBranch === '__all__') return getGroupedBranchOptions().length;
    if (String(_currentBranch).indexOf('__grp__:') === 0) return 1;
    return 1;
  }

  function getLogicalBranchCountFromRecords(records, selectedIds) {
    var branchKeyMap = buildBranchNameMapById(selectedIds || []);
    var seen = {};
    (records || []).forEach(function (r) {
      if (!r || !r.branch_id) return;
      var k = branchKeyMap[r.branch_id];
      if (!k) return;
      seen[k] = true;
    });
    return Object.keys(seen).length;
  }

  function sumSalesAmount(records) {
    return (records || []).reduce(function (sum, r) {
      return sum + (parseInt((r && r.amount) || 0, 10) || 0);
    }, 0);
  }

  function renderSalesValidationBadge(rawRecords, dedupRecords) {
    var rawCnt = (rawRecords || []).length;
    var dedupCnt = (dedupRecords || []).length;
    var dupCnt = Math.max(rawCnt - dedupCnt, 0);
    var rawAmt = sumSalesAmount(rawRecords);
    var dedupAmt = sumSalesAmount(dedupRecords);
    var deltaAmt = rawAmt - dedupAmt;
    return '<div class="card" style="margin-bottom:12px;background:#f8fafc;border:1px solid #e2e8f0;">' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
      '<span class="sales-chip chip-member">원본 행수 ' + fmtNum(rawCnt) + '</span>' +
      '<span class="sales-chip chip-member">중복제거 행수 ' + fmtNum(dedupCnt) + '</span>' +
      '<span class="sales-chip ' + (dupCnt > 0 ? 'chip-re' : 'chip-new') + '">제거 행수 ' + fmtNum(dupCnt) + '</span>' +
      '<span class="sales-chip chip-pt">원본 매출 ' + fmtNum(rawAmt) + '</span>' +
      '<span class="sales-chip chip-fc">검증 매출 ' + fmtNum(dedupAmt) + '</span>' +
      '<span class="sales-chip ' + (deltaAmt > 0 ? 'chip-re' : 'chip-new') + '">차이 ' + fmtNum(deltaAmt) + '</span>' +
      '</div>' +
      '<div style="margin-top:6px;font-size:11px;color:#64748b;">검증 기준: 브랜드+지점명, 결제일, 상품명, 금액, 상품유형, 회원명 (customer_type/file_source 제외)</div>' +
      '</div>';
  }

  // ── 초기화 ──
  async function init(profile, options) {
    if (typeof ModeStore !== 'undefined' && ModeStore.getMode() === ModeStore.MODE_BEMOVE) return;
    _profile = profile;
    getFormulaQueryService();

    // 슈퍼 관리자 'FC로 보기' 시 강제 지점 목록 사용
    if (options && options.forceBranches && Array.isArray(options.forceBranches) && options.forceBranches.length) {
      _branches = options.forceBranches;
      populateBranchSelector();
      var hasCurrent = _branches.some(function (b) { return b.id === profile.branch_id; });
      _currentBranch = hasCurrent ? profile.branch_id : (_branches[0] ? _branches[0].id : '__all__');
      var sel = document.getElementById('sel-branch-global');
      if (sel) sel.value = _currentBranch;
      document.getElementById('branch-selector').style.display = _branches.length > 1 ? 'flex' : 'none';
    }
    // 지점 목록 로드 (슈퍼 먼저 검사 → 플랫폼 관리자는 항상 전체 브랜드/지점)
    else if (profile.role === 'super') {
      // 플랫폼 관리자: 모든 브랜드·모든 지점 선택 가능 (brandId 없이 전체 조회)
      _branches = await FX.listBranches();
      populateBranchSelector();
      document.getElementById('branch-selector').style.display = 'flex';
    } else if (profile.role === 'branch' || profile.role === 'fc') {
      // 지점장: branch_managers 기준으로 본인 배정 지점만 조회
      try {
        _branches = await FX.listMyManagedBranches();
      } catch (e) {
        _branches = [];
      }
      // 호환 fallback: 매핑 데이터가 없으면 기존 조회 경로 사용
      if (!_branches.length) {
        _branches = await FX.listBranches();
      }
      if (!_branches.length && profile.branch_id) {
        _branches = [{ id: profile.branch_id, name: profile.branches ? profile.branches.name : '내 지점' }];
      }
      populateBranchSelector();
      var hasCurrent = _branches.some(function (b) { return b.id === profile.branch_id; });
      _currentBranch = hasCurrent ? profile.branch_id : (_branches[0] ? _branches[0].id : '__all__');
      var sel = document.getElementById('sel-branch-global');
      if (sel) sel.value = _currentBranch;
      document.getElementById('branch-selector').style.display = _branches.length > 1 ? 'flex' : 'none';
    } else {
      // 브랜드 관리자: profile.brand_id 또는 소유 브랜드로 전체 지점 조회
      var brandId = profile.brand_id || (await FX.getBrandIdByOwner()) || undefined;
      _branches = await FX.listBranches(brandId);
      // 지점 0건이면 필터 없이 한 번 더 시도 (RLS 049로 소유 브랜드 지점만 노출)
      if (profile.role === 'brand' && (!_branches || _branches.length === 0)) {
        _branches = await FX.listBranches();
      }
      populateBranchSelector();
      document.getElementById('branch-selector').style.display = 'flex';
    }

    // 이벤트 바인딩은 한 번만
    if (!_eventsBound) {
      var selBranch = document.getElementById('sel-branch-global');
      if (selBranch) {
        selBranch.addEventListener('change', function () {
          var next = selBranch.value;
          if (_currentBranch === next) return;
          _currentBranch = next;
          renderCurrentTab();
        });
      }

      var addBranchBtn = document.getElementById('btn-add-branch');
      if (addBranchBtn) {
        addBranchBtn.addEventListener('click', showAddBranchDialog);
      }
      _eventsBound = true;
    }

    if (!_hasInited) {
      _hasInited = true;
      var accountingManagerOnly = _profile && (_profile.role === 'brand_accounting' || (_profile.role !== 'super' && _profile.brands && _profile.id && _profile.brands.accounting_manager_id === _profile.id));
      switchTab(accountingManagerOnly ? 'expenses' : 'overview');
    } else {
      renderCurrentTab();
    }
  }

  function populateBranchSelector() {
    var sel = document.getElementById('sel-branch-global');
    var prev = _currentBranch;
    rebuildBranchGroups();
    sel.innerHTML = '<option value="__all__">전체 통합</option>';
    getGroupedBranchOptions().forEach(function (g) {
      sel.innerHTML += '<option value="' + g.value + '">' + esc(g.name) + '</option>';
    });
    var mappedPrev = _branchIdToGroupValue[prev] || prev;
    var valid = (mappedPrev === '__all__') || !!_branchGroups[mappedPrev];
    _currentBranch = valid ? mappedPrev : '__all__';
    sel.value = _currentBranch;
  }

  function updateGlobalBranchSelectorVisibility() {
    var wrap = document.getElementById('branch-selector');
    if (!wrap || !_profile) return;
    var monthWrap = document.getElementById('goal-achievement-month-wrap');
    var salesPeriodWrap = document.getElementById('sales-period-wrap');
    var branchLabel = document.getElementById('branch-selector-label');
    if (_currentTab === 'sales') {
      wrap.style.display = ((_profile.role === 'branch' || _profile.role === 'fc') && _branches && _branches.length <= 1) ? 'none' : 'flex';
      if (branchLabel) branchLabel.textContent = '지점 보기';
      if (monthWrap) monthWrap.style.display = 'none';
      if (salesPeriodWrap) salesPeriodWrap.style.display = 'flex';
      return;
    }
    if (branchLabel) branchLabel.textContent = '지점 선택';
    if (salesPeriodWrap) salesPeriodWrap.style.display = 'none';
    if (_profile.role === 'branch' || _profile.role === 'fc') {
      wrap.style.display = (_branches && _branches.length > 1) ? 'flex' : 'none';
    } else {
      wrap.style.display = 'flex';
    }
    if (monthWrap) monthWrap.style.display = _currentTab === 'goal_achievement' ? 'flex' : 'none';
  }

  // ── 탭 전환 ──
  function switchTab(tabName, options) {
    if (typeof ModeStore !== 'undefined' && ModeStore.getMode() === ModeStore.MODE_BEMOVE) return;
    var force = !!(options && options.force);
    if (!force && _currentTab === tabName) return;
    _currentTab = tabName;
    renderCurrentTab();
  }

  async function renderCurrentTab() {
    var container = document.getElementById('tab-content');
    var renderVersion = ++_renderVersion;
    updateGlobalBranchSelectorVisibility();
    prefetchFormulaMonthData(renderVersion);

    var accountingManagerOnly = _profile && (_profile.role === 'brand_accounting' || (_profile.role !== 'super' && _profile.brands && _profile.id && _profile.brands.accounting_manager_id === _profile.id));
    if (accountingManagerOnly && _currentTab !== 'expenses' && _currentTab !== 'profit' && _currentTab !== 'refunds') {
      _currentTab = 'expenses';
      document.querySelectorAll('.nav-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === _currentTab); });
    }

    switch (_currentTab) {
      case 'overview':
        if (!isRenderActive(renderVersion)) return;
        await renderOverviewTab(container, renderVersion);
        break;
      case 'place':
        if (!isRenderActive(renderVersion)) return;
        container.innerHTML = '<div class="text-center text-muted" style="padding:40px">플레이스 데이터를 불러오는 중...</div>';
        await renderPlaceTab(container, renderVersion);
        break;
      case 'sales':
        if (!isRenderActive(renderVersion)) return;
        await renderSalesTab(container, renderVersion);
        break;
      case 'profit':
        if (!isRenderActive(renderVersion)) return;
        await renderProfitTab(container, renderVersion);
        break;
      case 'expenses':
        if (!isRenderActive(renderVersion)) return;
        await renderExpensesTab(container, renderVersion);
        break;
      case 'refunds':
        if (!isRenderActive(renderVersion)) return;
        await renderRefundsTab(container, renderVersion);
        break;
      case 'sales_target':
        if (!isRenderActive(renderVersion)) return;
        await renderSalesTargetTab(container, renderVersion);
        break;
      case 'activity':
        if (!isRenderActive(renderVersion)) return;
        await renderActivityTab(container, renderVersion);
        break;
      case 'goal_achievement':
        if (!isRenderActive(renderVersion)) return;
        await renderGoalAchievementTab(container, renderVersion);
        break;
      default:
        if (!isRenderActive(renderVersion)) return;
        container.innerHTML = '<div class="empty-state"><div class="icon">🔧</div><h3>준비 중</h3></div>';
    }
  }

  // ── 종합 탭 ──
  async function renderOverviewTab(container, renderVersion) {
    if (!isRenderActive(renderVersion)) return;
    var branchIds = getSelectedBranchIds();
    if (!branchIds.length) {
      if (!isRenderActive(renderVersion)) return;
      container.innerHTML = emptyState('📊', '지점을 추가해주세요', '설정에서 지점을 추가하면 데이터를 확인할 수 있습니다.');
      return;
    }

    var branchKey = getOverviewBranchKey(branchIds);
    var hasOverviewRendered = !!container.querySelector('.overview-root');
    if ((_overviewCacheKey !== branchKey || !_overviewCacheData) && !hasOverviewRendered) {
      container.innerHTML = '<div class="text-center text-muted" style="padding:40px">종합 데이터를 불러오는 중...</div>';
    }
    var baseData = await ensureOverviewBaseData(branchIds);
    if (!isRenderActive(renderVersion)) return;

    var dateRange = getOverviewDateRange();
    var fromStr = dateRange.fromStr;
    var toStr = dateRange.toStr;

    // 1) 플레이스 + 매출 데이터 (캐시) + 기간 필터
    var allPlaceWeekly = (baseData.placeWeeklyAll || []).filter(function (r) {
      var wk = weekStartFromKey(r.week_key);
      return wk >= fromStr && wk <= toStr;
    });

    var salesWeekly = filterWeeklyRowsByDateRange((baseData.salesAggAll && baseData.salesAggAll.weekly) ? baseData.salesAggAll.weekly : [], fromStr, toStr);
    var salesMonthly = filterMonthlyRowsByDateRange((baseData.salesAggAll && baseData.salesAggAll.monthly) ? baseData.salesAggAll.monthly : [], fromStr, toStr);
    var hasPlace = allPlaceWeekly.length > 0;
    var hasSales = salesWeekly.length > 0 || salesMonthly.length > 0;

    if (!hasPlace && !hasSales) {
      if (!isRenderActive(renderVersion)) return;
      container.innerHTML = emptyState('📊', '데이터가 없습니다', '플레이스/매출 데이터를 업로드하면 종합 인사이트가 표시됩니다.');
      return;
    }

    // 2) 주차별 교차 집계 (플레이스 × 매출)
    var crossByWeek = {};
    allPlaceWeekly.forEach(function (r) {
      var wk = weekStartFromKey(r.week_key);
      if (!crossByWeek[wk]) crossByWeek[wk] = { week: wk, inflow: 0, orders: 0, reviews: 0, pt: 0, fc: 0, sales: 0 };
      crossByWeek[wk].inflow += parseInt(r.inflow || 0, 10) || 0;
      crossByWeek[wk].orders += parseInt(r.orders || 0, 10) || 0;
      crossByWeek[wk].reviews += parseInt(r.reviews || 0, 10) || 0;
    });
    salesWeekly.forEach(function (r) {
      var wk2 = weekStartFromKey(r.period || '');
      if (!crossByWeek[wk2]) crossByWeek[wk2] = { week: wk2, inflow: 0, orders: 0, reviews: 0, pt: 0, fc: 0, sales: 0 };
      crossByWeek[wk2].pt += parseInt(r.PT || 0, 10) || 0;
      crossByWeek[wk2].fc += parseInt(r.FC || 0, 10) || 0;
      crossByWeek[wk2].sales += parseInt(r.매출 || 0, 10) || 0;
    });
    var crossWeeks = Object.keys(crossByWeek).sort();
    var crossRows = crossWeeks.map(function (k) { return crossByWeek[k]; });

    // 3) 총합 KPI
    var totalInflow = 0, totalOrders = 0, totalReviews = 0;
    crossRows.forEach(function (r) {
      totalInflow += r.inflow;
      totalOrders += r.orders;
      totalReviews += r.reviews;
    });
    var sumMonthly = summarizeSalesRows(salesMonthly);
    var totalSales = sumMonthly.total || 0;
    var ptShare = sumMonthly.ptShare || 0;
    var fcShare = sumMonthly.fcShare || 0;
    var newShare = sumMonthly.nwShare || 0;
    var reShare = sumMonthly.reShare || 0;
    var memberCnt = salesMonthly.length ? parseInt((salesMonthly[salesMonthly.length - 1].회원수 || 0), 10) || 0 : 0;
    var conversion = totalInflow > 0 ? (totalOrders / totalInflow * 100) : 0;
    var reviewConv = totalOrders > 0 ? (totalReviews / totalOrders * 100) : 0;
    var reviewFromInflow = totalInflow > 0 ? (totalReviews / totalInflow * 100) : 0;
    var revisitRate = (sumMonthly.nw + sumMonthly.re) > 0 ? (sumMonthly.re / (sumMonthly.nw + sumMonthly.re) * 100) : 0;

    var selectedLabel = _currentBranch === '__all__' ? '전체 통합' : getBranchNameById(_currentBranch);
    var latestMonth = salesMonthly.length ? salesMonthly[salesMonthly.length - 1] : null;
    var prevMonth = salesMonthly.length > 1 ? salesMonthly[salesMonthly.length - 2] : null;
    var salesChg = (latestMonth && prevMonth && prevMonth.매출) ? ((latestMonth.매출 - prevMonth.매출) / prevMonth.매출 * 100) : null;
    var convTrend = crossRows.length > 5 ? ((crossRows.slice(-3).reduce(function (a, b) { return a + (b.inflow > 0 ? b.orders / b.inflow * 100 : 0); }, 0) / 3) - (crossRows.slice(-6, -3).reduce(function (a, b) { return a + (b.inflow > 0 ? b.orders / b.inflow * 100 : 0); }, 0) / 3)) : 0;

    var maxPt = 0, maxFc = 0;
    crossRows.forEach(function (r) {
      if (r.pt > maxPt) maxPt = r.pt;
      if (r.fc > maxFc) maxFc = r.fc;
    });

    // 4) 화면 렌더
    var html = '<div class="overview-root">';
    html += '<div class="card"><h3 class="table-title">🧠 Formula X AI 종합 인사이트</h3>';
    html += '<p class="text-muted" style="margin-top:-6px;">플레이스 + 매출 통합 분석 (' + esc(selectedLabel) + ')</p></div>';
    html += '<div class="card overview-filter-card">';
    html += '<div class="overview-filter-row">';
    html += '<label>기간</label>';
    html += '<select id="sel-overview-range">';
    html += '<option value="7d"' + (_overviewRangePreset === '7d' ? ' selected' : '') + '>최근 7일</option>';
    html += '<option value="30d"' + (_overviewRangePreset === '30d' ? ' selected' : '') + '>최근 30일</option>';
    html += '<option value="this_month"' + (_overviewRangePreset === 'this_month' ? ' selected' : '') + '>이번달</option>';
    html += '<option value="last_month"' + (_overviewRangePreset === 'last_month' ? ' selected' : '') + '>저번달</option>';
    html += '<option value="90d"' + (_overviewRangePreset === '90d' ? ' selected' : '') + '>최근 90일</option>';
    html += '<option value="custom"' + (_overviewRangePreset === 'custom' ? ' selected' : '') + '>직접 설정</option>';
    html += '<option value="all"' + (_overviewRangePreset === 'all' ? ' selected' : '') + '>전체 기간</option>';
    html += '</select>';
    html += '<input type="text" id="overview-date-range" value="' + esc(dateRange.fromInput + ' ~ ' + dateRange.toInput) + '" placeholder="기간 선택" readonly' + (_overviewRangePreset === 'custom' ? '' : ' disabled') + '>';
    html += '<span class="text-muted">적용 범위: ' + esc(fromStr) + ' ~ ' + esc(toStr) + '</span>';
    html += '</div></div>';

    html += '<div class="kpi-grid">';
    html += kpiCard('총 매출 (' + selectedLabel + ')', fmtNum(totalSales), salesChg == null ? '비교 데이터 부족' : (salesChg >= 0 ? '▲ ' : '▼ ') + Math.abs(salesChg).toFixed(1) + '% (전월 대비)');
    html += kpiCard('FC 비중 (' + selectedLabel + ')', fcShare.toFixed(1) + '%', 'PT ' + ptShare.toFixed(1) + '% / FC ' + fcShare.toFixed(1) + '%');
    html += kpiCard('신규 비중 (' + selectedLabel + ')', newShare.toFixed(1) + '%', '신규 ' + fmtNum(sumMonthly.nw) + ' / 재등록 ' + fmtNum(sumMonthly.re));
    html += kpiCard('총 회원', fmtNum(memberCnt), latestMonth ? latestMonth.period + ' 기준' : '');
    html += kpiCard('전환율', conversion.toFixed(1) + '%', convTrend >= 0 ? '최근 추세 +' + convTrend.toFixed(1) + '%p' : '최근 추세 ' + convTrend.toFixed(1) + '%p');
    html += kpiCard('재등록율', revisitRate.toFixed(1) + '%', '재등록 비중');
    html += '</div>';

    var funnelOrderWidth = totalInflow > 0 ? Math.max(Math.min(conversion, 92), 44) : 44;
    var funnelReviewWidthRaw = totalInflow > 0 ? Math.max(Math.min(reviewFromInflow, 84), 30) : 30;
    var funnelReviewWidth = Math.max(Math.min(funnelReviewWidthRaw, funnelOrderWidth - 8), 24);
    html += '<div class="overview-snapshot-grid">';
    html += '<div class="card overview-funnel-card">';
    html += '<h3 class="table-title">📊 전환 퍼널 (' + esc(selectedLabel) + ')</h3>';
    html += '<div class="overview-funnel-stack">';
    html += '<div class="overview-funnel-track is-inflow"><span class="stage-label">유입</span><span class="stage-value">' + fmtNum(totalInflow) + '</span></div>';
    html += '<div class="overview-funnel-rate">▼ 유입→예약/주문 전환율 ' + conversion.toFixed(1) + '%</div>';
    html += '<div class="overview-funnel-track is-order" style="width:' + funnelOrderWidth.toFixed(1) + '%"><span class="stage-label">예약/주문</span><span class="stage-value">' + fmtNum(totalOrders) + '</span></div>';
    html += '<div class="overview-funnel-rate">▼ 예약/주문→리뷰 전환율 ' + reviewConv.toFixed(1) + '%</div>';
    html += '<div class="overview-funnel-track is-review" style="width:' + funnelReviewWidth.toFixed(1) + '%"><span class="stage-label">리뷰</span><span class="stage-value">' + fmtNum(totalReviews) + '</span></div>';
    html += '</div>';
    html += '</div>';

    html += '<div class="card overview-sales-card">';
    html += '<h3 class="table-title">💰 매출 구성 (' + esc(selectedLabel) + ')</h3>';
    html += '<div class="overview-sales-total"><div class="label">총 매출</div><div class="value">' + fmtNum(totalSales) + '</div></div>';
    html += '<div class="overview-sales-split">';
    html += '<div class="split-box"><div class="label">PT</div><div class="value">' + fmtNum(sumMonthly.pt) + '</div><div class="sub">' + ptShare.toFixed(1) + '%</div></div>';
    html += '<div class="split-box"><div class="label">FC</div><div class="value">' + fmtNum(sumMonthly.fc) + '</div><div class="sub">' + fcShare.toFixed(1) + '%</div></div>';
    html += '</div>';
    html += '<div class="overview-segment-title">PT / FC 비중</div>';
    html += '<div class="funnel-bar-row"><div style="width:' + ptShare.toFixed(1) + '%;background:' + SALES_PT + '">' + ptShare.toFixed(0) + '%</div><div style="width:' + fcShare.toFixed(1) + '%;background:' + SALES_FC + '">' + fcShare.toFixed(0) + '%</div></div>';
    html += '<div class="overview-segment-title">신규 / 재등록</div>';
    html += '<div class="funnel-bar-row"><div style="width:' + newShare.toFixed(1) + '%;background:' + SALES_NEW + '">' + newShare.toFixed(0) + '%</div><div style="width:' + reShare.toFixed(1) + '%;background:' + SALES_RE + '">' + reShare.toFixed(0) + '%</div></div>';
    html += '</div>';
    html += '</div>';

    html += '<div class="card"><h3 class="table-title">주간 플레이스 × 매출 (' + esc(selectedLabel) + ') 추이</h3>';
    if (!crossRows.length) {
      html += '<p class="text-muted">표시할 주간 데이터가 없습니다.</p>';
    } else {
      html += '<table class="sales-table"><thead><tr>';
      html += '<th style="text-align:left">주간</th><th>유입</th><th>예약/주문</th><th>전환율</th><th>리뷰</th><th style="color:#e87040">PT</th><th style="color:#3b82f6">FC</th>';
      html += '</tr></thead><tbody>';
      crossRows.slice(-24).forEach(function (r) {
        var cvr = r.inflow > 0 ? (r.orders / r.inflow * 100) : 0;
        html += '<tr>';
        html += '<td style="text-align:left;font-weight:600">' + esc(r.week) + '</td>';
        html += '<td>' + fmtNum(r.inflow) + '</td>';
        html += '<td>' + fmtNum(r.orders) + '</td>';
        html += '<td>' + cvr.toFixed(1) + '%</td>';
        html += '<td>' + fmtNum(r.reviews) + '</td>';
        html += '<td style="color:#e87040">' + salesAmountCell(r.pt || 0, maxPt || 1, 'pt') + '</td>';
        html += '<td style="color:#3b82f6">' + salesAmountCell(r.fc || 0, maxFc || 1, 'fc') + '</td>';
        html += '</tr>';
      });
      html += '<tr class="place-row-total">';
      html += '<td style="text-align:left">합계</td>';
      html += '<td>' + fmtNum(totalInflow) + '</td>';
      html += '<td>' + fmtNum(totalOrders) + '</td>';
      html += '<td>' + conversion.toFixed(1) + '%</td>';
      html += '<td>' + fmtNum(totalReviews) + '</td>';
      html += '<td style="color:#e87040">' + fmtNum(sumMonthly.pt) + '</td>';
      html += '<td style="color:#3b82f6">' + fmtNum(sumMonthly.fc) + '</td>';
      html += '</tr>';
      html += '</tbody></table>';
    }
    html += '</div>';

    var trendMsg = salesChg == null ? '비교 데이터 부족' : (salesChg >= 0 ? '상승세' : '하락세') + ' (전월 대비 ' + (salesChg >= 0 ? '+' : '-') + Math.abs(salesChg).toFixed(1) + '%)';
    var strengthList = [];
    var improveList = [];
    if (fcShare >= 55) strengthList.push('FC 중심 구조');
    if (conversion >= 5) strengthList.push('전환율');
    if (newShare >= 40) strengthList.push('신규 유치');
    if (salesChg != null && salesChg < -5) improveList.push('매출 트렌드');
    if (conversion < 4.5) improveList.push('전환율');
    if (newShare < 35) improveList.push('신규 유치');
    if (!improveList.length) improveList.push('PT 비중');

    html += '<div class="card insights-card"><h3 class="table-title">🤖 Formula X AI 종합 분석 (' + esc(selectedLabel) + ')</h3>';
    html += '<div class="insight-item"><span class="tag tag-info">📉</span> 매출 트렌드: <strong>' + esc(trendMsg) + '</strong></div>';
    html += '<div class="insight-item"><span class="tag tag-info">💼</span> 매출 구조: <strong>FC 중심</strong> (PT ' + ptShare.toFixed(1) + '% / FC ' + fcShare.toFixed(1) + '%)</div>';
    html += '<div class="insight-item"><span class="tag tag-info">🆕</span> 신규/재등록: <strong>' + (newShare >= 40 ? '양호' : '개선 필요') + '</strong> (신규 ' + newShare.toFixed(1) + '% / 재등록 ' + reShare.toFixed(1) + '%)</div>';
    html += '<hr style="border-color:rgba(255,255,255,0.12);margin:14px 0;">';
    html += '<div class="insight-item"><span class="tag tag-info">🎯</span> 강점: <strong style="color:#4ade80">' + esc(strengthList.length ? strengthList.join(', ') : '없음') + '</strong></div>';
    html += '<div class="insight-item"><span class="tag tag-warn">🛠</span> 개선 필요: <strong style="color:#f87171">' + esc(improveList.join(', ')) + '</strong></div>';
    html += '</div>';

    html += '<div class="card insights-card"><h3 class="table-title">🤖 Gemini AI 인사이트</h3>';
    html += '<p class="text-muted">종합(플레이스+매출) 요약을 바탕으로 AI가 인사이트를 생성합니다.</p>';
    html += '<div class="overview-ai-insight-block" style="margin-top:12px;min-height:40px;white-space:pre-wrap;line-height:1.5"></div>';
    html += '<button type="button" class="btn btn-primary overview-ai-insight-btn" style="margin-top:8px">AI 인사이트 생성</button>';
    html += '</div>';

    html += '</div>';
    if (!isRenderActive(renderVersion)) return;
    container.innerHTML = html;
    var overviewAiBlock = container.querySelector('.overview-ai-insight-block');
    var overviewAiBtn = container.querySelector('.overview-ai-insight-btn');
    if (overviewAiBlock && overviewAiBtn) {
      overviewAiBtn.addEventListener('click', function () {
        var endYYYYMM = (toStr && toStr.length >= 7) ? toStr.substring(0, 7) : '';
        var overviewPartial = getPartialMonthInfo(endYYYYMM);
        var summary = {
          label: selectedLabel,
          period: fromStr + ' ~ ' + toStr,
          totalSales: Math.round(totalSales),
          salesChgPct: salesChg != null ? Math.round(salesChg * 10) / 10 : null,
          ptShare: Math.round(ptShare * 10) / 10,
          fcShare: Math.round(fcShare * 10) / 10,
          newShare: Math.round(newShare * 10) / 10,
          reShare: Math.round(reShare * 10) / 10,
          conversion: Math.round(conversion * 10) / 10,
          totalInflow: totalInflow,
          totalOrders: totalOrders,
          totalReviews: totalReviews,
          memberCnt: memberCnt,
          weekly: crossRows.slice(-12).map(function (r) {
            return { week: r.week, inflow: r.inflow, orders: r.orders, conversion: r.inflow > 0 ? Math.round(r.orders / r.inflow * 1000) / 10 : 0, reviews: r.reviews, pt: r.pt || 0, fc: r.fc || 0 };
          })
        };
        if (overviewPartial.isPartial) {
          summary.currentMonthIncomplete = true;
          summary.currentMonthNote = overviewPartial.noteForAI;
        }
        invokeAInsight({ promptContext: '종합 대시보드 (플레이스+매출) 요약', summary: summary }, overviewAiBlock, overviewAiBtn);
      });
    }
    bindOverviewRangeEvents(renderVersion);
  }

  // ── 플레이스 탭 (확장 프로그램과 동일 UI: 바 차트, 채널, 키워드, 브랜드 vs 일반) ──
  async function renderPlaceTab(container, renderVersion) {
    if (!isRenderActive(renderVersion)) return;
    var branchIds = getSelectedBranchIds();
    var perfCtx = createTabPerfContext('place', branchIds);
    if (!branchIds.length) {
      if (!isRenderActive(renderVersion)) return;
      container.innerHTML = emptyState('📍', '지점을 추가해주세요', '');
      flushTabPerfContext(perfCtx);
      return;
    }

    if (!isRenderActive(renderVersion)) return;
    container.innerHTML = '<div class="text-center text-muted" style="padding:40px">플레이스 데이터를 불러오는 중...</div>';
    var allWeekly = [], allCh = [], allKw = [];
    try {
      var placeBundle = await getFormulaQueryService().getPlaceBundle(branchIds);
      allWeekly = (placeBundle && placeBundle.weekly) ? placeBundle.weekly : [];
      allCh = (placeBundle && placeBundle.channels) ? placeBundle.channels : [];
      allKw = (placeBundle && placeBundle.keywords) ? placeBundle.keywords : [];
    } catch (eLoadPlace) {
      if (!isRenderActive(renderVersion)) return;
      container.innerHTML = '<p class="text-danger">데이터를 불러오지 못했습니다. ' + esc(eLoadPlace && eLoadPlace.message ? eLoadPlace.message : String(eLoadPlace)) + '</p>';
      flushTabPerfContext(perfCtx);
      return;
    }
    if (!isRenderActive(renderVersion)) return;

    // 동명 지점 그룹 선택 시(한 지점에 branch_id가 여러 개) 같은 주차가 중복되어 2배 합산됨 → 주차/채널/키워드별 1건만 사용
    var isPlaceGroupSelection = String(_currentBranch).indexOf('__grp__:') === 0 && branchIds.length > 1;
    if (isPlaceGroupSelection) {
      allWeekly = dedupePlaceRowsByKey(allWeekly, 'week_key');
      allCh = dedupePlaceRowsByKey(allCh, 'week_key', 'channel_name');
      allKw = dedupePlaceRowsByKey(allKw, 'week_key', 'keyword_name');
    }

    var weekMap = {}, weeks = [], cr = [];
    var chByWeek = {}, chWeeks = [], chNames = [], chRows = [];
    var kwPivot = {}, kwNames = [], kwWeeks = [], kwRows = [];
    var byWeek = {}, classWeeks = [];
    var keywordIsBrand = {};

    if (allWeekly.length) {
      allWeekly.forEach(function (r) {
        if (!weekMap[r.week_key]) weekMap[r.week_key] = { inflow: 0, orders: 0, smart_call: 0, reviews: 0 };
        weekMap[r.week_key].inflow += r.inflow;
        weekMap[r.week_key].orders += r.orders;
        weekMap[r.week_key].smart_call += r.smart_call;
        weekMap[r.week_key].reviews += r.reviews;
      });
      weeks = Object.keys(weekMap).sort();
      cr = weeks.map(function (w) {
        var d = weekMap[w];
        var cvr = d.inflow > 0 ? d.orders / d.inflow * 100 : 0;
        var rCvr = d.orders > 0 ? d.reviews / d.orders * 100 : 0;
        return { '주간': w, '유입': d.inflow, '예약/주문': d.orders, '전환율': cvr, '스마트콜': d.smart_call, '리뷰': d.reviews, '리뷰전환율': rCvr };
      });
    }
    if (allCh.length) {
      allCh.forEach(function (r) {
        if (!chByWeek[r.week_key]) chByWeek[r.week_key] = { 유입수: 0 };
        chByWeek[r.week_key][r.channel_name] = (chByWeek[r.week_key][r.channel_name] || 0) + r.inflow_count;
        chByWeek[r.week_key].유입수 += r.inflow_count;
      });
      chWeeks = Object.keys(chByWeek).sort();
      chNames = [];
      chWeeks.forEach(function (w) {
        Object.keys(chByWeek[w]).forEach(function (c) { if (c !== '유입수' && chNames.indexOf(c) < 0) chNames.push(c); });
      });
      chNames.sort();
      chRows = chWeeks.map(function (w) {
        var row = { '주간': w, '유입수': chByWeek[w].유입수 };
        chNames.forEach(function (c) { row[c] = chByWeek[w][c] || 0; });
        return row;
      });
    }
    if (allKw.length) {
      allKw.forEach(function (r) {
        if (!kwPivot[r.week_key]) kwPivot[r.week_key] = {};
        kwPivot[r.week_key][r.keyword_name] = r.percentage;
        if (kwNames.indexOf(r.keyword_name) < 0) kwNames.push(r.keyword_name);
        if (keywordIsBrand[r.keyword_name] === undefined) keywordIsBrand[r.keyword_name] = !!r.is_brand;
      });
      kwNames.sort();
      kwWeeks = Object.keys(kwPivot).sort();
      kwRows = kwWeeks.map(function (w) {
        var row = { '주간': w };
        kwNames.forEach(function (k) { row[k] = kwPivot[w][k] || 0; });
        return row;
      });
      allKw.forEach(function (r) {
        if (!byWeek[r.week_key]) byWeek[r.week_key] = { brand: 0, generic: 0 };
        if (r.is_brand) byWeek[r.week_key].brand += r.percentage || 0;
        else byWeek[r.week_key].generic += r.percentage || 0;
      });
      classWeeks = Object.keys(byWeek).sort();
    }

    function exportPlaceExcel() {
      if (typeof XLSX === 'undefined' || !XLSX.utils) {
        alert('엑셀 내보내기 라이브러리를 찾을 수 없습니다.');
        return;
      }
      if (!cr.length && !chRows.length && !kwRows.length && !classWeeks.length) {
        alert('내보낼 플레이스 데이터가 없습니다.');
        return;
      }

      var wb = XLSX.utils.book_new();
      var isAll = _currentBranch === '__all__';
      var branchNameById = {};
      _branches.forEach(function (b) { branchNameById[b.id] = b.name; });
      function getBranchName(branchId) {
        return branchNameById[branchId] || '알수없음';
      }
      function safeFileNamePart(name) {
        return String(name || '').replace(/[\\/:*?"<>|]/g, '').trim() || '지점';
      }

      var weeklyRows;
      if (isAll) {
        var weeklyMap = {};
        allWeekly.forEach(function (r) {
          var k = r.week_key + '||' + r.branch_id;
          if (!weeklyMap[k]) {
            weeklyMap[k] = {
              주간: r.week_key, 지점: getBranchName(r.branch_id),
              유입: 0, '예약/주문': 0, 전환율Num: 0, 스마트콜: 0, 리뷰: 0, 리뷰전환율Num: 0
            };
          }
          weeklyMap[k].유입 += r.inflow || 0;
          weeklyMap[k]['예약/주문'] += r.orders || 0;
          weeklyMap[k].스마트콜 += r.smart_call || 0;
          weeklyMap[k].리뷰 += r.reviews || 0;
        });
        weeklyRows = Object.keys(weeklyMap).sort().map(function (k) {
          var row = weeklyMap[k];
          row.전환율Num = row.유입 > 0 ? (row['예약/주문'] / row.유입 * 100) : 0;
          row.리뷰전환율Num = row['예약/주문'] > 0 ? (row.리뷰 / row['예약/주문'] * 100) : 0;
          return {
            주간: row.주간,
            지점: row.지점,
            유입: row.유입,
            '예약/주문': row['예약/주문'],
            전환율: row.전환율Num.toFixed(1) + '%',
            스마트콜: row.스마트콜,
            리뷰: row.리뷰,
            리뷰전환율: row.리뷰전환율Num.toFixed(1) + '%'
          };
        });
      } else {
        weeklyRows = cr.map(function (r) {
          return {
            주간: r['주간'],
            유입: r['유입'],
            '예약/주문': r['예약/주문'],
            전환율: (r['전환율'] || 0).toFixed(1) + '%',
            스마트콜: r['스마트콜'],
            리뷰: r['리뷰'],
            리뷰전환율: (r['리뷰전환율'] || 0).toFixed(1) + '%'
          };
        });
      }
      if (!weeklyRows.length) weeklyRows.push({ 주간: '', 유입: '', '예약/주문': '', 전환율: '', 스마트콜: '', 리뷰: '', 리뷰전환율: '' });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(weeklyRows), '주별 지표');

      var channelRows;
      if (isAll) {
        var channelPivot = {};
        allCh.forEach(function (r) {
          var ck = r.week_key + '||' + r.branch_id;
          if (!channelPivot[ck]) channelPivot[ck] = { 주간: r.week_key, 지점: getBranchName(r.branch_id), 유입수: 0 };
          channelPivot[ck][r.channel_name] = (channelPivot[ck][r.channel_name] || 0) + (r.inflow_count || 0);
          channelPivot[ck].유입수 += r.inflow_count || 0;
        });
        channelRows = Object.keys(channelPivot).sort().map(function (k) {
          var row = { 주간: channelPivot[k].주간, 지점: channelPivot[k].지점, 유입수: channelPivot[k].유입수 };
          chNames.forEach(function (name) { row[name] = channelPivot[k][name] || 0; });
          return row;
        });
      } else {
        channelRows = chRows.map(function (r) {
          var row = { 주간: r['주간'], 유입수: r['유입수'] || 0 };
          chNames.forEach(function (name) { row[name] = r[name] || 0; });
          return row;
        });
      }
      if (!channelRows.length) channelRows.push({ 주간: '', 유입수: '' });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(channelRows), '플레이스 유입 채널');

      var keywordRows;
      if (isAll) {
        var keywordPivot = {};
        allKw.forEach(function (r) {
          var kk = r.week_key + '||' + r.branch_id;
          if (!keywordPivot[kk]) keywordPivot[kk] = { 주간: r.week_key, 지점: getBranchName(r.branch_id) };
          keywordPivot[kk][r.keyword_name] = r.percentage || 0;
        });
        keywordRows = Object.keys(keywordPivot).sort().map(function (k) {
          var row = { 주간: keywordPivot[k].주간, 지점: keywordPivot[k].지점 };
          kwNames.forEach(function (name) { row[name] = ((keywordPivot[k][name] || 0).toFixed(1) + '%'); });
          return row;
        });
      } else {
        keywordRows = kwRows.map(function (r) {
          var row = { 주간: r['주간'] };
          kwNames.forEach(function (name) { row[name] = (r[name] || 0).toFixed(1) + '%'; });
          return row;
        });
      }
      if (!keywordRows.length) keywordRows.push({ 주간: '' });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(keywordRows), '플레이스 유입 키워드');

      var brandRows;
      if (isAll) {
        var bgMap = {};
        allKw.forEach(function (r) {
          var bk = r.week_key + '||' + r.branch_id;
          if (!bgMap[bk]) bgMap[bk] = { 주간: r.week_key, 지점: getBranchName(r.branch_id), brand: 0, generic: 0 };
          if (r.is_brand) bgMap[bk].brand += r.percentage || 0;
          else bgMap[bk].generic += r.percentage || 0;
        });
        brandRows = Object.keys(bgMap).sort().map(function (k) {
          var d = bgMap[k];
          var total = d.brand + d.generic;
          var bPct = total > 0 ? d.brand / total * 100 : 0;
          var gPct = 100 - bPct;
          return {
            주간: d.주간,
            지점: d.지점,
            브랜드: d.brand.toFixed(1) + '%',
            일반: d.generic.toFixed(1) + '%',
            브랜드비율: bPct.toFixed(1) + '%',
            일반비율: gPct.toFixed(1) + '%'
          };
        });
      } else {
        brandRows = classWeeks.map(function (w) {
          var d = byWeek[w] || { brand: 0, generic: 0 };
          var total = d.brand + d.generic;
          var bPct = total > 0 ? d.brand / total * 100 : 0;
          var gPct = 100 - bPct;
          return {
            주간: w,
            브랜드: d.brand.toFixed(1) + '%',
            일반: d.generic.toFixed(1) + '%',
            브랜드비율: bPct.toFixed(1) + '%',
            일반비율: gPct.toFixed(1) + '%'
          };
        });
      }
      if (!brandRows.length) brandRows.push({ 주간: '', 브랜드: '', 일반: '', 브랜드비율: '', 일반비율: '' });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(brandRows), '브랜드_일반 키워드 비율');

      var today = new Date();
      var y = today.getFullYear();
      var m = String(today.getMonth() + 1).padStart(2, '0');
      var d = String(today.getDate()).padStart(2, '0');
      var selectedLabel = isAll
        ? '전체통합'
        : safeFileNamePart(getBranchName(_currentBranch));
      XLSX.writeFile(wb, y + m + d + '_' + selectedLabel + '_네이버플레이스_RawData.xlsx');
    }

    var html = '';
    html += '<div class="place-tab-scroll">';
    html += '<div class="card"><div class="flex justify-between items-center flex-wrap gap-2">';
    html += '<h3 class="table-title" style="padding:0;margin:0">플레이스 데이터</h3>';
    html += '<div class="flex gap-2 flex-wrap items-center">';
    var placeUploadBranchOptions = getGroupedBranchOptions().map(function (g) {
      var singleId = (g.ids && g.ids.length) ? g.ids[0] : g.value;
      return { value: singleId, name: g.name };
    }).filter(function (o) { return o.value && o.value !== '__all__'; });
    if (placeUploadBranchOptions.length > 0) {
      var defaultPlaceUploadId = branchIds && branchIds[0] ? branchIds[0] : (placeUploadBranchOptions[0] ? placeUploadBranchOptions[0].value : null);
      html += '<label class="sales-upload-target-label" style="margin:0">업로드 대상</label>';
      html += '<select id="sel-place-upload-target" class="sales-upload-target-select" style="min-width:140px">';
      placeUploadBranchOptions.forEach(function (o) {
        var selected = (defaultPlaceUploadId && o.value === defaultPlaceUploadId) ? ' selected' : '';
        if (!selected && placeUploadBranchOptions.length === 1) selected = ' selected';
        html += '<option value="' + esc(o.value) + '"' + selected + '>' + esc(o.name) + '</option>';
      });
      html += '</select>';
      html += '<button type="button" class="btn btn-primary btn-sm" id="btn-place-full-sync" title="엑셀 파일(주별/채널/키워드 시트)을 올리면 선택한 지점에 업로드됩니다">전체 동기화</button>';
      html += '<input type="file" id="input-place-sync-file" accept=".xlsx,.xls" style="display:none">';
      html += '<button type="button" class="btn btn-outline btn-sm btn-danger" id="btn-place-reset" title="선택한 지점의 플레이스 데이터(주별/채널/키워드)를 모두 삭제합니다">플레이스 초기화</button>';
      html += '<span class="text-muted" style="font-size:12px">선택한 지점에만 업로드됩니다.</span>';
    }
    html += '<button type="button" class="btn btn-outline btn-sm" id="btn-export-place-excel">엑셀 저장</button>';
    html += '</div></div></div>';

    var singleBranchForSync = placeUploadBranchOptions.length > 0;
    // 플랫폼 관리자 전용: 이 지점 데이터를 지점장이 보는 동일명 지점으로 복사 안내
    if (_profile && _profile.role === 'super' && singleBranchForSync && cr.length > 0) {
      var branchLabel = getBranchNameById(_currentBranch);
      html += '<div class="card" style="margin-bottom:16px;background:#eff6ff;border:1px solid #93c5fd;">';
      html += '<p style="margin:0;font-size:13px;color:#1e40af;"><strong>지점장 화면과 데이터가 다르게 보일 때</strong></p>';
      html += '<p style="margin:6px 0 0 0;font-size:12px;color:#1e3a8a;">이 지점(<strong>' + esc(branchLabel) + '</strong>)에 표시된 플레이스 데이터를, 지점장이 보는 같은 이름의 지점으로 복사하려면 <strong>관리자</strong> 메뉴 → <strong>업로드 이력</strong> → 「플레이스 데이터 지점 간 동기화」에서 <strong>원본 지점</strong>=이 지점, <strong>대상 지점</strong>=지점장이 배정된 지점을 선택한 뒤 <strong>동기화 실행</strong>을 누르세요.</p>';
      html += '</div>';
    }

    // 1) 주별 지표 — 헤더 테이블 분리로 sticky 확실 적용(빨간선 위 고정)
    html += '<div class="card">';
    html += '<h3 class="table-title">주별 지표</h3>';
    if (!cr.length) {
      html += '<p class="text-muted">데이터가 없습니다. 크롬 확장에서 추출 후 클라우드에 업로드하세요.</p>';
    } else {
      var hd = ['주간', '유입', '예약/주문', '전환율', '스마트콜', '리뷰', '리뷰전환율'];
      var nc = ['유입', '예약/주문', '스마트콜', '리뷰'], pc = ['전환율', '리뷰전환율'];
      var mx = calcMax(cr, nc.concat(pc));
      html += '<div class="place-table-wrap place-weekly-table">';
      html += '<div class="place-weekly-sticky-head"><table class="place-weekly-head-table"><thead><tr>';
      html += '<th style="text-align:left"><span class="th-inner">주간</span></th><th><span class="th-inner">유입</span></th><th><span class="th-inner">예약/주문</span></th><th><span class="th-inner">전환율</span></th><th><span class="th-inner">스마트콜</span></th><th><span class="th-inner">리뷰</span></th><th><span class="th-inner">리뷰전환율</span></th>';
      html += '</tr></thead></table></div>';
      html += '<table class="place-weekly-body-table"><colgroup><col style="width:16%"><col style="width:14%"><col style="width:14%"><col style="width:14%"><col style="width:14%"><col style="width:14%"><col style="width:14%"></colgroup><tbody>';
      cr.forEach(function (r) {
        html += '<tr>';
        html += '<td style="text-align:left;font-weight:600">' + esc(r['주간']) + '</td>';
        html += barCell(r['유입'], fmtNum(r['유입']), mx['유입'], getPlaceCC('유입', 0));
        html += barCell(r['예약/주문'], fmtNum(r['예약/주문']), mx['예약/주문'], getPlaceCC('예약/주문', 1));
        html += barCell(r['전환율'], r['전환율'].toFixed(1) + '%', mx['전환율'], getPlaceCC('전환율', 4));
        html += barCell(r['스마트콜'], fmtNum(r['스마트콜']), mx['스마트콜'], getPlaceCC('스마트콜', 2));
        html += barCell(r['리뷰'], fmtNum(r['리뷰']), mx['리뷰'], getPlaceCC('리뷰', 3));
        html += barCell(r['리뷰전환율'], r['리뷰전환율'].toFixed(1) + '%', mx['리뷰전환율'], getPlaceCC('리뷰전환율', 5));
        html += '</tr>';
      });
      html += '</tbody></table>';
      html += '</div>';
    }
    html += '</div>';

    // 2) 플레이스 유입 채널 (유입수 × 채널비율) + 바 셀
    html += '<div class="card"><h3 class="table-title">📍 플레이스 유입 채널 (유입수 × 채널비율)</h3>';
    if (!chRows.length) {
      html += '<p class="text-muted">채널 데이터가 없습니다.</p>';
      html += '<p class="text-muted" style="font-size:12px;margin-top:4px;">엑셀에 <strong>플레이스 유입 채널</strong> 시트가 있으면, 위에서 지점을 하나 선택한 뒤 <strong>전체 동기화</strong> 버튼으로 업로드하세요.</p>';
    } else {
      var chCols = ['유입수'].concat(chNames);
      var chMx = calcMax(chRows, chCols);
      html += '<div class="place-table-wrap">';
      html += '<table><thead><tr><th style="text-align:left"><span class="th-inner">주간</span></th>';
      chCols.forEach(function (c, ci) { html += '<th><span class="th-inner">' + esc(c) + '</span></th>'; });
      html += '</tr></thead><tbody>';
      chRows.forEach(function (r) {
        html += '<tr><td style="text-align:left;font-weight:600">' + esc(r['주간']) + '</td>';
        chCols.forEach(function (c, ci) {
          var v = r[c] || 0;
          html += barCell(v, fmtNum(v), chMx[c], getPlaceCC(c, ci));
        });
        html += '</tr>';
      });
      html += '</tbody></table>';
      html += '</div>';
    }
    html += '</div>';

    // 3) 키워드 (주간 × 키워드별 비율, 바 셀)
    html += '<div class="card"><h3 class="table-title">🔍 플레이스 유입 키워드</h3>';
    if (!kwRows.length) {
      html += '<p class="text-muted">키워드 데이터가 없습니다.</p>';
      html += '<p class="text-muted" style="font-size:12px;margin-top:4px;">엑셀에 <strong>플레이스 유입 키워드</strong> 시트가 있으면, 위에서 지점을 하나 선택한 뒤 <strong>전체 동기화</strong> 버튼으로 업로드하세요.</p>';
    } else {
      html += '<div class="place-table-wrap">';
      html += '<table><thead><tr><th style="text-align:left"><span class="th-inner">주간</span></th>';
      kwNames.forEach(function (k) { html += '<th><span class="th-inner">' + esc(k) + '</span></th>'; });
      html += '</tr></thead><tbody>';
      var kwMx = calcMax(kwRows, kwNames);
      kwRows.forEach(function (r) {
        html += '<tr><td style="text-align:left;font-weight:600">' + esc(r['주간']) + '</td>';
        kwNames.forEach(function (k, ci) {
          var v = r[k] || 0;
          html += barCell(v, v.toFixed(1) + '%', Math.max(kwMx[k] || 1, 100), getPlaceCC(k, ci));
        });
        html += '</tr>';
      });
      html += '</tbody></table>';
      html += '</div>';
    }
    html += '</div>';

    // 4) 브랜드 vs 일반 키워드 비율 (세그먼트 바 + 평균 + 인사이트)
    if (classWeeks.length) {
      var hasData = classWeeks.some(function (w) { var d = byWeek[w]; return d.brand > 0 || d.generic > 0; });
      if (hasData) {
        html += '<div class="card"><h3 class="table-title">🏷️ 브랜드 vs 일반 키워드 비율</h3>';
        html += '<div class="place-table-wrap">';
        html += '<table><thead><tr><th style="text-align:left"><span class="th-inner">주간</span></th><th><span class="th-inner">브랜드</span></th><th><span class="th-inner">일반</span></th><th style="min-width:200px"><span class="th-inner">비율</span></th></tr></thead><tbody>';
        var sumBrand = 0, sumGeneric = 0;
        classWeeks.forEach(function (w) {
          var d = byWeek[w];
          var total = d.brand + d.generic;
          var bPct = total > 0 ? d.brand / total * 100 : 0;
          var gPct = 100 - bPct;
          sumBrand += d.brand;
          sumGeneric += d.generic;
          html += '<tr><td style="text-align:left;font-weight:600">' + esc(w) + '</td>';
          html += '<td style="color:#e87040;font-weight:700">' + d.brand.toFixed(1) + '%</td>';
          html += '<td style="color:#3b82f6;font-weight:700">' + d.generic.toFixed(1) + '%</td>';
          html += '<td><div class="funnel-bar-row">';
          html += '<div style="width:' + bPct.toFixed(1) + '%;background:rgba(232,112,64,0.75);font-size:10px">' + (bPct >= 15 ? '브랜드 ' + bPct.toFixed(0) + '%' : '') + '</div>';
          html += '<div style="width:' + gPct.toFixed(1) + '%;background:rgba(59,130,246,0.65);font-size:10px">' + (gPct >= 15 ? '일반 ' + gPct.toFixed(0) + '%' : '') + '</div>';
          html += '</div></td></tr>';
        });
        var n = classWeeks.length;
        var avgBrand = sumBrand / n, avgGeneric = sumGeneric / n;
        var avgTotal = avgBrand + avgGeneric;
        var avgBPct = avgTotal > 0 ? avgBrand / avgTotal * 100 : 0;
        var avgGPct = 100 - avgBPct;
        html += '<tr class="place-row-total"><td style="text-align:left;font-weight:800">평균</td>';
        html += '<td style="color:#e87040;font-weight:800">' + avgBrand.toFixed(1) + '%</td>';
        html += '<td style="color:#3b82f6;font-weight:800">' + avgGeneric.toFixed(1) + '%</td>';
        html += '<td><div class="funnel-bar-row">';
        html += '<div style="width:' + avgBPct.toFixed(1) + '%;background:rgba(232,112,64,0.85);font-size:10px;font-weight:700">' + (avgBPct >= 15 ? '브랜드 ' + avgBPct.toFixed(0) + '%' : '') + '</div>';
        html += '<div style="width:' + avgGPct.toFixed(1) + '%;background:rgba(59,130,246,0.75);font-size:10px;font-weight:700">' + (avgGPct >= 15 ? '일반 ' + avgGPct.toFixed(0) + '%' : '') + '</div>';
        html += '</div></td></tr>';
        html += '</tbody></table>';
        html += '</div>';
        if (classWeeks.length >= 2) {
          var first = byWeek[classWeeks[0]], last = byWeek[classWeeks[classWeeks.length - 1]];
          var gFirst = first.brand + first.generic > 0 ? first.generic / (first.brand + first.generic) * 100 : 0;
          var gLast = last.brand + last.generic > 0 ? last.generic / (last.brand + last.generic) * 100 : 0;
          var gDiff = gLast - gFirst;
          if (Math.abs(gDiff) > 1) {
            var trendColor = gDiff > 0 ? '#16a34a' : '#ef4444';
            var trendText = gDiff > 0 ? '✓ 일반 키워드 비중이 증가하고 있습니다 – 자연 검색 유입이 늘어나는 긍정적 신호입니다!' : '일반 키워드 비중이 감소하고 있습니다 – 브랜드 의존도가 높아지고 있으니 콘텐츠/SEO 전략을 강화하세요.';
            html += '<div style="margin-top:12px;padding:10px 14px;border-radius:8px;background:rgba(0,0,0,0.03);font-size:12px;color:' + trendColor + ';font-weight:600">' + (gDiff > 0 ? '📈 ' : '📉 ') + trendText + '</div>';
          }
        }
        html += '</div>';
      }
    }

    // 5) AI 인사이트 카드 (채널·키워드·브랜드 vs 일반)
    var insightItems = [];
    if (cr.length >= 2) {
      var last = cr[cr.length - 1], prev = cr[cr.length - 2];
      var lInf = last['유입'], pInf = prev['유입'];
      if (pInf > 0) {
        var infChg = (lInf - pInf) / pInf * 100;
        insightItems.push('<span class="tag tag-' + (infChg >= 0 ? 'up' : 'down') + '">' + (infChg >= 0 ? '▲' : '▼') + '</span> <strong>' + esc(last['주간']) + '</strong> 유입이 전주 대비 <strong>' + Math.abs(infChg).toFixed(1) + '%</strong> ' + (infChg >= 0 ? '증가' : '감소') + ' (' + fmtNum(Math.round(pInf)) + ' → ' + fmtNum(Math.round(lInf)) + ')');
      }
    }
    if (chRows.length >= 2) {
      insightItems.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.15);margin:8px 0">');
      insightItems.push('<span class="tag tag-warn">📍</span><strong>유입 채널 분석</strong>');
      var lastCh = chRows[chRows.length - 1], prevCh = chRows[chRows.length - 2];
      chNames.forEach(function (cn) {
        var lv = lastCh[cn] || 0, pv = prevCh[cn] || 0;
        if (pv > 0) {
          var chg = (lv - pv) / pv * 100;
          if (Math.abs(chg) > 5) {
            insightItems.push('<span class="tag tag-' + (chg > 0 ? 'up' : 'down') + '">' + (chg > 0 ? '▲' : '▼') + '</span> ' + esc(cn) + ': <strong>' + fmtNum(Math.round(pv)) + ' → ' + fmtNum(Math.round(lv)) + '</strong> (' + (chg > 0 ? '+' : '') + chg.toFixed(1) + '%)');
          }
        }
      });
      var chTotals = {};
      var chGrandTotal = 0;
      chNames.forEach(function (cn) { chTotals[cn] = 0; });
      chRows.forEach(function (r) {
        chNames.forEach(function (cn) { var v = r[cn] || 0; chTotals[cn] += v; chGrandTotal += v; });
      });
      if (chGrandTotal > 0) {
        var sorted = chNames.slice().sort(function (a, b) { return chTotals[b] - chTotals[a]; });
        var shareStr = sorted.slice(0, 5).map(function (cn) { return esc(cn) + ' <strong>' + (chTotals[cn] / chGrandTotal * 100).toFixed(1) + '%</strong>'; }).join(' · ');
        insightItems.push('<span class="tag tag-info">📊</span> 전체 채널 점유율: ' + shareStr);
      }
    }
    if (kwRows.length >= 2) {
      insightItems.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.15);margin:8px 0">');
      insightItems.push('<span class="tag tag-warn">🔍</span><strong>유입 키워드 분석</strong>');
      var lastKw = kwRows[kwRows.length - 1], prevKw = kwRows[kwRows.length - 2];
      var topKw = null, topVal = 0;
      kwNames.forEach(function (kn) {
        var v = lastKw[kn] || 0;
        if (v > topVal) { topVal = v; topKw = kn; }
      });
      if (topKw) {
        var br = keywordIsBrand[topKw] ? '<span style="color:#e87040;font-size:10px">[브랜드]</span>' : '<span style="color:#3b82f6;font-size:10px">[일반]</span>';
        insightItems.push('<span class="tag tag-info">⭐</span> 최근 주 1위 키워드: <strong>' + esc(topKw) + '</strong> (' + topVal.toFixed(1) + '%) ' + br);
      }
      kwNames.forEach(function (kn) {
        var lv = lastKw[kn] || 0, pv = prevKw[kn] || 0;
        if (pv > 0) {
          var diff = lv - pv;
          if (Math.abs(diff) > 1) {
            var br = keywordIsBrand[kn] ? ' <span style="color:#e87040;font-size:10px">[브랜드]</span>' : ' <span style="color:#3b82f6;font-size:10px">[일반]</span>';
            insightItems.push('<span class="tag tag-' + (diff > 0 ? 'up' : 'down') + '">' + (diff > 0 ? '▲' : '▼') + '</span> ' + esc(kn) + br + ': <strong>' + pv.toFixed(1) + '% → ' + lv.toFixed(1) + '%</strong> (' + (diff > 0 ? '+' : '') + diff.toFixed(1) + '%p)');
          }
        }
      });
      var kwAvg = {};
      kwNames.forEach(function (kn) { kwAvg[kn] = 0; });
      kwRows.forEach(function (r) { kwNames.forEach(function (kn) { kwAvg[kn] += r[kn] || 0; }); });
      var kwn = kwRows.length;
      var kwSorted = kwNames.slice().sort(function (a, b) { return kwAvg[b] - kwAvg[a]; });
      var kwStr = kwSorted.slice(0, 5).map(function (kn) {
        var tag = keywordIsBrand[kn] ? '<span style="color:#e87040;font-size:10px">[B]</span>' : '<span style="color:#3b82f6;font-size:10px">[G]</span>';
        return esc(kn) + tag + ' <strong>' + (kwAvg[kn] / kwn).toFixed(1) + '%</strong>';
      }).join(' · ');
      insightItems.push('<span class="tag tag-info">📊</span> 평균 키워드 비중: ' + kwStr);
      if (kwRows.length >= 2) {
        kwNames.forEach(function (kn) {
          var pv2 = prevKw[kn] || 0, lv2 = lastKw[kn] || 0;
          if (pv2 === 0 && lv2 > 3) {
            insightItems.push('<span class="tag tag-up">🆕</span> <strong>' + esc(kn) + '</strong> 키워드가 새로 등장했습니다. (현재 ' + lv2.toFixed(1) + '%)');
          } else if (pv2 > 3 && lv2 === 0) {
            insightItems.push('<span class="tag tag-down">❌</span> <strong>' + esc(kn) + '</strong> 키워드가 사라졌습니다. (이전 ' + pv2.toFixed(1) + '%)');
          }
        });
      }
    }
    if (classWeeks.length >= 2) {
      insightItems.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:6px 0">');
      insightItems.push('<span class="tag tag-warn">🏷️</span><strong>브랜드 vs 일반 키워드 분석</strong>');
      var kwLast = byWeek[classWeeks[classWeeks.length - 1]];
      var total = kwLast.brand + kwLast.generic;
      var bPct = total > 0 ? kwLast.brand / total * 100 : 0, gPct = 100 - bPct;
      insightItems.push('<span class="tag tag-info">📍</span> 최근 주: 브랜드 <strong style="color:#e87040">' + kwLast.brand.toFixed(1) + '%</strong> / 일반 <strong style="color:#3b82f6">' + kwLast.generic.toFixed(1) + '%</strong>');
    }
    if (insightItems.length) {
      html += '<div class="card insights-card"><h3 class="table-title">💡 플레이스 인사이트</h3>';
      insightItems.forEach(function (item) {
        if (item.indexOf('<hr') === 0) html += item;
        else html += '<div class="insight-item">' + item + '</div>';
      });
      html += '</div>';
    }

    html += '<div class="card insights-card"><h3 class="table-title">🤖 Gemini AI 인사이트</h3>';
    html += '<p class="text-muted">플레이스 유입·채널·키워드 요약을 바탕으로 AI가 인사이트를 생성합니다.</p>';
    html += '<div class="place-ai-insight-block" style="margin-top:12px;min-height:40px;white-space:pre-wrap;line-height:1.5"></div>';
    html += '<button type="button" class="btn btn-primary place-ai-insight-btn" style="margin-top:8px">AI 인사이트 생성</button>';
    html += '</div>';

    html += '</div>'; /* place-tab-scroll */

    if (!isRenderActive(renderVersion)) return;
    container.innerHTML = html;
    var placeAiBlock = container.querySelector('.place-ai-insight-block');
    var placeAiBtn = container.querySelector('.place-ai-insight-btn');
    if (placeAiBlock && placeAiBtn) {
      placeAiBtn.addEventListener('click', function () {
        var summary = {
          label: _currentBranch === '__all__' ? '전체 통합' : getBranchNameById(_currentBranch),
          weekly: (cr || []).slice(-12).map(function (r) {
            return { week: r['주간'], inflow: r['유입'], orders: r['예약/주문'], conversion: r['전환율'], reviews: r['리뷰'], reviewConv: r['리뷰전환율'] };
          }),
          channels: chNames || [],
          channelLastWeek: chRows && chRows.length ? chRows[chRows.length - 1] : null,
          channelPrevWeek: chRows && chRows.length >= 2 ? chRows[chRows.length - 2] : null,
          keywords: kwNames ? kwNames.slice(0, 15) : [],
          keywordLastWeek: kwRows && kwRows.length ? kwRows[kwRows.length - 1] : null,
          brandVsGeneric: classWeeks.length ? classWeeks.slice(-6).map(function (w) {
            var d = byWeek[w];
            var total = (d && (d.brand + d.generic)) || 0;
            return { week: w, brandPct: total > 0 ? Math.round(d.brand / total * 1000) / 10 : 0, genericPct: total > 0 ? Math.round(d.generic / total * 1000) / 10 : 0 };
          }) : []
        };
        invokeAInsight({ promptContext: '플레이스(네이버 플레이스) 유입·채널·키워드 요약', summary: summary }, placeAiBlock, placeAiBtn);
      });
    }
    var exportBtn = document.getElementById('btn-export-place-excel');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        if (!isRenderActive(renderVersion) || _currentTab !== 'place') return;
        exportPlaceExcel();
      });
    }
    var btnPlaceReset = document.getElementById('btn-place-reset');
    if (btnPlaceReset) {
      btnPlaceReset.addEventListener('click', async function () {
        if (!isRenderActive(renderVersion) || _currentTab !== 'place') return;
        var selPlaceTarget = document.getElementById('sel-place-upload-target');
        var branchId = selPlaceTarget && selPlaceTarget.value ? selPlaceTarget.value : null;
        if (!branchId || branchId === '__all__') {
          alert('초기화할 지점을 위에서 선택해 주세요.');
          return;
        }
        var branchLabel = (placeUploadBranchOptions || []).find(function (o) { return o.value === branchId; });
        var name = branchLabel && branchLabel.name ? branchLabel.name : '해당 지점';
        if (!confirm('선택한 지점(' + name + ')의 플레이스 데이터(주별 지표·유입 채널·유입 키워드)를 모두 삭제합니다. 복구할 수 없습니다. 계속할까요?')) return;
        btnPlaceReset.disabled = true;
        try {
          await FX.clearPlaceDataForBranch(branchId);
          renderCurrentTab();
          alert('플레이스 데이터가 초기화되었습니다.');
        } catch (e) {
          alert('초기화 실패: ' + (e && e.message ? e.message : String(e)));
        } finally {
          btnPlaceReset.disabled = false;
        }
      });
    }
    var btnPlaceSync = document.getElementById('btn-place-full-sync');
    var inputPlaceSync = document.getElementById('input-place-sync-file');
    if (btnPlaceSync && inputPlaceSync) {
      btnPlaceSync.addEventListener('click', function () { inputPlaceSync.value = ''; inputPlaceSync.click(); });
      inputPlaceSync.addEventListener('change', function () {
        var file = inputPlaceSync && inputPlaceSync.files && inputPlaceSync.files[0];
        if (!file || _currentTab !== 'place') return;
        var selPlaceTarget = document.getElementById('sel-place-upload-target');
        var branchId = selPlaceTarget && selPlaceTarget.value ? selPlaceTarget.value : (_currentBranch === '__all__' ? null : (_branchGroups && _currentBranch && _branchGroups[_currentBranch] && _branchGroups[_currentBranch].ids && _branchGroups[_currentBranch].ids[0]) || _currentBranch);
        if (!branchId || branchId === '__all__') {
          alert('업로드할 지점을 선택해 주세요.');
          return;
        }
        var reader = new FileReader();
        reader.onload = async function (e) {
          try {
            if (typeof XLSX === 'undefined' || !XLSX.read) {
              alert('엑셀 라이브러리를 불러올 수 없습니다.');
              return;
            }
            var data = new Uint8Array(e.target.result);
            var wb = XLSX.read(data, { type: 'array' });
            var sheetNames = wb.SheetNames || [];
            function getSheet(nameOrIndex) {
              if (typeof nameOrIndex === 'number') return wb.Sheets[sheetNames[nameOrIndex]];
              var idx = sheetNames.indexOf(nameOrIndex);
              if (idx >= 0) return wb.Sheets[sheetNames[idx]];
              return wb.Sheets[sheetNames[0]];
            }
            var wsWeekly = getSheet('주별 지표') || getSheet(0);
            var wsCh = getSheet('플레이스 유입 채널') || getSheet(1);
            var wsKw = getSheet('플레이스 유입 키워드') || getSheet(2);
            var weeklyRows = wsWeekly ? XLSX.utils.sheet_to_json(wsWeekly) : [];
            var channelRows = wsCh ? XLSX.utils.sheet_to_json(wsCh) : [];
            var keywordRows = wsKw ? XLSX.utils.sheet_to_json(wsKw) : [];
            var brandKeywords = [];
            try {
              var brand = await FX.getBrand();
              if (brand && brand.brand_keywords) {
                brandKeywords = Array.isArray(brand.brand_keywords) ? brand.brand_keywords : String(brand.brand_keywords).split(/[,\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
              }
            } catch (err) { /* ignore */ }
            await FX.syncPlaceDataFull(branchId, { weeklyRows: weeklyRows, channelRows: channelRows, keywordRows: keywordRows, brandKeywords: brandKeywords });
            renderCurrentTab();
            alert('플레이스 전체 동기화가 완료되었습니다.');
          } catch (err) {
            alert('동기화 실패: ' + (err && err.message ? err.message : String(err)));
          }
          inputPlaceSync.value = '';
        };
        reader.readAsArrayBuffer(file);
      });
    }
    flushTabPerfContext(perfCtx);
  }

  // ── 매출 탭 ──
  function getSalesUploadTargetBranchIds() {
    var sel = document.getElementById('sel-sales-upload-target');
    if (!sel) return getSelectedBranchIds();
    var val = sel.value;
    if (String(val).indexOf('__grp__:') === 0) {
      var grp = _branchGroups[val];
      return uniqueBranchIds(grp ? grp.ids : []);
    }
    if (val === '__all__') return uniqueBranchIds(_branches.map(function (b) { return b.id; }));
    return uniqueBranchIds([val]);
  }

  function salesWeekKey(d) {
    var date = new Date(d);
    var day = date.getUTCDay();
    var diff = date.getUTCDate() - day + (day === 0 ? -6 : 1);
    var mon = new Date(date);
    mon.setUTCDate(diff);
    var sun = new Date(mon);
    sun.setUTCDate(mon.getUTCDate() + 6);
    function pad(n) { return n < 10 ? '0' + n : n; }
    return mon.getUTCFullYear() + '-' + pad(mon.getUTCMonth() + 1) + '-' + pad(mon.getUTCDate()) + ' ~ ' + sun.getUTCFullYear() + '-' + pad(sun.getUTCMonth() + 1) + '-' + pad(sun.getUTCDate());
  }

  function salesMonthKey(d) {
    var date = new Date(d);
    var y = date.getUTCFullYear(), m = date.getUTCMonth() + 1;
    return y + '-' + (m < 10 ? '0' + m : m);
  }

  function aggregateSalesByPeriod(records, getKey) {
    var byKey = {};
    records.forEach(function (r) {
      var d = r.payment_date;
      var key = getKey(d);
      if (!byKey[key]) byKey[key] = {
        매출: 0, PT: 0, FC: 0, 신규: 0, 재등록: 0, 기타: 0,
        members: {}, ptMembers: {}, fcMembers: {}, newMembers: {}, reMembers: {},
        fcNewMembers: {}, fcReMembers: {}, ptNewMembers: {}, ptReMembers: {}
      };
      var row = byKey[key];
      var amt = parseInt(r.amount || 0, 10);
      row.매출 += amt;
      var pt = (r.product_type || '').toUpperCase();
      if (pt === 'PT') { row.PT += amt; if (r.member_name) row.ptMembers[r.member_name] = true; }
      else { row.FC += amt; if (r.member_name) row.fcMembers[r.member_name] = true; }
      var inferredCt = detectCustomerTypeFromFileName(r.file_source || '');
      var ct = inferredCt || (r.customer_type || '').trim().toLowerCase();
      if (ct === 'new' || ct === '신규') {
        row.신규 += amt;
        if (r.member_name) row.newMembers[r.member_name] = true;
        if ((r.product_type || '').toUpperCase() === 'PT') {
          if (r.member_name) row.ptNewMembers[r.member_name] = true;
        } else {
          if (r.member_name) row.fcNewMembers[r.member_name] = true;
        }
      }
      else if (ct === 're' || ct === '재등록') {
        row.재등록 += amt;
        if (r.member_name) row.reMembers[r.member_name] = true;
        if ((r.product_type || '').toUpperCase() === 'PT') {
          if (r.member_name) row.ptReMembers[r.member_name] = true;
        } else {
          if (r.member_name) row.fcReMembers[r.member_name] = true;
        }
      }
      else row.기타 += amt;
      if (r.member_name) row.members[r.member_name] = true;
    });
    var keys = Object.keys(byKey).sort();
    return keys.map(function (k) {
      var row = byKey[k];
      var ptCnt = Object.keys(row.ptMembers).length || 1;
      var fcCnt = Object.keys(row.fcMembers).length || 1;
      return {
        period: k,
        매출: row.매출,
        PT: row.PT,
        FC: row.FC,
        신규: row.신규,
        재등록: row.재등록,
        회원수: Object.keys(row.members).length,
        FC회원수: Object.keys(row.fcMembers).length,
        PT회원수: Object.keys(row.ptMembers).length,
        신규회원수: Object.keys(row.newMembers).length,
        재등록회원수: Object.keys(row.reMembers).length,
        FC신규회원수: Object.keys(row.fcNewMembers).length,
        FC재등록회원수: Object.keys(row.fcReMembers).length,
        PT신규회원수: Object.keys(row.ptNewMembers).length,
        PT재등록회원수: Object.keys(row.ptReMembers).length,
        PT객단가: Math.round(row.PT / ptCnt),
        FC객단가: Math.round(row.FC / fcCnt)
      };
    });
  }

  function salesChip(value, cls) {
    return '<span class="sales-chip ' + cls + '">' + esc(String(value)) + '</span>';
  }

  function salesAmountCell(value, maxValue, variant) {
    var max = maxValue > 0 ? maxValue : 1;
    var pct = Math.max(0, Math.min(100, (value || 0) / max * 100));
    var cls = variant ? ' is-' + variant : ' is-total';
    return '<div class="sales-amount-track">' +
      '<div class="sales-amount-fill' + cls + '" style="width:' + pct.toFixed(1) + '%"></div>' +
      '<span class="sales-amount-text">' + fmtNum(value || 0) + '</span>' +
      '</div>';
  }

  function salesRatioBarCell(leftPct, rightPct, leftColor, rightColor) {
    var l = Math.max(0, Math.min(100, Number(leftPct) || 0));
    var r = Math.max(0, Math.min(100, Number(rightPct) || 0));
    return '<div class="sales-ratio-track">' +
      '<div class="sales-ratio-left" style="width:' + l.toFixed(1) + '%;background:' + leftColor + '">' + l.toFixed(1) + '%</div>' +
      '<div class="sales-ratio-right" style="width:' + r.toFixed(1) + '%;background:' + rightColor + '">' + r.toFixed(1) + '%</div>' +
      '</div>';
  }

  function renderSalesTableHtml(title, rows, periodLabel, opts) {
    if (!rows.length) return '';
    opts = opts || {};
    var maxSales = 0, maxNetSales = 0, maxPt = 0, maxFc = 0;
    var maxNew = 0, maxRe = 0;
    var maxFcNewMembers = 0, maxFcReMembers = 0, maxPtNewMembers = 0, maxPtReMembers = 0;
    var maxFcPrice = 0, maxPtPrice = 0;
    rows.forEach(function (r) {
      if ((r.매출 || 0) > maxSales) maxSales = r.매출 || 0;
      var netSales = Math.round((r.매출 || 0) / 1.1);
      if (netSales > maxNetSales) maxNetSales = netSales;
      var fcNet = Math.round((r.FC || 0) / 1.1), ptNet = Math.round((r.PT || 0) / 1.1);
      if (ptNet > maxPt) maxPt = ptNet;
      if (fcNet > maxFc) maxFc = fcNet;
      if ((r.신규 || 0) > maxNew) maxNew = r.신규 || 0;
      if ((r.재등록 || 0) > maxRe) maxRe = r.재등록 || 0;
      if ((r.FC신규회원수 || 0) > maxFcNewMembers) maxFcNewMembers = r.FC신규회원수 || 0;
      if ((r.FC재등록회원수 || 0) > maxFcReMembers) maxFcReMembers = r.FC재등록회원수 || 0;
      if ((r.PT신규회원수 || 0) > maxPtNewMembers) maxPtNewMembers = r.PT신규회원수 || 0;
      if ((r.PT재등록회원수 || 0) > maxPtReMembers) maxPtReMembers = r.PT재등록회원수 || 0;
      if ((r.FC객단가 || 0) > maxFcPrice) maxFcPrice = r.FC객단가 || 0;
      if ((r.PT객단가 || 0) > maxPtPrice) maxPtPrice = r.PT객단가 || 0;
    });
    var SALES_PT = '#e87040', SALES_FC = '#3b82f6', SALES_NEW = '#22c55e', SALES_RE = '#a855f7';
    var html = '<div class="card sales-table-card">';
    html += '<div class="sales-table-wrap">';
    html += '<table class="sales-table"><thead><tr>';
    html += '<th style="text-align:left">' + periodLabel + '</th><th>매출</th><th title="부가세 10% 제외 (÷1.1)">매출(부가세 10% 제외)</th>';
    html += '<th style="color:' + SALES_FC + '">FC</th><th style="color:' + SALES_PT + '">PT</th><th class="sales-col-fcpt-pct">FC/PT%</th>';
    html += '<th style="color:' + SALES_NEW + '">신규</th><th style="color:' + SALES_RE + '">재등록</th><th class="sales-col-newre-pct">신규/재등록%</th><th class="member-col" style="color:' + SALES_FC + '">FC신규</th><th class="member-col" style="color:' + SALES_FC + '">FC재등록</th><th class="member-col" style="color:' + SALES_PT + '">PT신규</th><th class="member-col" style="color:' + SALES_PT + '">PT재등록</th>';
    html += '<th style="color:' + SALES_FC + '">FC 객단가</th><th style="color:' + SALES_PT + '">PT 객단가</th></tr></thead><tbody>';
    var tot = {
      매출: 0, 실매출: 0, PT: 0, FC: 0, 신규: 0, 재등록: 0,
      FC신규회원수: 0, FC재등록회원수: 0, PT신규회원수: 0, PT재등록회원수: 0,
      PT객단가Sum: 0, FC객단가Sum: 0, cnt: 0
    };
    rows.forEach(function (r, idx) {
      var netSales = Math.round((r.매출 || 0) / 1.1);
      var fcNet = Math.round((r.FC || 0) / 1.1), ptNet = Math.round((r.PT || 0) / 1.1);
      tot.매출 += r.매출; tot.실매출 += netSales; tot.PT += r.PT; tot.FC += r.FC; tot.신규 += r.신규; tot.재등록 += r.재등록;
      tot.FC신규회원수 += (r.FC신규회원수 || 0); tot.FC재등록회원수 += (r.FC재등록회원수 || 0);
      tot.PT신규회원수 += (r.PT신규회원수 || 0); tot.PT재등록회원수 += (r.PT재등록회원수 || 0);
      if (r.매출 > 0) { tot.PT객단가Sum += r.PT객단가; tot.FC객단가Sum += r.FC객단가; tot.cnt++; }
      var ptPct = netSales > 0 ? (ptNet / netSales * 100) : 0, fcPct = netSales > 0 ? (fcNet / netSales * 100) : 0;
      // 요구사항: 신규/재등록 파일만 업로드되는 환경에서는 신규+재등록 합이 100%가 되도록 분모를 (신규+재등록)으로 사용
      var nrTotal = r.신규 + r.재등록;
      var newPct = nrTotal > 0 ? (r.신규 / nrTotal * 100) : 0, rePct = nrTotal > 0 ? (r.재등록 / nrTotal * 100) : 0;
      html += '<tr>';
      html += '<td class="sales-period-cell" style="text-align:left;font-weight:600">' + esc(r.period) + '</td>';
      html += '<td>' + salesAmountCell(r.매출 || 0, maxSales, 'total') + '</td>';
      html += '<td>' + salesAmountCell(netSales, maxNetSales || 1, 'total') + '</td>';
      html += '<td style="color:' + SALES_FC + '">' + salesAmountCell(fcNet, maxFc, 'fc') + '</td>';
      html += '<td style="color:' + SALES_PT + '">' + salesAmountCell(ptNet, maxPt, 'pt') + '</td>';
      html += '<td>' + salesRatioBarCell(fcPct, ptPct, '#7ea1e3', '#d89473') + '</td>';
      html += '<td style="color:' + SALES_NEW + '">' + salesAmountCell(r.신규 || 0, maxNew, 'new') + '</td>';
      html += '<td style="color:' + SALES_RE + '">' + salesAmountCell(r.재등록 || 0, maxRe, 're') + '</td>';
      html += '<td>' + salesRatioBarCell(newPct, rePct, '#4cc76e', '#9a62e8') + '</td>';
      html += '<td class="member-col" style="color:' + SALES_FC + '">' + salesAmountCell(r.FC신규회원수 || 0, maxFcNewMembers, 'fc') + '</td>';
      html += '<td class="member-col" style="color:' + SALES_FC + '">' + salesAmountCell(r.FC재등록회원수 || 0, maxFcReMembers, 'fc') + '</td>';
      html += '<td class="member-col" style="color:' + SALES_PT + '">' + salesAmountCell(r.PT신규회원수 || 0, maxPtNewMembers, 'pt') + '</td>';
      html += '<td class="member-col" style="color:' + SALES_PT + '">' + salesAmountCell(r.PT재등록회원수 || 0, maxPtReMembers, 'pt') + '</td>';
      html += '<td style="color:' + SALES_FC + '">' + salesAmountCell(r.FC객단가 || 0, maxFcPrice, 'fc') + '</td><td style="color:' + SALES_PT + '">' + salesAmountCell(r.PT객단가 || 0, maxPtPrice, 'pt') + '</td>';
      html += '</tr>';
    });
    var totFcNet = Math.round((tot.FC || 0) / 1.1), totPtNet = Math.round((tot.PT || 0) / 1.1);
    var totPtPct = tot.실매출 > 0 ? (totPtNet / tot.실매출 * 100) : 0, totFcPct = tot.실매출 > 0 ? (totFcNet / tot.실매출 * 100) : 0;
    var totNr = tot.신규 + tot.재등록;
    var totNewPct = totNr > 0 ? (tot.신규 / totNr * 100) : 0, totRePct = totNr > 0 ? (tot.재등록 / totNr * 100) : 0;
    var avgPt = tot.cnt > 0 ? Math.round(tot.PT객단가Sum / tot.cnt) : 0, avgFc = tot.cnt > 0 ? Math.round(tot.FC객단가Sum / tot.cnt) : 0;
    html += '<tr class="place-row-total"><td class="sales-period-cell" style="text-align:left;font-weight:800">합계</td>';
    html += '<td>' + salesAmountCell(tot.매출 || 0, Math.max(maxSales, tot.매출 || 0), 'total') + '</td>';
    html += '<td>' + salesAmountCell(tot.실매출 || 0, Math.max(maxNetSales, tot.실매출 || 0), 'total') + '</td>';
    html += '<td style="color:' + SALES_FC + '">' + salesAmountCell(totFcNet, Math.max(maxFc, totFcNet), 'fc') + '</td>';
    html += '<td style="color:' + SALES_PT + '">' + salesAmountCell(totPtNet, Math.max(maxPt, totPtNet), 'pt') + '</td>';
    html += '<td>' + salesRatioBarCell(totFcPct, totPtPct, '#7ea1e3', '#d89473') + '</td>';
    html += '<td style="color:' + SALES_NEW + '">' + salesAmountCell(tot.신규 || 0, Math.max(maxNew, tot.신규 || 0), 'new') + '</td>';
    html += '<td style="color:' + SALES_RE + '">' + salesAmountCell(tot.재등록 || 0, Math.max(maxRe, tot.재등록 || 0), 're') + '</td>';
    html += '<td>' + salesRatioBarCell(totNewPct, totRePct, '#4cc76e', '#9a62e8') + '</td>';
    html += '<td class="member-col" style="color:' + SALES_FC + '">' + salesAmountCell(tot.FC신규회원수 || 0, Math.max(maxFcNewMembers, tot.FC신규회원수 || 0), 'fc') + '</td>';
    html += '<td class="member-col" style="color:' + SALES_FC + '">' + salesAmountCell(tot.FC재등록회원수 || 0, Math.max(maxFcReMembers, tot.FC재등록회원수 || 0), 'fc') + '</td>';
    html += '<td class="member-col" style="color:' + SALES_PT + '">' + salesAmountCell(tot.PT신규회원수 || 0, Math.max(maxPtNewMembers, tot.PT신규회원수 || 0), 'pt') + '</td>';
    html += '<td class="member-col" style="color:' + SALES_PT + '">' + salesAmountCell(tot.PT재등록회원수 || 0, Math.max(maxPtReMembers, tot.PT재등록회원수 || 0), 'pt') + '</td>';
    html += '<td style="color:' + SALES_FC + '">' + salesAmountCell(avgFc || 0, Math.max(maxFcPrice, avgFc || 0), 'fc') + '</td><td style="color:' + SALES_PT + '">' + salesAmountCell(avgPt || 0, Math.max(maxPtPrice, avgPt || 0), 'pt') + '</td></tr>';
    html += '</tbody></table></div></div>';
    return html;
  }

  function getBranchNameById(branchId) {
    if (String(branchId || '').indexOf('__grp__:') === 0) {
      return _branchGroups[branchId] ? _branchGroups[branchId].name : '선택 지점';
    }
    var found = (_branches || []).find(function (b) { return b.id === branchId; });
    return found ? found.name : '선택 지점';
  }

  function summarizeSalesRows(rows) {
    rows = rows || [];
    var total = 0, pt = 0, fc = 0, nw = 0, re = 0, ptPriceSum = 0, fcPriceSum = 0, rowCnt = 0;
    var fcNewMembers = 0, fcReMembers = 0, ptNewMembers = 0, ptReMembers = 0;
    var maxRow = null, minRow = null;
    rows.forEach(function (r) {
      var sales = parseInt(r.매출 || 0, 10) || 0;
      total += sales;
      pt += parseInt(r.PT || 0, 10) || 0;
      fc += parseInt(r.FC || 0, 10) || 0;
      nw += parseInt(r.신규 || 0, 10) || 0;
      re += parseInt(r.재등록 || 0, 10) || 0;
      fcNewMembers += parseInt(r.FC신규회원수 || 0, 10) || 0;
      fcReMembers += parseInt(r.FC재등록회원수 || 0, 10) || 0;
      ptNewMembers += parseInt(r.PT신규회원수 || 0, 10) || 0;
      ptReMembers += parseInt(r.PT재등록회원수 || 0, 10) || 0;
      ptPriceSum += parseInt(r.PT객단가 || 0, 10) || 0;
      fcPriceSum += parseInt(r.FC객단가 || 0, 10) || 0;
      rowCnt++;
      if (!maxRow || sales > (maxRow.매출 || 0)) maxRow = r;
      if (!minRow || sales < (minRow.매출 || 0)) minRow = r;
    });
    var nrTotal = nw + re;
    return {
      total: total,
      pt: pt,
      fc: fc,
      nw: nw,
      re: re,
      fcNewMembers: fcNewMembers,
      fcReMembers: fcReMembers,
      ptNewMembers: ptNewMembers,
      ptReMembers: ptReMembers,
      ptShare: total > 0 ? (pt / total * 100) : 0,
      fcShare: total > 0 ? (fc / total * 100) : 0,
      nwShare: nrTotal > 0 ? (nw / nrTotal * 100) : 0,
      reShare: nrTotal > 0 ? (re / nrTotal * 100) : 0,
      ptPrice: rowCnt > 0 ? Math.round(ptPriceSum / rowCnt) : 0,
      fcPrice: rowCnt > 0 ? Math.round(fcPriceSum / rowCnt) : 0,
      maxRow: maxRow,
      minRow: minRow
    };
  }

  function buildBranchRankingSummary(selectedBranchId, selectedMonthRows, allRecords) {
    if (!selectedBranchId || !_branches || !_branches.length) return null;
    var recordsWithBranch = (allRecords || []).filter(function (r) { return !!(r && r.branch_id); });
    if (!recordsWithBranch.length) return null;
    var monthMap = {};
    recordsWithBranch.forEach(function (r) {
      var mk = salesMonthKey(r.payment_date);
      if (mk) monthMap[mk] = true;
    });
    var allMonths = Object.keys(monthMap).sort();
    var latestMonth = allMonths.length ? allMonths[allMonths.length - 1] : null;
    if (!latestMonth) {
      var latest = (selectedMonthRows && selectedMonthRows.length) ? selectedMonthRows[selectedMonthRows.length - 1] : null;
      latestMonth = latest && latest.period ? String(latest.period) : null;
    }
    if (!latestMonth) return null;
    var anchor = new Date(latestMonth + '-01T00:00:00Z');
    if (isNaN(anchor.getTime())) return null;

    function yyyymmFromDate(d) {
      return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
    }
    function addMonths(d, delta) {
      var nd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1));
      return nd;
    }
    function monthRange(endDate, count) {
      var arr = [];
      for (var i = count - 1; i >= 0; i--) arr.push(yyyymmFromDate(addMonths(endDate, -i)));
      return arr;
    }
    function rangeLabel(keys) {
      if (!keys || !keys.length) return '';
      return keys[0] + ' ~ ' + keys[keys.length - 1];
    }

    var recent3mKeys = monthRange(anchor, 3);
    var trailing12mKeys = monthRange(anchor, 12);
    var recent3mSet = {};
    var trailing12mSet = {};
    recent3mKeys.forEach(function (k) { recent3mSet[k] = true; });
    trailing12mKeys.forEach(function (k) { trailing12mSet[k] = true; });

    var recent3mTotalByBranch = {};
    var trailing12mTotalByBranch = {};
    _branches.forEach(function (b) {
      recent3mTotalByBranch[b.id] = 0;
      trailing12mTotalByBranch[b.id] = 0;
    });
    recordsWithBranch.forEach(function (r) {
      if (!r || !r.branch_id) return;
      var amt = parseInt(r.amount || 0, 10) || 0;
      var monthKey = salesMonthKey(r.payment_date);
      if (recent3mSet[monthKey]) recent3mTotalByBranch[r.branch_id] = (recent3mTotalByBranch[r.branch_id] || 0) + amt;
      if (trailing12mSet[monthKey]) trailing12mTotalByBranch[r.branch_id] = (trailing12mTotalByBranch[r.branch_id] || 0) + amt;
    });

    var branchIds = _branches.map(function (b) { return b.id; });
    var selectedRecent3mTotal = recent3mTotalByBranch[selectedBranchId] || 0;
    var selectedTrailing12mTotal = trailing12mTotalByBranch[selectedBranchId] || 0;
    var selectedRecent3mAvg = Math.round(selectedRecent3mTotal / 3);
    var recent3mRank = 1 + branchIds.filter(function (id) {
      return Math.round((recent3mTotalByBranch[id] || 0) / 3) > selectedRecent3mAvg;
    }).length;
    var trailing12mRank = 1 + branchIds.filter(function (id) {
      return (trailing12mTotalByBranch[id] || 0) > selectedTrailing12mTotal;
    }).length;

    return {
      recent3mLabel: rangeLabel(recent3mKeys),
      trailing12mLabel: rangeLabel(trailing12mKeys),
      recent3mRank: recent3mRank,
      trailing12mRank: trailing12mRank,
      recent3mAvg: selectedRecent3mAvg,
      trailing12mTotal: selectedTrailing12mTotal,
      branchCount: branchIds.length
    };
  }

  function renderSalesInsightHtml(monthRows, label, compareSummary) {
    if (!monthRows || !monthRows.length) return '';
    var cur = monthRows[monthRows.length - 1];
    var prev = monthRows.length > 1 ? monthRows[monthRows.length - 2] : null;
    var sum = summarizeSalesRows(monthRows);
    var salesChg = prev && prev.매출 ? ((cur.매출 - prev.매출) / prev.매출 * 100) : null;
    var curPtShare = cur.매출 > 0 ? (cur.PT / cur.매출 * 100) : 0;
    var prevPtShare = prev && prev.매출 > 0 ? (prev.PT / prev.매출 * 100) : 0;
    var ptShareDiff = curPtShare - prevPtShare;
    var curNr = (cur.신규 || 0) + (cur.재등록 || 0);
    var prevNr = prev ? ((prev.신규 || 0) + (prev.재등록 || 0)) : 0;
    var curNewShare = curNr > 0 ? ((cur.신규 || 0) / curNr * 100) : 0;
    var prevNewShare = prevNr > 0 ? ((prev.신규 || 0) / prevNr * 100) : 0;
    var ptPriceChg = prev && prev.PT객단가 ? ((cur.PT객단가 - prev.PT객단가) / prev.PT객단가 * 100) : null;
    var curFcNewMembers = parseInt(cur.FC신규회원수 || 0, 10) || 0;
    var curFcReMembers = parseInt(cur.FC재등록회원수 || 0, 10) || 0;
    var curPtNewMembers = parseInt(cur.PT신규회원수 || 0, 10) || 0;
    var curPtReMembers = parseInt(cur.PT재등록회원수 || 0, 10) || 0;
    var prevFcNewMembers = prev ? (parseInt(prev.FC신규회원수 || 0, 10) || 0) : 0;
    var prevFcReMembers = prev ? (parseInt(prev.FC재등록회원수 || 0, 10) || 0) : 0;
    var prevPtNewMembers = prev ? (parseInt(prev.PT신규회원수 || 0, 10) || 0) : 0;
    var prevPtReMembers = prev ? (parseInt(prev.PT재등록회원수 || 0, 10) || 0) : 0;
    var curFcMemberTotal = curFcNewMembers + curFcReMembers;
    var curPtMemberTotal = curPtNewMembers + curPtReMembers;
    var curMemberTotal = curFcMemberTotal + curPtMemberTotal;
    var curNewMemberTotal = curFcNewMembers + curPtNewMembers;
    var curReMemberTotal = curFcReMembers + curPtReMembers;
    var fcMemberShare = curMemberTotal > 0 ? (curFcMemberTotal / curMemberTotal * 100) : 0;
    var ptMemberShare = curMemberTotal > 0 ? (curPtMemberTotal / curMemberTotal * 100) : 0;
    var newMemberShare = curMemberTotal > 0 ? (curNewMemberTotal / curMemberTotal * 100) : 0;
    var reMemberShare = curMemberTotal > 0 ? (curReMemberTotal / curMemberTotal * 100) : 0;
    var memberAdvice = [];
    var baseAdvice = [];
    var autoTags = [];
    if (salesChg != null && salesChg <= -10) autoTags.push('매출 급감');
    if (ptShareDiff <= -3) autoTags.push('PT 비중 급락');
    if ((curNewShare - prevNewShare) <= -5) autoTags.push('신규 비중 급락');
    if (ptPriceChg != null && ptPriceChg <= -10) autoTags.push('PT 객단가 급락');
    var curNewMembersTotal = curFcNewMembers + curPtNewMembers;
    var prevNewMembersTotal = prevFcNewMembers + prevPtNewMembers;
    var curReMembersTotal = curFcReMembers + curPtReMembers;
    var prevReMembersTotal = prevFcReMembers + prevPtReMembers;
    if (salesChg != null && salesChg < 0) baseAdvice.push('전월 대비 매출 하락 구간이므로 FC 재등록 리텐션 캠페인을 먼저 강화');
    if (ptShareDiff <= -2) baseAdvice.push('PT 비중 하락으로 PT 체험-상담 전환 퍼널 점검 필요');
    if ((curNewShare - prevNewShare) <= -3 || curNewMembersTotal < prevNewMembersTotal) baseAdvice.push('신규 회원 유입(체험권/소개 이벤트) 액션을 확대');
    if (curReMembersTotal < prevReMembersTotal) baseAdvice.push('재등록 회원 유지율 개선을 위해 만료 예정자 사전 컨택 강화');
    if (!baseAdvice.length) baseAdvice.push('회원/매출 흐름이 안정적이므로 현재 운영 전략을 유지하며 광고 효율만 미세 조정');

    var partialInfo = getPartialMonthInfo(cur.period);
    var html = '<div class="card insights-card"><h3 class="table-title">💡 매출 인사이트 — ' + esc(label) + '</h3>';
    if (partialInfo.isPartial) {
      html += '<div class="insight-item"><span class="tag tag-warn">📅</span> <strong>' + esc(partialInfo.periodLabel) + '</strong> 위 수치는 업로드된 데이터 기준 일할입니다. 해당 월 전체(말일)로 가정하지 마세요.</div>';
    }
    if (salesChg == null) {
      html += '<div class="insight-item"><span class="tag tag-info">•</span> 비교할 이전 월 데이터가 부족합니다.</div>';
    } else {
      html += '<div class="insight-item"><span class="tag ' + (salesChg >= 0 ? 'tag-up' : 'tag-down') + '">' + (salesChg >= 0 ? '▲' : '▼') + '</span> <strong>' + esc(cur.period) + '</strong> 총 매출이 전월 대비 <strong>' + Math.abs(salesChg).toFixed(1) + '%</strong> ' + (salesChg >= 0 ? '증가' : '감소') + '했습니다. (' + fmtNum(prev.매출 || 0) + ' → ' + fmtNum(cur.매출 || 0) + ')</div>';
    }
    html += '<div class="insight-item"><span class="tag ' + (ptShareDiff >= 0 ? 'tag-up' : 'tag-down') + '">' + (ptShareDiff >= 0 ? '▲' : '▼') + '</span> PT 비중이 <strong>' + prevPtShare.toFixed(1) + '%</strong> → <strong>' + curPtShare.toFixed(1) + '%</strong>로 ' + Math.abs(ptShareDiff).toFixed(1) + '%p ' + (ptShareDiff >= 0 ? '상승' : '하락') + '했습니다.</div>';
    html += '<div class="insight-item"><span class="tag tag-info">•</span> 신규 매출 <strong style="color:#22c55e">' + fmtNum(prev ? prev.신규 || 0 : 0) + ' → ' + fmtNum(cur.신규 || 0) + '</strong>, 재등록 <strong style="color:#a855f7">' + fmtNum(prev ? prev.재등록 || 0 : 0) + ' → ' + fmtNum(cur.재등록 || 0) + '</strong></div>';
    html += '<div class="insight-item"><span class="tag ' + ((ptPriceChg || 0) >= 0 ? 'tag-up' : 'tag-down') + '">' + ((ptPriceChg || 0) >= 0 ? '▲' : '▼') + '</span> PT 객단가 <strong>' + fmtNum(prev ? prev.PT객단가 || 0 : 0) + ' → ' + fmtNum(cur.PT객단가 || 0) + '</strong> (' + (ptPriceChg == null ? '-' : ((ptPriceChg >= 0 ? '+' : '-') + Math.abs(ptPriceChg).toFixed(1) + '%')) + ')</div>';
    html += '<div class="insight-item"><span class="tag tag-info">👥</span> FC/PT 신규·재등록 회원수: FC 신규 <strong>' + fmtNum(curFcNewMembers) + '</strong> (전월 ' + fmtNum(prevFcNewMembers) + '), FC 재등록 <strong>' + fmtNum(curFcReMembers) + '</strong> (전월 ' + fmtNum(prevFcReMembers) + '), PT 신규 <strong>' + fmtNum(curPtNewMembers) + '</strong> (전월 ' + fmtNum(prevPtNewMembers) + '), PT 재등록 <strong>' + fmtNum(curPtReMembers) + '</strong> (전월 ' + fmtNum(prevPtReMembers) + ')</div>';
    html += '<div class="insight-item"><span class="tag tag-info">📌</span> 회원 구성비: FC/PT <strong>' + fcMemberShare.toFixed(1) + '% / ' + ptMemberShare.toFixed(1) + '%</strong> · 신규/재등록 <strong>' + newMemberShare.toFixed(1) + '% / ' + reMemberShare.toFixed(1) + '%</strong></div>';
    if (sum.maxRow && sum.minRow) {
      html += '<div class="insight-item"><span class="tag tag-info">•</span> 최고 매출: <strong>' + esc(sum.maxRow.period) + '</strong> (' + fmtNum(sum.maxRow.매출 || 0) + ') / 최저 매출: <strong>' + esc(sum.minRow.period) + '</strong> (' + fmtNum(sum.minRow.매출 || 0) + ')</div>';
    }
    html += '<div class="insight-item"><span class="tag tag-info">📋</span> FC <strong style="color:#3b82f6">' + sum.fcShare.toFixed(1) + '%</strong> / PT <strong style="color:#e87040">' + sum.ptShare.toFixed(1) + '%</strong> | 신규 <strong style="color:#22c55e">' + sum.nwShare.toFixed(1) + '%</strong> / 재등록 <strong style="color:#a855f7">' + sum.reShare.toFixed(1) + '%</strong> | 총 매출 <strong>' + fmtNum(sum.total) + '</strong></div>';
    html += '<div class="insight-item"><span class="tag tag-warn">🧭</span> 제언: <strong style="color:#fcd34d">' + esc(baseAdvice.slice(0, 2).join(' · ')) + '</strong></div>';

    if (compareSummary) {
      var salesDiff = compareSummary.avgTotal > 0 ? ((sum.total - compareSummary.avgTotal) / compareSummary.avgTotal * 100) : 0;
      var ptShareVsAvg = sum.ptShare - compareSummary.avgPtShare;
      var ptPriceVsAvg = compareSummary.avgPtPrice > 0 ? ((sum.ptPrice - compareSummary.avgPtPrice) / compareSummary.avgPtPrice * 100) : 0;
      var fcPriceVsAvg = compareSummary.avgFcPrice > 0 ? ((sum.fcPrice - compareSummary.avgFcPrice) / compareSummary.avgFcPrice * 100) : 0;
      var nwShareVsAvg = sum.nwShare - compareSummary.avgNewShare;
      var fcNewVsAvg = curFcNewMembers - (compareSummary.avgFcNewMembers || 0);
      var fcReVsAvg = curFcReMembers - (compareSummary.avgFcReMembers || 0);
      var ptNewVsAvg = curPtNewMembers - (compareSummary.avgPtNewMembers || 0);
      var ptReVsAvg = curPtReMembers - (compareSummary.avgPtReMembers || 0);
      var curTotalMembers4 = curFcNewMembers + curFcReMembers + curPtNewMembers + curPtReMembers;
      var avgTotalMembers4 = (compareSummary.avgFcNewMembers || 0) + (compareSummary.avgFcReMembers || 0) + (compareSummary.avgPtNewMembers || 0) + (compareSummary.avgPtReMembers || 0);
      var totalMembersVsAvgPct = avgTotalMembers4 > 0 ? ((curTotalMembers4 - avgTotalMembers4) / avgTotalMembers4 * 100) : 0;
      if (salesDiff <= -10) autoTags.push('전체 평균 대비 매출 약세');
      if (ptShareVsAvg <= -5) autoTags.push('FC 중심 구조');
      if (nwShareVsAvg <= -5) autoTags.push('신규 유치 약세');
      if (totalMembersVsAvgPct <= -15) autoTags.push('회원수 전체 평균 대비 약세');
      html += '<hr style="border-color:rgba(255,255,255,0.12);margin:14px 0;">';
      html += '<div class="insight-item"><span class="tag tag-info">🏢</span> <strong>' + esc(label) + '</strong> 지점 전체 평균 대비 분석</div>';
      html += '<div class="insight-item"><span class="tag ' + (salesDiff >= 0 ? 'tag-up' : 'tag-down') + '">' + (salesDiff >= 0 ? '▲' : '▼') + '</span> 총 매출 <strong>' + fmtNum(sum.total) + '</strong>은 전체 지점 평균(' + fmtNum(compareSummary.avgTotal) + ') 대비 <strong>' + (salesDiff >= 0 ? '+' : '-') + Math.abs(salesDiff).toFixed(1) + '%</strong>입니다.</div>';
      html += '<div class="insight-item"><span class="tag ' + (ptShareVsAvg >= 0 ? 'tag-up' : 'tag-down') + '">' + (ptShareVsAvg >= 0 ? '▲' : '▼') + '</span> PT 비중 <strong>' + sum.ptShare.toFixed(1) + '%</strong>은 전체 평균(' + compareSummary.avgPtShare.toFixed(1) + '%) 대비 <strong>' + (ptShareVsAvg >= 0 ? '+' : '-') + Math.abs(ptShareVsAvg).toFixed(1) + '%p</strong>입니다.</div>';
      html += '<div class="insight-item"><span class="tag ' + (ptPriceVsAvg >= 0 ? 'tag-up' : 'tag-down') + '">' + (ptPriceVsAvg >= 0 ? '▲' : '▼') + '</span> PT 객단가 <strong>' + fmtNum(sum.ptPrice) + '</strong>는 전체 평균(' + fmtNum(compareSummary.avgPtPrice) + ') 대비 <strong>' + (ptPriceVsAvg >= 0 ? '+' : '-') + Math.abs(ptPriceVsAvg).toFixed(1) + '%</strong></div>';
      html += '<div class="insight-item"><span class="tag ' + (fcPriceVsAvg >= 0 ? 'tag-up' : 'tag-down') + '">' + (fcPriceVsAvg >= 0 ? '▲' : '▼') + '</span> FC 객단가 <strong>' + fmtNum(sum.fcPrice) + '</strong>는 전체 평균(' + fmtNum(compareSummary.avgFcPrice) + ') 대비 <strong>' + (fcPriceVsAvg >= 0 ? '+' : '-') + Math.abs(fcPriceVsAvg).toFixed(1) + '%</strong></div>';
      html += '<div class="insight-item"><span class="tag ' + (nwShareVsAvg >= 0 ? 'tag-up' : 'tag-down') + '">' + (nwShareVsAvg >= 0 ? '▲' : '▼') + '</span> 신규 비중 <strong>' + sum.nwShare.toFixed(1) + '%</strong>은 전체 평균(' + compareSummary.avgNewShare.toFixed(1) + '%) 대비 <strong>' + (nwShareVsAvg >= 0 ? '+' : '-') + Math.abs(nwShareVsAvg).toFixed(1) + '%p</strong></div>';
      html += '<div class="insight-item"><span class="tag ' + (totalMembersVsAvgPct >= 0 ? 'tag-up' : 'tag-down') + '">' + (totalMembersVsAvgPct >= 0 ? '▲' : '▼') + '</span> FC/PT 신규·재등록 회원수 합계 <strong>' + fmtNum(curTotalMembers4) + '</strong>는 전체 지점 평균(' + fmtNum(avgTotalMembers4) + ') 대비 <strong>' + (totalMembersVsAvgPct >= 0 ? '+' : '-') + Math.abs(totalMembersVsAvgPct).toFixed(1) + '%</strong>입니다.</div>';
      html += '<div class="insight-item"><span class="tag ' + (fcNewVsAvg >= 0 ? 'tag-up' : 'tag-down') + '">' + (fcNewVsAvg >= 0 ? '▲' : '▼') + '</span> FC 신규 회원수 <strong>' + fmtNum(curFcNewMembers) + '</strong> (평균 ' + fmtNum(compareSummary.avgFcNewMembers || 0) + ', ' + (fcNewVsAvg >= 0 ? '+' : '-') + fmtNum(Math.abs(fcNewVsAvg)) + ')</div>';
      html += '<div class="insight-item"><span class="tag ' + (fcReVsAvg >= 0 ? 'tag-up' : 'tag-down') + '">' + (fcReVsAvg >= 0 ? '▲' : '▼') + '</span> FC 재등록 회원수 <strong>' + fmtNum(curFcReMembers) + '</strong> (평균 ' + fmtNum(compareSummary.avgFcReMembers || 0) + ', ' + (fcReVsAvg >= 0 ? '+' : '-') + fmtNum(Math.abs(fcReVsAvg)) + ')</div>';
      html += '<div class="insight-item"><span class="tag ' + (ptNewVsAvg >= 0 ? 'tag-up' : 'tag-down') + '">' + (ptNewVsAvg >= 0 ? '▲' : '▼') + '</span> PT 신규 회원수 <strong>' + fmtNum(curPtNewMembers) + '</strong> (평균 ' + fmtNum(compareSummary.avgPtNewMembers || 0) + ', ' + (ptNewVsAvg >= 0 ? '+' : '-') + fmtNum(Math.abs(ptNewVsAvg)) + ')</div>';
      html += '<div class="insight-item"><span class="tag ' + (ptReVsAvg >= 0 ? 'tag-up' : 'tag-down') + '">' + (ptReVsAvg >= 0 ? '▲' : '▼') + '</span> PT 재등록 회원수 <strong>' + fmtNum(curPtReMembers) + '</strong> (평균 ' + fmtNum(compareSummary.avgPtReMembers || 0) + ', ' + (ptReVsAvg >= 0 ? '+' : '-') + fmtNum(Math.abs(ptReVsAvg)) + ')</div>';

      if (fcNewVsAvg < 0) memberAdvice.push('FC 신규 유입 캠페인(체험권/소개 이벤트) 강화');
      if (fcReVsAvg < 0) memberAdvice.push('FC 재등록 리마인드(만료 2주 전 안내) 강화');
      if (ptNewVsAvg < 0) memberAdvice.push('PT 신규 체험 상담 전환 스크립트 점검');
      if (ptReVsAvg < 0) memberAdvice.push('PT 재등록 패키지/리텐션 오퍼 개선');
      if (!memberAdvice.length) memberAdvice.push('현재 4개 회원지표가 평균 이상이므로 유지·확대 전략 권장');
      html += '<div class="insight-item"><span class="tag tag-warn">🧭</span> 평균 대비 제언: <strong style="color:#fcd34d">' + esc(memberAdvice.slice(0, 2).join(' · ')) + '</strong></div>';

      if (compareSummary.recent3mRank && compareSummary.trailing12mRank) {
        html += '<div class="insight-item"><span class="tag tag-info">🥈</span> 매출 순위 <strong>최근 3개월 평균(' + esc(compareSummary.recent3mLabel) + ') ' + compareSummary.recent3mRank + '위</strong> / <strong>최근 12개월 누적(' + esc(compareSummary.trailing12mLabel) + ') ' + compareSummary.trailing12mRank + '위</strong> (총 ' + compareSummary.branchCount + '개 지점)</div>';
      }

      var strengths = [];
      var improvements = [];
      if (salesDiff >= 10) strengths.push('매출');
      else if (salesDiff <= -10) improvements.push('매출');
      if (ptShareVsAvg <= -5) strengths.push('FC 비중');
      else if (ptShareVsAvg >= 5) improvements.push('PT 비중');
      if (fcPriceVsAvg >= 10) strengths.push('FC 객단가');
      else if (fcPriceVsAvg <= -10) improvements.push('FC 객단가');
      if (nwShareVsAvg >= 5) strengths.push('신규 유치');
      else if (nwShareVsAvg <= -5) improvements.push('신규 유치');

      // 개선 항목은 항상 최소 1개 이상 노출
      if (!improvements.length) {
        var candidates = [
          { label: '매출', score: salesDiff },
          { label: '신규 유치', score: nwShareVsAvg },
          { label: 'FC 객단가', score: fcPriceVsAvg },
          // FC 중심 전략 기준: PT 비중이 높을수록 점수 낮게 평가
          { label: 'PT 비중', score: -ptShareVsAvg }
        ];
        candidates.sort(function (a, b) { return a.score - b.score; });
        improvements.push(candidates[0].label);
      }
      html += '<div class="insight-item"><span class="tag tag-info">🎯</span> 강점: <strong style="color:#4ade80">' + esc((strengths.length ? strengths.join(', ') : '없음')) + '</strong> | 개선 필요: <strong style="color:#f87171">' + esc((improvements.length ? improvements.join(', ') : '없음')) + '</strong></div>';
    }

    if (autoTags.length) {
      html += '<div class="insight-item"><span class="tag tag-warn">🎯</span> 자동 태그: <strong style="color:#fda4af">' + esc(autoTags.join(', ')) + '</strong></div>';
    } else {
      html += '<div class="insight-item"><span class="tag tag-up">✅</span> 자동 태그: <strong style="color:#86efac">안정 구간</strong></div>';
    }
    html += '</div>';
    return html;
  }

  async function renderSalesTab(container, renderVersion) {
    if (!isRenderActive(renderVersion)) return;
    var salesLoadToken = 0;
    function isSalesLoadActive(token) {
      return isRenderActive(renderVersion) && token === salesLoadToken && _currentTab === 'sales';
    }
    function isSalesViewActive() {
      return isRenderActive(renderVersion) && _currentTab === 'sales';
    }

    var html = '<div class="sales-tab-layout">';
    html += '<div class="sales-tab-main">';
    html += '<div class="sales-tab-header">';
    html += '<h3 class="sales-tab-title">매출 관리</h3>';
    html += '<span id="sales-context-label" class="sales-context-label"></span>';
    html += '<div class="card sales-upload-card sales-upload-card-collapsed" id="sales-upload-card">';
    html += '<div class="sales-upload-card-header" id="sales-upload-card-header">';
    html += '<span class="sales-upload-card-title">📤 매출 업로드</span>';
    html += '<button type="button" class="btn btn-ghost btn-icon-only sales-upload-card-toggle" id="btn-toggle-sales-upload-card" aria-expanded="false" aria-label="업로드 펼치기">▼</button>';
    html += '</div>';
    html += '<div class="sales-upload-card-body">';
    html += '<div class="sales-upload-target mb-3">';
    html += '<label class="sales-upload-target-label">업로드 대상</label>';
    html += '<select id="sel-sales-upload-target" class="sales-upload-target-select">';
    html += '<option value="__all__">전체 통합 (CSV 지점 열로 지점별 분배)</option>';
    getGroupedBranchOptions().forEach(function (g) {
      html += '<option value="' + g.value + '">' + esc(g.name) + '에만 업로드</option>';
    });
    html += '</select>';
    html += '<p class="sales-upload-target-hint">전체: CSV/엑셀에 "지점" 또는 "지점명" 열이 있으면 지점별 저장. 파일명 맨 앞이 <strong>신규_</strong>면 신규 매출, <strong>재등록_</strong>면 재등록 매출로 분류됩니다. (예: 신규_3월.xlsx, 재등록_3월.xlsx)</p>';
    html += '</div>';
    html += '<div class="flex gap-2 mb-3 flex-wrap">';
    html += '<button type="button" class="btn btn-outline btn-sm" id="btn-upload-sales">파일 업로드</button>';
    html += '<button type="button" class="btn btn-outline btn-sm" id="btn-upload-folder-sales">폴더 업로드</button>';
    html += '<button type="button" class="btn btn-outline btn-sm" id="btn-refresh-sales">매출 데이터 새로고침</button>';
    html += '</div>';
    html += '<input type="file" id="input-sales-file" accept=".csv,text/csv,application/vnd.ms-excel,.xlsx" multiple style="display:none">';
    html += '<input type="file" id="input-sales-folder" webkitdirectory directory multiple style="display:none">';
    html += '<div class="sales-meta-toggle-row mb-2">';
    html += '<button type="button" class="btn btn-outline btn-sm" id="btn-toggle-sales-meta">업로드/로그 상세 보기</button>';
    html += '</div>';
    html += '<div id="sales-meta-panel" class="sales-meta-panel" style="display:none">';
    html += '<div id="sales-upload-status" class="mb-3"></div>';
    html += '</div>';
    html += '</div>';
    html += '</div>';
    html += '</div>';
    html += '<div id="sales-content"><p class="text-muted">매출 파일을 업로드하면 주별/월별 분석 결과가 표시됩니다.</p></div>';
    html += '</div>';
    html += '</div>';
    container.innerHTML = html;

    var uploadCard = document.getElementById('sales-upload-card');
    var btnToggleUploadCard = document.getElementById('btn-toggle-sales-upload-card');
    var uploadCardHeader = document.getElementById('sales-upload-card-header');
    function updateSalesUploadToggleState() {
      var collapsed = uploadCard.classList.contains('sales-upload-card-collapsed');
      if (btnToggleUploadCard) {
        btnToggleUploadCard.textContent = collapsed ? '▼' : '▲';
        btnToggleUploadCard.setAttribute('aria-label', collapsed ? '업로드 펼치기' : '업로드 접기');
        btnToggleUploadCard.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      }
    }
    function onSalesUploadCardToggle(e) {
      if (e && e.target && e.target.id === 'btn-toggle-sales-upload-card') return;
      uploadCard.classList.toggle('sales-upload-card-collapsed');
      updateSalesUploadToggleState();
    }
    if (uploadCard && (btnToggleUploadCard || uploadCardHeader)) {
      if (btnToggleUploadCard) {
        btnToggleUploadCard.addEventListener('click', function (e) { e.stopPropagation(); uploadCard.classList.toggle('sales-upload-card-collapsed'); updateSalesUploadToggleState(); });
      }
      if (uploadCardHeader) {
        uploadCardHeader.addEventListener('click', onSalesUploadCardToggle);
      }
      updateSalesUploadToggleState();
    }

    var selGlobal = document.getElementById('sel-branch-global');
    if (selGlobal) {
      selGlobal.value = _currentBranch || '__all__';
    }
    var btnToggleMeta = document.getElementById('btn-toggle-sales-meta');
    var metaPanel = document.getElementById('sales-meta-panel');
    if (btnToggleMeta && metaPanel) {
      btnToggleMeta.addEventListener('click', function () {
        var isOpen = metaPanel.style.display !== 'none';
        metaPanel.style.display = isOpen ? 'none' : '';
        btnToggleMeta.textContent = isOpen ? '업로드/로그 상세 보기' : '업로드/로그 상세 숨기기';
      });
    }

    function bindSalesPeriodToggle() {
      var wrap = document.getElementById('sales-period-wrap');
      var weekWrap = document.getElementById('sales-week-wrap');
      var monthWrap = document.getElementById('sales-month-wrap');
      if (!wrap || !weekWrap || !monthWrap) return;
      var buttons = wrap.querySelectorAll('.sales-period-btn');
      if (!wrap.dataset.salesPeriodBound) {
        wrap.dataset.salesPeriodBound = '1';
        buttons.forEach(function (btn) {
          btn.addEventListener('click', function () {
            var period = this.getAttribute('data-period');
            buttons.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-period') === period); });
            weekWrap.style.display = period === 'week' ? '' : 'none';
            monthWrap.style.display = period === 'month' ? '' : 'none';
            var salesCtxLbl = document.getElementById('sales-context-label');
            if (salesCtxLbl) salesCtxLbl.textContent = salesCtxLbl.textContent.replace(/ · (월별|주별)$/, ' · ' + (period === 'month' ? '월별' : '주별'));
          });
        });
      }
      monthWrap.style.display = '';
      weekWrap.style.display = 'none';
      buttons.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-period') === 'month'); });
    }

    function loadSalesDataIntoContent(overrideBranchIds) {
      var token = ++salesLoadToken;
      var ids = (overrideBranchIds && overrideBranchIds.length) ? overrideBranchIds : getSelectedBranchIds();
      var useGroupDedup = shouldDedupForCurrentGroup(ids);
      var allowFetchWithoutBranchIds = _currentBranch === '__all__';
      // 신뢰 가능한 고정 집계를 위해 최근 1년이 아닌 전체 기간을 조회
      var fromStr = '2000-01-01';
      var toStr = '2100-12-31';
      var el = document.getElementById('sales-content');
      if (el) {
        el.innerHTML = '<p class="text-muted">매출 데이터를 불러오는 중...</p>';
      }
      if (!ids.length && !allowFetchWithoutBranchIds) {
        if (!isSalesLoadActive(token)) return;
        if (el) el.innerHTML = '<p class="text-muted">지점을 선택하면 해당 지점의 매출 데이터가 표시됩니다. 매출 파일을 업로드하면 주별/월별 분석 결과가 표시됩니다.</p>';
        return;
      }
      async function renderTables(records) {
        if (!isSalesLoadActive(token)) return;
        var contentEl = document.getElementById('sales-content');
        if (!contentEl) return;
        records = records || [];
        if (useGroupDedup) {
          records = dedupeSalesRecordsByMergedBranch(records, ids);
        }
        if (!records.length) {
          contentEl.innerHTML = '<p class="text-muted">매출 파일을 업로드하면 주별/월별 분석 결과가 표시됩니다.</p><p class="text-muted">폴더/파일을 올린 직후라면 <strong>매출 데이터 새로고침</strong> 버튼을 눌러 보세요.</p>';
          return;
        }
        var weekRows = aggregateSalesByPeriod(records, salesWeekKey);
        var monthRows = aggregateSalesByPeriod(records, salesMonthKey);
        var selectedLabel = _currentBranch === '__all__' ? '전체 통합' : getBranchNameById(_currentBranch);
        var weekHtml = renderSalesTableHtml(selectedLabel + ' · 주별', weekRows, '주');
        var monthHtml = renderSalesTableHtml(selectedLabel + ' · 월별', monthRows, '월');
        var compareSummary = null;
        if (ids.length === 1 && _branches.length > 1) {
          try {
            var allIds = _branches.map(function (b) { return b.id; });
            var dedupAll = needsSalesDedupForBranchIds(allIds);
            var allRecords = await FX.getAllSalesRecords(allIds, fromStr, toStr, { mergeSameName: dedupAll });
            if (!isSalesLoadActive(token)) return;
            var allMonthRows = aggregateSalesByPeriod(allRecords || [], salesMonthKey);
            var allSum = summarizeSalesRows(allMonthRows);
            compareSummary = {
              avgTotal: Math.round((allSum.total || 0) / Math.max(allIds.length, 1)),
              avgPtShare: allSum.ptShare || 0,
              avgPtPrice: allSum.ptPrice || 0,
              avgFcPrice: allSum.fcPrice || 0,
              avgNewShare: allSum.nwShare || 0,
              avgFcNewMembers: Math.round((allSum.fcNewMembers || 0) / Math.max(allIds.length, 1)),
              avgFcReMembers: Math.round((allSum.fcReMembers || 0) / Math.max(allIds.length, 1)),
              avgPtNewMembers: Math.round((allSum.ptNewMembers || 0) / Math.max(allIds.length, 1)),
              avgPtReMembers: Math.round((allSum.ptReMembers || 0) / Math.max(allIds.length, 1))
            };
            var rankSummary = buildBranchRankingSummary(ids[0], monthRows, allRecords || []);
            if (rankSummary) {
              compareSummary.recent3mRank = rankSummary.recent3mRank;
              compareSummary.trailing12mRank = rankSummary.trailing12mRank;
              compareSummary.branchCount = rankSummary.branchCount;
              compareSummary.recent3mLabel = rankSummary.recent3mLabel;
              compareSummary.trailing12mLabel = rankSummary.trailing12mLabel;
            }
          } catch (cmpErr) {
            console.warn('sales compare insight fallback:', cmpErr);
          }
        }
        var insightHtml = renderSalesInsightHtml(monthRows, selectedLabel, compareSummary);
        var salesAiCardHtml = '<div class="card insights-card"><h3 class="table-title">🤖 Gemini AI 인사이트</h3><p class="text-muted">매출 요약을 바탕으로 AI가 인사이트를 생성합니다.</p><div class="sales-ai-insight-block" style="margin-top:12px;min-height:40px;white-space:pre-wrap;line-height:1.5"></div><button type="button" class="btn btn-primary sales-ai-insight-btn" style="margin-top:8px">AI 인사이트 생성</button></div>';
        contentEl.innerHTML =
          '<div id="sales-month-wrap">' + monthHtml + '</div>' +
          '<div id="sales-week-wrap" style="display:none">' + weekHtml + '</div>' +
          insightHtml + salesAiCardHtml;
        var ctxLabel = document.getElementById('sales-context-label');
        if (ctxLabel) ctxLabel.textContent = selectedLabel + ' · 월별';
        bindSalesPeriodToggle();
        var salesAiBlock = contentEl.querySelector('.sales-ai-insight-block');
        var salesAiBtn = contentEl.querySelector('.sales-ai-insight-btn');
        if (salesAiBlock && salesAiBtn) {
          salesAiBtn.addEventListener('click', function () {
            var latestPeriod = (monthRows && monthRows.length) ? monthRows[monthRows.length - 1].period : null;
            var partialInfo = getPartialMonthInfo(latestPeriod);
            var summary = {
              label: selectedLabel,
              monthly: (monthRows || []).slice(-12).map(function (r) {
                return { period: r.period, 매출: r.매출, PT: r.PT, FC: r.FC, 신규: r.신규, 재등록: r.재등록, 회원수: r.회원수, PT객단가: r.PT객단가, FC객단가: r.FC객단가 };
              }),
              compare: compareSummary ? { avgTotal: compareSummary.avgTotal, avgPtShare: compareSummary.avgPtShare, recent3mRank: compareSummary.recent3mRank, trailing12mRank: compareSummary.trailing12mRank, branchCount: compareSummary.branchCount } : null
            };
            if (partialInfo.isPartial) {
              summary.currentMonthIncomplete = true;
              summary.currentMonthNote = partialInfo.noteForAI;
            }
            invokeAInsight({ promptContext: '매출(월별) 요약', summary: summary }, salesAiBlock, salesAiBtn);
          });
        }
      }
      function showError(msg, opts) {
        if (!isSalesLoadActive(token)) return;
        var contentEl = document.getElementById('sales-content');
        if (!contentEl) return;
        var is500 = opts && opts.is500;
        var isFailedFetch = opts && opts.isFailedFetch;
        var hintRpc = opts && opts.hintRpc;
        var hint;
        if (hintRpc) {
          hint = '<p class="text-warning mt-2">Supabase SQL Editor에서 <code>supabase/migrations/003_sales_dashboard_rpc.sql</code> 파일 내용을 실행했는지 확인하세요. 이 RPC가 없으면 매출 조회가 되지 않습니다.</p>';
        } else if (isFailedFetch || is500) {
          hint = '<p class="text-muted mt-2">Supabase 대시보드 → <strong>Logs</strong>에서 해당 요청의 실제 오류를 확인하세요.</p>';
        } else {
          hint = '<p class="text-muted">매출 파일을 업로드해 주세요.</p>';
        }
        contentEl.innerHTML = '<p class="text-danger">매출 데이터를 불러오지 못했습니다. ' + esc(msg) + '</p>' + hint;
      }
      async function renderFromAggregated(agg) {
        if (!isSalesLoadActive(token)) return;
        if (!agg || (!agg.weekly.length && !agg.monthly.length)) {
          await renderTables([]);
          return;
        }
        var selectedLabel = _currentBranch === '__all__' ? '전체 통합' : getBranchNameById(_currentBranch);
        var weekHtml = renderSalesTableHtml(selectedLabel + ' · 주별', agg.weekly || [], '주');
        var monthHtml = renderSalesTableHtml(selectedLabel + ' · 월별', agg.monthly || [], '월');
        if (!weekHtml && !monthHtml) { renderTables([]); return; }
        var compareSummary = null;
        if (ids.length === 1 && _branches.length > 1) {
          try {
            var allIds = _branches.map(function (b) { return b.id; });
            var dedupAll2 = needsSalesDedupForBranchIds(allIds);
            var allAgg = await FX.getSalesAggregated(allIds, fromStr, toStr, { mergeSameName: dedupAll2 });
            if (!isSalesLoadActive(token)) return;
            var allRecordsForRank = await FX.getAllSalesRecords(allIds, fromStr, toStr, { mergeSameName: dedupAll2 });
            if (!isSalesLoadActive(token)) return;
            var allMonthRows = (allAgg && allAgg.monthly && allAgg.monthly.length)
              ? allAgg.monthly
              : [];
            if (!allMonthRows.length) {
              allMonthRows = aggregateSalesByPeriod(allRecordsForRank || [], salesMonthKey);
            }
            var allSum = summarizeSalesRows(allMonthRows);
            compareSummary = {
              avgTotal: Math.round((allSum.total || 0) / Math.max(allIds.length, 1)),
              avgPtShare: allSum.ptShare || 0,
              avgPtPrice: allSum.ptPrice || 0,
              avgFcPrice: allSum.fcPrice || 0,
              avgNewShare: allSum.nwShare || 0,
              avgFcNewMembers: Math.round((allSum.fcNewMembers || 0) / Math.max(allIds.length, 1)),
              avgFcReMembers: Math.round((allSum.fcReMembers || 0) / Math.max(allIds.length, 1)),
              avgPtNewMembers: Math.round((allSum.ptNewMembers || 0) / Math.max(allIds.length, 1)),
              avgPtReMembers: Math.round((allSum.ptReMembers || 0) / Math.max(allIds.length, 1))
            };
            var rankSummary2 = buildBranchRankingSummary(ids[0], agg.monthly || [], allRecordsForRank || []);
            if (rankSummary2) {
              compareSummary.recent3mRank = rankSummary2.recent3mRank;
              compareSummary.trailing12mRank = rankSummary2.trailing12mRank;
              compareSummary.branchCount = rankSummary2.branchCount;
              compareSummary.recent3mLabel = rankSummary2.recent3mLabel;
              compareSummary.trailing12mLabel = rankSummary2.trailing12mLabel;
            }
          } catch (cmpErr2) {
            console.warn('sales compare insight fallback:', cmpErr2);
          }
        }
        var insightHtml = renderSalesInsightHtml(agg.monthly || [], selectedLabel, compareSummary);
        var salesAiCardHtml2 = '<div class="card insights-card"><h3 class="table-title">🤖 Gemini AI 인사이트</h3><p class="text-muted">매출 요약을 바탕으로 AI가 인사이트를 생성합니다.</p><div class="sales-ai-insight-block" style="margin-top:12px;min-height:40px;white-space:pre-wrap;line-height:1.5"></div><button type="button" class="btn btn-primary sales-ai-insight-btn" style="margin-top:8px">AI 인사이트 생성</button></div>';
        var contentEl = document.getElementById('sales-content');
        if (!contentEl) return;
        contentEl.innerHTML =
          '<div id="sales-month-wrap">' + monthHtml + '</div>' +
          '<div id="sales-week-wrap" style="display:none">' + weekHtml + '</div>' +
          insightHtml + salesAiCardHtml2;
        bindSalesPeriodToggle();
        var salesCtx2 = document.getElementById('sales-context-label');
        if (salesCtx2) salesCtx2.textContent = selectedLabel + ' · 월별';
        var salesAiBlock2 = contentEl.querySelector('.sales-ai-insight-block');
        var salesAiBtn2 = contentEl.querySelector('.sales-ai-insight-btn');
        if (salesAiBlock2 && salesAiBtn2) {
          salesAiBtn2.addEventListener('click', function () {
            var monthRowsAgg = agg.monthly || [];
            var latestPeriodAgg = monthRowsAgg.length ? monthRowsAgg[monthRowsAgg.length - 1].period : null;
            var partialInfoAgg = getPartialMonthInfo(latestPeriodAgg);
            var summary = {
              label: selectedLabel,
              monthly: monthRowsAgg.slice(-12).map(function (r) {
                return { period: r.period, 매출: r.매출, PT: r.PT, FC: r.FC, 신규: r.신규, 재등록: r.재등록, 회원수: r.회원수, PT객단가: r.PT객단가, FC객단가: r.FC객단가 };
              }),
              compare: compareSummary ? { avgTotal: compareSummary.avgTotal, avgPtShare: compareSummary.avgPtShare, recent3mRank: compareSummary.recent3mRank, trailing12mRank: compareSummary.trailing12mRank, branchCount: compareSummary.branchCount } : null
            };
            if (partialInfoAgg.isPartial) {
              summary.currentMonthIncomplete = true;
              summary.currentMonthNote = partialInfoAgg.noteForAI;
            }
            invokeAInsight({ promptContext: '매출(월별) 요약', summary: summary }, salesAiBlock2, salesAiBtn2);
          });
        }
      }
      FX.getSalesAggregated(ids, fromStr, toStr, { mergeSameName: useGroupDedup })
        .then(async function (agg) {
          if (!isSalesLoadActive(token)) return;
          if (agg && ((agg.weekly && agg.weekly.length) || (agg.monthly && agg.monthly.length))) {
            await renderFromAggregated(agg);
            return;
          }
          var rows = await FX.getAllSalesRecords(ids, fromStr, toStr, { mergeSameName: useGroupDedup });
          if (!isSalesLoadActive(token)) return;
          await renderTables(rows || []);
        })
        .catch(function (err) {
          if (!isSalesLoadActive(token)) return;
          var msg = err && err.message ? err.message : String(err);
          var needRpcHint = (msg.indexOf('get_sales_records_for_dashboard') >= 0)
            || (msg.indexOf('get_sales_records_for_dashboard_dedup') >= 0)
            || (msg.indexOf('function') >= 0 && msg.indexOf('does not exist') >= 0);
          if (needRpcHint) {
            showError(msg + ' Supabase SQL Editor에서 003_sales_dashboard_rpc.sql, 025_sales_records_dedup_rpc.sql 실행 여부를 확인하세요.', { is500: true, isFailedFetch: true, hintRpc: true });
          } else {
            var is500 = (err && (err.code === 'PGRST500' || err.status === 500)) || msg.indexOf('500') >= 0;
            var isFailedFetch = msg.indexOf('Failed to fetch') >= 0 || msg.indexOf('NetworkError') >= 0;
            showError(msg, { is500: is500, isFailedFetch: isFailedFetch, hintRpc: false });
          }
        });
    }

    loadSalesDataIntoContent();

    var btnRefresh = document.getElementById('btn-refresh-sales');
    if (btnRefresh) btnRefresh.addEventListener('click', loadSalesDataIntoContent);

    var btnFile = document.getElementById('btn-upload-sales');
    var inputFile = document.getElementById('input-sales-file');
    var inputFolder = document.getElementById('input-sales-folder');
    if (btnFile && inputFile) {
      btnFile.addEventListener('click', function () {
        inputFile.removeAttribute('webkitdirectory');
        inputFile.removeAttribute('directory');
        inputFile.value = '';
        inputFile.click();
      });
    }
    var btnFolderEl = document.getElementById('btn-upload-folder-sales');
    if (btnFolderEl && inputFolder) {
      btnFolderEl.addEventListener('click', function () {
        inputFolder.setAttribute('webkitdirectory', '');
        inputFolder.value = '';
        inputFolder.click();
      });
    }

    function handleSalesFiles(files, sourceName) {
      if (!files || !files.length) return;
      var branchIds = getSalesUploadTargetBranchIds();
      var branchNameById = {};
      _branches.forEach(function (b) { branchNameById[b.id] = b.name; });
      var statusEl = document.getElementById('sales-upload-status');
      function setUploadStatus(htmlText) {
        if (statusEl) statusEl.innerHTML = htmlText || '';
      }
      function renderUploadValidationReport(rows) {
        rows = rows || [];
        var total = rows.length;
        var net = 0, pt = 0, fc = 0;
        var refundAppliedCount = 0;
        rows.forEach(function (r) {
          var amt = parseInt(r.amount || 0, 10) || 0;
          net += amt;
          if (String(r.product_type || '').toUpperCase() === 'PT') pt += amt;
          else fc += amt;
          if (r._refund_applied || amt < 0) refundAppliedCount++;
        });
        return '<div class="sales-upload-report">' +
          '<span class="item"><strong>총건수</strong> ' + fmtNum(total) + '건</span>' +
          '<span class="item"><strong>순매출</strong> ' + fmtNum(net) + '</span>' +
          '<span class="item"><strong>FC</strong> ' + fmtNum(fc) + '</span>' +
          '<span class="item"><strong>PT</strong> ' + fmtNum(pt) + '</span>' +
          '<span class="item"><strong>환불반영</strong> ' + fmtNum(refundAppliedCount) + '건</span>' +
          '</div>';
      }
      function renderBranchBreakdownReport(items) {
        items = (items || []).filter(function (it) { return it && it.count > 0; });
        if (!items.length) return '';
        return '<div class="sales-upload-report">' +
          items.map(function (it) {
            return '<span class="item"><strong>' + esc(it.name) + '</strong> ' + fmtNum(it.count) + '건 · ' + fmtNum(it.net) + '</span>';
          }).join('') +
          '</div>';
      }
      function getUniqueFileSources(rows) {
        var map = {};
        (rows || []).forEach(function (r) {
          var src = (r && r.file_source ? String(r.file_source) : '').trim();
          if (!src) src = '(empty)';
          map[src] = true;
        });
        return Object.keys(map).slice(0, 50);
      }
      setUploadStatus('<p class="text-muted">파일 처리 중...</p>');
      var allRows = [];
      var parseErrors = [];
      var fileCount = files.length;
      var done = 0;
      function onOneDone(result) {
        if (result && result.error) parseErrors.push(result.error);
        var rows = (result && result.rows) ? result.rows : [];
        if (rows && rows.length) allRows = allRows.concat(rows);
        done++;
        if (done >= fileCount) {
          if (parseErrors.length) {
            setUploadStatus(
              '<p class="text-danger"><strong>업로드 차단:</strong> 필수 컬럼이 누락된 파일이 있습니다.</p>' +
              '<ul style="margin:8px 0 0 18px;color:#f87171;font-size:13px;">' +
              parseErrors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') +
              '</ul>' +
              '<p class="text-muted mt-2">필수 컬럼: 결제일, 상품명, 결제금액. 파일 헤더를 수정한 뒤 다시 업로드하세요.</p>'
            );
            return;
          }
          if (!allRows.length) {
            setUploadStatus('<p class="text-warning">파일에서 매출 데이터를 읽지 못했습니다. CSV 또는 엑셀(xlsx) 형식(결제일, 상품명, 금액 등)을 확인하세요.</p>');
            return;
          }
          if (!branchIds.length) {
            setUploadStatus('<p class="text-danger">지점 정보가 없습니다. 설정에서 지점을 추가한 뒤 업로드하세요.</p>');
            return;
          }
          var hasBranchColumn = allRows.some(function (r) { return r._branch_name; });
          var singleBranchId = branchIds.length === 1 ? branchIds[0] : null;
          if (singleBranchId) {
            var toInsert = allRows.map(function (r) {
              var copy = { payment_date: r.payment_date, product_name: r.product_name, amount: r.amount, product_type: r.product_type, customer_type: r.customer_type, member_name: r.member_name, file_source: r.file_source };
              return copy;
            });
            var BATCH = 400;
            var chunks = [];
            for (var c = 0; c < toInsert.length; c += BATCH) chunks.push(toInsert.slice(c, c + BATCH));
            var seq = Promise.resolve();
            chunks.forEach(function (chunk) {
              seq = seq.then(function () { return FX.insertSalesRecords(singleBranchId, chunk); });
            });
            seq.then(async function () {
              try {
                await FX.logUploadAudit(
                  singleBranchId,
                  'sales_upload',
                  allRows.length,
                  getUniqueFileSources(allRows),
                  {
                    upload_mode: 'single_branch',
                    file_count: fileCount,
                    source: sourceName || 'manual'
                  }
                );
              } catch (auditErr) {
                console.warn('upload audit failed:', auditErr);
              }
              if (!isSalesViewActive()) return;
              var singleNet = allRows.reduce(function (sum, r) { return sum + (parseInt(r.amount || 0, 10) || 0); }, 0);
              var singleName = branchNameById[singleBranchId] || '선택 지점';
              setUploadStatus(
                '<p class="text-success">' + fileCount + '개 파일 처리, 총 ' + allRows.length + '건 업로드되었습니다.</p>' +
                renderUploadValidationReport(allRows) +
                renderBranchBreakdownReport([{ name: singleName, count: allRows.length, net: singleNet }]) +
                '<p class="text-muted">현재 화면을 유지합니다. 반영된 집계를 보려면 <strong>매출 데이터 새로고침</strong> 버튼을 눌러주세요.</p>'
              );
            }).catch(function (err) {
              if (!isSalesViewActive()) return;
              setUploadStatus('<p class="text-danger">업로드 실패: ' + (err.message || err) + '</p>');
            });
            return;
          }
          if (branchIds.length > 1 && hasBranchColumn) {
            var byBranch = {};
            var nameToId = {};
            // 동일 지점명이 여러 id로 있으면 항상 같은 id에 저장 (정렬로 고정). 슈퍼가 올린 데이터가 지점장이 보는 id와 같도록.
            getGroupedBranchOptions().forEach(function (g) {
              var ids = (g.ids && g.ids.length) ? g.ids.slice().sort() : [];
              var canonicalId = ids[0] || null;
              if (!canonicalId) return;
              nameToId[g.name] = canonicalId;
              nameToId[g.name.trim()] = canonicalId;
            });
            allRows.forEach(function (r) {
              var key = (r._branch_name || '').trim();
              if (!key) key = '__no_branch__';
              if (!byBranch[key]) byBranch[key] = [];
              byBranch[key].push({ payment_date: r.payment_date, product_name: r.product_name, amount: r.amount, product_type: r.product_type, customer_type: r.customer_type, member_name: r.member_name, file_source: r.file_source });
            });
            var noBranchRows = byBranch['__no_branch__'] || [];
            delete byBranch['__no_branch__'];
            var inserts = [];
            Object.keys(byBranch).forEach(function (branchName) {
              var bid = nameToId[branchName];
              if (bid) inserts.push({ branchId: bid, branchName: branchName, rows: byBranch[branchName] });
            });
            if (!inserts.length) {
              setUploadStatus('<p class="text-danger">CSV의 지점명이 등록된 지점 이름과 일치하지 않습니다. 지점명: ' + Object.keys(byBranch).join(', ') + '</p>');
              return;
            }
            var BATCH = 400;
            var allInserts = [];
            inserts.forEach(function (obj) {
              for (var c = 0; c < obj.rows.length; c += BATCH) {
                allInserts.push({ branchId: obj.branchId, rows: obj.rows.slice(c, c + BATCH) });
              }
            });
            var seq = Promise.resolve();
            allInserts.forEach(function (o) {
              seq = seq.then(function () { return FX.insertSalesRecords(o.branchId, o.rows); });
            });
            seq.then(async function () {
              try {
                for (var ai = 0; ai < inserts.length; ai++) {
                  await FX.logUploadAudit(
                    inserts[ai].branchId,
                    'sales_upload',
                    inserts[ai].rows.length,
                    getUniqueFileSources(inserts[ai].rows),
                    {
                      upload_mode: 'multi_branch',
                      file_count: fileCount,
                      source: sourceName || 'manual'
                    }
                  );
                }
              } catch (auditErr) {
                console.warn('upload audit failed:', auditErr);
              }
              if (!isSalesViewActive()) return;
              var total = inserts.reduce(function (sum, obj) { return sum + obj.rows.length; }, 0);
              var msg = fileCount + '개 파일 처리, ' + inserts.map(function (obj) { return obj.branchName + ' ' + obj.rows.length + '건'; }).join(', ') + ' (총 ' + total + '건) 업로드 완료.';
              if (noBranchRows.length) msg += ' 지점 없음 ' + noBranchRows.length + '건 제외.';
              var branchBreakdown = inserts.map(function (obj) {
                var net = obj.rows.reduce(function (sum, r) { return sum + (parseInt(r.amount || 0, 10) || 0); }, 0);
                return { name: obj.branchName, count: obj.rows.length, net: net };
              });
              setUploadStatus(
                '<p class="text-success">' + msg + '</p>' +
                renderUploadValidationReport(allRows) +
                renderBranchBreakdownReport(branchBreakdown) +
                '<p class="text-muted">현재 화면을 유지합니다. 반영된 집계를 보려면 <strong>매출 데이터 새로고침</strong> 버튼을 눌러주세요.</p>'
              );
            }).catch(function (err) {
              if (!isSalesViewActive()) return;
              setUploadStatus('<p class="text-danger">업로드 실패: ' + (err.message || err) + '</p>');
            });
            return;
          }
          setUploadStatus(
            '<p class="text-warning">파일에 "지점" 또는 "지점명" 열이 없습니다. 전체 통합으로 지점별 분배하려면 CSV/엑셀에 지점 열을 추가해 주세요.</p>' +
            '<p class="text-muted">또는 위 <strong>업로드 대상</strong>에서 특정 지점을 선택한 뒤 다시 업로드하세요.</p>'
          );
        }
      }
      function isExcelFile(file) {
        var name = (file.name || '').toLowerCase();
        return name.endsWith('.xlsx') || name.endsWith('.xls') || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || file.type === 'application/vnd.ms-excel';
      }

      for (var i = 0; i < files.length; i++) {
        (function (file) {
          var reader = new FileReader();
          var sourceName = file.name || sourceName;
          reader.onload = function () {
            var parsed;
            if (isExcelFile(file)) {
              try {
                parsed = parseSalesXlsx(reader.result, file.name || sourceName);
              } catch (e) {
                parsed = { rows: [], error: (file.name || '알수없는 파일') + ': 파일 파싱 실패' };
                console.error('xlsx parse error', e);
              }
            } else {
              parsed = parseSalesCsv(reader.result, file.name || sourceName);
            }
            onOneDone(parsed);
          };
          reader.onerror = function () {
            onOneDone({ rows: [], error: (file.name || '알수없는 파일') + ': 파일 읽기 실패' });
          };
          if (isExcelFile(file)) reader.readAsArrayBuffer(file);
          else reader.readAsText(file, 'UTF-8');
        })(files[i]);
      }
    }

    inputFile.addEventListener('change', function () {
      var files = this.files;
      handleSalesFiles(files ? Array.prototype.slice.call(files) : [], '');
      this.value = '';
    });
    inputFolder.addEventListener('change', function () {
      var files = this.files;
      handleSalesFiles(files ? Array.prototype.slice.call(files) : [], 'folder');
      this.value = '';
    });
  }

  function normalizePaymentDate(s) {
    if (s == null) return '';
    if (typeof s === 'number') {
      var d = new Date((s - 25569) * 86400 * 1000);
      if (!isNaN(d.getTime())) return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      return '';
    }
    if (typeof s !== 'string') return '';
    s = s.trim();
    var m = s.match(/(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/);
    if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
    if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    m = s.match(/^(\d{8})$/);
    if (m) return m[1].slice(0, 4) + '-' + m[1].slice(4, 6) + '-' + m[1].slice(6, 8);
    return '';
  }

  function isValidDateOnly(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

  function parseMoneyValue(v) {
    if (v == null) return 0;
    if (typeof v === 'number' && !isNaN(v)) return Math.round(v);
    var s = String(v).trim();
    if (!s) return 0;
    var neg = false;
    if (s.indexOf('(') >= 0 && s.indexOf(')') >= 0) neg = true;
    if (s.indexOf('-') >= 0) neg = true;
    var n = parseInt(s.replace(/[^0-9]/g, ''), 10) || 0;
    return neg ? -n : n;
  }

  function hasValue(v) {
    return v != null && String(v).trim() !== '';
  }

  function computeNetSalesAmountDetail(row) {
    var paymentRaw = row['결제금액'];
    if (!hasValue(paymentRaw)) paymentRaw = row['금액'];
    if (!hasValue(paymentRaw)) paymentRaw = row['amount'];
    if (!hasValue(paymentRaw)) paymentRaw = row['매출'];
    var payment = parseMoneyValue(paymentRaw);

    var refundRaw = row['환불액'];
    if (!hasValue(refundRaw)) refundRaw = row['refund_amount'];
    if (!hasValue(refundRaw)) refundRaw = row['refund'];
    var hasRefund = hasValue(refundRaw);
    var refund = parseMoneyValue(refundRaw);

    var status = String(row['판매상태'] || row['sales_status'] || '').trim().toLowerCase();
    var isRefundStatus = status === '환불' || status === 'refund';

    // 순매출 = 결제금액 - 환불액
    // 환불액이 음수로 들어온 파일도 있어 부호를 보정한다.
    if (hasRefund) {
      return {
        amount: refund >= 0 ? (payment - refund) : (payment + refund),
        refundApplied: true
      };
    }
    if (isRefundStatus) {
      return {
        amount: -Math.abs(payment),
        refundApplied: true
      };
    }
    return {
      amount: payment,
      refundApplied: false
    };
  }

  function computeNetSalesAmount(row) {
    return computeNetSalesAmountDetail(row).amount;
  }

  function normalizeFileBaseName(fileSource) {
    var base = (fileSource || '').trim();
    base = base.split(/[/\\]/).pop() || base;
    // BOM/앞뒤 공백 제거
    base = base.replace(/^\uFEFF/, '').trim();
    try {
      if (base.normalize) base = base.normalize('NFC');
    } catch (e) {
      // ignore normalize failure
    }
    return base;
  }

  function detectCustomerTypeFromFileName(fileSource) {
    var base = normalizeFileBaseName(fileSource);
    // 요구사항: 파일명 맨 앞이 신규_ / 재등록_ 인 경우 해당 유형으로 분류
    if (/^신규_/.test(base)) return 'new';
    if (/^재등록_/.test(base)) return 're';
    // 실무 파일명 변형(공백/하이픈)도 허용
    if (/^\s*신규\s*[-_]/.test(base)) return 'new';
    if (/^\s*재등록\s*[-_]/.test(base)) return 're';
    return null;
  }

  function parseSalesRowsFromMatrix(rows, fileSource) {
    if (!rows || !rows.length) return [];
    var header = (rows[0] || []).map(function (c) { return (c != null ? String(c).trim() : ''); });
    var branchCol = header.filter(function (h) {
      var lower = (h || '').toLowerCase();
      return h === '지점' || h === '지점명' || h === 'branch_name' || h === 'branch' || lower === '지점' || lower === 'branch';
    })[0] || null;

    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var cells = rows[i] || [];
      var row = {};
      header.forEach(function (h, idx) {
        var v = cells[idx];
        row[h] = v != null ? (typeof v === 'number' ? v : String(v).trim()) : '';
      });

      var paymentDate = normalizePaymentDate(row['결제일시'] || row['결제일'] || row['payment_date'] || row['날짜'] || row['일자'] || '');
      var productName = row['판매상품'] || row['상품명'] || row['product_name'] || row['품목'] || '';
      var amountInfo = computeNetSalesAmountDetail(row);
      var amount = amountInfo.amount;
      if (!isValidDateOnly(paymentDate)) continue;

      var ptype = (row['구분'] || row['product_type'] || '').toUpperCase();
      if (ptype !== 'PT' && ptype !== 'FC') ptype = productName.indexOf('PT') >= 0 ? 'PT' : 'FC';

      var ctFromFile = detectCustomerTypeFromFileName(fileSource);
      var ctFromRow = String(row['고객유형'] || row['customer_type'] || '').trim();
      if (ctFromRow === '신규') ctFromRow = 'new'; else if (ctFromRow === '재등록') ctFromRow = 're'; else ctFromRow = null;

      var rec = {
        payment_date: paymentDate,
        product_name: productName,
        amount: amount,
        product_type: ptype,
        customer_type: ctFromFile != null ? ctFromFile : (ctFromRow || 'etc'),
        member_name: row['회원명'] || row['member_name'] || '',
        file_source: fileSource || '',
        _refund_applied: amountInfo.refundApplied
      };
      if (branchCol && row[branchCol] != null && String(row[branchCol]).trim()) rec._branch_name = String(row[branchCol]).trim();
      out.push(rec);
    }
    return out;
  }

  function hasAnyHeader(header, candidates) {
    return candidates.some(function (c) { return header.indexOf(c) >= 0; });
  }

  // ── 수익률 탭 ──
  async function renderProfitTab(container, renderVersion) {
    if (!isRenderActive(renderVersion)) return;
    var branchIds = getSelectedBranchIds();
    if (!branchIds.length) {
      container.innerHTML = emptyState('💹', '지점을 추가해주세요', '설정에서 지점을 추가하면 수익률을 확인할 수 있습니다.');
      return;
    }

    container.innerHTML = '<div class="text-center text-muted" style="padding:40px">수익률 데이터를 불러오는 중...</div>';
    var canEdit = !!_profile && (_profile.role === 'super' || _profile.role === 'brand' || _profile.role === 'branch');
    var fromAll = '2000-01-01';
    var toAll = '2100-12-31';

    var branchIdSet = {};
    branchIds.forEach(function (id) { branchIdSet[id] = true; });
    var selectedBranches = (_branches || []).filter(function (b) { return !!branchIdSet[b.id]; });
    if (!selectedBranches.length) {
      container.innerHTML = emptyState('💹', '지점 데이터가 없습니다', '지점 선택을 확인해 주세요.');
      return;
    }

    var groupMap = {};
    var groupKeyByBranchId = {};
    selectedBranches.forEach(function (b) {
      var gk = getBranchGroupKey(b) || ('id::' + b.id);
      if (!groupMap[gk]) {
        groupMap[gk] = {
          key: gk,
          name: b.name || '-',
          branchIds: []
        };
      }
      groupMap[gk].branchIds.push(b.id);
      groupKeyByBranchId[b.id] = gk;
    });

    var groups = Object.keys(groupMap).map(function (k) { return groupMap[k]; })
      .sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'ko'); });
    var allGroupBranchIds = [];
    groups.forEach(function (g) { allGroupBranchIds = allGroupBranchIds.concat(g.branchIds || []); });
    allGroupBranchIds = uniqueBranchIds(allGroupBranchIds);

    var useGroupDedup = needsSalesDedupForBranchIds(allGroupBranchIds);
    var [financials, salesRows] = await Promise.all([
      FX.listBranchFinancials(allGroupBranchIds),
      FX.getAllSalesRecords(allGroupBranchIds, fromAll, toAll, { mergeSameName: useGroupDedup })
    ]);
    if (!isRenderActive(renderVersion)) return;
    if (useGroupDedup) {
      // dedup RPC 미적용/실패 fallback 보호: 수익률 탭도 매출 탭과 동일 기준으로 중복 제거
      salesRows = dedupeSalesRecordsByMergedBranch(salesRows || [], allGroupBranchIds);
    }

    var financialsByBranchId = {};
    (financials || []).forEach(function (r) {
      if (!r || !r.branch_id) return;
      if (!financialsByBranchId[r.branch_id]) financialsByBranchId[r.branch_id] = [];
      financialsByBranchId[r.branch_id].push(r);
    });
    Object.keys(financialsByBranchId).forEach(function (bid) {
      financialsByBranchId[bid].sort(function (a, b) {
        var da = (a.contract_start_date || '').slice(0, 10);
        var db = (b.contract_start_date || '').slice(0, 10);
        return db.localeCompare(da);
      });
    });

    function getGroupFinancial(group) {
      var ids = group && group.branchIds ? group.branchIds : [];
      for (var i = 0; i < ids.length; i++) {
        var arr = financialsByBranchId[ids[i]];
        if (arr && arr.length) return arr[0];
      }
      return null;
    }

    function lastDayOfMonth(monthKey) {
      var y = parseInt((monthKey || '').slice(0, 4), 10);
      var m = parseInt((monthKey || '').slice(5, 7), 10);
      if (!y || !m) return '';
      var last = new Date(y, m, 0);
      return y + '-' + (m < 10 ? '0' : '') + m + '-' + (last.getDate() < 10 ? '0' : '') + last.getDate();
    }

    function getGroupFinancialForMonth(group, monthKey) {
      var ids = group && group.branchIds ? group.branchIds : [];
      var monthFirst = (monthKey || '').slice(0, 7) + '-01';
      var monthLast = lastDayOfMonth(monthKey);
      var best = null;
      var bestStart = '';
      for (var i = 0; i < ids.length; i++) {
        var arr = financialsByBranchId[ids[i]];
        if (!arr || !arr.length) continue;
        for (var j = 0; j < arr.length; j++) {
          var f = arr[j];
          var d = (f.contract_start_date || '').slice(0, 10);
          if (!d || d > monthFirst) continue;
          var end = (f.contract_end_date || '').slice(0, 10);
          if (end && end < monthLast) continue;
          if (d > bestStart) { bestStart = d; best = f; }
        }
      }
      return best;
    }

    function getGroupContractRows(group) {
      var ids = group && group.branchIds ? group.branchIds : [];
      var byStart = {};
      ids.forEach(function (bid) {
        var arr = financialsByBranchId[bid] || [];
        arr.forEach(function (f) {
          var d = (f.contract_start_date || '').slice(0, 10);
          if (d && !byStart[d]) byStart[d] = { branchId: bid, financial: f };
        });
      });
      var rows = Object.keys(byStart).sort().reverse().map(function (d) { return byStart[d]; });
      if (!rows.length && ids.length) rows = [{ branchId: ids[0], financial: null }];
      return rows;
    }
    // 그룹당 하나의 재무(평수)만 사용 — 지점 고정비 테이블과 동일 기준으로, 중복 브랜치 시 2배로 잡히는 문제 방지
    function getGroupTotalPyeong(group) {
      var f = getGroupFinancial(group);
      return f ? (parseFloat(f.area_pyeong || 0) || 0) : 0;
    }
    var totalPyeong = groups.reduce(function (acc, g) { return acc + getGroupTotalPyeong(g); }, 0);

    var salesByGroupMonth = {};
    var ptSalesByGroupMonth = {};
    (salesRows || []).forEach(function (r) {
      if (!r || !r.branch_id) return;
      var gk = groupKeyByBranchId[r.branch_id];
      if (!gk) return;
      var mk = salesMonthKey(r.payment_date);
      if (!mk) return;
      var amt = (parseInt(r.amount || 0, 10) || 0);
      if (!salesByGroupMonth[gk]) salesByGroupMonth[gk] = {};
      salesByGroupMonth[gk][mk] = (salesByGroupMonth[gk][mk] || 0) + amt;
      if (String(r.product_type || '').toUpperCase() === 'PT') {
        if (!ptSalesByGroupMonth[gk]) ptSalesByGroupMonth[gk] = {};
        ptSalesByGroupMonth[gk][mk] = (ptSalesByGroupMonth[gk][mk] || 0) + amt;
      }
    });

    var monthSet = {};
    Object.keys(salesByGroupMonth).forEach(function (gk) {
      Object.keys(salesByGroupMonth[gk] || {}).forEach(function (mk) { monthSet[mk] = true; });
    });
    var months = Object.keys(monthSet).sort();
    var fromStr = months.length ? months[0] + '-01' : '';
    var toStr = months.length ? lastDayOfMonth(months[months.length - 1]) : '';
    var dailyExpenseRows = [];
    if (fromStr && toStr && allGroupBranchIds.length) {
      dailyExpenseRows = await FX.listBranchDailyExpenses(allGroupBranchIds, fromStr, toStr);
    }
    if (!isRenderActive(renderVersion)) return;
    var expenseByMonth = {};
    (dailyExpenseRows || []).forEach(function (row) {
      var ym = (row.expense_date || '').slice(0, 7);
      if (!ym) return;
      expenseByMonth[ym] = (expenseByMonth[ym] || 0) + (parseInt(row.amount, 10) || 0);
    });
    var latestMonth = months.length ? months[months.length - 1] : '';
    var profitPartialInfo = getPartialMonthInfo(latestMonth);
    var latestMonthLabel = latestMonth ? (profitPartialInfo.isPartial ? profitPartialInfo.periodLabel : (latestMonth + ' 기준')) : '데이터 없음';

    var minDateByGroupMonth = {};
    var maxDateByGroupMonth = {};
    (salesRows || []).forEach(function (r) {
      if (!r || !r.payment_date) return;
      var gk = groupKeyByBranchId[r.branch_id];
      if (!gk) return;
      var mk = salesMonthKey(r.payment_date);
      if (!monthSet[mk]) return;
      var d = new Date(r.payment_date);
      if (isNaN(d.getTime())) return;
      if (!minDateByGroupMonth[gk]) minDateByGroupMonth[gk] = {};
      if (!maxDateByGroupMonth[gk]) maxDateByGroupMonth[gk] = {};
      if (!minDateByGroupMonth[gk][mk] || d.getTime() < minDateByGroupMonth[gk][mk].getTime()) minDateByGroupMonth[gk][mk] = new Date(d);
      if (!maxDateByGroupMonth[gk][mk] || d.getTime() > maxDateByGroupMonth[gk][mk].getTime()) maxDateByGroupMonth[gk][mk] = new Date(d);
    });
    function getDaysInMonth(mk) {
      var parts = (mk || '').split('-');
      var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
      if (!y || !m) return 30;
      return new Date(Date.UTC(y, m, 0)).getUTCDate();
    }
    function getProRationRatioForGroup(gk, mk) {
      var minD = minDateByGroupMonth[gk] && minDateByGroupMonth[gk][mk];
      var maxD = maxDateByGroupMonth[gk] && maxDateByGroupMonth[gk][mk];
      if (!minD || !maxD) return 1;
      var daysInMonth = getDaysInMonth(mk);
      var daysWithData = Math.round((maxD.getTime() - minD.getTime()) / (24 * 60 * 60 * 1000)) + 1;
      if (daysWithData <= 0) return 1;
      return Math.min(1, daysWithData / daysInMonth);
    }

    var monthlyTotals = months.map(function (mk) {
      var sales = 0;
      var fixed = 0;
      var ptSales = 0;
      var branchManagerPay = 0;
      groups.forEach(function (g) {
        var grpSales = (salesByGroupMonth[g.key] || {})[mk] || 0;
        sales += grpSales;
        ptSales += ((ptSalesByGroupMonth[g.key] || {})[mk] || 0);
        if (grpSales === 0) return;
        var ratio = getProRationRatioForGroup(g.key, mk);
        var f = getGroupFinancialForMonth(g, mk);
        var deposit = f ? (parseInt(f.deposit || 0, 10) || 0) : 0;
        var rent = f ? (parseInt(f.monthly_rent || 0, 10) || 0) : 0;
        var maint = f ? (parseInt(f.monthly_maintenance_fee || 0, 10) || 0) : 0;
        var extraArr = normalizeExtraFixedCosts(f && f.extra_fixed_costs);
        var extraSum = extraArr.reduce(function (s, i) { return s + (parseInt(i && i.amount, 10) || 0); }, 0);
        var depositMonthly = deposit * 0.064 / 12;
        var groupFixed = depositMonthly + rent + maint + extraSum;
        fixed += Math.round(groupFixed * ratio);
        var bmFixed = f ? (parseInt(f.branch_manager_fixed_salary, 10) || 0) : 0;
        var bmPct = f ? (parseFloat(f.branch_manager_sales_percent) || 0) : 0;
        branchManagerPay += Math.round((bmFixed + Math.round(grpSales * bmPct / 100)) * ratio);
      });
      var fcSales = sales - ptSales;
      var cogs = Math.round(ptSales * 0.7); // PT 매출의 70%를 매출원가로 반영
      var salesReserve5 = Math.round(sales * 0.05); // 매출의 5% 예비비
      var dailyExpenses = Math.round(expenseByMonth[mk] || 0); // 지출 탭 일별 지출 해당 월 합계
      var totalCost = fixed + branchManagerPay + cogs + salesReserve5 + dailyExpenses;
      var netSales = Math.round(sales / 1.1); // 부가세 10% 제외 (÷1.1)
      var profit = netSales - totalCost;
      var margin = netSales > 0 ? (profit / netSales * 100) : 0;
      var salesPerPyeong = totalPyeong > 0 ? Math.round(sales / totalPyeong) : null;
      var netSalesPerPyeong = totalPyeong > 0 ? Math.round(netSales / totalPyeong) : null;
      var costPerPyeong = totalPyeong > 0 ? Math.round(totalCost / totalPyeong) : null;
      var profitPerPyeong = totalPyeong > 0 ? Math.round(profit / totalPyeong) : null;
      return { month: mk, sales: sales, netSales: netSales, ptSales: ptSales, fcSales: fcSales, cogs: cogs, fixed: fixed, branchManagerPay: branchManagerPay, dailyExpenses: dailyExpenses, totalCost: totalCost, profit: profit, margin: margin, salesPerPyeong: salesPerPyeong, netSalesPerPyeong: netSalesPerPyeong, costPerPyeong: costPerPyeong, profitPerPyeong: profitPerPyeong };
    });

    var maxSales = 0, maxNetSales = 0, maxSalesPerPyeong = 0, maxPtSales = 0, maxFcSales = 0, maxCogs = 0, maxFixed = 0, maxBranchManagerPay = 0, maxDailyExpenses = 0, maxTotalCost = 0, maxAbsProfit = 0, maxCostPerPyeong = 0, maxAbsProfitPerPyeong = 0;
    monthlyTotals.forEach(function (r) {
      if (r.sales > maxSales) maxSales = r.sales;
      if ((r.netSales || 0) > maxNetSales) maxNetSales = r.netSales || 0;
      if (r.salesPerPyeong != null && r.salesPerPyeong > maxSalesPerPyeong) maxSalesPerPyeong = r.salesPerPyeong;
      var fcNet = Math.round((r.fcSales || 0) / 1.1), ptNet = Math.round(r.ptSales / 1.1);
      if (fcNet > maxFcSales) maxFcSales = fcNet;
      if (ptNet > maxPtSales) maxPtSales = ptNet;
      if (r.cogs > maxCogs) maxCogs = r.cogs;
      if (r.fixed > maxFixed) maxFixed = r.fixed;
      if ((r.branchManagerPay || 0) > maxBranchManagerPay) maxBranchManagerPay = r.branchManagerPay;
      if ((r.dailyExpenses || 0) > maxDailyExpenses) maxDailyExpenses = r.dailyExpenses || 0;
      if (r.totalCost > maxTotalCost) maxTotalCost = r.totalCost;
      var ap = Math.abs(r.profit);
      if (ap > maxAbsProfit) maxAbsProfit = ap;
      if (r.costPerPyeong != null && r.costPerPyeong > maxCostPerPyeong) maxCostPerPyeong = r.costPerPyeong;
      if (r.profitPerPyeong != null) {
        var app = Math.abs(r.profitPerPyeong);
        if (app > maxAbsProfitPerPyeong) maxAbsProfitPerPyeong = app;
      }
    });
    function profitBarCell(pct, color, text, rightAligned) {
      if (pct == null || pct < 0) pct = 0;
      if (pct > 100) pct = 100;
      var cls = 'profit-bar-bg' + (rightAligned ? ' profit-bar-bg--right' : '');
      var style = 'width:' + pct + '%;background:' + color + ';';
      return '<span class="' + cls + '" style="' + style + '"></span><span class="profit-bar-txt">' + text + '</span>';
    }

    var latest = monthlyTotals.length ? monthlyTotals[monthlyTotals.length - 1] : null;
    var latestSales = latest ? latest.sales : 0;
    var latestFixed = latest ? latest.fixed : 0;
    var latestCogs = latest ? latest.cogs : 0;
    var latestProfit = latest ? latest.profit : 0;
    var latestMargin = latest ? latest.margin : 0;
    var latestSalesPerPyeong = latest && latest.salesPerPyeong != null ? latest.salesPerPyeong : null;
    var latestProfitPerPyeong = latest && latest.profitPerPyeong != null ? latest.profitPerPyeong : null;

    var perGroupLatest = [];
    if (latestMonth) {
      groups.forEach(function (g) {
        var sales = (salesByGroupMonth[g.key] || {})[latestMonth] || 0;
        var ptSales = (ptSalesByGroupMonth[g.key] || {})[latestMonth] || 0;
        var f = getGroupFinancialForMonth(g, latestMonth);
        var deposit = f ? (parseInt(f.deposit || 0, 10) || 0) : 0;
        var rent = f ? (parseInt(f.monthly_rent || 0, 10) || 0) : 0;
        var maint = f ? (parseInt(f.monthly_maintenance_fee || 0, 10) || 0) : 0;
        var extraArr = normalizeExtraFixedCosts(f && f.extra_fixed_costs);
        var extraSum = extraArr.reduce(function (s, i) { return s + (parseInt(i && i.amount, 10) || 0); }, 0);
        var depositMonthly = deposit * 0.064 / 12;
        var fixed = depositMonthly + rent + maint + extraSum;
        var cogs = Math.round(ptSales * 0.7);
        var totalCost = fixed + cogs;
        var profit = sales - totalCost;
        var margin = sales > 0 ? (profit / sales * 100) : 0;
        var pyeong = getGroupTotalPyeong(g);
        var salesPerPyeong = pyeong > 0 ? Math.round(sales / pyeong) : null;
        var profitPerPyeong = pyeong > 0 ? Math.round(profit / pyeong) : null;
        perGroupLatest.push({ name: g.name, key: g.key, sales: sales, profit: profit, margin: margin, salesPerPyeong: salesPerPyeong, profitPerPyeong: profitPerPyeong, fixed: fixed });
      });
    }
    var maxMonthBySales = null, minMonthBySales = null, maxMonthByProfit = null, minMonthByProfit = null, maxMonthByMargin = null, minMonthByMargin = null;
    var maxSalesVal = -1, minSalesVal = 1/0, maxProfitVal = -1/0, minProfitVal = 1/0, maxMarginVal = -1, minMarginVal = 101;
    monthlyTotals.forEach(function (r) {
      if (r.sales > maxSalesVal) { maxSalesVal = r.sales; maxMonthBySales = r.month; }
      if (r.sales < minSalesVal) { minSalesVal = r.sales; minMonthBySales = r.month; }
      if (r.profit > maxProfitVal) { maxProfitVal = r.profit; maxMonthByProfit = r.month; }
      if (r.profit < minProfitVal) { minProfitVal = r.profit; minMonthByProfit = r.month; }
      if (r.margin > maxMarginVal) { maxMarginVal = r.margin; maxMonthByMargin = r.month; }
      if (r.margin < minMarginVal) { minMarginVal = r.margin; minMonthByMargin = r.month; }
    });
    if (minSalesVal === 1/0) minSalesVal = 0;
    if (minProfitVal === 1/0) minProfitVal = 0;

    var html = '<div class="profit-tab-scroll"><div class="card profit-card">';
    html += '<h3>수익률 관리</h3>';
    html += '<p class="text-muted">지점별 고정비(보증금 월세 환산·임차료·관리비·기타 고정비)·지점장 급여(고정급+매출%)와 매출을 결합해 영업이익/영업이익률을 확인합니다. 지점장 급여 = 고정급 + 해당월 매출×매출%. PT 매출의 70%는 매출원가로 반영됩니다. <strong>지출 탭</strong>에서 입력한 일별 지출은 해당 월 합계로 아래 표의 「지출(일별)」에 반영되며 총비용·영업이익에 포함됩니다.</p>';
    html += '<div class="profit-kpi-grid">';
    html += kpiCard('최근월 매출', fmtNum(Math.round(latestSales)), latestMonthLabel);
    html += kpiCard('최근월 영업이익', fmtNum(Math.round(latestProfit)), '매출 - 고정비');
    html += kpiCard('최근월 영업이익률', Math.round(latestMargin) + '%', latestMonth ? latestMonthLabel : '');
    html += kpiCard('최근월 평당 매출', latestSalesPerPyeong != null ? fmtNum(Math.round(latestSalesPerPyeong)) + '원/평' : '-', totalPyeong > 0 ? (latestMonth ? (profitPartialInfo.isPartial ? profitPartialInfo.periodLabel + ', 총 ' + Math.round(totalPyeong) + '평' : (latestMonth + ' 기준, 총 ' + Math.round(totalPyeong) + '평')) : '평수 입력 후 표시') : '평수 입력 후 표시');
    html += kpiCard('최근월 평당 영업이익', latestProfitPerPyeong != null ? fmtNum(Math.round(latestProfitPerPyeong)) + '원/평' : '-', totalPyeong > 0 ? latestMonthLabel : '평수 입력 후 표시');
    html += kpiCard('손익분기점 매출', fmtNum(Math.round((latest && latest.totalCost) || (latestFixed + latestCogs))), '최근월 총비용(고정비+지점장급여+원가) 기준');
    if (_currentBranch === '__all__' && groups.length > 0) {
      var branchCount = groups.length;
      var avgSalesPerBranch = Math.round(latestSales / branchCount);
      var avgProfitPerBranch = Math.round(latestProfit / branchCount);
      var avgPyeongPerBranch = totalPyeong > 0 ? (totalPyeong / branchCount) : 0;
      var sumDeposit = 0, sumRent = 0, sumMaint = 0;
      groups.forEach(function (g) {
        var f = getGroupFinancialForMonth(g, latestMonth);
        if (f) {
          sumDeposit += parseInt(f.deposit || 0, 10) || 0;
          sumRent += parseInt(f.monthly_rent || 0, 10) || 0;
          sumMaint += parseInt(f.monthly_maintenance_fee || 0, 10) || 0;
        }
      });
      var avgDepositPerBranch = Math.round(sumDeposit / branchCount);
      var avgRentPerBranch = Math.round(sumRent / branchCount);
      var avgMaintPerBranch = Math.round(sumMaint / branchCount);
      html += kpiCard('현재 지점수', branchCount + '개 지점', '전체 통합 기준');
      html += kpiCard('지점당 평균 매출', fmtNum(avgSalesPerBranch), latestMonthLabel);
      html += kpiCard('지점당 평균 영업이익', fmtNum(avgProfitPerBranch), latestMonthLabel);
      html += kpiCard('지점당 평균 평수', avgPyeongPerBranch > 0 ? (Math.round(avgPyeongPerBranch * 10) / 10) + '평' : '-', '전체 통합 기준');
      html += kpiCard('지점당 평균 보증금', fmtNum(avgDepositPerBranch), latestMonthLabel);
      html += kpiCard('지점당 평균 임차료', fmtNum(avgRentPerBranch), latestMonthLabel);
      html += kpiCard('지점당 평균 관리비', fmtNum(avgMaintPerBranch), latestMonthLabel);
    }
    html += '</div>';
    html += '</div>';

    html += '<div class="card profit-card">';
    html += '<h3 class="table-title">지점 고정비 입력</h3>';
    html += '<div class="profit-table-wrap">';
    var selBranch = document.getElementById('sel-branch-global');
    var isAllIntegrated = selBranch && selBranch.value === '__all__' && groups.length > 1;
    html += '<table class="profit-table"><thead><tr>';
    html += '<th style="text-align:left">지점</th><th>계약 시작일</th><th>계약 종료일</th><th>평수</th><th>보증금</th><th>보증금 월세 환산</th><th>임차료</th><th>관리비</th><th>기타 고정비</th><th>지점장 고정급</th><th>지점장 매출%</th><th>총 고정비</th><th>상태</th>';
    html += '</tr></thead><tbody>';
    function depositMonthlyConvert(depositVal) {
      return (parseInt(depositVal || 0, 10) || 0) * 0.064 / 12;
    }
    function sumExtraFixedCosts(extra) {
      if (!Array.isArray(extra)) return 0;
      return extra.reduce(function (s, i) { return s + (parseInt(i && i.amount, 10) || 0); }, 0);
    }
    /** API/저장소에서 오는 extra_fixed_costs를 항상 배열로 정규화 */
    function normalizeExtraFixedCosts(raw) {
      if (raw == null) return [];
      if (Array.isArray(raw)) return raw;
      if (typeof raw === 'string') {
        try { var a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch (e) { return []; }
      }
      return [];
    }
    var rowExtrasByKey = {};
    var rowExtrasByOrder = [];
    if (isAllIntegrated) {
      var totalArea = 0, totalDeposit = 0, totalDepositMonthly = 0, totalRent = 0, totalMaint = 0, totalExtra = 0;
      groups.forEach(function (g) {
        var f = getGroupFinancial(g);
        totalArea += f ? (parseFloat(f.area_pyeong || 0) || 0) : 0;
        totalDeposit += f ? (parseInt(f.deposit || 0, 10) || 0) : 0;
        totalDepositMonthly += f ? depositMonthlyConvert(f.deposit) : 0;
        totalRent += f ? (parseInt(f.monthly_rent || 0, 10) || 0) : 0;
        totalMaint += f ? (parseInt(f.monthly_maintenance_fee || 0, 10) || 0) : 0;
        totalExtra += f ? sumExtraFixedCosts(normalizeExtraFixedCosts(f.extra_fixed_costs)) : 0;
      });
      var totalFixed = totalDepositMonthly + totalRent + totalMaint + totalExtra;
      html += '<tr>';
      html += '<td style="text-align:left;font-weight:700">전체 통합</td>';
      html += '<td class="text-muted">-</td>';
      html += '<td class="text-muted">-</td>';
      html += '<td>' + Math.round(totalArea) + '</td>';
      html += '<td>' + fmtNum(totalDeposit) + '</td>';
      html += '<td>' + fmtNum(Math.round(totalDepositMonthly)) + '</td>';
      html += '<td>' + fmtNum(totalRent) + '</td>';
      html += '<td>' + fmtNum(totalMaint) + '</td>';
      html += '<td>' + fmtNum(totalExtra) + '</td>';
      html += '<td class="text-muted">-</td>';
      html += '<td class="text-muted">-</td>';
      html += '<td>' + fmtNum(Math.round(totalFixed)) + '</td>';
      html += '<td class="text-muted">조회 전용 (개별 수정은 지점 선택 후)</td>';
      html += '</tr>';
    } else {
      groups.forEach(function (g) {
        var contractRows = getGroupContractRows(g);
        contractRows.forEach(function (row) {
          var f = row.financial;
          var contractStart = f ? ((f.contract_start_date || '').toString().slice(0, 10)) : '';
          var contractEnd = f && f.contract_end_date ? ((f.contract_end_date || '').toString().slice(0, 10)) : '';
          var area = f ? (parseFloat(f.area_pyeong || 0) || 0) : 0;
          var deposit = f ? (parseInt(f.deposit || 0, 10) || 0) : 0;
          var rent = f ? (parseInt(f.monthly_rent || 0, 10) || 0) : 0;
          var maint = f ? (parseInt(f.monthly_maintenance_fee || 0, 10) || 0) : 0;
          var extraList = normalizeExtraFixedCosts(f && f.extra_fixed_costs);
          rowExtrasByKey[g.key + '|' + contractStart] = extraList.slice();
          if (canEdit) rowExtrasByOrder.push(extraList.slice());
          var extraSum = sumExtraFixedCosts(extraList);
          var bmFixed = f ? (parseInt(f.branch_manager_fixed_salary, 10) || 2000000) : 2000000;
          var bmPct = f ? (parseFloat(f.branch_manager_sales_percent) || 3) : 3;
          var depositMonthly = depositMonthlyConvert(deposit);
          var totalFixed = depositMonthly + rent + maint + extraSum;
          var extraJson = esc(JSON.stringify(extraList));
          html += '<tr data-group-key="' + esc(g.key) + '" data-branch-id="' + esc(row.branchId) + '" data-contract-start-date="' + esc(contractStart) + '" data-extra-fixed-costs="' + extraJson + '">';
          html += '<td style="text-align:left;font-weight:700">' + esc(g.name) + '</td>';
          if (canEdit) {
            html += '<td><input class="profit-input profit-input-date" type="date" data-group-key="' + esc(g.key) + '" data-branch-id="' + esc(row.branchId) + '" data-contract-start-date="' + esc(contractStart) + '" data-field="contract_start_date" value="' + esc(contractStart) + '"></td>';
            html += '<td><input class="profit-input profit-input-date" type="date" data-group-key="' + esc(g.key) + '" data-branch-id="' + esc(row.branchId) + '" data-contract-start-date="' + esc(contractStart) + '" data-field="contract_end_date" value="' + esc(contractEnd) + '" placeholder="미정"></td>';
            html += '<td><input class="profit-input profit-input-comma-decimal" type="text" inputmode="decimal" data-group-key="' + esc(g.key) + '" data-branch-id="' + esc(row.branchId) + '" data-contract-start-date="' + esc(contractStart) + '" data-field="area" value="' + fmtNum(area) + '" placeholder="0" title="평수"></td>';
            html += '<td><input class="profit-input profit-input-comma" type="text" inputmode="numeric" data-group-key="' + esc(g.key) + '" data-branch-id="' + esc(row.branchId) + '" data-contract-start-date="' + esc(contractStart) + '" data-field="deposit" value="' + fmtNum(deposit) + '" placeholder="0"></td>';
            html += '<td class="profit-deposit-monthly" data-group-key="' + esc(g.key) + '" data-contract-start-date="' + esc(contractStart) + '">' + fmtNum(Math.round(depositMonthly)) + '</td>';
            html += '<td><input class="profit-input profit-input-comma" type="text" inputmode="numeric" data-group-key="' + esc(g.key) + '" data-branch-id="' + esc(row.branchId) + '" data-contract-start-date="' + esc(contractStart) + '" data-field="rent" value="' + fmtNum(rent) + '" placeholder="0"></td>';
            html += '<td><input class="profit-input profit-input-comma" type="text" inputmode="numeric" data-group-key="' + esc(g.key) + '" data-branch-id="' + esc(row.branchId) + '" data-contract-start-date="' + esc(contractStart) + '" data-field="maint" value="' + fmtNum(maint) + '" placeholder="0"></td>';
            html += '<td class="profit-extra-cell" data-group-key="' + esc(g.key) + '" data-contract-start-date="' + esc(contractStart) + '"><span class="profit-extra-summary">' + (extraList.length ? extraList.length + '건 ' + fmtNum(extraSum) + '원' : '-') + '</span> <button type="button" class="btn btn-outline btn-sm btn-extra-fixed-costs" data-group-key="' + esc(g.key) + '" data-branch-id="' + esc(row.branchId) + '" data-contract-start-date="' + esc(contractStart) + '">추가</button></td>';
            html += '<td><input class="profit-input profit-input-comma" type="text" inputmode="numeric" data-group-key="' + esc(g.key) + '" data-branch-id="' + esc(row.branchId) + '" data-contract-start-date="' + esc(contractStart) + '" data-field="branch_manager_fixed_salary" value="' + fmtNum(bmFixed) + '" title="지점장 월 고정급(원)" placeholder="0"></td>';
            html += '<td><input class="profit-input profit-input-comma" type="text" inputmode="numeric" data-group-key="' + esc(g.key) + '" data-branch-id="' + esc(row.branchId) + '" data-contract-start-date="' + esc(contractStart) + '" data-field="branch_manager_sales_percent" value="' + fmtNum(bmPct) + '" title="매출의 n%" placeholder="0"></td>';
            html += '<td class="profit-total-rental" data-group-key="' + esc(g.key) + '" data-contract-start-date="' + esc(contractStart) + '">' + fmtNum(Math.round(totalFixed)) + '</td>';
            html += '<td><button type="button" class="btn btn-outline btn-sm btn-save-profit-row" data-group-key="' + esc(g.key) + '" data-branch-id="' + esc(row.branchId) + '" data-contract-start-date="' + esc(contractStart) + '">저장</button> ';
            if (contractStart) {
              html += '<button type="button" class="btn btn-outline btn-sm btn-danger btn-delete-profit-row" data-group-key="' + esc(g.key) + '" data-contract-start-date="' + esc(contractStart) + '" title="이 계약 행 삭제">삭제</button> ';
            }
            html += '<div class="profit-row-msg" data-group-key="' + esc(g.key) + '" data-contract-start-date="' + esc(contractStart) + '"></div></td>';
          } else {
            html += '<td>' + (contractStart || '-') + '</td>';
            html += '<td>' + (contractEnd || '-') + '</td>';
            html += '<td>' + Math.round(area) + '</td>';
            html += '<td>' + fmtNum(deposit) + '</td>';
            html += '<td>' + fmtNum(Math.round(depositMonthly)) + '</td>';
            html += '<td>' + fmtNum(rent) + '</td>';
            html += '<td>' + fmtNum(maint) + '</td>';
            html += '<td>' + (extraList.length ? extraList.length + '건 ' + fmtNum(extraSum) + '원' : '-') + '</td>';
            html += '<td>' + fmtNum(bmFixed) + '</td>';
            html += '<td>' + bmPct + '%</td>';
            html += '<td>' + fmtNum(Math.round(totalFixed)) + '</td>';
            html += '<td class="text-muted">조회 전용</td>';
          }
          html += '</tr>';
        });
        if (canEdit) {
          html += '<tr class="profit-add-row" data-group-key="' + esc(g.key) + '"><td colspan="13" style="text-align:left"><button type="button" class="btn btn-outline btn-sm btn-add-contract" data-group-key="' + esc(g.key) + '">+ 계약 추가 (재계약 시)</button></td></tr>';
        }
      });
    }
    html += '</tbody></table></div></div>';

    html += '<div class="card profit-card">';
    html += '<h3 class="table-title">월별 수익성</h3>';
    if (!months.length) {
      html += '<p class="text-muted">매출 데이터가 없어 수익성을 계산할 수 없습니다.</p>';
    } else {
      html += '<div class="profit-table-wrap">';
      html += '<table class="profit-table"><thead><tr>';
      html += '<th style="text-align:left">월</th><th>매출</th><th title="부가세 10% 제외 (÷1.1)">매출(부가세 10% 제외)</th><th>FC매출</th><th>PT매출</th><th>매출원가(PT70%)</th><th>총 고정비</th><th>지점장 급여</th><th title="지출 탭에서 입력한 일별 지출 해당 월 합계">지출(일별)</th><th>총비용</th><th>영업이익</th><th>영업이익률</th><th>평당 매출</th><th>평당 비용</th><th>평당 영업이익</th>';
      html += '</tr></thead><tbody>';
      monthlyTotals.forEach(function (r) {
        var salesPct = maxSales > 0 ? (r.sales / maxSales * 100) : 0;
        var netSalesPct = maxNetSales > 0 ? ((r.netSales || 0) / maxNetSales * 100) : 0;
        var salesPerPyeongPct = maxSalesPerPyeong > 0 && r.salesPerPyeong != null ? (r.salesPerPyeong / maxSalesPerPyeong * 100) : 0;
        var fcNet = Math.round((r.fcSales || 0) / 1.1), ptNet = Math.round(r.ptSales / 1.1);
        var fcSalesPct = maxFcSales > 0 ? (fcNet / maxFcSales * 100) : 0;
        var ptSalesPct = maxPtSales > 0 ? (ptNet / maxPtSales * 100) : 0;
        var cogsPct = maxCogs > 0 ? (r.cogs / maxCogs * 100) : 0;
        var fixedPct = maxFixed > 0 ? (r.fixed / maxFixed * 100) : 0;
        var bmPayPct = maxBranchManagerPay > 0 ? ((r.branchManagerPay || 0) / maxBranchManagerPay * 100) : 0;
        var dailyExpPct = maxDailyExpenses > 0 ? ((r.dailyExpenses || 0) / maxDailyExpenses * 100) : 0;
        var totalCostPct = maxTotalCost > 0 ? (r.totalCost / maxTotalCost * 100) : 0;
        var profitPct = maxAbsProfit > 0 ? (Math.abs(r.profit) / maxAbsProfit * 100) : 0;
        var profitColor = r.profit >= 0 ? '#86efac' : '#fca5a5';
        var profitPerPyeongPct = maxAbsProfitPerPyeong > 0 && r.profitPerPyeong != null ? (Math.abs(r.profitPerPyeong) / maxAbsProfitPerPyeong * 100) : 0;
        var costPerPyeongPct = maxCostPerPyeong > 0 && r.costPerPyeong != null ? (r.costPerPyeong / maxCostPerPyeong * 100) : 0;
        var marginPct = Math.min(100, Math.abs(r.margin));
        var marginRight = r.margin < 0;
        html += '<tr>';
        html += '<td style="text-align:left;font-weight:700">' + esc(r.month) + '</td>';
        html += '<td class="profit-td-bar">' + profitBarCell(salesPct, '#93c5fd', fmtNum(Math.round(r.sales)), false) + '</td>';
        html += '<td class="profit-td-bar">' + profitBarCell(netSalesPct, '#93c5fd', fmtNum(Math.round(r.netSales || 0)), false) + '</td>';
        html += '<td class="profit-td-bar">' + profitBarCell(fcSalesPct, '#3b82f6', fmtNum(fcNet), false) + '</td>';
        html += '<td class="profit-td-bar">' + profitBarCell(ptSalesPct, '#fdba74', fmtNum(ptNet), false) + '</td>';
        html += '<td class="profit-td-bar">' + profitBarCell(cogsPct, '#e2e8f0', fmtNum(Math.round(r.cogs)), false) + '</td>';
        html += '<td class="profit-td-bar">' + profitBarCell(fixedPct, '#cbd5e1', fmtNum(Math.round(r.fixed)), false) + '</td>';
        html += '<td class="profit-td-bar">' + profitBarCell(bmPayPct, '#a78bfa', fmtNum(Math.round(r.branchManagerPay || 0)), false) + '</td>';
        html += '<td class="profit-td-bar" title="지출 탭 일별 지출 해당 월 합계">' + profitBarCell(dailyExpPct, '#fcd34d', fmtNum(Math.round(r.dailyExpenses || 0)), false) + '</td>';
        html += '<td class="profit-td-bar">' + profitBarCell(totalCostPct, '#94a3b8', fmtNum(Math.round(r.totalCost)), false) + '</td>';
        html += '<td class="profit-td-bar profit-cell-' + (r.profit >= 0 ? 'positive' : 'negative') + '">' + profitBarCell(profitPct, profitColor, fmtNum(Math.round(r.profit)), false) + '</td>';
        html += '<td class="profit-td-bar profit-cell-' + (r.margin >= 0 ? 'positive' : 'negative') + '">' + profitBarCell(marginPct, profitColor, Math.round(r.margin) + '%', marginRight) + '</td>';
        html += '<td class="profit-td-bar">' + (r.salesPerPyeong != null ? profitBarCell(salesPerPyeongPct, '#93c5fd', fmtNum(Math.round(r.salesPerPyeong)) + '원/평', false) : '<span class="profit-bar-txt">-</span>') + '</td>';
        html += '<td class="profit-td-bar">' + (r.costPerPyeong != null ? profitBarCell(costPerPyeongPct, '#94a3b8', fmtNum(Math.round(r.costPerPyeong)) + '원/평', false) : '<span class="profit-bar-txt">-</span>') + '</td>';
        html += '<td class="profit-td-bar profit-cell-' + (r.profit >= 0 ? 'positive' : 'negative') + '">' + (r.profitPerPyeong != null ? profitBarCell(profitPerPyeongPct, profitColor, fmtNum(Math.round(r.profitPerPyeong)) + '원/평', false) : '<span class="profit-bar-txt">-</span>') + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table></div>';
    }

    html += '<div class="card profit-card insights-card"><h3 class="table-title">💡 수익률 인사이트</h3>';
    var insightItems = [];
    if (monthlyTotals.length && latestMonth) {
      var avgSales = monthlyTotals.reduce(function (s, r) { return s + r.sales; }, 0) / monthlyTotals.length;
      var avgProfit = monthlyTotals.reduce(function (s, r) { return s + r.profit; }, 0) / monthlyTotals.length;
      var avgMargin = monthlyTotals.reduce(function (s, r) { return s + r.margin; }, 0) / monthlyTotals.length;
      insightItems.push('<span class="tag tag-info">📊</span> <strong>전체 요약 (' + monthlyTotals.length + '개월)</strong>');
      insightItems.push('<div class="insight-item"><span class="tag tag-info">📈</span> 월평균 매출 <strong>' + fmtNum(Math.round(avgSales)) + '원</strong> · 최고 <strong>' + (maxMonthBySales || '-') + '</strong> ' + fmtNum(Math.round(maxSalesVal)) + '원 · 최저 <strong>' + (minMonthBySales || '-') + '</strong> ' + fmtNum(Math.round(minSalesVal)) + '원</div>');
      insightItems.push('<div class="insight-item"><span class="tag tag-info">💰</span> 월평균 영업이익 <strong>' + fmtNum(Math.round(avgProfit)) + '원</strong> · 최고 <strong>' + (maxMonthByProfit || '-') + '</strong> ' + fmtNum(Math.round(maxProfitVal)) + '원 · 최저 <strong>' + (minMonthByProfit || '-') + '</strong> ' + fmtNum(Math.round(minProfitVal)) + '원</div>');
      insightItems.push('<div class="insight-item"><span class="tag tag-info">📉</span> 월평균 영업이익률 <strong>' + Math.round(avgMargin) + '%</strong> · 최고 <strong>' + (maxMonthByMargin || '-') + '</strong> ' + Math.round(maxMarginVal) + '% · 최저 <strong>' + (minMonthByMargin || '-') + '</strong> ' + Math.round(minMarginVal) + '%</div>');

      var latestFixed = latest ? latest.fixed : 0;
      var breakEven = latest ? latest.totalCost : (latestFixed + (latest ? latest.cogs : 0));
      var salesVsAvg = avgSales > 0 ? ((latestSales - avgSales) / avgSales * 100) : 0;
      var marginVsAvg = ((latestMargin - avgMargin));
      var recent3 = monthlyTotals.slice(-3);
      var trendSales = recent3.length >= 2 ? (recent3[recent3.length - 1].sales - recent3[recent3.length - 2].sales) / (recent3[recent3.length - 2].sales || 1) * 100 : 0;
      var trendMargin = recent3.length >= 2 ? (recent3[recent3.length - 1].margin - recent3[recent3.length - 2].margin) : 0;
      insightItems.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.15);margin:8px 0">');
      insightItems.push('<span class="tag tag-warn">🔍</span> <strong>해석 (최근월 ' + latestMonthLabel + ')</strong>');
      if (latestSales >= breakEven * 1.5) {
        insightItems.push('<div class="insight-item"><span class="tag tag-up">✓</span> 매출이 손익분기점(' + fmtNum(Math.round(breakEven)) + '원) 대비 <strong>약 ' + (latestSales > 0 ? Math.round(latestSales / breakEven * 100) : 0) + '%</strong>로 여유 있습니다. 고정비 부담이 상대적으로 낮은 편입니다.</div>');
      } else if (latestSales >= breakEven) {
        insightItems.push('<div class="insight-item"><span class="tag tag-info">!</span> 매출이 손익분기점(' + fmtNum(Math.round(breakEven)) + '원)을 상회하나 여유는 많지 않습니다. 매출 확대 또는 비용 조정을 검토해 보세요.</div>');
      } else {
        insightItems.push('<div class="insight-item"><span class="tag tag-down">⚠</span> 최근월 매출이 손익분기점(' + fmtNum(Math.round(breakEven)) + '원) 미만입니다. 매출 증대 또는 고정비·원가 절감이 필요합니다.</div>');
      }
      if (salesVsAvg >= 10) {
        insightItems.push('<div class="insight-item"><span class="tag tag-up">▲</span> 최근월 매출이 월평균 대비 <strong>+' + Math.round(salesVsAvg) + '%</strong>로 상승했습니다.</div>');
      } else if (salesVsAvg <= -10) {
        insightItems.push('<div class="insight-item"><span class="tag tag-down">▼</span> 최근월 매출이 월평균 대비 <strong>' + Math.round(salesVsAvg) + '%</strong>로 감소했습니다. 요인 점검이 필요할 수 있습니다.</div>');
      }
      if (trendSales >= 5 && recent3.length >= 2) {
        insightItems.push('<div class="insight-item"><span class="tag tag-up">📈</span> 전월 대비 매출 <strong>+' + Math.round(trendSales) + '%</strong>로 증가 추세입니다.</div>');
      } else if (trendSales <= -5 && recent3.length >= 2) {
        insightItems.push('<div class="insight-item"><span class="tag tag-down">📉</span> 전월 대비 매출 <strong>' + Math.round(trendSales) + '%</strong>로 감소했습니다.</div>');
      }
      if (marginVsAvg >= 5) {
        insightItems.push('<div class="insight-item"><span class="tag tag-up">✓</span> 최근월 영업이익률이 월평균 대비 <strong>+' + Math.round(marginVsAvg) + '%p</strong> 높아 수익성이 좋은 편입니다.</div>');
      } else if (marginVsAvg <= -5) {
        insightItems.push('<div class="insight-item"><span class="tag tag-down">!</span> 최근월 영업이익률이 월평균 대비 <strong>' + Math.round(marginVsAvg) + '%p</strong> 낮습니다. 원가·고정비를 점검해 보세요.</div>');
      }
      if (trendMargin >= 3 && recent3.length >= 2) {
        insightItems.push('<div class="insight-item"><span class="tag tag-up">✓</span> 전월 대비 영업이익률 <strong>+' + Math.round(trendMargin) + '%p</strong> 개선되었습니다.</div>');
      } else if (trendMargin <= -3 && recent3.length >= 2) {
        insightItems.push('<div class="insight-item"><span class="tag tag-down">!</span> 전월 대비 영업이익률 <strong>' + Math.round(trendMargin) + '%p</strong> 하락했습니다.</div>');
      }

      if (perGroupLatest.length > 1) {
        insightItems.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.15);margin:8px 0">');
        insightItems.push('<div class="insight-item"><span class="tag tag-info">📊</span> <strong>비교 지표</strong>: 아래 지점별 최근월에서 <strong>전체 지점 평균 대비</strong>(매출·영업이익률)와 <strong>가장 좋은 실적 지점 대비</strong>(최고 매출·최고 영업이익률 대비 %)를 확인할 수 있습니다.</div>');
        var gAvgSales = perGroupLatest.reduce(function (s, x) { return s + x.sales; }, 0) / perGroupLatest.length;
        var gAvgMargin = perGroupLatest.reduce(function (s, x) { return s + x.margin; }, 0) / perGroupLatest.length;
        var gAvgProfit = perGroupLatest.reduce(function (s, x) { return s + x.profit; }, 0) / perGroupLatest.length;
        var maxG = perGroupLatest.reduce(function (best, x) { return !best || x.sales > best.sales ? x : best; }, null);
        var minG = perGroupLatest.reduce(function (best, x) { return !best || x.sales < best.sales ? x : best; }, null);
        var maxMarginG = perGroupLatest.reduce(function (best, x) { return !best || x.margin > best.margin ? x : best; }, null);
        var minMarginG = perGroupLatest.reduce(function (best, x) { return !best || x.margin < best.margin ? x : best; }, null);
        insightItems.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.15);margin:8px 0">');
        insightItems.push('<span class="tag tag-info">🏪</span> <strong>지점별 최근월 (' + latestMonthLabel + ')</strong>');
        insightItems.push('<div class="insight-item">전체 지점 평균: 매출 <strong>' + fmtNum(Math.round(gAvgSales)) + '원</strong> · 영업이익 <strong>' + fmtNum(Math.round(gAvgProfit)) + '원</strong> · 영업이익률 <strong>' + Math.round(gAvgMargin) + '%</strong></div>');
        insightItems.push('<div class="insight-item">최고 매출 지점: <strong>' + esc(maxG ? maxG.name : '-') + '</strong> ' + (maxG ? fmtNum(Math.round(maxG.sales)) + '원' : '') + ' · 최저 매출 지점: <strong>' + esc(minG ? minG.name : '-') + '</strong> ' + (minG ? fmtNum(Math.round(minG.sales)) + '원' : '') + '</div>');
        insightItems.push('<div class="insight-item">최고 영업이익률 지점: <strong>' + esc(maxMarginG ? maxMarginG.name : '-') + '</strong> ' + (maxMarginG ? Math.round(maxMarginG.margin) + '%' : '') + ' · 최저 영업이익률 지점: <strong>' + esc(minMarginG ? minMarginG.name : '-') + '</strong> ' + (minMarginG ? Math.round(minMarginG.margin) + '%' : '') + '</div>');
        var minVsBestSalesPct = (maxG && minG && maxG.sales > 0) ? Math.round(minG.sales / maxG.sales * 100) : null;
        var minVsBestMarginPct = (maxMarginG && minMarginG && maxMarginG.margin > 0) ? Math.round(minMarginG.margin / maxMarginG.margin * 100) : null;
        if (minVsBestSalesPct != null || minVsBestMarginPct != null) {
          var bestVsParts = [];
          if (minVsBestSalesPct != null) bestVsParts.push('최저 매출 지점은 최고(' + esc(maxG.name) + ') 대비 <strong>' + minVsBestSalesPct + '%</strong>');
          if (minVsBestMarginPct != null) bestVsParts.push('최저 영업이익률 지점은 최고(' + esc(maxMarginG.name) + ') 대비 <strong>' + minVsBestMarginPct + '%</strong>');
          insightItems.push('<div class="insight-item"><span class="tag tag-info">📊</span> <strong>최고 지점 대비</strong>: ' + bestVsParts.join(' · ') + '</div>');
        }
        insightItems.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:6px 0">');
        insightItems.push('<span class="tag tag-warn">📍</span> <strong>지점별 한줄 요약 · 해석</strong> (전체 지점 평균 대비 · 최고 지점 대비)');
        perGroupLatest.forEach(function (x) {
          var vsAvg = gAvgMargin > 0 ? (x.margin - gAvgMargin) : 0;
          var vsSales = gAvgSales > 0 ? (x.sales - gAvgSales) / gAvgSales * 100 : 0;
          var vsClass = vsAvg >= 0 ? 'tag-up' : 'tag-down';
          var vsText = vsAvg >= 0 ? ('평균 대비 +' + Math.round(vsAvg) + '%p') : ('평균 대비 ' + Math.round(vsAvg) + '%p');
          var vsBestSales = (maxG && maxG.sales > 0) ? Math.round(x.sales / maxG.sales * 100) : null;
          var vsBestMargin = (maxMarginG && maxMarginG.margin > 0) ? Math.round(x.margin / maxMarginG.margin * 100) : null;
          var vsBestText = [];
          if (vsBestSales != null) vsBestText.push('최고(' + esc(maxG.name) + ') 대비 매출 ' + vsBestSales + '%');
          if (vsBestMargin != null) vsBestText.push('영업이익률 ' + vsBestMargin + '%');
          var comment = '';
          if (vsAvg >= 5 && vsSales >= 10) comment = ' · <span class="text-muted">매출·수익률 모두 평균 이상</span>';
          else if (vsAvg >= 5) comment = ' · <span class="text-muted">수익성 양호</span>';
          else if (vsAvg <= -5 && vsSales <= -10) comment = ' · <span class="text-muted">매출·수익률 개선 검토</span>';
          else if (vsAvg <= -5) comment = ' · <span class="text-muted">영업이익률 개선 여지 있음</span>';
          else if (vsSales >= 15) comment = ' · <span class="text-muted">매출 우수</span>';
          else if (vsSales <= -15) comment = ' · <span class="text-muted">매출 확대 검토</span>';
          insightItems.push('<div class="insight-item"><strong>' + esc(x.name) + '</strong>: 매출 ' + fmtNum(Math.round(x.sales)) + '원 · 영업이익 ' + fmtNum(Math.round(x.profit)) + '원 · 영업이익률 <strong>' + Math.round(x.margin) + '%</strong> <span class="tag ' + vsClass + '">' + vsText + '</span>' + (vsBestText.length ? ' <span class="tag tag-info">' + vsBestText.join(' · ') + '</span>' : '') + comment + '</div>');
        });
      } else if (perGroupLatest.length === 1) {
        var x = perGroupLatest[0];
        insightItems.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:6px 0">');
        insightItems.push('<div class="insight-item"><strong>' + esc(x.name) + '</strong> (최근월 ' + latestMonthLabel + '): 매출 ' + fmtNum(Math.round(x.sales)) + '원 · 영업이익 ' + fmtNum(Math.round(x.profit)) + '원 · 영업이익률 <strong>' + Math.round(x.margin) + '%</strong>' + (x.salesPerPyeong != null ? ' · 평당 매출 ' + fmtNum(x.salesPerPyeong) + '원/평' : '') + '</div>');
        if (latestFixed > 0 && x.sales > 0) {
          var cover = Math.round(x.sales / latestFixed * 100);
          if (cover >= 150) insightItems.push('<div class="insight-item"><span class="tag tag-up">✓</span> 매출이 고정비의 <strong>' + cover + '%</strong>로, 고정비 부담 대비 충분한 매출을 올리고 있습니다.</div>');
          else if (cover < 100) insightItems.push('<div class="insight-item"><span class="tag tag-down">!</span> 매출이 고정비의 <strong>' + cover + '%</strong>로, 손익분기점 미달입니다. 매출 증대가 필요합니다.</div>');
        }
      }
    } else {
      insightItems.push('<div class="insight-item text-muted">매출·고정비 데이터가 있으면 월별 요약과 지점별 인사이트가 표시됩니다.</div>');
    }
    insightItems.forEach(function (item) { html += item; });
    html += '</div>';

    html += '<div class="card profit-card insights-card"><h3 class="table-title">🤖 Gemini AI 인사이트</h3>';
    html += '<p class="text-muted">수익률 요약을 바탕으로 AI가 인사이트를 생성합니다.</p>';
    html += '<div class="profit-ai-insight-block" style="margin-top:12px;min-height:40px;white-space:pre-wrap;line-height:1.5"></div>';
    html += '<button type="button" class="btn btn-primary profit-ai-insight-btn" style="margin-top:8px">AI 인사이트 생성</button>';
    html += '</div></div>';

    container.innerHTML = html;
    container._profitRowExtrasByKey = rowExtrasByKey;
    container.querySelectorAll('.btn-extra-fixed-costs').forEach(function (bindBtn, idx) {
      bindBtn._extraFixedCosts = (rowExtrasByOrder[idx] || []).slice();
    });

    var aiBlock = container.querySelector('.profit-ai-insight-block');
    var aiBtn = container.querySelector('.profit-ai-insight-btn');
    if (aiBtn && aiBlock) {
      aiBtn.addEventListener('click', async function () {
        var summary = {
          latestMonth: latestMonth,
          monthlyTotals: (monthlyTotals || []).map(function (r) {
            return { month: r.month, sales: r.sales, profit: r.profit, margin: r.margin, fixed: r.fixed, branchManagerPay: r.branchManagerPay, cogs: r.cogs, totalCost: r.totalCost };
          }),
          perGroupLatest: (perGroupLatest || []).map(function (x) {
            return { name: x.name, sales: x.sales, profit: x.profit, margin: x.margin };
          }),
          breakEven: latest ? latest.totalCost : undefined,
          latestSales: latestSales,
          avgSales: monthlyTotals.length ? monthlyTotals.reduce(function (s, r) { return s + r.sales; }, 0) / monthlyTotals.length : undefined,
          avgProfit: monthlyTotals.length ? monthlyTotals.reduce(function (s, r) { return s + r.profit; }, 0) / monthlyTotals.length : undefined,
          avgMargin: monthlyTotals.length ? monthlyTotals.reduce(function (s, r) { return s + r.margin; }, 0) / monthlyTotals.length : undefined
        };
        if (profitPartialInfo.isPartial) {
          summary.currentMonthIncomplete = true;
          summary.currentMonthNote = profitPartialInfo.noteForAI;
        }
        aiBtn.disabled = true;
        aiBlock.textContent = '생성 중...';
        (async function () {
          var result = { ok: false };
          try {
            var token = (typeof CONFIG !== 'undefined' && CONFIG.SUPABASE_ANON_KEY) ? CONFIG.SUPABASE_ANON_KEY : '';
            var url = (typeof CONFIG !== 'undefined' && CONFIG.SUPABASE_URL ? CONFIG.SUPABASE_URL : '') + '/functions/v1/profitability-insight';
            var res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
              body: JSON.stringify({ summary: summary }),
            });
            var text = await res.text();
            if (text) try { result = JSON.parse(text); } catch (_) {}
            if (!res.ok && !result.error) result = { ok: false, error: 'Edge Function 오류', detail: 'HTTP ' + res.status + '. Supabase 대시보드 → Edge Functions → profitability-insight → Logs 확인.' };
          } catch (e) {
            result = { ok: false, error: '요청 실패', detail: (e && e.message) ? e.message : String(e) };
          }
          if (result.ok && result.insight) {
            aiBlock.textContent = result.insight;
          } else if (result.error) {
            aiBlock.textContent = result.detail ? (result.error + ': ' + result.detail) : result.error;
          } else {
            aiBlock.textContent = '인사이트를 생성하지 못했습니다.';
          }
          aiBtn.disabled = false;
        })();
      });
    }

    if (!canEdit) return;
    function updateRentalSummary(gk, contractStart) {
      var row = container.querySelector('tr[data-group-key="' + gk + '"][data-contract-start-date="' + (contractStart || '') + '"]');
      var extra = [];
      try { if (row && row.getAttribute('data-extra-fixed-costs')) extra = JSON.parse(row.getAttribute('data-extra-fixed-costs')); } catch (e) {}
      var extraSum = sumExtraFixedCosts(extra);
      var sel = '.profit-input[data-group-key="' + gk + '"][data-contract-start-date="' + (contractStart || '') + '"]';
      var depositEl = container.querySelector(sel + '[data-field="deposit"]');
      var rentEl = container.querySelector(sel + '[data-field="rent"]');
      var maintEl = container.querySelector(sel + '[data-field="maint"]');
      var depositMonthlyEl = container.querySelector('.profit-deposit-monthly[data-group-key="' + gk + '"][data-contract-start-date="' + (contractStart || '') + '"]');
      var totalRentalEl = container.querySelector('.profit-total-rental[data-group-key="' + gk + '"][data-contract-start-date="' + (contractStart || '') + '"]');
      var deposit = parseNumberWithCommas(depositEl && depositEl.value);
      var rent = parseNumberWithCommas(rentEl && rentEl.value);
      var maint = parseNumberWithCommas(maintEl && maintEl.value);
      var depositMonthly = deposit * 0.064 / 12;
      var totalFixed = depositMonthly + rent + maint + extraSum;
      if (depositMonthlyEl) depositMonthlyEl.textContent = fmtNum(Math.round(depositMonthly));
      if (totalRentalEl) totalRentalEl.textContent = fmtNum(Math.round(totalFixed));
      var extraCell = container.querySelector('.profit-extra-cell[data-group-key="' + gk + '"][data-contract-start-date="' + (contractStart || '') + '"]');
      if (extraCell) { var sp = extraCell.querySelector('.profit-extra-summary'); if (sp) sp.textContent = extra.length ? extra.length + '건 ' + fmtNum(extraSum) + '원' : '-'; }
    }
    container.querySelectorAll('.profit-input-comma').forEach(function (input) {
      input.addEventListener('focus', function () { this.value = String(parseNumberWithCommas(this.value)); });
      input.addEventListener('blur', function () { this.value = fmtNum(parseNumberWithCommas(this.value)); });
    });
    container.querySelectorAll('.profit-input-comma-decimal').forEach(function (input) {
      input.addEventListener('focus', function () { this.value = String(parseFloatWithCommas(this.value)); });
      input.addEventListener('blur', function () { this.value = fmtNum(parseFloatWithCommas(this.value)); });
    });
    container.querySelectorAll('.profit-input[data-field="deposit"], .profit-input[data-field="rent"], .profit-input[data-field="maint"]').forEach(function (input) {
      var gk = input.getAttribute('data-group-key');
      var cs = input.getAttribute('data-contract-start-date') || '';
      if (!gk) return;
      input.addEventListener('input', function () { updateRentalSummary(gk, cs); });
    });
    container.querySelectorAll('.btn-save-profit-row').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var gk = btn.getAttribute('data-group-key');
        var group = groups.find(function (x) { return x.key === gk; });
        if (!group || !group.branchIds || !group.branchIds.length) return;
        var contractStart = btn.getAttribute('data-contract-start-date') || '';
        var rowSel = '[data-group-key="' + gk + '"][data-contract-start-date="' + contractStart + '"]';
        var areaEl = container.querySelector('.profit-input' + rowSel + '[data-field="area"]');
        var dateEl = container.querySelector('.profit-input' + rowSel + '[data-field="contract_start_date"]');
        var endDateEl = container.querySelector('.profit-input' + rowSel + '[data-field="contract_end_date"]');
        var depositEl = container.querySelector('.profit-input' + rowSel + '[data-field="deposit"]');
        var rentEl = container.querySelector('.profit-input' + rowSel + '[data-field="rent"]');
        var maintEl = container.querySelector('.profit-input' + rowSel + '[data-field="maint"]');
        var bmFixedEl = container.querySelector('.profit-input' + rowSel + '[data-field="branch_manager_fixed_salary"]');
        var bmPctEl = container.querySelector('.profit-input' + rowSel + '[data-field="branch_manager_sales_percent"]');
        var msgEl = container.querySelector('.profit-row-msg[data-group-key="' + gk + '"][data-contract-start-date="' + contractStart + '"]');
        var rowEl = container.querySelector('tr' + rowSel);
        var extraFixedCosts = [];
        try { if (rowEl && rowEl.getAttribute('data-extra-fixed-costs')) extraFixedCosts = JSON.parse(rowEl.getAttribute('data-extra-fixed-costs')); } catch (e) {}
        var area = parseFloatWithCommas(areaEl && areaEl.value);
        var saveContractStart = (dateEl && dateEl.value) ? dateEl.value.slice(0, 10) : (contractStart || new Date().toISOString().slice(0, 10));
        var saveContractEnd = (endDateEl && endDateEl.value) ? endDateEl.value.slice(0, 10) : '';
        var deposit = parseNumberWithCommas(depositEl && depositEl.value);
        var rent = parseNumberWithCommas(rentEl && rentEl.value);
        var maint = parseNumberWithCommas(maintEl && maintEl.value);
        var bmFixed = parseNumberWithCommas(bmFixedEl && bmFixedEl.value);
        if (bmFixed < 0) bmFixed = 2000000;
        var bmPct = parseFloatWithCommas(bmPctEl && bmPctEl.value);
        if (isNaN(bmPct) || bmPct < 0) bmPct = 3;
        if (bmPct > 100) bmPct = 100;
        if (isNaN(area) || area < 0 || deposit < 0 || rent < 0 || maint < 0) {
          if (msgEl) { msgEl.style.color = '#dc2626'; msgEl.textContent = '음수 없이 입력해 주세요.'; }
          return;
        }
        btn.disabled = true;
        if (msgEl) { msgEl.style.color = '#64748b'; msgEl.textContent = '저장 중...'; }
        try {
          for (var i = 0; i < group.branchIds.length; i++) {
            await FX.upsertBranchFinancial(group.branchIds[i], {
              contract_start_date: saveContractStart,
              contract_end_date: saveContractEnd || null,
              area_pyeong: area,
              deposit: deposit,
              monthly_rent: rent,
              monthly_maintenance_fee: maint,
              extra_fixed_costs: extraFixedCosts,
              branch_manager_fixed_salary: bmFixed,
              branch_manager_sales_percent: bmPct
            });
          }
          if (msgEl) { msgEl.style.color = '#16a34a'; msgEl.textContent = '저장 완료'; }
          renderCurrentTab();
        } catch (e) {
          if (msgEl) { msgEl.style.color = '#dc2626'; msgEl.textContent = '저장 실패: ' + (e && e.message ? e.message : String(e)); }
        } finally {
          btn.disabled = false;
        }
      });
    });
    container.querySelectorAll('.btn-add-contract').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var gk = btn.getAttribute('data-group-key');
        var group = groups.find(function (x) { return x.key === gk; });
        if (!group || !group.branchIds || !group.branchIds.length) return;
        var nextDate = (function () {
          var d = new Date();
          d.setMonth(d.getMonth() + 1);
          var y = d.getFullYear();
          var m = d.getMonth() + 1;
          return y + '-' + (m < 10 ? '0' : '') + m + '-01';
        })();
        btn.disabled = true;
        try {
          for (var i = 0; i < group.branchIds.length; i++) {
            await FX.upsertBranchFinancial(group.branchIds[i], {
              contract_start_date: nextDate,
              contract_end_date: '',
              area_pyeong: 0,
              deposit: 0,
              monthly_rent: 0,
              monthly_maintenance_fee: 0,
              extra_fixed_costs: [],
              branch_manager_fixed_salary: 2000000,
              branch_manager_sales_percent: 3
            });
          }
          renderCurrentTab();
        } catch (e) {
          console.error(e);
        } finally {
          btn.disabled = false;
        }
      });
    });
    container.querySelectorAll('.btn-extra-fixed-costs').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var rowEl = btn.closest('tr');
        if (!rowEl) return;
        var gk = btn.getAttribute('data-group-key');
        var contractStart = btn.getAttribute('data-contract-start-date') || '';
        var extra = Array.isArray(btn._extraFixedCosts) ? btn._extraFixedCosts.slice() : (function () {
          try {
            var raw = rowEl.getAttribute('data-extra-fixed-costs');
            return normalizeExtraFixedCosts(raw != null && raw !== '' ? JSON.parse(raw) : []);
          } catch (e) { return []; }
        })();
        if (!Array.isArray(extra)) extra = [];
        var group = groups.find(function (x) { return x.key === gk; });
        if (!group || !group.branchIds || !group.branchIds.length) return;

        var overlay = document.createElement('div');
        overlay.className = 'fx-modal-overlay';
        var listHtml = '';
        var itemsToShow = extra.length ? extra : [{ name: '', amount: 0 }];
        itemsToShow.forEach(function (item) {
          listHtml += '<div class="profit-extra-list-row">' +
            '<input type="text" class="profit-extra-name" placeholder="항목명(예: 렌탈료)" value="' + esc(String(item.name || '')) + '">' +
            '<input type="text" class="profit-extra-amount profit-input-comma" inputmode="numeric" placeholder="금액" value="' + (item.amount ? fmtNum(item.amount) : '0') + '">' +
            '<button type="button" class="btn btn-outline btn-sm btn-extra-delete-row">삭제</button></div>';
        });
        var totalSum = extra.reduce(function (s, i) { return s + (parseInt(i && i.amount, 10) || 0); }, 0);
        overlay.innerHTML = '<div class="fx-modal" style="max-width:420px">' +
          '<div class="fx-modal-header"><h4>기타 고정비</h4></div>' +
          '<div class="fx-modal-body">' +
          '<p class="text-muted" style="margin-bottom:8px">렌탈료, 월급 등 월별 고정비를 항목별로 추가하세요.</p>' +
          (extra.length > 0 ? '<p class="profit-extra-modal-summary" style="margin-bottom:12px;font-weight:600">총 <strong>' + extra.length + '건</strong> · 합계 ' + fmtNum(totalSum) + '원</p>' : '') +
          '<div class="profit-extra-list">' + listHtml + '</div>' +
          '<button type="button" class="btn btn-outline btn-sm btn-extra-add-row" style="margin-top:8px">+ 행 추가</button>' +
          '</div>' +
          '<div class="fx-modal-footer">' +
          '<button type="button" class="btn btn-primary btn-extra-save">저장</button> ' +
          '<button type="button" class="btn btn-outline" data-act="close">취소</button>' +
          '</div></div>';
        document.body.appendChild(overlay);

        var listEl = overlay.querySelector('.profit-extra-list');
        function addRow() {
          var div = document.createElement('div');
          div.className = 'profit-extra-list-row';
          div.innerHTML = '<input type="text" class="profit-extra-name" placeholder="항목명(예: 렌탈료)" value="">' +
            '<input type="text" class="profit-extra-amount profit-input-comma" inputmode="numeric" placeholder="금액" value="0">' +
            '<button type="button" class="btn btn-outline btn-sm btn-extra-delete-row">삭제</button>';
          listEl.appendChild(div);
          div.querySelector('.btn-extra-delete-row').addEventListener('click', function () { div.remove(); });
          var amtInput = div.querySelector('.profit-extra-amount');
          if (amtInput) {
            amtInput.addEventListener('focus', function () { this.value = String(parseNumberWithCommas(this.value)); });
            amtInput.addEventListener('blur', function () { this.value = fmtNum(parseNumberWithCommas(this.value)); });
          }
        }
        overlay.querySelectorAll('.profit-extra-amount').forEach(function (amtInput) {
          amtInput.addEventListener('focus', function () { this.value = String(parseNumberWithCommas(this.value)); });
          amtInput.addEventListener('blur', function () { this.value = fmtNum(parseNumberWithCommas(this.value)); });
        });
        overlay.querySelectorAll('.btn-extra-delete-row').forEach(function (b) {
          b.addEventListener('click', function () { b.closest('.profit-extra-list-row').remove(); });
        });
        overlay.querySelector('.btn-extra-add-row').addEventListener('click', addRow);

        function closeModal() { overlay.remove(); }
        overlay.querySelectorAll('[data-act="close"]').forEach(function (b) { b.addEventListener('click', closeModal); });

        overlay.querySelector('.btn-extra-save').addEventListener('click', async function () {
          var rows = listEl.querySelectorAll('.profit-extra-list-row');
          var newExtra = [];
          for (var i = 0; i < rows.length; i++) {
            var name = (rows[i].querySelector('.profit-extra-name').value || '').trim();
            var amount = parseNumberWithCommas(rows[i].querySelector('.profit-extra-amount').value);
            if (amount < 0) amount = 0;
            if (name || amount) newExtra.push({ name: name || '항목', amount: amount });
          }
          rowEl.setAttribute('data-extra-fixed-costs', JSON.stringify(newExtra));
          if (container._profitRowExtrasByKey) container._profitRowExtrasByKey[gk + '|' + contractStart] = newExtra.slice();
          btn._extraFixedCosts = newExtra.slice();
          updateRentalSummary(gk, contractStart);

          var rowSel = '[data-group-key="' + gk + '"][data-contract-start-date="' + contractStart + '"]';
          var areaEl = container.querySelector('.profit-input' + rowSel + '[data-field="area"]');
          var dateEl = container.querySelector('.profit-input' + rowSel + '[data-field="contract_start_date"]');
          var endDateEl = container.querySelector('.profit-input' + rowSel + '[data-field="contract_end_date"]');
          var depositEl = container.querySelector('.profit-input' + rowSel + '[data-field="deposit"]');
          var rentEl = container.querySelector('.profit-input' + rowSel + '[data-field="rent"]');
          var maintEl = container.querySelector('.profit-input' + rowSel + '[data-field="maint"]');
          var bmFixedEl = container.querySelector('.profit-input' + rowSel + '[data-field="branch_manager_fixed_salary"]');
          var bmPctEl = container.querySelector('.profit-input' + rowSel + '[data-field="branch_manager_sales_percent"]');
          var area = parseFloatWithCommas(areaEl && areaEl.value);
          var saveContractStart = (dateEl && dateEl.value) ? dateEl.value.slice(0, 10) : contractStart;
          var saveContractEnd = (endDateEl && endDateEl.value) ? endDateEl.value.slice(0, 10) : '';
          var deposit = parseNumberWithCommas(depositEl && depositEl.value);
          var rent = parseNumberWithCommas(rentEl && rentEl.value);
          var maint = parseNumberWithCommas(maintEl && maintEl.value);
          var bmFixed = parseNumberWithCommas(bmFixedEl && bmFixedEl.value);
          if (bmFixed < 0) bmFixed = 2000000;
          var bmPct = parseFloatWithCommas(bmPctEl && bmPctEl.value);
          if (isNaN(bmPct) || bmPct < 0) bmPct = 3;
          if (bmPct > 100) bmPct = 100;
          var saveBtn = overlay.querySelector('.btn-extra-save');
          saveBtn.disabled = true;
          try {
            for (var j = 0; j < group.branchIds.length; j++) {
              await FX.upsertBranchFinancial(group.branchIds[j], {
                contract_start_date: saveContractStart,
                contract_end_date: saveContractEnd || null,
                area_pyeong: area,
                deposit: deposit,
                monthly_rent: rent,
                monthly_maintenance_fee: maint,
                extra_fixed_costs: newExtra,
                branch_manager_fixed_salary: bmFixed,
                branch_manager_sales_percent: bmPct
              });
            }
            closeModal();
          } catch (e) {
            alert('저장 실패: ' + (e && e.message ? e.message : String(e)));
          } finally {
            saveBtn.disabled = false;
          }
        });
      });
    });
    container.querySelectorAll('.btn-delete-profit-row').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var gk = btn.getAttribute('data-group-key');
        var contractStart = btn.getAttribute('data-contract-start-date') || '';
        if (!contractStart) return;
        if (!confirm('이 계약(' + contractStart + ') 행을 삭제할까요? 삭제 후에는 복구할 수 없습니다.')) return;
        var group = groups.find(function (x) { return x.key === gk; });
        if (!group || !group.branchIds || !group.branchIds.length) return;
        btn.disabled = true;
        try {
          for (var i = 0; i < group.branchIds.length; i++) {
            await FX.deleteBranchFinancial(group.branchIds[i], contractStart);
          }
          renderCurrentTab();
        } catch (e) {
          alert('삭제 실패: ' + (e && e.message ? e.message : String(e)));
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  // ── 지출 탭 (일별 기록) ──
  async function renderExpensesTab(container, renderVersion) {
    if (!isRenderActive(renderVersion)) return;
    var branchIds = getSelectedBranchIds();
    if (!branchIds.length) {
      container.innerHTML = emptyState('📋', '지점을 추가해주세요', '설정에서 지점을 추가하면 지출을 기록할 수 있습니다.');
      return;
    }

    var now = new Date();
    var thisMonthStart = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
    var todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

    function getRangeForPreset(preset) {
      var from, to;
      if (preset === 'this_month') {
        from = thisMonthStart;
        to = todayStr;
      } else if (preset === 'last_7') {
        to = todayStr;
        var d = new Date(now);
        d.setDate(d.getDate() - 6);
        from = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      } else if (preset === 'last_30') {
        to = todayStr;
        var d30 = new Date(now);
        d30.setDate(d30.getDate() - 29);
        from = d30.getFullYear() + '-' + String(d30.getMonth() + 1).padStart(2, '0') + '-' + String(d30.getDate()).padStart(2, '0');
      } else if (preset === 'last_month') {
        var lm = new Date(now.getFullYear(), now.getMonth(), 0);
        from = lm.getFullYear() + '-' + String(lm.getMonth() + 1).padStart(2, '0') + '-01';
        to = lm.getFullYear() + '-' + String(lm.getMonth() + 1).padStart(2, '0') + '-' + String(lm.getDate()).padStart(2, '0');
      } else {
        from = thisMonthStart;
        to = todayStr;
      }
      return { from: from, to: to };
    }

    var savedPreset = (container && container._expensesPreset) ? container._expensesPreset : 'this_month';
    var currentRange = getRangeForPreset(savedPreset);

    var EXPENSE_CATEGORY_DEFAULTS = ['소모품비', '접대비', '교통비', '통신비', '급여', '상여·복리', '임대료', '관리비', '수선비', '보험료', '광고·선전비', '소득세·지방세 등', '기타'];

    async function openAddModal() {
      var categoryOptions = EXPENSE_CATEGORY_DEFAULTS.slice();
      try {
        var counts = await FX.getExpenseCategoryCounts(branchIds, 30);
        var fromCounts = (counts || []).map(function (c) { return c.expense_category; }).filter(Boolean);
        var seen = {};
        categoryOptions.forEach(function (k) { seen[k] = true; });
        fromCounts.forEach(function (k) {
          if (k && !seen[k]) { seen[k] = true; categoryOptions.push(k); }
        });
      } catch (e) { /* ignore */ }
      var datalistId = 'expense-add-category-list';
      var datalistOpts = categoryOptions.map(function (k) { return '<option value="' + esc(k) + '">'; }).join('');
      var overlay = document.createElement('div');
      overlay.className = 'fx-modal-overlay';
      var branchOptions = (_branches || []).filter(function (b) { return branchIds.indexOf(b.id) >= 0; }).map(function (b) {
        return '<option value="' + esc(b.id) + '">' + esc(b.name || '-') + '</option>';
      }).join('');
      overlay.innerHTML = '<div class="fx-modal" style="max-width:420px">' +
        '<div class="fx-modal-header"><h4>지출 추가</h4></div>' +
        '<div class="fx-modal-body">' +
        '<p class="text-muted" style="margin-bottom:8px">지점·일자·금액·지출 방법을 입력하세요.</p>' +
        '<div style="margin-bottom:10px"><label>지점</label><select class="expense-modal-branch form-control" style="width:100%">' + branchOptions + '</select></div>' +
        '<div style="margin-bottom:10px"><label>일자</label><input type="date" class="expense-modal-date form-control" value="' + todayStr + '"></div>' +
        '<div style="margin-bottom:10px"><label>금액(원)</label><input type="text" class="expense-modal-amount form-control profit-input-comma" inputmode="numeric" placeholder="0" value="0"></div>' +
        '<div style="margin-bottom:10px"><label>지출 방법</label><select class="expense-modal-payment-method form-control"><option value="card">카드</option><option value="transfer">계좌이체</option></select></div>' +
        '<div class="expense-modal-transfer-fields" style="display:none; margin-bottom:10px">' +
        '<div style="margin-bottom:8px"><label>은행명</label><input type="text" class="expense-modal-bank-name form-control" placeholder="은행명"></div>' +
        '<div style="margin-bottom:8px"><label>계좌번호</label><input type="text" class="expense-modal-account-number form-control" placeholder="계좌번호"></div>' +
        '<div style="margin-bottom:8px"><label>예금주</label><input type="text" class="expense-modal-account-holder form-control" placeholder="예금주"></div>' +
        '</div>' +
        '<div style="margin-bottom:10px"><label>항목</label><input type="text" class="expense-modal-category form-control" list="' + datalistId + '" placeholder="회계 항목 선택 또는 입력"><datalist id="' + datalistId + '">' + datalistOpts + '</datalist></div>' +
        '<div style="margin-bottom:10px"><label>내용</label><input type="text" class="expense-modal-content form-control" placeholder="내용"></div>' +
        '<div style="margin-bottom:10px"><label>메모(비고)</label><input type="text" class="expense-modal-memo form-control" placeholder="비고"></div>' +
        (isBranchRole ? '<div class="form-group" style="margin-bottom:10px"><label class="fx-checkbox-label"><input type="checkbox" class="expense-modal-also-request" checked> 결의 신청도 함께 하기</label><p class="text-muted form-hint" style="margin:4px 0 0">의사결정권자 승인/반려 후 계좌이체는 회계관리자, 카드는 지점장이 결제 완료를 표시합니다.</p></div>' : '') +
        (isBranchRole ? '<div style="margin-bottom:10px"><label>첨부 이미지 (결의 시, 여러 장 선택 가능)</label><input type="file" class="expense-modal-attachments form-control" accept="image/jpeg,image/png,image/gif,image/webp" multiple><p class="text-muted form-hint" style="margin:4px 0 0;font-size:12px">결의 신청도 함께 할 때만 적용됩니다. 여러 장 선택 가능.</p></div>' : '') +
        '</div>' +
        '<div class="fx-modal-footer">' +
        '<button type="button" class="btn btn-primary expense-modal-save">저장</button> ' +
        '<button type="button" class="btn btn-outline" data-act="close">취소</button>' +
        '</div></div>';
      document.body.appendChild(overlay);
      var amountEl = overlay.querySelector('.expense-modal-amount');
      amountEl.addEventListener('focus', function () { this.value = String(parseNumberWithCommas(this.value)); });
      amountEl.addEventListener('blur', function () { this.value = fmtNum(parseNumberWithCommas(this.value)); });
      var paymentMethodSelect = overlay.querySelector('.expense-modal-payment-method');
      var transferFields = overlay.querySelector('.expense-modal-transfer-fields');
      function toggleTransferFields() {
        transferFields.style.display = paymentMethodSelect.value === 'transfer' ? 'block' : 'none';
      }
      paymentMethodSelect.addEventListener('change', toggleTransferFields);
      toggleTransferFields();
      function closeModal() { overlay.remove(); }
      overlay.querySelectorAll('[data-act="close"]').forEach(function (b) { b.addEventListener('click', closeModal); });
      overlay.querySelector('.expense-modal-save').addEventListener('click', async function () {
        var branchId = overlay.querySelector('.expense-modal-branch').value;
        var dateVal = overlay.querySelector('.expense-modal-date').value;
        var amount = parseNumberWithCommas(overlay.querySelector('.expense-modal-amount').value);
        var expenseCategory = (overlay.querySelector('.expense-modal-category').value || '').trim();
        var content = (overlay.querySelector('.expense-modal-content').value || '').trim();
        var memo = (overlay.querySelector('.expense-modal-memo').value || '').trim();
        var paymentMethod = overlay.querySelector('.expense-modal-payment-method').value;
        var bankName = (overlay.querySelector('.expense-modal-bank-name').value || '').trim();
        var accountNumber = (overlay.querySelector('.expense-modal-account-number').value || '').trim();
        var accountHolder = (overlay.querySelector('.expense-modal-account-holder').value || '').trim();
        var alsoRequest = isBranchRole && overlay.querySelector('.expense-modal-also-request') && overlay.querySelector('.expense-modal-also-request').checked;
        if (!branchId || !dateVal) { alert('지점과 일자를 선택해 주세요.'); return; }
        if (amount < 0) amount = 0;
        var saveBtn = overlay.querySelector('.expense-modal-save');
        saveBtn.disabled = true;
        try {
          await FX.insertBranchDailyExpense({
            branch_id: branchId,
            expense_date: dateVal,
            amount: amount,
            expense_category: expenseCategory || null,
            content: content || null,
            memo: memo || null,
            payment_method: paymentMethod,
            bank_name: paymentMethod === 'transfer' ? (bankName || null) : null,
            account_number: paymentMethod === 'transfer' ? (accountNumber || null) : null,
            account_holder: paymentMethod === 'transfer' ? (accountHolder || null) : null
          });
          if (alsoRequest) {
            var created = await FX.insertExpenseRequest({
              branch_id: branchId,
              amount: amount,
              memo: (expenseCategory ? expenseCategory + ' ' : '') + memo || null,
              payment_type: paymentMethod,
              bank_name: paymentMethod === 'transfer' ? (bankName || null) : null,
              account_number: paymentMethod === 'transfer' ? (accountNumber || null) : null,
              account_holder: paymentMethod === 'transfer' ? (accountHolder || null) : null
            });
            var fileInput = overlay.querySelector('.expense-modal-attachments');
            var files = fileInput && fileInput.files ? Array.prototype.slice.call(fileInput.files) : [];
            if (created && created.id && files.length) {
              var urls = await FX.uploadExpenseRequestAttachments(created.id, files);
              if (urls.length) await FX.updateExpenseRequestAttachmentUrls(created.id, urls);
            }
          }
          closeModal();
          renderExpensesTab(container, renderVersion);
        } catch (e) {
          alert('저장 실패: ' + (e && e.message ? e.message : String(e)));
        } finally {
          saveBtn.disabled = false;
        }
      });
    }

    function openEditModal(row) {
      var overlay = document.createElement('div');
      overlay.className = 'fx-modal-overlay';
      var branchName = (row.branches && row.branches.name) ? row.branches.name : '-';
      var pm = (row.payment_method === 'transfer' || row.payment_method === 'card') ? row.payment_method : 'card';
      var isTransfer = pm === 'transfer';
      var editCategoryOptions = EXPENSE_CATEGORY_DEFAULTS.slice();
      if (row.expense_category && editCategoryOptions.indexOf(row.expense_category) < 0) editCategoryOptions.push(row.expense_category);
      var editDatalistId = 'expense-edit-category-list';
      var editDatalistOpts = editCategoryOptions.map(function (k) { return '<option value="' + esc(k) + '">'; }).join('');
      overlay.innerHTML = '<div class="fx-modal" style="max-width:420px">' +
        '<div class="fx-modal-header"><h4>지출 수정</h4></div>' +
        '<div class="fx-modal-body">' +
        '<p class="text-muted" style="margin-bottom:8px">' + esc(branchName) + ' · ' + (row.expense_date || '') + '</p>' +
        '<div style="margin-bottom:10px"><label>일자</label><input type="date" class="expense-edit-date form-control" value="' + (row.expense_date || '') + '"></div>' +
        '<div style="margin-bottom:10px"><label>금액(원)</label><input type="text" class="expense-edit-amount form-control profit-input-comma" inputmode="numeric" value="' + fmtNum(row.amount || 0) + '"></div>' +
        '<div style="margin-bottom:10px"><label>지출 방법</label><select class="expense-edit-payment-method form-control"><option value="card"' + (pm === 'card' ? ' selected' : '') + '>카드</option><option value="transfer"' + (pm === 'transfer' ? ' selected' : '') + '>계좌이체</option></select></div>' +
        '<div class="expense-edit-transfer-fields" style="' + (isTransfer ? '' : 'display:none;') + ' margin-bottom:10px">' +
        '<div style="margin-bottom:8px"><label>은행명</label><input type="text" class="expense-edit-bank-name form-control" placeholder="은행명" value="' + esc(row.bank_name || '') + '"></div>' +
        '<div style="margin-bottom:8px"><label>계좌번호</label><input type="text" class="expense-edit-account-number form-control" placeholder="계좌번호" value="' + esc(row.account_number || '') + '"></div>' +
        '<div style="margin-bottom:8px"><label>예금주</label><input type="text" class="expense-edit-account-holder form-control" placeholder="예금주" value="' + esc(row.account_holder || '') + '"></div>' +
        '</div>' +
        '<div style="margin-bottom:10px"><label>항목</label><input type="text" class="expense-edit-category form-control" list="' + editDatalistId + '" placeholder="회계 항목 선택 또는 입력" value="' + esc(row.expense_category || '') + '"><datalist id="' + editDatalistId + '">' + editDatalistOpts + '</datalist></div>' +
        '<div style="margin-bottom:10px"><label>내용</label><input type="text" class="expense-edit-content form-control" value="' + esc(row.content || '') + '" placeholder="내용"></div>' +
        '<div style="margin-bottom:10px"><label>메모(비고)</label><input type="text" class="expense-edit-memo form-control" value="' + esc(row.memo || '') + '" placeholder="비고"></div>' +
        '</div>' +
        '<div class="fx-modal-footer">' +
        '<button type="button" class="btn btn-primary expense-edit-save">저장</button> ' +
        '<button type="button" class="btn btn-outline" data-act="close">취소</button>' +
        '</div></div>';
      document.body.appendChild(overlay);
      var amountEl = overlay.querySelector('.expense-edit-amount');
      amountEl.addEventListener('focus', function () { this.value = String(parseNumberWithCommas(this.value)); });
      amountEl.addEventListener('blur', function () { this.value = fmtNum(parseNumberWithCommas(this.value)); });
      var paymentMethodSelect = overlay.querySelector('.expense-edit-payment-method');
      var transferFields = overlay.querySelector('.expense-edit-transfer-fields');
      function toggleTransferFields() {
        transferFields.style.display = paymentMethodSelect.value === 'transfer' ? 'block' : 'none';
      }
      paymentMethodSelect.addEventListener('change', toggleTransferFields);
      function closeModal() { overlay.remove(); }
      overlay.querySelectorAll('[data-act="close"]').forEach(function (b) { b.addEventListener('click', closeModal); });
      overlay.querySelector('.expense-edit-save').addEventListener('click', async function () {
        var dateVal = overlay.querySelector('.expense-edit-date').value;
        var amount = parseNumberWithCommas(overlay.querySelector('.expense-edit-amount').value);
        var expenseCategory = (overlay.querySelector('.expense-edit-category').value || '').trim();
        var content = (overlay.querySelector('.expense-edit-content').value || '').trim();
        var memo = (overlay.querySelector('.expense-edit-memo').value || '').trim();
        var paymentMethod = overlay.querySelector('.expense-edit-payment-method').value;
        var bankName = (overlay.querySelector('.expense-edit-bank-name').value || '').trim();
        var accountNumber = (overlay.querySelector('.expense-edit-account-number').value || '').trim();
        var accountHolder = (overlay.querySelector('.expense-edit-account-holder').value || '').trim();
        if (amount < 0) amount = 0;
        var saveBtn = overlay.querySelector('.expense-edit-save');
        saveBtn.disabled = true;
        try {
          await FX.updateBranchDailyExpense(row.id, {
            expense_date: dateVal,
            amount: amount,
            expense_category: expenseCategory || null,
            content: content || null,
            memo: memo || null,
            payment_method: paymentMethod,
            bank_name: paymentMethod === 'transfer' ? (bankName || null) : null,
            account_number: paymentMethod === 'transfer' ? (accountNumber || null) : null,
            account_holder: paymentMethod === 'transfer' ? (accountHolder || null) : null
          });
          closeModal();
          renderExpensesTab(container, renderVersion);
        } catch (e) {
          alert('수정 실패: ' + (e && e.message ? e.message : String(e)));
        } finally {
          saveBtn.disabled = false;
        }
      });
    }

    var profile = _profile;
    var isFcRole = !!(profile && profile.role === 'fc');
    container.innerHTML = '<div class="text-center text-muted" style="padding:40px">지출 데이터를 불러오는 중...</div>';
    var list = [];
    var requestList = [];
    try {
      if (!isFcRole) list = await FX.listBranchDailyExpenses(branchIds, currentRange.from, currentRange.to);
      // FC·지점장: 본인 지점만 조회. 그 외는 RLS 범위 전체.
      requestList = await FX.listExpenseRequests((profile.role === 'fc' || profile.role === 'branch') ? branchIds : [], {});
      var roleLower = (profile.role || '').toLowerCase();
      // 지점장: FC가 작성한 것(fc_draft)만 노출. FC: 본인이 작성한 fc_draft만 노출
      if (roleLower === 'branch') requestList = (requestList || []).filter(function (r) { return r.status === 'fc_draft'; });
      else if (roleLower === 'fc') requestList = (requestList || []).filter(function (r) { return r.status === 'fc_draft'; });
    } catch (e) {
      if (!isRenderActive(renderVersion)) return;
      var errMsg = e && e.message ? e.message : String(e);
      var isTableMissing = (errMsg && errMsg.indexOf('branch_daily_expenses') >= 0 && (errMsg.indexOf('schema cache') >= 0 || (e && e.code === 'PGRST205')));
      var help = isTableMissing
        ? '<p class="text-muted mt-2">Supabase SQL 에디터에서 <strong>051_branch_daily_expenses.sql</strong> 마이그레이션을 실행한 뒤 새로고침해 주세요. (지출 결의 기능을 쓰려면 052, 053도 순서대로 실행)</p>'
        : '';
      container.innerHTML = '<p class="text-danger">지출 목록을 불러오지 못했습니다. ' + esc(errMsg) + '</p>' + help;
      return;
    }
    if (!isRenderActive(renderVersion)) return;

    var userId = profile && profile.id ? profile.id : null;
    var brand = profile && profile.brands ? profile.brands : null;
    var isSuper = !!(profile && profile.role === 'super');
    // 슈퍼, 브랜드 의사결정권자/소유자, 또는 브랜드 관리자(role=brand이고 brand_id 있음) → 승인/반려 노출
    var isDecisionMaker = !!(userId && (isSuper || (brand && (brand.decision_maker_id === userId || brand.owner_id === userId)) || (profile.role === 'brand' && profile.brand_id)));
    var isAccounting = !!(userId && (isSuper || profile.role === 'brand_accounting' || (brand && brand.accounting_manager_id === userId)));
    var isBranchRole = !!(profile && profile.role === 'branch');
    var canDeleteExpenseRequest = isSuper || (profile && profile.role === 'brand');

    function requestStatusLabel(s) {
      var map = { fc_draft: 'FC 작성(지점장 확인 대기)', pending_approval: '승인 대기', approved: '승인됨', rejected: '반려', transfer_done: '이체 완료', card_paid: '카드 결제 완료', cancelled: '취소됨' };
      return map[s] || s;
    }
    function requestPaymentLabel(p) {
      return p === 'card' ? '카드' : '계좌이체';
    }

    var presetActive = function (p) { return p === savedPreset ? ' active' : ''; };
    var presetHtml = '<div class="expenses-range-presets mb-3">' +
      '<button type="button" class="btn btn-outline btn-sm expense-range-btn' + presetActive('this_month') + '" data-preset="this_month">이번 달</button> ' +
      '<button type="button" class="btn btn-outline btn-sm expense-range-btn' + presetActive('last_7') + '" data-preset="last_7">최근 7일</button> ' +
      '<button type="button" class="btn btn-outline btn-sm expense-range-btn' + presetActive('last_30') + '" data-preset="last_30">최근 30일</button> ' +
      '<button type="button" class="btn btn-outline btn-sm expense-range-btn' + presetActive('last_month') + '" data-preset="last_month">지난달</button>' +
      '</div>';

    var totalAmount = list.reduce(function (s, r) { return s + (parseInt(r.amount, 10) || 0); }, 0);
    function paymentMethodLabel(pm) {
      return pm === 'transfer' ? '계좌이체' : (pm === 'card' ? '카드' : '-');
    }
    function accountInfoText(r) {
      if ((r.payment_method || '') !== 'transfer') return '-';
      var parts = [];
      if (r.bank_name) parts.push(r.bank_name);
      if (r.account_holder) parts.push(r.account_holder);
      if (r.account_number) parts.push(r.account_number);
      return parts.length ? parts.join(' · ') : '-';
    }
    var tableRows = list.length ? list.map(function (r) {
      var branchName = (r.branches && r.branches.name) ? r.branches.name : '-';
      return '<tr data-expense-id="' + esc(r.id) + '">' +
        '<td style="text-align:left">' + esc(branchName) + '</td>' +
        '<td>' + (r.expense_date || '-') + '</td>' +
        '<td style="text-align:right">' + fmtNum(r.amount || 0) + '</td>' +
        '<td>' + paymentMethodLabel(r.payment_method) + '</td>' +
        '<td style="text-align:left">' + esc(accountInfoText(r)) + '</td>' +
        '<td style="text-align:left">' + esc(r.expense_category || '-') + '</td>' +
        '<td style="text-align:left">' + esc(r.content || '-') + '</td>' +
        '<td style="text-align:left">' + esc(r.memo || '-') + '</td>' +
        '<td><button type="button" class="btn btn-outline btn-sm btn-expense-edit" data-id="' + esc(r.id) + '">수정</button> ' +
        '<button type="button" class="btn btn-outline btn-sm btn-danger btn-expense-delete" data-id="' + esc(r.id) + '">삭제</button></td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="9" class="text-muted">해당 기간 지출이 없습니다. "지출 추가"로 기록하세요.</td></tr>';

    function formatRequestedAtKst(isoStr) {
      if (!isoStr) return '-';
      try {
        var d = new Date(isoStr);
        if (isNaN(d.getTime())) return (isoStr.slice(0, 10) + ' ' + (isoStr.slice(11, 16) || '')).trim();
        var s = d.toLocaleString('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
        return s.replace(', ', ' ');
      } catch (e) { return (isoStr.slice(0, 10) + ' ' + (isoStr.slice(11, 16) || '')).trim(); }
    }
    var erFilter = container._erFilter || {};
    function applyErFilter(list, f) {
      if (!list || !list.length) return list;
      return list.filter(function (r) {
        if (f.branchId && r.branch_id !== f.branchId) return false;
        if (f.status && (r.status || '') !== f.status) return false;
        if (f.paymentType && (r.payment_type || '') !== f.paymentType) return false;
        var reqDate = (r.requested_at || '').slice(0, 10);
        if (f.fromDate && reqDate < f.fromDate) return false;
        if (f.toDate && reqDate > f.toDate) return false;
        if (f.memoSearch) {
          var memo = (r.memo || '').toLowerCase();
          if (memo.indexOf((f.memoSearch || '').toLowerCase().trim()) < 0) return false;
        }
        return true;
      });
    }
    var filteredRequestList = applyErFilter(requestList, erFilter);
    function buildRequestRowsFromList(list) {
      return list.length ? list.map(function (r) {
        var branchName = (r.branches && r.branches.name) ? r.branches.name : '-';
        var reqAt = formatRequestedAtKst(r.requested_at);
        var status = r.status || '';
        var payType = r.payment_type || 'transfer';
        var actions = '';
        if (status === 'fc_draft' && isBranchRole) {
          actions = '<button type="button" class="btn btn-primary btn-sm btn-er-confirm" data-id="' + esc(r.id) + '">확인 후 관리자에 올리기</button>';
        } else if (status === 'pending_approval' && isDecisionMaker) {
          actions = '<button type="button" class="btn btn-outline btn-sm btn-success btn-er-approve" data-id="' + esc(r.id) + '">승인</button> ' +
            '<button type="button" class="btn btn-outline btn-sm btn-danger btn-er-reject" data-id="' + esc(r.id) + '">반려</button>';
        } else if (status === 'approved' && payType === 'transfer' && isAccounting) {
          actions = '<button type="button" class="btn btn-primary btn-sm btn-er-transfer" data-id="' + esc(r.id) + '">이체 완료</button>';
        } else if (status === 'approved' && payType === 'card' && (r.requested_by === userId || isBranchRole)) {
          actions = '<button type="button" class="btn btn-primary btn-sm btn-er-card-paid" data-id="' + esc(r.id) + '">카드 결제 완료</button>';
        } else {
          actions = '-';
        }
        if (canDeleteExpenseRequest) actions += ' <button type="button" class="btn btn-outline btn-sm btn-danger btn-er-delete" data-id="' + esc(r.id) + '" title="결의 삭제">삭제</button>';
        var canCancelEdit = (status === 'fc_draft' || status === 'pending_approval') && (r.requested_by === userId || (isBranchRole && branchIds.indexOf(r.branch_id) >= 0));
        if (canCancelEdit) {
          actions += ' <button type="button" class="btn btn-outline btn-sm btn-er-cancel" data-id="' + esc(r.id) + '" title="신청 취소">취소</button>';
          actions += ' <button type="button" class="btn btn-outline btn-sm btn-er-edit-request" data-id="' + esc(r.id) + '" title="내용 수정">수정</button>';
        }
        var urls = r.attachment_urls;
        if (typeof urls === 'string') try { urls = JSON.parse(urls); } catch (e) { urls = []; }
        if (!Array.isArray(urls)) urls = [];
        function attrEsc(str) { return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
        var urlsJson = urls.length ? attrEsc(JSON.stringify(urls)) : '[]';
        var attachHtml = urls.length
          ? '<span class="text-muted">' + urls.length + '장</span> ' + urls.map(function (u, i) { return '<button type="button" class="btn btn-link btn-sm er-attach-view" style="padding:0 .25rem; vertical-align:baseline" data-url="' + attrEsc(u) + '" data-urls="' + urlsJson + '" data-index="' + i + '" title="웹앱에서 보기">' + (i + 1) + '</button>'; }).join(' ')
          : '-';
        function accountInfoTextForRequest(req) {
          if ((req.payment_type || '') !== 'transfer') return '-';
          var parts = [];
          if (req.bank_name) parts.push(req.bank_name);
          if (req.account_holder) parts.push(req.account_holder);
          if (req.account_number) parts.push(req.account_number);
          return parts.length ? parts.join(' ') : '-';
        }
        return '<tr data-request-id="' + esc(r.id) + '">' +
          '<td style="text-align:left">' + esc(branchName) + '</td>' +
          '<td>' + esc(reqAt) + '</td>' +
          '<td style="text-align:right">' + fmtNum(r.amount || 0) + '</td>' +
          '<td style="text-align:left">' + esc(r.memo || '-') + '</td>' +
          '<td style="text-align:left">' + esc(accountInfoTextForRequest(r)) + '</td>' +
          '<td>' + attachHtml + '</td>' +
          '<td>' + requestPaymentLabel(payType) + '</td>' +
          '<td>' + requestStatusLabel(status) + (r.rejection_reason ? ' <span class="text-muted">(' + esc(r.rejection_reason) + ')</span>' : '') + '</td>' +
          '<td>' + actions + '</td></tr>';
      }).join('') : '<tr><td colspan="9" class="text-muted">지출 결의가 없습니다.</td></tr>';
    }
    var requestRows = buildRequestRowsFromList(filteredRequestList);

    var erBranchOpts = '<option value="">전체 지점</option>';
    var branchIdsInList = [];
    (requestList || []).forEach(function (r) {
      if (r.branch_id && branchIdsInList.indexOf(r.branch_id) < 0) branchIdsInList.push(r.branch_id);
    });
    (_branches || []).forEach(function (b) {
      if (b.id && (branchIdsInList.indexOf(b.id) >= 0 || !requestList.length)) erBranchOpts += '<option value="' + esc(b.id) + '">' + esc(b.name || '') + '</option>';
    });
    var erFilterHtml = '<div class="er-filter-bar card-body" style="display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-bottom:12px; padding:12px; background:var(--bg-sub, #f8fafc); border-radius:8px;">' +
      '<span class="er-filter-label" style="font-weight:600; font-size:13px;">필터</span>' +
      '<select id="er-filter-branch" class="er-filter-select form-control" style="width:auto; min-width:100px;">' + erBranchOpts + '</select>' +
      '<input type="date" id="er-filter-from" class="er-filter-input form-control" style="width:auto;" placeholder="신청일 from" title="신청일 from">' +
      '<span style="color:var(--text-muted);">~</span>' +
      '<input type="date" id="er-filter-to" class="er-filter-input form-control" style="width:auto;" placeholder="신청일 to" title="신청일 to">' +
      '<select id="er-filter-status" class="er-filter-select form-control" style="width:auto; min-width:140px;">' +
      '<option value="">전체 상태</option>' +
      '<option value="fc_draft">FC 작성(지점장 확인 대기)</option>' +
      '<option value="pending_approval">승인 대기</option>' +
      '<option value="approved">승인됨</option>' +
      '<option value="rejected">반려</option>' +
      '<option value="transfer_done">이체 완료</option>' +
      '<option value="card_paid">카드 결제 완료</option>' +
      '<option value="cancelled">취소됨</option></select>' +
      '<select id="er-filter-payment" class="er-filter-select form-control" style="width:auto; min-width:90px;">' +
      '<option value="">전체 결제</option><option value="transfer">계좌이체</option><option value="card">카드</option></select>' +
      '<input type="text" id="er-filter-memo" class="er-filter-input form-control" style="width:140px;" placeholder="메모 검색" title="메모 검색">' +
      '<button type="button" class="btn btn-outline btn-sm btn-nowrap" id="er-filter-apply">적용</button>' +
      '<button type="button" class="btn btn-outline btn-sm btn-nowrap" id="er-filter-reset">초기화</button>' +
      '<span class="text-muted" style="font-size:12px;">' + filteredRequestList.length + '건</span></div>';

    var html = '';
    if (!isFcRole) {
      html += '<div class="card profit-card">' +
        '<h3>지점 지출 (일별)</h3>' +
        '<p class="text-muted">지점별 일별 지출을 기록하고 조회합니다.</p>' +
        presetHtml +
        '<p class="text-muted" style="margin-bottom:12px">기간: <strong>' + currentRange.from + '</strong> ~ <strong>' + currentRange.to + '</strong>' +
        (list.length ? ' · 총 <strong>' + list.length + '건</strong> ' + fmtNum(totalAmount) + '원' : '') + '</p>' +
        '<button type="button" class="btn btn-primary btn-expense-add mb-3">지출 추가</button>' +
        '<div class="profit-table-wrap">' +
        '<table class="profit-table"><thead><tr>' +
        '<th style="text-align:left">지점</th><th>일자</th><th style="text-align:right">금액</th><th>지출방법</th><th style="text-align:left">계좌정보</th><th style="text-align:left">항목</th><th style="text-align:left">내용</th><th style="text-align:left">메모</th><th>작업</th>' +
        '</tr></thead><tbody id="expenses-tbody">' + tableRows + '</tbody></table></div></div>' +
        '<div class="card profit-card mt-4">';
    } else {
      html += '<div class="card profit-card">';
    }
    html += '<div class="flex justify-between items-center mb-2"><h3 style="margin:0">지출 결의</h3><div class="flex gap-2 flex-wrap" style="align-items:center">' +
      (isFcRole ? '<button type="button" class="btn btn-primary btn-sm btn-nowrap" id="btn-er-request-add">지출 결의 작성</button>' : (isBranchRole ? '<button type="button" class="btn btn-primary btn-sm btn-nowrap" id="btn-er-request-add">지출 결의 신청</button>' : '')) +
      '<button type="button" class="btn btn-outline btn-sm btn-nowrap" id="btn-export-expense-requests-excel">엑셀 내보내기</button></div></div>' +
      (isFcRole
        ? '<p class="text-muted">지출 결의를 작성하면 지점장이 확인 후 관리자(의사결정권자)에 제출합니다. 지점장이 확인·제출하기 전까지 상태가 「FC 작성(지점장 확인 대기)」로 표시됩니다.</p>'
        : '<p class="text-muted">지점장이 신청하면 의사결정권자가 승인/반려하고, 계좌이체는 회계관리자가 이체 완료 처리, 카드는 승인 후 지점장이 카드 결제 완료를 표시합니다. FC가 작성한 결의는 지점장이 확인 후 제출할 수 있습니다.</p>') +
      (isDecisionMaker || isAccounting ? '<p class="text-muted" style="font-size:12px;margin-top:4px">' + (isSuper ? '플랫폼 관리자로 로그인되어 승인/반려 및 이체 완료를 처리할 수 있습니다.' : isDecisionMaker && isAccounting ? '의사결정권자·회계관리자로 로그인되어 승인/반려 및 이체 완료를 처리할 수 있습니다.' : isDecisionMaker ? '의사결정권자로 로그인되어 승인/반려할 수 있습니다.' : '회계관리자로 로그인되어 이체 완료를 처리할 수 있습니다.') + '</p>' : '') +
      erFilterHtml +
      '<div class="profit-table-wrap">' +
      '<table class="profit-table"><thead><tr>' +
      '<th style="text-align:left">지점</th><th>신청일시</th><th style="text-align:right">금액</th><th style="text-align:left">메모</th><th style="text-align:left">계좌정보</th><th>첨부</th><th>결제방식</th><th>상태</th><th>작업</th>' +
      '</tr></thead><tbody id="expense-requests-tbody">' + requestRows + '</tbody></table></div></div>';

    container.innerHTML = html;
    container._expensesList = list;
    container._expensesRange = currentRange;
    container._expensesPreset = savedPreset;
    container._expensesRenderVersion = renderVersion;
    container._expenseRequestsList = requestList;
    container._erFilter = erFilter;

    var selErBranch = container.querySelector('#er-filter-branch');
    var selErStatus = container.querySelector('#er-filter-status');
    var selErPayment = container.querySelector('#er-filter-payment');
    var inputErFrom = container.querySelector('#er-filter-from');
    var inputErTo = container.querySelector('#er-filter-to');
    var inputErMemo = container.querySelector('#er-filter-memo');
    if (selErBranch && erFilter.branchId) selErBranch.value = erFilter.branchId;
    if (selErStatus && erFilter.status) selErStatus.value = erFilter.status;
    if (selErPayment && erFilter.paymentType) selErPayment.value = erFilter.paymentType;
    if (inputErFrom && erFilter.fromDate) inputErFrom.value = erFilter.fromDate;
    if (inputErTo && erFilter.toDate) inputErTo.value = erFilter.toDate;
    if (inputErMemo && erFilter.memoSearch) inputErMemo.value = erFilter.memoSearch;

    function applyErFilterAndRefresh() {
      var f = {
        branchId: selErBranch ? selErBranch.value : '',
        status: selErStatus ? selErStatus.value : '',
        paymentType: selErPayment ? selErPayment.value : '',
        fromDate: inputErFrom ? (inputErFrom.value || '').trim() : '',
        toDate: inputErTo ? (inputErTo.value || '').trim() : '',
        memoSearch: inputErMemo ? (inputErMemo.value || '').trim() : ''
      };
      container._erFilter = f;
      var filtered = applyErFilter(container._expenseRequestsList || [], f);
      var tbody = container.querySelector('#expense-requests-tbody');
      var countEl = container.querySelector('.er-filter-bar .text-muted');
      if (tbody) tbody.innerHTML = buildRequestRowsFromList(filtered);
      if (countEl) countEl.textContent = filtered.length + '건';
      attachErButtonHandlers();
    }
    function attachErButtonHandlers() {
      container.querySelectorAll('.btn-er-confirm').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var id = btn.getAttribute('data-id');
          if (!id) return;
          btn.disabled = true;
          try {
            await FX.confirmExpenseRequest(id);
            renderExpensesTab(container, renderVersion);
          } catch (e) {
            alert('확인·제출 실패: ' + (e && e.message ? e.message : String(e)));
          } finally {
            btn.disabled = false;
          }
        });
      });
      container.querySelectorAll('.btn-er-approve').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var id = btn.getAttribute('data-id');
          if (!id) return;
          btn.disabled = true;
          try {
            await FX.approveExpenseRequest(id);
            renderExpensesTab(container, renderVersion);
          } catch (e) {
            alert('승인 실패: ' + (e && e.message ? e.message : String(e)));
          } finally {
            btn.disabled = false;
          }
        });
      });
      container.querySelectorAll('.btn-er-reject').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-id');
          if (id) openRejectModal(id);
        });
      });
      container.querySelectorAll('.btn-er-transfer').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var id = btn.getAttribute('data-id');
          if (!id) return;
          btn.disabled = true;
          try {
            await FX.markExpenseRequestTransferDone(id);
            renderExpensesTab(container, renderVersion);
          } catch (e) {
            alert('이체 완료 처리 실패: ' + (e && e.message ? e.message : String(e)));
          } finally {
            btn.disabled = false;
          }
        });
      });
      container.querySelectorAll('.btn-er-card-paid').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var id = btn.getAttribute('data-id');
          if (!id) return;
          btn.disabled = true;
          try {
            await FX.markExpenseRequestCardPaid(id);
            renderExpensesTab(container, renderVersion);
          } catch (e) {
            alert('카드 결제 완료 처리 실패: ' + (e && e.message ? e.message : String(e)));
          } finally {
            btn.disabled = false;
          }
        });
      });
      container.querySelectorAll('.btn-er-delete').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var id = btn.getAttribute('data-id');
          if (!id || !confirm('이 지출 결의를 삭제할까요? 삭제 후 복구할 수 없습니다.')) return;
          btn.disabled = true;
          try {
            await FX.deleteExpenseRequest(id);
            renderExpensesTab(container, renderVersion);
          } catch (e) {
            alert('삭제 실패: ' + (e && e.message ? e.message : String(e)));
          } finally {
            btn.disabled = false;
          }
        });
      });
      container.querySelectorAll('.btn-er-cancel').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var id = btn.getAttribute('data-id');
          if (!id || !confirm('이 지출 결의를 취소(철회)할까요? 취소하면 승인 대기에서 제외됩니다.')) return;
          btn.disabled = true;
          try {
            await FX.cancelExpenseRequest(id);
            renderExpensesTab(container, renderVersion);
          } catch (e) {
            alert('취소 실패: ' + (e && e.message ? e.message : String(e)));
          } finally {
            btn.disabled = false;
          }
        });
      });
      container.querySelectorAll('.btn-er-edit-request').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-id');
          if (!id) return;
          var list = container._expenseRequestsList || [];
          var row = list.find(function (r) { return r.id === id; });
          if (row) openEditExpenseRequestModal(row);
          else alert('해당 결의를 찾을 수 없습니다.');
        });
      });
    }
    attachErButtonHandlers();

    var btnErFilterApply = container.querySelector('#er-filter-apply');
    var btnErFilterReset = container.querySelector('#er-filter-reset');
    if (btnErFilterApply) btnErFilterApply.addEventListener('click', applyErFilterAndRefresh);
    if (btnErFilterReset) {
      btnErFilterReset.addEventListener('click', function () {
        if (selErBranch) selErBranch.value = '';
        if (selErStatus) selErStatus.value = '';
        if (selErPayment) selErPayment.value = '';
        if (inputErFrom) inputErFrom.value = '';
        if (inputErTo) inputErTo.value = '';
        if (inputErMemo) inputErMemo.value = '';
        container._erFilter = {};
        applyErFilterAndRefresh();
      });
    }
    if (inputErMemo) inputErMemo.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); applyErFilterAndRefresh(); } });

    function openEditExpenseRequestModal(row) {
      if (!row || !row.id) return;
      var overlay = document.createElement('div');
      overlay.className = 'fx-modal-overlay';
      var payType = (row.payment_type === 'card' || row.payment_type === 'transfer') ? row.payment_type : 'transfer';
      overlay.innerHTML = '<div class="fx-modal" style="max-width:420px">' +
        '<div class="fx-modal-header"><h4>지출 결의 수정</h4></div>' +
        '<div class="fx-modal-body">' +
        '<p class="text-muted" style="margin-bottom:8px">금액·메모·결제방식을 수정할 수 있습니다. (승인 전에만 가능)</p>' +
        '<div style="margin-bottom:10px"><label>지점</label><p class="form-control-static">' + esc((row.branches && row.branches.name) || '-') + '</p></div>' +
        '<div style="margin-bottom:10px"><label>금액(원)</label><input type="text" class="er-edit-amount form-control profit-input-comma" inputmode="numeric" value="' + fmtNum(row.amount || 0) + '"></div>' +
        '<div style="margin-bottom:10px"><label>메모</label><input type="text" class="er-edit-memo form-control" placeholder="항목/비고" value="' + esc(row.memo || '') + '"></div>' +
        '<div style="margin-bottom:10px"><label>결제방식</label><select class="er-edit-payment form-control"><option value="transfer"' + (payType === 'transfer' ? ' selected' : '') + '>계좌이체</option><option value="card"' + (payType === 'card' ? ' selected' : '') + '>카드</option></select></div>' +
        '<div class="er-edit-transfer-fields" style="margin-bottom:10px;' + (payType !== 'transfer' ? ' display:none;' : '') + '">' +
        '<div style="margin-bottom:8px"><label>은행명</label><input type="text" class="er-edit-bank-name form-control" placeholder="은행명" value="' + esc(row.bank_name || '') + '"></div>' +
        '<div style="margin-bottom:8px"><label>계좌번호</label><input type="text" class="er-edit-account-number form-control" placeholder="계좌번호" value="' + esc(row.account_number || '') + '"></div>' +
        '<div style="margin-bottom:8px"><label>예금주</label><input type="text" class="er-edit-account-holder form-control" placeholder="예금주" value="' + esc(row.account_holder || '') + '"></div>' +
        '</div></div>' +
        '<div class="fx-modal-footer">' +
        '<button type="button" class="btn btn-primary er-edit-submit">저장</button> ' +
        '<button type="button" class="btn btn-outline" data-act="close">닫기</button>' +
        '</div></div>';
      document.body.appendChild(overlay);
      var amountEl = overlay.querySelector('.er-edit-amount');
      amountEl.addEventListener('focus', function () { this.value = String(parseNumberWithCommas(this.value)); });
      amountEl.addEventListener('blur', function () { this.value = fmtNum(parseNumberWithCommas(this.value)); });
      var paymentSelect = overlay.querySelector('.er-edit-payment');
      var transferFields = overlay.querySelector('.er-edit-transfer-fields');
      paymentSelect.addEventListener('change', function () { transferFields.style.display = this.value === 'transfer' ? 'block' : 'none'; });
      function closeModal() { overlay.remove(); }
      overlay.querySelectorAll('[data-act="close"]').forEach(function (b) { b.addEventListener('click', closeModal); });
      overlay.querySelector('.er-edit-submit').addEventListener('click', async function () {
        var amount = parseNumberWithCommas(overlay.querySelector('.er-edit-amount').value);
        var memo = (overlay.querySelector('.er-edit-memo').value || '').trim();
        var paymentType = overlay.querySelector('.er-edit-payment').value;
        var bankName = (overlay.querySelector('.er-edit-bank-name').value || '').trim();
        var accountNumber = (overlay.querySelector('.er-edit-account-number').value || '').trim();
        var accountHolder = (overlay.querySelector('.er-edit-account-holder').value || '').trim();
        if (amount < 0) amount = 0;
        var btn = overlay.querySelector('.er-edit-submit');
        btn.disabled = true;
        try {
          await FX.updateExpenseRequest(row.id, { amount: amount, memo: memo || null, payment_type: paymentType, bank_name: paymentType === 'transfer' ? (bankName || null) : null, account_number: paymentType === 'transfer' ? (accountNumber || null) : null, account_holder: paymentType === 'transfer' ? (accountHolder || null) : null });
          closeModal();
          renderExpensesTab(container, renderVersion);
        } catch (e) {
          alert('수정 실패: ' + (e && e.message ? e.message : String(e)));
        } finally {
          btn.disabled = false;
        }
      });
    }

    function openRequestModal(isFcDraft) {
      isFcDraft = !!isFcDraft;
      var overlay = document.createElement('div');
      overlay.className = 'fx-modal-overlay';
      var branchOptions = (_branches || []).filter(function (b) { return branchIds.indexOf(b.id) >= 0; }).map(function (b) {
        return '<option value="' + esc(b.id) + '">' + esc(b.name || '-') + '</option>';
      }).join('');
      overlay.innerHTML = '<div class="fx-modal" style="max-width:420px">' +
        '<div class="fx-modal-header"><h4>' + (isFcDraft ? '지출 결의 작성' : '지출 결의 신청') + '</h4></div>' +
        '<div class="fx-modal-body">' +
        '<p class="text-muted" style="margin-bottom:8px">' + (isFcDraft ? '금액·메모·결제방식을 입력하세요. 지점장이 확인 후 관리자에 제출됩니다.' : '금액·메모·결제방식을 입력하세요. 승인 후 계좌이체는 회계관리자가, 카드는 지점장이 결제 완료를 표시합니다.') + '</p>' +
        '<div style="margin-bottom:10px"><label>지점</label><select class="er-modal-branch form-control" style="width:100%">' + branchOptions + '</select></div>' +
        '<div style="margin-bottom:10px"><label>금액(원)</label><input type="text" class="er-modal-amount form-control profit-input-comma" inputmode="numeric" placeholder="0" value="0"></div>' +
        '<div style="margin-bottom:10px"><label>메모</label><input type="text" class="er-modal-memo form-control" placeholder="항목/비고"></div>' +
        '<div style="margin-bottom:10px"><label>첨부 이미지 (여러 장 선택 가능)</label><input type="file" class="er-modal-files form-control" accept="image/jpeg,image/png,image/gif,image/webp" multiple><p class="text-muted form-hint" style="margin:4px 0 0;font-size:12px">선택 사항. 이미지 여러 장 선택 가능 (최대 5MB/파일)</p></div>' +
        '<div style="margin-bottom:10px"><label>결제방식</label><select class="er-modal-payment form-control"><option value="transfer">계좌이체</option><option value="card">카드</option></select></div>' +
        '<div class="er-modal-transfer-fields" style="display:none; margin-bottom:10px">' +
        '<div style="margin-bottom:8px"><label>은행명</label><input type="text" class="er-modal-bank-name form-control" placeholder="은행명"></div>' +
        '<div style="margin-bottom:8px"><label>계좌번호</label><input type="text" class="er-modal-account-number form-control" placeholder="계좌번호"></div>' +
        '<div style="margin-bottom:8px"><label>예금주</label><input type="text" class="er-modal-account-holder form-control" placeholder="예금주"></div>' +
        '</div>' +
        '</div>' +
        '<div class="fx-modal-footer">' +
        '<button type="button" class="btn btn-primary er-modal-submit">' + (isFcDraft ? '작성' : '신청') + '</button> ' +
        '<button type="button" class="btn btn-outline" data-act="close">취소</button>' +
        '</div></div>';
      document.body.appendChild(overlay);
      var amountEl = overlay.querySelector('.er-modal-amount');
      amountEl.addEventListener('focus', function () { this.value = String(parseNumberWithCommas(this.value)); });
      amountEl.addEventListener('blur', function () { this.value = fmtNum(parseNumberWithCommas(this.value)); });
      var paymentSelect = overlay.querySelector('.er-modal-payment');
      var transferFields = overlay.querySelector('.er-modal-transfer-fields');
      paymentSelect.addEventListener('change', function () { transferFields.style.display = this.value === 'transfer' ? 'block' : 'none'; });
      if (paymentSelect.value === 'transfer') transferFields.style.display = 'block';
      function closeModal() { overlay.remove(); }
      overlay.querySelectorAll('[data-act="close"]').forEach(function (b) { b.addEventListener('click', closeModal); });
      overlay.querySelector('.er-modal-submit').addEventListener('click', async function () {
        var branchId = overlay.querySelector('.er-modal-branch').value;
        var amount = parseNumberWithCommas(overlay.querySelector('.er-modal-amount').value);
        var memo = (overlay.querySelector('.er-modal-memo').value || '').trim();
        var paymentType = overlay.querySelector('.er-modal-payment').value;
        var bankName = (overlay.querySelector('.er-modal-bank-name') && overlay.querySelector('.er-modal-bank-name').value || '').trim();
        var accountNumber = (overlay.querySelector('.er-modal-account-number') && overlay.querySelector('.er-modal-account-number').value || '').trim();
        var accountHolder = (overlay.querySelector('.er-modal-account-holder') && overlay.querySelector('.er-modal-account-holder').value || '').trim();
        var fileInput = overlay.querySelector('.er-modal-files');
        var files = fileInput && fileInput.files ? Array.prototype.slice.call(fileInput.files) : [];
        if (!branchId) { alert('지점을 선택해 주세요.'); return; }
        if (amount < 0) amount = 0;
        var btn = overlay.querySelector('.er-modal-submit');
        btn.disabled = true;
        try {
          var payload = {
            branch_id: branchId,
            amount: amount,
            memo: memo || null,
            payment_type: paymentType,
            bank_name: paymentType === 'transfer' ? (bankName || null) : null,
            account_number: paymentType === 'transfer' ? (accountNumber || null) : null,
            account_holder: paymentType === 'transfer' ? (accountHolder || null) : null
          };
          if (isFcDraft) payload.isFcDraft = true;
          var created = await FX.insertExpenseRequest(payload);
          if (created && created.id && files.length) {
            var urls = await FX.uploadExpenseRequestAttachments(created.id, files);
            if (urls.length) await FX.updateExpenseRequestAttachmentUrls(created.id, urls);
          }
          closeModal();
          renderExpensesTab(container, renderVersion);
        } catch (e) {
          alert((isFcDraft ? '작성' : '신청') + ' 실패: ' + (e && e.message ? e.message : String(e)));
        } finally {
          btn.disabled = false;
        }
      });
    }

    function openRejectModal(requestId) {
      var overlay = document.createElement('div');
      overlay.className = 'fx-modal-overlay';
      overlay.innerHTML = '<div class="fx-modal" style="max-width:420px">' +
        '<div class="fx-modal-header"><h4>반려 사유</h4></div>' +
        '<div class="fx-modal-body">' +
        '<p class="text-muted" style="margin-bottom:8px">선택 사항입니다.</p>' +
        '<div style="margin-bottom:10px"><label>사유</label><input type="text" class="er-reject-reason form-control" placeholder="반려 사유"></div>' +
        '</div>' +
        '<div class="fx-modal-footer">' +
        '<button type="button" class="btn btn-danger er-reject-submit" data-id="' + esc(requestId) + '">반려</button> ' +
        '<button type="button" class="btn btn-outline" data-act="close">취소</button>' +
        '</div></div>';
      document.body.appendChild(overlay);
      function closeModal() { overlay.remove(); }
      overlay.querySelectorAll('[data-act="close"]').forEach(function (b) { b.addEventListener('click', closeModal); });
      overlay.querySelector('.er-reject-submit').addEventListener('click', async function () {
        var id = this.getAttribute('data-id');
        var reason = (overlay.querySelector('.er-reject-reason').value || '').trim();
        var btn = this;
        btn.disabled = true;
        try {
          await FX.rejectExpenseRequest(id, reason || null);
          closeModal();
          renderExpensesTab(container, renderVersion);
        } catch (e) {
          alert('반려 처리 실패: ' + (e && e.message ? e.message : String(e)));
        } finally {
          btn.disabled = false;
        }
      });
    }

    function openImageViewerModal(urls, currentIndex) {
      if (!urls || !urls.length) return;
      var idx = Math.max(0, Math.min(currentIndex, urls.length - 1));
      var overlay = document.createElement('div');
      overlay.className = 'fx-modal-overlay fx-image-viewer-overlay';
      var prevDisabled = idx <= 0;
      var nextDisabled = idx >= urls.length - 1;
      overlay.innerHTML = '<div class="fx-modal fx-image-viewer-modal" style="max-width:96vw; max-height:96vh; display:flex; flex-direction:column;">' +
        '<div class="fx-modal-header" style="display:flex; align-items:center; gap:8px; flex-shrink:0">' +
          '<button type="button" class="btn btn-outline btn-sm fx-img-prev"' + (prevDisabled ? ' disabled' : '') + '>이전</button>' +
          '<span class="fx-img-counter">' + (idx + 1) + ' / ' + urls.length + '</span>' +
          '<button type="button" class="btn btn-outline btn-sm fx-img-next"' + (nextDisabled ? ' disabled' : '') + '>다음</button>' +
          '<button type="button" class="btn btn-outline btn-sm" data-act="close">닫기</button>' +
        '</div>' +
        '<div class="fx-modal-body" style="text-align:center; padding:12px; overflow:auto; flex:1">' +
          '<img src="" alt="첨부" class="fx-viewer-img" style="max-width:100%; max-height:80vh; object-fit:contain;">' +
        '</div></div>';
      document.body.appendChild(overlay);
      var imgEl = overlay.querySelector('.fx-viewer-img');
      var counterEl = overlay.querySelector('.fx-img-counter');
      imgEl.src = urls[idx];
      function closeViewer() { overlay.remove(); }
      overlay.querySelectorAll('[data-act="close"]').forEach(function (b) { b.addEventListener('click', closeViewer); });
      function setIndex(i) {
        idx = Math.max(0, Math.min(i, urls.length - 1));
        imgEl.src = urls[idx];
        counterEl.textContent = (idx + 1) + ' / ' + urls.length;
        overlay.querySelector('.fx-img-prev').disabled = idx <= 0;
        overlay.querySelector('.fx-img-next').disabled = idx >= urls.length - 1;
      }
      overlay.querySelector('.fx-img-prev').addEventListener('click', function () { if (idx > 0) setIndex(idx - 1); });
      overlay.querySelector('.fx-img-next').addEventListener('click', function () { if (idx < urls.length - 1) setIndex(idx + 1); });
    }

    var erTbody = container.querySelector('#expense-requests-tbody');
    if (erTbody) {
      erTbody.addEventListener('click', function (e) {
        var btn = e.target.closest('.er-attach-view');
        if (!btn) return;
        e.preventDefault();
        var urls = [];
        try { urls = JSON.parse(btn.getAttribute('data-urls') || '[]'); } catch (err) {}
        var idx = parseInt(btn.getAttribute('data-index'), 10);
        if (isNaN(idx)) idx = 0;
        openImageViewerModal(urls, idx);
      });
    }

    var btnExpenseAdd = container.querySelector('.btn-expense-add');
    if (btnExpenseAdd) btnExpenseAdd.addEventListener('click', function () { openAddModal(); });
    var btnErRequestAdd = container.querySelector('#btn-er-request-add');
    if (btnErRequestAdd) btnErRequestAdd.addEventListener('click', function () { openRequestModal(isFcRole); });
    var exportExcelBtn = document.getElementById('btn-export-expense-requests-excel');
    if (exportExcelBtn) {
      exportExcelBtn.addEventListener('click', function () {
        if (typeof XLSX === 'undefined' || !XLSX.utils) {
          alert('엑셀 내보내기 라이브러리를 찾을 수 없습니다.');
          return;
        }
        var rows = applyErFilter(container._expenseRequestsList || [], container._erFilter || []);
        var requestStatusLabel = function (s) { var map = { fc_draft: 'FC 작성(지점장 확인 대기)', pending_approval: '승인 대기', approved: '승인됨', rejected: '반려', transfer_done: '이체 완료', card_paid: '카드 결제 완료', cancelled: '취소됨' }; return map[s] || s; };
        var requestPaymentLabel = function (p) { return p === 'card' ? '카드' : '계좌이체'; };
        var formatRequestedAtKstExport = function (isoStr) {
          if (!isoStr) return '';
          try {
            var d = new Date(isoStr);
            if (isNaN(d.getTime())) return (isoStr.slice(0, 10) + ' ' + (isoStr.slice(11, 16) || '')).trim();
            var s = d.toLocaleString('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
            return s.replace(', ', ' ');
          } catch (e) { return (isoStr.slice(0, 10) + ' ' + (isoStr.slice(11, 16) || '')).trim(); }
        };
        var excelRows = rows.map(function (r) {
          var branchName = (r.branches && r.branches.name) ? r.branches.name : '-';
          var reqAt = formatRequestedAtKstExport(r.requested_at);
          var urls = r.attachment_urls;
          if (typeof urls === 'string') try { urls = JSON.parse(urls); } catch (e) { urls = []; }
          if (!Array.isArray(urls)) urls = [];
          function accountInfoForExcel(req) {
          if ((req.payment_type || '') !== 'transfer') return '';
          var parts = [];
          if (req.bank_name) parts.push(req.bank_name);
          if (req.account_holder) parts.push(req.account_holder);
          if (req.account_number) parts.push(req.account_number);
          return parts.join(' ');
        }
        return {
            지점: branchName,
            신청일시: reqAt,
            금액: r.amount != null ? Number(r.amount) : 0,
            메모: (r.memo || '').trim() || '',
            계좌정보: accountInfoForExcel(r),
            첨부개수: urls.length,
            결제방식: requestPaymentLabel(r.payment_type || 'transfer'),
            상태: requestStatusLabel(r.status || ''),
            반려사유: (r.rejection_reason || '').trim() || ''
          };
        });
        if (!excelRows.length) excelRows.push({ 지점: '', 신청일시: '', 금액: '', 메모: '', 계좌정보: '', 첨부개수: '', 결제방식: '', 상태: '', 반려사유: '' });
        var ws = XLSX.utils.json_to_sheet(excelRows);
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '지출 결의');
        var dateStr = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, '지출결의_' + dateStr + '.xlsx');
      });
    }
    container.querySelectorAll('.expense-range-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var preset = this.getAttribute('data-preset');
        container._expensesPreset = preset;
        renderExpensesTab(container, renderVersion);
      });
    });

    container.querySelectorAll('.btn-expense-edit').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        var row = list.find(function (r) { return r.id === id; });
        if (row) openEditModal(row);
      });
    });

    container.querySelectorAll('.btn-expense-delete').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id = btn.getAttribute('data-id');
        if (!id || !confirm('이 지출을 삭제할까요?')) return;
        btn.disabled = true;
        try {
          await FX.deleteBranchDailyExpense(id);
          renderExpensesTab(container, renderVersion);
        } catch (e) {
          alert('삭제 실패: ' + (e && e.message ? e.message : String(e)));
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  // ── 환불 탭 (고객 환불 요청, 지출/수익률 무관) ──
  async function renderRefundsTab(container, renderVersion) {
    if (!isRenderActive(renderVersion)) return;
    var branchIds = getSelectedBranchIds();
    var profile = _profile;
    var userId = profile && profile.id ? profile.id : null;
    var brand = profile && profile.brands ? profile.brands : null;
    var isSuper = !!(profile && profile.role === 'super');
    var isBrand = !!(profile && profile.role === 'brand');
    var isBranchRole = !!(profile && profile.role === 'branch');
    var isAccounting = !!(userId && (isSuper || profile.role === 'brand_accounting' || (brand && brand.accounting_manager_id === userId)));
    var canCreateRefund = isBranchRole || isBrand || isSuper;
    var canApproveRefund = isBrand || isSuper;
    var canCompleteRefund = isAccounting;

    container.innerHTML = '<div class="text-center text-muted" style="padding:40px">환불 내역을 불러오는 중...</div>';
    var refundList = [];
    try {
      refundList = await FX.listRefundRequests(branchIds.length ? branchIds : [], {});
    } catch (e) {
      if (!isRenderActive(renderVersion)) return;
      container.innerHTML = '<p class="text-danger">환불 목록을 불러오지 못했습니다. ' + esc(e && e.message ? e.message : String(e)) + '</p>';
      return;
    }
    if (!isRenderActive(renderVersion)) return;

    function formatRequestedAtKstRefund(isoStr) {
      if (!isoStr) return '-';
      try {
        var d = new Date(isoStr);
        if (isNaN(d.getTime())) return (isoStr.slice(0, 10) + ' ' + (isoStr.slice(11, 16) || '')).trim();
        var s = d.toLocaleString('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
        return s.replace(', ', ' ');
      } catch (err) { return (isoStr.slice(0, 10) + ' ' + (isoStr.slice(11, 16) || '')).trim(); }
    }
    function refundStatusLabel(s) {
      var map = { pending_approval: '승인 대기', approved: '승인됨', rejected: '반려', completed: '이체 완료' };
      return map[s] || s;
    }

    var branchOptionsForRefund = [];
    if (isBranchRole && branchIds.length) branchOptionsForRefund = _branches.filter(function (b) { return branchIds.indexOf(b.id) >= 0; });
    else if (isBrand || isSuper) branchOptionsForRefund = _branches.slice();

    var refundRows = refundList.length ? refundList.map(function (r) {
      var branchName = (r.branches && r.branches.name) ? r.branches.name : '-';
      var reqAt = formatRequestedAtKstRefund(r.requested_at);
      var status = r.status || '';
      var actions = '';
      if (status === 'pending_approval' && canApproveRefund) {
        actions = '<button type="button" class="btn btn-outline btn-sm btn-success btn-refund-approve" data-id="' + esc(r.id) + '">승인</button> ' +
          '<button type="button" class="btn btn-outline btn-sm btn-danger btn-refund-reject" data-id="' + esc(r.id) + '">반려</button>';
      } else if (status === 'approved' && canCompleteRefund) {
        actions = '<button type="button" class="btn btn-primary btn-sm btn-refund-complete" data-id="' + esc(r.id) + '">이체 완료</button>';
      } else {
        actions = '-';
      }
      return '<tr data-refund-id="' + esc(r.id) + '">' +
        '<td style="text-align:left">' + esc(branchName) + '</td>' +
        '<td>' + esc(reqAt) + '</td>' +
        '<td style="text-align:left">' + esc(r.customer_name || '-') + '</td>' +
        '<td style="text-align:left">' + esc(r.bank_name || '-') + '</td>' +
        '<td style="text-align:left">' + esc(r.account_holder || '-') + '</td>' +
        '<td style="text-align:left">' + esc(r.account_number || '-') + '</td>' +
        '<td style="text-align:right">' + fmtNum(r.amount || 0) + '</td>' +
        '<td style="text-align:left">' + esc(r.reason || '-') + '</td>' +
        '<td>' + refundStatusLabel(status) + (r.rejection_reason ? ' <span class="text-muted">(' + esc(r.rejection_reason) + ')</span>' : '') + '</td>' +
        '<td>' + actions + '</td></tr>';
    }).join('') : '<tr><td colspan="10" class="text-muted">환불 요청이 없습니다.</td></tr>';

    var html = '<div class="card profit-card">' +
      '<h3>고객 환불</h3>' +
      '<p class="text-muted">지출과 별개로, 고객에게 계좌이체로 환불할 내역을 신청하고 브랜드/슈퍼 관리자가 승인한 뒤 회계관리자가 이체 완료 처리합니다. 수익률에는 반영되지 않습니다.</p>' +
      (canCreateRefund ? '<button type="button" class="btn btn-primary btn-sm mb-3" id="btn-refund-add">환불 신청</button>' : '') +
      '<div class="profit-table-wrap">' +
      '<table class="profit-table"><thead><tr>' +
      '<th style="text-align:left">지점</th><th>신청일시</th><th style="text-align:left">고객성함</th><th style="text-align:left">환불은행</th><th style="text-align:left">예금주</th><th style="text-align:left">환불계좌</th><th style="text-align:right">환불금</th><th style="text-align:left">환불 사유</th><th>상태</th><th>작업</th>' +
      '</tr></thead><tbody id="refunds-tbody">' + refundRows + '</tbody></table></div></div>';
    container.innerHTML = html;

    function openRefundModal() {
      var opts = branchOptionsForRefund.map(function (b) { return '<option value="' + esc(b.id) + '">' + esc(b.name || '-') + '</option>'; }).join('');
      if (!opts && canCreateRefund) { alert('선택 가능한 지점이 없습니다. 지점을 선택하거나 설정에서 지점을 추가해 주세요.'); return; }
      var overlay = document.createElement('div');
      overlay.className = 'fx-modal-overlay';
      overlay.innerHTML = '<div class="fx-modal" style="max-width:420px">' +
        '<div class="fx-modal-header"><h4>환불 신청</h4></div>' +
        '<div class="fx-modal-body">' +
        '<p class="text-muted" style="margin-bottom:8px">고객 성함·환불 계좌·금액·사유를 입력하세요. 승인 후 회계관리자가 이체 완료 처리합니다.</p>' +
        '<div style="margin-bottom:10px"><label>지점</label><select class="refund-modal-branch form-control" style="width:100%">' + opts + '</select></div>' +
        '<div style="margin-bottom:10px"><label>고객 성함</label><input type="text" class="refund-modal-customer form-control" placeholder="고객 성함" required></div>' +
        '<div style="margin-bottom:10px"><label>환불 은행</label><input type="text" class="refund-modal-bank form-control" placeholder="은행명"></div>' +
        '<div style="margin-bottom:10px"><label>예금주</label><input type="text" class="refund-modal-holder form-control" placeholder="예금주"></div>' +
        '<div style="margin-bottom:10px"><label>환불 계좌</label><input type="text" class="refund-modal-account form-control" placeholder="계좌번호"></div>' +
        '<div style="margin-bottom:10px"><label>환불금(원)</label><input type="text" class="refund-modal-amount form-control profit-input-comma" inputmode="numeric" placeholder="0" value="0"></div>' +
        '<div style="margin-bottom:10px"><label>환불 사유</label><input type="text" class="refund-modal-reason form-control" placeholder="환불 사유"></div>' +
        '</div>' +
        '<div class="fx-modal-footer">' +
        '<button type="button" class="btn btn-primary refund-modal-submit">신청</button> ' +
        '<button type="button" class="btn btn-outline" data-act="close">취소</button>' +
        '</div></div>';
      document.body.appendChild(overlay);
      var amountEl = overlay.querySelector('.refund-modal-amount');
      amountEl.addEventListener('focus', function () { this.value = String(parseNumberWithCommas(this.value)); });
      amountEl.addEventListener('blur', function () { this.value = fmtNum(parseNumberWithCommas(this.value)); });
      function closeModal() { overlay.remove(); }
      overlay.querySelectorAll('[data-act="close"]').forEach(function (b) { b.addEventListener('click', closeModal); });
      overlay.querySelector('.refund-modal-submit').addEventListener('click', async function () {
        var branchId = overlay.querySelector('.refund-modal-branch').value;
        var customerName = (overlay.querySelector('.refund-modal-customer').value || '').trim();
        var bankName = (overlay.querySelector('.refund-modal-bank').value || '').trim();
        var accountHolder = (overlay.querySelector('.refund-modal-holder').value || '').trim();
        var accountNumber = (overlay.querySelector('.refund-modal-account').value || '').trim();
        var amount = parseNumberWithCommas(overlay.querySelector('.refund-modal-amount').value);
        var reason = (overlay.querySelector('.refund-modal-reason').value || '').trim();
        if (!branchId) { alert('지점을 선택해 주세요.'); return; }
        if (!customerName) { alert('고객 성함을 입력해 주세요.'); return; }
        if (amount < 0) amount = 0;
        var btn = overlay.querySelector('.refund-modal-submit');
        btn.disabled = true;
        try {
          await FX.insertRefundRequest({
            branch_id: branchId,
            customer_name: customerName,
            bank_name: bankName || null,
            account_holder: accountHolder || null,
            account_number: accountNumber || null,
            amount: amount,
            reason: reason || null
          });
          closeModal();
          renderRefundsTab(container, renderVersion);
        } catch (e) {
          alert('신청 실패: ' + (e && e.message ? e.message : String(e)));
        } finally {
          btn.disabled = false;
        }
      });
    }

    function openRejectRefundModal(refundId) {
      var overlay = document.createElement('div');
      overlay.className = 'fx-modal-overlay';
      overlay.innerHTML = '<div class="fx-modal" style="max-width:420px">' +
        '<div class="fx-modal-header"><h4>반려 사유</h4></div>' +
        '<div class="fx-modal-body">' +
        '<p class="text-muted" style="margin-bottom:8px">선택 사항입니다.</p>' +
        '<div style="margin-bottom:10px"><label>사유</label><input type="text" class="refund-reject-reason form-control" placeholder="반려 사유"></div>' +
        '</div>' +
        '<div class="fx-modal-footer">' +
        '<button type="button" class="btn btn-danger refund-reject-submit" data-id="' + esc(refundId) + '">반려</button> ' +
        '<button type="button" class="btn btn-outline" data-act="close">취소</button>' +
        '</div></div>';
      document.body.appendChild(overlay);
      function closeModal() { overlay.remove(); }
      overlay.querySelectorAll('[data-act="close"]').forEach(function (b) { b.addEventListener('click', closeModal); });
      overlay.querySelector('.refund-reject-submit').addEventListener('click', async function () {
        var id = this.getAttribute('data-id');
        var reason = (overlay.querySelector('.refund-reject-reason').value || '').trim();
        var btn = this;
        btn.disabled = true;
        try {
          await FX.rejectRefundRequest(id, reason || null);
          closeModal();
          renderRefundsTab(container, renderVersion);
        } catch (e) {
          alert('반려 처리 실패: ' + (e && e.message ? e.message : String(e)));
        } finally {
          btn.disabled = false;
        }
      });
    }

    var btnRefundAdd = document.getElementById('btn-refund-add');
    if (btnRefundAdd) btnRefundAdd.addEventListener('click', function () { openRefundModal(); });

    container.querySelectorAll('.btn-refund-approve').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id = btn.getAttribute('data-id');
        if (!id) return;
        btn.disabled = true;
        try {
          await FX.approveRefundRequest(id);
          renderRefundsTab(container, renderVersion);
        } catch (e) {
          alert('승인 실패: ' + (e && e.message ? e.message : String(e)));
        } finally {
          btn.disabled = false;
        }
      });
    });
    container.querySelectorAll('.btn-refund-reject').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        if (id) openRejectRefundModal(id);
      });
    });
    container.querySelectorAll('.btn-refund-complete').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id = btn.getAttribute('data-id');
        if (!id) return;
        btn.disabled = true;
        try {
          await FX.markRefundRequestCompleted(id);
          renderRefundsTab(container, renderVersion);
        } catch (e) {
          alert('이체 완료 처리 실패: ' + (e && e.message ? e.message : String(e)));
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  // ── 목표 매출 탭 (월별 선택, 주차별·월별 누적 목표 vs 실적 달성률) ──
  async function renderSalesTargetTab(container, renderVersion) {
    if (!isRenderActive(renderVersion)) return;
    var branchIds = getSelectedBranchIds();
    var perfCtx = createTabPerfContext('sales_target', branchIds);
    if (!branchIds.length) {
      container.innerHTML = emptyState('🎯', '지점을 선택해 주세요', '상단에서 지점을 선택하면 목표 매출과 달성률을 확인할 수 있습니다.');
      flushTabPerfContext(perfCtx);
      return;
    }

    var profile = _profile;
    var isBranchRole = !!(profile && profile.role === 'branch');
    var isBrand = !!(profile && profile.role === 'brand');
    var isSuper = !!(profile && profile.role === 'super');
    var canCreateTarget = isBranchRole || isBrand || isSuper;

    function getMondayOfWeek(d) {
      var date = new Date(d);
      var day = date.getDay();
      var diff = date.getDate() - day + (day === 0 ? -6 : 1);
      var mon = new Date(date.getFullYear(), date.getMonth(), diff);
      return mon;
    }
    function toYYYYMMDD(d) {
      var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
      return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
    }
    function toYYYYMM(d) {
      var y = d.getFullYear(), m = d.getMonth() + 1;
      return y + '-' + (m < 10 ? '0' + m : m);
    }
    // 선택 월(YYYY-MM). 미설정이면 당월
    var now = new Date();
    var selectedMonth = _salesTargetSelectedMonth || toYYYYMM(now);
    var selectedYear = parseInt(selectedMonth.slice(0, 4), 10);
    var selectedMonthNum = parseInt(selectedMonth.slice(5, 7), 10);
    var firstDay = new Date(selectedYear, selectedMonthNum - 1, 1);
    var lastDay = new Date(selectedYear, selectedMonthNum, 0);
    var monthFirstStr = toYYYYMMDD(firstDay);
    var monthLastStr = toYYYYMMDD(lastDay);
    // 해당 월에 속하는 주(월요일 기준): 해당 주 목요일이 해당 월에 있으면 포함
    var firstDayMinus3 = new Date(firstDay.getTime());
    firstDayMinus3.setDate(firstDayMinus3.getDate() - 3);
    var fromMonday = getMondayOfWeek(firstDayMinus3);
    var toMonday = getMondayOfWeek(lastDay);
    var targetFromStr = toYYYYMMDD(fromMonday);
    var targetToStr = toYYYYMMDD(toMonday);
    var weekStarts = [];
    for (var w = new Date(fromMonday.getTime()); w.getTime() <= toMonday.getTime(); w.setDate(w.getDate() + 7)) {
      weekStarts.push(new Date(w.getTime()));
    }
    container.innerHTML = '<div class="text-center text-muted" style="padding:40px">목표 매출 데이터를 불러오는 중...</div>';

    var targetsList = [];
    var salesByBranch = {};
    var monthlyAgg = null;
    try {
      var svc = getFormulaQueryService();
      targetsList = await svc.listBranchWeeklyTargets(branchIds, targetFromStr, targetToStr);
      var agg = await svc.getSalesAggregated(branchIds, monthFirstStr, monthLastStr, {});
      if (agg && Array.isArray(agg.monthly)) {
        for (var mi = 0; mi < agg.monthly.length; mi++) {
          if (String(agg.monthly[mi].period || '').slice(0, 7) === selectedMonth) {
            monthlyAgg = agg.monthly[mi];
            break;
          }
        }
      }
      var salesBatch = await svc.getSalesByBranchBatch(branchIds, monthFirstStr, monthLastStr, {});
      salesByBranch = {};
      branchIds.forEach(function (bid) {
        var unit = salesBatch && salesBatch.byBranch ? salesBatch.byBranch[bid] : null;
        salesByBranch[bid] = (unit && unit.weekly) ? unit.weekly : [];
      });
    } catch (e) {
      if (!isRenderActive(renderVersion)) return;
      container.innerHTML = '<p class="text-danger">데이터를 불러오지 못했습니다. ' + esc(e && e.message ? e.message : String(e)) + '</p>';
      flushTabPerfContext(perfCtx);
      return;
    }
    if (!isRenderActive(renderVersion)) return;

    var targetByKey = {};
    targetsList.forEach(function (t) {
      var k = t.branch_id + '|' + t.week_start;
      targetByKey[k] = { fc: t.fc_target || 0, pt: t.pt_target || 0 };
    });

    // 해당 월에 속하는 주만 목표 합산 (해당 주 수요일이 해당 월이면 포함)
    function weekStartBelongsToMonth(weekStartStr) {
      var parts = weekStartStr.split('-');
      if (parts.length < 3) return false;
      var ws = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      var wednesday = new Date(ws.getTime());
      wednesday.setDate(wednesday.getDate() + 2);
      return wednesday >= firstDay && wednesday <= lastDay;
    }
    var monthlyFcTarget = 0;
    var monthlyPtTarget = 0;
    targetsList.forEach(function (t) {
      if (weekStartBelongsToMonth(t.week_start)) {
        monthlyFcTarget += (t.fc_target || 0);
        monthlyPtTarget += (t.pt_target || 0);
      }
    });
    var monthlyFcActual = monthlyAgg && (monthlyAgg.FC != null) ? parseInt(monthlyAgg.FC, 10) || 0 : 0;
    var monthlyPtActual = monthlyAgg && (monthlyAgg.PT != null) ? parseInt(monthlyAgg.PT, 10) || 0 : 0;
    var monthlyFcRate = monthlyFcTarget > 0 ? Math.round(monthlyFcActual / monthlyFcTarget * 100) : (monthlyFcTarget === 0 && monthlyFcActual === 0 ? '-' : (monthlyFcTarget === 0 ? '-' : '100+'));
    var monthlyPtRate = monthlyPtTarget > 0 ? Math.round(monthlyPtActual / monthlyPtTarget * 100) : (monthlyPtTarget === 0 && monthlyPtActual === 0 ? '-' : (monthlyPtTarget === 0 ? '-' : '100+'));
    if (typeof monthlyFcRate === 'number' && monthlyFcRate > 999) monthlyFcRate = '999+';
    if (typeof monthlyPtRate === 'number' && monthlyPtRate > 999) monthlyPtRate = '999+';
    var monthlyTotalTarget = monthlyFcTarget + monthlyPtTarget;
    var monthlyTotalActual = monthlyFcActual + monthlyPtActual;
    var monthlyTotalRate = monthlyTotalTarget > 0 ? Math.round(monthlyTotalActual / monthlyTotalTarget * 100) : (monthlyTotalTarget === 0 && monthlyTotalActual === 0 ? '-' : (monthlyTotalTarget === 0 ? '-' : '100+'));
    if (typeof monthlyTotalRate === 'number' && monthlyTotalRate > 999) monthlyTotalRate = '999+';

    function stRateCellClass(rate) {
      if (typeof rate === 'number' && rate >= 100) return 'st-cell-achieved';
      if (rate === '100+' || rate === '999+') return 'st-cell-achieved';
      if (typeof rate === 'number' && rate < 100) return 'st-cell-missed';
      return '';
    }

    function periodToWeekStart(period) {
      if (!period || typeof period !== 'string') return null;
      var part = period.split(' ~ ')[0];
      if (!part || part.length < 10) return null;
      return part.trim().slice(0, 10);
    }
    function updateSalesTargetSummary(container) {
      var summaryCard = container ? container.querySelector('.sales-target-summary-card') : null;
      var tbody = container ? container.querySelector('#sales-target-tbody') : null;
      if (!summaryCard || !tbody) return;
      var fcActual = parseInt(summaryCard.getAttribute('data-monthly-fc-actual'), 10) || 0;
      var ptActual = parseInt(summaryCard.getAttribute('data-monthly-pt-actual'), 10) || 0;
      var sumFc = 0, sumPt = 0;
      var rows = tbody.querySelectorAll('tr');
      for (var i = 0; i < rows.length; i++) {
        var firstCell = rows[i].cells[0];
        if (!firstCell) continue;
        var ws = periodToWeekStart(firstCell.textContent || '');
        if (!ws || !weekStartBelongsToMonth(ws)) continue;
        var fcInp = rows[i].querySelector('.st-input-fc');
        var ptInp = rows[i].querySelector('.st-input-pt');
        sumFc += fcInp ? (parseNumberWithCommas(fcInp.value) || 0) : 0;
        sumPt += ptInp ? (parseNumberWithCommas(ptInp.value) || 0) : 0;
      }
      var fcRate = sumFc > 0 ? Math.round(fcActual / sumFc * 100) : (sumFc === 0 && fcActual === 0 ? '-' : (sumFc === 0 ? '-' : '100+'));
      var ptRate = sumPt > 0 ? Math.round(ptActual / sumPt * 100) : (sumPt === 0 && ptActual === 0 ? '-' : (sumPt === 0 ? '-' : '100+'));
      if (typeof fcRate === 'number' && fcRate > 999) fcRate = '999+';
      if (typeof ptRate === 'number' && ptRate > 999) ptRate = '999+';
      var totalT = sumFc + sumPt;
      var totalA = fcActual + ptActual;
      var totalRate = totalT > 0 ? Math.round(totalA / totalT * 100) : (totalT === 0 && totalA === 0 ? '-' : (totalT === 0 ? '-' : '100+'));
      if (typeof totalRate === 'number' && totalRate > 999) totalRate = '999+';
      var fcTargetCell = summaryCard.querySelector('.st-summary-fc-target');
      var fcRateCell = summaryCard.querySelector('.st-summary-fc-rate');
      var ptTargetCell = summaryCard.querySelector('.st-summary-pt-target');
      var ptRateCell = summaryCard.querySelector('.st-summary-pt-rate');
      var totalTargetCell = summaryCard.querySelector('.st-summary-total-target');
      var totalRateCell = summaryCard.querySelector('.st-summary-total-rate');
      if (fcTargetCell) fcTargetCell.textContent = fmtNum(sumFc);
      if (fcRateCell) { fcRateCell.textContent = fcRate === '-' ? '-' : fcRate + '%'; fcRateCell.className = 'st-summary-fc-rate ' + stRateCellClass(fcRate); }
      if (ptTargetCell) ptTargetCell.textContent = fmtNum(sumPt);
      if (ptRateCell) { ptRateCell.textContent = ptRate === '-' ? '-' : ptRate + '%'; ptRateCell.className = 'st-summary-pt-rate ' + stRateCellClass(ptRate); }
      if (totalTargetCell) totalTargetCell.textContent = fmtNum(totalT);
      if (totalRateCell) { totalRateCell.textContent = totalRate === '-' ? '-' : totalRate + '%'; totalRateCell.className = 'st-summary-total-rate ' + stRateCellClass(totalRate); }
    }

    var branchNameById = {};
    _branches.forEach(function (b) { branchNameById[b.id] = b.name || '-'; });

    var rows = [];
    for (var wi = 0; wi < weekStarts.length; wi++) {
      var weekStartDate = weekStarts[wi];
      var weekStartStr = toYYYYMMDD(weekStartDate);
      if (!weekStartBelongsToMonth(weekStartStr)) continue;
      var periodLabel = weekStartStr + ' ~ ' + toYYYYMMDD(new Date(weekStartDate.getFullYear(), weekStartDate.getMonth(), weekStartDate.getDate() + 6));
      for (var bi = 0; bi < branchIds.length; bi++) {
        var branchId = branchIds[bi];
        var branchName = branchNameById[branchId] || '-';
        var target = targetByKey[branchId + '|' + weekStartStr] || { fc: 0, pt: 0 };
        var weeklyRows = salesByBranch[branchId] || [];
        var actualRow = null;
        for (var r = 0; r < weeklyRows.length; r++) {
          if (periodToWeekStart(weeklyRows[r].period) === weekStartStr) {
            actualRow = weeklyRows[r];
            break;
          }
        }
        var actualFc = actualRow && actualRow.FC != null ? parseInt(actualRow.FC, 10) || 0 : 0;
        var actualPt = actualRow && actualRow.PT != null ? parseInt(actualRow.PT, 10) || 0 : 0;
        var fcRate = target.fc > 0 ? Math.round(actualFc / target.fc * 100) : (target.fc === 0 && actualFc === 0 ? '-' : (target.fc === 0 ? '-' : '100+'));
        var ptRate = target.pt > 0 ? Math.round(actualPt / target.pt * 100) : (target.pt === 0 && actualPt === 0 ? '-' : (target.pt === 0 ? '-' : '100+'));
        if (typeof fcRate === 'number' && fcRate > 999) fcRate = '999+';
        if (typeof ptRate === 'number' && ptRate > 999) ptRate = '999+';
        rows.push({
          period: periodLabel,
          branchId: branchId,
          branchName: branchName,
          fcTarget: target.fc,
          fcActual: actualFc,
          fcRate: fcRate,
          ptTarget: target.pt,
          ptActual: actualPt,
          ptRate: ptRate,
          weekStartStr: weekStartStr
        });
      }
    }

    function fcTargetCell(r) {
      if (canCreateTarget) {
        return '<td style="text-align:right;padding:4px"><input type="text" class="st-input-fc form-control profit-input-comma" inputmode="numeric" data-branch-id="' + esc(r.branchId) + '" data-week-start="' + esc(r.weekStartStr) + '" value="' + fmtNum(r.fcTarget) + '" placeholder="0" style="width:100%;min-width:70px;text-align:right;box-sizing:border-box"></td>';
      }
      return '<td style="text-align:right">' + fmtNum(r.fcTarget) + '</td>';
    }
    function ptTargetCell(r) {
      if (canCreateTarget) {
        return '<td style="text-align:right;padding:4px"><input type="text" class="st-input-pt form-control profit-input-comma" inputmode="numeric" data-branch-id="' + esc(r.branchId) + '" data-week-start="' + esc(r.weekStartStr) + '" value="' + fmtNum(r.ptTarget) + '" placeholder="0" style="width:100%;min-width:70px;text-align:right;box-sizing:border-box"></td>';
      }
      return '<td style="text-align:right">' + fmtNum(r.ptTarget) + '</td>';
    }
    var tableRowsHtml = rows.length ? rows.map(function (r) {
      return '<tr>' +
        '<td style="text-align:left">' + esc(r.period) + '</td>' +
        '<td style="text-align:left">' + esc(r.branchName) + '</td>' +
        fcTargetCell(r) +
        '<td style="text-align:right">' + fmtNum(r.fcActual) + '</td>' +
        '<td style="text-align:right" class="' + stRateCellClass(r.fcRate) + '">' + (r.fcRate === '-' ? '-' : r.fcRate + '%') + '</td>' +
        ptTargetCell(r) +
        '<td style="text-align:right">' + fmtNum(r.ptActual) + '</td>' +
        '<td style="text-align:right" class="' + stRateCellClass(r.ptRate) + '">' + (r.ptRate === '-' ? '-' : r.ptRate + '%') + '</td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="8" class="text-muted">해당 월 데이터가 없습니다.</td></tr>';

    var monthOptions = [];
    var monthOptionMap = {};
    for (var mo = -18; mo <= 6; mo++) {
      var d = new Date(now.getFullYear(), now.getMonth() + mo, 1);
      var val = toYYYYMM(d);
      var label = d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월';
      monthOptionMap[val] = true;
      monthOptions.push('<option value="' + esc(val) + '"' + (val === selectedMonth ? ' selected' : '') + '>' + label + '</option>');
    }
    if (!monthOptionMap[selectedMonth]) {
      monthOptions.push('<option value="' + esc(selectedMonth) + '" selected>' + esc(selectedYear + '년 ' + selectedMonthNum + '월') + '</option>');
    }

    var monthLabel = selectedYear + '년 ' + selectedMonthNum + '월';
    var summaryHtml = '<div class="card profit-card sales-target-summary-card" style="margin-bottom:16px" data-monthly-fc-actual="' + (monthlyFcActual || 0) + '" data-monthly-pt-actual="' + (monthlyPtActual || 0) + '">' +
      '<h4 style="margin-bottom:12px">' + monthLabel + ' 월별 누적</h4>' +
      '<div class="profit-table-wrap"><table class="profit-table"><thead><tr>' +
      '<th style="text-align:left">구분</th>' +
      '<th style="text-align:right">누적 목표</th><th style="text-align:right">누적 실적</th><th style="text-align:right">달성률</th>' +
      '</tr></thead><tbody>' +
      '<tr><td style="text-align:left">FC</td><td style="text-align:right" class="st-summary-fc-target">' + fmtNum(monthlyFcTarget) + '</td><td style="text-align:right">' + fmtNum(monthlyFcActual) + '</td><td style="text-align:right" class="st-summary-fc-rate ' + stRateCellClass(monthlyFcRate) + '">' + (monthlyFcRate === '-' ? '-' : monthlyFcRate + '%') + '</td></tr>' +
      '<tr><td style="text-align:left">PT</td><td style="text-align:right" class="st-summary-pt-target">' + fmtNum(monthlyPtTarget) + '</td><td style="text-align:right">' + fmtNum(monthlyPtActual) + '</td><td style="text-align:right" class="st-summary-pt-rate ' + stRateCellClass(monthlyPtRate) + '">' + (monthlyPtRate === '-' ? '-' : monthlyPtRate + '%') + '</td></tr>' +
      '<tr style="font-weight:700;border-top:1px solid #e2e8f0"><td style="text-align:left">합계</td><td style="text-align:right" class="st-summary-total-target">' + fmtNum(monthlyTotalTarget) + '</td><td style="text-align:right">' + fmtNum(monthlyTotalActual) + '</td><td style="text-align:right" class="st-summary-total-rate ' + stRateCellClass(monthlyTotalRate) + '">' + (monthlyTotalRate === '-' ? '-' : monthlyTotalRate + '%') + '</td></tr>' +
      '</tbody></table></div></div>';

    var html = '<div class="card profit-card">' +
      '<h3>목표 매출</h3>' +
      '<p class="text-muted">월별로 확인할 수 있습니다. 표에서 FC/PT 목표 셀을 클릭해 바로 입력·수정할 수 있습니다.</p>' +
      '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:16px">' +
      '<label style="display:flex;align-items:center;gap:6px">월 선택 <select id="sales-target-month-select" class="form-control" style="width:auto">' + monthOptions.join('') + '</select></label>' +
      '</div>' +
      summaryHtml +
      '<h4 style="margin:16px 0 8px">주차별 상세 (' + monthLabel + ')</h4>' +
      '<div class="profit-table-wrap">' +
      '<table class="profit-table"><thead><tr>' +
      '<th style="text-align:left">주간</th><th style="text-align:left">지점</th>' +
      '<th style="text-align:right">FC 목표</th><th style="text-align:right">FC 실적</th><th style="text-align:right">FC 달성률</th>' +
      '<th style="text-align:right">PT 목표</th><th style="text-align:right">PT 실적</th><th style="text-align:right">PT 달성률</th>' +
      '</tr></thead><tbody id="sales-target-tbody">' + tableRowsHtml + '</tbody></table></div></div>';
    container.innerHTML = html;

    var monthSelect = document.getElementById('sales-target-month-select');
    if (monthSelect) {
      monthSelect.addEventListener('change', function () {
        _salesTargetSelectedMonth = this.value || toYYYYMM(new Date());
        renderCurrentTab();
      });
    }

    function saveRowTargets(tr) {
      var fcInput = tr.querySelector('.st-input-fc');
      var ptInput = tr.querySelector('.st-input-pt');
      if (!fcInput || !ptInput) return;
      var branchId = fcInput.getAttribute('data-branch-id');
      var weekStart = fcInput.getAttribute('data-week-start');
      if (!branchId || !weekStart) return;
      var fcVal = parseNumberWithCommas(fcInput.value);
      var ptVal = parseNumberWithCommas(ptInput.value);
      if (fcVal < 0) fcVal = 0;
      if (ptVal < 0) ptVal = 0;
      return FX.upsertBranchWeeklyTarget(branchId, weekStart, fcVal, ptVal).then(function (row) {
        var svc = getFormulaQueryService();
        if (svc) {
          svc.invalidateByBranch([branchId]);
          svc.invalidateByMetric(['weekly_targets', 'sales_by_branch', 'sales_aggregated']);
        }
        return row;
      });
    }
    container.querySelectorAll('.st-input-fc, .st-input-pt').forEach(function (input) {
      input.addEventListener('focus', function () { this.value = String(parseNumberWithCommas(this.value)); });
      input.addEventListener('blur', function () {
        this.value = fmtNum(parseNumberWithCommas(this.value));
        var tr = this.closest('tr');
        if (!tr) return;
        saveRowTargets(tr).then(function () {
          updateSalesTargetSummary(container);
        }).catch(function (e) {
          alert('저장 실패: ' + (e && e.message ? e.message : String(e)));
        });
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          this.blur();
        }
      });
    });
    flushTabPerfContext(perfCtx);
  }

  // ── 활동 실적 탭 (일별 전단지, OT, 워크인, 재등록 등) ──
  var ACTIVITY_FIELDS = [
    { key: 'flyer', label: '전단지' },
    { key: 'scroll_banner', label: '족자' },
    { key: 'banner', label: '현수막' },
    { key: 'tm', label: 'TM' },
    { key: 'total_ot_count', label: '총 OT 인원' },
    { key: 'ot_conversion', label: 'OT 전환' },
    { key: 'fc_walkin_count', label: 'FC 워크인 인원' },
    { key: 'fc_walkin_success', label: 'FC 워크인 성공' },
    { key: 'pt_walkin_count', label: 'PT 워크인 인원' },
    { key: 'pt_walkin_success', label: 'PT 워크인 성공' },
    { key: 'fc_rereg_target', label: 'FC 재등록 대상' },
    { key: 'fc_rereg_success', label: 'FC 재등록 성공' },
    { key: 'pt_rereg_target', label: 'PT 재등록 대상' },
    { key: 'pt_rereg_success', label: 'PT 재등록 성공' }
  ];

  async function renderActivityTab(container, renderVersion) {
    if (!isRenderActive(renderVersion)) return;
    var branchIds = getSelectedBranchIds();
    var perfCtx = createTabPerfContext('activity', branchIds);
    if (!branchIds.length) {
      container.innerHTML = emptyState('📋', '지점을 선택해 주세요', '상단에서 지점을 선택하면 활동 실적을 기록할 수 있습니다.');
      flushTabPerfContext(perfCtx);
      return;
    }

    function toYYYYMM(d) {
      var y = d.getFullYear(), m = d.getMonth() + 1;
      return y + '-' + (m < 10 ? '0' + m : m);
    }
    function toYYYYMMDD(d) {
      var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
      return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
    }

    var now = new Date();
    var selectedMonth = _activitySelectedMonth || toYYYYMM(now);
    var selectedYear = parseInt(selectedMonth.slice(0, 4), 10);
    var selectedMonthNum = parseInt(selectedMonth.slice(5, 7), 10);
    var firstDay = new Date(selectedYear, selectedMonthNum - 1, 1);
    var lastDay = new Date(selectedYear, selectedMonthNum, 0);
    var monthFirstStr = toYYYYMMDD(firstDay);
    var monthLastStr = toYYYYMMDD(lastDay);

    container.innerHTML = '<div class="text-center text-muted" style="padding:40px">활동 실적 데이터를 불러오는 중...</div>';

    var list = [];
    try {
      list = await getFormulaQueryService().listBranchDailyActivities(branchIds, monthFirstStr, monthLastStr);
    } catch (e) {
      if (!isRenderActive(renderVersion)) return;
      container.innerHTML = '<p class="text-danger">데이터를 불러오지 못했습니다. ' + esc(e && e.message ? e.message : String(e)) + '</p>';
      flushTabPerfContext(perfCtx);
      return;
    }
    if (!isRenderActive(renderVersion)) return;

    var dataByKey = {};
    list.forEach(function (r) {
      var k = r.branch_id + '|' + r.activity_date;
      dataByKey[k] = r;
    });

    var branchNameById = {};
    _branches.forEach(function (b) { branchNameById[b.id] = b.name || '-'; });

    var multiBranch = branchIds.length > 1;
    var rows = [];
    var d = new Date(firstDay.getTime());
    while (d.getTime() <= lastDay.getTime()) {
      var dateStr = toYYYYMMDD(d);
      for (var bi = 0; bi < branchIds.length; bi++) {
        var branchId = branchIds[bi];
        var branchName = branchNameById[branchId] || '-';
        var rec = dataByKey[branchId + '|' + dateStr] || {};
        var row = { dateStr: dateStr, branchId: branchId, branchName: branchName };
        ACTIVITY_FIELDS.forEach(function (f) {
          row[f.key] = rec[f.key] != null ? rec[f.key] : 0;
        });
        rows.push(row);
      }
      d.setDate(d.getDate() + 1);
    }

    function inputCell(r, fieldKey) {
      var val = r[fieldKey] != null ? r[fieldKey] : 0;
      return '<td style="text-align:right;padding:4px"><input type="text" class="activity-input form-control profit-input-comma" inputmode="decimal" data-branch-id="' + esc(r.branchId) + '" data-activity-date="' + esc(r.dateStr) + '" data-field="' + esc(fieldKey) + '" value="' + fmtNum(val) + '" placeholder="0" title="0.5 단위 입력 가능" style="width:100%;min-width:56px;text-align:right;box-sizing:border-box"></td>';
    }

    var headerCells = '<th style="text-align:left">일자</th>';
    if (multiBranch) headerCells += '<th style="text-align:left">지점</th>';
    ACTIVITY_FIELDS.forEach(function (f) { headerCells += '<th style="text-align:right">' + esc(f.label) + '</th>'; });

    var tableRowsHtml = rows.map(function (r) {
      var cells = '<td style="text-align:left">' + esc(r.dateStr) + '</td>';
      if (multiBranch) cells += '<td style="text-align:left">' + esc(r.branchName) + '</td>';
      ACTIVITY_FIELDS.forEach(function (f) { cells += inputCell(r, f.key); });
      return '<tr>' + cells + '</tr>';
    }).join('');

    var monthOptions = [];
    var monthOptionMap = {};
    for (var mo = -18; mo <= 6; mo++) {
      var dm = new Date(now.getFullYear(), now.getMonth() + mo, 1);
      var val = toYYYYMM(dm);
      var label = dm.getFullYear() + '년 ' + (dm.getMonth() + 1) + '월';
      monthOptionMap[val] = true;
      monthOptions.push('<option value="' + esc(val) + '"' + (val === selectedMonth ? ' selected' : '') + '>' + label + '</option>');
    }
    if (!monthOptionMap[selectedMonth]) {
      monthOptions.push('<option value="' + esc(selectedMonth) + '" selected>' + esc(selectedYear + '년 ' + selectedMonthNum + '월') + '</option>');
    }
    var monthLabel = selectedYear + '년 ' + selectedMonthNum + '월';

    var html = '<div class="card profit-card">' +
      '<h3>활동 실적</h3>' +
      '<p class="text-muted">일별로 전단지, OT, 워크인, 재등록 등 활동 지표를 기록합니다. 셀을 클릭해 입력 후 다른 셀을 누르거나 Enter로 저장됩니다.</p>' +
      '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:16px">' +
      '<label style="display:flex;align-items:center;gap:6px">월 선택 <select id="activity-month-select" class="form-control" style="width:auto">' + monthOptions.join('') + '</select></label>' +
      '</div>' +
      '<div class="profit-table-wrap activity-table-wrap">' +
      '<table class="profit-table" id="activity-table"><thead><tr>' + headerCells + '</tr></thead><tbody>' + tableRowsHtml + '</tbody></table></div></div>';
    container.innerHTML = html;

    var monthSelect = document.getElementById('activity-month-select');
    if (monthSelect) {
      monthSelect.addEventListener('change', function () {
        _activitySelectedMonth = this.value || toYYYYMM(new Date());
        renderCurrentTab();
      });
    }

    function buildPayloadFromRow(tr) {
      var payload = {};
      ACTIVITY_FIELDS.forEach(function (f) {
        var input = tr.querySelector('.activity-input[data-field="' + f.key + '"]');
        if (input) payload[f.key] = parseFloatWithCommas(input.value);
      });
      return payload;
    }

    function saveActivityRow(tr) {
      var firstInput = tr.querySelector('.activity-input');
      if (!firstInput) return Promise.resolve();
      var branchId = firstInput.getAttribute('data-branch-id');
      var activityDate = firstInput.getAttribute('data-activity-date');
      if (!branchId || !activityDate) return Promise.resolve();
      var payload = buildPayloadFromRow(tr);
      return FX.upsertBranchDailyActivity(branchId, activityDate, payload).then(function (row) {
        var svc = getFormulaQueryService();
        if (svc) {
          svc.invalidateByBranch([branchId]);
          svc.invalidateByMetric(['daily_activities', 'monthly_activity_targets']);
        }
        return row;
      });
    }

    function roundToHalf(n) {
      return Math.round(n * 2) / 2;
    }
    container.querySelectorAll('.activity-input').forEach(function (input) {
      input.addEventListener('focus', function () {
        var v = parseFloatWithCommas(this.value);
        this.value = (v % 1 === 0) ? String(Math.round(v)) : String(v);
      });
      input.addEventListener('blur', function () {
        var v = parseFloatWithCommas(this.value);
        if (isNaN(v) || v < 0) v = 0;
        v = roundToHalf(v);
        this.value = fmtNum(v);
        var tr = this.closest('tr');
        if (!tr) return;
        saveActivityRow(tr).then(function () {
        }).catch(function (e) {
          alert('저장 실패: ' + (e && e.message ? e.message : String(e)));
        });
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') this.blur();
      });
    });
    flushTabPerfContext(perfCtx);
  }

  // ── 목표 달성율 탭 (통합: 활동·FC/PT·플레이스·문의) ──
  async function renderGoalAchievementTab(container, renderVersion) {
    if (!isRenderActive(renderVersion)) return;
    var branchIds = getSelectedBranchIds();
    var perfCtx = createTabPerfContext('goal_achievement', branchIds);
    if (!branchIds.length) {
      container.innerHTML = emptyState('🎯', '지점을 선택해 주세요', '상단에서 지점을 선택하면 목표 달성율을 확인할 수 있습니다.');
      flushTabPerfContext(perfCtx);
      return;
    }

    function toYYYYMM(d) {
      var y = d.getFullYear(), m = d.getMonth() + 1;
      return y + '-' + (m < 10 ? '0' + m : m);
    }
    function toYYYYMMDD(d) {
      var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
      return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
    }
    function getMondayOfWeek(d) {
      var date = new Date(d);
      var day = date.getDay();
      var diff = date.getDate() - day + (day === 0 ? -6 : 1);
      return new Date(date.getFullYear(), date.getMonth(), diff);
    }
    function weekStartBelongsToMonth(weekStartStr, firstDay, lastDay) {
      var parts = weekStartStr.split('-');
      if (parts.length < 3) return false;
      var ws = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      var wednesday = new Date(ws.getTime());
      wednesday.setDate(wednesday.getDate() + 2);
      return wednesday >= firstDay && wednesday <= lastDay;
    }
    function periodToWeekStart(period) {
      if (!period || typeof period !== 'string') return null;
      var part = period.split(' ~ ')[0];
      return part ? part.trim().slice(0, 10) : null;
    }

    var now = new Date();
    var selectedMonth = _goalAchievementSelectedMonth || toYYYYMM(now);
    var selectedYear = parseInt(selectedMonth.slice(0, 4), 10);
    var selectedMonthNum = parseInt(selectedMonth.slice(5, 7), 10);
    var firstDay = new Date(selectedYear, selectedMonthNum - 1, 1);
    var lastDay = new Date(selectedYear, selectedMonthNum, 0);
    var monthFirstStr = toYYYYMMDD(firstDay);
    var monthLastStr = toYYYYMMDD(lastDay);
    var prevMonthFirst = new Date(selectedYear, selectedMonthNum - 2, 1);
    var prevMonthLast = new Date(selectedYear, selectedMonthNum - 1, 0);
    var prevMonthFirstStr = toYYYYMMDD(prevMonthFirst);
    var prevMonthLastStr = toYYYYMMDD(prevMonthLast);

    var firstDayMinus3 = new Date(firstDay.getTime());
    firstDayMinus3.setDate(firstDayMinus3.getDate() - 3);
    var fromMonday = getMondayOfWeek(firstDayMinus3);
    var toMonday = getMondayOfWeek(lastDay);
    var targetFromStr = toYYYYMMDD(fromMonday);
    var targetToStr = toYYYYMMDD(toMonday);
    var weekStarts = [];
    for (var w = new Date(fromMonday.getTime()); w.getTime() <= toMonday.getTime(); w.setDate(w.getDate() + 7)) {
      weekStarts.push(new Date(w.getTime()));
    }

    container.innerHTML = '<div class="text-center text-muted" style="padding:40px">목표 달성율 데이터를 불러오는 중...</div>';

    var activitiesCur = [], activitiesPrev = [], targetsList = [], monthlyTargets = [], salesWeeklyByBranch = {}, monthlyAgg = null;
    var placeWeeklyAll = [], placeChannelsAll = [];
    try {
      var svc = getFormulaQueryService();
      var allData = await Promise.all([
        svc.listBranchDailyActivities(branchIds, monthFirstStr, monthLastStr),
        svc.listBranchDailyActivities(branchIds, prevMonthFirstStr, prevMonthLastStr),
        svc.listBranchMonthlyActivityTargets(branchIds, selectedMonth),
        svc.listBranchWeeklyTargets(branchIds, targetFromStr, targetToStr),
        svc.getSalesAggregated(branchIds, monthFirstStr, monthLastStr, {}),
        svc.getSalesByBranchBatch(branchIds, monthFirstStr, monthLastStr, {}),
        svc.getPlaceBundle(branchIds)
      ]);
      activitiesCur = allData[0] || [];
      activitiesPrev = allData[1] || [];
      monthlyTargets = allData[2] || [];
      targetsList = allData[3] || [];
      var agg = allData[4];
      var salesBatch = allData[5];
      var placeBundle = allData[6];
      if (agg && Array.isArray(agg.monthly)) {
        for (var mi = 0; mi < agg.monthly.length; mi++) {
          if (String(agg.monthly[mi].period || '').slice(0, 7) === selectedMonth) {
            monthlyAgg = agg.monthly[mi];
            break;
          }
        }
      }
      salesWeeklyByBranch = {};
      branchIds.forEach(function (bid) {
        var unit = salesBatch && salesBatch.byBranch ? salesBatch.byBranch[bid] : null;
        salesWeeklyByBranch[bid] = (unit && unit.weekly) ? unit.weekly : [];
      });
      placeWeeklyAll = (placeBundle && placeBundle.weekly) ? placeBundle.weekly : [];
      placeChannelsAll = (placeBundle && placeBundle.channels) ? placeBundle.channels : [];
      if (branchIds.length > 1 && String(_currentBranch).indexOf('__grp__:') === 0) {
        placeWeeklyAll = dedupePlaceRowsByKey(placeWeeklyAll, 'week_key');
        placeChannelsAll = dedupePlaceRowsByKey(placeChannelsAll, 'week_key', 'channel_name');
      }
    } catch (e) {
      if (!isRenderActive(renderVersion)) return;
      container.innerHTML = '<p class="text-danger">데이터를 불러오지 못했습니다. ' + esc(e && e.message ? e.message : String(e)) + '</p>';
      flushTabPerfContext(perfCtx);
      return;
    }
    if (!isRenderActive(renderVersion)) return;

    try {
    var targetByKey = {};
    targetsList.forEach(function (t) {
      targetByKey[t.branch_id + '|' + t.week_start] = { fc: t.fc_target || 0, pt: t.pt_target || 0 };
    });
    var monthlyTargetByBranch = {};
    monthlyTargets.forEach(function (t) {
      monthlyTargetByBranch[t.branch_id] = t;
    });

    var sumActivity = function (list, branchIds, keys) {
      var out = {};
      keys.forEach(function (k) { out[k] = 0; });
      list.forEach(function (r) {
        if (branchIds.indexOf(r.branch_id) < 0) return;
        keys.forEach(function (k) {
          out[k] += (r[k] != null ? parseFloat(r[k]) : 0) || 0;
        });
      });
      return out;
    };
    var activityKeys = ['flyer', 'scroll_banner', 'banner', 'tm', 'total_ot_count', 'ot_conversion', 'fc_walkin_count', 'fc_walkin_success', 'pt_walkin_count', 'pt_walkin_success', 'fc_rereg_target', 'fc_rereg_success', 'pt_rereg_target', 'pt_rereg_success'];
    var curSums = sumActivity(activitiesCur, branchIds, activityKeys);
    var prevSums = sumActivity(activitiesPrev, branchIds, activityKeys);

    var branchNameById = {};
    _branches.forEach(function (b) { branchNameById[b.id] = b.name || '-'; });
    var selectedLabel = _currentBranch === '__all__' ? '전체 통합' : (branchIds.length === 1 ? branchNameById[branchIds[0]] : '전체 통합');

    var monthlyFcTarget = 0, monthlyPtTarget = 0;
    targetsList.forEach(function (t) {
      if (weekStartBelongsToMonth(t.week_start, firstDay, lastDay)) {
        monthlyFcTarget += (t.fc_target || 0);
        monthlyPtTarget += (t.pt_target || 0);
      }
    });
    var monthlyFcActual = monthlyAgg && (monthlyAgg.FC != null) ? parseInt(monthlyAgg.FC, 10) || 0 : 0;
    var monthlyPtActual = monthlyAgg && (monthlyAgg.PT != null) ? parseInt(monthlyAgg.PT, 10) || 0 : 0;

    var firstTarget = branchIds.length ? monthlyTargetByBranch[branchIds[0]] : null;
    var tFlyer = firstTarget ? (firstTarget.flyer_target || 0) : 0;
    var tScroll = firstTarget ? (firstTarget.scroll_banner_target || 0) : 0;
    var tBanner = firstTarget ? (firstTarget.banner_target || 0) : 0;
    var tTm = firstTarget ? (firstTarget.tm_target || 0) : 0;
    var tOt = firstTarget ? (firstTarget.total_ot_count_target || 0) : 0;
    var tOtConv = firstTarget ? (firstTarget.ot_conversion_target || 0) : 0;
    var tFcWalkCnt = firstTarget ? (firstTarget.fc_walkin_count_target || 0) : 0;
    var tFcWalkSucc = firstTarget ? (firstTarget.fc_walkin_success_target || 0) : 0;
    var tPtWalkCnt = firstTarget ? (firstTarget.pt_walkin_count_target || 0) : 0;
    var tPtWalkSucc = firstTarget ? (firstTarget.pt_walkin_success_target || 0) : 0;
    var tFcReregT = firstTarget ? (firstTarget.fc_rereg_target_target || 0) : 0;
    var tFcReregS = firstTarget ? (firstTarget.fc_rereg_success_target || 0) : 0;
    var tPtReregT = firstTarget ? (firstTarget.pt_rereg_target_target || 0) : 0;
    var tPtReregS = firstTarget ? (firstTarget.pt_rereg_success_target || 0) : 0;
    if (branchIds.length > 1) {
      branchIds.forEach(function (bid) {
        var t = monthlyTargetByBranch[bid];
        if (t) {
          tFlyer += t.flyer_target || 0;
          tScroll += t.scroll_banner_target || 0;
          tBanner += t.banner_target || 0;
          tTm += t.tm_target || 0;
          tOt += t.total_ot_count_target || 0;
          tOtConv += t.ot_conversion_target || 0;
          tFcWalkCnt += t.fc_walkin_count_target || 0;
          tFcWalkSucc += t.fc_walkin_success_target || 0;
          tPtWalkCnt += t.pt_walkin_count_target || 0;
          tPtWalkSucc += t.pt_walkin_success_target || 0;
          tFcReregT += t.fc_rereg_target_target || 0;
          tFcReregS += t.fc_rereg_success_target || 0;
          tPtReregT += t.pt_rereg_target_target || 0;
          tPtReregS += t.pt_rereg_success_target || 0;
        }
      });
    }

    function rateClass(rate) {
      if (rate == null || rate === '-' || rate === '') return '';
      var n = typeof rate === 'number' ? rate : parseFloat(rate);
      if (isNaN(n)) return '';
      if (n >= 100) return 'st-cell-achieved';
      if (n < 100) return 'st-cell-missed';
      return '';
    }
    function pctStr(val, target) {
      if (target == null || target === 0) return '-';
      var v = (val || 0) / target * 100;
      return Math.round(v) + '%';
    }
    function successRate(num, den) {
      if (den == null || den === 0) return null;
      return (num || 0) / den * 100;
    }

    var otPrevRate = prevSums.total_ot_count > 0 ? successRate(prevSums.ot_conversion, prevSums.total_ot_count) : null;
    var otCurRate = curSums.total_ot_count > 0 ? successRate(curSums.ot_conversion, curSums.total_ot_count) : null;
    var fcWalkPrev = prevSums.fc_walkin_count > 0 ? successRate(prevSums.fc_walkin_success, prevSums.fc_walkin_count) : null;
    var fcWalkCur = curSums.fc_walkin_count > 0 ? successRate(curSums.fc_walkin_success, curSums.fc_walkin_count) : null;
    var ptWalkPrev = prevSums.pt_walkin_count > 0 ? successRate(prevSums.pt_walkin_success, prevSums.pt_walkin_count) : null;
    var ptWalkCur = curSums.pt_walkin_count > 0 ? successRate(curSums.pt_walkin_success, curSums.pt_walkin_count) : null;
    var fcReregPrev = prevSums.fc_rereg_target > 0 ? successRate(prevSums.fc_rereg_success, prevSums.fc_rereg_target) : null;
    var fcReregCur = curSums.fc_rereg_target > 0 ? successRate(curSums.fc_rereg_success, curSums.fc_rereg_target) : null;
    var ptReregPrev = prevSums.pt_rereg_target > 0 ? successRate(prevSums.pt_rereg_success, prevSums.pt_rereg_target) : null;
    var ptReregCur = curSums.pt_rereg_target > 0 ? successRate(curSums.pt_rereg_success, curSums.pt_rereg_target) : null;
    var perBranchSums = {};
    branchIds.forEach(function (bid) {
      perBranchSums[bid] = sumActivity(activitiesCur, [bid], activityKeys);
    });

    var monthlyFcRate = monthlyFcTarget > 0 ? Math.round(monthlyFcActual / monthlyFcTarget * 100) : (monthlyFcTarget === 0 && monthlyFcActual === 0 ? '-' : (monthlyFcTarget === 0 ? '-' : '100+'));
    var monthlyPtRate = monthlyPtTarget > 0 ? Math.round(monthlyPtActual / monthlyPtTarget * 100) : (monthlyPtTarget === 0 && monthlyPtActual === 0 ? '-' : (monthlyPtTarget === 0 ? '-' : '100+'));
    if (typeof monthlyFcRate === 'number' && monthlyFcRate > 999) monthlyFcRate = '999+';
    if (typeof monthlyPtRate === 'number' && monthlyPtRate > 999) monthlyPtRate = '999+';
    var overallStrengths = [];
    if (monthlyFcRate !== '-' && Number(monthlyFcRate) >= 100) overallStrengths.push('FC 목표 달성');
    if (monthlyPtRate !== '-' && Number(monthlyPtRate) >= 100) overallStrengths.push('PT 목표 달성');
    if (otCurRate != null && otCurRate >= 30) overallStrengths.push('OT 전환 양호');
    if (fcWalkCur != null && fcWalkCur >= 30) overallStrengths.push('FC 워크인 전환 양호');
    if (ptWalkCur != null && ptWalkCur >= 30) overallStrengths.push('PT 워크인 전환 양호');
    if (!overallStrengths.length) overallStrengths.push('핵심 지표 점검 필요');
    var overallNeeds = [];
    if (monthlyFcRate === '-' || Number(monthlyFcRate) < 100) overallNeeds.push('FC 목표');
    if (monthlyPtRate === '-' || Number(monthlyPtRate) < 100) overallNeeds.push('PT 목표');
    if (otCurRate == null || otCurRate < 30) overallNeeds.push('OT 전환');
    if (fcWalkCur == null || fcWalkCur < 30) overallNeeds.push('FC 워크인 전환');
    if (ptWalkCur == null || ptWalkCur < 30) overallNeeds.push('PT 워크인 전환');
    if (!overallNeeds.length) overallNeeds.push('유지');

    var gaRows = [];
    for (var wi = 0; wi < weekStarts.length; wi++) {
      var weekStartDate = weekStarts[wi];
      var weekStartStr = toYYYYMMDD(weekStartDate);
      if (!weekStartBelongsToMonth(weekStartStr, firstDay, lastDay)) continue;
      var periodLabel = weekStartStr + ' ~ ' + toYYYYMMDD(new Date(weekStartDate.getFullYear(), weekStartDate.getMonth(), weekStartDate.getDate() + 6));
      var sumFcT = 0, sumPtT = 0, sumFcA = 0, sumPtA = 0;
      for (var bi = 0; bi < branchIds.length; bi++) {
        var branchId = branchIds[bi];
        var target = targetByKey[branchId + '|' + weekStartStr] || { fc: 0, pt: 0 };
        var weeklyRows = salesWeeklyByBranch[branchId] || [];
        var actualRow = null;
        for (var r = 0; r < weeklyRows.length; r++) {
          if (periodToWeekStart(weeklyRows[r].period) === weekStartStr) {
            actualRow = weeklyRows[r];
            break;
          }
        }
        var actualFc = actualRow && actualRow.FC != null ? parseInt(actualRow.FC, 10) || 0 : 0;
        var actualPt = actualRow && actualRow.PT != null ? parseInt(actualRow.PT, 10) || 0 : 0;
        sumFcT += target.fc;
        sumPtT += target.pt;
        sumFcA += actualFc;
        sumPtA += actualPt;
      }
      var fcRate = sumFcT > 0 ? Math.round(sumFcA / sumFcT * 100) : (sumFcT === 0 && sumFcA === 0 ? '-' : (sumFcT === 0 ? '-' : '100+'));
      var ptRate = sumPtT > 0 ? Math.round(sumPtA / sumPtT * 100) : (sumPtT === 0 && sumPtA === 0 ? '-' : (sumPtT === 0 ? '-' : '100+'));
      if (typeof fcRate === 'number' && fcRate > 999) fcRate = '999+';
      if (typeof ptRate === 'number' && ptRate > 999) ptRate = '999+';
      gaRows.push({
        period: periodLabel,
        weekStartStr: weekStartStr,
        fcTarget: sumFcT,
        fcActual: sumFcA,
        fcRate: fcRate,
        ptTarget: sumPtT,
        ptActual: sumPtA,
        ptRate: ptRate
      });
    }
    var weekStartStrs = gaRows.map(function (r) { return r.weekStartStr; });

    var placeByWeek = {};
    var weekKeysInMonth = {};
    weekStartStrs.forEach(function (ws) { weekKeysInMonth[ws] = true; });
    placeWeeklyAll.forEach(function (r) {
      var ws = weekStartFromKey(r.week_key);
      if (!weekKeysInMonth[ws]) return;
      if (!placeByWeek[ws]) placeByWeek[ws] = { inflow: 0, orders: 0, smart_call: 0, reviews: 0 };
      placeByWeek[ws].inflow += parseInt(r.inflow || 0, 10) || 0;
      placeByWeek[ws].orders += parseInt(r.orders || 0, 10) || 0;
      placeByWeek[ws].smart_call += parseInt(r.smart_call || 0, 10) || 0;
      placeByWeek[ws].reviews += parseInt(r.reviews || 0, 10) || 0;
    });
    var chByWeek = {};
    placeChannelsAll.forEach(function (r) {
      var ws = weekStartFromKey(r.week_key);
      if (!weekKeysInMonth[ws]) return;
      if (!chByWeek[ws]) chByWeek[ws] = {};
      chByWeek[ws][r.channel_name] = (chByWeek[ws][r.channel_name] || 0) + (r.inflow_count || 0);
    });
    var chNames = [];
    weekStartStrs.forEach(function (w) {
      Object.keys(chByWeek[w] || {}).forEach(function (c) {
        if (chNames.indexOf(c) < 0) chNames.push(c);
      });
    });
    chNames.sort();
    function gaBarCell(val, max, rgb, label) {
      if (max == null || max <= 0) max = 1;
      var p = Math.min(100, Math.round((val || 0) / max * 100));
      var txt = label !== undefined ? label : fmtNum(val || 0);
      return '<td><div class="bar-cell"><div class="bar-fill" style="width:' + p + '%;background:rgba(' + rgb + ',0.35)"></div><span class="bar-value">' + esc(txt) + '</span></div></td>';
    }

    var monthLabel = selectedYear + '년 ' + selectedMonthNum + '월';
    var monthOptions = [];
    var monthOptionMap = {};
    for (var mo = -18; mo <= 6; mo++) {
      var d = new Date(now.getFullYear(), now.getMonth() + mo, 1);
      var val = toYYYYMM(d);
      var label = d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월';
      monthOptionMap[val] = true;
      monthOptions.push('<option value="' + esc(val) + '"' + (val === selectedMonth ? ' selected' : '') + '>' + label + '</option>');
    }
    if (!monthOptionMap[selectedMonth]) {
      monthOptions.push('<option value="' + esc(selectedMonth) + '" selected>' + esc(selectedYear + '년 ' + selectedMonthNum + '월') + '</option>');
    }
    var gaMonthWrap = document.getElementById('goal-achievement-month-wrap');
    var gaMonthSelect = document.getElementById('goal-achievement-month-select');
    if (gaMonthSelect) {
      gaMonthSelect.innerHTML = monthOptions.join('');
      gaMonthSelect.value = selectedMonth;
    }
    if (gaMonthWrap) gaMonthWrap.style.display = 'flex';

    var canEditTarget = branchIds.length === 1 && typeof FX.upsertBranchMonthlyActivityTarget === 'function';
    var otTargetRate = firstTarget && firstTarget.ot_success_rate_target != null ? firstTarget.ot_success_rate_target : null;
    var fcWalkTargetR = firstTarget && firstTarget.fc_walkin_success_rate_target != null ? firstTarget.fc_walkin_success_rate_target : null;
    var ptWalkTargetR = firstTarget && firstTarget.pt_walkin_success_rate_target != null ? firstTarget.pt_walkin_success_rate_target : null;
    var fcReregTargetR = firstTarget && firstTarget.fc_rereg_success_rate_target != null ? firstTarget.fc_rereg_success_rate_target : null;
    var ptReregTargetR = firstTarget && firstTarget.pt_rereg_success_rate_target != null ? firstTarget.pt_rereg_success_rate_target : null;
    function rateTd(v) { return v != null ? (Math.round(v * 10) / 10) + '%' : '-'; }
    var html = '<div class="goal-achievement-root">';
    html += '<div class="card insights-card goal-achievement-insight-card"><h3 class="table-title">🧠 Formula X AI 목표 달성율 종합 인사이트</h3>';
    html += '<div class="insight-item"><span class="tag tag-info">📌</span> 기준: <strong>' + esc(monthLabel) + ' ' + esc(selectedLabel) + '</strong></div>';
    html += '<div class="insight-item"><span class="tag tag-info">💰</span> 매출 달성율: FC <strong>' + (monthlyFcRate === '-' ? '-' : monthlyFcRate + '%') + '</strong> / PT <strong>' + (monthlyPtRate === '-' ? '-' : monthlyPtRate + '%') + '</strong></div>';
    html += '<div class="insight-item"><span class="tag tag-info">🔄</span> 전환율: OT <strong>' + rateTd(otCurRate) + '</strong> · FC 워크인 <strong>' + rateTd(fcWalkCur) + '</strong> · PT 워크인 <strong>' + rateTd(ptWalkCur) + '</strong></div>';
    html += '<div class="insight-item"><span class="tag tag-up">✅</span> 강점: <strong style="color:#4ade80">' + esc(overallStrengths.join(', ')) + '</strong></div>';
    html += '<div class="insight-item"><span class="tag tag-warn">🛠</span> 개선 필요: <strong style="color:#f87171">' + esc(overallNeeds.join(', ')) + '</strong></div>';
    html += '<hr style="border-color:rgba(255,255,255,0.12);margin:10px 0;">';
    html += '<div class="insight-item"><span class="tag tag-info">🏪</span> <strong>지점별 인사이트</strong></div>';
    branchIds.forEach(function (bid) {
      var name = branchNameById[bid] || '-';
      var s = perBranchSums[bid] || {};
      var t = monthlyTargetByBranch[bid] || {};
      var otR = s.total_ot_count > 0 ? successRate(s.ot_conversion, s.total_ot_count) : null;
      var fcWalkR = s.fc_walkin_count > 0 ? successRate(s.fc_walkin_success, s.fc_walkin_count) : null;
      var ptWalkR = s.pt_walkin_count > 0 ? successRate(s.pt_walkin_success, s.pt_walkin_count) : null;
      html += '<div class="insight-item"><span class="tag tag-info">📍</span> <strong>' + esc(name) + '</strong> | OT ' + rateTd(otR) + (t.ot_success_rate_target != null ? ' (목표 ' + t.ot_success_rate_target + '%)' : '') + ' | FC 워크인 ' + rateTd(fcWalkR) + (t.fc_walkin_success_rate_target != null ? ' (목표 ' + t.fc_walkin_success_rate_target + '%)' : '') + ' | PT 워크인 ' + rateTd(ptWalkR) + (t.pt_walkin_success_rate_target != null ? ' (목표 ' + t.pt_walkin_success_rate_target + '%)' : '') + '</div>';
    });
    html += '<div class="goal-achievement-ai-insight-block" style="margin-top:12px;min-height:40px;white-space:pre-wrap;line-height:1.5"></div>';
    html += '<button type="button" class="btn btn-primary goal-achievement-ai-insight-btn" style="margin-top:8px">AI 인사이트 생성</button>';
    html += '</div>';
    html += '<div class="card profit-card goal-achievement-header-card">';
    html += '<div class="goal-achievement-header-top" style="margin-bottom:16px">';
    html += '<h3 class="table-title goal-achievement-main-title" style="margin:0 0 6px 0">📊 ' + esc(monthLabel) + ' ' + esc(selectedLabel) + ' 목표 달성율</h3>';
    html += '<p class="goal-achievement-legend text-muted" style="margin:0 0 10px 0;font-size:12px">FC = 회원권 · PT = 1:1 트레이닝 · OT = PT 전환을 위한 무료 체험</p>';
    html += '<h4 style="margin:0 0 10px 0;font-size:15px;font-weight:600;color:#1e293b">전환 목표 달성 현황</h4>';
    html += '</div>';
    html += '<div class="goal-achievement-conversion-block" style="display:block;width:100%;max-width:100%;margin:0">';
    html += '<div class="goal-achievement-conversion-desktop" id="goal-achievement-conversion-desktop" style="display:block">';
    html += '<div class="goal-achievement-conversion-table-wrap" style="overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%;min-width:0">';
    html += '<table class="profit-table goal-achievement-conversion-table" style="table-layout:fixed;width:100%"><thead><tr>';
    html += '<th style="text-align:left">구분</th><th style="text-align:right">OT</th><th style="text-align:right">FC 워크인</th><th style="text-align:right">PT 워크인</th><th style="text-align:right">FC 재등록</th><th style="text-align:right">PT 재등록</th></tr></thead><tbody>';
    html += '<tr><td style="text-align:left;font-weight:600">전월 실적</td><td style="text-align:right">' + rateTd(otPrevRate) + '</td><td style="text-align:right">' + rateTd(fcWalkPrev) + '</td><td style="text-align:right">' + rateTd(ptWalkPrev) + '</td><td style="text-align:right">' + rateTd(fcReregPrev) + '</td><td style="text-align:right">' + rateTd(ptReregPrev) + '</td></tr>';
    if (canEditTarget) {
      html += '<tr class="goal-achievement-conversion-target-row"><td style="text-align:left;font-weight:600">목표</td>';
      html += '<td style="text-align:right"><input type="text" inputmode="decimal" class="form-control goal-achievement-target-input goal-achievement-rate-target-input" data-field="ot_success_rate_target" value="' + (otTargetRate != null ? otTargetRate + '%' : '') + '" style="width:52px;text-align:right" placeholder="30%" title="% 입력"></td>';
      html += '<td style="text-align:right"><input type="text" inputmode="decimal" class="form-control goal-achievement-target-input goal-achievement-rate-target-input" data-field="fc_walkin_success_rate_target" value="' + (fcWalkTargetR != null ? fcWalkTargetR + '%' : '') + '" style="width:52px;text-align:right" placeholder="30%"></td>';
      html += '<td style="text-align:right"><input type="text" inputmode="decimal" class="form-control goal-achievement-target-input goal-achievement-rate-target-input" data-field="pt_walkin_success_rate_target" value="' + (ptWalkTargetR != null ? ptWalkTargetR + '%' : '') + '" style="width:52px;text-align:right" placeholder="30%"></td>';
      html += '<td style="text-align:right"><input type="text" inputmode="decimal" class="form-control goal-achievement-target-input goal-achievement-rate-target-input" data-field="fc_rereg_success_rate_target" value="' + (fcReregTargetR != null ? fcReregTargetR + '%' : '') + '" style="width:52px;text-align:right" placeholder="30%"></td>';
      html += '<td style="text-align:right"><input type="text" inputmode="decimal" class="form-control goal-achievement-target-input goal-achievement-rate-target-input" data-field="pt_rereg_success_rate_target" value="' + (ptReregTargetR != null ? ptReregTargetR + '%' : '') + '" style="width:52px;text-align:right" placeholder="30%"></td></tr>';
    } else {
      html += '<tr class="goal-achievement-conversion-target-row"><td style="text-align:left;font-weight:600">목표</td>';
      html += '<td style="text-align:right">' + (otTargetRate != null ? otTargetRate + '%' : '-') + '</td><td style="text-align:right">' + (fcWalkTargetR != null ? fcWalkTargetR + '%' : '-') + '</td><td style="text-align:right">' + (ptWalkTargetR != null ? ptWalkTargetR + '%' : '-') + '</td><td style="text-align:right">' + (fcReregTargetR != null ? fcReregTargetR + '%' : '-') + '</td><td style="text-align:right">' + (ptReregTargetR != null ? ptReregTargetR + '%' : '-') + '</td></tr>';
    }
    html += '<tr class="goal-achievement-conversion-actual-row"><td style="text-align:left;font-weight:600">실적</td><td style="text-align:right" class="' + rateClass(otCurRate) + '">' + rateTd(otCurRate) + '</td><td style="text-align:right" class="' + rateClass(fcWalkCur) + '">' + rateTd(fcWalkCur) + '</td><td style="text-align:right" class="' + rateClass(ptWalkCur) + '">' + rateTd(ptWalkCur) + '</td><td style="text-align:right" class="' + rateClass(fcReregCur) + '">' + rateTd(fcReregCur) + '</td><td style="text-align:right" class="' + rateClass(ptReregCur) + '">' + rateTd(ptReregCur) + '</td></tr>';
    html += '<tr class="goal-achievement-conversion-rate-row"><td style="text-align:left;font-weight:600">목표 달성율</td>';
    html += '<td style="text-align:right" class="' + rateClass(pctRate(otCurRate, otTargetRate)) + '">' + (pctRate(otCurRate, otTargetRate) === '-' ? '-' : pctRate(otCurRate, otTargetRate)) + '</td>';
    html += '<td style="text-align:right" class="' + rateClass(pctRate(fcWalkCur, fcWalkTargetR)) + '">' + (pctRate(fcWalkCur, fcWalkTargetR) === '-' ? '-' : pctRate(fcWalkCur, fcWalkTargetR)) + '</td>';
    html += '<td style="text-align:right" class="' + rateClass(pctRate(ptWalkCur, ptWalkTargetR)) + '">' + (pctRate(ptWalkCur, ptWalkTargetR) === '-' ? '-' : pctRate(ptWalkCur, ptWalkTargetR)) + '</td>';
    html += '<td style="text-align:right" class="' + rateClass(pctRate(fcReregCur, fcReregTargetR)) + '">' + (pctRate(fcReregCur, fcReregTargetR) === '-' ? '-' : pctRate(fcReregCur, fcReregTargetR)) + '</td>';
    html += '<td style="text-align:right" class="' + rateClass(pctRate(ptReregCur, ptReregTargetR)) + '">' + (pctRate(ptReregCur, ptReregTargetR) === '-' ? '-' : pctRate(ptReregCur, ptReregTargetR)) + '</td></tr>';
    html += '</tbody></table></div></div>';
    html += '<div class="goal-achievement-conversion-mobile" id="goal-achievement-conversion-mobile" style="display:none;border:1px solid #e2e8f0;border-radius:8px;background:#fff;padding:8px;margin-top:8px">';
    var indicators = [
      { name: 'OT', prev: otPrevRate, target: otTargetRate, cur: otCurRate, targetR: otTargetRate, field: 'ot_success_rate_target' },
      { name: 'FC 워크인', prev: fcWalkPrev, target: fcWalkTargetR, cur: fcWalkCur, targetR: fcWalkTargetR, field: 'fc_walkin_success_rate_target' },
      { name: 'PT 워크인', prev: ptWalkPrev, target: ptWalkTargetR, cur: ptWalkCur, targetR: ptWalkTargetR, field: 'pt_walkin_success_rate_target' },
      { name: 'FC 재등록', prev: fcReregPrev, target: fcReregTargetR, cur: fcReregCur, targetR: fcReregTargetR, field: 'fc_rereg_success_rate_target' },
      { name: 'PT 재등록', prev: ptReregPrev, target: ptReregTargetR, cur: ptReregCur, targetR: ptReregTargetR, field: 'pt_rereg_success_rate_target' }
    ];
    indicators.forEach(function (ind) {
      var t = ind.targetR;
      var rateVal = (t == null || t === '' || (typeof t === 'number' && t <= 0)) ? '-' : (function () { var c = ind.cur != null ? parseFloat(ind.cur) : 0; var tt = typeof t === 'number' ? t : parseFloat(t); return (isNaN(tt) || tt <= 0) ? '-' : (Math.round(c / tt * 100)) + '%'; })();
      html += '<div class="goal-achievement-conversion-mobile-row">';
      html += '<div class="goal-achievement-conversion-mobile-name">' + esc(ind.name) + '</div>';
      html += '<div class="goal-achievement-conversion-mobile-cell">전월 ' + rateTd(ind.prev) + '</div>';
      html += '<div class="goal-achievement-conversion-mobile-cell">목표 ' + (canEditTarget ? '<input type="text" inputmode="decimal" class="form-control goal-achievement-target-input goal-achievement-rate-target-input" data-field="' + esc(ind.field) + '" value="' + (ind.target != null ? ind.target + '%' : '') + '" style="width:48px;text-align:right;display:inline-block" placeholder="%">' : (ind.target != null ? ind.target + '%' : '-')) + '</div>';
      html += '<div class="goal-achievement-conversion-mobile-cell ' + rateClass(ind.cur) + '">실적 ' + rateTd(ind.cur) + '</div>';
      html += '<div class="goal-achievement-conversion-mobile-cell ' + rateClass(rateVal) + '">달성율 ' + (rateVal === '-' ? '-' : rateVal) + '</div>';
      html += '</div>';
    });
    html += '</div></div>';
    html += '</div>';

    html += '<div class="card profit-card goal-achievement-unified-card" style="margin-top:20px" data-scroll-banner-target="' + (firstTarget ? (firstTarget.scroll_banner_target || 0) : 0) + '">';
    if (!canEditTarget && branchIds.length > 1) {
      html += '<p class="text-muted" style="margin-bottom:8px">지점을 하나 선택하면 목표를 수정할 수 있습니다.</p>';
    }
    html += '<div class="profit-table-wrap goal-achievement-unified-table-wrap"><table class="profit-table goal-achievement-unified-table"><thead><tr>';
    html += '<th style="text-align:left">구분</th>';
    html += '<th style="text-align:right">전단지</th><th style="text-align:right">현수막</th><th style="text-align:right">TM</th><th style="text-align:right">총 OT 인원</th><th style="text-align:right">OT 전환</th>';
    html += '<th style="text-align:right">FC 워크인 인원</th><th style="text-align:right">FC 워크인 성공</th><th style="text-align:right">PT 워크인 인원</th><th style="text-align:right">PT 워크인 성공</th>';
    html += '<th style="text-align:right">FC 재등록 대상</th><th style="text-align:right">FC 재등록 성공</th><th style="text-align:right">PT 재등록 대상</th><th style="text-align:right">PT 재등록 성공</th>';
    html += '</tr></thead><tbody>';

    function numRate(t, c) {
      if (t == null || t === '' || (typeof t === 'number' && t <= 0)) return '-';
      var cur = c || 0;
      var r = Math.round(cur / t * 100);
      if (typeof r === 'number' && r > 999) r = '999+';
      return r + '%';
    }
    function pctRate(curVal, targetVal) {
      if (targetVal == null || targetVal === '' || (typeof targetVal === 'number' && targetVal <= 0)) return '-';
      var c = curVal != null ? parseFloat(curVal) : 0;
      var t = typeof targetVal === 'number' ? targetVal : parseFloat(targetVal);
      if (isNaN(t) || t <= 0) return '-';
      var r = Math.round(c / t * 100);
      return r + '%';
    }
    function updateGoalAchievementRateRow(container) {
      var inps = container ? container.querySelectorAll('.goal-achievement-target-input') : [];
      var targets = {};
      var numTargetFields = ['flyer_target', 'banner_target', 'tm_target', 'total_ot_count_target', 'ot_conversion_target', 'fc_walkin_count_target', 'fc_walkin_success_target', 'pt_walkin_count_target', 'pt_walkin_success_target', 'fc_rereg_target_target', 'fc_rereg_success_target', 'pt_rereg_target_target', 'pt_rereg_success_target'];
      for (var i = 0; i < inps.length; i++) {
        var f = inps[i].getAttribute('data-field');
        var v = (inps[i].value || '').trim();
        if (f && numTargetFields.indexOf(f) !== -1) {
          var n = parseFloat(String(v).replace(',', '.')) || 0;
          targets[f] = isNaN(n) || n < 0 ? 0 : Math.round(n * 2) / 2;
        } else if (f && f.indexOf('_target') !== -1) {
          targets[f] = v === '' ? null : parseFloat(String(v).replace(/%/g, '').replace(',', '.')) || null;
        }
      }
      function parseNum(td) {
        var t = (td && td.textContent || '').trim().replace(/,/g, '');
        var n = parseFloat(t);
        return isNaN(n) ? 0 : n;
      }
      function parseRate(td) {
        var t = (td && td.textContent || '').trim().replace(/%/g, '');
        var n = parseFloat(t);
        return isNaN(n) ? null : n;
      }
      var card = container ? container.querySelector('.goal-achievement-unified-card') : null;
      var table = card ? card.querySelector('.goal-achievement-unified-table') : null;
      if (table && table.tBodies && table.tBodies[0]) {
        var tbody = table.tBodies[0];
        var trs = tbody.querySelectorAll('tr');
        if (trs.length >= 4) {
          var actualRow = trs[2];
          var rateRow = trs[3];
          var rateCells = rateRow.cells;
          var actualCells = actualRow.cells;
          if (rateCells.length >= 14 && actualCells.length >= 14) {
            var rate1 = numRate(targets.flyer_target, parseNum(actualCells[1]));
            var rate2 = numRate(targets.banner_target, parseNum(actualCells[2]));
            var rate3 = numRate(targets.tm_target, parseNum(actualCells[3]));
            var rate4 = numRate(targets.total_ot_count_target, parseNum(actualCells[4]));
            var rate5 = numRate(targets.ot_conversion_target, parseNum(actualCells[5]));
            var rate6 = numRate(targets.fc_walkin_count_target, parseNum(actualCells[6]));
            var rate7 = numRate(targets.fc_walkin_success_target, parseNum(actualCells[7]));
            var rate8 = numRate(targets.pt_walkin_count_target, parseNum(actualCells[8]));
            var rate9 = numRate(targets.pt_walkin_success_target, parseNum(actualCells[9]));
            var rate10 = numRate(targets.fc_rereg_target_target, parseNum(actualCells[10]));
            var rate11 = numRate(targets.fc_rereg_success_target, parseNum(actualCells[11]));
            var rate12 = numRate(targets.pt_rereg_target_target, parseNum(actualCells[12]));
            var rate13 = numRate(targets.pt_rereg_success_target, parseNum(actualCells[13]));
            rateCells[1].textContent = rate1 === '-' ? '-' : rate1; rateCells[1].className = rateClass(rate1);
            rateCells[2].textContent = rate2 === '-' ? '-' : rate2; rateCells[2].className = rateClass(rate2);
            rateCells[3].textContent = rate3 === '-' ? '-' : rate3; rateCells[3].className = rateClass(rate3);
            rateCells[4].textContent = rate4 === '-' ? '-' : rate4; rateCells[4].className = rateClass(rate4);
            rateCells[5].textContent = rate5 === '-' ? '-' : rate5; rateCells[5].className = rateClass(rate5);
            rateCells[6].textContent = rate6 === '-' ? '-' : rate6; rateCells[6].className = rateClass(rate6);
            rateCells[7].textContent = rate7 === '-' ? '-' : rate7; rateCells[7].className = rateClass(rate7);
            rateCells[8].textContent = rate8 === '-' ? '-' : rate8; rateCells[8].className = rateClass(rate8);
            rateCells[9].textContent = rate9 === '-' ? '-' : rate9; rateCells[9].className = rateClass(rate9);
            rateCells[10].textContent = rate10 === '-' ? '-' : rate10; rateCells[10].className = rateClass(rate10);
            rateCells[11].textContent = rate11 === '-' ? '-' : rate11; rateCells[11].className = rateClass(rate11);
            rateCells[12].textContent = rate12 === '-' ? '-' : rate12; rateCells[12].className = rateClass(rate12);
            rateCells[13].textContent = rate13 === '-' ? '-' : rate13; rateCells[13].className = rateClass(rate13);
          }
        }
      }
      var convTable = container ? container.querySelector('.goal-achievement-conversion-table') : null;
      if (convTable && convTable.tBodies && convTable.tBodies[0]) {
        var convTrs = convTable.tBodies[0].querySelectorAll('tr');
        if (convTrs.length >= 4) {
          var convActualRow = convTrs[2];
          var convRateRow = convTrs[3];
          var convActualCells = convActualRow.cells;
          var convRateCells = convRateRow.cells;
          if (convActualCells.length >= 6 && convRateCells.length >= 6) {
            var r1 = pctRate(parseRate(convActualCells[1]), targets.ot_success_rate_target);
            var r2 = pctRate(parseRate(convActualCells[2]), targets.fc_walkin_success_rate_target);
            var r3 = pctRate(parseRate(convActualCells[3]), targets.pt_walkin_success_rate_target);
            var r4 = pctRate(parseRate(convActualCells[4]), targets.fc_rereg_success_rate_target);
            var r5 = pctRate(parseRate(convActualCells[5]), targets.pt_rereg_success_rate_target);
            convRateCells[1].textContent = r1 === '-' ? '-' : r1; convRateCells[1].className = rateClass(r1);
            convRateCells[2].textContent = r2 === '-' ? '-' : r2; convRateCells[2].className = rateClass(r2);
            convRateCells[3].textContent = r3 === '-' ? '-' : r3; convRateCells[3].className = rateClass(r3);
            convRateCells[4].textContent = r4 === '-' ? '-' : r4; convRateCells[4].className = rateClass(r4);
            convRateCells[5].textContent = r5 === '-' ? '-' : r5; convRateCells[5].className = rateClass(r5);
          }
        }
      }
    }

    html += '<tr><td style="text-align:left;font-weight:600">전월 실적</td>';
    html += '<td style="text-align:right">' + fmtNum(prevSums.flyer) + '</td><td style="text-align:right">' + fmtNum(prevSums.banner) + '</td><td style="text-align:right">' + fmtNum(prevSums.tm) + '</td><td style="text-align:right">' + fmtNum(prevSums.total_ot_count) + '</td><td style="text-align:right">' + fmtNum(prevSums.ot_conversion) + '</td>';
    html += '<td style="text-align:right">' + fmtNum(prevSums.fc_walkin_count) + '</td><td style="text-align:right">' + fmtNum(prevSums.fc_walkin_success) + '</td><td style="text-align:right">' + fmtNum(prevSums.pt_walkin_count) + '</td><td style="text-align:right">' + fmtNum(prevSums.pt_walkin_success) + '</td>';
    html += '<td style="text-align:right">' + fmtNum(prevSums.fc_rereg_target) + '</td><td style="text-align:right">' + fmtNum(prevSums.fc_rereg_success) + '</td><td style="text-align:right">' + fmtNum(prevSums.pt_rereg_target) + '</td><td style="text-align:right">' + fmtNum(prevSums.pt_rereg_success) + '</td></tr>';

    var targetRow = '<tr><td style="text-align:left;font-weight:600">목표</td>';
    if (canEditTarget) {
      targetRow += '<td style="text-align:right"><input type="number" min="0" step="0.5" class="form-control goal-achievement-target-input" data-field="flyer_target" value="' + (tFlyer != null && tFlyer !== '' ? tFlyer : '') + '" style="width:72px;text-align:right;display:inline-block" title="0.5 단위 입력 가능"></td>';
      targetRow += '<td style="text-align:right"><input type="number" min="0" step="0.5" class="form-control goal-achievement-target-input" data-field="banner_target" value="' + (tBanner != null && tBanner !== '' ? tBanner : '') + '" style="width:72px;text-align:right;display:inline-block" title="0.5 단위 입력 가능"></td>';
      targetRow += '<td style="text-align:right"><input type="number" min="0" step="0.5" class="form-control goal-achievement-target-input" data-field="tm_target" value="' + (tTm != null && tTm !== '' ? tTm : '') + '" style="width:72px;text-align:right;display:inline-block" title="0.5 단위 입력 가능"></td>';
      targetRow += '<td style="text-align:right"><input type="number" min="0" step="0.5" class="form-control goal-achievement-target-input" data-field="total_ot_count_target" value="' + (tOt != null && tOt !== '' ? tOt : '') + '" style="width:72px;text-align:right;display:inline-block" title="0.5 단위 입력 가능"></td>';
      targetRow += '<td style="text-align:right"><input type="number" min="0" step="0.5" class="form-control goal-achievement-target-input" data-field="ot_conversion_target" value="' + (tOtConv != null && tOtConv !== '' ? tOtConv : '') + '" style="width:72px;text-align:right;display:inline-block" title="0.5 단위 입력 가능"></td>';
      targetRow += '<td style="text-align:right"><input type="number" min="0" step="0.5" class="form-control goal-achievement-target-input" data-field="fc_walkin_count_target" value="' + (tFcWalkCnt != null && tFcWalkCnt !== '' ? tFcWalkCnt : '') + '" style="width:72px;text-align:right;display:inline-block" title="0.5 단위 입력 가능"></td>';
      targetRow += '<td style="text-align:right"><input type="number" min="0" step="0.5" class="form-control goal-achievement-target-input" data-field="fc_walkin_success_target" value="' + (tFcWalkSucc != null && tFcWalkSucc !== '' ? tFcWalkSucc : '') + '" style="width:72px;text-align:right;display:inline-block" title="0.5 단위 입력 가능"></td>';
      targetRow += '<td style="text-align:right"><input type="number" min="0" step="0.5" class="form-control goal-achievement-target-input" data-field="pt_walkin_count_target" value="' + (tPtWalkCnt != null && tPtWalkCnt !== '' ? tPtWalkCnt : '') + '" style="width:72px;text-align:right;display:inline-block" title="0.5 단위 입력 가능"></td>';
      targetRow += '<td style="text-align:right"><input type="number" min="0" step="0.5" class="form-control goal-achievement-target-input" data-field="pt_walkin_success_target" value="' + (tPtWalkSucc != null && tPtWalkSucc !== '' ? tPtWalkSucc : '') + '" style="width:72px;text-align:right;display:inline-block" title="0.5 단위 입력 가능"></td>';
      targetRow += '<td style="text-align:right"><input type="number" min="0" step="0.5" class="form-control goal-achievement-target-input" data-field="fc_rereg_target_target" value="' + (tFcReregT != null && tFcReregT !== '' ? tFcReregT : '') + '" style="width:72px;text-align:right;display:inline-block" title="0.5 단위 입력 가능"></td>';
      targetRow += '<td style="text-align:right"><input type="number" min="0" step="0.5" class="form-control goal-achievement-target-input" data-field="fc_rereg_success_target" value="' + (tFcReregS != null && tFcReregS !== '' ? tFcReregS : '') + '" style="width:72px;text-align:right;display:inline-block" title="0.5 단위 입력 가능"></td>';
      targetRow += '<td style="text-align:right"><input type="number" min="0" step="0.5" class="form-control goal-achievement-target-input" data-field="pt_rereg_target_target" value="' + (tPtReregT != null && tPtReregT !== '' ? tPtReregT : '') + '" style="width:72px;text-align:right;display:inline-block" title="0.5 단위 입력 가능"></td>';
      targetRow += '<td style="text-align:right"><input type="number" min="0" step="0.5" class="form-control goal-achievement-target-input" data-field="pt_rereg_success_target" value="' + (tPtReregS != null && tPtReregS !== '' ? tPtReregS : '') + '" style="width:72px;text-align:right;display:inline-block" title="0.5 단위 입력 가능"></td></tr>';
    } else {
      targetRow += '<td style="text-align:right">' + fmtNum(tFlyer) + '</td><td style="text-align:right">' + fmtNum(tBanner) + '</td><td style="text-align:right">' + fmtNum(tTm) + '</td><td style="text-align:right">' + fmtNum(tOt) + '</td>';
      targetRow += '<td style="text-align:right">' + fmtNum(tOtConv) + '</td><td style="text-align:right">' + fmtNum(tFcWalkCnt) + '</td><td style="text-align:right">' + fmtNum(tFcWalkSucc) + '</td><td style="text-align:right">' + fmtNum(tPtWalkCnt) + '</td><td style="text-align:right">' + fmtNum(tPtWalkSucc) + '</td>';
      targetRow += '<td style="text-align:right">' + fmtNum(tFcReregT) + '</td><td style="text-align:right">' + fmtNum(tFcReregS) + '</td><td style="text-align:right">' + fmtNum(tPtReregT) + '</td><td style="text-align:right">' + fmtNum(tPtReregS) + '</td></tr>';
    }
    html += targetRow;

    html += '<tr><td style="text-align:left;font-weight:600">실적</td>';
    html += '<td style="text-align:right">' + fmtNum(curSums.flyer) + '</td><td style="text-align:right">' + fmtNum(curSums.banner) + '</td><td style="text-align:right">' + fmtNum(curSums.tm) + '</td><td style="text-align:right">' + fmtNum(curSums.total_ot_count) + '</td><td style="text-align:right">' + fmtNum(curSums.ot_conversion) + '</td>';
    html += '<td style="text-align:right">' + fmtNum(curSums.fc_walkin_count) + '</td><td style="text-align:right">' + fmtNum(curSums.fc_walkin_success) + '</td><td style="text-align:right">' + fmtNum(curSums.pt_walkin_count) + '</td><td style="text-align:right">' + fmtNum(curSums.pt_walkin_success) + '</td>';
    html += '<td style="text-align:right">' + fmtNum(curSums.fc_rereg_target) + '</td><td style="text-align:right">' + fmtNum(curSums.fc_rereg_success) + '</td><td style="text-align:right">' + fmtNum(curSums.pt_rereg_target) + '</td><td style="text-align:right">' + fmtNum(curSums.pt_rereg_success) + '</td></tr>';

    var rateFlyer = numRate(tFlyer, curSums.flyer);
    var rateBanner = numRate(tBanner, curSums.banner);
    var rateTm = numRate(tTm, curSums.tm);
    var rateOt = numRate(tOt, curSums.total_ot_count);
    var rateOtConv = numRate(tOtConv, curSums.ot_conversion);
    var rateFcWalkCnt = numRate(tFcWalkCnt, curSums.fc_walkin_count);
    var rateFcWalkSucc = numRate(tFcWalkSucc, curSums.fc_walkin_success);
    var ratePtWalkCnt = numRate(tPtWalkCnt, curSums.pt_walkin_count);
    var ratePtWalkSucc = numRate(tPtWalkSucc, curSums.pt_walkin_success);
    var rateFcReregT = numRate(tFcReregT, curSums.fc_rereg_target);
    var rateFcReregS = numRate(tFcReregS, curSums.fc_rereg_success);
    var ratePtReregT = numRate(tPtReregT, curSums.pt_rereg_target);
    var ratePtReregS = numRate(tPtReregS, curSums.pt_rereg_success);
    html += '<tr><td style="text-align:left;font-weight:600">목표 달성율</td>';
    html += '<td style="text-align:right" class="' + rateClass(rateFlyer) + '">' + (rateFlyer === '-' ? '-' : rateFlyer) + '</td><td style="text-align:right" class="' + rateClass(rateBanner) + '">' + (rateBanner === '-' ? '-' : rateBanner) + '</td><td style="text-align:right" class="' + rateClass(rateTm) + '">' + (rateTm === '-' ? '-' : rateTm) + '</td><td style="text-align:right" class="' + rateClass(rateOt) + '">' + (rateOt === '-' ? '-' : rateOt) + '</td>';
    html += '<td style="text-align:right" class="' + rateClass(rateOtConv) + '">' + (rateOtConv === '-' ? '-' : rateOtConv) + '</td>';
    html += '<td style="text-align:right" class="' + rateClass(rateFcWalkCnt) + '">' + (rateFcWalkCnt === '-' ? '-' : rateFcWalkCnt) + '</td><td style="text-align:right" class="' + rateClass(rateFcWalkSucc) + '">' + (rateFcWalkSucc === '-' ? '-' : rateFcWalkSucc) + '</td><td style="text-align:right" class="' + rateClass(ratePtWalkCnt) + '">' + (ratePtWalkCnt === '-' ? '-' : ratePtWalkCnt) + '</td><td style="text-align:right" class="' + rateClass(ratePtWalkSucc) + '">' + (ratePtWalkSucc === '-' ? '-' : ratePtWalkSucc) + '</td>';
    html += '<td style="text-align:right" class="' + rateClass(rateFcReregT) + '">' + (rateFcReregT === '-' ? '-' : rateFcReregT) + '</td><td style="text-align:right" class="' + rateClass(rateFcReregS) + '">' + (rateFcReregS === '-' ? '-' : rateFcReregS) + '</td><td style="text-align:right" class="' + rateClass(ratePtReregT) + '">' + (ratePtReregT === '-' ? '-' : ratePtReregT) + '</td><td style="text-align:right" class="' + rateClass(ratePtReregS) + '">' + (ratePtReregS === '-' ? '-' : ratePtReregS) + '</td></tr>';

    html += '</tbody></table></div></div>';

    html += '<div class="goal-achievement-bottom">';
    var maxFcTarget = 0, maxPtTarget = 0;
    gaRows.forEach(function (r) {
      if (r.fcTarget > maxFcTarget) maxFcTarget = r.fcTarget;
      if (r.ptTarget > maxPtTarget) maxPtTarget = r.ptTarget;
    });
    if (maxFcTarget === 0) maxFcTarget = 1;
    if (maxPtTarget === 0) maxPtTarget = 1;
    var maxInflow = 0, maxCall = 0, maxOrders = 0, maxReviews = 0;
    var maxCh = {};
    chNames.forEach(function (c) { maxCh[c] = 0; });
    weekStartStrs.forEach(function (w) {
      var d = placeByWeek[w] || {};
      if ((d.inflow || 0) > maxInflow) maxInflow = d.inflow || 0;
      if ((d.smart_call || 0) > maxCall) maxCall = d.smart_call || 0;
      if ((d.orders || 0) > maxOrders) maxOrders = d.orders || 0;
      if ((d.reviews || 0) > maxReviews) maxReviews = d.reviews || 0;
      var ch = chByWeek[w] || {};
      chNames.forEach(function (c) { if ((ch[c] || 0) > maxCh[c]) maxCh[c] = ch[c] || 0; });
    });
    if (maxInflow === 0) maxInflow = 1;
    if (maxCall === 0) maxCall = 1;
    if (maxOrders === 0) maxOrders = 1;
    if (maxReviews === 0) maxReviews = 1;
    var maxSub = chNames.reduce(function (s, c) { return s + (maxCh[c] || 0); }, 0) || 1;

    html += '<div class="card profit-card"><h4 style="margin-bottom:8px">주차별 FC/PT 매출 · 스마트 플레이스 문의수</h4>';
    html += '<div class="profit-table-wrap goal-achievement-place-table-wrap"><table class="profit-table"><thead><tr>';
    html += '<th style="text-align:left">주차</th><th style="text-align:right">FC 목표</th><th style="text-align:right">FC 실적</th><th style="text-align:right">FC 달성률</th><th style="text-align:right">PT 목표</th><th style="text-align:right">PT 실적</th><th style="text-align:right">PT 달성률</th>';
    html += '<th style="text-align:right">방문</th><th style="text-align:right">통화</th><th style="text-align:right">예약신청</th><th style="text-align:right">리뷰</th><th style="text-align:right">신청 전환률</th><th style="text-align:right">리뷰 전환율</th>';
    chNames.forEach(function (c) { html += '<th style="text-align:right">' + esc(c) + '</th>'; });
    html += '<th style="text-align:right">소계</th></tr></thead><tbody>';
    gaRows.forEach(function (r) {
      var w = r.weekStartStr;
      var d = placeByWeek[w] || { inflow: 0, orders: 0, smart_call: 0, reviews: 0 };
      var ch = chByWeek[w] || {};
      var cvr = d.inflow > 0 ? (d.orders / d.inflow * 100) : 0;
      var rCvr = d.orders > 0 ? (d.reviews / d.orders * 100) : 0;
      var subTotal = 0;
      chNames.forEach(function (c) { subTotal += ch[c] || 0; });
      html += '<tr><td style="text-align:left">' + esc(r.period) + '</td>';
      html += '<td style="text-align:right">' + fmtNum(r.fcTarget) + '</td>';
      html += gaBarCell(r.fcActual, maxFcTarget, '59,130,246');
      html += '<td style="text-align:right" class="' + rateClass(r.fcRate) + '">' + (r.fcRate === '-' ? '-' : r.fcRate + '%') + '</td>';
      html += '<td style="text-align:right">' + fmtNum(r.ptTarget) + '</td>';
      html += gaBarCell(r.ptActual, maxPtTarget, '234,88,12');
      html += '<td style="text-align:right" class="' + rateClass(r.ptRate) + '">' + (r.ptRate === '-' ? '-' : r.ptRate + '%') + '</td>';
      html += gaBarCell(d.inflow, maxInflow, '34,197,94');
      html += gaBarCell(d.smart_call, maxCall, '234,88,12');
      html += gaBarCell(d.orders, maxOrders, '59,130,246');
      html += gaBarCell(d.reviews, maxReviews, '139,92,246');
      html += gaBarCell(cvr, 100, '59,130,246', cvr > 0 ? cvr.toFixed(1) + '%' : '-');
      html += gaBarCell(rCvr, 100, '139,92,246', rCvr > 0 ? rCvr.toFixed(1) + '%' : '-');
      chNames.forEach(function (c) { html += gaBarCell(ch[c] || 0, maxCh[c] || 1, '148,163,184'); });
      html += gaBarCell(subTotal, maxSub, '100,116,139') + '</tr>';
    });
    var placeTotInflow = 0, placeTotCall = 0, placeTotOrders = 0, placeTotReviews = 0;
    var placeTotCh = {};
    chNames.forEach(function (c) { placeTotCh[c] = 0; });
    weekStartStrs.forEach(function (w) {
      var d = placeByWeek[w] || {};
      var ch = chByWeek[w] || {};
      placeTotInflow += d.inflow || 0;
      placeTotCall += d.smart_call || 0;
      placeTotOrders += d.orders || 0;
      placeTotReviews += d.reviews || 0;
      chNames.forEach(function (c) { placeTotCh[c] += ch[c] || 0; });
    });
    var placeTotSub = chNames.reduce(function (s, c) { return s + placeTotCh[c]; }, 0);
    var totCvrVal = placeTotInflow > 0 ? (placeTotOrders / placeTotInflow * 100) : 0;
    var totRCvrVal = placeTotOrders > 0 ? (placeTotReviews / placeTotOrders * 100) : 0;
    var totCvrStr = placeTotInflow > 0 ? totCvrVal.toFixed(1) + '%' : '-';
    var totRCvrStr = placeTotOrders > 0 ? totRCvrVal.toFixed(1) + '%' : '-';
    html += '<tr class="place-row-total"><td style="text-align:left">합계</td>';
    html += '<td style="text-align:right">' + fmtNum(monthlyFcTarget) + '</td>';
    html += gaBarCell(monthlyFcActual, monthlyFcTarget || 1, '59,130,246');
    html += '<td style="text-align:right" class="' + rateClass(monthlyFcRate) + '">' + (monthlyFcRate === '-' ? '-' : monthlyFcRate + '%') + '</td>';
    html += '<td style="text-align:right">' + fmtNum(monthlyPtTarget) + '</td>';
    html += gaBarCell(monthlyPtActual, monthlyPtTarget || 1, '234,88,12');
    html += '<td style="text-align:right" class="' + rateClass(monthlyPtRate) + '">' + (monthlyPtRate === '-' ? '-' : monthlyPtRate + '%') + '</td>';
    html += gaBarCell(placeTotInflow, maxInflow, '34,197,94');
    html += gaBarCell(placeTotCall, maxCall, '234,88,12');
    html += gaBarCell(placeTotOrders, maxOrders, '59,130,246');
    html += gaBarCell(placeTotReviews, maxReviews, '139,92,246');
    html += gaBarCell(totCvrVal, 100, '59,130,246', totCvrStr);
    html += gaBarCell(totRCvrVal, 100, '139,92,246', totRCvrStr);
    chNames.forEach(function (c) { html += gaBarCell(placeTotCh[c], maxCh[c] || 1, '148,163,184'); });
    html += gaBarCell(placeTotSub, maxSub || 1, '100,116,139') + '</tr>';
    html += '</tbody></table></div></div>';
    html += '</div>';

    container.innerHTML = html;

    (function () {
      var convDesktop = document.getElementById('goal-achievement-conversion-desktop');
      var convMobile = document.getElementById('goal-achievement-conversion-mobile');
      var convWrap = container.querySelector('.goal-achievement-conversion-table-wrap');
      var convTable = container.querySelector('.goal-achievement-conversion-table');
      var firstCol = convTable && convTable.querySelector('th:first-child');
      var firstColTds = convTable ? convTable.querySelectorAll('tbody td:first-child') : [];
      function narrow() {
        if (typeof window === 'undefined') return false;
        return (window.innerWidth || 0) <= 1100;
      }
      function setConversionLayout() {
        var isNarrow = narrow();
        if (convMobile) convMobile.style.display = isNarrow ? 'block' : 'none';
        if (convDesktop) convDesktop.style.display = isNarrow ? 'none' : 'block';
        if (convWrap && convTable && !isNarrow) {
          if (firstCol) { firstCol.style.width = ''; firstCol.style.minWidth = ''; firstCol.style.maxWidth = ''; }
          firstColTds.forEach(function (td) { td.style.width = ''; td.style.minWidth = ''; td.style.maxWidth = ''; });
        } else if (convWrap && convTable && isNarrow) {
          var firstW = (window.innerWidth || 0) <= 768 ? 64 : 72;
          if (firstCol) firstCol.style.width = firstCol.style.minWidth = firstCol.style.maxWidth = firstW + 'px';
          firstColTds.forEach(function (td) { td.style.width = td.style.minWidth = td.style.maxWidth = firstW + 'px'; });
        }
      }
      setConversionLayout();
      requestAnimationFrame(setConversionLayout);
      setTimeout(setConversionLayout, 200);
      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('resize', setConversionLayout);
      }
    })();

    var monthSelect = document.getElementById('goal-achievement-month-select');
    if (monthSelect && !monthSelect.dataset.gaBound) {
      monthSelect.dataset.gaBound = '1';
      monthSelect.addEventListener('change', function () {
        _goalAchievementSelectedMonth = this.value || toYYYYMM(new Date());
        renderCurrentTab();
      });
    }

    var gaAiBlock = container.querySelector('.goal-achievement-ai-insight-block');
    var gaAiBtn = container.querySelector('.goal-achievement-ai-insight-btn');
    if (gaAiBlock && gaAiBtn) {
      gaAiBtn.addEventListener('click', function () {
        var gaSummary = {
          month: selectedMonth,
          label: selectedLabel,
          branchCount: branchIds.length,
          monthlySalesAchievement: {
            fc: monthlyFcRate === '-' ? null : Number(monthlyFcRate),
            pt: monthlyPtRate === '-' ? null : Number(monthlyPtRate),
            fcTarget: monthlyFcTarget,
            fcActual: monthlyFcActual,
            ptTarget: monthlyPtTarget,
            ptActual: monthlyPtActual
          },
          conversionRates: {
            ot: otCurRate != null ? Math.round(otCurRate * 10) / 10 : null,
            fcWalkin: fcWalkCur != null ? Math.round(fcWalkCur * 10) / 10 : null,
            ptWalkin: ptWalkCur != null ? Math.round(ptWalkCur * 10) / 10 : null,
            fcRereg: fcReregCur != null ? Math.round(fcReregCur * 10) / 10 : null,
            ptRereg: ptReregCur != null ? Math.round(ptReregCur * 10) / 10 : null
          },
          branchInsights: branchIds.map(function (bid) {
            var s = perBranchSums[bid] || {};
            return {
              branchId: bid,
              branchName: branchNameById[bid] || '-',
              otRate: s.total_ot_count > 0 ? Math.round(successRate(s.ot_conversion, s.total_ot_count) * 10) / 10 : null,
              fcWalkinRate: s.fc_walkin_count > 0 ? Math.round(successRate(s.fc_walkin_success, s.fc_walkin_count) * 10) / 10 : null,
              ptWalkinRate: s.pt_walkin_count > 0 ? Math.round(successRate(s.pt_walkin_success, s.pt_walkin_count) * 10) / 10 : null,
              fcReregRate: s.fc_rereg_target > 0 ? Math.round(successRate(s.fc_rereg_success, s.fc_rereg_target) * 10) / 10 : null,
              ptReregRate: s.pt_rereg_target > 0 ? Math.round(successRate(s.pt_rereg_success, s.pt_rereg_target) * 10) / 10 : null
            };
          })
        };
        invokeAInsight({ promptContext: '목표 달성율 탭 요약', summary: gaSummary }, gaAiBlock, gaAiBtn);
      });
    }

    if (canEditTarget && branchIds.length === 1) {
      var targetInputs = container.querySelectorAll('.goal-achievement-target-input');
      var branchId = branchIds[0];
      var yearMonth = selectedMonth;
      var updateRateRow = updateGoalAchievementRateRow;
      function saveGoalTargets() {
        var card = container.querySelector('.goal-achievement-unified-card');
        var scrollVal = card ? (parseInt(card.getAttribute('data-scroll-banner-target'), 10) || 0) : 0;
        var payload = {
          flyer_target: 0,
          scroll_banner_target: scrollVal,
          banner_target: 0,
          tm_target: 0,
          total_ot_count_target: 0,
          ot_conversion_target: 0,
          fc_walkin_count_target: 0,
          fc_walkin_success_target: 0,
          pt_walkin_count_target: 0,
          pt_walkin_success_target: 0,
          fc_rereg_target_target: 0,
          fc_rereg_success_target: 0,
          pt_rereg_target_target: 0,
          pt_rereg_success_target: 0,
          ot_success_rate_target: null,
          fc_walkin_success_rate_target: null,
          pt_walkin_success_rate_target: null,
          fc_rereg_success_rate_target: null,
          pt_rereg_success_rate_target: null
        };
        var numTargetFields = ['flyer_target', 'banner_target', 'tm_target', 'total_ot_count_target', 'ot_conversion_target', 'fc_walkin_count_target', 'fc_walkin_success_target', 'pt_walkin_count_target', 'pt_walkin_success_target', 'fc_rereg_target_target', 'fc_rereg_success_target', 'pt_rereg_target_target', 'pt_rereg_success_target'];
        var inps = container.querySelectorAll('.goal-achievement-target-input');
        for (var ii = 0; ii < inps.length; ii++) {
          var el = inps[ii];
          var f = el.getAttribute('data-field');
          var v = (el.value || '').trim();
          // 모바일/데스크톱 이중 렌더 시 숨김 입력은 저장 payload에서 제외
          if (el.offsetParent === null) continue;
          if (f && numTargetFields.indexOf(f) !== -1) {
            var num = parseFloat(String(v).replace(',', '.')) || 0;
            if (isNaN(num) || num < 0) num = 0;
            payload[f] = Math.round(num * 2) / 2;
          } else if (f) {
            var rateVal = v === '' ? null : parseFloat(String(v).replace(/%/g, '').replace(',', '.')) || null;
            payload[f] = rateVal;
          }
        }
        FX.upsertBranchMonthlyActivityTarget(branchId, yearMonth, payload).then(function () {
          var svc = getFormulaQueryService();
          if (svc) {
            svc.invalidateByBranch([branchId]);
            svc.invalidateByMetric(['monthly_activity_targets', 'daily_activities']);
          }
          updateRateRow(container);
          var rateInps = container.querySelectorAll('.goal-achievement-rate-target-input');
          for (var ri = 0; ri < rateInps.length; ri++) {
            var inp = rateInps[ri];
            var v = (inp.value || '').trim().replace(/%/g, '').replace(',', '.');
            var n = parseFloat(v);
            if (!isNaN(n)) inp.value = n + '%';
            else if ((v || '').trim() === '') inp.value = '';
          }
        }).catch(function (err) {
          alert('목표 저장에 실패했습니다. ' + (err && err.message ? err.message : String(err)));
        });
      }
      for (var jj = 0; jj < targetInputs.length; jj++) {
        targetInputs[jj].addEventListener('blur', saveGoalTargets);
        targetInputs[jj].addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); saveGoalTargets(); }
        });
      }
    }
    } catch (syncErr) {
      var errMsg = syncErr && (syncErr.message || syncErr.toString());
      container.innerHTML = '<p class="text-danger">화면을 그리는 중 오류가 발생했습니다. ' + esc(errMsg || String(syncErr)) + '</p>';
      flushTabPerfContext(perfCtx);
      return;
    }
    flushTabPerfContext(perfCtx);
  }

  function validateSalesMatrixHeaders(rows) {
    if (!rows || !rows.length) {
      return { ok: false, missing: ['결제일', '상품명', '결제금액'] };
    }
    var header = (rows[0] || []).map(function (c) { return (c != null ? String(c).trim() : ''); });
    var hasDate = hasAnyHeader(header, ['결제일시', '결제일', 'payment_date', '날짜', '일자']);
    var hasProduct = hasAnyHeader(header, ['판매상품', '상품명', 'product_name', '품목']);
    var hasAmount = hasAnyHeader(header, ['결제금액', '금액', 'amount', '매출']);
    var missing = [];
    if (!hasDate) missing.push('결제일(결제일시/결제일/payment_date)');
    if (!hasProduct) missing.push('상품명(판매상품/상품명/product_name)');
    if (!hasAmount) missing.push('결제금액(결제금액/금액/amount/매출)');
    return { ok: missing.length === 0, missing: missing };
  }

  function parseCsvToMatrix(text) {
    var rows = [];
    var row = [];
    var cell = '';
    var i = 0;
    var inQuotes = false;
    var s = String(text || '');

    while (i < s.length) {
      var ch = s[i];
      if (ch === '"') {
        if (inQuotes && s[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = !inQuotes;
        i++;
        continue;
      }
      if (ch === ',' && !inQuotes) {
        row.push(cell);
        cell = '';
        i++;
        continue;
      }
      if ((ch === '\n' || ch === '\r') && !inQuotes) {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        i++;
        continue;
      }
      cell += ch;
      i++;
    }

    row.push(cell);
    if (row.length > 1 || (row.length === 1 && String(row[0]).trim() !== '')) rows.push(row);
    return rows;
  }

  function parseSalesXlsx(arrayBuffer, fileSource) {
    if (typeof XLSX === 'undefined') return { rows: [], error: (fileSource || '알수없는 파일') + ': XLSX 라이브러리를 찾지 못했습니다.' };
    var wb = XLSX.read(arrayBuffer, { type: 'array' });
    var firstSheet = wb.SheetNames[0];
    if (!firstSheet) return { rows: [], error: (fileSource || '알수없는 파일') + ': 시트를 찾을 수 없습니다.' };
    var rows = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet], { header: 1, defval: '' });
    var v = validateSalesMatrixHeaders(rows);
    if (!v.ok) {
      return { rows: [], error: (fileSource || '알수없는 파일') + ': ' + v.missing.join(', ') + ' 누락' };
    }
    return { rows: parseSalesRowsFromMatrix(rows, fileSource) };
  }

  function parseSalesCsv(text, fileSource) {
    if (typeof XLSX !== 'undefined') {
      try {
        var wb = XLSX.read(text, { type: 'string' });
        var firstSheet = wb.SheetNames[0];
        if (firstSheet) {
          var matrix = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet], { header: 1, defval: '' });
          var v1 = validateSalesMatrixHeaders(matrix);
          if (!v1.ok) {
            return { rows: [], error: (fileSource || '알수없는 파일') + ': ' + v1.missing.join(', ') + ' 누락' };
          }
          return { rows: parseSalesRowsFromMatrix(matrix, fileSource) };
        }
      } catch (e) {
        // fallback below
      }
    }
    // XLSX 미사용 환경 fallback: 따옴표/콤마/줄바꿈 대응 CSV 파서
    var matrix2 = parseCsvToMatrix(text);
    var v2 = validateSalesMatrixHeaders(matrix2);
    if (!v2.ok) {
      return { rows: [], error: (fileSource || '알수없는 파일') + ': ' + v2.missing.join(', ') + ' 누락' };
    }
    return { rows: parseSalesRowsFromMatrix(matrix2, fileSource) };
  }

  // ── 지점 추가 ──
  function showAddBranchDialog() {
    var name = prompt('추가할 지점 이름을 입력하세요:');
    if (!name || !name.trim()) return;
    var url = prompt('네이버 플레이스 URL (선택):') || '';

    FX.createBranch(name.trim(), url.trim()).then(function (branch) {
      _branches.push(branch);
      populateBranchSelector();
      alert(name.trim() + ' 지점이 추가되었습니다.');
    }).catch(function (err) {
      alert('지점 추가 실패: ' + err.message);
    });
  }

  // ── Helpers ──
  function getSelectedBranchIds() {
    var sel = document.getElementById('sel-branch-global');
    if (sel && sel.value && sel.value !== '__all__') {
      _currentBranch = sel.value;
      if (String(sel.value).indexOf('__grp__:') === 0) {
        var grp = _branchGroups[sel.value];
        return uniqueBranchIds(grp ? grp.ids : []);
      }
      return uniqueBranchIds([sel.value]);
    }
    _currentBranch = '__all__';
    return uniqueBranchIds(_branches.map(function (b) { return b.id; }));
  }

  function uniqueBranchIds(ids) {
    return Array.from(new Set((ids || []).filter(function (id) {
      return !!id && id !== '__all__';
    })));
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function fmtNum(n) {
    return Number(n).toLocaleString('ko-KR');
  }

  /** 입력란에서 콤마 제거 후 숫자로 파싱 (금액 입력용) */
  function parseNumberWithCommas(s) {
    if (s == null || s === '') return 0;
    var n = parseInt(String(s).replace(/,/g, ''), 10);
    return isNaN(n) ? 0 : n;
  }

  /** 입력란에서 콤마 제거 후 소수까지 파싱 (평수·비율 등) */
  function parseFloatWithCommas(s) {
    if (s == null || s === '') return 0;
    var n = parseFloat(String(s).replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
  }

  function invokeAInsight(payload, blockEl, btnEl) {
    if (!blockEl || !btnEl) return;
    var token = (typeof CONFIG !== 'undefined' && CONFIG.SUPABASE_ANON_KEY) ? CONFIG.SUPABASE_ANON_KEY : '';
    var url = (typeof CONFIG !== 'undefined' && CONFIG.SUPABASE_URL ? CONFIG.SUPABASE_URL : '') + '/functions/v1/profitability-insight';
    btnEl.disabled = true;
    blockEl.textContent = '생성 중...';
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify(payload) })
      .then(function (res) { return res.text().then(function (text) { return { status: res.status, text: text }; }); })
      .then(function (r) {
        var data = {};
        try { if (r.text) data = JSON.parse(r.text); } catch (_) {}
        if ((!r.status || r.status >= 400) && !data.error) data = { ok: false, error: 'Edge Function 오류', detail: 'HTTP ' + (r.status || '') };
        if (data.ok && data.insight) blockEl.textContent = data.insight;
        else if (data.error) {
          var detail = (data.detail || '') + '';
          if (detail.indexOf('일시적으로 사용할 수 없습니다') >= 0 || detail.indexOf('429') >= 0 || detail.indexOf('RESOURCE_EXHAUSTED') >= 0) blockEl.textContent = '요청이 많아 일시적으로 사용할 수 없습니다. 1~2분 후 다시 시도해 주세요.';
          else blockEl.textContent = data.detail ? (data.error + ': ' + data.detail) : data.error;
        } else blockEl.textContent = '인사이트를 생성하지 못했습니다.';
      })
      .catch(function (e) { blockEl.textContent = '오류: ' + (e && e.message ? e.message : String(e)); })
      .finally(function () { btnEl.disabled = false; });
  }

  function toYmdUTC(d) {
    var y = d.getUTCFullYear();
    var m = d.getUTCMonth() + 1;
    var day = d.getUTCDate();
    return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  function parseYmdToUTC(ymd) {
    var s = String(ymd || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    return new Date(s + 'T00:00:00Z');
  }

  function getOverviewDateRange() {
    var now = new Date();
    var today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    var preset = _overviewRangePreset || '30d';
    var from = new Date(today);
    var to = new Date(today);

    if (preset === '7d') {
      from.setUTCDate(today.getUTCDate() - 6);
    } else if (preset === '30d') {
      from.setUTCDate(today.getUTCDate() - 29);
    } else if (preset === 'this_month') {
      from.setUTCDate(1);
    } else if (preset === 'last_month') {
      from.setUTCMonth(today.getUTCMonth() - 1);
      from.setUTCDate(1);
      to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
    } else if (preset === '90d') {
      from.setUTCDate(today.getUTCDate() - 89);
    } else if (preset === 'all') {
      from = new Date('2000-01-01T00:00:00Z');
      to = new Date('2100-12-31T00:00:00Z');
    } else {
      var customFrom = parseYmdToUTC(_overviewFromDate);
      var customTo = parseYmdToUTC(_overviewToDate);
      if (!customFrom || !customTo) {
        var fallback = getRecentDateRange(30);
        from = parseYmdToUTC(fallback.fromStr);
        to = parseYmdToUTC(fallback.toStr);
      } else {
        from = customFrom;
        to = customTo;
      }
      if (from > to) {
        var tmp = from;
        from = to;
        to = tmp;
      }
    }

    return {
      fromStr: toYmdUTC(from),
      toStr: toYmdUTC(to),
      fromInput: toYmdUTC(from),
      toInput: toYmdUTC(to)
    };
  }

  function getRecentDateRange(days) {
    var n = Math.max(parseInt(days || 30, 10) || 30, 1);
    var now = new Date();
    var today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    var from = new Date(today);
    from.setUTCDate(today.getUTCDate() - (n - 1));
    return {
      fromStr: toYmdUTC(from),
      toStr: toYmdUTC(today)
    };
  }

  function weekStartFromKey(k) {
    var s = String(k || '').trim();
    var m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? (m[1] + '-' + m[2] + '-' + m[3]) : s;
  }

  function getOverviewBranchKey(branchIds) {
    return uniqueBranchIds(branchIds).slice().sort().join(',');
  }

  async function ensureOverviewBaseData(branchIds) {
    var key = getOverviewBranchKey(branchIds);
    if (_overviewCacheKey === key && _overviewCacheData) return _overviewCacheData;
    if (_overviewCachePromise && _overviewCachePromiseKey === key) return _overviewCachePromise;

    _overviewCachePromiseKey = key;
    _overviewCachePromise = (async function () {
      var placeWeeklyAll = [];
      var isOverviewGroupSelection = String(_currentBranch).indexOf('__grp__:') === 0 && branchIds.length > 1;
      var useGroupDedup = shouldDedupForCurrentGroup(branchIds);
      var baseBundle = await getFormulaQueryService().getOverviewBaseData(branchIds, { mergeSameName: useGroupDedup });
      placeWeeklyAll = (baseBundle && baseBundle.placeWeeklyAll) ? baseBundle.placeWeeklyAll : [];
      if (isOverviewGroupSelection) {
        placeWeeklyAll = dedupePlaceRowsByKey(placeWeeklyAll, 'week_key');
      }
      var allSalesRows = (baseBundle && baseBundle.salesRowsAll) ? baseBundle.salesRowsAll : [];
      if (useGroupDedup) {
        // dedup RPC 미적용 환경 fallback 보호
        allSalesRows = dedupeSalesRecordsByMergedBranch(allSalesRows || [], branchIds);
      }
      var salesAggAll = {
        weekly: aggregateSalesByPeriod(allSalesRows || [], salesWeekKey),
        monthly: aggregateSalesByPeriod(allSalesRows || [], salesMonthKey)
      };
      return {
        placeWeeklyAll: placeWeeklyAll,
        salesAggAll: {
          weekly: (salesAggAll && salesAggAll.weekly) ? salesAggAll.weekly : [],
          monthly: (salesAggAll && salesAggAll.monthly) ? salesAggAll.monthly : []
        }
      };
    })();

    try {
      var data = await _overviewCachePromise;
      _overviewCacheKey = key;
      _overviewCacheData = data;
      return data;
    } finally {
      _overviewCachePromise = null;
      _overviewCachePromiseKey = '';
    }
  }

  function filterWeeklyRowsByDateRange(rows, fromStr, toStr) {
    return (rows || []).filter(function (r) {
      var wk = weekStartFromKey(r.period || '');
      return wk >= fromStr && wk <= toStr;
    });
  }

  function filterMonthlyRowsByDateRange(rows, fromStr, toStr) {
    var fromMonth = String(fromStr || '').slice(0, 7);
    var toMonth = String(toStr || '').slice(0, 7);
    return (rows || []).filter(function (r) {
      var p = String(r.period || '').slice(0, 7);
      return p && p >= fromMonth && p <= toMonth;
    });
  }

  function bindOverviewRangeEvents(renderVersion) {
    var sel = document.getElementById('sel-overview-range');
    var rangeInput = document.getElementById('overview-date-range');
    if (!sel || !rangeInput) return;

    sel.addEventListener('change', function () {
      var prevPreset = _overviewRangePreset;
      _overviewRangePreset = sel.value || '30d';
      if (_overviewRangePreset === 'custom') {
        if (prevPreset !== 'custom' || !_overviewFromDate || !_overviewToDate) {
          var recent = getRecentDateRange(30);
          _overviewFromDate = recent.fromStr;
          _overviewToDate = recent.toStr;
        }
      }
      if (!isRenderActive(renderVersion) || _currentTab !== 'overview') return;
      renderCurrentTab();
    });

    if (typeof window !== 'undefined' && typeof window.flatpickr === 'function') {
      var defaults = getOverviewDateRange();
      var picker = window.flatpickr(rangeInput, {
        mode: 'range',
        dateFormat: 'Y-m-d',
        defaultDate: [defaults.fromInput, defaults.toInput],
        locale: (window.flatpickr.l10ns && window.flatpickr.l10ns.ko) ? window.flatpickr.l10ns.ko : 'default',
        clickOpens: _overviewRangePreset === 'custom',
        onClose: function (selectedDates) {
          if (selectedDates.length !== 2) return;
          _overviewRangePreset = 'custom';
          _overviewFromDate = toYmdUTC(selectedDates[0]);
          _overviewToDate = toYmdUTC(selectedDates[1]);
          if (!isRenderActive(renderVersion) || _currentTab !== 'overview') return;
          renderCurrentTab();
        }
      });
      picker.set('clickOpens', _overviewRangePreset === 'custom');
      return;
    }
  }

  function kpiCard(label, value, sub) {
    return '<div class="kpi-card">' +
      '<div class="kpi-label">' + esc(label) + '</div>' +
      '<div class="kpi-value">' + value + '</div>' +
      (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') +
      '</div>';
  }

  function emptyState(icon, title, desc) {
    return '<div class="empty-state"><div class="icon">' + icon + '</div>' +
      '<h3>' + esc(title) + '</h3><p>' + esc(desc) + '</p></div>';
  }

  var PLACE_COLORS = { '유입': '3,199,90', '예약/주문': '59,130,246', '스마트콜': '245,158,11', '리뷰': '168,85,247', '전환율': '236,72,153', '리뷰전환율': '20,184,166', '유입수': '3,199,90' };
  var PLACE_DEF_COLORS = ['3,199,90', '59,130,246', '245,158,11', '168,85,247', '236,72,153', '20,184,166', '99,102,241'];
  function getPlaceCC(name, idx) { return PLACE_COLORS[name] || PLACE_DEF_COLORS[idx % PLACE_DEF_COLORS.length]; }
  function calcMax(rows, cols) {
    var m = {};
    cols.forEach(function (c) {
      var vals = rows.map(function (r) { return parseFloat(String(r[c] || '0').replace(/[,%]/g, '')) || 0; });
      m[c] = Math.max.apply(null, vals) || 1;
    });
    return m;
  }
  function barCell(val, txt, max, rgb) {
    var p = Math.min(100, max > 0 ? Math.round((val / max) * 100) : 0);
    return '<td><div class="bar-cell"><div class="bar-fill" style="width:' + p + '%;background:rgba(' + rgb + ',0.25)"></div><span class="bar-value">' + esc(txt) + '</span></div></td>';
  }

  function isInited() {
    return _hasInited;
  }

  /** 현재 초기화된 프로필과 다른 사용자면 true (탭 전환 시 재초기화 필요) */
  function shouldReinitWith(profile) {
    if (!profile || !profile.id) return true;
    if (!_hasInited || !_profile) return true;
    if (_profile.id !== profile.id) return true;
    if (_profile.role !== profile.role || _profile.brand_id !== profile.brand_id || _profile.branch_id !== profile.branch_id) return true;
    return false;
  }

  /** 로그아웃 등 시 대시보드 상태 초기화 (다음 사용자가 올바른 지점 목록을 보도록) */
  function reset() {
    _hasInited = false;
    _profile = null;
    _branches = [];
    _currentBranch = '__all__';
    _overviewCacheKey = '';
    _overviewCacheData = null;
    _overviewCachePromise = null;
    _overviewCachePromiseKey = '';
    _branchGroups = {};
    _branchIdToGroupValue = {};
    if (_formulaQueryService && _formulaQueryService.invalidateAll) {
      _formulaQueryService.invalidateAll();
    }
    _formulaQueryService = null;
  }

  return {
    init: init,
    switchTab: switchTab,
    isInited: isInited,
    shouldReinitWith: shouldReinitWith,
    reset: reset,
  };
})();
