/*************************************************
 * Storage Keys
 *************************************************/
const SRS_KEY = "srs_v3";
const DAILY_KEY = "daily_v3";

/*************************************************
 * Time helpers
 *************************************************/
function todayDay() {
  return Math.floor(Date.now() / 86400000);
}

/*************************************************
 * SRS
 *************************************************/
function loadSrs() {
  return JSON.parse(localStorage.getItem(SRS_KEY)) || {};
}
function saveSrs() {
  localStorage.setItem(SRS_KEY, JSON.stringify(srs));
}
let srs = loadSrs();

/*************************************************
 * Daily goal
 *************************************************/
function loadDaily() {
  return JSON.parse(localStorage.getItem(DAILY_KEY)) || {
    day: todayDay(),
    goodCount: 0,
    goal: 10
  };
}
function saveDaily() {
  localStorage.setItem(DAILY_KEY, JSON.stringify(daily));
}
let daily = loadDaily();

function ensureDaily() {
  const t = todayDay();
  if (daily.day !== t) {
    daily = { day: t, goodCount: 0, goal: daily.goal || 10 };
    saveDaily();
  }
}

/*************************************************
 * State
 *************************************************/
let cards = [];
let cardsByMode = [];
let index = 0;
let revealed = false;
let currentAnswer = "";

/*************************************************
 * DOM
 *************************************************/
const jpEl = document.getElementById("jp");
const enEl = document.getElementById("en");
const cardEl = document.getElementById("card");
const nextBtn = document.getElementById("next");
const videoBtn = document.getElementById("videoOrder");
const againBtn = document.getElementById("again");
const goodBtn = document.getElementById("good");
const reviewBtn = document.getElementById("review");

// NOTE（V3.4）
const noteEl = document.getElementById("noteText");

/*************************************************
 * CSV Loader
 *
 * CSV header:
 * no,jp,en,slots,video,lv,note
 *************************************************/
async function loadCSV() {
  const res = await fetch("data.csv");
  const text = await res.text();
  cards = parseCSV(text);

  cardsByMode = getCardsByBlock(1);
  index = 0;
  revealed = false;

  renderBlockButtons();
  render();
}

function parseCSV(text) {
  const lines = text.trim().split("\n");
  lines.shift(); // header

  return lines.map(line => {
    const cols = splitCSV(line);

    const no = Number(cols[0]);
    const jp = cols[1] || "";
    const en = cols[2] || "";
    const slotsRaw = cols[3] || "";
    const video = cols[4] || "";
    const lv = Number(cols[5] || "1");
    const note = cols[6] || ""; // ★追加（V3.4）

    let slots = null;
    if (slotsRaw) {
      slots = slotsRaw.split("|").map(s => {
        const [jpSlot, enSlot] = s.split("=");
        return { jp: jpSlot, en: enSlot };
      });
    }

    return { no, jp, en, slots, video, lv, note };
  });
}

// Safari対応CSV split
function splitCSV(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;

  for (let c of line) {
    if (c === '"') inQuotes = !inQuotes;
    else if (c === "," && !inQuotes) {
      result.push(cur);
      cur = "";
    } else cur += c;
  }
  result.push(cur);

  // 前後の " を外す
  return result.map(s => s.replace(/^"|"$/g, ""));
}

/*************************************************
 * Block helpers
 *************************************************/
function getBlockIndex(no) {
  return Math.floor((no - 1) / 30) + 1;
}

function getCardsByBlock(blockIndex) {
  return [...cards]
    .filter(c => getBlockIndex(c.no) === blockIndex)
    .sort((a, b) => a.no - b.no);
}

function getMaxBlock() {
  if (!cards.length) return 1;
  const maxNo = Math.max(...cards.map(c => c.no));
  return Math.ceil(maxNo / 30);
}

/*************************************************
 * Progress helpers (V3.1)
 *************************************************/
function getBlockProgress(blockIndex) {
  const blockCards = getCardsByBlock(blockIndex);
  const total = blockCards.length;

  // interval>0 を「GOOD済み」とみなす
  const learned = blockCards.filter(c => {
    const s = srs[c.no];
    return s && s.interval > 0;
  }).length;

  return { learned, total };
}

function getCurrentBlockIndex() {
  if (!cardsByMode.length) return 1;
  return getBlockIndex(cardsByMode[0].no);
}

function renderProgress() {
  const blockIndex = getCurrentBlockIndex();
  const { learned, total } = getBlockProgress(blockIndex);

  const textEl = document.getElementById("progressText");
  const barEl = document.getElementById("progressBar");
  if (!textEl || !barEl) return;

  textEl.textContent = `ブロック ${blockIndex}：${learned} / ${total}`;
  const percent = total ? Math.round((learned / total) * 100) : 0;
  barEl.style.width = `${percent}%`;
}

/*************************************************
 * Daily UI (V3.2)
 *************************************************/
function renderDaily() {
  ensureDaily();

  const textEl = document.getElementById("dailyText");
  const barEl = document.getElementById("dailyBar");
  if (!textEl || !barEl) return;

  const goal = daily.goal || 10;
  const done = daily.goodCount || 0;

  textEl.textContent = `今日: ${Math.min(done, goal)} / ${goal}`;
  const percent = goal ? Math.min(100, Math.round((done / goal) * 100)) : 0;
  barEl.style.width = `${percent}%`;
}

/*************************************************
 * Block UI
 *************************************************/
function renderBlockButtons() {
  const wrap = document.getElementById("blocks");
  if (!wrap) return;

  wrap.innerHTML = "";
  const max = getMaxBlock();

  for (let b = 1; b <= max; b++) {
    const { learned, total } = getBlockProgress(b);
    const percent = total ? Math.round((learned / total) * 100) : 0;

    const btn = document.createElement("button");
    const start = (b - 1) * 30 + 1;
    const end = b * 30;
    btn.textContent = `${start}-${end} ${percent}%`;
    btn.onclick = () => startBlock(b);

    wrap.appendChild(btn);
  }
}

/*************************************************
 * Mode starters
 *************************************************/
function startBlock(blockIndex) {
  const list = getCardsByBlock(blockIndex);
  if (!list.length) return;

  cardsByMode = list;
  index = 0;
  revealed = false;
  render();
}

function startVideoOrder() {
  cardsByMode = [...cards].sort((a, b) => a.no - b.no);
  index = 0;
  revealed = false;
  render();
}

function startReviewDue() {
  const t = todayDay();

  // 未登録は「今日Due」扱いにしない（復習が爆発するので）
  const due = cards.filter(c => (srs[c.no]?.due ?? Infinity) <= t);

  if (!due.length) {
    alert("復習（Due）はありません");
    return;
  }

  cardsByMode = due.sort((a, b) => a.no - b.no);
  index = 0;
  revealed = false;
  render();
}

/*************************************************
 * Card Logic
 *************************************************/
function pickSlot(card) {
  if (!card.slots) return null;
  const i = Math.floor(Math.random() * card.slots.length);
  return card.slots[i];
}

function renderNote(card) {
  if (!noteEl) return;
  noteEl.textContent = card.note ? `💡 ${card.note}` : "";
}

function render() {
  if (!cardsByMode.length) return;

  const card = cardsByMode[index];
  const slot = pickSlot(card);

  if (slot) {
    jpEl.textContent = card.jp.replace("{x}", slot.jp);
    currentAnswer = card.en.replace("{x}", slot.en);
    enEl.textContent = revealed
      ? currentAnswer
      : card.en.replace("{x}", "___");
  } else {
    jpEl.textContent = card.jp;
    currentAnswer = card.en;
    enEl.textContent = revealed ? currentAnswer : "タップして答え";
  }

  renderNote(card);     // ★追加（V3.4）
  renderProgress();
  renderDaily();
}

/*************************************************
 * SRS grading
 *************************************************/
function nextIntervalGood(prev) {
  if (prev <= 0) return 1;
  if (prev === 1) return 2;
  if (prev === 2) return 4;
  if (prev === 4) return 7;
  if (prev === 7) return 15;
  if (prev === 15) return 30;
  return Math.min(120, Math.round(prev * 2));
}

function gradeAgain() {
  if (!cardsByMode.length) return;

  const card = cardsByMode[index];
  const t = todayDay();

  srs[card.no] = { interval: 0, due: t };
  saveSrs();

  index = (index + 1) % cardsByMode.length;
  revealed = false;
  render();
}

function gradeGood() {
  if (!cardsByMode.length) return;

  const card = cardsByMode[index];
  const t = todayDay();

  const prev = srs[card.no]?.interval ?? 0;
  const interval = nextIntervalGood(prev);
  const due = t + interval;

  srs[card.no] = { interval, due };
  saveSrs();

  ensureDaily();
  daily.goodCount = (daily.goodCount || 0) + 1;
  saveDaily();

  // 進捗％を更新（ブロックボタンの表示も更新）
  renderBlockButtons();

  index = (index + 1) % cardsByMode.length;
  revealed = false;
  render();
}

/*************************************************
 * Events
 *************************************************/
cardEl.addEventListener("click", () => {
  revealed = !revealed;
  enEl.textContent = revealed ? currentAnswer : "タップして答え";
});

nextBtn.addEventListener("click", () => {
  if (!cardsByMode.length) return;
  index = (index + 1) % cardsByMode.length;
  revealed = false;
  render();
});

videoBtn?.addEventListener("click", startVideoOrder);
againBtn?.addEventListener("click", gradeAgain);
goodBtn?.addEventListener("click", gradeGood);
reviewBtn?.addEventListener("click", startReviewDue);

/*************************************************
 * Init
 *************************************************/
loadCSV();
