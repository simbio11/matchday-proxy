// MATCHDAY API 프록시 — Vercel Serverless Function
// -----------------------------------------------------------------
// worker.js(Cloudflare Workers)와 완전히 같은 역할을 해요: api-sports.io
// 키를 서버 쪽에서만 붙여서 숨기고, 응답을 잠깐 캐시해줘요.
//
// Cloudflare Workers 대신 이걸 쓰는 이유: Cloudflare Workers는 전 세계
// 수많은 사용자와 아웃바운드 IP를 공유하는데, api-sports.io 쪽에서 그 IP
// 대역 자체를 이미 많이 두드려진 걸로 보고 막아버리는 문제가 확인됐어요.
// Vercel은 다른 인프라(주로 AWS)를 쓰기 때문에 이 문제를 피할 수 있어요.
//
// ===== 배포 방법 =====
// 1. 이 vercel-proxy 폴더 전체를 새 GitHub 저장소의 "루트"에 올려주세요.
//    (사이트 저장소와 분리된 별도 저장소를 새로 만드는 걸 추천해요.)
// 2. https://vercel.com 무료 가입 (GitHub 계정으로 로그인 가능) →
//    "Add New..." → "Project" → 방금 만든 저장소를 Import → Deploy
//    (설정 건드릴 것 없이 그대로 Deploy 누르면 돼요, api/ 폴더는 자동 인식돼요.)
// 3. 배포된 프로젝트의 Settings → Environment Variables → Add
//      Key: API_SPORTS_KEY
//      Value: (api-sports.io 대시보드에서 발급받은 키)
//      → Save
// 4. Deployments 탭에서 최신 배포 옆 "..." → Redeploy (환경변수를 반영하려면
//    재배포가 필요해요)
// 5. 프로젝트 상단에 보이는 https://<프로젝트이름>.vercel.app 주소를
//    live-data.js 맨 위 WORKER_BASE 값에 넣어주세요.
//
// ===== 사용 가능한 경로 (worker.js와 동일) =====
//   /api/football/fixtures?date=2026-09-14&league=292&season=2026
//   /api/baseball/games?date=2026-09-14&league=5&season=2026
//   /api/basketball/games?date=2026-09-14&league=91&season=2026-2027
//   /api/volleyball/games?date=2026-09-14&league=151&season=2026
//   /api/mma/fights?date=2026-09-14

const UPSTREAM_HOSTS = {
  football: "v3.football.api-sports.io",
  baseball: "v1.baseball.api-sports.io",
  basketball: "v1.basketball.api-sports.io",
  volleyball: "v1.volleyball.api-sports.io",
  mma: "v1.mma.api-sports.io"
};

const CACHE_SECONDS = 900; // 15분 — Vercel 엣지 네트워크가 이 헤더를 보고 캐시해줘요.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const sport = req.query.sport;
  const pathParts = req.query.path; // catch-all이라 배열로 들어와요
  const host = UPSTREAM_HOSTS[sport];

  if (!host) {
    res.status(400).json({ error: "unknown_sport", allowed: Object.keys(UPSTREAM_HOSTS) });
    return;
  }

  if (!process.env.API_SPORTS_KEY) {
    res.status(500).json({
      error: "missing_api_key",
      hint: "Vercel 프로젝트 Settings → Environment Variables에 API_SPORTS_KEY를 추가하고 재배포하세요"
    });
    return;
  }

  const pathStr = Array.isArray(pathParts) ? pathParts.join("/") : (pathParts || "");

  // sport, path를 제외한 나머지 쿼리 파라미터를 그대로 상위 API에 전달해요.
  const qs = new URLSearchParams();
  for (const key of Object.keys(req.query)) {
    if (key === "sport" || key === "path") continue;
    const val = req.query[key];
    if (Array.isArray(val)) val.forEach((v) => qs.append(key, v));
    else qs.append(key, val);
  }

  const upstreamUrl = `https://${host}/${pathStr}${qs.toString() ? "?" + qs.toString() : ""}`;

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      headers: { "x-apisports-key": process.env.API_SPORTS_KEY }
    });
    const body = await upstreamRes.text();

    // api-sports.io는 요청 제한/오류가 나도 HTTP 상태코드는 200으로 주고
    // JSON 안의 "errors" 필드에만 표시해요. 이런 응답을 캐시해버리면 한 번
    // 실패했을 때 그 실패가 한참 동안 재사용되는 문제가 생기니, 정상
    // 응답일 때만 캐시되게 해요.
    let hasError = false;
    try {
      const parsed = JSON.parse(body);
      const errs = parsed && parsed.errors;
      if (errs && (Array.isArray(errs) ? errs.length > 0 : Object.keys(errs).length > 0)) {
        hasError = true;
      }
    } catch (e) {
      hasError = true;
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Cache-Control",
      hasError ? "no-store" : `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=60`
    );
    res.status(upstreamRes.status).send(body);
  } catch (e) {
    res.status(502).json({ error: "upstream_fetch_failed", message: String(e) });
  }
}
