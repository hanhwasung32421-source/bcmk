// 자동 배팅법 선택 페이지(2/index.html)용 확률 데이터 생성기.
//   node sim/simulate.js [runs=10000000] [out=sim/autobet-data.json] [--only=배팅법1,배팅법2] [--inject]
//     (인자 없음)   모든 배팅법을 새로 시뮬레이션
//     --only=...    지정한 배팅법(label, 쉼표 구분)만 시뮬레이션하고 기존 out 파일에 병합 (나머지 행은 그대로 유지)
//     --inject      시뮬레이션 없이 기존 out 파일 + sim/methods.js 내용을 2/index.html 에 다시 주입
// 첫배팅금액 1,000~10,000(1,000단위) × 총 시작시드 50,000~400,000(50,000단위) × 배팅법(sim/methods.js)을
// 각 조합마다 runs회씩 시뮬레이션하고, 10·20·30·60판컷 결과(목표달성/파산/미달성)를 한 번에 집계한다.
// 한 번의 시뮬레이션은 최대 60판까지 이어 달리며 "몇 번째 판에 목표달성/파산했는지"만 기록하므로
// 10·20·30·60판컷은 같은 시행에서 나온 일관된 값이다.
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { BET_METHODS, createEngine } = require("./methods.js");

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

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simulateCombo(method, firstBet, start, runs, rnd) {
  const eng = createEngine(method, firstBet);
  const goalMoney = start + firstBet * TARGET_MULT;
  const goalAt = new Float64Array(MAX_HANDS + 2); // goalAt[h]: h번째 판에 목표달성한 시행 수
  const bustAt = new Float64Array(MAX_HANDS + 2);

  for (let i = 0; i < runs; i++) {
    let money = start;
    eng.reset();
    for (let hand = 1; hand <= MAX_HANDS; hand++) {
      const bet = eng.nextBet(money);
      const r = rnd();
      if (r < T_WIN) {
        money += bet;
        eng.afterWin(bet, bet);
      } else if (r < T_SUPER6) {
        const gain = Math.round(bet * 0.5);
        money += gain;
        eng.afterWin(bet, gain);
      } else if (r < T_TIE) {
        continue; // TIE: 금액·단계 유지, 1판으로 계산
      } else {
        money -= bet;
        const bust = eng.afterLoss(bet);
        if (money <= 0 || bust) { bustAt[hand]++; break; }
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

function injectIntoPage(payload) {
  const htmlFile = path.join(__dirname, "..", "2", "index.html");
  if (!fs.existsSync(htmlFile)) return;
  let html = fs.readFileSync(htmlFile, "utf8");
  const reData = /(\/\*AUTOBET_DATA_START\*\/\s*)const AUTOBET = [\s\S]*?;(\s*\/\*AUTOBET_DATA_END\*\/)/;
  if (!reData.test(html)) throw new Error("2/index.html 에서 AUTOBET_DATA 마커를 찾지 못했습니다.");
  html = html.replace(reData, (_, a, b) => `${a}const AUTOBET = ${JSON.stringify(payload)};${b}`);

  const startMark = "/*METHODS_START*/";
  const endMark = "/*METHODS_END*/";
  const si = html.indexOf(startMark);
  const ei = html.lastIndexOf(endMark);
  if (si < 0 || ei < si) throw new Error("2/index.html 에서 METHODS 마커를 찾지 못했습니다.");
  const methodsSrc = fs.readFileSync(path.join(__dirname, "methods.js"), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\nif \(typeof module[^\n]*\n?$/, "\n");
  if (methodsSrc.includes(startMark) || methodsSrc.includes(endMark)) throw new Error("methods.js 에 주입 마커 문자열이 들어 있습니다.");
  html = html.slice(0, si + startMark.length) + "\n" + methodsSrc + html.slice(ei);
  fs.writeFileSync(htmlFile, html);
  console.log("updated 2/index.html");
}

if (isMainThread) {
  const args = process.argv.slice(2);
  const flags = args.filter(a => a.startsWith("--"));
  const pos = args.filter(a => !a.startsWith("--"));
  const runs = Number(pos[0]) || 10000000;
  const outFile = pos[1] || path.join(__dirname, "autobet-data.json");
  const onlyFlag = flags.find(f => f.startsWith("--only="));
  const only = onlyFlag ? onlyFlag.slice("--only=".length).split(",").map(s => s.trim()).filter(Boolean) : null;

  if (flags.includes("--inject")) {
    injectIntoPage(JSON.parse(fs.readFileSync(outFile, "utf8")));
    process.exit(0);
  }
  if (only) {
    const unknown = only.filter(l => !BET_METHODS.some(m => m.label === l));
    if (unknown.length) throw new Error("알 수 없는 배팅법: " + unknown.join(", "));
  }

  const targetMethods = only ? BET_METHODS.filter(m => only.includes(m.label)) : BET_METHODS;
  const jobs = [];
  for (const m of targetMethods) for (const s of STARTS) for (const b of FIRST_BETS) {
    jobs.push({ label: m.label, start: s, firstBet: b });
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
    let rows = jobs.map((j, i) => {
      const r = results[i];
      const row = { label: j.label, start: j.start, firstBet: j.firstBet };
      for (const cap of CAPS) {
        row[`g${cap}`] = +r[cap].goal.toFixed(2);
        row[`b${cap}`] = +r[cap].bust.toFixed(2);
        row[`u${cap}`] = +r[cap].un.toFixed(2);
      }
      return row;
    });
    if (only && fs.existsSync(outFile)) {
      const old = JSON.parse(fs.readFileSync(outFile, "utf8"));
      if (old.runs !== runs) console.warn(`경고: 기존 데이터는 ${old.runs}회, 새 데이터는 ${runs}회 기준입니다.`);
      rows = old.rows.filter(r => !only.includes(r.label)).concat(rows);
    }
    const order = new Map(BET_METHODS.map((m, i) => [m.label, i]));
    rows.sort((x, y) => (order.get(x.label) - order.get(y.label)) || (x.start - y.start) || (x.firstBet - y.firstBet));

    const payload = { runs, caps: CAPS, rows };
    fs.writeFileSync(outFile, JSON.stringify(payload));
    console.log(`saved ${rows.length} rows -> ${outFile} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    injectIntoPage(payload);
  }

  for (let i = 0; i < nWorkers; i++) launch();
  // 워커는 시작 시 {ready}를 보내고, 메인은 결과 없는 첫 메시지를 받으면 첫 작업을 배정한다.
} else {
  parentPort.on("message", ({ idx, job }) => {
    const method = BET_METHODS.find(m => m.label === job.label);
    const rnd = mulberry32(((idx * 2654435761 + 12345) >>> 0) ^ (Date.now() & 0xffff) ^ (process.pid << 4));
    const result = simulateCombo(method, job.firstBet, job.start, workerData.runs, rnd);
    parentPort.postMessage({ idx, result });
  });
  parentPort.postMessage({ ready: true });
}
