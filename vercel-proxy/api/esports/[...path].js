// MATCHDAY e스포츠(LCK) 프록시 — Vercel Serverless Function
// -----------------------------------------------------------------
// PandaScore API(developers.pandascore.co)는 브라우저에서 직접 호출하는 걸
// 막아놨고(CORS 미지원, 토큰도 "클라이언트에서 쓰지 마세요"라고 문서에
// 명시돼 있어요), 그래서 이 프록시가 키를 서버 쪽에서만 붙여서 대신
// 호출해줘요. api-sports.io용으로 썼던 vercel-proxy와 같은 저장소/같은
// Vercel 프로젝트에 그냥 같이 배포하면 돼요 (경로만 /api/esports/... 로 달라요).
//
// ===== 배포 방법 =====
// 1. 이 파일이 포함된 vercel-proxy 폴더 전체를 이미 배포해둔 Vercel
//    프로젝트(예: matchdayvercel.vercel.app)에 다시 push하면 자동 재배포돼요.
//    (새 프로젝트를 만들 필요 없어요, 기존 저장소에 이 파일만 추가하면 돼요.)
// 2. https://developers.pandascore.co 에서 무료 회원가입 → 대시보드에서
//    API 토큰(액세스 토큰) 발급.
// 3. Vercel 프로젝트 → Settings → Environment Variables → Add
//      Key: PANDASCORE_KEY
//      Value: (발급받은 토큰)
//    → Save → Deployments 탭에서 재배포(Redeploy)
// 4. live-data.js 맨 위 ESPORTS_WORKER_BASE 값을 이 Vercel 프로젝트 주소로
//    설정하세요 (WORKER_BASE와 같은 주소를 써도 돼요).
//
// ===== 사용 가능한 경로 =====
//   /api/esports/lol/leagues?search[name]=LCK
//   /api/esports/lol/matches/upcoming?filter[league_id]=123
//   /api/esports/lol/matches/past?filter[league_id]=123
//   /api/esports/lol/matches/running?filter[league_id]=123
// (PandaScore의 실제 경로/쿼리 문법을 그대로 뒤에 붙이면 돼요.)

const PANDASCORE_HOST = "api.pandascore.co";
const CACHE_SECONDS = 300; // 5분 — 경기 일정은 자주 안 바뀌니 너무 짧게 캐시할 필요 없어요.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // Vercel 동적 경로([...path])를 req.query로 읽으면 내부 네이밍이 섞여
  // 들어올 수 있어서, worker/football 프록시와 동일하게 req.url을 직접
  // 파싱해요.
  const fullUrl = new URL(req.url, "http://internal");
  const segments = fullUrl.pathname.split("/").filter(Boolean); // ["api","esports","lol","matches","upcoming"]
  const pathStr = segments.slice(2).join("/"); // "lol/matches/upcoming"

  const qs = new URLSearchParams();
  const droppedKeys = [];
  fullUrl.searchParams.forEach(function (value, key) {
    var lower = key.toLowerCase();
    if (lower === "sport" || lower.indexOf("path") !== -1) {
      droppedKeys.push(key);
      return;
    }
    qs.append(key, value);
  });
  if (droppedKeys.length) {
    console.log("[matchday-esports-proxy] dropped internal query keys:", droppedKeys, "from", req.url);
  }
  const search = qs.toString() ? "?" + qs.toString() : "";

  if (!pathStr) {
    res.status(400).json({ error: "missing_path", hint: "예: /api/esports/lol/matches/upcoming" });
    return;
  }

  if (!process.env.PANDASCORE_KEY) {
    res.status(500).json({
      error: "missing_api_key",
      hint: "Vercel 프로젝트 Settings → Environment Variables에 PANDASCORE_KEY를 추가하고 재배포하세요"
    });
    return;
  }

  const upstreamUrl = `https://${PANDASCORE_HOST}/${pathStr}${search}`;

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      headers: { Authorization: "Bearer " + process.env.PANDASCORE_KEY }
    });
    const body = await upstreamRes.text();

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Cache-Control",
      upstreamRes.ok ? `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=60` : "no-store"
    );
    res.status(upstreamRes.status).send(body);
  } catch (e) {
    res.status(502).json({ error: "upstream_fetch_failed", message: String(e) });
  }
}
