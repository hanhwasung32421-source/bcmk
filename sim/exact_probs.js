// 바카라(punto banco) 한 판의 결과 확률을 덱 수에 따라 정확히 계산한다 (첫 4장 + 세 번째 카드 규칙 전수 열거, 비복원 추출).
//   node sim/exact_probs.js [덱수=6]
// 8덱 결과가 Wizard of Odds의 값(플레이어 0.446247 / 뱅커 0.458597 / 타이 0.095156 / 슈퍼6 0.053864)과 일치하는지로 검증한다.
function exactProbs(decks) {
  const c = new Array(10).fill(4 * decks); // 카드 가치별 장수: 1~9 = 4×덱수, 0(10·J·Q·K) = 16×덱수
  c[0] = 16 * decks;
  let N = 52 * decks;
  const res = { player: 0, banker: 0, tie: 0, super6: 0, naturalHands: 0 };

  function draw(v) { c[v]--; N--; }
  function undo(v) { c[v]++; N++; }

  function finish(p, b, prob) {
    p %= 10; b %= 10;
    if (p > b) res.player += prob;
    else if (b > p) { res.banker += prob; if (b === 6) res.super6 += prob; }
    else res.tie += prob;
  }

  function bankerDraws(bt, p3) { // p3: 플레이어 세 번째 카드 가치, null이면 플레이어가 스탠드
    if (p3 === null) return bt <= 5;
    if (bt <= 2) return true;
    if (bt === 3) return p3 !== 8;
    if (bt === 4) return p3 >= 2 && p3 <= 7;
    if (bt === 5) return p3 >= 4 && p3 <= 7;
    if (bt === 6) return p3 === 6 || p3 === 7;
    return false;
  }

  for (let p1 = 0; p1 <= 9; p1++) {
    const q1 = c[p1] / N; draw(p1);
    for (let b1 = 0; b1 <= 9; b1++) {
      const q2 = q1 * c[b1] / N; draw(b1);
      for (let p2 = 0; p2 <= 9; p2++) {
        const q3 = q2 * c[p2] / N; draw(p2);
        for (let b2 = 0; b2 <= 9; b2++) {
          const q4 = q3 * c[b2] / N; draw(b2);
          const pt = (p1 + p2) % 10, bt = (b1 + b2) % 10;
          if (pt >= 8 || bt >= 8) { res.naturalHands += q4; finish(pt, bt, q4); }
          else {
            const pDraws = pt <= 5;
            if (!pDraws) {
              if (bankerDraws(bt, null)) {
                for (let b3 = 0; b3 <= 9; b3++) { const q = q4 * c[b3] / N; finish(pt, bt + b3, q); }
              } else finish(pt, bt, q4);
            } else {
              for (let p3 = 0; p3 <= 9; p3++) {
                const q5 = q4 * c[p3] / N; draw(p3);
                const ptt = pt + p3;
                if (bankerDraws(bt, p3)) {
                  for (let b3 = 0; b3 <= 9; b3++) { const q = q5 * c[b3] / N; finish(ptt, bt + b3, q); }
                } else finish(ptt, bt, q5);
                undo(p3);
              }
            }
          }
          undo(b2);
        }
        undo(p2);
      }
      undo(b1);
    }
    undo(p1);
  }
  return res;
}

if (require.main === module) {
  const decks = Number(process.argv[2]) || 6;
  const r = exactProbs(decks);
  const sum = r.player + r.banker + r.tie;
  console.log(`${decks}덱`, Object.fromEntries(Object.entries(r).map(([k, v]) => [k, +v.toFixed(6)])), "합계", +sum.toFixed(9));
}
module.exports = { exactProbs };
