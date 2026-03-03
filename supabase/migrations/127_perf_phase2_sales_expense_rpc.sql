-- ============================================================
-- Phase 2 performance tuning: sales/expense_requests
-- - Index reinforcement for frequent sorting/filtering
-- - Dedup sales RPC date predicate made index-friendly
-- - Dedup aggregate RPC pipeline unified (single base/ranked/dedup)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_sales_records_payment_date
  ON public.sales_records(payment_date);

CREATE INDEX IF NOT EXISTS idx_expense_requests_branch_requested_desc
  ON public.expense_requests(branch_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_expense_requests_status_requested_desc
  ON public.expense_requests(status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_expense_requests_actionable_requested_desc
  ON public.expense_requests(requested_at DESC)
  WHERE status IN ('fc_draft', 'pending_approval', 'approved', 'rejected');

CREATE OR REPLACE FUNCTION public.get_sales_records_for_dashboard_dedup(
  p_branch_ids uuid[],
  p_from date,
  p_to date,
  p_merge_same_name boolean DEFAULT false
)
RETURNS TABLE (
  branch_id uuid,
  payment_date timestamptz,
  amount int,
  product_type text,
  customer_type text,
  member_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  allowed_ids uuid[];
  requested_ids uuid[];
  has_requested boolean;
  my_role text;
  my_brand_id uuid;
  my_branch_ids uuid[];
BEGIN
  requested_ids := COALESCE(p_branch_ids, ARRAY[]::uuid[]);
  has_requested := COALESCE(array_length(requested_ids, 1), 0) > 0;
  my_role := public.get_my_role();
  my_brand_id := public.get_my_brand_id();
  my_branch_ids := public.get_my_branch_ids();

  IF my_role = 'super' THEN
    IF has_requested THEN
      allowed_ids := requested_ids;
    ELSE
      SELECT array_agg(b.id) INTO allowed_ids FROM public.branches b;
    END IF;
  ELSIF my_role = 'brand' THEN
    IF has_requested THEN
      SELECT array_agg(b.id) INTO allowed_ids
      FROM public.branches b
      WHERE b.brand_id = my_brand_id
        AND b.id = ANY(requested_ids);
    ELSE
      SELECT array_agg(b.id) INTO allowed_ids
      FROM public.branches b
      WHERE b.brand_id = my_brand_id;
    END IF;
    allowed_ids := COALESCE(allowed_ids, ARRAY[]::uuid[]);
  ELSIF my_role = 'branch' THEN
    IF NOT has_requested THEN
      allowed_ids := COALESCE(my_branch_ids, ARRAY[]::uuid[]);
    ELSE
      SELECT array_agg(x.id) INTO allowed_ids
      FROM unnest(COALESCE(my_branch_ids, ARRAY[]::uuid[])) AS x(id)
      WHERE x.id = ANY(requested_ids);
      allowed_ids := COALESCE(allowed_ids, ARRAY[]::uuid[]);
    END IF;
  ELSE
    allowed_ids := ARRAY[]::uuid[];
  END IF;

  IF array_length(allowed_ids, 1) IS NULL OR array_length(allowed_ids, 1) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      sr.id,
      sr.branch_id,
      sr.payment_date,
      sr.amount,
      sr.product_type,
      sr.customer_type,
      sr.member_name,
      sr.product_name,
      sr.created_at,
      regexp_replace(
        regexp_replace(lower(trim(coalesce(b.name, ''))), '[^0-9a-z가-힣]+', '', 'g'),
        '(지점|점)$',
        '',
        'g'
      ) AS branch_group_key
    FROM public.sales_records sr
    JOIN public.branches b ON b.id = sr.branch_id
    WHERE sr.branch_id = ANY(allowed_ids)
      AND sr.payment_date >= (p_from::timestamptz)
      AND sr.payment_date < ((p_to::timestamptz) + interval '1 day')
  ),
  ranked AS (
    SELECT
      base.branch_id,
      base.payment_date,
      base.amount,
      base.product_type,
      base.customer_type,
      base.member_name,
      row_number() OVER (
        PARTITION BY
          (CASE WHEN p_merge_same_name THEN base.branch_group_key ELSE base.branch_id::text END),
          (base.payment_date AT TIME ZONE 'UTC')::date,
          lower(trim(coalesce(base.product_name, ''))),
          base.amount,
          upper(trim(coalesce(base.product_type, ''))),
          lower(trim(coalesce(base.member_name, '')))
        ORDER BY base.created_at DESC NULLS LAST, base.id DESC
      ) AS rn
    FROM base
  )
  SELECT
    ranked.branch_id,
    ranked.payment_date,
    ranked.amount,
    ranked.product_type,
    ranked.customer_type,
    ranked.member_name
  FROM ranked
  WHERE ranked.rn = 1
  ORDER BY ranked.payment_date ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_sales_aggregated_for_dashboard_dedup(
  p_branch_ids uuid[],
  p_from date,
  p_to date,
  p_merge_same_name boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  allowed_ids uuid[];
  requested_ids uuid[];
  has_requested boolean;
  my_role text;
  my_brand_id uuid;
  my_branch_ids uuid[];
  result jsonb;
BEGIN
  requested_ids := COALESCE(p_branch_ids, ARRAY[]::uuid[]);
  has_requested := COALESCE(array_length(requested_ids, 1), 0) > 0;
  my_role := public.get_my_role();
  my_brand_id := public.get_my_brand_id();
  my_branch_ids := public.get_my_branch_ids();

  IF my_role = 'super' THEN
    IF has_requested THEN
      allowed_ids := requested_ids;
    ELSE
      SELECT array_agg(b.id) INTO allowed_ids FROM public.branches b;
    END IF;
  ELSIF my_role = 'brand' THEN
    IF has_requested THEN
      SELECT array_agg(b.id) INTO allowed_ids
      FROM public.branches b
      WHERE b.brand_id = my_brand_id
        AND b.id = ANY(requested_ids);
    ELSE
      SELECT array_agg(b.id) INTO allowed_ids
      FROM public.branches b
      WHERE b.brand_id = my_brand_id;
    END IF;
    allowed_ids := COALESCE(allowed_ids, ARRAY[]::uuid[]);
  ELSIF my_role = 'branch' THEN
    IF NOT has_requested THEN
      allowed_ids := COALESCE(my_branch_ids, ARRAY[]::uuid[]);
    ELSE
      SELECT array_agg(x.id) INTO allowed_ids
      FROM unnest(COALESCE(my_branch_ids, ARRAY[]::uuid[])) AS x(id)
      WHERE x.id = ANY(requested_ids);
      allowed_ids := COALESCE(allowed_ids, ARRAY[]::uuid[]);
    END IF;
  ELSE
    allowed_ids := ARRAY[]::uuid[];
  END IF;

  IF array_length(allowed_ids, 1) IS NULL OR array_length(allowed_ids, 1) = 0 THEN
    RETURN jsonb_build_object('weekly', '[]'::jsonb, 'monthly', '[]'::jsonb);
  END IF;

  WITH base AS (
    SELECT
      sr.id,
      sr.branch_id,
      sr.payment_date,
      sr.amount,
      sr.product_name,
      sr.product_type,
      sr.customer_type,
      sr.member_name,
      sr.created_at,
      regexp_replace(
        regexp_replace(lower(trim(coalesce(b.name, ''))), '[^0-9a-z가-힣]+', '', 'g'),
        '(지점|점)$',
        '',
        'g'
      ) AS branch_group_key
    FROM public.sales_records sr
    JOIN public.branches b ON b.id = sr.branch_id
    WHERE sr.branch_id = ANY(allowed_ids)
      AND sr.payment_date >= (p_from::timestamptz)
      AND sr.payment_date < ((p_to::timestamptz) + interval '1 day')
  ),
  ranked AS (
    SELECT
      base.*,
      row_number() OVER (
        PARTITION BY
          (CASE WHEN p_merge_same_name THEN base.branch_group_key ELSE base.branch_id::text END),
          (base.payment_date AT TIME ZONE 'UTC')::date,
          lower(trim(coalesce(base.product_name, ''))),
          base.amount,
          upper(trim(coalesce(base.product_type, ''))),
          lower(trim(coalesce(base.member_name, '')))
        ORDER BY base.created_at DESC NULLS LAST, base.id DESC
      ) AS rn
    FROM base
  ),
  dedup AS (
    SELECT
      branch_id,
      payment_date,
      amount,
      product_type,
      customer_type,
      member_name
    FROM ranked
    WHERE rn = 1
  ),
  weekly AS (
    SELECT
      to_char(week_start, 'YYYY-MM-DD') || ' ~ ' || to_char(week_start + 6, 'YYYY-MM-DD') AS period,
      sum(amount)::bigint AS "매출",
      sum(CASE WHEN upper(trim(coalesce(product_type, ''))) = 'PT' THEN amount ELSE 0 END)::bigint AS "PT",
      sum(CASE WHEN upper(trim(coalesce(product_type, ''))) != 'PT' THEN amount ELSE 0 END)::bigint AS "FC",
      sum(CASE WHEN lower(trim(coalesce(customer_type, ''))) IN ('new', '신규') THEN amount ELSE 0 END)::bigint AS "신규",
      sum(CASE WHEN lower(trim(coalesce(customer_type, ''))) IN ('re', '재등록') THEN amount ELSE 0 END)::bigint AS "재등록",
      count(DISTINCT nullif(trim(member_name), ''))::int AS "회원수",
      count(DISTINCT CASE WHEN upper(trim(coalesce(product_type, ''))) != 'PT' THEN nullif(trim(member_name), '') END)::int AS "FC회원수",
      count(DISTINCT CASE WHEN upper(trim(coalesce(product_type, ''))) = 'PT' THEN nullif(trim(member_name), '') END)::int AS "PT회원수",
      count(DISTINCT CASE WHEN lower(trim(coalesce(customer_type, ''))) IN ('new', '신규') THEN nullif(trim(member_name), '') END)::int AS "신규회원수",
      count(DISTINCT CASE WHEN lower(trim(coalesce(customer_type, ''))) IN ('re', '재등록') THEN nullif(trim(member_name), '') END)::int AS "재등록회원수",
      count(DISTINCT CASE WHEN upper(trim(coalesce(product_type, ''))) != 'PT' AND lower(trim(coalesce(customer_type, ''))) IN ('new', '신규') THEN nullif(trim(member_name), '') END)::int AS "FC신규회원수",
      count(DISTINCT CASE WHEN upper(trim(coalesce(product_type, ''))) != 'PT' AND lower(trim(coalesce(customer_type, ''))) IN ('re', '재등록') THEN nullif(trim(member_name), '') END)::int AS "FC재등록회원수",
      count(DISTINCT CASE WHEN upper(trim(coalesce(product_type, ''))) = 'PT' AND lower(trim(coalesce(customer_type, ''))) IN ('new', '신규') THEN nullif(trim(member_name), '') END)::int AS "PT신규회원수",
      count(DISTINCT CASE WHEN upper(trim(coalesce(product_type, ''))) = 'PT' AND lower(trim(coalesce(customer_type, ''))) IN ('re', '재등록') THEN nullif(trim(member_name), '') END)::int AS "PT재등록회원수",
      (
        sum(CASE WHEN upper(trim(coalesce(product_type, ''))) = 'PT' THEN amount ELSE 0 END)
        / greatest(
          nullif(
            count(DISTINCT CASE WHEN upper(trim(coalesce(product_type, ''))) = 'PT' AND nullif(trim(member_name), '') IS NOT NULL THEN member_name END),
            0
          ),
          1
        )
      )::int AS "PT객단가",
      (
        sum(CASE WHEN upper(trim(coalesce(product_type, ''))) != 'PT' THEN amount ELSE 0 END)
        / greatest(
          nullif(
            count(DISTINCT CASE WHEN upper(trim(coalesce(product_type, ''))) != 'PT' AND nullif(trim(member_name), '') IS NOT NULL THEN member_name END),
            0
          ),
          1
        )
      )::int AS "FC객단가"
    FROM (
      SELECT
        (d.payment_date::date - (EXTRACT(ISODOW FROM d.payment_date::date)::int - 1) * interval '1 day')::date AS week_start,
        d.amount,
        d.product_type,
        d.customer_type,
        d.member_name
      FROM dedup d
    ) t
    GROUP BY week_start
  ),
  monthly AS (
    SELECT
      to_char(d.payment_date::date, 'YYYY-MM') AS period,
      sum(d.amount)::bigint AS "매출",
      sum(CASE WHEN upper(trim(coalesce(d.product_type, ''))) = 'PT' THEN d.amount ELSE 0 END)::bigint AS "PT",
      sum(CASE WHEN upper(trim(coalesce(d.product_type, ''))) != 'PT' THEN d.amount ELSE 0 END)::bigint AS "FC",
      sum(CASE WHEN lower(trim(coalesce(d.customer_type, ''))) IN ('new', '신규') THEN d.amount ELSE 0 END)::bigint AS "신규",
      sum(CASE WHEN lower(trim(coalesce(d.customer_type, ''))) IN ('re', '재등록') THEN d.amount ELSE 0 END)::bigint AS "재등록",
      count(DISTINCT nullif(trim(d.member_name), ''))::int AS "회원수",
      count(DISTINCT CASE WHEN upper(trim(coalesce(d.product_type, ''))) != 'PT' THEN nullif(trim(d.member_name), '') END)::int AS "FC회원수",
      count(DISTINCT CASE WHEN upper(trim(coalesce(d.product_type, ''))) = 'PT' THEN nullif(trim(d.member_name), '') END)::int AS "PT회원수",
      count(DISTINCT CASE WHEN lower(trim(coalesce(d.customer_type, ''))) IN ('new', '신규') THEN nullif(trim(d.member_name), '') END)::int AS "신규회원수",
      count(DISTINCT CASE WHEN lower(trim(coalesce(d.customer_type, ''))) IN ('re', '재등록') THEN nullif(trim(d.member_name), '') END)::int AS "재등록회원수",
      count(DISTINCT CASE WHEN upper(trim(coalesce(d.product_type, ''))) != 'PT' AND lower(trim(coalesce(d.customer_type, ''))) IN ('new', '신규') THEN nullif(trim(d.member_name), '') END)::int AS "FC신규회원수",
      count(DISTINCT CASE WHEN upper(trim(coalesce(d.product_type, ''))) != 'PT' AND lower(trim(coalesce(d.customer_type, ''))) IN ('re', '재등록') THEN nullif(trim(d.member_name), '') END)::int AS "FC재등록회원수",
      count(DISTINCT CASE WHEN upper(trim(coalesce(d.product_type, ''))) = 'PT' AND lower(trim(coalesce(d.customer_type, ''))) IN ('new', '신규') THEN nullif(trim(d.member_name), '') END)::int AS "PT신규회원수",
      count(DISTINCT CASE WHEN upper(trim(coalesce(d.product_type, ''))) = 'PT' AND lower(trim(coalesce(d.customer_type, ''))) IN ('re', '재등록') THEN nullif(trim(d.member_name), '') END)::int AS "PT재등록회원수",
      (
        sum(CASE WHEN upper(trim(coalesce(d.product_type, ''))) = 'PT' THEN d.amount ELSE 0 END)
        / greatest(
          nullif(
            count(DISTINCT CASE WHEN upper(trim(coalesce(d.product_type, ''))) = 'PT' AND nullif(trim(d.member_name), '') IS NOT NULL THEN d.member_name END),
            0
          ),
          1
        )
      )::int AS "PT객단가",
      (
        sum(CASE WHEN upper(trim(coalesce(d.product_type, ''))) != 'PT' THEN d.amount ELSE 0 END)
        / greatest(
          nullif(
            count(DISTINCT CASE WHEN upper(trim(coalesce(d.product_type, ''))) != 'PT' AND nullif(trim(d.member_name), '') IS NOT NULL THEN d.member_name END),
            0
          ),
          1
        )
      )::int AS "FC객단가"
    FROM dedup d
    GROUP BY to_char(d.payment_date::date, 'YYYY-MM')
  )
  SELECT jsonb_build_object(
    'weekly', COALESCE((SELECT jsonb_agg(w ORDER BY w.period) FROM weekly w), '[]'::jsonb),
    'monthly', COALESCE((SELECT jsonb_agg(m ORDER BY m.period) FROM monthly m), '[]'::jsonb)
  )
  INTO result;

  RETURN COALESCE(result, jsonb_build_object('weekly', '[]'::jsonb, 'monthly', '[]'::jsonb));
END;
$$;

COMMENT ON FUNCTION public.get_sales_records_for_dashboard_dedup(uuid[], date, date, boolean)
IS 'Deduplicated sales records (phase2). Date range predicate uses timestamptz bounds for better index usage.';

COMMENT ON FUNCTION public.get_sales_aggregated_for_dashboard_dedup(uuid[], date, date, boolean)
IS 'Deduplicated weekly/monthly aggregates (phase2). Single dedup pipeline and index-friendly date predicate.';
