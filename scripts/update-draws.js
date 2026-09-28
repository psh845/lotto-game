#!/usr/bin/env node
// index.html에 내장된 로또 1등 당첨번호 데이터를 최신 회차로 갱신한다.
// 사용법: node scripts/update-draws.js   (Node 18 이상)
//
// 서로 독립적인 공개 데이터셋 두 곳에서 받아 모든 회차가 일치할 때만 반영한다.
// (원본 출처는 둘 다 동행복권 dhlottery.co.kr)

const fs = require("fs");
const path = require("path");

const HTML_PATH = path.join(__dirname, "..", "index.html");
const SOURCES = [
    {
        name: "uriseozz/lotto-data",
        url: "https://raw.githubusercontent.com/uriseozz/lotto-data/main/lotto.json",
        parse: json => json.rounds.map(d => ({
            round: d.id,
            date: d.draw_date,
            numbers: [d.n1, d.n2, d.n3, d.n4, d.n5, d.n6]
        }))
    },
    {
        name: "jeong760/lotto-data",
        url: "https://raw.githubusercontent.com/jeong760/lotto-data/main/data/lotto-history.json",
        parse: json => json.data.map(d => ({
            round: d.drawNo,
            date: d.date,
            numbers: d.numbers
        }))
    }
];
const DRAWS_PER_LINE = 10;

async function fetchSource(source) {
    const res = await fetch(source.url);
    if (!res.ok) throw new Error(`${source.name}: HTTP ${res.status}`);
    const draws = source.parse(await res.json())
        .map(d => ({ ...d, numbers: [...d.numbers].sort((a, b) => a - b) }))
        .sort((a, b) => a.round - b.round);
    validate(source.name, draws);
    return draws;
}

function validate(name, draws) {
    draws.forEach((d, i) => {
        if (d.round !== i + 1) throw new Error(`${name}: ${i + 1}회가 없거나 순서가 어긋남`);
        const valid = d.numbers.length === 6
            && new Set(d.numbers).size === 6
            && d.numbers.every(n => Number.isInteger(n) && n >= 1 && n <= 45);
        if (!valid) throw new Error(`${name}: ${d.round}회 번호가 올바르지 않음 (${d.numbers})`);
    });
}

function currentRoundCount(html) {
    const block = html.match(/const DRAW_DATA = `([\s\S]*?)`;/);
    if (!block) throw new Error("index.html에서 DRAW_DATA 블록을 찾지 못함");
    return block[1].trim().split(/[\s,]+/).length / 6;
}

async function main() {
    const [primary, secondary] = await Promise.all(SOURCES.map(fetchSource));

    const common = Math.min(primary.length, secondary.length);
    for (let i = 0; i < common; i++) {
        if (primary[i].numbers.join() !== secondary[i].numbers.join()) {
            throw new Error(`${i + 1}회 번호가 데이터셋끼리 다름: ${primary[i].numbers} / ${secondary[i].numbers}`);
        }
    }
    // 한쪽만 먼저 갱신된 경우 교차검증된 회차까지만 반영한다.
    const draws = primary.slice(0, common);
    const latest = draws[draws.length - 1];

    const raw = fs.readFileSync(HTML_PATH, "utf8");
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    let html = raw.replace(/\r\n/g, "\n");

    const before = currentRoundCount(html);
    if (draws.length < before) {
        throw new Error(`받은 데이터(${draws.length}회)가 현재 내장 데이터(${before}회)보다 오래됨`);
    }

    const lines = [];
    for (let i = 0; i < draws.length; i += DRAWS_PER_LINE) {
        lines.push(draws.slice(i, i + DRAWS_PER_LINE).map(d => d.numbers.join(",")).join(" "));
    }

    html = html
        .replace(/const DRAW_DATA = `[\s\S]*?`;/, () => `const DRAW_DATA = \`\n${lines.join("\n")}\n\`;`)
        .replace(/const DRAW_DATA_LATEST_DATE = "[^"]*";/, `const DRAW_DATA_LATEST_DATE = "${latest.date}";`)
        .replace(/<strong id="roundCount">\d+<\/strong>/, `<strong id="roundCount">${latest.round}</strong>`);

    fs.writeFileSync(HTML_PATH, html.replace(/\n/g, eol));

    if (latest.round === before) {
        console.log(`이미 최신입니다: ${latest.round}회 (${latest.date})`);
    } else {
        console.log(`${before}회 → ${latest.round}회로 갱신 (${latest.date}, ${latest.numbers.join(", ")})`);
    }
}

main().catch(err => {
    console.error(`갱신 실패: ${err.message}`);
    process.exit(1);
});
