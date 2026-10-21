"""가상 예시 데이터(sample.csv, sample-data.js)를 만든다. 회사명은 전부 지어낸 이름이다.

    python3 scripts/make_sample.py

날짜는 ANCHOR 기준으로 만들고, 화면은 열 때마다 오늘 날짜로 옮겨 보여 준다.
"""
import csv
import io
import json
import random
from datetime import date, timedelta
from pathlib import Path

ANCHOR = date(2026, 10, 21)
ROOT = Path(__file__).resolve().parent.parent
rng = random.Random(11)

PREFIX = ["가나", "다라", "마바", "사아", "자차", "카타", "파하", "가다", "나라", "마사"]
SUFFIX = {
    "대기업": ["전자", "물산", "화학", "통신", "모빌리티"],
    "공공": ["공사", "공단", "진흥원", "연구원"],
    "금융": ["은행", "증권", "캐피탈", "카드"],
    "중견·중소": ["정보", "시스템", "테크"],
    "스타트업": ["랩스", "데이터", "소프트"],
}
TYPES = [("대기업", 30), ("공공", 25), ("금융", 15), ("중견·중소", 18), ("스타트업", 12)]
EMPLOY = [("정규직", 62), ("전환형인턴", 16), ("체험형인턴", 12), ("계약직", 10)]
TRACKS = [("AI·데이터", 32), ("개발·전산", 30), ("사무·행정", 22), ("기획", 16)]
DOC_PASS = {"공공": 0.30, "스타트업": 0.32, "대기업": 0.16, "금융": 0.10, "중견·중소": 0.26}
EVENTS = ["1차 면접", "필기 NCS", "서류 발표", "코딩테스트", "최종 발표", "인적성 검사"]


def pick(pairs):
    return rng.choices([p for p, _ in pairs], [w for _, w in pairs])[0]


def make():
    rows = []
    weeks = 22
    for w in range(weeks):
        week_start = ANCHOR - timedelta(days=(weeks - w) * 7)
        for _ in range(rng.randint(4, 7 + w // 3)):
            sub = week_start + timedelta(days=rng.randint(0, 6))
            if sub > ANCHOR:
                continue
            t = pick(TYPES)
            company = rng.choice(PREFIX) + rng.choice(SUFFIX[t])
            e, j = pick(EMPLOY), pick(TRACKS)
            rows.append(simulate(company, t, e, j, sub))
    rows.sort(key=lambda r: r["제출일"])
    add_schedule(rows)
    return rows


def simulate(company, t, e, j, sub):
    row = {"회사": company, "기관유형": t, "고용형태": e, "직무": j, "제출일": sub.isoformat(),
           "결과일": "", "결과": "진행중", "최고단계": 1, "제출일추정": "", "메모": "신입 공채", "다음일정일": "", "다음일정": ""}
    if rng.random() < 0.07:
        row["제출일추정"] = "예"
    r = rng.random()
    if r < 0.05:
        row["결과"], row["메모"] = "철회", "일정이 겹쳐 철회"
        return row
    if r < 0.07:
        row["결과"] = "무응답"
        return row
    if r < 0.11:
        return row  # 통보 없이 오래 기다리는 건(평소보다 늦음 예시)
    lead = max(6, int(rng.gauss(19, 7)))
    rd = sub + timedelta(days=lead)
    if rd > ANCHOR:
        return row  # 아직 서류 결과 대기
    rate = DOC_PASS[t] * (1.6 if e == "체험형인턴" else 1.0)
    if rng.random() > rate:
        row.update(결과="서류 탈락", 결과일=rd.isoformat())
        return row
    row["최고단계"] = 2
    rd2 = rd + timedelta(days=rng.randint(7, 16))
    if rd2 > ANCHOR:
        row["메모"] = "서류 합격"
        return row
    if rng.random() < 0.42:
        kind = rng.choice(["NCS", "코테"])
        row.update(결과="필기 탈락", 결과일=rd2.isoformat(), 메모=f"필기 {kind}" if kind == "NCS" else "코테")
        return row
    row["최고단계"] = 3
    if rng.random() < 0.15:
        row.update(결과="철회", 결과일=rd2.isoformat(), 메모="필기 합격 뒤 면접 불참")
        return row
    row["최고단계"] = 4
    rd3 = rd2 + timedelta(days=rng.randint(10, 20))
    if rd3 > ANCHOR:
        row["메모"] = "면접 응시"
        return row
    if rng.random() < 0.85:
        row.update(결과="면접 탈락", 결과일=rd3.isoformat())
    else:
        row.update(결과="최종합격", 결과일=rd3.isoformat(), 최고단계=5)
    return row


def add_schedule(rows):
    live = [r for r in rows if r["결과"] == "진행중"]
    for r in sorted(live, key=lambda r: -r["최고단계"])[:3] + rng.sample(live, 3):
        if r["다음일정일"]:
            continue
        r["다음일정일"] = (ANCHOR + timedelta(days=rng.randint(1, 18))).isoformat()
        r["다음일정"] = rng.choice(EVENTS if r["최고단계"] >= 2 else ["서류 발표"])


def main():
    rows = make()
    buf = io.StringIO()
    wr = csv.DictWriter(buf, fieldnames=list(rows[0].keys()), lineterminator="\n")
    wr.writeheader()
    wr.writerows(rows)
    text = buf.getvalue()
    (ROOT / "sample.csv").write_text("﻿" + text, encoding="utf-8")  # BOM: 엑셀에서 한글이 깨지지 않게
    (ROOT / "sample-data.js").write_text(
        "/* scripts/make_sample.py가 만든 가상 예시. 직접 고치지 말고 스크립트를 다시 돌린다. */\n"
        f"window.SAMPLE_ANCHOR = {json.dumps(ANCHOR.isoformat())};\n"
        f"window.SAMPLE_CSV = {json.dumps(text, ensure_ascii=False)};\n",
        encoding="utf-8",
    )
    print(f"{len(rows)}건 생성")


if __name__ == "__main__":
    main()
