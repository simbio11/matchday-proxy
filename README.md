# MATCHDAY API 프록시 (Vercel Serverless Functions)

MATCHDAY 사이트(`simbio11.github.io/matchday-site`)의 실시간 데이터 연동용 **키 숨김 중계 서버**입니다.
api-sports.io 는 API 키를 요구하는데, 키를 브라우저(`index.html`)에 넣으면 개발자도구로 노출됩니다.
그래서 이 함수가 서버 쪽에서만 키를 붙여 대신 호출해 줍니다.

```
브라우저(사이트) ──▶ 이 프록시(Vercel) ──▶ api-sports.io (축구·야구·농구·배구·MMA)
              └──▶ OpenF1 (F1, 키 불필요 — 프록시 없이 직접 호출)
```

> Cloudflare Workers(`worker.js`)에서 옮겨온 이유: Cloudflare 공유 아웃바운드 IP 대역이
> api-sports.io 쪽에서 이미 rate-limit 으로 막혀 있었습니다. Vercel(AWS 인프라)은 이 문제를 피해갑니다.

## 배포 (5단계)

1. **Vercel 가입** — <https://vercel.com> → `Continue with GitHub` (무료)
2. **Import** — `Add New...` → `Project` → 이 저장소(`matchday-proxy`) 선택 → 설정 그대로 `Deploy`
   (루트의 `api/` 폴더는 자동 인식됩니다)
3. **환경변수** — 프로젝트 → `Settings` → `Environment Variables` → `Add`
   | Key | Value |
   |---|---|
   | `API_SPORTS_KEY` | api-sports.io 대시보드에서 발급받은 키 |
4. **재배포** — `Deployments` → 최신 배포 옆 `...` → `Redeploy` (환경변수 반영에 필요)
5. **주소 확인** — 프로젝트 상단 `https://<프로젝트이름>.vercel.app` →
   사이트 저장소의 `live-data.js` 상단 `WORKER_BASE` 에 넣기

## 경로 (사용법)

```
GET /api/football/fixtures?date=2026-09-14&league=292&season=2026
GET /api/baseball/games?date=2026-09-14&league=5&season=2026
GET /api/basketball/games?date=2026-09-14&league=91&season=2026-2027
GET /api/volleyball/games?date=2026-09-14&league=151&season=2026
GET /api/mma/fights?date=2026-09-14
```

- `sport` 를 제외한 모든 쿼리 파라미터는 상위 API 로 그대로 전달됩니다.
- 응답은 **정상 응답일 때만** 15분 캐시(`s-maxage=900`) — 실패 응답은 캐시하지 않습니다
  (api-sports.io 는 오류도 HTTP 200 + `errors` 필드로 주기 때문).
- `API_SPORTS_KEY` 가 없으면 `500 missing_api_key` 를 돌려주고 힌트를 함께 표시합니다.

## 확인 방법

```bash
curl "https://<프로젝트이름>.vercel.app/api/football/fixtures?date=2026-09-14&league=292&season=2026"
```

키가 없거나 틀리면 `{"errors": {...}}` 가 그대로 보입니다(프록시는 응답을 그대로 전달).
