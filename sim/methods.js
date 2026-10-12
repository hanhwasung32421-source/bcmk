// 배팅법 정의 + 엔진. 시뮬레이터(sim/simulate.js)와 /2 페이지(2/index.html)가 이 파일 하나를 공유한다.
// 2/index.html 에는 sim/simulate.js 실행 시 이 파일 내용이 페이지의 METHODS 주입 구간에 복사된다.
// (페이지에서 직접 수정하지 말고 이 파일을 수정한 뒤 `node sim/simulate.js --inject` 로 반영할 것)
//
// 공통 규칙: 단위(unit) = 첫 배팅금액. 판정은 승리(+배팅금액) / SUPER6(+배팅금액의 50%, 진행은 승리 취급) /
// TIE(금액·단계 유지, 1판으로 계산) / 패배(-배팅금액). 정해진 금액이 남은 돈보다 크면 남은 돈 전부를 배팅한다.
//
// 참고한 자료: 피보나치·라부셰르·달랑베르·파롤리·오스카 그라인드·1-3-2-6 규칙은 아래 페이지의 설명을 따랐고,
// 1-2-3-5, 1-3-5-7-9, 피라미드, 역피보나치, 파롤리·마틴 횟수 변형은 해당 계열의 통상적인 정의를 이 프로젝트에서 구체화한 것이다.
//  - https://www.soccernews.com/progressive-betting-systems-explained-martingale-fibonacci-paroli-dalembert-1-3-2-6-labouchere/401499/
//  - https://www.casinos.com/guides/1-3-2-6-betting-system
//  - https://en.wikipedia.org/wiki/Oscar%27s_grind

const MAX_STAGE = 70;

function fibAt(s) { // 1,1,2,3,5,8...
  let a = 1, b = 1;
  for (let i = 3; i <= s; i++) { const t = a + b; a = b; b = t; }
  return s <= 2 ? 1 : b;
}

// kind "table": 단계(stage) 기반. mult(s)=배수, win(s)=승리 후 단계, loss(s)=패배 후 단계(0이면 파산)
// kind "labouchere" / "oscar": 단계 대신 리스트·세션 수익을 상태로 갖는 방식
const BET_METHODS = [
  // ---- 기존 9종 ----
  { label: "슈퍼마틴(4마틴)", short: "슈4", kind: "table", limit: 4, allIn: false,
    mult: s => (2 ** s) - 1, win: () => 1, loss: s => s >= 4 ? 0 : s + 1,
    rule: "1·3·7·15배. 패배 시 다음 단계, 4단계에서 패배하면 파산, 승리 시 1단계로." },
  { label: "슈퍼마틴(5마틴)", short: "슈5", kind: "table", limit: 5, allIn: false,
    mult: s => (2 ** s) - 1, win: () => 1, loss: s => s >= 5 ? 0 : s + 1,
    rule: "1·3·7·15·31배. 5단계에서 패배하면 파산, 승리 시 1단계로." },
  { label: "슈퍼마틴(4마틴,올인)", short: "슈4올", kind: "table", limit: 4, allIn: true,
    mult: s => (2 ** s) - 1, win: () => 1, loss: s => s >= 4 ? 0 : s + 1,
    rule: "슈퍼마틴 4마틴과 같지만 마지막(4단계)에는 남은 돈 전부를 배팅." },
  { label: "슈퍼마틴(5마틴,올인)", short: "슈5올", kind: "table", limit: 5, allIn: true,
    mult: s => (2 ** s) - 1, win: () => 1, loss: s => s >= 5 ? 0 : s + 1,
    rule: "슈퍼마틴 5마틴과 같지만 마지막(5단계)에는 남은 돈 전부를 배팅." },
  { label: "일반마틴(4마틴)", short: "일4", kind: "table", limit: 4, allIn: false,
    mult: s => 2 ** (s - 1), win: () => 1, loss: s => s >= 4 ? 0 : s + 1,
    rule: "1·2·4·8배. 4단계에서 패배하면 파산, 승리 시 1단계로." },
  { label: "일반마틴(5마틴)", short: "일5", kind: "table", limit: 5, allIn: false,
    mult: s => 2 ** (s - 1), win: () => 1, loss: s => s >= 5 ? 0 : s + 1,
    rule: "1·2·4·8·16배. 5단계에서 패배하면 파산, 승리 시 1단계로." },
  { label: "파롤리", short: "파롤", kind: "table", allIn: false,
    mult: s => 2 ** (s - 1), win: s => s >= 3 ? 1 : s + 1, loss: () => 1,
    rule: "1·2·4배. 승리하면 2배씩 올리고 3연승 또는 패배 시 1단계로." },
  { label: "1-3-2-6", short: "1326", kind: "table", allIn: false,
    mult: s => [1, 3, 2, 6][s - 1] || 1, win: s => s >= 4 ? 1 : s + 1, loss: () => 1,
    rule: "1·3·2·6배. 승리하면 다음 단계, 4연승 또는 패배 시 1단계로." },
  { label: "달랑베르", short: "달랑", kind: "table", allIn: false,
    mult: s => s, win: s => Math.max(1, s - 1), loss: s => s + 1,
    rule: "단계 = 배수. 패배 시 +1단계, 승리 시 -1단계(최소 1)." },

  // ---- 새로 추가한 15종 ----
  { label: "피보나치", short: "피보", kind: "table", allIn: false,
    mult: fibAt, win: s => Math.max(1, s - 2), loss: s => s + 1,
    rule: "1·1·2·3·5·8·13…배. 패배 시 +1단계, 승리 시 2단계 뒤로(최소 1)." },
  { label: "역피보나치(5단계)", short: "역피", kind: "table", allIn: false,
    mult: s => [1, 1, 2, 3, 5][s - 1] || 1, win: s => s >= 5 ? 1 : s + 1, loss: () => 1,
    rule: "1·1·2·3·5배. 승리 시 +1단계, 5연승 또는 패배 시 1단계로." },
  { label: "1-2-3-5", short: "1235", kind: "table", allIn: false,
    mult: s => [1, 2, 3, 5][s - 1] || 1, win: s => s >= 4 ? 1 : s + 1, loss: () => 1,
    rule: "1·2·3·5배. 승리 시 +1단계, 4연승 또는 패배 시 1단계로." },
  { label: "1-3-5-7-9", short: "13579", kind: "table", allIn: false,
    mult: s => [1, 3, 5, 7, 9][s - 1] || 1, win: s => s >= 5 ? 1 : s + 1, loss: () => 1,
    rule: "1·3·5·7·9배. 승리 시 +1단계, 5연승 또는 패배 시 1단계로." },
  { label: "역달랑베르", short: "역달", kind: "table", allIn: false,
    mult: s => s, win: s => s + 1, loss: s => Math.max(1, s - 1),
    rule: "달랑베르의 반대. 승리 시 +1단계, 패배 시 -1단계(최소 1)." },
  { label: "피라미드", short: "피라", kind: "table", allIn: false,
    mult: s => s, win: s => Math.max(1, s - 2), loss: s => s + 1,
    rule: "1·2·3·4…배. 패배 시 +1단계, 승리 시 2단계 뒤로(최소 1)." },
  { label: "파롤리(2연승)", short: "파2", kind: "table", allIn: false,
    mult: s => 2 ** (s - 1), win: s => s >= 2 ? 1 : s + 1, loss: () => 1,
    rule: "1·2배. 승리하면 2배, 2연승 또는 패배 시 1단계로." },
  { label: "파롤리(4연승)", short: "파4", kind: "table", allIn: false,
    mult: s => 2 ** (s - 1), win: s => s >= 4 ? 1 : s + 1, loss: () => 1,
    rule: "1·2·4·8배. 승리하면 2배씩, 4연승 또는 패배 시 1단계로." },
  { label: "일반마틴(3마틴)", short: "일3", kind: "table", limit: 3, allIn: false,
    mult: s => 2 ** (s - 1), win: () => 1, loss: s => s >= 3 ? 0 : s + 1,
    rule: "1·2·4배. 3단계에서 패배하면 파산, 승리 시 1단계로." },
  { label: "일반마틴(6마틴)", short: "일6", kind: "table", limit: 6, allIn: false,
    mult: s => 2 ** (s - 1), win: () => 1, loss: s => s >= 6 ? 0 : s + 1,
    rule: "1·2·4·8·16·32배. 6단계에서 패배하면 파산, 승리 시 1단계로." },
  { label: "슈퍼마틴(3마틴)", short: "슈3", kind: "table", limit: 3, allIn: false,
    mult: s => (2 ** s) - 1, win: () => 1, loss: s => s >= 3 ? 0 : s + 1,
    rule: "1·3·7배. 3단계에서 패배하면 파산, 승리 시 1단계로." },
  { label: "슈퍼마틴(6마틴)", short: "슈6", kind: "table", limit: 6, allIn: false,
    mult: s => (2 ** s) - 1, win: () => 1, loss: s => s >= 6 ? 0 : s + 1,
    rule: "1·3·7·15·31·63배. 6단계에서 패배하면 파산, 승리 시 1단계로." },
  { label: "라부셰르(1-2-3)", short: "라123", kind: "labouchere", list: [1, 2, 3], allIn: false,
    rule: "리스트 [1,2,3]. 배팅 = 맨 앞 + 맨 뒤 숫자. 승리하면 둘을 지우고, 패배하면 잃은 배수를 맨 뒤에 추가. 리스트가 비면 새로 시작." },
  { label: "라부셰르(1-2-3-4)", short: "라1234", kind: "labouchere", list: [1, 2, 3, 4], allIn: false,
    rule: "리스트 [1,2,3,4]. 배팅 = 맨 앞 + 맨 뒤 숫자. 승리하면 둘을 지우고, 패배하면 잃은 배수를 맨 뒤에 추가. 리스트가 비면 새로 시작." },
  { label: "오스카그라인드", short: "오스", kind: "oscar", allIn: false,
    rule: "한 세션의 목표는 +1유닛. 패배하면 같은 금액으로 계속, 승리하면 1유닛 올림(목표를 넘지 않게 조정). +1유닛을 달성하면 1유닛으로 새 세션." }
];

// 엔진: 한 번의 게임(시행)에서 배팅금액을 정하고 승/패 후 상태를 갱신한다.
//   reset()           처음 상태로
//   formulaBet()      공식상 배팅금액(남은 돈과 무관)
//   nextBet(money)    실제 배팅금액(올인 단계·남은 돈 부족 반영)
//   afterWin(bet,gain) / afterLoss(bet) → 파산이면 true (돈이 0 이하가 되는 경우는 호출한 쪽에서 판단)
//   describe()        화면 표시용 단계 문자열
function createEngine(method, unit) {
  if (method.kind === "table") return createTableEngine(method, unit);
  if (method.kind === "labouchere") return createLabouchereEngine(method, unit);
  return createOscarEngine(method, unit);
}

function createTableEngine(method, unit) {
  const mult = new Array(MAX_STAGE + 2).fill(1);
  const win = new Array(MAX_STAGE + 2).fill(1);
  const loss = new Array(MAX_STAGE + 2).fill(1);
  for (let s = 1; s <= MAX_STAGE; s++) {
    mult[s] = method.mult(s);
    win[s] = Math.min(method.win(s), MAX_STAGE);
    loss[s] = Math.min(method.loss(s), MAX_STAGE);
  }
  const allInStage = method.allIn ? method.limit : -1;
  let stage = 1;
  return {
    reset() { stage = 1; },
    formulaBet() { return unit * mult[stage]; },
    nextBet(money) {
      const b = stage === allInStage ? money : unit * mult[stage];
      return b > money ? money : b;
    },
    afterWin() { stage = win[stage]; },
    afterLoss() { stage = loss[stage]; return stage === 0; },
    describe() { return `${stage}단계`; }
  };
}

function createLabouchereEngine(method, unit) {
  const a = [];
  let lo = 0;
  let units = 0;
  function restart() { a.length = 0; for (const v of method.list) a.push(v); lo = 0; }
  function curUnits() {
    const len = a.length - lo;
    return len === 1 ? a[lo] : a[lo] + a[a.length - 1];
  }
  restart();
  return {
    reset() { restart(); },
    formulaBet() { return unit * curUnits(); },
    nextBet(money) {
      units = curUnits();
      const b = unit * units;
      return b > money ? money : b;
    },
    afterWin() {
      if (a.length - lo === 1) lo++;
      else { lo++; a.pop(); }
      if (a.length - lo <= 0) restart();
    },
    afterLoss() { a.push(units); return false; },
    describe() { return `리스트 [${a.slice(lo).join(",")}]`; }
  };
}

function createOscarEngine(method, unit) {
  let b = 1;       // 현재 배수
  let sp = 0;      // 세션 수익(원)
  return {
    reset() { b = 1; sp = 0; },
    formulaBet() { const t = unit - sp; const v = b * unit; return v < t ? v : t; },
    nextBet(money) {
      const t = unit - sp;
      const v = b * unit;
      const x = v < t ? v : t;
      return x > money ? money : x;
    },
    afterWin(bet, gain) {
      sp += gain;
      if (sp >= unit) { b = 1; sp = 0; } else { b += 1; }
    },
    afterLoss(bet) { sp -= bet; return false; },
    describe() { return `${b}단위 · 세션 ${sp >= 0 ? "+" : ""}${sp}`; }
  };
}

if (typeof module !== "undefined") module.exports = { BET_METHODS, createEngine };
