# FormulaX Phase2 성능/회귀 체크리스트

## 1) 측정 조건 통일
- 브라우저 캐시 비활성 + 시크릿 모드 1회, 일반 모드 1회 측정
- 동일 계정/동일 지점 셋/동일 월(YYYY-MM)로 비교
- 측정 대상 탭: `place`, `sales_target`, `activity`, `goal_achievement`

## 2) 프론트 로그 확인 항목
브라우저 콘솔에서 `[FormulaX][perf]` 로그를 확인하고 아래를 기록합니다.
- `load_ms`
- `request_count`
- `cache_hit_ratio`
- `branch_count`

권장 기록 포맷:

| 탭 | 역할 | branch_count | 1차 진입 load_ms | 2차 진입 load_ms | 1차 request_count | 2차 request_count | 2차 cache_hit_ratio |
|---|---|---:|---:|---:|---:|---:|---:|
| place | super | 10 |  |  |  |  |  |
| sales_target | brand | 5 |  |  |  |  |  |
| activity | branch | 1 |  |  |  |  |  |
| goal_achievement | super | 10 |  |  |  |  |  |

## 3) DB 실행계획(필수)
아래 SQL을 Supabase SQL Editor에서 `EXPLAIN (ANALYZE, BUFFERS)`로 실행합니다.

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM public.get_sales_records_for_dashboard_dedup(
  ARRAY['00000000-0000-0000-0000-000000000000'::uuid],
  DATE '2026-02-01',
  DATE '2026-02-29',
  false
);
```

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT public.get_sales_aggregated_for_dashboard_dedup(
  ARRAY['00000000-0000-0000-0000-000000000000'::uuid],
  DATE '2026-02-01',
  DATE '2026-02-29',
  false
);
```

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, status, branch_id, requested_at
FROM public.expense_requests
WHERE branch_id = '00000000-0000-0000-0000-000000000000'::uuid
ORDER BY requested_at DESC
LIMIT 50;
```

## 4) 역할별 회귀 시나리오
- `super`: 전체 통합/지점그룹 전환 시 탭 데이터 정상, 중복합산 없음
- `brand`: 본인 브랜드 지점만 조회, 목표/달성율 수치 정상
- `branch`: 본인 관리 지점만 조회, 활동 실적 저장 후 즉시 반영
- `brand_accounting`: 지출 탭 접근 시 기존 권한 흐름 정상
- `fc`: 활동 탭 접근 및 조회 정상(불필요 탭 노출 없음)

## 5) 프리패치 검증
- `sales_target` 또는 `goal_achievement` 진입 직후 동일 월 탭 간 전환
- 기대값: 2번째 탭의 `request_count` 감소, `cache_hit_ratio` 상승

## 6) 저장 후 invalidate 검증
- 목표 매출 수정(주차 목표 저장) 후 동일 월 재진입
- 활동 실적 수정 후 목표 달성율 재확인
- 기대값: 변경값 반영 + stale 캐시 미노출
