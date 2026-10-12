// 메인 페이지(index.html)에서 배팅방법별 게임 폴더(bcmk.vercel.app/supermartin 등)를 만든다.
//   node sim/build_games.js
// 각 폴더의 index.html 은 index.html 의 복사본이고, 다음만 다르다.
//   - window.BCMK_GAME 에 배팅방법 id 를 넣어, 열리자마자 그 배팅방법의 세팅 화면(1p)으로 들어간다 (배팅방법 선택 화면 생략)
//   - <title>, 다른 페이지로 가는 상대 경로(2/ → ../2/)
// index.html 을 고칠 때마다 이 스크립트를 다시 실행해야 폴더 복사본이 최신으로 유지된다.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const GAMES = [
  { id: "superMartin", slug: "supermartin", name: "슈퍼마틴" },
  { id: "classicMartin", slug: "classicmartin", name: "일반마틴" },
  { id: "paroli", slug: "paroli", name: "파롤리" },
  { id: "system1326", slug: "1326", name: "1-3-2-6" },
  { id: "dalembert", slug: "dalembert", name: "달랑베르" }
];

const src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const anchor = '  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>';
if (!src.includes(anchor)) throw new Error("index.html 에서 Supabase script 태그를 찾지 못했습니다.");
if (!src.includes("<title>바카라 마틴 메이커</title>")) throw new Error("index.html 의 <title> 을 찾지 못했습니다.");
if (!src.includes('href="2/"')) throw new Error('index.html 에서 href="2/" 를 찾지 못했습니다.');
if (!src.includes('href="play/"')) throw new Error('index.html 에서 href="play/" 를 찾지 못했습니다.');

for (const g of GAMES) {
  let html = src;
  html = html.replace(anchor, () => `  <script>window.BCMK_GAME = ${JSON.stringify(g.id)};</script>\n${anchor}`);
  html = html.replace("<title>바카라 마틴 메이커</title>", () => `<title>바카라 마틴 메이커 · ${g.name}</title>`);
  html = html.split('href="2/"').join('href="../2/"').split('href="play/"').join('href="../play/"');
  const dir = path.join(ROOT, g.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html);
  console.log(`${g.slug}/index.html (${g.name})`);
}
