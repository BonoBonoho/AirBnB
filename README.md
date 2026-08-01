# 스테이프라이스 (StayPrice)

PriceLabs(pricelabs.co) 스타일의 **한국형 숙소 수익 관리 · 다이나믹 프라이싱** 웹앱 MVP입니다.
에어비앤비 호스트가 여러 숙소의 날짜별 가격을 자동으로 산정하고 관리할 수 있습니다.

## 실행 방법

```bash
npm install
npm run dev      # 로컬 개발 서버 (http://localhost:5173) — 실제 배포 API에 연결
npm run build    # 프로덕션 빌드
```

### 로컬 개발 = 실제 클라우드에 붙어 미리보기

`npm run dev`를 실행하면 배포된 사이트(`stayprice.co`)의 `config.json`을
자동으로 받아 `public/config.json`에 저장하고, **로컬 화면이 실제 AWS API·
로그인·데이터에 그대로 연결**됩니다. 코드를 고치면 배포(약 10분)를 기다릴
필요 없이 즉시 브라우저에 반영돼요. (config.json의 apiUrl·Cognito ID는 비밀이
아니라 어차피 배포 사이트에 공개되는 값이며, `public/config.json`은 git에
커밋되지 않습니다.)

- **설정 강제 갱신**: `FORCE_CONFIG=1 npm run dev`
- **다른 환경 보기**: `CONFIG_URL=https://다른도메인/config.json npm run dev`
- **데모 모드(클라우드 없이 목업 데이터)**: `public/config.json`을 지우고
  `npm run dev:demo` — 브라우저 localStorage만 사용
- 로컬에서 로그인은 배포와 동일한 계정으로 하면 됩니다 (Cognito는 모든
  출처를 허용, API의 CORS도 `*`라 localhost에서 바로 접속됨).

프로덕션 배포는 그대로 GitHub Actions → AWS(CDK)이며, 배포 시 CDK가
config.json을 실제 값으로 새로 생성해 올리므로 로컬 파일과 무관합니다.

## 주요 기능

| 페이지 | 기능 |
|---|---|
| 📊 대시보드 | 향후 30일 예상 매출·점유율·ADR, 주간 매출 추이 차트, 다가오는 예약, 다음 연휴 D-day 알림 |
| 📅 가격 캘린더 | 날짜별 자동 추천가 표시, 날짜 클릭 시 가격 산정 근거 확인, 수동 가격 지정/해제 |
| 🏠 숙소 관리 | 다중 숙소 목록, 활성/비활성 토글, 숙소별 점유율 요약 |
| ⚙️ 가격 규칙 | 기본가·최저가·최고가, 주말/공휴일/성수기 할증, 임박/연박/조기예약 할인 슬라이더 |
| 📈 시장 분석 | 지역 경쟁 숙소 대비 내 가격·점유율 포지션 비교 (데모 데이터) |
| 🔗 채널 연동 | 에어비앤비·야놀자·여기어때·Booking.com 연동 상태 관리 (시뮬레이션) |

## 한국형 가격 엔진 (`src/lib/pricing.ts`)

- **한국 공휴일 반영**: 설날·추석·어린이날 등 2026~2027년 공휴일(대체공휴일 포함)에 할증 자동 적용
- **징검다리 연휴**: 공휴일 사이에 낀 평일에 절반 할증 적용
- **성수기**: 7~8월, 12월 하순 자동 할증
- **주말 할증**: 금·토요일
- **수요 점수**: 숙소·날짜별 수요 점수(0~100)에 따라 ±10% 미세 조정 (현재는 결정적 목업, 실서비스에서는 검색량·예약 페이스 데이터로 대체)
- **임박 할인**: 7일 이내 빈 날짜에 자동 할인으로 공실 최소화
- 모든 가격은 최저~최고가 범위로 제한 후 천원 단위 반올림

## 기술 스택

- **프론트엔드**: Vite + React 19 + TypeScript + Tailwind CSS v4 + Recharts
- **백엔드 (AWS, `infra/`)**: CDK(TypeScript)로 정의
  - **Cognito** — 이메일 회원가입/로그인
  - **API Gateway(HTTP API) + Lambda** — 상태 저장/조회, iCal 동기화 API (Cognito JWT 인증)
  - **DynamoDB** — 사용자별 숙소/가격규칙/수동가격/예약 저장
  - **EventBridge** — 6시간마다 전체 사용자 iCal 자동 동기화
  - **S3 + CloudFront** — 프론트엔드 정적 호스팅
- **동작 모드**: 배포된 사이트는 `/config.json`을 읽어 **클라우드 모드**(로그인 + 서버 저장)로,
  로컬 개발(`npm run dev`)은 config가 없으므로 **데모 모드**(localStorage + 목업)로 동작

## 에어비앤비 실제 예약 연동 (iCal)

1. 에어비앤비 호스트 → 달력 → 가용성 → **캘린더 연결 → 캘린더 내보내기**에서 iCal 주소 복사
2. 스테이프라이스 **채널 연동** 페이지에서 숙소별 iCal URL 입력
3. "지금 동기화" 클릭 (이후 6시간마다 자동 동기화) → 실제 예약이 캘린더/대시보드에 표시
   - iCal에는 금액 정보가 없으므로 매출은 추천가 기준 추정치

## AWS 배포 방법

### A. GitHub Actions 자동 배포 (권장)

1. AWS IAM에서 배포용 사용자 생성 (권한: `AdministratorAccess` 또는 CDK 배포 최소 권한)
2. GitHub 저장소 → Settings → Secrets and variables → Actions 에 등록:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
3. `main` 브랜치에 push → `.github/workflows/deploy.yml`이 자동 실행
4. Actions 로그의 `StayPrice.SiteUrl` 출력이 서비스 주소 (CloudFront)

### 커스텀 도메인 연결

기본 도메인은 `stayprice.co`로 설정되어 있다 (`infra/bin/infra.ts`).
Route 53에 해당 도메인의 호스팅 영역이 있어야 하며(Route 53에서 구매 시 자동 생성),
배포하면 ACM 인증서(us-east-1) 발급·검증, CloudFront 연결, A/AAAA 레코드(apex + www),
정산 메일 수신 도메인(`in.stayprice.co`)까지 자동 구성된다.

- 다른 도메인 사용: 저장소 변수 또는 환경변수 `DOMAIN_NAME`으로 덮어쓰기
- 도메인 없이 배포: `DOMAIN_NAME`을 빈 문자열로 설정

### B. 로컬에서 직접 배포

```bash
npm ci && npm run build          # 프론트엔드 빌드 (dist/)
cd infra && npm ci
npx cdk bootstrap                # 계정/리전 최초 1회
npx cdk deploy StayPrice         # 배포 (리전: ap-northeast-2)
```

## 다음 단계 (로드맵)

1. 야놀자·여기어때 파트너 API 연동 (가격 내보내기)
2. 실제 시장 데이터 수집(경쟁 숙소 크롤링/데이터 제휴) 기반 수요 점수
3. 가격 변경 이력·수익 리포트, 알림(카카오톡/이메일)
4. 숙소 추가/삭제 UI, 커스텀 도메인(Route 53 + ACM)
