/**
 * Formula X Cloud - 확장 프로그램용 API 클라이언트 (fetch 기반)
 * 로그인, 프로필/지점 조회, 플레이스 데이터 업로드
 */
(function () {
  'use strict';

  var BASE = typeof FX_CLOUD !== 'undefined' ? FX_CLOUD.SUPABASE_URL : '';
  var ANON = typeof FX_CLOUD !== 'undefined' ? FX_CLOUD.SUPABASE_ANON_KEY : '';
  var STORAGE_KEY = 'fx_cloud_session';
  var BRANCH_KEY = 'fx_cloud_branch_id';

  function getStoredSession(cb) {
    chrome.storage.local.get([STORAGE_KEY, BRANCH_KEY], function (r) {
      cb(r[STORAGE_KEY] || null, r[BRANCH_KEY] || null);
    });
  }

  function setStoredSession(accessToken, branchId, cb) {
    var obj = { [STORAGE_KEY]: accessToken || null };
    if (branchId !== undefined) obj[BRANCH_KEY] = branchId || null;
    chrome.storage.local.set(obj, cb || function () {});
  }

  function clearStoredSession(cb) {
    chrome.storage.local.remove([STORAGE_KEY, BRANCH_KEY], cb || function () {});
  }

  function request(method, path, body, accessToken, preferUpsert, onConflict) {
    var url = BASE + path;
    if (preferUpsert && onConflict) url += (path.indexOf('?') >= 0 ? '&' : '?') + 'on_conflict=' + encodeURIComponent(onConflict);
    var prefer = 'return=representation';
    if (preferUpsert) prefer += ', resolution=merge-duplicates';
    var opts = {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON,
        'Prefer': prefer,
      },
    };
    if (accessToken) opts.headers['Authorization'] = 'Bearer ' + accessToken;
    if (body) opts.body = JSON.stringify(body);
    return fetch(url, opts).then(function (res) {
      if (!res.ok) return res.json().then(function (j) { throw new Error(j.message || j.error_description || res.statusText); });
      if (res.status === 204) return null;
      return res.json();
    });
  }

  function rpc(name, params, accessToken) {
    var url = BASE + '/rest/v1/rpc/' + name;
    var opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ANON },
    };
    if (accessToken) opts.headers['Authorization'] = 'Bearer ' + accessToken;
    opts.body = JSON.stringify(params);
    return fetch(url, opts).then(function (res) {
      if (!res.ok) return res.json().then(function (j) { throw new Error(j.message || j.details || res.statusText); });
      if (res.status === 204) return null;
      return res.json().catch(function () { return null; });
    });
  }

  window.FXCloud = {
    // 로그인
    signIn: function (email, password) {
      return request('POST', '/auth/v1/token?grant_type=password', { email: email, password: password }).then(function (data) {
        setStoredSession(data.access_token, null);
        return { user: data.user, access_token: data.access_token };
      });
    },

    signOut: function () {
      clearStoredSession();
    },

    getSession: function () {
      return new Promise(function (resolve) {
        getStoredSession(function (token) { resolve(token); });
      });
    },

    setBranchId: function (branchId, cb) {
      chrome.storage.local.set({ [BRANCH_KEY]: branchId }, cb || function () {});
    },

    getBranchId: function () {
      return new Promise(function (resolve) {
        chrome.storage.local.get([BRANCH_KEY], function (r) { resolve(r[BRANCH_KEY] || null); });
      });
    },

    // 프로필 + 지점 목록 (지점장은 branch_managers 배정 지점만)
    getProfileAndBranches: function (accessToken) {
      return request('GET', '/auth/v1/user', null, accessToken).then(function (user) {
        if (!user || !user.id) throw new Error('로그인 정보가 없습니다.');
        var userId = user.id;
        return request('GET', '/rest/v1/profiles?id=eq.' + userId + '&select=*,brands:brand_id(id,name,brand_keywords),branches:branch_id(id,name)', null, accessToken)
          .then(function (profiles) {
            var profile = profiles && profiles[0];
            if (!profile) throw new Error('프로필을 찾을 수 없습니다.');
            var brandId = profile.brand_id;
            if (!brandId) throw new Error('브랜드가 없습니다. 웹에서 먼저 브랜드를 생성하세요.');
            var role = String(profile.role || '').toLowerCase();
            if (role === 'branch') {
              return request('GET', '/rest/v1/branch_managers?user_id=eq.' + userId + '&select=branch_id,branches:branch_id(id,name)&order=created_at', null, accessToken)
                .then(function (rows) {
                  var branches = [];
                  var seen = {};
                  (rows || []).forEach(function (r) {
                    if (!r || !r.branch_id || !r.branches) return;
                    if (seen[r.branch_id]) return;
                    seen[r.branch_id] = true;
                    branches.push({ id: r.branches.id, name: r.branches.name });
                  });
                  if (!branches.length && profile.branch_id) {
                    branches.push({ id: profile.branch_id, name: (profile.branches && profile.branches.name) || '내 지점' });
                  }
                  return { profile: profile, branches: branches };
                });
            }
            return request('GET', '/rest/v1/branches?brand_id=eq.' + brandId + '&select=id,name&order=created_at', null, accessToken)
              .then(function (branches) {
                return { profile: profile, branches: branches || [] };
              });
          });
      });
    },

    // 플레이스 주간 데이터 업로드 (RPC 사용 → RLS 우회)
    upsertPlaceWeekly: function (branchId, rows, accessToken) {
      var records = rows.map(function (r) {
        var weekKey = r['주간'] || r.week_key || '';
        return {
          week_key: weekKey,
          inflow: parseInt(r['유입'] || r.inflow || 0),
          orders: parseInt(r['예약/주문'] || r.orders || 0),
          smart_call: parseInt(r['스마트콜'] || r.smart_call || 0),
          reviews: parseInt(r['리뷰'] || r.reviews || 0),
          conversion_rate: parseFloat(String(r['전환율'] || r.conversion_rate || 0).replace('%', '')) || 0,
          review_conv_rate: parseFloat(String(r['리뷰전환율'] || r.review_conv_rate || 0).replace('%', '')) || 0,
        };
      });
      if (records.length === 0) return Promise.resolve();
      return rpc('upsert_place_weekly_bulk', { p_branch_id: branchId, p_records: records }, accessToken);
    },

    // 플레이스 채널 업로드 (RPC 사용 → RLS 우회)
    upsertPlaceChannels: function (branchId, channelRows, accessToken) {
      var records = [];
      (channelRows || []).forEach(function (r) {
        var weekKey = r['주간'] || '';
        Object.keys(r).forEach(function (k) {
          if (k === '주간' || k === '유입수') return;
          records.push({ week_key: weekKey, channel_name: k, inflow_count: parseInt(r[k] || 0) });
        });
      });
      if (records.length === 0) return Promise.resolve();
      return rpc('upsert_place_channels_bulk', { p_branch_id: branchId, p_records: records }, accessToken);
    },

    // 플레이스 키워드 업로드 (RPC 사용 → RLS 우회, brandKeywords로 is_brand 판단)
    upsertPlaceKeywords: function (branchId, keywordRows, brandKeywords, accessToken) {
      var records = [];
      (keywordRows || []).forEach(function (r) {
        var weekKey = r['주간'] || '';
        Object.keys(r).forEach(function (k) {
          if (k === '주간') return;
          var lower = String(k).toLowerCase().replace(/\s+/g, '');
          var isBrand = false;
          (brandKeywords || []).forEach(function (bk) {
            if (lower.indexOf(String(bk).toLowerCase().replace(/\s+/g, '')) >= 0) isBrand = true;
          });
          records.push({
            week_key: weekKey,
            keyword_name: k,
            percentage: parseFloat(String(r[k]).replace('%', '')) || 0,
            is_brand: isBrand,
          });
        });
      });
      if (records.length === 0) return Promise.resolve();
      return rpc('upsert_place_keywords_bulk', { p_branch_id: branchId, p_records: records }, accessToken);
    },

    getStoredSession: getStoredSession,
    setStoredSession: setStoredSession,
    clearStoredSession: clearStoredSession,
  };
})();
