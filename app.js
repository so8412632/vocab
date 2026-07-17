"use strict";

/* ---------------------------------------------------------------
 * 英文單字小助手 — 完整功能、免費版
 * - 字典資料：Free Dictionary API（免金鑰）
 * - 中文翻譯：MyMemory Translation API（免金鑰）
 * - KK音標／文法提醒：Google Gemini API（免費額度，需自行申請 key，見 config.js）
 * - 收藏／測驗／統計資料：全部存在瀏覽器 localStorage
 * ------------------------------------------------------------- */

const DICTIONARY_API = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const TRANSLATE_API = "https://api.mymemory.translated.net/get";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
const STORAGE_KEY = "vocabBookV2";
const STREAK_KEY = "vocabStreakV1";
const MAX_TRANSLATIONS_PER_LOOKUP = 4;

// ---------- tiny DOM helpers ----------
const $ = (id) => document.getElementById(id);
const el = (tag, className, html) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
};
const escapeHtml = (str) =>
  String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function shortMeaning(entry) {
  const d = entry.meanings?.[0]?.definitions?.[0];
  if (!d) return "（無資料）";
  return d.zh || d.en || "（無資料）";
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const LIGHT_META = {
  unrated: { color: "var(--muted)", label: "Untested", dot: "#D8CDB4" },
  red: { color: "var(--red)", label: "Red · New", dot: "var(--red)" },
  yellow: { color: "var(--amber)", label: "Yellow · Learning", dot: "var(--amber)" },
  green: { color: "var(--green)", label: "Green · Mastered", dot: "var(--green)" },
};
const LIGHT_ORDER = ["red", "yellow", "green", "unrated"];

function nextLight(current, correct) {
  if (!correct) return "red";
  if (current === "green") return "green";
  if (current === "yellow") return "green";
  return "yellow";
}

// ---------- localStorage: vocab book ----------
function loadBook() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("讀取單字本失敗:", e);
    return [];
  }
}
function persistBook() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(book));
  } catch (e) {
    console.error("儲存單字本失敗:", e);
  }
}
let book = loadBook();

function findEntry(word) {
  return book.find((e) => e.word.toLowerCase() === word.toLowerCase());
}
function isSaved(word) {
  return !!findEntry(word);
}
function upsertEntry(entry) {
  const idx = book.findIndex((e) => e.word.toLowerCase() === entry.word.toLowerCase());
  if (idx >= 0) book[idx] = entry;
  else book.unshift(entry);
  persistBook();
}
function saveNewWord(entry) {
  upsertEntry({
    ...entry,
    light: entry.light || "unrated",
    stats: entry.stats || { attempts: 0, correct: 0 },
    savedAt: Date.now(),
  });
  refreshAllBookDependentUI();
}
function removeWord(word) {
  book = book.filter((e) => e.word.toLowerCase() !== word.toLowerCase());
  persistBook();
  refreshAllBookDependentUI();
}

function loadStreak() {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    return raw ? JSON.parse(raw) : { lastDate: null, streak: 0 };
  } catch (e) {
    return { lastDate: null, streak: 0 };
  }
}
function bumpStreak() {
  const meta = loadStreak();
  const today = todayStr();
  if (meta.lastDate === today) return meta;
  let streak = 1;
  if (meta.lastDate) {
    const diffDays = Math.round((new Date(today) - new Date(meta.lastDate)) / 86400000);
    if (diffDays === 1) streak = (meta.streak || 0) + 1;
  }
  const updated = { lastDate: today, streak };
  try {
    localStorage.setItem(STREAK_KEY, JSON.stringify(updated));
  } catch (e) {}
  return updated;
}

// ---------- dictionary + translation + AI enrichment ----------
function containsChinese(str) {
  return /[\u4e00-\u9fff]/.test(str);
}

async function translateText(text, from, to) {
  try {
    const url = `${TRANSLATE_API}?q=${encodeURIComponent(text)}&langpair=${from}|${to}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const translated = data?.responseData?.translatedText;
    if (!translated) return null;
    if (/MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(translated)) return null;
    return translated;
  } catch (e) {
    return null;
  }
}

async function resolveSearchTerm(rawInput) {
  const trimmed = rawInput.trim();
  if (!containsChinese(trimmed)) return trimmed;

  const translated = await translateText(trimmed, "zh-TW", "en");
  if (!translated) {
    throw new Error("無法把這段中文翻成英文，請試試看直接輸入英文單字。");
  }
  const match = translated.match(/[a-zA-Z][a-zA-Z'-]*/);
  if (!match) {
    throw new Error(`翻譯結果「${translated}」裡找不到可用的英文單字。`);
  }
  return match[0];
}

async function fetchDictionaryEntry(word) {
  let response;
  try {
    response = await fetch(DICTIONARY_API + encodeURIComponent(word));
  } catch (netErr) {
    throw new Error(`連線失敗，請檢查網路連線：${netErr.message}`);
  }
  if (response.status === 404) {
    throw new Error(`查無「${word}」這個字，請確認拼字是否正確。`);
  }
  if (!response.ok) {
    throw new Error(`字典服務暫時無法使用（狀態碼 ${response.status}），請稍後再試。`);
  }
  let data;
  try {
    data = await response.json();
  } catch (e) {
    throw new Error("字典服務回傳的資料格式有誤，請稍後再試。");
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`查無「${word}」這個字。`);
  }
  return normalizeEntries(data);
}

function normalizeEntries(entries) {
  const word = entries[0].word;

  const phoneticRows = [];
  const seenLabels = new Set();
  for (const entry of entries) {
    for (const p of entry.phonetics || []) {
      if (!p.audio) continue;
      let label = "發音";
      const lower = p.audio.toLowerCase();
      if (lower.includes("-us") || lower.includes("us.mp3") || lower.includes("_us")) label = "美式";
      else if (lower.includes("-uk") || lower.includes("uk.mp3") || lower.includes("_uk")) label = "英式";
      else if (lower.includes("-au")) label = "澳式";
      if (seenLabels.has(label)) continue;
      seenLabels.add(label);
      phoneticRows.push({ label, ipa: p.text || entries[0].phonetic || "", audio: p.audio });
    }
  }
  if (phoneticRows.length === 0) {
    const anyIpa =
      entries[0].phonetic || (entries[0].phonetics || []).map((p) => p.text).find(Boolean) || "";
    phoneticRows.push({ label: "音標", ipa: anyIpa, audio: null });
  }

  const meanings = [];
  for (const entry of entries) {
    for (const m of entry.meanings || []) {
      meanings.push({
        partOfSpeech: m.partOfSpeech || "",
        definitions: (m.definitions || []).slice(0, 3).map((d) => ({
          en: d.definition || "",
          example: d.example || "",
          synonyms: d.synonyms || [],
          zh: null,
        })),
      });
    }
  }

  return { word, phoneticRows, meanings, kk: null, grammar: null };
}

async function fetchGeminiExtras(word, meaning) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY.includes("貼上你的")) return null;

  const prompt = `You are an English dictionary assistant for Taiwanese learners.
Word: "${word}"
English meaning: "${meaning}"

Reply with ONLY raw JSON (no markdown fences, no extra text), in this exact shape:
{"kk": "KK phonetic notation commonly used in Taiwan, no slashes or brackets", "grammar": "1 short usage/grammar tip in Traditional Chinese, 20-40 characters, focused on common mistakes or usage notes for this word"}`;

  try {
    const url = `${GEMINI_API_BASE}${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(
      GEMINI_API_KEY
    )}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 200 },
      }),
    });
    const rawBody = await res.text();
    if (!res.ok) {
      console.warn("Gemini API 錯誤:", rawBody.slice(0, 300));
      return null;
    }
    const data = JSON.parse(rawBody);
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || "")
      .join("")
      .trim();
    if (!text) return null;
    const match = text.match(/\{[\s\S]*\}/);
    const candidate = match ? match[0] : text;
    return JSON.parse(candidate);
  } catch (e) {
    console.warn("Gemini 呼叫失敗:", e);
    return null;
  }
}

async function fillTranslations(entry, onUpdate) {
  let count = 0;
  for (const m of entry.meanings) {
    for (const d of m.definitions) {
      if (count >= MAX_TRANSLATIONS_PER_LOOKUP) return;
      if (!d.en) continue;
      count++;
      translateText(d.en, "en", "zh-TW").then((zh) => {
        if (!zh) return;
        d.zh = zh;
        onUpdate && onUpdate();
      });
    }
  }
}

async function lookupWord(rawInput) {
  const term = await resolveSearchTerm(rawInput);
  const entry = await fetchDictionaryEntry(term);
  return entry;
}

// ---------- rendering: search result card ----------
function renderResultCard(entry) {
  const card = $("resultCard");
  card.hidden = false;
  card.innerHTML = "";

  const saved = isSaved(entry.word);

  const head = el("div", "card-head");
  head.appendChild(el("h2", "card-word", escapeHtml(entry.word)));
  const saveBtn = el("button", "save-btn" + (saved ? " saved" : ""), saved ? "★ 已收藏" : "☆ 收藏");
  saveBtn.addEventListener("click", () => {
    if (isSaved(entry.word)) {
      removeWord(entry.word);
      saveBtn.className = "save-btn";
      saveBtn.textContent = "☆ 收藏";
    } else {
      saveNewWord(entry);
      saveBtn.className = "save-btn saved";
      saveBtn.textContent = "★ 已收藏";
    }
  });
  head.appendChild(saveBtn);
  card.appendChild(head);

  const linkWrap = el("div", "card-link");
  const cambridgeUrl =
    "https://dictionary.cambridge.org/zht/dictionary/english-chinese-traditional/" +
    encodeURIComponent(entry.word.toLowerCase());
  linkWrap.innerHTML = `<a href="${cambridgeUrl}" target="_blank" rel="noopener noreferrer">在劍橋字典網站上查看「${escapeHtml(
    entry.word
  )}」 ↗</a>`;
  card.appendChild(linkWrap);

  const body = el("div", "card-body");

  // pronunciation
  const pronSection = el("div", "section");
  pronSection.appendChild(el("div", "section-label", "🔊 發音"));
  entry.phoneticRows.forEach((row) => {
    const rowEl = el("div", "pron-row");
    rowEl.appendChild(
      el(
        "span",
        "pron-ipa",
        (row.ipa ? `/${escapeHtml(row.ipa.replace(/\//g, ""))}/` : "（無音標資料）") +
          `<span class="pron-source">${escapeHtml(row.label)}</span>`
      )
    );
    const playBtn = el("button", "play-btn", "▶");
    playBtn.type = "button";
    if (row.audio) {
      playBtn.addEventListener("click", () => {
        new Audio(row.audio).play().catch(() => {});
      });
    } else {
      playBtn.disabled = true;
    }
    rowEl.appendChild(playBtn);
    pronSection.appendChild(rowEl);
  });

  const kkRow = el("div", "pron-row");
  kkRow.appendChild(
    el("span", "pron-ipa kk-slot", `<span class="pron-source">KK 音標</span> 生成中…`)
  );
  pronSection.appendChild(kkRow);

  if ("speechSynthesis" in window) {
    const ttsRow = el("div", "pron-row");
    ttsRow.appendChild(el("span", "pron-ipa", `裝置語音朗讀<span class="pron-source">系統語音</span>`));
    const ttsBtn = el("button", "play-btn", "🔈");
    ttsBtn.type = "button";
    ttsBtn.addEventListener("click", () => {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(entry.word);
      utter.lang = "en-US";
      utter.rate = 0.9;
      window.speechSynthesis.speak(utter);
    });
    ttsRow.appendChild(ttsBtn);
    pronSection.appendChild(ttsRow);
  }
  body.appendChild(pronSection);

  // meanings
  const meanSection = el("div", "section");
  meanSection.appendChild(el("div", "section-label", "📖 詞性與解釋"));
  entry.meanings.forEach((m) => {
    const blockEl = el("div", "meaning-block");
    if (m.partOfSpeech) blockEl.appendChild(el("span", "pos-tag", escapeHtml(m.partOfSpeech)));
    m.definitions.forEach((d) => {
      const item = el("div", "def-item");
      item.appendChild(el("div", "def-en", escapeHtml(d.en)));
      const zhSlot = el("div", "def-zh-slot", d.zh ? escapeHtml(d.zh) : "");
      zhSlot.hidden = !d.zh;
      d._zhSlotEl = zhSlot;
      item.appendChild(zhSlot);
      if (d.example) item.appendChild(el("div", "def-example", `例句： ${escapeHtml(d.example)}`));
      if (d.synonyms?.length) {
        const synWrap = el("div", "syn-list");
        d.synonyms.slice(0, 6).forEach((s) => synWrap.appendChild(el("span", "syn-chip", escapeHtml(s))));
        item.appendChild(synWrap);
      }
      blockEl.appendChild(item);
    });
    meanSection.appendChild(blockEl);
  });
  body.appendChild(meanSection);

  // grammar (filled async)
  const grammarSection = el("div", "section grammar-section");
  grammarSection.appendChild(el("div", "section-label", "✎ 用法 / 文法提醒"));
  grammarSection.appendChild(el("div", "grammar-slot", "AI 生成中…"));
  grammarSection.hidden = !GEMINI_API_KEY || GEMINI_API_KEY.includes("貼上你的");
  body.appendChild(grammarSection);

  card.appendChild(body);

  // async enrichment
  fillTranslations(entry, () => {
    entry.meanings.forEach((m) =>
      m.definitions.forEach((d) => {
        if (d.zh && d._zhSlotEl) {
          d._zhSlotEl.textContent = d.zh;
          d._zhSlotEl.hidden = false;
        }
      })
    );
  });

  const firstMeaning = entry.meanings[0]?.definitions[0]?.en || "";
  fetchGeminiExtras(entry.word, firstMeaning).then((extra) => {
    if (!extra) {
      const kkSlot = card.querySelector(".kk-slot");
      if (kkSlot) kkSlot.innerHTML = `<span class="pron-source">KK 音標</span> （無法生成）`;
      return;
    }
    entry.kk = extra.kk || null;
    entry.grammar = extra.grammar || null;
    const kkSlot = card.querySelector(".kk-slot");
    if (kkSlot && entry.kk) {
      kkSlot.innerHTML = `[${escapeHtml(entry.kk)}]<span class="pron-source">KK 音標</span>`;
    }
    const grammarSlot = card.querySelector(".grammar-slot");
    if (grammarSlot && entry.grammar) {
      grammarSlot.textContent = entry.grammar;
    }
    // if already saved, persist the newly-arrived enrichment
    if (isSaved(entry.word)) {
      upsertEntry({ ...findEntry(entry.word), kk: entry.kk, grammar: entry.grammar });
    }
  });
}

function showStatus(elId, message, kind = "error") {
  const node = $(elId);
  node.hidden = false;
  node.style.background = kind === "error" ? "#FBEAE7" : "#E9F3EC";
  node.style.color = kind === "error" ? "var(--red)" : "var(--green)";
  node.textContent = message;
}
function hideStatus(elId) {
  $(elId).hidden = true;
}

// ================================================================
// BOOK VIEW
// ================================================================
let bookFilter = "all";

function renderLightChips(target, counts) {
  target.innerHTML = "";
  LIGHT_ORDER.forEach((k) => {
    target.appendChild(
      el(
        "span",
        "chip",
        `<span style="color:${LIGHT_META[k].color}">${LIGHT_META[k].label} · ${counts[k] || 0}</span>`
      )
    );
  });
}

function computeLightCounts() {
  const counts = { red: 0, yellow: 0, green: 0, unrated: 0 };
  book.forEach((e) => {
    counts[e.light || "unrated"] = (counts[e.light || "unrated"] || 0) + 1;
  });
  return counts;
}

function renderBookFilterChips() {
  const wrap = $("bookFilterChips");
  wrap.innerHTML = "";
  ["all", ...LIGHT_ORDER].forEach((k) => {
    const label = k === "all" ? "All" : LIGHT_META[k].label;
    const btn = el("button", bookFilter === k ? "active" : "", label);
    btn.type = "button";
    btn.addEventListener("click", () => {
      bookFilter = k;
      renderBookView();
    });
    wrap.appendChild(btn);
  });
}

function renderBookView() {
  const empty = $("bookEmpty");
  const controls = $("bookControls");
  const list = $("bookList");
  list.innerHTML = "";

  if (book.length === 0) {
    empty.hidden = false;
    controls.hidden = true;
    return;
  }
  empty.hidden = true;
  controls.hidden = false;

  renderLightChips($("lightChips"), computeLightCounts());
  renderBookFilterChips();

  const q = ($("bookSearchInput").value || "").trim().toLowerCase();
  let filtered = book;
  if (bookFilter !== "all") filtered = filtered.filter((e) => (e.light || "unrated") === bookFilter);
  if (q) {
    filtered = filtered.filter(
      (e) =>
        e.word.toLowerCase().includes(q) ||
        e.meanings?.some((m) => m.definitions.some((d) => d.en.toLowerCase().includes(q)))
    );
  }

  if (filtered.length === 0) {
    list.appendChild(el("div", "empty-state", "沒有符合條件的單字"));
    return;
  }

  filtered.forEach((entry) => {
    const item = el("div", "book-item");
    const main = el("button", "book-item-main");
    main.type = "button";
    main.innerHTML = `
      <span class="book-item-word">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${
          LIGHT_META[entry.light || "unrated"].dot
        };margin-right:6px;"></span>
        ${escapeHtml(entry.word)}
      </span>
      <span class="book-item-meaning">${escapeHtml(shortMeaning(entry))}</span>
    `;
    main.addEventListener("click", () => {
      renderResultCard(entry);
      $("emptyState").hidden = true;
      $("searchInput").value = entry.word;
      switchView("search");
    });
    item.appendChild(main);

    const removeBtn = el("button", "book-item-remove", "✕");
    removeBtn.type = "button";
    removeBtn.addEventListener("click", () => removeWord(entry.word));
    item.appendChild(removeBtn);

    list.appendChild(item);
  });
}

function refreshAllBookDependentUI() {
  updateBookBadge();
  renderBookView();
  renderQuizSetup();
  renderStatsView();
}
function updateBookBadge() {
  const badge = $("bookCount");
  if (book.length > 0) {
    badge.hidden = false;
    badge.textContent = String(book.length);
  } else {
    badge.hidden = true;
  }
}

// ---------- batch add ----------
async function runBatchAdd() {
  const raw = $("batchTextarea").value;
  const terms = [...new Set(raw.split(/[\n,，、;；]+/).map((s) => s.trim()).filter(Boolean))].slice(
    0,
    30
  );
  if (terms.length === 0) return;

  const resultsEl = $("batchResults");
  resultsEl.innerHTML = "";
  $("batchRunBtn").disabled = true;

  for (const term of terms) {
    const row = el("div", "batch-row", `<span class="word">${escapeHtml(term)}</span> <span class="status">處理中…</span>`);
    resultsEl.appendChild(row);
    try {
      const searchTerm = await resolveSearchTerm(term);
      const existing = findEntry(searchTerm);
      if (existing) {
        row.querySelector(".status").outerHTML = `<span class="status-exists">已存在</span>`;
        continue;
      }
      const entry = await fetchDictionaryEntry(searchTerm);
      saveNewWordSilently(entry);
      row.querySelector(".status").outerHTML = `<span class="status-added">已加入</span>`;
      // best-effort enrichment in the background (not blocking the batch loop)
      const firstMeaning = entry.meanings[0]?.definitions[0]?.en || "";
      fillTranslations(entry, () => upsertEntry(entry));
      fetchGeminiExtras(entry.word, firstMeaning).then((extra) => {
        if (extra) upsertEntry({ ...entry, kk: extra.kk, grammar: extra.grammar });
      });
    } catch (e) {
      row.querySelector(".status").outerHTML = `<span class="status-error">失敗：${escapeHtml(
        e.message
      )}</span>`;
    }
  }

  $("batchRunBtn").disabled = false;
  refreshAllBookDependentUI();
}
function saveNewWordSilently(entry) {
  upsertEntry({ ...entry, light: "unrated", stats: { attempts: 0, correct: 0 }, savedAt: Date.now() });
}

// ---------- export / import ----------
function exportBook() {
  const blob = new Blob([JSON.stringify(book, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vocab-book-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function handleImportFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const arr = JSON.parse(reader.result);
      if (!Array.isArray(arr)) throw new Error("檔案格式不是單字陣列");
      let count = 0;
      arr.forEach((entry) => {
        if (entry && entry.word && entry.meanings) {
          upsertEntry({
            word: entry.word,
            phoneticRows: entry.phoneticRows || [],
            meanings: entry.meanings,
            kk: entry.kk || null,
            grammar: entry.grammar || null,
            light: entry.light || "unrated",
            stats: entry.stats || { attempts: 0, correct: 0 },
            savedAt: entry.savedAt || Date.now(),
          });
          count++;
        }
      });
      showStatus("importMsg", `已匯入／更新 ${count} 個單字`, "success");
      refreshAllBookDependentUI();
    } catch (err) {
      showStatus("importMsg", `匯入失敗：${err.message}`, "error");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
}

// ================================================================
// QUIZ VIEW
// ================================================================
let quizMode = "mc";
let onlyWeak = false;
let quizQueue = [];
let quizIndex = 0;
let quizDirection = "en2zh";
let quizOptions = [];
let quizAnswered = false;
let roundResults = { correct: 0, wrong: 0 };

function getClozeSentence(entry) {
  for (const m of entry.meanings) {
    for (const d of m.definitions) {
      if (!d.example) continue;
      const re = new RegExp(`\\b${escapeRegExp(entry.word)}\\b`, "i");
      if (re.test(d.example)) {
        return { sentence: d.example.replace(re, "▁▁▁▁▁"), zh: d.zh || "" };
      }
    }
  }
  return null;
}

function eligiblePool() {
  let pool = onlyWeak ? book.filter((e) => e.light === "red" || e.light === "yellow") : [...book];
  if (quizMode === "cloze") pool = pool.filter((e) => !!getClozeSentence(e));
  return pool;
}
function minNeededFor(mode) {
  return mode === "spelling" ? 1 : 3;
}

function renderQuizSetup() {
  const noWords = $("quizNoWords");
  const setupBody = $("quizSetupBody");
  if (book.length === 0) {
    noWords.hidden = false;
    setupBody.hidden = true;
    return;
  }
  noWords.hidden = true;
  setupBody.hidden = false;

  renderLightChips($("quizLightChips"), computeLightCounts());

  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === quizMode);
  });
  $("onlyWeakCheckbox").checked = onlyWeak;

  const pool = eligiblePool();
  const needed = minNeededFor(quizMode);
  const poolMsg = $("quizPoolMsg");
  const startWrap = $("quizStartWrap");
  if (pool.length < needed) {
    poolMsg.hidden = false;
    startWrap.hidden = true;
    poolMsg.textContent =
      quizMode === "cloze"
        ? "符合克漏字條件（例句需包含該單字）的收藏字不夠，換個模式或先查更多字吧！"
        : `符合條件的單字不足（需要至少 ${needed} 個，目前 ${pool.length} 個）`;
  } else {
    poolMsg.hidden = true;
    startWrap.hidden = false;
    $("quizStartBtn").textContent = `🔀 開始測驗（共 ${Math.min(pool.length, 10)} 題）`;
  }
}

function buildMcOptions(entry, direction) {
  const others = book.filter((e) => e.word.toLowerCase() !== entry.word.toLowerCase());
  const distractors = shuffle(others).slice(0, 2);
  const getText = (e) => (direction === "en2zh" ? shortMeaning(e) : e.word);
  return shuffle([
    { text: getText(entry), correct: true },
    ...distractors.map((d) => ({ text: getText(d), correct: false })),
  ]);
}
function buildClozeOptions(entry) {
  const others = book.filter((e) => e.word.toLowerCase() !== entry.word.toLowerCase());
  const distractors = shuffle(others).slice(0, 2);
  return shuffle([
    { text: entry.word, correct: true },
    ...distractors.map((d) => ({ text: d.word, correct: false })),
  ]);
}

function startQuiz() {
  const pool = eligiblePool();
  const needed = minNeededFor(quizMode);
  if (pool.length < needed) return;
  quizQueue = shuffle(pool).slice(0, 10);
  quizIndex = 0;
  roundResults = { correct: 0, wrong: 0 };
  $("quizSetup").hidden = true;
  $("quizDone").hidden = true;
  $("quizPlay").hidden = false;
  prepareQuestion();
}

function prepareQuestion() {
  quizAnswered = false;
  const entry = quizQueue[quizIndex];
  $("quizNextBtn").hidden = true;
  $("quizProgressText").textContent = `第 ${quizIndex + 1} / ${quizQueue.length} 題`;
  $("quizScoreText").textContent = `答對 ${roundResults.correct}．答錯 ${roundResults.wrong}`;

  const questionCard = $("quizQuestionCard");
  const optionsWrap = $("quizOptions");
  questionCard.innerHTML = "";
  optionsWrap.innerHTML = "";

  if (quizMode === "mc") {
    quizDirection = Math.random() < 0.5 ? "en2zh" : "zh2en";
    quizOptions = buildMcOptions(entry, quizDirection);
    questionCard.appendChild(
      el(
        "div",
        "quiz-question-label",
        quizDirection === "en2zh" ? "看英文，選出正確的中文意思" : "看中文，選出正確的英文單字"
      )
    );
    if (quizDirection === "en2zh") {
      questionCard.appendChild(el("div", "quiz-question-word", escapeHtml(entry.word)));
    } else {
      questionCard.appendChild(el("div", "quiz-question-meaning", escapeHtml(shortMeaning(entry))));
    }
    renderMcOptions();
  } else if (quizMode === "cloze") {
    const cloze = getClozeSentence(entry);
    quizOptions = buildClozeOptions(entry);
    questionCard.appendChild(el("div", "quiz-question-label", "選出填入空格的正確單字"));
    questionCard.appendChild(el("div", "quiz-sentence", escapeHtml(cloze.sentence)));
    if (cloze.zh) questionCard.appendChild(el("div", "quiz-sentence-zh", escapeHtml(cloze.zh)));
    renderMcOptions(true);
  } else if (quizMode === "spelling") {
    questionCard.appendChild(el("div", "quiz-question-label", "看中文意思，拼出正確的英文單字"));
    questionCard.appendChild(el("div", "quiz-question-meaning", escapeHtml(shortMeaning(entry))));
    const input = el("input", "quiz-spelling-input");
    input.type = "text";
    input.placeholder = "輸入英文單字…";
    input.autocapitalize = "none";
    input.autocorrect = "off";
    input.spellcheck = false;
    input.id = "spellingInput";
    questionCard.appendChild(input);
    const submitBtn = el("button", "primary-btn", "送出答案");
    submitBtn.type = "button";
    submitBtn.style.marginTop = "14px";
    submitBtn.addEventListener("click", submitSpelling);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitSpelling();
    });
    questionCard.appendChild(submitBtn);
  }
}

function renderMcOptions(italic = false) {
  const optionsWrap = $("quizOptions");
  optionsWrap.innerHTML = "";
  quizOptions.forEach((opt, idx) => {
    const btn = el("button", "quiz-option" + (italic ? " italic" : ""), escapeHtml(opt.text));
    btn.type = "button";
    btn.addEventListener("click", () => selectOption(idx));
    optionsWrap.appendChild(btn);
  });
}

function selectOption(idx) {
  if (quizAnswered) return;
  quizAnswered = true;
  const opt = quizOptions[idx];
  const buttons = [...document.querySelectorAll(".quiz-option")];
  buttons.forEach((b, i) => {
    if (quizOptions[i].correct) b.classList.add("correct");
    else if (i === idx) b.classList.add("wrong");
  });
  recordAnswer(!!opt.correct);
}

function submitSpelling() {
  if (quizAnswered) return;
  const entry = quizQueue[quizIndex];
  const input = $("spellingInput");
  const val = (input.value || "").trim().toLowerCase();
  const correct = val === entry.word.trim().toLowerCase();
  quizAnswered = true;
  input.disabled = true;
  input.classList.add(correct ? "correct" : "wrong");
  if (!correct) {
    $("quizQuestionCard").appendChild(
      el("div", "quiz-answer-reveal", `正確答案：<b style="color:var(--green);font-style:italic;">${escapeHtml(
        entry.word
      )}</b>`)
    );
  }
  recordAnswer(correct);
}

function recordAnswer(correct) {
  const entry = quizQueue[quizIndex];
  const updatedLight = nextLight(entry.light || "unrated", correct);
  const prevStats = entry.stats || { attempts: 0, correct: 0 };
  const updatedEntry = {
    ...entry,
    light: updatedLight,
    stats: { attempts: prevStats.attempts + 1, correct: prevStats.correct + (correct ? 1 : 0) },
  };
  upsertEntry(updatedEntry);
  quizQueue[quizIndex] = updatedEntry;
  bumpStreak();
  roundResults.correct += correct ? 1 : 0;
  roundResults.wrong += correct ? 0 : 1;
  $("quizScoreText").textContent = `答對 ${roundResults.correct}．答錯 ${roundResults.wrong}`;
  $("quizNextBtn").hidden = false;
}

function goToNextQuestion() {
  const nextIndex = quizIndex + 1;
  if (nextIndex >= quizQueue.length) {
    finishQuiz();
  } else {
    quizIndex = nextIndex;
    prepareQuestion();
  }
}

function finishQuiz() {
  $("quizPlay").hidden = true;
  $("quizDone").hidden = false;
  $("quizDoneSummary").textContent = `答對 ${roundResults.correct} 題．答錯 ${roundResults.wrong} 題`;
  renderLightChips($("quizDoneChips"), computeLightCounts());
  refreshAllBookDependentUI();
}

function exitQuizToSetup() {
  $("quizPlay").hidden = true;
  $("quizDone").hidden = true;
  $("quizSetup").hidden = false;
  renderQuizSetup();
}

// ================================================================
// STATS VIEW
// ================================================================
function renderStatsView() {
  const empty = $("statsEmpty");
  const bodyEl = $("statsBody");
  if (book.length === 0) {
    empty.hidden = false;
    bodyEl.hidden = true;
    return;
  }
  empty.hidden = true;
  bodyEl.hidden = false;

  const counts = computeLightCounts();
  const totalAttempts = book.reduce((s, e) => s + (e.stats?.attempts || 0), 0);
  const totalCorrect = book.reduce((s, e) => s + (e.stats?.correct || 0), 0);
  const accuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : null;
  const masteredRate = Math.round((counts.green / book.length) * 100);
  const streak = loadStreak();

  $("statTotal").textContent = String(book.length);
  $("statMastered").textContent = `${masteredRate}%`;
  $("statAccuracy").textContent = accuracy === null ? "—" : `${accuracy}%`;
  $("statAttempts").textContent = `共作答 ${totalAttempts} 題`;
  $("statStreak").textContent = String(streak.streak || 0);

  const bar = $("lightBar");
  bar.innerHTML = "";
  LIGHT_ORDER.forEach((k) => {
    if (counts[k] > 0) {
      const seg = el("div", "");
      seg.style.width = `${(counts[k] / book.length) * 100}%`;
      seg.style.background = LIGHT_META[k].dot;
      bar.appendChild(seg);
    }
  });
  renderLightChips($("statsChips"), counts);
}

// ================================================================
// TABS
// ================================================================
function switchView(view) {
  document.querySelectorAll(".tab").forEach((t) => {
    const active = t.dataset.view === view;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", String(active));
  });
  ["search", "book", "quiz", "stats"].forEach((v) => {
    $("view-" + v).hidden = v !== view;
  });
  if (view === "book") renderBookView();
  if (view === "quiz") renderQuizSetup();
  if (view === "stats") renderStatsView();
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchView(tab.dataset.view));
});

// ================================================================
// SEARCH FORM
// ================================================================
const searchForm = $("searchForm");
const searchInput = $("searchInput");
const searchBtn = $("searchBtn");

searchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const word = searchInput.value.trim();
  if (!word) return;

  hideStatus("status");
  $("resultCard").hidden = true;
  $("emptyState").hidden = true;
  $("loading").hidden = false;
  searchBtn.disabled = true;

  try {
    const entry = await lookupWord(word);
    $("loading").hidden = true;
    searchBtn.disabled = false;
    renderResultCard(entry);
  } catch (err) {
    $("loading").hidden = true;
    searchBtn.disabled = false;
    showStatus("status", err.message, "error");
  }
});

// ================================================================
// BOOK VIEW EVENTS
// ================================================================
$("bookSearchInput").addEventListener("input", renderBookView);
$("batchToggleBtn").addEventListener("click", () => {
  $("batchPanel").hidden = !$("batchPanel").hidden;
});
$("batchRunBtn").addEventListener("click", runBatchAdd);
$("exportBtn").addEventListener("click", exportBook);
$("importTriggerBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", handleImportFile);

// ================================================================
// QUIZ VIEW EVENTS
// ================================================================
document.querySelectorAll(".mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    quizMode = btn.dataset.mode;
    renderQuizSetup();
  });
});
$("onlyWeakCheckbox").addEventListener("change", (e) => {
  onlyWeak = e.target.checked;
  renderQuizSetup();
});
$("quizStartBtn").addEventListener("click", startQuiz);
$("quizNextBtn").addEventListener("click", goToNextQuestion);
$("quizExitBtn").addEventListener("click", exitQuizToSetup);
$("quizAgainBtn").addEventListener("click", startQuiz);
$("quizBackBtn").addEventListener("click", exitQuizToSetup);

// ================================================================
// INIT
// ================================================================
updateBookBadge();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  });
}
