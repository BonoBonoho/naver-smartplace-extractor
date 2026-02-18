# 네이버 스마트플레이스 통계 추출기

스마트플레이스 관리자 화면에서 통계 데이터를 추출하고, CSV로 저장·시각화하는 Chrome 확장 프로그램입니다.

## 사용 방법

1. **Chrome에 확장 프로그램 설치**
   - Chrome 주소창에 `chrome://extensions/` 입력
   - 우측 상단 "개발자 모드" 활성화
   - "압축해제된 확장 프로그램을 로드합니다" 클릭
   - 이 폴더(`naver-smartplace-extractor`) 선택

2. **데이터 추출**
   - [네이버 스마트플레이스](https://new.smartplace.naver.com) 관리자 페이지에 로그인
   - 통계 페이지로 이동
   - 화면 오른쪽 하단의 **"📊 통계 추출"** 버튼 클릭

3. **데이터 저장 및 시각화**
   - 확장 프로그램 아이콘 클릭
   - **CSV 다운로드**: 엑셀에서 열 수 있는 CSV 파일 저장
   - **시각화 보기**: 차트와 표로 데이터 확인

## 기능

- 테이블 데이터 자동 추출
- 통계 카드/숫자 블록 인식
- CSV 다운로드 (엑셀 호환, UTF-8 BOM)
- 차트 시각화 (막대/선 그래프)

## 지원 페이지

- `*.smartplace.naver.com` 전체

## 파일 구조

```
naver-smartplace-extractor/
├── manifest.json    # 확장 프로그램 설정
├── content.js       # 페이지 데이터 추출 스크립트
├── content.css      # 추출 버튼 스타일
├── popup.html       # 팝업 UI
├── popup.js         # 팝업 로직
├── popup.css        # 팝업 스타일
├── visualize.html   # 시각화 페이지
├── visualize.js     # 차트 및 표 렌더링
└── README.md
```

## Google 로그인 (Formula X Cloud 연동 시)

이 확장은 **고정 익스텐션 ID**를 사용하므로, PC/설치 경로가 바뀌어도 OAuth 리다이렉트 URL이 동일합니다.

- **Supabase Dashboard** → Authentication → URL Configuration → **Redirect URLs**에 아래 주소를 **한 번만** 추가하면 됩니다.
- `https://mnccfaleabjompchmpfbkgjnoaekahpj.chromiumapp.org/`

다른 PC에서 이 폴더를 로드해도 위 URL이 그대로 유지되므로 Redirect URLs를 다시 수정할 필요 없습니다.

## 참고

- 로그인 후 본인 사업장의 통계 페이지에서만 사용해 주세요.
- 네이버 서비스 구조 변경 시 추출이 제대로 되지 않을 수 있습니다.
