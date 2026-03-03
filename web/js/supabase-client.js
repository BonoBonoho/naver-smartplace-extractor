// ============================================================
// Formula X Cloud - Supabase Client Wrapper
// ============================================================
// supabase-js CDN 로드 후 사용
// ============================================================

var FX = (function () {
  'use strict';

  var _sb = null;
  var _profile = null;
  var _lastSalesFetchDebug = {
    source: 'none',
    rowCount: 0,
    pageCount: 0,
    branchCount: 0,
    fromStr: '',
    toStr: '',
    mergeSameName: false,
    error: '',
    at: '',
  };

  function setSalesFetchDebug(patch) {
    _lastSalesFetchDebug = Object.assign({}, _lastSalesFetchDebug, patch || {}, {
      at: new Date().toISOString()
    });
  }

  function getLastSalesFetchDebug() {
    return Object.assign({}, _lastSalesFetchDebug);
  }

  function init() {
    if (!window.supabase) throw new Error('supabase-js not loaded');
    _sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    return _sb;
  }

  function client() {
    if (!_sb) init();
    return _sb;
  }

  // ── Auth ──
  async function signUp(email, password, name, signupRole) {
    var allowedRoles = ['brand', 'brand_accounting', 'branch', 'trainer', 'member'];
    var role = allowedRoles.indexOf(signupRole) >= 0 ? signupRole : 'member';
    var { data, error } = await client().auth.signUp({
      email: email,
      password: password,
      options: { data: { name: name, signup_role: 'member', requested_role: role } }
    });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    _profile = null;
    var { data, error } = await client().auth.signInWithPassword({
      email: email,
      password: password,
    });
    if (error) throw error;
    return data;
  }

  async function signInWithGoogle() {
    _profile = null;
    var redirectTo = window.location.origin + '/';
    var { data, error } = await client().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectTo }
    });
    if (error) throw error;
    return data;
  }

  async function requestPasswordResetEmail(email) {
    var targetEmail = String(email || '').trim();
    if (!targetEmail) throw new Error('이메일이 없습니다.');
    var redirectTo = window.location.origin + '/';
    var { data, error } = await client().auth.resetPasswordForEmail(targetEmail, {
      redirectTo: redirectTo
    });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    _profile = null;
    var { error } = await client().auth.signOut();
    if (error) throw error;
  }

  /** OAuth(Google) 가입 직후, 가입 유형 적용 */
  async function setMySignupRole(role) {
    var allowed = ['brand', 'brand_accounting', 'branch', 'trainer', 'member'];
    if (!role || allowed.indexOf(role) < 0) return;
    var { error } = await client().rpc('set_my_signup_role', { p_role: role });
    if (error) throw error;
  }

  async function getSession() {
    var { data } = await client().auth.getSession();
    return data.session;
  }

  async function getUser() {
    var { data } = await client().auth.getUser();
    return data.user;
  }

  // ── Profile ──
  async function getProfile() {
    var user = await getUser();
    if (!user) {
      _profile = null;
      return null;
    }
    // 계정 전환 후 이전 사용자 프로필 캐시가 남지 않도록 user.id를 검증한다.
    if (_profile && _profile.id === user.id) return _profile;
    _profile = null;
    var { data, error } = await client()
      .from('profiles')
      .select('*, brands:brand_id(id, name, brand_keywords, subscription_status, decision_maker_id, accounting_manager_id, owner_id), branches:branch_id(id, name)')
      .eq('id', user.id)
      .single();
    if (error) throw error;
    _profile = data;
    if (data && data.role === 'brand' && !data.brands && data.id) {
      var { data: ownedBrand } = await client()
        .from('brands')
        .select('id, name, brand_keywords, subscription_status, decision_maker_id, accounting_manager_id, owner_id')
        .eq('owner_id', data.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (ownedBrand) {
        data.brands = ownedBrand;
        data.brand_id = ownedBrand.id;
      }
    }
    return data;
  }

  function clearProfileCache() {
    _profile = null;
  }

  // ── Brand ──
  async function createBrand(name, brandKeywords) {
    var user = await getUser();
    var freePlan = await getFreePlan();
    var { data, error } = await client()
      .from('brands')
      .insert({
        name: name,
        brand_keywords: brandKeywords || [],
        owner_id: user.id,
        plan_id: freePlan.id,
        subscription_status: 'free',
      })
      .select()
      .single();
    if (error) throw error;

    // 프로필에 brand_id 연결
    await client().from('profiles').update({ brand_id: data.id }).eq('id', user.id);
    clearProfileCache();

    // Free 구독 자동 생성
    await client().from('subscriptions').insert({
      brand_id: data.id,
      plan_id: freePlan.id,
      provider: 'free',
      status: 'active',
    });

    return data;
  }

  async function getFreePlan() {
    var { data } = await client()
      .from('plans')
      .select('*')
      .eq('slug', CONFIG.FREE_PLAN_SLUG)
      .single();
    return data;
  }

  async function getBrand() {
    var profile = await getProfile();
    if (!profile || !profile.brand_id) return null;
    return profile.brands;
  }

  /** 브랜드 역할에서 profile.brand_id가 없을 때: 소유한 브랜드(owner_id = 나)의 id 하나 반환 */
  async function getBrandIdByOwner() {
    var user = await getUser();
    if (!user) return null;
    var { data, error } = await client()
      .from('brands')
      .select('id')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return (data && data.id) || null;
  }

  function normalizeKeywordArray(keywordsInput) {
    var arr = Array.isArray(keywordsInput)
      ? keywordsInput
      : String(keywordsInput || '').split(/[,\n]/);
    var seen = {};
    var out = [];
    arr.forEach(function (k) {
      var v = String(k || '').trim();
      if (!v) return;
      var lk = v.toLowerCase();
      if (seen[lk]) return;
      seen[lk] = true;
      out.push(v);
    });
    return out;
  }

  async function getBrandMemberProfiles(brandId) {
    var { data, error } = await client().rpc('get_brand_member_profiles', { p_brand_id: brandId });
    if (error) throw error;
    return data || [];
  }

  async function updateBrandManagers(brandId, payload) {
    var body = {};
    if (payload.decision_maker_id !== undefined) body.decision_maker_id = payload.decision_maker_id || null;
    if (payload.accounting_manager_id !== undefined) body.accounting_manager_id = payload.accounting_manager_id || null;
    if (Object.keys(body).length === 0) return null;
    var { data, error } = await client()
      .from('brands')
      .update(body)
      .eq('id', brandId)
      .select('id, decision_maker_id, accounting_manager_id')
      .single();
    if (error) throw error;
    return data;
  }

  async function updateBrandKeywords(keywordsInput) {
    var profile = await getProfile();
    if (!profile || !profile.brand_id) throw new Error('브랜드 정보가 없습니다.');
    var keywords = normalizeKeywordArray(keywordsInput);
    var rpcRes = await client().rpc('force_update_brand_keywords', {
      p_brand_id: profile.brand_id,
      p_keywords: keywords
    });
    if (rpcRes.error) {
      var msg = String(rpcRes.error.message || rpcRes.error || '');
      var fnMissing = msg.indexOf('force_update_brand_keywords') >= 0 && msg.indexOf('does not exist') >= 0;
      if (!fnMissing) throw rpcRes.error;
      // RPC 미적용 환경 fallback
      var res = await client()
        .from('brands')
        .update({ brand_keywords: keywords })
        .eq('id', profile.brand_id)
        .select('id, brand_keywords')
        .maybeSingle();
      if (res.error) throw res.error;
      if (!res.data) throw new Error('키워드 저장 권한이 없거나 대상 브랜드를 찾을 수 없습니다.');
      clearProfileCache();
      return res.data;
    }
    var data = Array.isArray(rpcRes.data) ? rpcRes.data[0] : rpcRes.data;
    if (!data) throw new Error('키워드 저장 결과를 확인할 수 없습니다.');
    clearProfileCache();
    return data;
  }

  async function listBrands() {
    var { data, error } = await client()
      .from('brands')
      .select('*, profiles!brands_owner_id_fkey(name, email)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  // ── Branch ──
  async function createBranch(name, naverPlaceUrl) {
    var profile = await getProfile();
    var { data, error } = await client()
      .from('branches')
      .insert({
        brand_id: profile.brand_id,
        name: name,
        naver_place_url: naverPlaceUrl || '',
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function listBranches(brandId, includeInactive) {
    var query = client().from('branches').select('*').order('created_at');
    if (brandId) query = query.eq('brand_id', brandId);
    if (!includeInactive) query = query.eq('is_active', true);
    var { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  // branch 계정: 본인에게 매핑된 지점만 명시적으로 조회
  async function listMyManagedBranches() {
    var user = await getUser();
    if (!user) return [];
    var { data, error } = await client()
      .from('branch_managers')
      .select('branch_id, branches:branch_id(*)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    var seen = {};
    var out = [];
    (data || []).forEach(function (r) {
      if (!r || !r.branch_id || !r.branches) return;
      if (seen[r.branch_id]) return;
      seen[r.branch_id] = true;
      out.push(r.branches);
    });
    return out;
  }

  /** 슈퍼 관리자: 브랜드 생성 (소유자 지정) */
  async function adminCreateBrand(name, ownerId) {
    var freePlan = await getFreePlan();
    if (!freePlan) throw new Error('무료 플랜을 찾을 수 없습니다.');
    var { data: brand, error: errBrand } = await client()
      .from('brands')
      .insert({
        name: name,
        owner_id: ownerId,
        plan_id: freePlan.id,
        subscription_status: 'free',
        brand_keywords: [],
      })
      .select()
      .single();
    if (errBrand) throw errBrand;

    var { error: errProfile } = await client()
      .from('profiles')
      .update({ brand_id: brand.id }).eq('id', ownerId);
    if (errProfile) throw errProfile;

    var { error: errSub } = await client()
      .from('subscriptions')
      .insert({
        brand_id: brand.id,
        plan_id: freePlan.id,
        provider: 'free',
        status: 'active',
      });
    if (errSub) throw errSub;

    return brand;
  }

  async function adminUpdateBrandKeywords(brandId, keywordsInput) {
    var keywords = normalizeKeywordArray(keywordsInput);
    var rpcRes = await client().rpc('force_update_brand_keywords', {
      p_brand_id: brandId,
      p_keywords: keywords
    });
    if (rpcRes.error) {
      var msg = String(rpcRes.error.message || rpcRes.error || '');
      var fnMissing = msg.indexOf('force_update_brand_keywords') >= 0 && msg.indexOf('does not exist') >= 0;
      if (!fnMissing) throw rpcRes.error;
      // RPC 미적용 환경 fallback
      var res = await client()
        .from('brands')
        .update({ brand_keywords: keywords })
        .eq('id', brandId)
        .select('id, brand_keywords')
        .maybeSingle();
      if (res.error) throw res.error;
      if (!res.data) throw new Error('키워드 저장 권한이 없거나 대상 브랜드를 찾을 수 없습니다.');
      return res.data;
    }
    var data = Array.isArray(rpcRes.data) ? rpcRes.data[0] : rpcRes.data;
    if (!data) throw new Error('키워드 저장 결과를 확인할 수 없습니다.');
    return data;
  }

  /** 슈퍼 관리자: 지정 브랜드에 지점 추가 */
  async function adminCreateBranch(brandId, name, naverPlaceUrl) {
    var { data, error } = await client()
      .from('branches')
      .insert({
        brand_id: brandId,
        name: name,
        naver_place_url: naverPlaceUrl || '',
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  /** 슈퍼 관리자: 지점 단건 조회 */
  async function adminGetBranch(branchId) {
    var { data, error } = await client()
      .from('branches')
      .select('*')
      .eq('id', branchId)
      .single();
    if (error) throw error;
    return data;
  }

  /** 슈퍼 관리자: 지점 수정 */
  async function adminUpdateBranch(branchId, payload) {
    var body = { name: payload.name };
    if (payload.naver_place_url != null) body.naver_place_url = payload.naver_place_url;
    var { data, error } = await client()
      .from('branches')
      .update(body)
      .eq('id', branchId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  /** 플랫폼 관리자 전용: 동일 브랜드·동일 지점명인 지점들을 하나로 통합. 반환: { data: [...] } */
  async function mergeDuplicateBranchesSameBrand() {
    var { data, error } = await client().rpc('merge_duplicate_branches_same_brand');
    if (error) throw error;
    return data || [];
  }

  /** 플랫폼 관리자 전용: source 지점 플레이스 데이터를 target 지점으로 복사(동기화) */
  async function syncPlaceDataBetweenBranches(sourceBranchId, targetBranchId) {
    var { data, error } = await client().rpc('sync_place_data_between_branches', {
      p_source_branch_id: sourceBranchId,
      p_target_branch_id: targetBranchId,
    });
    if (error) throw error;
    return data || {};
  }

  /** 슈퍼 관리자: 지점 삭제 */
  async function adminDeleteBranch(branchId) {
    // 1) 지점에 매핑된 사용자 연결 해제 (FK/운영 안전)
    var { error: profileErr } = await client()
      .from('profiles')
      .update({ branch_id: null })
      .eq('branch_id', branchId);
    if (profileErr) throw profileErr;

    // 2) 지점 삭제
    var res = await client()
      .from('branches')
      .delete()
      .eq('id', branchId)
      .select('id');
    if (res.error) throw res.error;
    if (!res.data || !res.data.length) {
      throw new Error('삭제 대상 지점을 찾지 못했거나 권한이 없습니다.');
    }
  }

  /** 슈퍼 관리자: 지점 관리자 지정(사용자 1명) */
  async function adminAssignBranchManager(branchId, userId) {
    var branch = await adminGetBranch(branchId);
    var { data: currentProfile, error: currentErr } = await client()
      .from('profiles')
      .select('id, email, role, brand_id, branch_id')
      .eq('id', userId)
      .single();
    if (currentErr) throw currentErr;

    if (currentProfile && currentProfile.role === 'super') {
      throw new Error('슈퍼 관리자는 지점 관리자로 지정할 수 없습니다.');
    }

    var me = await getUser();
    var { error: bmErr } = await client()
      .from('branch_managers')
      .upsert({
        branch_id: branch.id,
        user_id: userId,
        assigned_by: me ? me.id : null,
      }, { onConflict: 'branch_id,user_id', ignoreDuplicates: true });
    if (bmErr) throw bmErr;

    var profilePatch = {
      role: 'branch',
    };
    // 이미 소속 브랜드가 있으면 유지하고, 비어 있는 경우에만 채운다.
    // (다중배정 시 다른 brand_id로 덮어써져 사용자가 다른 브랜드로 이동하는 현상 방지)
    if (!currentProfile || !currentProfile.brand_id) {
      profilePatch.brand_id = branch.brand_id;
    }
    if (!currentProfile || !currentProfile.branch_id) {
      profilePatch.branch_id = branch.id;
    }

    var { data, error } = await client()
      .from('profiles')
      .update(profilePatch)
      .eq('id', userId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function adminListBranchManagers() {
    var { data, error } = await client()
      .from('branch_managers')
      .select('branch_id, user_id, profiles:user_id(id, email, name, role, brand_id, branch_id), branches:branch_id(name)');
    if (error) throw error;
    return data || [];
  }

  /** 슈퍼 관리자: 사용자 지점 배정 해제 */
  async function adminUnassignBranchManager(userId, branchId) {
    if (!userId || !branchId) throw new Error('userId, branchId가 필요합니다.');
    var { error: delErr } = await client()
      .from('branch_managers')
      .delete()
      .eq('user_id', userId)
      .eq('branch_id', branchId);
    if (delErr) throw delErr;
    var { data: profile } = await client().from('profiles').select('branch_id').eq('id', userId).single();
    if (profile && profile.branch_id === branchId) {
      await client().from('profiles').update({ branch_id: null }).eq('id', userId);
    }
  }

  // ── Profitability Data ──
  function toNonNegativeInt(v) {
    var n = parseInt(v || 0, 10);
    if (isNaN(n) || n < 0) return 0;
    return n;
  }

  function toNonNegativeFloat(v) {
    var n = parseFloat(v || 0);
    if (isNaN(n) || n < 0) return 0;
    return n;
  }

  async function listBranchFinancials(branchIds) {
    var query = client()
      .from('branch_financials')
      .select('branch_id, contract_start_date, contract_end_date, area_pyeong, deposit, monthly_rent, monthly_maintenance_fee, extra_fixed_costs, branch_manager_fixed_salary, branch_manager_sales_percent, updated_by, updated_at, created_at, branches:branch_id(id, name, brand_id)')
      .order('contract_start_date', { ascending: false });
    if (Array.isArray(branchIds) && branchIds.length) {
      query = query.in('branch_id', branchIds);
    }
    var { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function upsertBranchFinancial(branchId, payload) {
    var user = await getUser();
    var contractStart = payload && payload.contract_start_date;
    if (!contractStart) contractStart = new Date().toISOString().slice(0, 10);
    var endDate = payload && payload.contract_end_date;
    if (endDate === '') endDate = null;
    var body = {
      branch_id: branchId,
      contract_start_date: contractStart,
      contract_end_date: endDate || null,
      area_pyeong: toNonNegativeFloat(payload && payload.area_pyeong),
      deposit: toNonNegativeInt(payload && payload.deposit),
      monthly_rent: toNonNegativeInt(payload && payload.monthly_rent),
      monthly_maintenance_fee: toNonNegativeInt(payload && payload.monthly_maintenance_fee),
      extra_fixed_costs: Array.isArray(payload && payload.extra_fixed_costs) ? payload.extra_fixed_costs : [],
      branch_manager_fixed_salary: (payload && (payload.branch_manager_fixed_salary !== undefined && payload.branch_manager_fixed_salary !== '')) ? toNonNegativeInt(Number(payload.branch_manager_fixed_salary)) : 2000000,
      branch_manager_sales_percent: (function () { var v = payload && payload.branch_manager_sales_percent; if (v === undefined || v === '') return 3; var n = parseFloat(v); if (isNaN(n) || n < 0) return 3; if (n > 100) return 100; return n; })(),
      updated_by: user ? user.id : null,
    };
    var { data, error } = await client()
      .from('branch_financials')
      .upsert(body, { onConflict: 'branch_id,contract_start_date' })
      .select('branch_id, contract_start_date, contract_end_date, area_pyeong, deposit, monthly_rent, monthly_maintenance_fee, extra_fixed_costs, branch_manager_fixed_salary, branch_manager_sales_percent, updated_at')
      .single();
    if (error) throw error;
    return data;
  }

  async function deleteBranchFinancial(branchId, contractStartDate) {
    if (!contractStartDate) return;
    var { error } = await client()
      .from('branch_financials')
      .delete()
      .eq('branch_id', branchId)
      .eq('contract_start_date', contractStartDate);
    if (error) throw error;
  }

  // ── Branch daily expenses (지출 일별) ──
  async function listBranchDailyExpenses(branchIds, fromDate, toDate) {
    var query = client()
      .from('branch_daily_expenses')
      .select('id, branch_id, expense_date, amount, expense_category, content, memo, payment_method, bank_name, account_number, account_holder, created_at, updated_at, branches:branch_id(id, name)')
      .order('expense_date', { ascending: false });
    if (Array.isArray(branchIds) && branchIds.length) {
      query = query.in('branch_id', branchIds);
    }
    if (fromDate) query = query.gte('expense_date', fromDate);
    if (toDate) query = query.lte('expense_date', toDate);
    var { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function insertBranchDailyExpense(payload) {
    var user = await getUser();
    var body = {
      branch_id: payload.branch_id,
      expense_date: payload.expense_date || new Date().toISOString().slice(0, 10),
      amount: toNonNegativeInt(payload.amount),
      expense_category: (payload.expense_category != null && String(payload.expense_category).trim() !== '') ? String(payload.expense_category).trim() : null,
      content: (payload.content != null && String(payload.content).trim() !== '') ? String(payload.content).trim() : null,
      memo: (payload.memo != null && payload.memo !== '') ? String(payload.memo).trim() : null,
      payment_method: (payload.payment_method === 'transfer' || payload.payment_method === 'card') ? payload.payment_method : null,
      bank_name: (payload.bank_name != null && String(payload.bank_name).trim() !== '') ? String(payload.bank_name).trim() : null,
      account_number: (payload.account_number != null && String(payload.account_number).trim() !== '') ? String(payload.account_number).trim() : null,
      account_holder: (payload.account_holder != null && String(payload.account_holder).trim() !== '') ? String(payload.account_holder).trim() : null,
      updated_by: user ? user.id : null,
    };
    var { data, error } = await client()
      .from('branch_daily_expenses')
      .insert(body)
      .select('id, branch_id, expense_date, amount, expense_category, content, memo, payment_method, bank_name, account_number, account_holder, created_at, updated_at')
      .single();
    if (error) throw error;
    return data;
  }

  async function updateBranchDailyExpense(id, payload) {
    var user = await getUser();
    var body = {
      updated_at: new Date().toISOString(),
      updated_by: user ? user.id : null,
    };
    if (payload.expense_date !== undefined) body.expense_date = payload.expense_date;
    if (payload.amount !== undefined) body.amount = toNonNegativeInt(payload.amount);
    if (payload.expense_category !== undefined) body.expense_category = (payload.expense_category != null && String(payload.expense_category).trim() !== '') ? String(payload.expense_category).trim() : null;
    if (payload.content !== undefined) body.content = (payload.content != null && String(payload.content).trim() !== '') ? String(payload.content).trim() : null;
    if (payload.memo !== undefined) body.memo = (payload.memo != null && payload.memo !== '') ? String(payload.memo).trim() : null;
    if (payload.payment_method !== undefined) body.payment_method = (payload.payment_method === 'transfer' || payload.payment_method === 'card') ? payload.payment_method : null;
    if (payload.bank_name !== undefined) body.bank_name = (payload.bank_name != null && String(payload.bank_name).trim() !== '') ? String(payload.bank_name).trim() : null;
    if (payload.account_number !== undefined) body.account_number = (payload.account_number != null && String(payload.account_number).trim() !== '') ? String(payload.account_number).trim() : null;
    if (payload.account_holder !== undefined) body.account_holder = (payload.account_holder != null && String(payload.account_holder).trim() !== '') ? String(payload.account_holder).trim() : null;
    var { data, error } = await client()
      .from('branch_daily_expenses')
      .update(body)
      .eq('id', id)
      .select('id, branch_id, expense_date, amount, expense_category, content, memo, payment_method, bank_name, account_number, account_holder, updated_at')
      .single();
    if (error) throw error;
    return data;
  }

  async function deleteBranchDailyExpense(id) {
    var { error } = await client()
      .from('branch_daily_expenses')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }

  // ── Branch daily activities (활동 실적 일별) ──
  async function listBranchDailyActivities(branchIds, fromDate, toDate) {
    var query = client()
      .from('branch_daily_activities')
      .select('branch_id, activity_date, flyer, scroll_banner, banner, tm, total_ot_count, ot_conversion, fc_walkin_count, fc_walkin_success, pt_walkin_count, pt_walkin_success, fc_rereg_target, fc_rereg_success, pt_rereg_target, pt_rereg_success, created_at, updated_at')
      .order('activity_date', { ascending: false });
    if (Array.isArray(branchIds) && branchIds.length) query = query.in('branch_id', branchIds);
    if (fromDate) query = query.gte('activity_date', fromDate);
    if (toDate) query = query.lte('activity_date', toDate);
    var { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  /** 0.5 단위 등 소수 허용, 0 이상으로 보정 */
  function toNonNegativeNumActivity(v) {
    var n = parseFloat(v);
    if (isNaN(n) || n < 0) return 0;
    return Math.round(n * 10) / 10;
  }

  async function upsertBranchDailyActivity(branchId, activityDate, payload) {
    var user = await getUser();
    var row = {
      branch_id: branchId,
      activity_date: activityDate,
      flyer: toNonNegativeNumActivity(payload && payload.flyer),
      scroll_banner: toNonNegativeNumActivity(payload && payload.scroll_banner),
      banner: toNonNegativeNumActivity(payload && payload.banner),
      tm: toNonNegativeNumActivity(payload && payload.tm),
      total_ot_count: toNonNegativeNumActivity(payload && payload.total_ot_count),
      ot_conversion: toNonNegativeNumActivity(payload && payload.ot_conversion),
      fc_walkin_count: toNonNegativeNumActivity(payload && payload.fc_walkin_count),
      fc_walkin_success: toNonNegativeNumActivity(payload && payload.fc_walkin_success),
      pt_walkin_count: toNonNegativeNumActivity(payload && payload.pt_walkin_count),
      pt_walkin_success: toNonNegativeNumActivity(payload && payload.pt_walkin_success),
      fc_rereg_target: toNonNegativeNumActivity(payload && payload.fc_rereg_target),
      fc_rereg_success: toNonNegativeNumActivity(payload && payload.fc_rereg_success),
      pt_rereg_target: toNonNegativeNumActivity(payload && payload.pt_rereg_target),
      pt_rereg_success: toNonNegativeNumActivity(payload && payload.pt_rereg_success),
      updated_at: new Date().toISOString(),
      updated_by: user ? user.id : null,
    };
    var { data, error } = await client()
      .from('branch_daily_activities')
      .upsert(row, { onConflict: 'branch_id,activity_date' })
      .select('branch_id, activity_date, flyer, scroll_banner, banner, tm, total_ot_count, ot_conversion, fc_walkin_count, fc_walkin_success, pt_walkin_count, pt_walkin_success, fc_rereg_target, fc_rereg_success, pt_rereg_target, pt_rereg_success, updated_at')
      .single();
    if (error) throw error;
    return data;
  }

  // ── Branch monthly activity targets (월별 활동·성공률 목표) ──
  async function listBranchMonthlyActivityTargets(branchIds, yearMonth) {
    branchIds = Array.isArray(branchIds) ? branchIds : [];
    if (!branchIds.length || !yearMonth) return [];
    var monthFirst = yearMonth + '-01';
    var query = client()
      .from('branch_monthly_activity_targets')
      .select('branch_id, month, flyer_target, scroll_banner_target, banner_target, tm_target, total_ot_count_target, ot_conversion_target, fc_walkin_count_target, fc_walkin_success_target, pt_walkin_count_target, pt_walkin_success_target, fc_rereg_target_target, fc_rereg_success_target, pt_rereg_target_target, pt_rereg_success_target, ot_success_rate_target, fc_walkin_success_rate_target, pt_walkin_success_rate_target, fc_rereg_success_rate_target, pt_rereg_success_rate_target, created_at, updated_at')
      .in('branch_id', branchIds)
      .eq('month', monthFirst);
    var { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  function toNonNegativeIntTarget(v) {
    var n = parseInt(v, 10);
    return (isNaN(n) || n < 0) ? 0 : n;
  }
  /** 0.5 단위 등 소수 허용, 0 이상으로 보정 (월별 활동 목표 수치용) */
  function toNonNegativeNumTarget(v) {
    var n = parseFloat(v);
    if (isNaN(n) || n < 0) return 0;
    return Math.round(n * 10) / 10;
  }
  function toRateTarget(v) {
    if (v == null || v === '') return null;
    var n = parseFloat(String(v).replace(/%/g, '').replace(',', '.'));
    if (isNaN(n)) return null;
    if (n < 0) return 0;
    if (n > 100) return 100;
    return n;
  }

  async function upsertBranchMonthlyActivityTarget(branchId, yearMonth, payload) {
    var monthFirst = yearMonth + '-01';
    var row = {
      branch_id: branchId,
      month: monthFirst,
      flyer_target: toNonNegativeNumTarget(payload && payload.flyer_target),
      scroll_banner_target: toNonNegativeNumTarget(payload && payload.scroll_banner_target),
      banner_target: toNonNegativeNumTarget(payload && payload.banner_target),
      tm_target: toNonNegativeNumTarget(payload && payload.tm_target),
      total_ot_count_target: toNonNegativeNumTarget(payload && payload.total_ot_count_target),
      ot_conversion_target: toNonNegativeNumTarget(payload && payload.ot_conversion_target),
      fc_walkin_count_target: toNonNegativeNumTarget(payload && payload.fc_walkin_count_target),
      fc_walkin_success_target: toNonNegativeNumTarget(payload && payload.fc_walkin_success_target),
      pt_walkin_count_target: toNonNegativeNumTarget(payload && payload.pt_walkin_count_target),
      pt_walkin_success_target: toNonNegativeNumTarget(payload && payload.pt_walkin_success_target),
      fc_rereg_target_target: toNonNegativeNumTarget(payload && payload.fc_rereg_target_target),
      fc_rereg_success_target: toNonNegativeNumTarget(payload && payload.fc_rereg_success_target),
      pt_rereg_target_target: toNonNegativeNumTarget(payload && payload.pt_rereg_target_target),
      pt_rereg_success_target: toNonNegativeNumTarget(payload && payload.pt_rereg_success_target),
      ot_success_rate_target: toRateTarget(payload && payload.ot_success_rate_target),
      fc_walkin_success_rate_target: toRateTarget(payload && payload.fc_walkin_success_rate_target),
      pt_walkin_success_rate_target: toRateTarget(payload && payload.pt_walkin_success_rate_target),
      fc_rereg_success_rate_target: toRateTarget(payload && payload.fc_rereg_success_rate_target),
      pt_rereg_success_rate_target: toRateTarget(payload && payload.pt_rereg_success_rate_target),
      updated_at: new Date().toISOString(),
    };
    var { data, error } = await client()
      .from('branch_monthly_activity_targets')
      .upsert(row, { onConflict: 'branch_id,month' })
      .select('branch_id, month, flyer_target, scroll_banner_target, banner_target, tm_target, total_ot_count_target, ot_conversion_target, fc_walkin_count_target, fc_walkin_success_target, pt_walkin_count_target, pt_walkin_success_target, fc_rereg_target_target, fc_rereg_success_target, pt_rereg_target_target, pt_rereg_success_target, ot_success_rate_target, fc_walkin_success_rate_target, pt_walkin_success_rate_target, fc_rereg_success_rate_target, pt_rereg_success_rate_target, updated_at')
      .single();
    if (error) throw error;
    return data;
  }

  /** 지출 항목 자주 쓴 순 (추천용). branchIds 없으면 전체. */
  async function getExpenseCategoryCounts(branchIds, limit) {
    var { data, error } = await client().rpc('get_expense_category_counts', {
      p_branch_ids: Array.isArray(branchIds) && branchIds.length ? branchIds : null,
      p_limit: limit != null ? Math.min(100, Math.max(1, parseInt(limit, 10) || 20)) : 20
    });
    if (error) throw error;
    return data || [];
  }

  // ── Expense requests (지출 결의) ──
  /** 지출 결의 목록: branchIds 있으면 해당 지점만, 없으면 RLS 범위 전체. status 필터 선택. */
  async function listExpenseRequests(branchIds, options) {
    var opts = options || {};
    var query = client()
      .from('expense_requests')
      .select('id, branch_id, requested_by, amount, memo, payment_type, status, requested_at, approved_at, approved_by, rejected_at, rejected_by, rejection_reason, transferred_at, transferred_by, card_paid_at, attachment_urls, bank_name, account_number, account_holder, confirmed_by, confirmed_at, created_at, updated_at, branches:branch_id(id, name)')
      .order('requested_at', { ascending: false });
    if (Array.isArray(branchIds) && branchIds.length) query = query.in('branch_id', branchIds);
    if (opts.status) query = query.eq('status', opts.status);
    if (opts.from_date) query = query.gte('requested_at', opts.from_date);
    if (opts.to_date) query = query.lte('requested_at', opts.to_date);
    var { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function insertExpenseRequest(payload) {
    var user = await getUser();
    var isFcDraft = !!(payload && payload.isFcDraft);
    var body = {
      branch_id: payload.branch_id,
      requested_by: user.id,
      amount: toNonNegativeInt(payload.amount),
      memo: (payload.memo != null && payload.memo !== '') ? String(payload.memo).trim() : null,
      payment_type: (payload.payment_type === 'card') ? 'card' : 'transfer',
      status: isFcDraft ? 'fc_draft' : 'pending_approval',
    };
    if (payload.bank_name != null && String(payload.bank_name).trim() !== '') body.bank_name = String(payload.bank_name).trim();
    if (payload.account_number != null && String(payload.account_number).trim() !== '') body.account_number = String(payload.account_number).trim();
    if (payload.account_holder != null && String(payload.account_holder).trim() !== '') body.account_holder = String(payload.account_holder).trim();
    var { data, error } = await client()
      .from('expense_requests')
      .insert(body)
      .select('id, branch_id, requested_by, amount, memo, payment_type, status, requested_at, attachment_urls, created_at')
      .single();
    if (error) throw error;
    return data;
  }

  /** 지출 결의 첨부 이미지 업로드. requestId 경로에 업로드 후 공개 URL 배열 반환. */
  async function uploadExpenseRequestAttachments(requestId, files) {
    if (!requestId || !files || !files.length) return [];
    var bucket = 'expense-request-attachments';
    var urls = [];
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (!file || !file.name || !file.type || !file.type.startsWith('image/')) continue;
      var ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      var safeName = Date.now() + '_' + i + '.' + ext;
      var path = requestId + '/' + safeName;
      var { error } = await client().storage.from(bucket).upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      var { data } = client().storage.from(bucket).getPublicUrl(path);
      if (data && data.publicUrl) urls.push(data.publicUrl);
    }
    return urls;
  }

  /** Bemove 식단 사진 업로드. logId 경로에 업로드 후 공개 URL 배열 반환. */
  async function uploadBemoveDietPhotos(logId, files) {
    if (!logId || !files || !files.length) return [];
    var bucket = 'bemove-diet-photos';
    var urls = [];
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (!file || !file.name || !file.type || !file.type.startsWith('image/')) continue;
      var ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      var safeName = Date.now() + '_' + i + '.' + ext;
      var path = String(logId) + '/' + safeName;
      var up = await client().storage.from(bucket).upload(path, file, { upsert: true, contentType: file.type });
      if (up.error) throw up.error;
      var pub = client().storage.from(bucket).getPublicUrl(path);
      if (pub && pub.data && pub.data.publicUrl) urls.push(pub.data.publicUrl);
    }
    return urls;
  }

  /** 지출 결의 attachment_urls 업데이트 (신청자만 가능). */
  async function updateExpenseRequestAttachmentUrls(requestId, attachmentUrls) {
    var body = { attachment_urls: Array.isArray(attachmentUrls) ? attachmentUrls : [] };
    var { data, error } = await client()
      .from('expense_requests')
      .update(body)
      .eq('id', requestId)
      .select('id, attachment_urls')
      .single();
    if (error) throw error;
    return data;
  }

  async function approveExpenseRequest(id) {
    var user = await getUser();
    var { data, error } = await client()
      .from('expense_requests')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: user.id,
        rejected_at: null,
        rejected_by: null,
        rejection_reason: null,
      })
      .eq('id', id)
      .eq('status', 'pending_approval')
      .select('id, status, approved_at, approved_by')
      .single();
    if (error) throw error;
    return data;
  }

  async function rejectExpenseRequest(id, reason) {
    var user = await getUser();
    var { data, error } = await client()
      .from('expense_requests')
      .update({
        status: 'rejected',
        rejected_at: new Date().toISOString(),
        rejected_by: user.id,
        rejection_reason: (reason != null && String(reason).trim() !== '') ? String(reason).trim() : null,
      })
      .eq('id', id)
      .eq('status', 'pending_approval')
      .select('id, status, rejected_at, rejected_by')
      .single();
    if (error) throw error;
    return data;
  }

  async function markExpenseRequestTransferDone(id) {
    var user = await getUser();
    var { data, error } = await client()
      .from('expense_requests')
      .update({
        status: 'transfer_done',
        transferred_at: new Date().toISOString(),
        transferred_by: user.id,
      })
      .eq('id', id)
      .eq('status', 'approved')
      .eq('payment_type', 'transfer')
      .select('id, status, transferred_at, transferred_by')
      .single();
    if (error) throw error;
    return data;
  }

  async function markExpenseRequestCardPaid(id) {
    var { data, error } = await client()
      .from('expense_requests')
      .update({
        status: 'card_paid',
        card_paid_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'approved')
      .eq('payment_type', 'card')
      .select('id, status, card_paid_at')
      .single();
    if (error) throw error;
    return data;
  }

  /** 지점장이 FC 작성 결의를 확인 후 관리자에 올리기 (fc_draft → pending_approval) */
  async function confirmExpenseRequest(id) {
    var user = await getUser();
    var { data, error } = await client()
      .from('expense_requests')
      .update({
        status: 'pending_approval',
        confirmed_by: user.id,
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'fc_draft')
      .select('id, status, confirmed_by, confirmed_at')
      .single();
    if (error) throw error;
    return data;
  }

  /** 지출 결의 취소(철회) - 신청자 또는 해당 지점 지점장, fc_draft/pending_approval만 */
  async function cancelExpenseRequest(id) {
    var { data, error } = await client()
      .from('expense_requests')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .in('status', ['fc_draft', 'pending_approval'])
      .select('id, status')
      .single();
    if (error) throw error;
    return data;
  }

  /** 지출 결의 내용 수정 - 신청자 또는 해당 지점 지점장, fc_draft/pending_approval만 */
  async function updateExpenseRequest(id, payload) {
    var body = {};
    if (payload.amount != null) body.amount = toNonNegativeInt(payload.amount);
    if (payload.memo !== undefined) body.memo = (payload.memo != null && String(payload.memo).trim() !== '') ? String(payload.memo).trim() : null;
    if (payload.payment_type === 'card' || payload.payment_type === 'transfer') body.payment_type = payload.payment_type;
    if (payload.bank_name !== undefined) body.bank_name = (payload.bank_name != null && String(payload.bank_name).trim() !== '') ? String(payload.bank_name).trim() : null;
    if (payload.account_number !== undefined) body.account_number = (payload.account_number != null && String(payload.account_number).trim() !== '') ? String(payload.account_number).trim() : null;
    if (payload.account_holder !== undefined) body.account_holder = (payload.account_holder != null && String(payload.account_holder).trim() !== '') ? String(payload.account_holder).trim() : null;
    if (Object.keys(body).length === 0) return null;
    var { data, error } = await client()
      .from('expense_requests')
      .update(body)
      .eq('id', id)
      .in('status', ['fc_draft', 'pending_approval'])
      .select('id, amount, memo, payment_type, bank_name, account_number, account_holder, updated_at')
      .single();
    if (error) throw error;
    return data;
  }

  /** 지출 결의 삭제 (슈퍼/브랜드 관리자만 RLS로 허용) */
  async function deleteExpenseRequest(id) {
    var { error } = await client()
      .from('expense_requests')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }

  // ── Refund requests (고객 환불 요청, 지출/수익률 무관) ──
  async function listRefundRequests(branchIds, options) {
    var opts = options || {};
    var query = client()
      .from('refund_requests')
      .select('id, branch_id, requested_by, customer_name, bank_name, account_number, account_holder, amount, reason, status, requested_at, approved_at, approved_by, rejected_at, rejected_by, rejection_reason, completed_at, completed_by, created_at, updated_at, branches:branch_id(id, name)')
      .order('requested_at', { ascending: false });
    if (Array.isArray(branchIds) && branchIds.length) query = query.in('branch_id', branchIds);
    if (opts.status) query = query.eq('status', opts.status);
    var { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function insertRefundRequest(payload) {
    var user = await getUser();
    var customerName = (payload.customer_name != null && String(payload.customer_name).trim() !== '') ? String(payload.customer_name).trim() : null;
    if (!customerName) throw new Error('고객 성함을 입력해 주세요.');
    var body = {
      branch_id: payload.branch_id,
      requested_by: user.id,
      customer_name: customerName,
      amount: toNonNegativeInt(payload.amount),
      status: 'pending_approval',
    };
    if (payload.bank_name != null && String(payload.bank_name).trim() !== '') body.bank_name = String(payload.bank_name).trim();
    if (payload.account_number != null && String(payload.account_number).trim() !== '') body.account_number = String(payload.account_number).trim();
    if (payload.account_holder != null && String(payload.account_holder).trim() !== '') body.account_holder = String(payload.account_holder).trim();
    if (payload.reason != null && String(payload.reason).trim() !== '') body.reason = String(payload.reason).trim();
    var { data, error } = await client()
      .from('refund_requests')
      .insert(body)
      .select('id, branch_id, requested_by, customer_name, bank_name, account_number, account_holder, amount, reason, status, requested_at, created_at')
      .single();
    if (error) throw error;
    return data;
  }

  async function approveRefundRequest(id) {
    var user = await getUser();
    var { data, error } = await client()
      .from('refund_requests')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: user.id,
        rejected_at: null,
        rejected_by: null,
        rejection_reason: null,
      })
      .eq('id', id)
      .eq('status', 'pending_approval')
      .select('id, status, approved_at, approved_by')
      .single();
    if (error) throw error;
    return data;
  }

  async function rejectRefundRequest(id, reason) {
    var user = await getUser();
    var { data, error } = await client()
      .from('refund_requests')
      .update({
        status: 'rejected',
        rejected_at: new Date().toISOString(),
        rejected_by: user.id,
        rejection_reason: (reason != null && String(reason).trim() !== '') ? String(reason).trim() : null,
      })
      .eq('id', id)
      .eq('status', 'pending_approval')
      .select('id, status, rejected_at, rejected_by')
      .single();
    if (error) throw error;
    return data;
  }

  async function markRefundRequestCompleted(id) {
    var user = await getUser();
    var { data, error } = await client()
      .from('refund_requests')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        completed_by: user.id,
      })
      .eq('id', id)
      .eq('status', 'approved')
      .select('id, status, completed_at, completed_by')
      .single();
    if (error) throw error;
    return data;
  }

  // ── Branch weekly sales targets (목표 매출) ──
  async function listBranchWeeklyTargets(branchIds, fromDate, toDate) {
    branchIds = Array.isArray(branchIds) ? branchIds : [];
    if (!branchIds.length) return [];
    var query = client()
      .from('branch_weekly_sales_targets')
      .select('branch_id, week_start, fc_target, pt_target, created_at, updated_at')
      .in('branch_id', branchIds)
      .gte('week_start', fromDate)
      .lte('week_start', toDate)
      .order('week_start', { ascending: true });
    var { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function upsertBranchWeeklyTarget(branchId, weekStart, fcTarget, ptTarget) {
    var fc = toNonNegativeInt(fcTarget);
    var pt = toNonNegativeInt(ptTarget);
    var row = {
      branch_id: branchId,
      week_start: weekStart,
      fc_target: fc,
      pt_target: pt,
      updated_at: new Date().toISOString(),
    };
    var { data, error } = await client()
      .from('branch_weekly_sales_targets')
      .upsert(row, {
        onConflict: 'branch_id,week_start',
        ignoreDuplicates: false,
      })
      .select('branch_id, week_start, fc_target, pt_target, updated_at')
      .single();
    if (error) throw error;
    return data;
  }

  /** 수익률 요약을 Edge Function으로 보내 Gemini AI 인사이트 텍스트를 받습니다. body: { summary: { ... } } */
  async function getProfitabilityAInsight(body) {
    var session = await getSession();
    var anon = (typeof CONFIG !== 'undefined' && CONFIG.SUPABASE_ANON_KEY) || '';
    var token = anon;
    var url = (typeof CONFIG !== 'undefined' && CONFIG.SUPABASE_URL ? CONFIG.SUPABASE_URL : '') + '/functions/v1/profitability-insight';
    var res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
        'apikey': anon
      },
      body: JSON.stringify(body || {})
    });
    var text = '';
    try { text = await res.text(); } catch (_) {}
    var data = {};
    try {
      if (text) data = JSON.parse(text);
    } catch (_) {}
    if (!res.ok && !(data && data.error)) {
      return { ok: false, error: 'Edge Function 오류', detail: 'HTTP ' + res.status };
    }
    return data;
  }

  /** Bemove 인바디 데이터를 Edge Function으로 보내 AI 인사이트를 받습니다. */
  async function bemoveGetInbodyAiInsight(body) {
    var res = await getProfitabilityAInsight({
      promptContext: 'bemove_inbody_insight_v1',
      summary: body || {}
    });
    return res;
  }

  /** Bemove 운동 처방 리포트를 Edge Function으로 요청합니다. */
  async function bemoveGetExercisePrescription(body) {
    var res = await getProfitabilityAInsight({
      promptContext: 'bemove_exercise_prescription_v1',
      summary: body || {}
    });
    return res;
  }

  /** Bemove 숙제 전송 메시지를 Edge Function으로 생성합니다. (실제 AI 인사이트 4~8문단) */
  async function bemoveGetHomeworkMessage(body) {
    var res = await getProfitabilityAInsight({
      promptContext: 'bemove_homework_message_v1',
      summary: body || {}
    });
    return res;
  }

  async function bemoveAnalyzeDietFromPhotos(body) {
    var res = await getProfitabilityAInsight({
      promptContext: 'bemove_diet_photo_v1',
      summary: body || {}
    });
    return res;
  }

  async function bemoveAnalyzeDietInbodyFeedback(body) {
    var res = await getProfitabilityAInsight({
      promptContext: 'bemove_diet_inbody_feedback_v1',
      summary: body || {}
    });
    return res;
  }

  // ── Invite Branch Manager ──
  async function inviteBranchManager(email, name, branchId) {
    var profile = await getProfile();
    // 1. Supabase Auth에 사용자 생성 (invite)
    // 실제로는 Edge Function으로 처리 (admin API 필요)
    // 여기서는 프로필만 준비
    var { data, error } = await client().functions.invoke('invite-user', {
      body: { email: email, name: name, branchId: branchId, brandId: profile.brand_id }
    });
    if (error) throw error;
    return data;
  }

  // ── Place Data ──
  function normalizePlaceWeekKey(v) {
    var s = String(v || '').trim();
    if (!s) return s;
    var m = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
    if (!m) return s;
    return m[1] + '-' + String(parseInt(m[2], 10)).padStart(2, '0') + '-' + String(parseInt(m[3], 10)).padStart(2, '0');
  }

  function ensureRowsNotEmpty(rows, label) {
    if (!Array.isArray(rows) || !rows.length) {
      throw new Error(label + ' 업로드 차단: 데이터가 비어 있습니다.');
    }
  }

  /** 업로드 후 중복 지점 자동 통합 (플레이스·매출 포함). 슈퍼만 성공, 그 외는 무시. */
  function runAutoMergeAfterUpload() {
    client().rpc('merge_duplicate_branches_same_brand').then(function () {}).catch(function () {});
  }

  async function upsertPlaceWeekly(branchId, rows) {
    ensureRowsNotEmpty(rows, '플레이스 주별');
    var records = rows.map(function (r) {
      var wk = normalizePlaceWeekKey(r.week_key || r['주간']);
      if (!wk) throw new Error('플레이스 업로드 차단: "주간(시작일)" 컬럼이 비어 있습니다.');
      return {
        branch_id: branchId,
        week_key: wk,
        inflow: parseInt(r.inflow || r['유입'] || 0),
        orders: parseInt(r.orders || r['예약/주문'] || 0),
        smart_call: parseInt(r.smart_call || r['스마트콜'] || 0),
        reviews: parseInt(r.reviews || r['리뷰'] || 0),
        conversion_rate: parseFloat(r.conversion_rate || r['전환율'] || 0),
        review_conv_rate: parseFloat(r.review_conv_rate || r['리뷰전환율'] || 0),
      };
    });
    var { data, error } = await client()
      .from('place_weekly')
      .upsert(records, { onConflict: 'branch_id,week_key' })
      .select();
    if (error) throw error;
    try {
      await logUploadAudit(branchId, 'place_weekly_upload', records.length, [], {
        week_keys: records.length,
      });
    } catch (auditErr) {
      console.warn('upload audit failed:', auditErr);
    }
    runAutoMergeAfterUpload();
    return data;
  }

  async function getPlaceWeekly(branchId) {
    var { data, error } = await client()
      .from('place_weekly')
      .select('*')
      .eq('branch_id', branchId)
      .order('week_key');
    if (error) throw error;
    return data || [];
  }

  async function getPlaceChannels(branchId) {
    var { data, error } = await client()
      .from('place_channels')
      .select('*')
      .eq('branch_id', branchId)
      .order('week_key');
    if (error) throw error;
    return data || [];
  }

  async function getPlaceKeywords(branchId) {
    var { data, error } = await client()
      .from('place_keywords')
      .select('*')
      .eq('branch_id', branchId)
      .order('week_key');
    if (error) throw error;
    return data || [];
  }

  async function getPlaceWeeklyBatch(branchIds) {
    branchIds = Array.isArray(branchIds) ? branchIds : [];
    if (!branchIds.length) return [];
    var { data, error } = await client()
      .from('place_weekly')
      .select('*')
      .in('branch_id', branchIds)
      .order('branch_id', { ascending: true })
      .order('week_key', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function getPlaceChannelsBatch(branchIds) {
    branchIds = Array.isArray(branchIds) ? branchIds : [];
    if (!branchIds.length) return [];
    var { data, error } = await client()
      .from('place_channels')
      .select('*')
      .in('branch_id', branchIds)
      .order('branch_id', { ascending: true })
      .order('week_key', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function getPlaceKeywordsBatch(branchIds) {
    branchIds = Array.isArray(branchIds) ? branchIds : [];
    if (!branchIds.length) return [];
    var { data, error } = await client()
      .from('place_keywords')
      .select('*')
      .in('branch_id', branchIds)
      .order('branch_id', { ascending: true })
      .order('week_key', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function upsertPlaceChannels(branchId, rows) {
    ensureRowsNotEmpty(rows, '플레이스 채널');
    var records = [];
    rows.forEach(function (r) {
      var weekKey = normalizePlaceWeekKey(r['주간']);
      if (!weekKey) throw new Error('플레이스 채널 업로드 차단: "주간(시작일)" 컬럼이 비어 있습니다.');
      Object.keys(r).forEach(function (k) {
        if (k === '주간' || k === '유입수') return;
        records.push({
          branch_id: branchId,
          week_key: weekKey,
          channel_name: k,
          inflow_count: parseInt(r[k] || 0),
        });
      });
    });
    if (!records.length) {
      throw new Error('플레이스 채널 업로드 차단: 채널 컬럼이 없습니다. "주간" 외 채널명이 필요합니다.');
    }
    var { data, error } = await client()
      .from('place_channels')
      .upsert(records, { onConflict: 'branch_id,week_key,channel_name' })
      .select();
    if (error) throw error;
    try {
      await logUploadAudit(branchId, 'place_channels_upload', records.length, [], {
        rows_input: (rows || []).length,
      });
    } catch (auditErr) {
      console.warn('upload audit failed:', auditErr);
    }
    runAutoMergeAfterUpload();
    return data;
  }

  async function upsertPlaceKeywords(branchId, rows, brandKeywords) {
    ensureRowsNotEmpty(rows, '플레이스 키워드');
    var records = [];
    rows.forEach(function (r) {
      var weekKey = normalizePlaceWeekKey(r['주간']);
      if (!weekKey) throw new Error('플레이스 키워드 업로드 차단: "주간(시작일)" 컬럼이 비어 있습니다.');
      Object.keys(r).forEach(function (k) {
        if (k === '주간') return;
        var isBrand = false;
        var lower = k.toLowerCase().replace(/\s+/g, '');
        (brandKeywords || []).forEach(function (bk) {
          if (lower.indexOf(bk.toLowerCase().replace(/\s+/g, '')) >= 0) isBrand = true;
        });
        records.push({
          branch_id: branchId,
          week_key: weekKey,
          keyword_name: k,
          percentage: parseFloat(String(r[k]).replace('%', '')) || 0,
          is_brand: isBrand,
        });
      });
    });
    if (!records.length) {
      throw new Error('플레이스 키워드 업로드 차단: 키워드 컬럼이 없습니다. "주간" 외 키워드명이 필요합니다.');
    }
    var { data, error } = await client()
      .from('place_keywords')
      .upsert(records, { onConflict: 'branch_id,week_key,keyword_name' })
      .select();
    if (error) throw error;
    try {
      await logUploadAudit(branchId, 'place_keywords_upload', records.length, [], {
        rows_input: (rows || []).length,
      });
    } catch (auditErr) {
      console.warn('upload audit failed:', auditErr);
    }
    runAutoMergeAfterUpload();
    return data;
  }

  // 플레이스 전체 동기화: 지점 데이터를 주어진 목록으로 통째로 교체 (RPC)
  async function replacePlaceWeeklyForBranch(branchId, records) {
    var payload = Array.isArray(records) ? records : [];
    var { error } = await client().rpc('replace_place_weekly_for_branch', { p_branch_id: branchId, p_records: payload });
    if (error) throw error;
  }

  async function replacePlaceChannelsForBranch(branchId, records) {
    var payload = Array.isArray(records) ? records : [];
    var { error } = await client().rpc('replace_place_channels_for_branch', { p_branch_id: branchId, p_records: payload });
    if (error) throw error;
  }

  async function replacePlaceKeywordsForBranch(branchId, records) {
    var payload = Array.isArray(records) ? records : [];
    var { error } = await client().rpc('replace_place_keywords_for_branch', { p_branch_id: branchId, p_records: payload });
    if (error) throw error;
  }

  /** 선택한 지점의 플레이스 데이터(주별/채널/키워드) 전부 삭제(초기화). 슈퍼/브랜드/지점 권한은 RPC에서 검사. */
  async function clearPlaceDataForBranch(branchId) {
    if (!branchId) throw new Error('지점을 선택해 주세요.');
    await replacePlaceWeeklyForBranch(branchId, []);
    await replacePlaceChannelsForBranch(branchId, []);
    await replacePlaceKeywordsForBranch(branchId, []);
  }

  /**
   * 최신 자료(파일) + 과거 자료(클라우드) 대조 후 해당 지점 플레이스 데이터 전체 업데이트.
   * @param {string} branchId - 지점 UUID
   * @param {Object} fileData - { weeklyRows: [{주간,유입,예약/주문,...}], channelRows: [{주간,유입수,채널명...}], keywordRows: [{주간,키워드명...}], brandKeywords?: string[] }
   *   엑셀 내보내기와 동일한 시트 형식이면 됨.
   */
  async function syncPlaceDataFull(branchId, fileData) {
    var weeklyRows = fileData.weeklyRows || [];
    var channelRows = fileData.channelRows || [];
    var keywordRows = fileData.keywordRows || [];
    var brandKeywords = fileData.brandKeywords || [];

    var currentWeekly = await getPlaceWeekly(branchId);
    var currentCh = await getPlaceChannels(branchId);
    var currentKw = await getPlaceKeywords(branchId);

    var weekKeyMap = {};
    currentWeekly.forEach(function (r) {
      weekKeyMap[r.week_key] = {
        week_key: r.week_key,
        inflow: r.inflow,
        orders: r.orders,
        smart_call: r.smart_call,
        reviews: r.reviews,
        conversion_rate: r.conversion_rate,
        review_conv_rate: r.review_conv_rate,
      };
    });
    weeklyRows.forEach(function (r) {
      var wk = normalizePlaceWeekKey(r.week_key || r['주간']);
      if (!wk) return;
      weekKeyMap[wk] = {
        week_key: wk,
        inflow: parseInt(r.inflow || r['유입'] || 0),
        orders: parseInt(r.orders || r['예약/주문'] || 0),
        smart_call: parseInt(r.smart_call || r['스마트콜'] || 0),
        reviews: parseInt(r.reviews || r['리뷰'] || 0),
        conversion_rate: parseFloat(String(r.conversion_rate || r['전환율'] || 0).replace('%', '')) || 0,
        review_conv_rate: parseFloat(String(r.review_conv_rate || r['리뷰전환율'] || 0).replace('%', '')) || 0,
      };
    });
    var mergedWeekly = Object.keys(weekKeyMap).sort().map(function (k) { return weekKeyMap[k]; });

    var chMap = {};
    currentCh.forEach(function (r) {
      var key = r.week_key + '\t' + r.channel_name;
      chMap[key] = { week_key: r.week_key, channel_name: r.channel_name, inflow_count: r.inflow_count };
    });
    channelRows.forEach(function (r) {
      var weekKey = normalizePlaceWeekKey(r['주간']);
      if (!weekKey) return;
      Object.keys(r).forEach(function (col) {
        if (col === '주간' || col === '유입수' || col === '지점') return;
        var cnt = parseInt(r[col] || 0, 10) || 0;
        var key = weekKey + '\t' + col;
        chMap[key] = { week_key: weekKey, channel_name: col, inflow_count: cnt };
      });
    });
    var mergedCh = Object.keys(chMap).sort().map(function (k) { return chMap[k]; });

    var kwMap = {};
    currentKw.forEach(function (r) {
      var key = r.week_key + '\t' + r.keyword_name;
      kwMap[key] = { week_key: r.week_key, keyword_name: r.keyword_name, percentage: r.percentage, is_brand: !!r.is_brand };
    });
    keywordRows.forEach(function (r) {
      var weekKey = normalizePlaceWeekKey(r['주간']);
      if (!weekKey) return;
      Object.keys(r).forEach(function (col) {
        if (col === '주간' || col === '지점') return;
        var pct = parseFloat(String(r[col] || 0).replace('%', '')) || 0;
        var isBrand = false;
        var lower = (col || '').toLowerCase().replace(/\s+/g, '');
        brandKeywords.forEach(function (bk) {
          if (lower.indexOf((bk || '').toLowerCase().replace(/\s+/g, '')) >= 0) isBrand = true;
        });
        var key = weekKey + '\t' + col;
        kwMap[key] = { week_key: weekKey, keyword_name: col, percentage: pct, is_brand: isBrand };
      });
    });
    var mergedKw = Object.keys(kwMap).sort().map(function (k) { return kwMap[k]; });

    await replacePlaceWeeklyForBranch(branchId, mergedWeekly);
    await replacePlaceChannelsForBranch(branchId, mergedCh);
    await replacePlaceKeywordsForBranch(branchId, mergedKw);

    try {
      await logUploadAudit(branchId, 'place_full_sync', mergedWeekly.length + mergedCh.length + mergedKw.length, [], {
        weekly: mergedWeekly.length,
        channels: mergedCh.length,
        keywords: mergedKw.length,
      });
    } catch (auditErr) {
      console.warn('upload audit failed:', auditErr);
    }
    runAutoMergeAfterUpload();
  }

  // ── Sales Data ──
  function sanitizeSalesString(s) {
    if (s == null || typeof s !== 'string') return '';
    return s.replace(/\\/g, ' ').trim();
  }

  function computeSalesRecordHash(rec) {
    var paymentDate = '';
    if (rec.payment_date) {
      paymentDate = String(rec.payment_date).slice(0, 10);
    }
    var parts = [
      String(rec.branch_id || ''),
      paymentDate,
      sanitizeSalesString(rec.product_name || ''),
      String(parseInt(rec.amount || 0, 10) || 0),
      sanitizeSalesString(rec.product_type || '').toUpperCase(),
      sanitizeSalesString(rec.member_name || ''),
    ];
    return parts.join('|');
  }

  async function insertSalesRecords(branchId, rows) {
    ensureRowsNotEmpty(rows, '매출');
    var hasInvalid = rows.some(function (r) {
      var hasDate = !!String(r.payment_date || '').trim();
      var hasProduct = !!String(r.product_name || '').trim();
      var hasAmount = !(r.amount == null || String(r.amount).trim() === '');
      return !(hasDate && hasProduct && hasAmount);
    });
    if (hasInvalid) {
      throw new Error('매출 업로드 차단: 필수 컬럼(결제일, 상품명, 결제금액)이 누락된 행이 있습니다.');
    }
    var records = rows.map(function (r) {
      var amount = parseInt(r.amount || 0, 10) || 0;
      var rec = {
        branch_id: branchId,
        payment_date: r.payment_date,
        product_name: sanitizeSalesString(r.product_name),
        amount: amount,
        product_type: sanitizeSalesString(r.product_type) || 'FC',
        customer_type: sanitizeSalesString(r.customer_type) || 'etc',
        member_name: sanitizeSalesString(r.member_name),
        file_source: sanitizeSalesString(r.file_source),
      };
      rec.record_hash = computeSalesRecordHash(rec);
      return rec;
    });
    var dedupMap = new Map();
    records.forEach(function (rec) {
      dedupMap.set(rec.record_hash, rec);
    });
    records = Array.from(dedupMap.values());
    var { data, error } = await client()
      .from('sales_records')
      .upsert(records, { onConflict: 'branch_id,record_hash', ignoreDuplicates: true })
      .select();
    if (error) throw error;
    runAutoMergeAfterUpload();
    return data;
  }

  async function getSalesRecords(branchId, from, to) {
    var query = client()
      .from('sales_records')
      .select('*')
      .eq('branch_id', branchId)
      .order('payment_date');
    if (from) query = query.gte('payment_date', from);
    if (to) query = query.lte('payment_date', to);
    var { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function fetchAllRowsFromRpc(fnName, rpcArgs) {
    var pageSize = 1000;
    var from = 0;
    var page = 0;
    var maxPages = 120;
    var out = [];
    var lastTailKey = '';
    while (true) {
      var res = await client()
        .rpc(fnName, rpcArgs)
        .range(from, from + pageSize - 1);
      if (res.error) throw res.error;
      var rows = Array.isArray(res.data) ? res.data : [];
      if (!rows.length) break;
      out = out.concat(rows);
      if (rows.length < pageSize) break;
      page += 1;
      if (page >= maxPages) break;
      var tail = rows[rows.length - 1] || {};
      var tailKey = String(tail.id || '') + '|' + String(tail.payment_date || '') + '|' + String(tail.amount || '');
      if (tailKey && tailKey === lastTailKey) break;
      lastTailKey = tailKey;
      from += pageSize;
      if (from > 500000) break;
    }
    return { rows: out, pageCount: page + 1 };
  }

  async function fetchAllRowsFromSalesTable(branchIds, fromStr, toStr) {
    var pageSize = 1000;
    var from = 0;
    var out = [];
    var pageCount = 0;
    while (true) {
      var query = client()
        .from('sales_records')
        .select('id, branch_id, payment_date, amount, product_type, customer_type, member_name, product_name, file_source, created_at')
        .gte('payment_date', fromStr)
        .lte('payment_date', toStr)
        .order('payment_date', { ascending: true })
        .range(from, from + pageSize - 1);
      if (branchIds && branchIds.length) {
        query = query.in('branch_id', branchIds);
      }
      var res = await query;
      if (res.error) throw res.error;
      var rows = Array.isArray(res.data) ? res.data : [];
      if (!rows.length) break;
      out = out.concat(rows);
      pageCount += 1;
      if (rows.length < pageSize) break;
      from += pageSize;
      if (from > 500000) break;
    }
    return { rows: out, pageCount: pageCount };
  }

  async function getAllSalesRecords(branchIds, fromStr, toStr, options) {
    branchIds = Array.isArray(branchIds) ? branchIds : [];
    var mergeSameName = !!(options && options.mergeSameName);
    if (!branchIds.length) {
      try {
        var allRows = await fetchAllRowsFromSalesTable([], fromStr, toStr);
        setSalesFetchDebug({
          source: 'sales_table_all',
          rowCount: (allRows.rows || []).length,
          pageCount: allRows.pageCount || 0,
          branchCount: 0,
          fromStr: fromStr || '',
          toStr: toStr || '',
          mergeSameName: mergeSameName,
          error: ''
        });
        return allRows.rows || [];
      } catch (e0) {
        setSalesFetchDebug({
          source: 'sales_table_all_failed',
          rowCount: 0,
          pageCount: 0,
          branchCount: 0,
          fromStr: fromStr || '',
          toStr: toStr || '',
          mergeSameName: mergeSameName,
          error: String((e0 && e0.message) || e0 || '')
        });
      }
    }

    var dedupArgs = {
      p_branch_ids: branchIds,
      p_from: fromStr,
      p_to: toStr,
      p_merge_same_name: mergeSameName
    };
    try {
      var r1 = await fetchAllRowsFromRpc('get_sales_records_for_dashboard_dedup', dedupArgs);
      setSalesFetchDebug({
        source: 'dedup_rpc',
        rowCount: (r1.rows || []).length,
        pageCount: r1.pageCount || 0,
        branchCount: branchIds.length,
        fromStr: fromStr || '',
        toStr: toStr || '',
        mergeSameName: mergeSameName,
        error: ''
      });
      return r1.rows || [];
    } catch (e) {
      var msg = String((e && e.message) || '');
      var code = String((e && e.code) || '');
      var canFallback = msg.indexOf('get_sales_records_for_dashboard_dedup') >= 0
        || msg.indexOf('does not exist') >= 0
        || msg.indexOf('permission denied') >= 0
        || msg.indexOf('400') >= 0
        || code === 'PGRST202'
        || code === '42501';
      console.warn('dedup rpc failed, fallback to legacy rpc:', e);
      setSalesFetchDebug({
        source: 'dedup_rpc_failed',
        rowCount: 0,
        pageCount: 0,
        branchCount: branchIds.length,
        fromStr: fromStr || '',
        toStr: toStr || '',
        mergeSameName: mergeSameName,
        error: (code ? code + ': ' : '') + msg
      });
    }

    var fallbackArgs = {
      p_branch_ids: branchIds,
      p_from: fromStr,
      p_to: toStr
    };
    try {
      var r2 = await fetchAllRowsFromRpc('get_sales_records_for_dashboard', fallbackArgs);
      setSalesFetchDebug({
        source: 'legacy_rpc',
        rowCount: (r2.rows || []).length,
        pageCount: r2.pageCount || 0,
        branchCount: branchIds.length,
        fromStr: fromStr || '',
        toStr: toStr || '',
        mergeSameName: mergeSameName,
        error: ''
      });
      return r2.rows || [];
    } catch (e2) {
      try {
        var r3 = await fetchAllRowsFromSalesTable(branchIds, fromStr, toStr);
        setSalesFetchDebug({
          source: 'sales_table',
          rowCount: (r3.rows || []).length,
          pageCount: r3.pageCount || 0,
          branchCount: branchIds.length,
          fromStr: fromStr || '',
          toStr: toStr || '',
          mergeSameName: mergeSameName,
          error: ''
        });
        return r3.rows || [];
      } catch (e3) {
        var single = await client().rpc('get_sales_records_for_dashboard', fallbackArgs);
        if (single.error) throw (e3 || e2 || single.error);
        var singleRows = Array.isArray(single.data) ? single.data : [];
        setSalesFetchDebug({
          source: 'legacy_rpc_single',
          rowCount: singleRows.length,
          pageCount: 1,
          branchCount: branchIds.length,
          fromStr: fromStr || '',
          toStr: toStr || '',
          mergeSameName: mergeSameName,
          error: ''
        });
        return singleRows;
      }
    }
  }

  /** DB에서 주별·월별 집계된 작은 JSON만 받음 → 로딩 매우 빠름 */
  async function getSalesAggregated(branchIds, fromStr, toStr, options) {
    branchIds = Array.isArray(branchIds) ? branchIds : [];
    var mergeSameName = !!(options && options.mergeSameName);
    var dedupAggArgs = {
      p_branch_ids: branchIds,
      p_from: fromStr,
      p_to: toStr,
      p_merge_same_name: mergeSameName
    };
    try {
      var dedupRes = await client().rpc('get_sales_aggregated_for_dashboard_dedup', dedupAggArgs);
      if (!dedupRes.error) {
        var dedupObj = dedupRes.data;
        var dedupWeekly = (dedupObj && Array.isArray(dedupObj.weekly)) ? dedupObj.weekly : [];
        var dedupMonthly = (dedupObj && Array.isArray(dedupObj.monthly)) ? dedupObj.monthly : [];
        setSalesFetchDebug({
          source: 'dedup_agg_rpc',
          rowCount: dedupWeekly.length + dedupMonthly.length,
          pageCount: 1,
          branchCount: branchIds.length,
          fromStr: fromStr || '',
          toStr: toStr || '',
          mergeSameName: mergeSameName,
          error: ''
        });
        return { weekly: dedupWeekly, monthly: dedupMonthly };
      }
    } catch (e) {
      console.warn('dedup aggregated rpc failed, fallback to legacy aggregated rpc:', e);
    }

    if (mergeSameName) {
      // 동명이점 병합이 필요한데 dedup 집계 RPC가 없으면
      // legacy 집계는 중복 합산 위험이 있으므로 raw fallback을 유도한다.
      setSalesFetchDebug({
        source: 'legacy_agg_skipped_for_merge',
        rowCount: 0,
        pageCount: 0,
        branchCount: branchIds.length,
        fromStr: fromStr || '',
        toStr: toStr || '',
        mergeSameName: true,
        error: 'dedup_agg_rpc_unavailable'
      });
      return null;
    }

    var res = await client().rpc('get_sales_aggregated_for_dashboard', {
      p_branch_ids: branchIds,
      p_from: fromStr,
      p_to: toStr
    });
    if (res.error) throw res.error;
    var obj = res.data;
    if (!obj || typeof obj !== 'object') return null;
    var weekly = Array.isArray(obj.weekly) ? obj.weekly : [];
    var monthly = Array.isArray(obj.monthly) ? obj.monthly : [];
    setSalesFetchDebug({
      source: 'legacy_agg_rpc',
      rowCount: weekly.length + monthly.length,
      pageCount: 1,
      branchCount: branchIds.length,
      fromStr: fromStr || '',
      toStr: toStr || '',
      mergeSameName: mergeSameName,
      error: ''
    });
    return {
      weekly: weekly,
      monthly: monthly
    };
  }

  async function logUploadAudit(branchId, source, rowsCount, fileSources, meta) {
    var res = await client().rpc('log_upload_audit', {
      p_branch_id: branchId,
      p_source: source || 'sales_upload',
      p_rows_count: rowsCount || 0,
      p_file_sources: fileSources || [],
      p_meta: meta || {}
    });
    if (res.error) throw res.error;
  }

  // ── Coupons ──
  async function validateCoupon(code) {
    var { data, error } = await client()
      .from('coupons')
      .select('*')
      .eq('code', code.toUpperCase().trim())
      .eq('is_active', true)
      .single();
    if (error || !data) return { valid: false, message: '유효하지 않은 쿠폰입니다.' };
    if (data.valid_until && new Date(data.valid_until) < new Date()) return { valid: false, message: '만료된 쿠폰입니다.' };
    if (data.max_uses && data.used_count >= data.max_uses) return { valid: false, message: '사용 횟수가 초과된 쿠폰입니다.' };
    return { valid: true, coupon: data };
  }

  async function redeemCoupon(couponId) {
    var profile = await getProfile();
    var { error } = await client().from('coupon_redemptions').insert({
      coupon_id: couponId,
      brand_id: profile.brand_id,
      redeemed_by: profile.id,
    });
    if (error) throw error;
    // 사용 횟수 증가
    await client().rpc('increment_coupon_usage', { coupon_id_input: couponId });
  }

  // ── Plans ──
  async function listPlans() {
    var { data } = await client()
      .from('plans')
      .select('*')
      .eq('is_active', true)
      .order('sort_order');
    return data || [];
  }

  // ── Super Admin ──
  async function adminListUsers() {
    var { data, error } = await client()
      .from('profiles')
      .select('*, brands:brand_id(name), branches:branch_id(name)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function bemoveCreateMyRoleApprovalRequest(requestedRole, requestNote) {
    var role = String(requestedRole || '').toLowerCase().trim();
    if (!role) throw new Error('requestedRole이 필요합니다.');
    var res = await client().rpc('bemove_create_my_role_approval_request', {
      p_requested_role: role,
      p_request_note: requestNote || null
    });
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function adminListRoleApprovalRequests(status) {
    var res = await client().rpc('bemove_list_role_approval_requests', {
      p_status: status || 'pending'
    });
    if (res.error) throw res.error;
    return Array.isArray(res.data) ? res.data : [];
  }

  async function adminReviewRoleApprovalRequest(requestId, approve, grantRole, reviewNote) {
    if (!requestId) throw new Error('requestId가 필요합니다.');
    var role = grantRole ? String(grantRole).toLowerCase().trim() : null;
    var res = await client().rpc('bemove_review_role_approval_request', {
      p_request_id: requestId,
      p_approve: !!approve,
      p_grant_role: role || null,
      p_review_note: reviewNote || null
    });
    if (res.error) throw res.error;
    return res.data || null;
  }

  /** 슈퍼 관리자: 사용자 역할·브랜드 수정 */
  async function adminUpdateUserProfile(userId, payload) {
    if (!userId) throw new Error('userId가 필요합니다.');
    var updates = {};
    if (payload && payload.role !== undefined) {
      var r = String(payload.role).toLowerCase();
      if (r !== 'super' && r !== 'brand' && r !== 'branch' && r !== 'fc' && r !== 'brand_accounting' && r !== 'trainer' && r !== 'member') {
        throw new Error('역할은 super, brand, branch, fc, brand_accounting, trainer, member 중 하나여야 합니다.');
      }
      updates.role = r;
      if (r === 'super') updates.brand_id = null;
    }
    if (payload && payload.brand_id !== undefined) {
      updates.brand_id = payload.brand_id || null;
    }
    if (payload && payload.branch_id !== undefined) {
      updates.branch_id = payload.branch_id || null;
    }
    if (payload && payload.name !== undefined) {
      var nm = String(payload.name || '').trim();
      updates.name = nm || null;
    }
    if (Object.keys(updates).length === 0) throw new Error('수정할 항목이 없습니다.');
    var { data, error } = await client()
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function adminDeleteUserProfile(userId) {
    if (!userId) throw new Error('userId가 필요합니다.');
    var { error } = await client().from('profiles').delete().eq('id', userId);
    if (error) throw error;
  }

  async function adminSetTrainerPosition(userId, trainerPosition) {
    if (!userId) throw new Error('userId가 필요합니다.');
    var res = await client().rpc('admin_set_trainer_position', {
      p_user_id: userId,
      p_trainer_position: trainerPosition || null
    });
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function adminSetTrainerPositionMonthly(userId, yearMonth, trainerPosition) {
    if (!userId) throw new Error('userId가 필요합니다.');
    var ym = String(yearMonth || '').trim();
    if (!/^\d{4}-\d{2}$/.test(ym)) ym = new Date().toISOString().slice(0, 7);
    var res = await client().rpc('admin_set_trainer_position_monthly', {
      p_user_id: userId,
      p_year_month: ym,
      p_trainer_position: trainerPosition || null
    });
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function bemoveListBranchPositionTargets(branchId, yearMonth) {
    if (!branchId) return [];
    var ym = String(yearMonth || '').trim();
    if (!/^\d{4}-\d{2}$/.test(ym)) ym = new Date().toISOString().slice(0, 7);
    var res = await client().rpc('bemove_list_branch_position_targets', {
      p_branch_id: branchId,
      p_year_month: ym
    });
    if (res.error) throw res.error;
    return Array.isArray(res.data) ? res.data : [];
  }

  async function bemoveUpsertBranchPositionTarget(branchId, yearMonth, trainerPosition, targetAmount) {
    if (!branchId) throw new Error('branchId가 필요합니다.');
    var ym = String(yearMonth || '').trim();
    if (!/^\d{4}-\d{2}$/.test(ym)) ym = new Date().toISOString().slice(0, 7);
    var res = await client().rpc('bemove_upsert_branch_position_target', {
      p_branch_id: branchId,
      p_year_month: ym,
      p_trainer_position: trainerPosition || null,
      p_target_amount: Math.max(0, Number(targetAmount || 0) || 0)
    });
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function bemoveGetTrainerMonthlyGoal(yearMonth, trainerId) {
    var ym = String(yearMonth || '').trim();
    if (!/^\d{4}-\d{2}$/.test(ym)) ym = new Date().toISOString().slice(0, 7);
    var res = await client().rpc('bemove_get_trainer_monthly_goal', {
      p_year_month: ym,
      p_trainer_id: trainerId || null
    });
    if (res.error) throw res.error;
    if (Array.isArray(res.data)) return res.data[0] || null;
    return res.data || null;
  }

  async function bemoveGetAssignableMembers() {
    var { data, error } = await client().rpc('bemove_get_assignable_members');
    if (error) throw error;
    return data || [];
  }

  async function bemoveListPtMembers() {
    var res = await client().rpc('bemove_list_pt_members');
    if (!res.error) return res.data || [];
    var msg = String(res.error && res.error.message || '');
    if (msg.indexOf('bemove_list_pt_members') >= 0 && msg.indexOf('does not exist') >= 0) {
      // RPC 미배포 환경 fallback: 기존 조회 범위 멤버 목록으로 대체
      return bemoveGetAssignableMembers();
    }
    throw res.error;
  }

  async function bemoveGetMyPtSession(memberId) {
    var uid = memberId || null;
    if (!uid) {
      var me = await getUser();
      uid = me && me.id ? me.id : null;
    }
    if (!uid) return { session_total: 0, session_used: 0 };
    var res = await client()
      .from('bemove_member_pt_sessions')
      .select('session_total, session_used')
      .eq('member_id', uid)
      .maybeSingle();
    if (res.error) throw res.error;
    var row = res.data || {};
    return {
      session_total: Number(row.session_total || 0),
      session_used: Number(row.session_used || 0)
    };
  }

  async function bemoveListOtMembers() {
    var res = await client().rpc('bemove_list_ot_members');
    if (!res.error) return res.data || [];
    var msg = String(res.error && res.error.message || '');
    if (msg.indexOf('bemove_list_ot_members') >= 0 && msg.indexOf('does not exist') >= 0) {
      return [];
    }
    throw res.error;
  }

  async function bemoveListOtConversionRecords(branchId) {
    var resV2 = await client().rpc('bemove_list_ot_conversion_records_v2', {
      p_branch_id: branchId || null
    });
    if (!resV2.error) return resV2.data || [];
    var msgV2 = String(resV2.error && resV2.error.message || '');
    if (msgV2.indexOf('bemove_list_ot_conversion_records_v2') < 0 || msgV2.indexOf('does not exist') < 0) {
      throw resV2.error;
    }
    var res = await client().rpc('bemove_list_ot_conversion_records');
    if (!res.error) return res.data || [];
    var msg = String(res.error && res.error.message || '');
    if (msg.indexOf('bemove_list_ot_conversion_records') >= 0 && msg.indexOf('does not exist') >= 0) {
      return [];
    }
    throw res.error;
  }

  async function bemoveSetOtFailureReason(memberId, reason) {
    var res = await client().rpc('bemove_set_ot_failure_reason', { p_member_id: memberId, p_reason: reason || '' });
    if (res.error) throw res.error;
  }

  async function bemoveListSalesTransactions(branchId, fromDate, toDate, refundsOnly) {
    var res = await client().rpc('bemove_list_sales_transactions', {
      p_branch_id: branchId || null,
      p_from: fromDate || null,
      p_to: toDate || null,
      p_refunds_only: !!refundsOnly
    });
    if (res.error) throw res.error;
    return res.data || [];
  }

  async function bemoveSalesDashboardStats(branchId, yearMonth) {
    var res = await client().rpc('bemove_sales_dashboard_stats', {
      p_branch_id: branchId || null,
      p_year_month: yearMonth || null
    });
    if (res.error) throw res.error;
    return res.data || {};
  }

  async function bemoveInsertSalesTransaction(payload) {
    var res = await client().rpc('bemove_insert_sales_transaction', {
      p_branch_id: payload.branch_id,
      p_member_id: payload.member_id || null,
      p_member_name: payload.member_name || '',
      p_sale_date: payload.sale_date,
      p_amount: Number(payload.amount) || 0,
      p_payment_method: payload.payment_method || 'full',
      p_contract_type: payload.contract_type || 'new',
      p_inflow_channel: payload.inflow_channel || 'other',
      p_sessions: payload.sessions != null ? Number(payload.sessions) : null
    });
    if (res.error) throw res.error;
    return res.data;
  }

  async function bemoveInsertRefund(payload) {
    var res = await client().rpc('bemove_insert_refund', {
      p_branch_id: payload.branch_id,
      p_original_sale_id: payload.original_sale_id || null,
      p_refund_amount: Number(payload.refund_amount) || 0,
      p_refund_reason: payload.refund_reason || '',
      p_refund_date: payload.refund_date || new Date().toISOString().slice(0, 10)
    });
    if (res.error) throw res.error;
    return res.data;
  }

  async function bemoveUpdateSalesTransaction(id, payload) {
    var res = await client().rpc('bemove_update_sales_transaction', {
      p_id: id,
      p_member_name: payload.member_name,
      p_sale_date: payload.sale_date,
      p_amount: payload.amount != null ? Number(payload.amount) : null,
      p_payment_method: payload.payment_method,
      p_contract_type: payload.contract_type,
      p_inflow_channel: payload.inflow_channel,
      p_sessions: payload.sessions != null ? Number(payload.sessions) : null
    });
    if (res.error) throw res.error;
    return res.data;
  }

  async function bemoveDeleteSalesTransaction(id) {
    var res = await client().rpc('bemove_delete_sales_transaction', { p_id: id });
    if (res.error) throw res.error;
  }

  async function bemoveGetMemberCumulativePayment(memberId) {
    if (!memberId) return 0;
    var res = await client().rpc('bemove_get_member_cumulative_payment', { p_member_id: memberId });
    if (res.error) throw res.error;
    var n = Number(res.data);
    return isFinite(n) ? n : 0;
  }

  async function bemoveIncrementOtLog(memberId) {
    if (!memberId) throw new Error('memberId가 필요합니다.');
    var res = await client().rpc('bemove_increment_ot_log', { p_member_id: memberId });
    if (res.error) throw res.error;
    return Array.isArray(res.data) ? (res.data[0] || null) : res.data;
  }

  async function bemoveConsumePtSession(memberId) {
    if (!memberId) return;
    var res = await client().rpc('bemove_consume_pt_session', { p_member_id: memberId });
    if (res.error) throw res.error;
  }

  /** 회원별 PT 총 세션·소진량 임의 조정 (이미 가입된 회원 과거 매출 반영 시 등) */
  async function bemoveUpdatePtSessions(memberId, payload) {
    if (!memberId) throw new Error('회원이 필요합니다.');
    var res = await client().rpc('bemove_update_pt_sessions', {
      p_member_id: memberId,
      p_session_used: payload.session_used != null ? Number(payload.session_used) : null,
      p_session_total: payload.session_total != null ? Number(payload.session_total) : null
    });
    if (res.error) throw res.error;
  }

  async function bemoveListScheduleSlots(branchId, fromDate, toDate) {
    var res = await client().rpc('bemove_list_schedule_slots', {
      p_branch_id: branchId || null,
      p_from: fromDate || null,
      p_to: toDate || null
    });
    if (res.error) throw res.error;
    return res.data || [];
  }

  async function bemoveInsertScheduleSlot(payload) {
    var res = await client().rpc('bemove_insert_schedule_slot', {
      p_branch_id: payload.branch_id,
      p_member_id: payload.member_id || null,
      p_member_name: payload.member_name || '',
      p_scheduled_date: payload.scheduled_date,
      p_start_time: payload.start_time,
      p_duration_minutes: payload.duration_minutes != null ? payload.duration_minutes : 50
    });
    if (res.error) throw res.error;
    return res.data;
  }

  async function bemoveDeleteScheduleSlot(slotId) {
    var res = await client().from('bemove_schedule_slots').delete().eq('id', slotId).select('id').single();
    if (res.error) throw res.error;
    return res.data;
  }

  async function bemoveUpdateScheduleSlot(slotId, payload) {
    payload = payload || {};
    var body = {
      member_id: payload.member_id || null,
      member_name: payload.member_name || '',
      scheduled_date: payload.scheduled_date,
      start_time: payload.start_time,
      duration_minutes: payload.duration_minutes != null ? payload.duration_minutes : 50
    };
    var res = await client()
      .from('bemove_schedule_slots')
      .update(body)
      .eq('id', slotId)
      .select('*')
      .single();
    if (res.error) throw res.error;
    return res.data;
  }

  async function bemoveCompleteScheduleSlot(slotId) {
    var res = await client().rpc('bemove_complete_schedule_slot', { p_slot_id: slotId });
    if (res.error) throw res.error;
  }

  async function bemoveRetentionDashboard(branchId, yearMonth) {
    var res = await client().rpc('bemove_retention_dashboard', {
      p_branch_id: branchId || null,
      p_year_month: yearMonth || null
    });
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function bemoveListSatisfactionTargets(branchId) {
    var res = await client().rpc('bemove_list_satisfaction_targets', {
      p_branch_id: branchId || null
    });
    if (res.error) throw res.error;
    return res.data || [];
  }

  async function bemoveSendSatisfactionSurvey(memberId) {
    var res = await client().rpc('bemove_send_satisfaction_survey', {
      p_member_id: memberId
    });
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function bemoveListMyPendingSatisfactionSurveys() {
    var res = await client().rpc('bemove_list_my_pending_satisfaction_surveys');
    if (res.error) throw res.error;
    return res.data || [];
  }

  async function bemoveSubmitSatisfactionSurvey(payload) {
    payload = payload || {};
    var res = await client().rpc('bemove_submit_satisfaction_survey', {
      p_survey_id: payload.survey_id,
      p_time_promise: Number(payload.time_promise) || 0,
      p_goal_achievement: Number(payload.goal_achievement) || 0,
      p_kindness: Number(payload.kindness) || 0,
      p_professionalism: Number(payload.professionalism) || 0,
      p_appearance: Number(payload.appearance) || 0,
      p_punctuality: Number(payload.punctuality) || 0,
      p_feedback: Number(payload.feedback) || 0,
      p_focus: Number(payload.focus) || 0,
      p_trainer_message: payload.trainer_message || null,
      p_manager_private_message: payload.manager_private_message || null
    });
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function bemoveListSatisfactionSurveys(branchId, fromDate, toDate) {
    var res = await client().rpc('bemove_list_satisfaction_surveys', {
      p_branch_id: branchId || null,
      p_from: fromDate || null,
      p_to: toDate || null
    });
    if (res.error) throw res.error;
    return res.data || [];
  }

  async function bemoveTrainerSalesRanking(yearMonth, branchId) {
    var res = await client().rpc('bemove_trainer_sales_ranking', {
      p_year_month: yearMonth || null,
      p_branch_id: branchId || null
    });
    if (res.error) throw res.error;
    return res.data || [];
  }

  async function bemoveCreateMemberDietLog(payload) {
    payload = payload || {};
    var res = await client().rpc('bemove_create_member_diet_log', {
      p_member_id: payload.member_id || null,
      p_meal_at: payload.meal_at || new Date().toISOString(),
      p_meal_type: payload.meal_type || 'other',
      p_photo_urls: Array.isArray(payload.photo_urls) ? payload.photo_urls : [],
      p_food_note: payload.food_note || null,
      p_detected_items: payload.detected_items || [],
      p_detected_nutrition: payload.detected_nutrition || {},
      p_final_nutrition: payload.final_nutrition || null,
      p_ai_feedback: payload.ai_feedback || null,
      p_analysis_status: payload.analysis_status || 'done',
      p_analysis_error: payload.analysis_error || null
    });
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function bemoveListMemberDietLogs(memberId, fromDate, toDate) {
    var res = await client().rpc('bemove_list_member_diet_logs', {
      p_member_id: memberId || null,
      p_from: fromDate || null,
      p_to: toDate || null
    });
    if (res.error) throw res.error;
    return res.data || [];
  }

  async function bemoveUpdateMemberDietNutrition(logId, finalNutrition, aiFeedback, reason) {
    var res = await client().rpc('bemove_update_member_diet_nutrition', {
      p_log_id: logId,
      p_final_nutrition: finalNutrition || {},
      p_ai_feedback: aiFeedback || null,
      p_reason: reason || null
    });
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function bemoveAddMemberDietFeedback(logId, message) {
    var res = await client().rpc('bemove_add_member_diet_feedback', {
      p_log_id: logId,
      p_message: message || ''
    });
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function bemoveDeleteMemberDietLog(logId) {
    var res = await client().rpc('bemove_delete_member_diet_log', {
      p_log_id: logId
    });
    if (res.error) throw res.error;
  }

  async function bemoveListMemberDietFeedbacks(logId) {
    var res = await client().rpc('bemove_list_member_diet_feedbacks', {
      p_log_id: logId
    });
    if (res.error) throw res.error;
    return res.data || [];
  }

  async function bemoveListMyDietAlerts(limitCount) {
    var res = await client().rpc('bemove_list_my_diet_alerts', {
      p_limit: limitCount || 50
    });
    if (res.error) throw res.error;
    return res.data || [];
  }

  async function bemoveMarkDietAlertRead(alertId) {
    var res = await client().rpc('bemove_mark_diet_alert_read', {
      p_alert_id: alertId
    });
    if (res.error) throw res.error;
  }

  async function bemoveDailyDietKcalSummary(memberId, dateStr) {
    var res = await client().rpc('bemove_daily_diet_kcal_summary', {
      p_member_id: memberId || null,
      p_date: dateStr || null
    });
    if (res.error) throw res.error;
    var rows = res.data || [];
    return Array.isArray(rows) ? (rows[0] || null) : rows;
  }

  async function bemoveAssignExistingMember(memberId) {
    if (!memberId) throw new Error('memberId가 필요합니다.');
    var { data, error } = await client().rpc('bemove_assign_existing_member', {
      p_member_id: memberId
    });
    if (error) throw error;
    return data;
  }

  async function bemoveAssignMemberTrainer(memberId, trainerId) {
    if (!memberId) throw new Error('memberId가 필요합니다.');
    var res = await client().rpc('bemove_assign_member_trainer', {
      p_member_id: memberId,
      p_trainer_id: trainerId || null
    });
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function bemoveListBranchEquipments(branchId) {
    var res = await client().rpc('bemove_list_branch_equipments', {
      p_branch_id: branchId || null
    });
    if (res.error) throw res.error;
    return Array.isArray(res.data) ? res.data : [];
  }

  async function bemoveCreateBranchEquipment(branchId, category, name) {
    var res = await client().rpc('bemove_create_branch_equipment', {
      p_branch_id: branchId || null,
      p_category: category || null,
      p_name: name || null
    });
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function bemoveDeleteBranchEquipment(branchId, category, name) {
    var res = await client().rpc('bemove_delete_branch_equipment', {
      p_branch_id: branchId || null,
      p_category: category || null,
      p_name: name || null
    });
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function bemoveCreateBranchEquipmentRequest(branchId, requestedGroup, requestedName) {
    var res = await client().rpc('bemove_create_branch_equipment_request', {
      p_branch_id: branchId || null,
      p_requested_group: requestedGroup || null,
      p_requested_name: requestedName || null
    });
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function bemoveListBranchEquipmentRequests(branchId, status) {
    var res = await client().rpc('bemove_list_branch_equipment_requests', {
      p_branch_id: branchId || null,
      p_status: status || null
    });
    if (res.error) throw res.error;
    return Array.isArray(res.data) ? res.data : [];
  }

  async function bemoveReviewBranchEquipmentRequest(requestId, approve, reviewNote) {
    var res = await client().rpc('bemove_review_branch_equipment_request', {
      p_request_id: requestId || null,
      p_approve: !!approve,
      p_review_note: reviewNote || null
    });
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function bemoveCreateMemberRegistrationRequest(payload) {
    payload = payload || {};
    var args = {
      p_member_name: payload.name || '',
      p_join_date: payload.join_date || null,
      p_member_type: payload.member_type || null,
      p_phone: payload.phone || null,
      p_age: payload.age != null && payload.age !== '' ? Number(payload.age) : null,
      p_gender: payload.gender || null,
      p_height_cm: payload.height_cm != null && payload.height_cm !== '' ? Number(payload.height_cm) : null,
      p_initial_weight_kg: payload.initial_weight_kg != null && payload.initial_weight_kg !== '' ? Number(payload.initial_weight_kg) : null,
      p_goal: payload.goal || null,
      p_member_email: payload.member_email || null
    };
    var v2 = await client().rpc('bemove_create_member_registration_request_v2', args);
    if (!v2.error) return v2.data;
    var msg = String(v2.error && v2.error.message || '');
    if (msg.indexOf('bemove_create_member_registration_request_v2') >= 0 && msg.indexOf('does not exist') >= 0) {
      var v1 = await client().rpc('bemove_create_member_registration_request', args);
      if (v1.error) throw v1.error;
      return v1.data;
    }
    throw v2.error;
  }

  async function bemoveClaimMemberRegistrationByEmail() {
    var res = await client().rpc('bemove_claim_member_registration_by_email');
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function bemoveGetMemberProfile(memberId) {
    if (!memberId) throw new Error('memberId가 필요합니다.');
    var res = await client().rpc('bemove_get_member_profile', { p_member_id: memberId });
    if (res.error) throw res.error;
    var rows = res.data || [];
    return Array.isArray(rows) ? (rows[0] || null) : rows;
  }

  async function bemoveUpsertMemberProfile(memberId, payload) {
    if (!memberId) throw new Error('memberId가 필요합니다.');
    payload = payload || {};
    var res = await client().rpc('bemove_upsert_member_profile', {
      p_member_id: memberId,
      p_display_name: payload.display_name || null,
      p_phone: payload.phone || null,
      p_gender: payload.gender || null,
      p_age: payload.age != null && payload.age !== '' ? Number(payload.age) : null,
      p_height_cm: payload.height_cm != null && payload.height_cm !== '' ? Number(payload.height_cm) : null,
      p_weight_kg: payload.weight_kg != null && payload.weight_kg !== '' ? Number(payload.weight_kg) : null,
      p_main_goal: payload.main_goal || null,
      p_notes: payload.notes || null
    });
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function bemoveListMemberConsultLogs(memberId, limitCount) {
    if (!memberId) throw new Error('memberId가 필요합니다.');
    var res = await client().rpc('bemove_list_member_consult_logs', {
      p_member_id: memberId,
      p_limit: limitCount || 100
    });
    if (res.error) throw res.error;
    return res.data || [];
  }

  async function bemoveCreateMemberConsultLog(memberId, payload) {
    if (!memberId) throw new Error('memberId가 필요합니다.');
    var res = await client().rpc('bemove_create_member_consult_log', {
      p_member_id: memberId,
      p_payload: payload || {}
    });
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function bemoveListMember555Logs(memberId, limitCount) {
    if (!memberId) throw new Error('memberId가 필요합니다.');
    var res = await client().rpc('bemove_list_member_555_logs', {
      p_member_id: memberId,
      p_limit: limitCount || 100
    });
    if (res.error) throw res.error;
    return res.data || [];
  }

  async function bemoveCreateMember555Log(memberId, payload) {
    if (!memberId) throw new Error('memberId가 필요합니다.');
    payload = payload || {};
    var res = await client().rpc('bemove_create_member_555_log', {
      p_member_id: memberId,
      p_entry_date: payload.entry_date || null,
      p_checkin: payload.checkin || {},
      p_workout: payload.workout || {},
      p_feedback: payload.feedback || {},
      p_summary: payload.summary || {},
      p_insight: payload.insight || null
    });
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function bemoveCreateMemberHomeworkAssignment(memberId, title, message, parts) {
    if (!memberId) throw new Error('memberId가 필요합니다.');
    var res = await client().rpc('bemove_create_member_homework_assignment', {
      p_member_id: memberId,
      p_title: title || null,
      p_message: message || '',
      p_parts: parts || []
    });
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function bemoveListMemberHomeworkAssignments(memberId, limitCount) {
    if (!memberId) throw new Error('memberId가 필요합니다.');
    var res = await client().rpc('bemove_list_member_homework_assignments', {
      p_member_id: memberId,
      p_limit: limitCount || 100
    });
    if (res.error) throw res.error;
    return res.data || [];
  }

  async function bemoveSetMemberHomeworkCompleted(assignmentId, isCompleted) {
    if (!assignmentId) throw new Error('assignmentId가 필요합니다.');
    var res = await client().rpc('bemove_set_member_homework_completed', {
      p_assignment_id: assignmentId,
      p_is_completed: !!isCompleted
    });
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function bemoveCreateMemberSelfWorkout(memberId, workoutType, note, performedAt) {
    if (!memberId) throw new Error('memberId가 필요합니다.');
    var res = await client().rpc('bemove_create_member_self_workout', {
      p_member_id: memberId,
      p_workout_type: workoutType || 'weight',
      p_note: note || '',
      p_performed_at: performedAt || null
    });
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function bemoveListMemberSelfWorkouts(memberId, limitCount) {
    if (!memberId) throw new Error('memberId가 필요합니다.');
    var res = await client().rpc('bemove_list_member_self_workouts', {
      p_member_id: memberId,
      p_limit: limitCount || 100
    });
    if (res.error) throw res.error;
    return res.data || [];
  }

  async function bemoveListMemberInbodyLogs(memberId, limitCount) {
    if (!memberId) throw new Error('memberId가 필요합니다.');
    var res = await client().rpc('bemove_list_member_inbody_logs', {
      p_member_id: memberId,
      p_limit: limitCount || 100
    });
    if (res.error) throw res.error;
    return res.data || [];
  }

  async function bemoveCreateMemberInbodyLog(memberId, source, payload) {
    if (!memberId) throw new Error('memberId가 필요합니다.');
    var res = await client().rpc('bemove_create_member_inbody_log', {
      p_member_id: memberId,
      p_source: source || 'manual',
      p_payload: payload || {}
    });
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function bemoveListMemberOtLogs(memberId, limitCount) {
    if (!memberId) throw new Error('memberId가 필요합니다.');
    var res = await client().rpc('bemove_list_member_ot_logs', {
      p_member_id: memberId,
      p_limit: limitCount || 100
    });
    if (res.error) throw res.error;
    return res.data || [];
  }

  async function bemoveCreateMemberOtLog(memberId, actionType, payload) {
    if (!memberId) throw new Error('memberId가 필요합니다.');
    var res = await client().rpc('bemove_create_member_ot_log', {
      p_member_id: memberId,
      p_action_type: actionType || 'session_complete',
      p_payload: payload || {}
    });
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function adminCreateCoupon(coupon) {
    var { data, error } = await client()
      .from('coupons')
      .insert(coupon)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function adminListCoupons() {
    var { data, error } = await client()
      .from('coupons')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function adminListUploadAudits(limitCount) {
    var lim = limitCount || 200;
    var { data, error } = await client()
      .from('upload_audit_logs')
      .select('created_at, user_email, user_role, branch_id, branches:branch_id(name), source, rows_count, file_sources')
      .order('created_at', { ascending: false })
      .limit(lim);
    if (error) throw error;
    return data || [];
  }

  async function adminGetDataHealthSnapshot(recentDays) {
    var days = parseInt(recentDays || 7, 10) || 7;
    var res = await client().rpc('get_super_data_health_snapshot', {
      p_recent_days: days,
    });
    if (res.error) throw res.error;
    return res.data || null;
  }

  async function logModeSwitchEvent(mode, meta) {
    var user = await getUser();
    if (!user) return;
    var payload = {
      user_id: user.id,
      mode: String(mode || 'formula').toLowerCase(),
      page_path: window.location.pathname || '/',
      page_query: window.location.search || '',
      meta: meta || {}
    };
    // table 우선, 없으면 rpc fallback
    var ins = await client().from('mode_switch_events').insert(payload);
    if (!ins.error) return;
    var msg = String(ins.error.message || '');
    if (msg.indexOf('mode_switch_events') >= 0 && msg.indexOf('does not exist') >= 0) {
      var rpc = await client().rpc('log_mode_switch_event', {
        p_mode: payload.mode,
        p_page_path: payload.page_path,
        p_page_query: payload.page_query,
        p_meta: payload.meta
      });
      if (rpc.error) throw rpc.error;
      return;
    }
    throw ins.error;
  }

  // ── Public API ──
  return {
    init: init,
    client: client,
    // Auth
    signUp: signUp,
    signIn: signIn,
    signInWithGoogle: signInWithGoogle,
    requestPasswordResetEmail: requestPasswordResetEmail,
    signOut: signOut,
    setMySignupRole: setMySignupRole,
    getSession: getSession,
    getUser: getUser,
    // Profile
    getProfile: getProfile,
    clearProfileCache: clearProfileCache,
    // Brand
    createBrand: createBrand,
    getBrand: getBrand,
    getBrandIdByOwner: getBrandIdByOwner,
    getBrandMemberProfiles: getBrandMemberProfiles,
    updateBrandManagers: updateBrandManagers,
    updateBrandKeywords: updateBrandKeywords,
    listBrands: listBrands,
    // Branch
    createBranch: createBranch,
    listBranches: listBranches,
    listMyManagedBranches: listMyManagedBranches,
    inviteBranchManager: inviteBranchManager,
    // Place Data
    upsertPlaceWeekly: upsertPlaceWeekly,
    getPlaceWeekly: getPlaceWeekly,
    getPlaceChannels: getPlaceChannels,
    getPlaceKeywords: getPlaceKeywords,
    getPlaceWeeklyBatch: getPlaceWeeklyBatch,
    getPlaceChannelsBatch: getPlaceChannelsBatch,
    getPlaceKeywordsBatch: getPlaceKeywordsBatch,
    upsertPlaceChannels: upsertPlaceChannels,
    upsertPlaceKeywords: upsertPlaceKeywords,
    replacePlaceWeeklyForBranch: replacePlaceWeeklyForBranch,
    replacePlaceChannelsForBranch: replacePlaceChannelsForBranch,
    replacePlaceKeywordsForBranch: replacePlaceKeywordsForBranch,
    clearPlaceDataForBranch: clearPlaceDataForBranch,
    syncPlaceDataFull: syncPlaceDataFull,
    // Sales
    insertSalesRecords: insertSalesRecords,
    getSalesRecords: getSalesRecords,
    getAllSalesRecords: getAllSalesRecords,
    getSalesAggregated: getSalesAggregated,
    getLastSalesFetchDebug: getLastSalesFetchDebug,
    logUploadAudit: logUploadAudit,
    // Coupons
    validateCoupon: validateCoupon,
    redeemCoupon: redeemCoupon,
    // Plans
    listPlans: listPlans,
    // Admin
    adminListUsers: adminListUsers,
    bemoveCreateMyRoleApprovalRequest: bemoveCreateMyRoleApprovalRequest,
    adminListRoleApprovalRequests: adminListRoleApprovalRequests,
    adminReviewRoleApprovalRequest: adminReviewRoleApprovalRequest,
    adminUpdateUserProfile: adminUpdateUserProfile,
    adminDeleteUserProfile: adminDeleteUserProfile,
    adminSetTrainerPosition: adminSetTrainerPosition,
    adminSetTrainerPositionMonthly: adminSetTrainerPositionMonthly,
    adminCreateCoupon: adminCreateCoupon,
    adminListCoupons: adminListCoupons,
    adminListUploadAudits: adminListUploadAudits,
    adminGetDataHealthSnapshot: adminGetDataHealthSnapshot,
    logModeSwitchEvent: logModeSwitchEvent,
    adminCreateBrand: adminCreateBrand,
    adminUpdateBrandKeywords: adminUpdateBrandKeywords,
    adminCreateBranch: adminCreateBranch,
    adminGetBranch: adminGetBranch,
    adminListBranchManagers: adminListBranchManagers,
    adminAssignBranchManager: adminAssignBranchManager,
    adminUnassignBranchManager: adminUnassignBranchManager,
    adminUpdateBranch: adminUpdateBranch,
    adminDeleteBranch: adminDeleteBranch,
    /** 플랫폼 관리자 전용: source 지점의 플레이스 데이터를 target 지점으로 복사(동기화) */
    syncPlaceDataBetweenBranches: syncPlaceDataBetweenBranches,
    /** 플랫폼 관리자 전용: 동일 브랜드 내 동일 지점명 중복을 하나로 통합 */
    mergeDuplicateBranchesSameBrand: mergeDuplicateBranchesSameBrand,
    // Profitability
    listBranchFinancials: listBranchFinancials,
    upsertBranchFinancial: upsertBranchFinancial,
    deleteBranchFinancial: deleteBranchFinancial,
    getProfitabilityAInsight: getProfitabilityAInsight,
    bemoveGetInbodyAiInsight: bemoveGetInbodyAiInsight,
    bemoveAnalyzeDietFromPhotos: bemoveAnalyzeDietFromPhotos,
    bemoveAnalyzeDietInbodyFeedback: bemoveAnalyzeDietInbodyFeedback,
    // Branch daily expenses (지출 일별)
    listBranchDailyExpenses: listBranchDailyExpenses,
    insertBranchDailyExpense: insertBranchDailyExpense,
    updateBranchDailyExpense: updateBranchDailyExpense,
    deleteBranchDailyExpense: deleteBranchDailyExpense,
    getExpenseCategoryCounts: getExpenseCategoryCounts,
    // Expense requests (지출 결의)
    listExpenseRequests: listExpenseRequests,
    insertExpenseRequest: insertExpenseRequest,
    uploadExpenseRequestAttachments: uploadExpenseRequestAttachments,
    uploadBemoveDietPhotos: uploadBemoveDietPhotos,
    updateExpenseRequestAttachmentUrls: updateExpenseRequestAttachmentUrls,
    approveExpenseRequest: approveExpenseRequest,
    rejectExpenseRequest: rejectExpenseRequest,
    markExpenseRequestTransferDone: markExpenseRequestTransferDone,
    markExpenseRequestCardPaid: markExpenseRequestCardPaid,
    confirmExpenseRequest: confirmExpenseRequest,
    cancelExpenseRequest: cancelExpenseRequest,
    updateExpenseRequest: updateExpenseRequest,
    deleteExpenseRequest: deleteExpenseRequest,
    // Refund requests (고객 환불)
    listRefundRequests: listRefundRequests,
    insertRefundRequest: insertRefundRequest,
    approveRefundRequest: approveRefundRequest,
    rejectRefundRequest: rejectRefundRequest,
    markRefundRequestCompleted: markRefundRequestCompleted,
    // Branch weekly sales targets (목표 매출)
    listBranchWeeklyTargets: listBranchWeeklyTargets,
    upsertBranchWeeklyTarget: upsertBranchWeeklyTarget,
    // Branch daily activities (활동 실적 일별)
    listBranchDailyActivities: listBranchDailyActivities,
    upsertBranchDailyActivity: upsertBranchDailyActivity,
    // Branch monthly activity targets (월별 활동·성공률 목표)
    listBranchMonthlyActivityTargets: listBranchMonthlyActivityTargets,
    upsertBranchMonthlyActivityTarget: upsertBranchMonthlyActivityTarget,
    // Bemove member registration / assignment
    bemoveListPtMembers: bemoveListPtMembers,
    bemoveGetMyPtSession: bemoveGetMyPtSession,
    bemoveListOtMembers: bemoveListOtMembers,
    bemoveListOtConversionRecords: bemoveListOtConversionRecords,
    bemoveSetOtFailureReason: bemoveSetOtFailureReason,
    bemoveListSalesTransactions: bemoveListSalesTransactions,
    bemoveSalesDashboardStats: bemoveSalesDashboardStats,
    bemoveInsertSalesTransaction: bemoveInsertSalesTransaction,
    bemoveInsertRefund: bemoveInsertRefund,
    bemoveUpdateSalesTransaction: bemoveUpdateSalesTransaction,
    bemoveDeleteSalesTransaction: bemoveDeleteSalesTransaction,
    bemoveGetMemberCumulativePayment: bemoveGetMemberCumulativePayment,
    bemoveIncrementOtLog: bemoveIncrementOtLog,
    bemoveConsumePtSession: bemoveConsumePtSession,
    bemoveUpdatePtSessions: bemoveUpdatePtSessions,
    bemoveListScheduleSlots: bemoveListScheduleSlots,
    bemoveInsertScheduleSlot: bemoveInsertScheduleSlot,
    bemoveDeleteScheduleSlot: bemoveDeleteScheduleSlot,
    bemoveUpdateScheduleSlot: bemoveUpdateScheduleSlot,
    bemoveCompleteScheduleSlot: bemoveCompleteScheduleSlot,
    bemoveRetentionDashboard: bemoveRetentionDashboard,
    bemoveListSatisfactionTargets: bemoveListSatisfactionTargets,
    bemoveSendSatisfactionSurvey: bemoveSendSatisfactionSurvey,
    bemoveListMyPendingSatisfactionSurveys: bemoveListMyPendingSatisfactionSurveys,
    bemoveSubmitSatisfactionSurvey: bemoveSubmitSatisfactionSurvey,
    bemoveListSatisfactionSurveys: bemoveListSatisfactionSurveys,
    bemoveTrainerSalesRanking: bemoveTrainerSalesRanking,
    bemoveListBranchPositionTargets: bemoveListBranchPositionTargets,
    bemoveUpsertBranchPositionTarget: bemoveUpsertBranchPositionTarget,
    bemoveGetTrainerMonthlyGoal: bemoveGetTrainerMonthlyGoal,
    bemoveCreateMemberDietLog: bemoveCreateMemberDietLog,
    bemoveListMemberDietLogs: bemoveListMemberDietLogs,
    bemoveUpdateMemberDietNutrition: bemoveUpdateMemberDietNutrition,
    bemoveAddMemberDietFeedback: bemoveAddMemberDietFeedback,
    bemoveDeleteMemberDietLog: bemoveDeleteMemberDietLog,
    bemoveListMemberDietFeedbacks: bemoveListMemberDietFeedbacks,
    bemoveListMyDietAlerts: bemoveListMyDietAlerts,
    bemoveMarkDietAlertRead: bemoveMarkDietAlertRead,
    bemoveDailyDietKcalSummary: bemoveDailyDietKcalSummary,
    bemoveGetAssignableMembers: bemoveGetAssignableMembers,
    bemoveAssignExistingMember: bemoveAssignExistingMember,
    bemoveAssignMemberTrainer: bemoveAssignMemberTrainer,
    bemoveListBranchEquipments: bemoveListBranchEquipments,
    bemoveCreateBranchEquipment: bemoveCreateBranchEquipment,
    bemoveDeleteBranchEquipment: bemoveDeleteBranchEquipment,
    bemoveCreateBranchEquipmentRequest: bemoveCreateBranchEquipmentRequest,
    bemoveListBranchEquipmentRequests: bemoveListBranchEquipmentRequests,
    bemoveReviewBranchEquipmentRequest: bemoveReviewBranchEquipmentRequest,
    bemoveCreateMemberRegistrationRequest: bemoveCreateMemberRegistrationRequest,
    bemoveClaimMemberRegistrationByEmail: bemoveClaimMemberRegistrationByEmail,
    bemoveGetMemberProfile: bemoveGetMemberProfile,
    bemoveUpsertMemberProfile: bemoveUpsertMemberProfile,
    bemoveListMemberConsultLogs: bemoveListMemberConsultLogs,
    bemoveCreateMemberConsultLog: bemoveCreateMemberConsultLog,
    bemoveListMember555Logs: bemoveListMember555Logs,
    bemoveCreateMember555Log: bemoveCreateMember555Log,
    bemoveCreateMemberHomeworkAssignment: bemoveCreateMemberHomeworkAssignment,
    bemoveListMemberHomeworkAssignments: bemoveListMemberHomeworkAssignments,
    bemoveSetMemberHomeworkCompleted: bemoveSetMemberHomeworkCompleted,
    bemoveCreateMemberSelfWorkout: bemoveCreateMemberSelfWorkout,
    bemoveListMemberSelfWorkouts: bemoveListMemberSelfWorkouts,
    bemoveListMemberInbodyLogs: bemoveListMemberInbodyLogs,
    bemoveCreateMemberInbodyLog: bemoveCreateMemberInbodyLog,
    bemoveGetExercisePrescription: bemoveGetExercisePrescription,
    bemoveGetHomeworkMessage: bemoveGetHomeworkMessage,
    bemoveListMemberOtLogs: bemoveListMemberOtLogs,
    bemoveCreateMemberOtLog: bemoveCreateMemberOtLog,
  };
})();
