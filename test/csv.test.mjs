// 저장소 맨 위에서: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = { TextDecoder };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../csv.js", import.meta.url), "utf8"), ctx);
vm.runInContext(readFileSync(new URL("../sample-data.js", import.meta.url), "utf8").replaceAll("window.", "globalThis."), ctx);
const C = ctx.JobdashCSV;
// vm 컨텍스트의 배열은 프로토타입이 달라 deepEqual 전에 평범한 값으로 바꾼다.
const plain = v => JSON.parse(JSON.stringify(v));

test("따옴표 안의 쉼표·줄바꿈·이스케이프와 BOM", () => {
  const rows = C.parseRows('\uFEFF회사,메모\r\n"가나, 주식회사","줄1\n줄2 ""인용"""\r\n');
  assert.deepEqual(plain(rows), [["회사", "메모"], ["가나, 주식회사", '줄1\n줄2 "인용"']]);
});

test("한국어 결과 표기와 단계 추정", () => {
  const { records, errors } = C.parse("회사,제출일,결과\nA,2026-01-05,면접 탈락\nB,2026/1/6,최종합격\nC,2026-01-07,", { today: "2026-02-01" });
  assert.deepEqual(plain(errors), []);
  assert.deepEqual(plain(records.map(r => [r.o, r.s, r.d])), [["ITV_FAIL", 4, "2026-01-05"], ["OFFER", 5, "2026-01-06"], ["PENDING", 1, "2026-01-07"]]);
});

test("잘못된 행은 행 번호와 함께 오류로 모은다", () => {
  const { errors } = C.parse("회사,제출일,결과,최고단계\nA,2026-02-30,,\nB,2026-01-01,합격?,\nC,2026-01-01,,7", {});
  assert.equal(errors.length, 3);
  assert.match(errors[0], /^2행/);
  assert.match(errors[2], /최고단계/);
});

test("필수 열이 없으면 거부", () => {
  assert.match(C.parse("회사,메모\nA,x").errors[0], /제출일/);
});

test("꺾쇠는 태그가 되지 않게 바꾼다", () => {
  const { records } = C.parse('회사,제출일,메모\n"<img src=x onerror=alert(1)>",2026-01-01,a>b', {});
  assert.ok(!/[<>]/.test(records[0].c + records[0].n));
});

test("다음 일정: 지난 날짜는 빼고 D-day 순으로", () => {
  const csv = "회사,제출일,다음일정일,다음일정\nA,2026-01-01,2026-01-20 14:00,1차 면접\nB,2026-01-01,2026-01-05,서류 발표\nC,2026-01-01,2026-01-12,필기 NCS";
  const { schedule } = C.parse(csv, { today: "2026-01-10" });
  assert.deepEqual(plain(schedule.map(s => [s.company, s.dday, s.kind, s.time])), [["C", 2, "필기", ""], ["A", 10, "면접", "14:00"]]);
});

test("예시 데이터는 오류 없이 읽히고 오늘로 옮겨진다", () => {
  const { records, errors } = C.parse(ctx.SAMPLE_CSV, { today: "2027-01-01", shiftTo: "2027-01-01", anchor: ctx.SAMPLE_ANCHOR });
  assert.deepEqual(plain(errors), []);
  assert.ok(records.length > 100);
  assert.ok(records.every(r => r.d <= "2027-01-01"));
  assert.ok(records.some(r => r.d >= "2026-12-25"));
});

test("UTF-8이 아니면 EUC-KR로 읽는다", () => {
  const euckr = new Uint8Array([0xc8, 0xb8, 0xbb, 0xe7]); // "회사"
  assert.equal(C.decode(euckr.buffer), "회사");
});

test("상속 키(constructor 등)는 결과로 받지 않는다", () => {
  const { errors } = C.parse("회사,제출일,결과\nA,2026-01-01,constructor\nB,2026-01-01,__proto__", {});
  assert.equal(errors.length, 2);
});

test("닫히지 않은 따옴표와 칸 초과는 저장하지 않는다", () => {
  assert.match(C.parse('회사,제출일,메모\nA,2026-01-01,"열린 따옴표\nB,2026-01-02,x', {}).errors[0], /^2행: 따옴표/);
  assert.match(C.parse("회사,제출일\nA,2026-01-01,넘친 칸", {}).errors[0], /^2행: 칸이/);
});

test("없는 시간은 거부한다", () => {
  assert.match(C.parse("회사,제출일,다음일정일\nA,2026-01-01,2026-01-20 99:99", {}).errors[0], /다음일정일/);
});

test("오류 행 번호는 빈 줄과 여러 줄 메모를 건너뛴 실제 줄이다", () => {
  const csv = '회사,제출일,메모\n\nA,2026-01-01,"줄1\n줄2"\nB,잘못,x';
  assert.match(C.parse(csv, {}).errors[0], /^5행/);
});

test("닫는 따옴표 뒤 글자는 오류(값을 몰래 이어 붙이지 않는다)", () => {
  assert.match(C.parse('회사,제출일\nA,"2026-01-"01', {}).errors[0], /^2행: 닫는 따옴표/);
});

test("CR만 쓰는 줄바꿈도 줄 번호를 맞게 센다", () => {
  assert.match(C.parse('회사,제출일,메모\rA,2026-01-01,"줄1\r줄2"\rB,잘못,x', {}).errors[0], /^4행/);
});
