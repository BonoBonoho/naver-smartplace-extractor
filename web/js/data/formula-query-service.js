// ============================================================
// Formula X Cloud - Formula Query Service
// ============================================================

var FormulaQueryService = (function () {
  'use strict';

  var DEFAULT_TTL_BY_METRIC = {
    place_bundle: 60 * 1000,
    sales_aggregated: 45 * 1000,
    sales_by_branch: 45 * 1000,
    weekly_targets: 30 * 1000,
    daily_activities: 20 * 1000,
    monthly_activity_targets: 30 * 1000,
    overview_base: 45 * 1000,
  };

  function normalizeIds(ids) {
    var list = Array.isArray(ids) ? ids : [];
    var set = {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var id = String(list[i] || '').trim();
      if (!id || set[id]) continue;
      set[id] = true;
      out.push(id);
    }
    out.sort();
    return out;
  }

  function toDateOnly(value) {
    var s = String(value || '').trim();
    return s ? s.slice(0, 10) : '';
  }

  function toMonthOnly(value) {
    var s = String(value || '').trim();
    return s ? s.slice(0, 7) : '';
  }

  function buildKey(metric, payload) {
    var p = payload || {};
    var branchIds = normalizeIds(p.branchIds || []);
    return [
      'm=' + String(metric || ''),
      'b=' + branchIds.join(','),
      'f=' + toDateOnly(p.from),
      't=' + toDateOnly(p.to),
      'mo=' + toMonthOnly(p.month),
      'd=' + (p.mergeSameName ? '1' : '0'),
      'x=' + String(p.extra || '')
    ].join('|');
  }

  function create(api, options) {
    if (!api) throw new Error('FormulaQueryService: api가 필요합니다.');
    var opts = options || {};
    var ttlByMetric = Object.assign({}, DEFAULT_TTL_BY_METRIC, opts.ttlByMetric || {});
    var cache = new Map();
    var inFlight = new Map();
    var stats = {
      requests: 0,
      hits: 0,
      misses: 0,
    };

    function nowMs() {
      return Date.now();
    }

    function readCache(key) {
      var row = cache.get(key);
      if (!row) return null;
      if (row.expiresAt <= nowMs()) {
        cache.delete(key);
        return null;
      }
      return row.value;
    }

    function writeCache(key, value, ttlMs, meta) {
      var ttl = Math.max(parseInt(ttlMs, 10) || 0, 0);
      cache.set(key, {
        value: value,
        expiresAt: nowMs() + ttl,
        meta: meta || {}
      });
    }

    function withCache(metric, payload, fetcher, ttlOverride) {
      var key = buildKey(metric, payload);
      var cached;
      stats.requests += 1;
      cached = readCache(key);
      if (cached !== null) {
        stats.hits += 1;
        return Promise.resolve(cached);
      }
      if (inFlight.has(key)) return inFlight.get(key);
      stats.misses += 1;
      var ttlMs = ttlOverride != null ? ttlOverride : ttlByMetric[metric];
      var task = Promise.resolve()
        .then(fetcher)
        .then(function (data) {
          writeCache(key, data, ttlMs, {
            metric: metric,
            branchIds: normalizeIds(payload && payload.branchIds),
            month: toMonthOnly(payload && payload.month)
          });
          return data;
        })
        .finally(function () {
          inFlight.delete(key);
        });
      inFlight.set(key, task);
      return task;
    }

    function invalidateByPredicate(predicate) {
      var removed = 0;
      cache.forEach(function (entry, key) {
        if (predicate(entry, key)) {
          cache.delete(key);
          removed += 1;
        }
      });
      inFlight.forEach(function (_entry, key) {
        if (cache.has(key)) return;
        if (predicate({ meta: {} }, key)) inFlight.delete(key);
      });
      return removed;
    }

    function toPlaceBundleResponse(ids, weekly, channels, keywords) {
      var byBranch = {};
      ids.forEach(function (id) {
        byBranch[id] = { weekly: [], channels: [], keywords: [] };
      });
      (weekly || []).forEach(function (r) {
        var id = r && r.branch_id;
        if (id && byBranch[id]) byBranch[id].weekly.push(r);
      });
      (channels || []).forEach(function (r) {
        var id = r && r.branch_id;
        if (id && byBranch[id]) byBranch[id].channels.push(r);
      });
      (keywords || []).forEach(function (r) {
        var id = r && r.branch_id;
        if (id && byBranch[id]) byBranch[id].keywords.push(r);
      });
      return {
        weekly: weekly || [],
        channels: channels || [],
        keywords: keywords || [],
        byBranch: byBranch
      };
    }

    function getPlaceBundle(branchIds) {
      var ids = normalizeIds(branchIds);
      if (!ids.length) return Promise.resolve(toPlaceBundleResponse([], [], [], []));
      return withCache('place_bundle', { branchIds: ids }, async function () {
        var weekly = [];
        var channels = [];
        var keywords = [];
        if (typeof api.getPlaceWeeklyBatch === 'function') {
          weekly = await api.getPlaceWeeklyBatch(ids);
        } else {
          var weeklyRows = await Promise.all(ids.map(function (id) { return api.getPlaceWeekly(id); }));
          weekly = [].concat.apply([], weeklyRows);
        }
        if (typeof api.getPlaceChannelsBatch === 'function') {
          channels = await api.getPlaceChannelsBatch(ids);
        } else {
          var channelRows = await Promise.all(ids.map(function (id) { return api.getPlaceChannels(id); }));
          channels = [].concat.apply([], channelRows);
        }
        if (typeof api.getPlaceKeywordsBatch === 'function') {
          keywords = await api.getPlaceKeywordsBatch(ids);
        } else {
          var keywordRows = await Promise.all(ids.map(function (id) { return api.getPlaceKeywords(id); }));
          keywords = [].concat.apply([], keywordRows);
        }
        return toPlaceBundleResponse(ids, weekly, channels, keywords);
      });
    }

    function getSalesAggregated(branchIds, fromStr, toStr, optionsForAgg) {
      var ids = normalizeIds(branchIds);
      var options = optionsForAgg || {};
      var mergeSameName = !!options.mergeSameName;
      return withCache('sales_aggregated', {
        branchIds: ids,
        from: fromStr,
        to: toStr,
        mergeSameName: mergeSameName
      }, function () {
        return api.getSalesAggregated(ids, fromStr, toStr, options);
      });
    }

    function getSalesByBranchBatch(branchIds, fromStr, toStr, optionsForAgg) {
      var ids = normalizeIds(branchIds);
      var options = optionsForAgg || {};
      return withCache('sales_by_branch', {
        branchIds: ids,
        from: fromStr,
        to: toStr,
        mergeSameName: !!options.mergeSameName
      }, async function () {
        var byBranch = {};
        var rows = await Promise.all(ids.map(async function (id) {
          var agg = await getSalesAggregated([id], fromStr, toStr, options);
          return { id: id, agg: agg || { weekly: [], monthly: [] } };
        }));
        rows.forEach(function (r) {
          byBranch[r.id] = {
            weekly: (r.agg && Array.isArray(r.agg.weekly)) ? r.agg.weekly : [],
            monthly: (r.agg && Array.isArray(r.agg.monthly)) ? r.agg.monthly : []
          };
        });
        return { byBranch: byBranch };
      });
    }

    function listBranchWeeklyTargets(branchIds, fromDate, toDate) {
      var ids = normalizeIds(branchIds);
      if (!ids.length) return Promise.resolve([]);
      return withCache('weekly_targets', {
        branchIds: ids,
        from: fromDate,
        to: toDate
      }, function () {
        return api.listBranchWeeklyTargets(ids, fromDate, toDate);
      });
    }

    function listBranchDailyActivities(branchIds, fromDate, toDate) {
      var ids = normalizeIds(branchIds);
      if (!ids.length) return Promise.resolve([]);
      return withCache('daily_activities', {
        branchIds: ids,
        from: fromDate,
        to: toDate
      }, function () {
        return api.listBranchDailyActivities(ids, fromDate, toDate);
      });
    }

    function listBranchMonthlyActivityTargets(branchIds, month) {
      var ids = normalizeIds(branchIds);
      if (!ids.length) return Promise.resolve([]);
      return withCache('monthly_activity_targets', {
        branchIds: ids,
        month: month
      }, function () {
        return api.listBranchMonthlyActivityTargets(ids, month);
      });
    }

    function getOverviewBaseData(branchIds, optionsForBase) {
      var ids = normalizeIds(branchIds);
      var options = optionsForBase || {};
      var mergeSameName = !!options.mergeSameName;
      return withCache('overview_base', {
        branchIds: ids,
        from: '2000-01-01',
        to: '2100-12-31',
        mergeSameName: mergeSameName
      }, async function () {
        var [placeBundle, salesRows] = await Promise.all([
          getPlaceBundle(ids),
          api.getAllSalesRecords(ids, '2000-01-01', '2100-12-31', { mergeSameName: mergeSameName })
        ]);
        return {
          placeWeeklyAll: placeBundle.weekly || [],
          salesRowsAll: salesRows || []
        };
      });
    }

    function prefetchMonthBundle(params) {
      var p = params || {};
      var ids = normalizeIds(p.branchIds);
      if (!ids.length) return Promise.resolve(null);
      return Promise.all([
        getSalesAggregated(ids, p.monthFirstStr, p.monthLastStr, p.salesOptions || {}),
        getSalesByBranchBatch(ids, p.monthFirstStr, p.monthLastStr, p.salesOptions || {}),
        getPlaceBundle(ids),
        listBranchWeeklyTargets(ids, p.targetFromStr || p.monthFirstStr, p.targetToStr || p.monthLastStr),
        listBranchDailyActivities(ids, p.monthFirstStr, p.monthLastStr),
        listBranchMonthlyActivityTargets(ids, p.month || toMonthOnly(p.monthFirstStr))
      ]).then(function () {
        return true;
      });
    }

    function createStatsSnapshot() {
      return {
        requests: stats.requests,
        hits: stats.hits,
        misses: stats.misses
      };
    }

    function diffStatsSnapshot(before) {
      var b = before || { requests: 0, hits: 0, misses: 0 };
      var req = Math.max(0, stats.requests - (b.requests || 0));
      var hit = Math.max(0, stats.hits - (b.hits || 0));
      var miss = Math.max(0, stats.misses - (b.misses || 0));
      return {
        request_count: req,
        cache_hit_count: hit,
        cache_miss_count: miss,
        cache_hit_ratio: req > 0 ? (hit / req) : 0
      };
    }

    function invalidateAll() {
      cache.clear();
      inFlight.clear();
    }

    function invalidateByMetric(metrics) {
      var list = Array.isArray(metrics) ? metrics : [metrics];
      var set = {};
      list.forEach(function (m) {
        var key = String(m || '').trim();
        if (key) set[key] = true;
      });
      return invalidateByPredicate(function (entry) {
        return !!set[String((entry.meta && entry.meta.metric) || '')];
      });
    }

    function invalidateByBranch(branchIds) {
      var ids = normalizeIds(branchIds);
      if (!ids.length) return 0;
      var set = {};
      ids.forEach(function (id) { set[id] = true; });
      return invalidateByPredicate(function (entry) {
        var cachedIds = (entry.meta && entry.meta.branchIds) || [];
        for (var i = 0; i < cachedIds.length; i++) {
          if (set[cachedIds[i]]) return true;
        }
        return false;
      });
    }

    return {
      getPlaceBundle: getPlaceBundle,
      getSalesAggregated: getSalesAggregated,
      getSalesByBranchBatch: getSalesByBranchBatch,
      listBranchWeeklyTargets: listBranchWeeklyTargets,
      listBranchDailyActivities: listBranchDailyActivities,
      listBranchMonthlyActivityTargets: listBranchMonthlyActivityTargets,
      getOverviewBaseData: getOverviewBaseData,
      prefetchMonthBundle: prefetchMonthBundle,
      createStatsSnapshot: createStatsSnapshot,
      diffStatsSnapshot: diffStatsSnapshot,
      invalidateAll: invalidateAll,
      invalidateByMetric: invalidateByMetric,
      invalidateByBranch: invalidateByBranch
    };
  }

  return {
    create: create
  };
})();
