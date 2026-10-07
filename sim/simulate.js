// 자동 배팅법 선택 페이지(2/index.html)용 확률 데이터 생성기.
//   node sim/simulate.js [runs=10000000] [out=sim/autobet-data.json]
// 첫배팅금액 1,000~10,000(1,000단위) × 총 시작시드 50,000~400,000(50,000단위) × 배팅법 9종(마틴 6종 + 파롤리·1-3-2-6·달랑베르)을
// 각 조합마다 runs회씩 시뮬레이션하고, 10·20·30·60판컷 결과(목표달성/파산/미달성)를 한 번에 집계한다.
// 한 번의 시뮬레이션은 최대 60판까지 이어 달리며 "몇 번째 판에 목표달성/파산했는지"만 기록하므로
// 10·20·30·60판컷은 같은 시행에서 나온 일관된 값이다.
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const os = require("os");
const fs = require("fs");
const path = require("path");

const CAPS = [10, 20, 30, 60];
const MAX_HANDS = 60;
const FIRST_BETS = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000];
const STARTS = [50000, 100000, 150000, 200000, 250000, 300000, 350000, 400000];
const TARGET_MULT = 4; // 목표수익 = 첫배팅금액 × 4 (시작금액과 무관한 고정 금액)

// 판정 확률: TIE 9.5%, 패배 45.25%, 승리 40.25%, SUPER6 5% (승리 처리, 수익은 배팅금액의 50%)
const P_WIN = 0.4025;
const P_SUPER6 = 0.05;
const P_TIE = 0.095;
const T_WIN = P_WIN;
const T_SUPER6 = T_WIN + P_SUPER6;
const T_TIE = T_SUPER6 + P_TIE; // 이후 구간은 패배

// 배팅법 정의 (2/index.html 의 METHODS 와 규칙이 같아야 함).
//  super   슈퍼마틴 1,3,7,15...  패배 시 +1단계, 마지막(limit) 단계 패배 시 파산, 승리 시 1단계
//  classic 일반마틴 1,2,4,8...   위와 같은 단계 이동
//  paroli  1,2,4 / 승리 시 +1단계(3단계 승리 후 1단계), 패배 시 1단계
//  s1326   1,3,2,6 / 승리 시 +1단계(4단계 승리 후 1단계), 패배 시 1단계
//  dalembert 단계 = 배수 / 승리 시 -1단계(최소 1), 패배 시 +1단계
// allIn: 마지막 마틴 단계에서 정해진 금액 대신 남은 돈 전부 배팅
const METHODS = [
  { label: "슈퍼마틴(4마틴)", kind: "super", limit: 4, allIn: false },
  { label: "슈퍼마틴(5마틴)", kind: "super", limit: 5, allIn: false },
  { label: "슈퍼마틴(4마틴,올인)", kind: "super", limit: 4, allIn: true },
  { label: "슈퍼마틴(5마틴,올인)", kind: "super", limit: 5, allIn: true },
  { label: "일반마틴(4마틴)", kind: "classic", limit: 4, allIn: false },
  { label: "일반마틴(5마틴)", kind: "classic", limit: 5, allIn: false },
  { label: "파롤리", kind: "paroli", allIn: false },
  { label: "1-3-2-6", kind: "s1326", allIn: false },
  { label: "달랑베르", kind: "dalembert", allIn: false }
];

const MAX_STAGE = MAX_HANDS + 2;
// 단계별 배수 / 승리 후 단계 / 패배 후 단계(0 = 파산)를 배열로 미리 계산
function buildTables(method) {
  const mult = new Array(MAX_STAGE + 1).fill(0);
  const winNext = new Array(MAX_STAGE + 1).fill(1);
  const lossNext = new Array(MAX_STAGE + 1).fill(1);
  let lastStage = 0;
  for (let s = 1; s <= MAX_STAGE; s++) {
    if (method.kind === "super") {
      mult[s] = (2 ** s) - 1; lossNext[s] = s >= method.limit ? 0 : s + 1;
    } else if (method.kind === "classic") {
      mult[s] = 2 ** (s - 1); lossNext[s] = s >= method.limit ? 0 : s + 1;
    } else if (method.kind === "paroli") {
      mult[s] = 2 ** (s - 1); winNext[s] = s >= 3 ? 1 : s + 1; lossNext[s] = 1;
    } else if (method.kind === "s1326") {
      mult[s] = [1, 3, 2, 6][s - 1] || 1; winNext[s] = s >= 4 ? 1 : s + 1; lossNext[s] = 1;
    } else {
      mult[s] = s; winNext[s] = Math.max(1, s - 1); lossNext[s] = s + 1;
    }
  }
  if (method.allIn) lastStage = method.limit;
  return { mult, winNext, lossNext, lastStage };
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simulateCombo(method, firstBet, start, runs, rnd) {
  const { mult, winNext, lossNext, lastStage } = buildTables(method);
  const goalMoney = start + firstBet * TARGET_MULT;
  const goalAt = new Float64Array(MAX_HANDS + 2); // goalAt[h]: h번째 판에 목표달성한 시행 수
  const bustAt = new Float64Array(MAX_HANDS + 2);

  for (let i = 0; i < runs; i++) {
    let money = start;
    let stage = 1;
    for (let hand = 1; hand <= MAX_HANDS; hand++) {
      let bet = firstBet * mult[stage];
      if (stage === lastStage) bet = money;
      if (bet > money) bet = money; // 정해진 배팅금액이 남은 돈보다 크면 남은 돈 전부 배팅

      const r = rnd();
      if (r < T_WIN) {
        money += bet;
        stage = winNext[stage];
      } else if (r < T_SUPER6) {
        money += Math.round(bet * 0.5);
        stage = winNext[stage];
      } else if (r < T_TIE) {
        continue; // TIE: 금액·단계 유지, 1판으로 계산
      } else {
        money -= bet;
        stage = lossNext[stage];
        if (money <= 0 || stage === 0) { bustAt[hand]++; break; }
        continue;
      }
      if (money >= goalMoney) { goalAt[hand]++; break; }
    }
  }

  const out = {};
  for (const cap of CAPS) {
    let goal = 0, bust = 0;
    for (let h = 1; h <= cap; h++) { goal += goalAt[h]; bust += bustAt[h]; }
    out[cap] = { goal: goal / runs * 100, bust: bust / runs * 100, un: (runs - goal - bust) / runs * 100 };
  }
  return out;
}

if (isMainThread) {
  const runs = Number(process.argv[2]) || 10000000;
  const outFile = process.argv[3] || path.join(__dirname, "autobet-data.json");
  const jobs = [];
  for (const m of METHODS) for (const s of STARTS) for (const b of FIRST_BETS) {
    jobs.push({ method: m, start: s, firstBet: b });
  }
  const results = new Array(jobs.length);
  const nWorkers = Math.min(os.cpus().length, jobs.length);
  let next = 0, done = 0;
  const t0 = Date.now();

  function launch() {
    const w = new Worker(__filename, { workerData: { runs } });
    w.on("message", (msg) => {
      if (msg.result) {
        results[msg.idx] = msg.result;
        done++;
        if (done % 20 === 0 || done === jobs.length) {
          console.log(`${done}/${jobs.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
        }
      }
      if (next < jobs.length) {
        const idx = next++;
        w.postMessage({ idx, job: jobs[idx] });
      } else {
        w.terminate();
        if (done === jobs.length) finish();
      }
    });
  }
  function finish() {
    if (finish.called) return;
    finish.called = true;
    const rows = jobs.map((j, i) => {
      const r = results[i];
      const row = { label: j.method.label, start: j.start, firstBet: j.firstBet };
      for (const cap of CAPS) {
        row[`g${cap}`] = +r[cap].goal.toFixed(2);
        row[`b${cap}`] = +r[cap].bust.toFixed(2);
        row[`u${cap}`] = +r[cap].un.toFixed(2);
      }
      return row;
    });
    const payload = { runs, caps: CAPS, rows };
    fs.writeFileSync(outFile, JSON.stringify(payload));
    console.log(`saved ${rows.length} rows -> ${outFile} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

    // 2/index.html 의 데이터 블록을 새 결과로 교체
    const htmlFile = path.join(__dirname, "..", "2", "index.html");
    if (fs.existsSync(htmlFile)) {
      const html = fs.readFileSync(htmlFile, "utf8");
      const re = /(\/\*AUTOBET_DATA_START\*\/\s*)const AUTOBET = [\s\S]*?;(\s*\/\*AUTOBET_DATA_END\*\/)/;
      if (!re.test(html)) throw new Error("2/index.html 에서 AUTOBET_DATA 마커를 찾지 못했습니다.");
      fs.writeFileSync(htmlFile, html.replace(re, (_, a, b) => `${a}const AUTOBET = ${JSON.stringify(payload)};${b}`));
      console.log("updated 2/index.html");
    }
  }
  for (let i = 0; i < nWorkers; i++) launch();
  // 워커는 시작 시 {ready}를 보내고, 메인은 결과 없는 첫 메시지를 받으면 첫 작업을 배정한다.
} else {
  let seedCounter = 0;
  parentPort.on("message", ({ idx, job }) => {
    const seed = (idx * 2654435761 + 12345) >>> 0;
    const rnd = mulberry32(seed ^ (++seedCounter * 40503));
    const result = simulateCombo(job.method, job.firstBet, job.start, workerData.runs, rnd);
    parentPort.postMessage({ idx, result });
  });
  parentPort.postMessage({ ready: true });
}
