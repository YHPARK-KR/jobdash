/* Jobdash CSV 읽기 — 지원 기록 CSV를 화면이 쓰는 레코드·일정으로 바꾼다.
 * 브라우저에서는 window.JobdashCSV, Node 테스트에서는 globalThis.JobdashCSV로 쓴다. */
(function (root) {
  "use strict";

  /* 결과 열: 코드나 한국어 표기 둘 다 받는다. 비교할 때 공백은 무시한다. */
  const RESULTS = {
    PENDING: ["진행중", "대기", "결과대기"],
    DOC_FAIL: ["서류탈락"],
    TEST_FAIL: ["필기탈락", "코테탈락", "필기·코테탈락"],
    ASSESS_FAIL: ["인성검사탈락", "검사탈락"],
    ITV_FAIL: ["면접탈락"],
    OFFER: ["최종합격", "합격"],
    OFFER_DECLINED: ["합격후고사", "최종합격(고사)", "고사"],
    WITHDRAW: ["철회", "자진철회", "불참"],
    CANCEL: ["취소", "지원취소"],
    NORESP: ["무응답"],
  };
  const RESULT_OF = Object.create(null); // constructor 같은 상속 키가 결과로 통과하지 않게
  for (const [code, names] of Object.entries(RESULTS)) {
    RESULT_OF[code.toLowerCase()] = code;
    names.forEach(n => { RESULT_OF[n] = code; });
  }
  /* 안내용 대표 표기 — README의 결과 목록과 같은 순서 */
  const RESULT_NAMES = "진행중, 서류 탈락, 필기 탈락, 인성검사 탈락, 면접 탈락, 최종합격, 합격 후 고사, 철회, 취소, 무응답";
  /* 최고단계를 비워 두면 결과에서 짐작한다. */
  const STAGE_GUESS = { TEST_FAIL: 2, ASSESS_FAIL: 2, ITV_FAIL: 4, OFFER: 5, OFFER_DECLINED: 5 };

  const COLUMNS = {
    company: ["회사", "회사·기관", "company"],
    type: ["기관유형", "유형", "type"],
    employment: ["고용형태", "employment"],
    track: ["직무", "직무축", "track"],
    submitted: ["제출일", "submitted"],
    resultDate: ["결과일", "result_date"],
    result: ["결과", "result"],
    stage: ["최고단계", "단계", "stage"],
    estimated: ["제출일추정", "추정", "estimated"],
    memo: ["메모", "memo"],
    nextDate: ["다음일정일", "next_date"],
    nextEvent: ["다음일정", "next_event"],
  };

  const squash = s => String(s ?? "").replace(/\s+/g, "");
  /* 화면이 innerHTML로 그리는 곳이 있어 꺾쇠는 전각으로 바꿔 태그가 되지 않게 한다. */
  const clean = s => String(s ?? "").trim().replace(/</g, "＜").replace(/>/g, "＞");

  /* RFC 4180: 따옴표 안의 쉼표·줄바꿈·"" 이스케이프를 처리한다.
     각 행이 시작한 실제 파일 줄 번호를 rows.lines에 함께 둔다. 닫히지 않은 따옴표는 rows.error. */
  function parseRows(text) {
    const rows = [], lines = [];
    let row = [], field = "", quoted = false, closed = false, line = 1, start = 1;
    const s = String(text).replace(/^\uFEFF/, "");
    const endRow = () => {
      row.push(field);
      if (row.some(v => v.trim() !== "")) { rows.push(row); lines.push(start); }
      row = []; field = ""; closed = false;
    };
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (quoted) {
        if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') { quoted = false; closed = true; }
        else { if (ch === "\n" || (ch === "\r" && s[i + 1] !== "\n")) line++; field += ch; }
      } else if (closed && ch !== "," && ch !== "\n" && ch !== "\r") {
        rows.error = `${line}행: 닫는 따옴표 뒤에 글자가 있다. 값 안의 따옴표는 ""로 두 번 적는다.`;
        break;
      } else if (ch === '"' && field === "") quoted = true;
      else if (ch === ",") { row.push(field); field = ""; closed = false; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && s[i + 1] === "\n") i++;
        endRow(); line++; start = line;
      } else field += ch;
    }
    if (!rows.error && quoted) rows.error = `${start}행: 따옴표가 닫히지 않았다.`;
    else if (!rows.error && (field !== "" || row.length)) endRow();
    rows.lines = lines;
    return rows;
  }

  const toDay = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
  const fromDay = n => new Date(n * 86400000).toISOString().slice(0, 10);
  const shiftDate = (s, by) => (s && by ? fromDay(toDay(s) + by) : s);

  const DATE_RE = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/;
  function parseDate(value) {
    const m = String(value ?? "").trim().match(DATE_RE);
    if (!m) return null;
    const date = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    if (fromDay(toDay(date)) !== date) return null; // 2월 30일처럼 없는 날짜
    if (m[4] !== undefined && (+m[4] > 23 || +m[5] > 59)) return null;
    return { date, time: m[4] !== undefined ? `${m[4].padStart(2, "0")}:${m[5]}` : "" };
  }

  function kindOf(event) {
    if (/면접|PT|토론/.test(event)) return "면접";
    if (/필기|코테|코딩|NCS|인적성|SKCT|GSAT|검사|시험/.test(event)) return "필기";
    if (/발표|결과/.test(event)) return "발표";
    if (/마감|접수/.test(event)) return "마감";
    if (/서류/.test(event)) return "서류";
    return "기타";
  }

  /* text → { records, schedule, errors }. errors가 있으면 저장하지 않는다.
     opts.today: "YYYY-MM-DD"(일정 D-day 기준), opts.shiftTo: 예시 데이터를 오늘로 옮길 때 기준일 */
  function parse(text, opts = {}) {
    const rows = parseRows(text);
    if (rows.error) return { records: [], schedule: [], errors: [rows.error] };
    const errors = [];
    if (rows.length < 2) return { records: [], schedule: [], errors: ["머리글과 데이터가 한 줄 이상 있어야 한다."] };
    const head = rows[0].map(squash);
    const col = {};
    for (const [key, names] of Object.entries(COLUMNS)) {
      const i = head.findIndex(h => names.map(squash).includes(h) || names.includes(h.toLowerCase()));
      if (i >= 0) col[key] = i;
    }
    ["company", "submitted"].forEach(k => {
      if (col[k] === undefined) errors.push(`필수 열이 없다: ${COLUMNS[k][0]}`);
    });
    if (errors.length) return { records: [], schedule: [], errors };

    const shift = opts.shiftTo && opts.anchor ? toDay(opts.shiftTo) - toDay(opts.anchor) : 0;
    const now = new Date();
    const today = opts.today || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const get = (row, k) => (col[k] === undefined ? "" : String(row[col[k]] ?? "").trim());
    const records = [], schedule = [];

    rows.slice(1).forEach((row, idx) => {
      const line = rows.lines[idx + 1];
      if (row.length > head.length) { errors.push(`${line}행: 칸이 머리글보다 많다. 쉼표가 든 값은 큰따옴표로 감싸야 한다.`); return; }
      const company = clean(get(row, "company"));
      if (!company) { errors.push(`${line}행: 회사가 비어 있다.`); return; }
      const sub = parseDate(get(row, "submitted"));
      if (!sub) { errors.push(`${line}행: 제출일을 YYYY-MM-DD로 적어야 한다 (${get(row, "submitted") || "빈 칸"}).`); return; }
      const rdRaw = get(row, "resultDate");
      const rd = rdRaw ? parseDate(rdRaw) : null;
      if (rdRaw && !rd) { errors.push(`${line}행: 결과일 형식이 틀렸다 (${rdRaw}).`); return; }
      const resRaw = get(row, "result");
      const o = resRaw ? RESULT_OF[squash(resRaw)] || RESULT_OF[resRaw.toLowerCase()] : "PENDING";
      if (!o) { errors.push(`${line}행: 결과를 알 수 없다 (${resRaw}). ${RESULT_NAMES} 중 하나.`); return; }
      const stRaw = get(row, "stage");
      const s = stRaw ? Number(stRaw) : STAGE_GUESS[o] || 1;
      if (!Number.isInteger(s) || s < 1 || s > 5) { errors.push(`${line}행: 최고단계는 1∼5 숫자다 (${stRaw}).`); return; }
      const d = shiftDate(sub.date, shift);
      const rdDate = rd ? shiftDate(rd.date, shift) : null;
      if (rdDate && rdDate < d) { errors.push(`${line}행: 결과일이 제출일보다 앞선다.`); return; }
      const rec = {
        c: company,
        t: clean(get(row, "type")) || "미입력",
        e: clean(get(row, "employment")) || "미입력",
        j: clean(get(row, "track")) || "미입력",
        d, rd: rdDate, o, s,
        n: clean(get(row, "memo")),
      };
      if (/^(y|yes|true|1|예|o|추정)$/i.test(get(row, "estimated"))) rec.est = true;
      records.push(rec);

      const ndRaw = get(row, "nextDate");
      const event = clean(get(row, "nextEvent"));
      if (ndRaw || event) {
        const nd = ndRaw ? parseDate(ndRaw) : null;
        if (ndRaw && !nd) { errors.push(`${line}행: 다음일정일 형식이 틀렸다 (${ndRaw}).`); return; }
        const date = nd ? shiftDate(nd.date, shift) : null;
        const dday = date ? toDay(date) - toDay(today) : null;
        if (dday === null || dday >= 0) {
          schedule.push({ company, event: event || "일정", kind: kindOf(event), date, time: nd ? nd.time : "", dday });
        }
      }
    });
    schedule.sort((a, b) => (a.dday ?? 1e9) - (b.dday ?? 1e9));
    return { records, schedule, errors };
  }

  /* 엑셀 한국어판은 CSV를 CP949로 저장한다. UTF-8로 안 읽히면 EUC-KR로 다시 읽는다. */
  function decode(buffer) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
    catch (_) { return new TextDecoder("euc-kr").decode(buffer); }
  }

  root.JobdashCSV = { parse, parseRows, decode, kindOf };
})(typeof window !== "undefined" ? window : globalThis);
