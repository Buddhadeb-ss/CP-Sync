
const SETTINGS_DEFAULTS = {
  githubToken: "",
  githubOwner: "Buddhadeb-ss",
  githubRepo: "coding-practice",
  githubBranch: "main",
  commitMessageTemplate: "Solved: {problem} ({platform})",
  skipDuplicateCode: true,
  extensionEnabled: true,
  otherJudgesEnabled: true,
  platformsEnabled: {
    codeforces: true,
    codechef: true,
    leetcode: true,
    neetcode: true,
    hackerrank: true,
    vjudge: true,
    atcoder: true
  }
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    activateTab(btn.dataset.tab);
    chrome.storage.local.set({ cpsync_active_tab: btn.dataset.tab });
  });
});

function activateTab(tabName) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (!btn) return;
  btn.classList.add("active");
  $("tab-" + tabName).classList.add("active");
  if (tabName === "pending") loadPendingItems();
  if (tabName === "history") loadHistory();
}

chrome.runtime.sendMessage({ type: "CP_SYNC_GET_PENDING_ITEMS" }, async (pendingRes) => {
  const hasPending = pendingRes && pendingRes.items && pendingRes.items.length > 0;
  if (hasPending) {
    activateTab("pending");
    return;
  }
  const settings = await chrome.storage.sync.get(SETTINGS_DEFAULTS);
  const configured = Boolean(settings.githubToken && settings.githubOwner && settings.githubRepo);
  chrome.storage.local.get({ cpsync_active_tab: null }, (res) => {
    if (res.cpsync_active_tab) {
      activateTab(res.cpsync_active_tab);
    } else {
      activateTab(configured ? "manual" : "general");
    }
  });
});

function setStatus(el, msg, cls) {
  el.textContent = msg;
  el.className = "status " + (cls || "");
}

// ---------------------------------------------------------------------
// Pop out to a persistent tab (a toolbar popup closes the instant it
// loses focus - e.g. clicking another tab to copy a problem name - which
// wipes an in-progress Manual Push. A real tab doesn't have that problem.)
// ---------------------------------------------------------------------
$("popOutBtn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

if (chrome.tabs && chrome.tabs.getCurrent) {
  chrome.tabs.getCurrent((tab) => {
    if (tab) $("popOutBtn").style.display = "none"; // already a full tab, no need to offer it again
  });
}

// ---------------------------------------------------------------------
// Master on/off toggle
// ---------------------------------------------------------------------
function renderMasterState(enabled) {
  const el = $("masterState");
  el.textContent = enabled ? "Active" : "Paused";
  el.className = "master-state" + (enabled ? "" : " off");
}

$("masterToggle").addEventListener("change", async (e) => {
  const enabled = e.target.checked;
  await chrome.storage.sync.set({ extensionEnabled: enabled });
  renderMasterState(enabled);
});

// ---------------------------------------------------------------------
// General tab
// ---------------------------------------------------------------------
async function loadGeneral() {
  const settings = await chrome.storage.sync.get(SETTINGS_DEFAULTS);
  $("token").value = settings.githubToken;
  $("owner").value = settings.githubOwner;
  $("repo").value = settings.githubRepo;
  $("branch").value = settings.githubBranch || "main";
  $("otherJudgesEnabled").checked = settings.otherJudgesEnabled !== false;

  $("masterToggle").checked = settings.extensionEnabled !== false;
  renderMasterState(settings.extensionEnabled !== false);

  document.querySelectorAll("[data-platform]").forEach((el) => {
    const p = el.getAttribute("data-platform");
    el.checked = settings.platformsEnabled ? settings.platformsEnabled[p] !== false : true;
  });
}

async function saveGeneral() {
  const platformsEnabled = {};
  document.querySelectorAll("[data-platform]").forEach((el) => {
    platformsEnabled[el.getAttribute("data-platform")] = el.checked;
  });

  await chrome.storage.sync.set({
    githubToken: $("token").value.trim(),
    githubOwner: $("owner").value.trim(),
    githubRepo: $("repo").value.trim(),
    githubBranch: $("branch").value.trim() || "main",
    otherJudgesEnabled: $("otherJudgesEnabled").checked,
    platformsEnabled
  });

  setStatus($("generalStatus"), "Saved", "ok");
  setTimeout(() => setStatus($("generalStatus"), ""), 2000);
}

function testConnection() {
  setStatus($("generalStatus"), "Testing connection...");
  chrome.runtime.sendMessage({ type: "CP_SYNC_TEST_CONNECTION" }, (res) => {
    if (res && res.ok) {
      setStatus($("generalStatus"), `Connected to ${res.fullName} (branch: ${res.defaultBranch})`, "ok");
    } else {
      setStatus($("generalStatus"), "Failed: " + (res ? res.error : "unknown error"), "err");
    }
  });
}

$("save").addEventListener("click", saveGeneral);
$("test").addEventListener("click", testConnection);

if ($("toggleTokenBtn")) {
  $("toggleTokenBtn").addEventListener("click", () => {
    const inp = $("token");
    const isHidden = inp.type === "password";
    inp.type = isHidden ? "text" : "password";
    $("toggleTokenBtn").textContent = isHidden ? "Hide" : "Show";
  });
}

// ---------------------------------------------------------------------
// Manual push tab
// ---------------------------------------------------------------------
$("mPlatform").addEventListener("change", () => {
  $("mOtherWrap").style.display = $("mPlatform").value === "other" ? "block" : "none";
});
$("mLanguage").addEventListener("change", () => {
  $("mOtherLanguageWrap").style.display = $("mLanguage").value === "other" ? "block" : "none";
});

const MANUAL_DRAFT_KEY = "cpsync_manual_draft";
const MANUAL_FIELD_IDS = [
  "mPlatform", "mLanguage", "mOtherLanguage", "mOtherName",
  "mProblemId", "mGroup", "mProblemName", "mUrl", "mCode"
];

function saveManualDraft() {
  const draft = {};
  MANUAL_FIELD_IDS.forEach((id) => (draft[id] = $(id).value));
  chrome.storage.local.set({ [MANUAL_DRAFT_KEY]: draft });
}

function loadManualDraft() {
  chrome.storage.local.get({ [MANUAL_DRAFT_KEY]: null }, (res) => {
    const draft = res[MANUAL_DRAFT_KEY];
    if (!draft) return;
    MANUAL_FIELD_IDS.forEach((id) => {
      if (draft[id] !== undefined) $(id).value = draft[id];
    });
    $("mOtherWrap").style.display = $("mPlatform").value === "other" ? "block" : "none";
    $("mOtherLanguageWrap").style.display = $("mLanguage").value === "other" ? "block" : "none";
  });
}

function clearManualDraft(fieldsToClear) {
  fieldsToClear.forEach((id) => ($(id).value = ""));
  saveManualDraft();
}

// Save on every keystroke/change - nothing typed here is ever lost, even
// if the popup closes because you clicked away to go copy something.
MANUAL_FIELD_IDS.forEach((id) => {
  $(id).addEventListener("input", saveManualDraft);
  $(id).addEventListener("change", saveManualDraft);
});

function manualPush() {
  const platformSelect = $("mPlatform").value;
  const platform = platformSelect === "other" ? ($("mOtherName").value.trim() || "other") : platformSelect;
  const problemId = $("mProblemId").value.trim();
  const problemName = $("mProblemName").value.trim() || problemId;
  const group = $("mGroup").value.trim();
  const languageSelect = $("mLanguage").value;
  const language = languageSelect === "other" ? ($("mOtherLanguage").value.trim() || "unknown") : languageSelect;
  const code = $("mCode").value;
  const url = $("mUrl").value.trim();

  if (!problemId || !code) {
    setStatus($("manualStatus"), "Problem ID and code are required.", "err");
    return;
  }
  if (platformSelect === "other" && !$("mOtherName").value.trim()) {
    setStatus($("manualStatus"), "Please name the judge for the folder.", "err");
    return;
  }

  // "group" doubles as rating (Codeforces/LeetCode/HackerRank) or contest
  // name (AtCoder/vJudge/CodeChef/Other) depending on platform - buildPath()
  // in background.js falls back sensibly either way.
  const payload = {
    platform,
    problemName,
    problemId,
    rating: group || null,
    contest: group || null,
    language,
    code,
    url: url || null,
    verdict: "Accepted"
  };

  setStatus($("manualStatus"), "Pushing...");
  $("manualPush").disabled = true;
  chrome.runtime.sendMessage({ type: "CP_SYNC_MANUAL_PUSH", payload }, (res) => {
    $("manualPush").disabled = false;
    if (res && res.ok) {
      setStatus($("manualStatus"), res.skipped ? "Skipped: identical code already pushed." : `Pushed to ${res.path}`, "ok");
      // Clear only the per-problem fields - keep platform/language selected
      // since the next problem you push is usually on the same judge.
      clearManualDraft(["mProblemId", "mGroup", "mProblemName", "mUrl", "mCode"]);
    } else {
      setStatus($("manualStatus"), "Failed: " + (res ? res.error : "unknown error") + " (your text hasn't been lost, fix and retry)", "err");
    }
    refreshStats();
  });
}

$("manualPush").addEventListener("click", manualPush);
loadManualDraft();

// ---------------------------------------------------------------------
// One-shot active-tab scanner (scrapes problem, language, and source code)
// ---------------------------------------------------------------------

let highlightPendingId = null;

async function findTargetTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isWebUrl = (u) => typeof u === "string" && /^https?:\/\//i.test(u);

  if (active && isWebUrl(active.url)) {
    return active;
  }

  // When popped out into a separate extension tab ("Open in tab"), look for
  // the most recently used judge / web tab in the current window or any window.
  const currentWinTabs = await chrome.tabs.query({ currentWindow: true });
  let webTabs = currentWinTabs.filter((t) => isWebUrl(t.url) && t.id !== (active && active.id));
  if (!webTabs.length) {
    const allTabs = await chrome.tabs.query({});
    webTabs = allTabs.filter((t) => isWebUrl(t.url) && t.id !== (active && active.id));
  }
  if (!webTabs.length) return active || null;

  const judgeRe = /codechef\.com|codeforces\.com|leetcode\.com|atcoder\.jp|hackerrank\.com|vjudge\.net|neetcode\.io/i;
  webTabs.sort((a, b) => {
    const aJudge = judgeRe.test(a.url) ? 1 : 0;
    const bJudge = judgeRe.test(b.url) ? 1 : 0;
    if (aJudge !== bJudge) return bJudge - aJudge;
    return (b.lastAccessed || 0) - (a.lastAccessed || 0);
  });
  return webTabs[0] || null;
}

// This runs INSIDE every frame of the target tab in world: "MAIN" via
// chrome.scripting.executeScript. It must remain 100% self-contained
// (no references to symbols outside its own body).
async function cpSyncScanActivePage() {
  const isTop = window === window.top;
  const host = location.hostname.toLowerCase();

  function text(el) {
    return el ? (el.textContent || "").trim() : null;
  }

  function isExcluded(el) {
    if (!el || typeof el.closest !== "function") return false;
    return !!el.closest(
      '[class*="tutor" i], [id*="tutor" i], [class*="assistant" i], [id*="assistant" i], ' +
      '[class*="chat" i], [id*="chat" i], [class*="copilot" i], [id*="copilot" i], ' +
      '[class*="reference" i], [id*="reference" i], [class*="cheatsheet" i], [id*="cheatsheet" i], ' +
      '[class*="cheat-sheet" i], [id*="cheat-sheet" i], [class*="keyword" i], [id*="keyword" i], ' +
      '[class*="snippet-list" i], [id*="snippet-list" i], [class*="helper" i], [id*="helper" i], ' +
      '[class*="hint" i], [id*="hint" i], [class*="suggest-widget" i], [class*="hover-widget" i], ' +
      '.sample-test, #task-statement, .problem-statement'
    );
  }

  function looksLikeRealEditor(el) {
    if (!el || typeof el.closest !== "function") return false;
    return !!el.closest(
      '[class*="solution" i], [id*="solution" i], [class*="code-editor" i], [id*="code-editor" i], ' +
      '[class*="ide" i], [id*="ide" i], [data-testid*="editor" i], .monaco-editor, .CodeMirror, .cm-editor, .ace_editor'
    );
  }

  function isValidCode(val) {
    if (!val || typeof val !== "string") return false;
    const trimmed = val.trim();
    if (!trimmed) return false;
    return true;
  }

  function pickBest(candidates, sourceKind) {
    const valid = candidates.filter((c) => isValidCode(c.value));
    if (!valid.length) return null;
    const real = valid.filter((c) => looksLikeRealEditor(c.el));
    const pool = real.length ? real : valid;
    let best = pool[0];
    for (const c of pool) {
      if (c.value.length > best.value.length) best = c;
    }
    return { code: best.value, language: best.language || null, sourceKind };
  }

  function readMonaco() {
    try {
      if (!window.monaco || !window.monaco.editor) return null;
      if (typeof window.monaco.editor.getEditors === "function") {
        const candidates = window.monaco.editor
          .getEditors()
          .filter((ed) => {
            try {
              return !isExcluded(ed.getDomNode());
            } catch (e) {
              return true;
            }
          })
          .map((ed) => {
            let lang = null;
            try {
              const m = ed.getModel && ed.getModel();
              if (m && typeof m.getLanguageId === "function") lang = m.getLanguageId();
            } catch (e) {}
            return { el: ed.getDomNode ? ed.getDomNode() : null, value: ed.getValue() || "", language: lang };
          });
        const res = pickBest(candidates, "monaco");
        if (res) return res;
      }
      if (typeof window.monaco.editor.getModels === "function") {
        const models = window.monaco.editor.getModels() || [];
        const candidates = models.map((m) => {
          let lang = null;
          try {
            if (typeof m.getLanguageId === "function") lang = m.getLanguageId();
          } catch (e) {}
          return { el: null, value: m.getValue() || "", language: lang };
        });
        const res = pickBest(candidates, "monaco-model");
        if (res) return res;
      }
    } catch (e) {}
    return null;
  }

  function readCodeMirror() {
    try {
      // CodeMirror 5
      const cm5Nodes = Array.from(document.querySelectorAll(".CodeMirror")).filter((n) => !isExcluded(n));
      const cm5 = cm5Nodes
        .map((n) => {
          const inst = n.CodeMirror;
          if (!inst || typeof inst.getValue !== "function") return null;
          let lang = null;
          try {
            const mode = inst.getOption && inst.getOption("mode");
            if (typeof mode === "string") lang = mode;
            else if (mode && mode.name) lang = mode.name;
          } catch (e) {}
          return { el: n, value: inst.getValue() || "", language: lang };
        })
        .filter(Boolean);
      const r5 = pickBest(cm5, "codemirror5");
      if (r5) return r5;

      // CodeMirror 6
      const cm6Nodes = Array.from(document.querySelectorAll(".cm-editor")).filter((n) => !isExcluded(n));
      const cm6 = cm6Nodes
        .map((n) => {
          const content = n.querySelector(".cm-content");
          if (!content) return null;
          let val = "";
          try {
            if (content.cmView && content.cmView.view && content.cmView.view.state && content.cmView.view.state.doc) {
              val = content.cmView.view.state.doc.toString();
            }
          } catch (e) {}
          if (!val) {
            const lines = Array.from(content.querySelectorAll(".cm-line")).map((l) => l.textContent || "");
            if (lines.length) val = lines.join("\n");
          }
          const langAttr = content.getAttribute("data-language") || n.getAttribute("data-language") || null;
          return { el: n, value: val, language: langAttr };
        })
        .filter(Boolean);
      const r6 = pickBest(cm6, "codemirror6");
      if (r6) return r6;
    } catch (e) {}
    return null;
  }

  function readAce() {
    try {
      const nodes = Array.from(document.querySelectorAll(".ace_editor")).filter((n) => !isExcluded(n));
      const candidates = [];
      for (const node of nodes) {
        let value = null;
        let lang = null;
        try {
          const ed = (node.env && node.env.editor) || (window.ace && typeof window.ace.edit === "function" ? window.ace.edit(node) : null);
          if (ed && typeof ed.getValue === "function") {
            value = ed.getValue();
            const modeId = ed.session && ed.session.$modeId;
            if (typeof modeId === "string") lang = modeId.split("/").pop();
          }
        } catch (e) {}
        if (value) candidates.push({ el: node, value, language: lang });
      }
      return pickBest(candidates, "ace");
    } catch (e) {}
    return null;
  }

  function readTextarea() {
    try {
      const areas = Array.from(document.querySelectorAll("textarea")).filter(
        (area) =>
          !isExcluded(area) &&
          !area.closest(".monaco-editor") &&
          !area.closest(".CodeMirror") &&
          !area.closest(".cm-editor") &&
          !area.closest(".ace_editor")
      );
      const candidates = areas.map((area) => ({ el: area, value: area.value || "", language: null }));
      return pickBest(candidates, "textarea");
    } catch (e) {}
    return null;
  }

  function readEditor() {
    return readMonaco() || readCodeMirror() || readAce() || readTextarea() || null;
  }

  function detectLanguageFromDomSelectors() {
    const selectors = [
      'select[name*="lang" i]',
      'select[id*="lang" i]',
      'select[name="programTypeId"]',
      '[data-cy*="language" i]',
      '[data-testid*="language" i]',
      '[class*="languageSelect" i]',
      '[class*="lang-select" i]',
      '[class*="language-select" i]',
      '[class*="select-language" i]',
      'button[id*="headlessui-listbox-button"]',
      'button[role="combobox"]',
      'div[role="combobox"]',
      '[aria-haspopup="listbox"]',
      '[class*="language" i]:not(pre):not(code)'
    ];
    const strictLangRe = /^(?:language\s*[:\-]\s*)?(?:c(?:\s*\([^)]+\)|\s*\d{2})?|c\+\+(?:\s*\d{2}|\s*\([^)]+\))?|gnu\s*g\+\+.*|gnu\s*c\+\+.*|gnu\s*c.*|g\+\+.*|gcc.*|clang.*|python(?:\s*3)?(?:\s*\([^)]+\))?|pypy.*|pyth.*|java(?:\s*\d+)?(?:\s*\([^)]+\))?|javascript(?:\s*\([^)]+\))?|node\.js.*|typescript(?:\s*\([^)]+\))?|go(?:lang)?(?:\s*\([^)]+\))?|rust(?:\s*\([^)]+\))?|kotlin(?:\s*\([^)]+\))?|c#(?:\s*\([^)]+\))?|ruby.*|swift.*|scala.*|php.*|haskell.*|dart.*|racket.*|pascal.*)$/i;
    for (const sel of selectors) {
      const els = Array.from(document.querySelectorAll(sel));
      for (const el of els) {
        if (isExcluded(el) || el.closest("nav, header, aside")) continue;
        let val = "";
        if (el.tagName === "SELECT" && el.selectedIndex >= 0) {
          val = (el.options[el.selectedIndex].text || el.value || "").trim();
        } else {
          val = (el.textContent || "").trim();
        }
        if (val && val.length <= 35 && strictLangRe.test(val)) {
          return val.replace(/^language\s*[:\-]\s*/i, "").trim();
        }
      }
    }
    return null;
  }

  function hasCppMarkers(code) {
    if (!code) return false;
    return (
      /#include\s*<(?:iostream|bits\/stdc\+\+\.h|vector|string|algorithm|map|unordered_map|set|unordered_set|queue|stack|deque|utility|tuple|cstdio|cstdlib|cstring|iomanip|sstream|fstream|numeric|functional|memory|array|bitset|list)\b/.test(code) ||
      /\busing\s+namespace\s+std\b|\bstd::|\b(?:cout|cin|cerr)\s*(?:<<|>>)|\bclass\s+\w+\s*\{|\bpublic\s*:|\bprivate\s*:|\btemplate\s*<|\bnullptr\b|\bvector\s*</.test(code)
    );
  }

  function hasCMarkers(code) {
    if (!code) return false;
    return (
      /#include\s*<(?:stdio\.h|stdlib\.h|string\.h|stdbool\.h|math\.h|limits\.h|stdint\.h|ctype\.h|assert\.h|time\.h|float\.h)>/.test(code) ||
      /\b(?:printf|scanf|fprintf|fscanf|sprintf|sscanf|fgets|fputs|puts|getchar|putchar|malloc|calloc|realloc|free)\s*\(|\btypedef\s+struct\b|\*\s*returnSize\b|\*\s*returnColumnSizes\b/.test(code)
    );
  }

  function disambiguateCppVsC(code, lang, langSource) {
    // Only second-guess generic editor-model guesses (Monaco reports "cpp" for C files) or code-sniffing
    if (langSource === "api" || langSource === "submission-table" || langSource === "dom-selector") {
      return lang;
    }
    if (!code) return lang;
    const looksGenericCpp = !lang || /^(?:c\+\+|c\+\+17|cpp)$/i.test(String(lang).trim());
    if (!looksGenericCpp) return lang;
    if (hasCppMarkers(code)) return lang || "C++17";
    if (hasCMarkers(code)) return "C";
    if (host.includes("leetcode.com") && !/\bclass\s+Solution\b/.test(code) && /\b(?:int|void|bool|char|double|long)\s*\*?\s+\w+\s*\(/.test(code)) {
      return "C";
    }
    return lang;
  }

  function normalizeLanguageName(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    const low = s.toLowerCase();
    if (low === "c_cpp") return "C++17";
    if (low === "cpp" || low === "c++") return "C++17";
    if (low === "c") return "C";
    if (low === "python" || low === "python3") return "Python3";
    if (low === "java") return "Java";
    if (low === "javascript" || low === "js") return "JavaScript";
    if (low === "typescript" || low === "ts") return "TypeScript";
    if (low === "golang" || low === "go") return "Go";
    if (low === "rust") return "Rust";
    if (low === "kotlin") return "Kotlin";
    if (low === "csharp" || low === "c#") return "C#";
    return s;
  }

  function resolveHref(el) {
    if (!el) return null;
    const raw = el.getAttribute("href");
    if (!raw) return null;
    try {
      return new URL(raw, location.origin).href;
    } catch (e) {
      return raw;
    }
  }

  const result = {
    isTop,
    platform: null,
    otherName: null,
    problemId: null,
    problemName: null,
    rating: null,
    contest: null,
    language: null,
    languageSource: null,
    code: null,
    url: location.href,
    submissionId: null,
    submissionUrl: null,
    detectedAccepted: false,
    sourceMethod: null
  };

  try {
    const editorRes = readEditor();
    if (editorRes) {
      result.code = editorRes.code;
      if (editorRes.language) {
        result.language = normalizeLanguageName(editorRes.language);
        result.languageSource = "editor-model";
      }
      result.sourceMethod = editorRes.sourceKind;
    }

    if (host.includes("codeforces.com")) {
      result.platform = "codeforces";
      const myHandle = text(document.querySelector('#header a[href^="/profile/"]'));

      async function cfFetchRating(contestId, problemIndex) {
        if (!contestId || !problemIndex) return null;
        const urls = [
          `/contest/${contestId}/problem/${problemIndex}`,
          `/problemset/problem/${contestId}/${problemIndex}`
        ];
        for (const u of urls) {
          try {
            const resp = await fetch(u, { credentials: "include" });
            if (!resp.ok) continue;
            const html = await resp.text();
            const m = html.match(/\*(\d{3,4})(?:\s|<)/);
            if (m) return m[1];
          } catch (e) {}
        }
        return null;
      }

      async function cfFetchSource(contestId, subId) {
        const urls = [
          `/contest/${contestId}/submission/${subId}`,
          `/problemset/submission/${contestId}/${subId}`,
          `/gym/${contestId}/submission/${subId}`
        ];
        for (const u of urls) {
          try {
            const resp = await fetch(u, { credentials: "include" });
            if (!resp.ok) continue;
            const html = await resp.text();
            const doc = new DOMParser().parseFromString(html, "text/html");
            const pre = doc.querySelector("#program-source-text") || doc.querySelector("pre.prettyprint");
            if (pre && isValidCode(pre.textContent)) {
              return { code: pre.textContent, submissionUrl: new URL(u, location.origin).href };
            }
          } catch (e) {}
        }
        return null;
      }

      function cfParseRow(row) {
        const rowText = row.textContent || "";
        let verdict = null;
        if (/\bAccepted\b/.test(rowText)) verdict = "Accepted";
        else if (/Pretests passed/i.test(rowText)) verdict = "Pretests passed";
        if (!verdict) return null;

        const subLink = row.querySelector('a[href*="/submission/"]');
        const subMatch = subLink && subLink.href.match(/submission\/(\d+)/);
        const submissionId = subMatch ? subMatch[1] : null;
        if (!submissionId) return null;

        const problemLink = row.querySelector('a[href*="/problem/"]');
        const pm = problemLink && problemLink.href.match(/\/(?:contest|problemset\/problem|gym)\/(\d+)\/(?:problem\/)?([A-Za-z0-9]+)/);
        const contestId = pm ? pm[1] : "";
        const problemIndex = pm ? pm[2] : "";
        const problemName = problemLink ? problemLink.textContent.trim() : null;

        const cells = Array.from(row.querySelectorAll("td"));
        const langCell = cells.find((td) =>
          /GNU|G\+\+|C\+\+|Python|PyPy|Java|Kotlin|Rust|C#|Go\b|PHP|Ruby|Scala|Haskell|Node|JavaScript|TypeScript|Pascal|Perl|D lang|Ocaml/i.test(
            td.textContent
          )
        );
        const language = langCell ? langCell.textContent.trim() : null;

        const whoLink = row.querySelector('a[href^="/profile/"]');
        const submitterHandle = whoLink ? whoLink.textContent.trim() : null;
        return { submissionId, contestId, problemIndex, problemName, language, submitterHandle, verdict };
      }

      const subUrlMatch = location.pathname.match(/\/(?:contest|problemset\/submission|gym)\/(\d+)\/(?:submission\/)?(\d+)/) ||
        location.pathname.match(/\/submission\/(\d+)/);
      const sourcePre = document.querySelector("#program-source-text") || (location.pathname.includes("/submission/") ? document.querySelector("pre.prettyprint") : null);

      if (sourcePre && isValidCode(sourcePre.textContent)) {
        // Submission detail page
        result.code = sourcePre.textContent;
        result.sourceMethod = "submission-dom";
        const subIdMatch = location.pathname.match(/submission\/(\d+)/);
        if (subIdMatch) {
          result.submissionId = subIdMatch[1];
          result.submissionUrl = location.href;
        }
        const probLink = document.querySelector('a[href*="/problem/"]');
        if (probLink) {
          const pm = probLink.href.match(/\/(?:contest|problemset\/problem|gym)\/(\d+)\/(?:problem\/)?([A-Za-z0-9]+)/);
          if (pm) {
            result.contest = `Contest-${pm[1]}`;
            result.problemId = pm[1] + pm[2];
            result.rating = await cfFetchRating(pm[1], pm[2]);
          }
          result.problemName = text(probLink);
          result.url = resolveHref(probLink) || location.href;
        }
        const tableLang = Array.from(document.querySelectorAll("table td")).find((td) =>
          /GNU|G\+\+|C\+\+|Python|PyPy|Java|Kotlin|Rust|C#|Go\b|PHP|Ruby|Scala|Haskell|Node|JavaScript|TypeScript|Pascal/i.test(
            td.textContent
          )
        );
        if (tableLang) {
          result.language = text(tableLang);
          result.languageSource = "submission-table";
        }
        if (document.querySelector(".verdict-accepted") || /\bAccepted\b|Pretests passed/i.test(document.body.innerText || "")) {
          result.detectedAccepted = true;
        }
      } else if (document.querySelector("table.status-frame-datatable")) {
        // Status / My Submissions table
        const rows = Array.from(document.querySelectorAll("table.status-frame-datatable tr"));
        let bestInfo = null;
        for (const r of rows) {
          const info = cfParseRow(r);
          if (!info) continue;
          if (myHandle && info.submitterHandle && info.submitterHandle.toLowerCase() !== myHandle.toLowerCase()) continue;
          bestInfo = info;
          break;
        }
        if (bestInfo) {
          result.submissionId = bestInfo.submissionId;
          result.contest = bestInfo.contestId ? `Contest-${bestInfo.contestId}` : null;
          result.problemId = bestInfo.contestId + bestInfo.problemIndex;
          result.problemName = bestInfo.problemName;
          if (bestInfo.language) {
            result.language = bestInfo.language;
            result.languageSource = "submission-table";
          }
          result.detectedAccepted = true;
          result.url = `https://codeforces.com/contest/${bestInfo.contestId}/problem/${bestInfo.problemIndex}`;
          const [src, rating] = await Promise.all([
            cfFetchSource(bestInfo.contestId, bestInfo.submissionId),
            cfFetchRating(bestInfo.contestId, bestInfo.problemIndex)
          ]);
          if (src) {
            result.code = src.code;
            result.submissionUrl = src.submissionUrl;
            result.sourceMethod = "submission-fetch";
          }
          if (rating) result.rating = rating;
        }
      } else if (isTop) {
        // Problem page (or submit page)
        const pm = location.pathname.match(/\/(?:contest|problemset\/problem|gym)\/(\d+)\/(?:problem\/)?([A-Za-z0-9]+)/);
        const contestId = pm ? pm[1] : null;
        const problemIndex = pm ? pm[2] : null;
        if (contestId && problemIndex) {
          result.contest = `Contest-${contestId}`;
          result.problemId = contestId + problemIndex;
        } else if (location.pathname.includes("/submit")) {
          const cMatch = location.pathname.match(/\/(?:contest|gym)\/(\d+)\/submit/);
          const sel = document.querySelector('select[name="submittedProblemIndex"]');
          if (cMatch && sel && sel.value) {
            result.contest = `Contest-${cMatch[1]}`;
            result.problemId = cMatch[1] + sel.value;
          }
        }
        result.problemName = text(document.querySelector(".problem-statement .title")) ||
          (document.title || "").replace(/\s*-\s*Codeforces\s*$/i, "").trim();
        const tagRating = text(document.querySelector('.tag-box[title="Difficulty"]'));
        const rm = (tagRating || document.body.innerText || "").match(/\*(\d{3,4})(?:\s|$|<)/);
        if (rm) result.rating = rm[1];

        // Try sidebar "Last submissions" link showing Accepted, or /contest/<id>/my
        let foundSub = null;
        const sidebarSubLinks = Array.from(document.querySelectorAll('.roundbox a[href*="/submission/"]'));
        for (const a of sidebarSubLinks) {
          const row = a.closest("tr, div");
          if (row && /\bAccepted\b|Pretests passed|\bAC\b/i.test(row.textContent || "")) {
            const sm = a.href.match(/submission\/(\d+)/);
            if (sm) {
              foundSub = { submissionId: sm[1], contestId: contestId || "" };
              break;
            }
          }
        }

        if (!foundSub && myHandle && contestId) {
          const statusUrls = [`/contest/${contestId}/my`, `/problemset/status?my=on`];
          for (const su of statusUrls) {
            try {
              const resp = await fetch(su, { credentials: "include" });
              if (!resp.ok) continue;
              const html = await resp.text();
              const doc = new DOMParser().parseFromString(html, "text/html");
              const rows = Array.from(doc.querySelectorAll("table.status-frame-datatable tr"));
              for (const r of rows) {
                const info = cfParseRow(r);
                if (!info) continue;
                const exactMatch = result.problemId && (info.contestId + info.problemIndex).toLowerCase() === result.problemId.toLowerCase();
                const fallbackMatch = !result.problemId && problemIndex && info.problemIndex === problemIndex && (!contestId || info.contestId === contestId);
                if (exactMatch || fallbackMatch) {
                  foundSub = info;
                  break;
                }
              }
              if (foundSub) break;
            } catch (e) {}
          }
        }

        if (foundSub && (!result.code || foundSub.submissionId)) {
          const src = await cfFetchSource(foundSub.contestId || contestId, foundSub.submissionId);
          if (src) {
            result.code = src.code;
            result.submissionId = foundSub.submissionId;
            result.submissionUrl = src.submissionUrl;
            result.detectedAccepted = true;
            result.sourceMethod = "submission-fetch";
            if (foundSub.language) {
              result.language = foundSub.language;
              result.languageSource = "submission-table";
            }
          }
        }
        if (!result.language || result.languageSource === "editor-model") {
          const domLang = detectLanguageFromDomSelectors();
          if (domLang) {
            result.language = domLang;
            result.languageSource = "dom-selector";
          }
        }
      }
    } else if (host.includes("leetcode.com")) {
      result.platform = "leetcode";
      const slugMatch = location.pathname.match(/\/problems\/([^/]+)/);
      const slug = slugMatch ? slugMatch[1] : null;
      result.problemId = slug;

      const titleEl = document.querySelector('[data-cy="question-title"], .text-title-large a, a[href*="/problems/' + (slug || "") + '/"]');
      result.problemName = (text(titleEl) || (document.title || "")).replace(/\s*-\s*LeetCode\s*$/i, "").trim() || slug;

      const diffEl = document.querySelector(
        '[class*="text-difficulty-easy" i], [class*="text-difficulty-medium" i], [class*="text-difficulty-hard" i], [class*="difficulty" i]'
      );
      if (diffEl) {
        const dt = text(diffEl) || "";
        if (/easy/i.test(dt)) result.rating = "Easy";
        else if (/medium/i.test(dt)) result.rating = "Medium";
        else if (/hard/i.test(dt)) result.rating = "Hard";
      }

      const subResultEl = document.querySelector('[data-e2e-locator="submission-result"]');
      const pageShowsAccepted = !!(subResultEl && /accepted/i.test(subResultEl.textContent || ""));
      if (pageShowsAccepted) result.detectedAccepted = true;

      if (slug) {
        result.url = `https://leetcode.com/problems/${slug}/`;
        if (isTop) {
          const subIdMatch = location.pathname.match(/\/submissions\/(\d+)/);
          try {
            const resp = await fetch(`https://leetcode.com/api/submissions/${slug}/`, { credentials: "include" });
            if (resp.ok) {
              const data = await resp.json();
              const list = data.submissions_dump || data.submissions || [];
              let picked = null;
              if (subIdMatch) {
                picked = list.find((s) => String(s.id) === subIdMatch[1]) || null;
              } else {
                picked = list.find((s) => /accepted/i.test(s.status_display || "")) || null;
              }
              if (picked && isValidCode(picked.code)) {
                result.code = picked.code;
                const apiLang = normalizeLanguageName(picked.lang || picked.lang_str || picked.lang_name);
                if (apiLang) {
                  result.language = apiLang;
                  result.languageSource = "api";
                }
                result.submissionId = picked.id ? String(picked.id) : null;
                result.submissionUrl = picked.id ? `https://leetcode.com/submissions/detail/${picked.id}/` : null;
                if (/accepted/i.test(picked.status_display || "")) result.detectedAccepted = true;
                result.sourceMethod = "leetcode-api";
              }
            }
          } catch (e) {}
          if (subIdMatch && !result.code) {
            const codeBlock = document.querySelector('pre code, [class*="submission" i] pre, [class*="code" i] code');
            if (codeBlock && !isExcluded(codeBlock) && isValidCode(codeBlock.textContent)) {
              result.code = codeBlock.textContent;
              result.submissionId = subIdMatch[1];
              result.submissionUrl = location.href;
              result.sourceMethod = "submission-dom";
            }
          }
        }
      }

      if (!result.language || result.languageSource === "editor-model") {
        const domLang = detectLanguageFromDomSelectors();
        if (domLang) {
          result.language = normalizeLanguageName(domLang);
          result.languageSource = "dom-selector";
        }
      }
    } else if (host.includes("codechef.com")) {
      result.platform = "codechef";
      const parts = location.pathname.split("/").filter(Boolean);

      if (parts.includes("viewsolution")) {
        const idx = parts.indexOf("viewsolution");
        result.submissionId = parts[idx + 1] || null;
        result.submissionUrl = location.href;
        const probLink = document.querySelector('a[href*="/problems/"], a[href*="/submit/"]');
        if (probLink) {
          const pm = probLink.href.match(/\/(?:problems|submit)\/([^/?#]+)/);
          if (pm) result.problemId = pm[1];
          result.url = resolveHref(probLink);
        }
        // Check read-only code viewer on viewsolution page if editor didn't capture it
        if (!result.code) {
          const codeEl = document.querySelector('#solution-code, [class*="solution" i] pre, [class*="code-container" i] pre, pre.prettyprint, main pre');
          if (codeEl && !isExcluded(codeEl) && isValidCode(codeEl.textContent)) {
            result.code = codeEl.textContent;
            result.sourceMethod = "viewsolution-dom";
          }
        }
      } else {
        const probMatch = location.pathname.match(/\/problems\/([^/?#]+)/) || location.pathname.match(/\/submit\/([^/?#]+)/);
        result.problemId = probMatch ? probMatch[1] : (parts[parts.length - 1] || null);
        const contestMatch = location.pathname.match(/^\/([A-Za-z0-9_]+)\/problems\//);
        if (contestMatch && !["practice", "problems", "learn"].includes(contestMatch[1].toLowerCase())) {
          result.contest = contestMatch[1];
        }
      }

      const titleSelectors = [
        '[data-cy="problem-name"]',
        '[class*="problemTitle" i]',
        '[class*="problem-title" i]',
        '._problem-title',
        '.problem-title',
        'h1',
        'h2'
      ];
      let rawTitle = null;
      for (const sel of titleSelectors) {
        const match = Array.from(document.querySelectorAll(sel)).find(
          (el) => !isExcluded(el) && !el.closest("nav, header, aside") && text(el)
        );
        if (match) {
          rawTitle = text(match);
          break;
        }
      }
      result.problemName = rawTitle || (document.title || "").replace(/\s*\|\s*CodeChef.*$/i, "").replace(/\s*-\s*CodeChef.*$/i, "").trim() || result.problemId;

      const bodyTxt = (document.body && document.body.innerText) || "";
      const ratingMatch = bodyTxt.match(/Difficulty\s*(?:Rating)?\s*[:\s]+(\d{3,4})\b/i);
      if (ratingMatch) result.rating = ratingMatch[1];

      if (!result.submissionId) {
        const solLinks = Array.from(document.querySelectorAll('a[href*="/viewsolution/"], a[href*="/view/solution/"]'));
        if (solLinks.length) {
          const lm = solLinks[solLinks.length - 1].href.match(/(\d+)\s*$/);
          if (lm) {
            result.submissionId = lm[1];
            result.submissionUrl = resolveHref(solLinks[solLinks.length - 1]);
          }
        }
      }

      const domLang = detectLanguageFromDomSelectors();
      if (domLang) {
        result.language = domLang;
        result.languageSource = "dom-selector";
      }

      if (/\b(?:well done|correct answer|accepted|100\s*\/\s*100|100\s*pts|task score\s*100|perfect answer)\b/i.test(bodyTxt)) {
        result.detectedAccepted = true;
      }
    } else if (host.includes("atcoder.jp")) {
      result.platform = "atcoder";
      const cm = location.pathname.match(/\/contests\/([^/]+)/);
      result.contest = cm ? cm[1] : null;
      const myHandleEl = document.querySelector('.header-tail a[href^="/users/"], .navbar a[href^="/users/"], header a[href^="/users/"]');
      const myHandle = myHandleEl && (myHandleEl.href.match(/\/users\/([^/?#]+)/) || [])[1];

      async function acFetchDetail(detailUrl) {
        try {
          const resp = await fetch(detailUrl, { credentials: "include" });
          if (!resp.ok) return null;
          const html = await resp.text();
          const doc = new DOMParser().parseFromString(html, "text/html");
          const pre = doc.querySelector("#submission-code");
          const langTh = Array.from(doc.querySelectorAll("th")).find((th) => /language/i.test(th.textContent || ""));
          const lang = langTh && langTh.nextElementSibling ? text(langTh.nextElementSibling) : null;
          const probLink = doc.querySelector('a[href*="/tasks/"]');
          return {
            code: pre && isValidCode(pre.textContent) ? pre.textContent : null,
            language: lang,
            problemName: probLink ? text(probLink) : null,
            problemId: probLink ? resolveHref(probLink).split("/tasks/")[1] : null
          };
        } catch (e) {
          return null;
        }
      }

      if (/\/submissions\/\d+/.test(location.pathname)) {
        const sm = location.pathname.match(/submissions\/(\d+)/);
        result.submissionId = sm ? sm[1] : null;
        result.submissionUrl = location.href;
        const pre = document.querySelector("#submission-code");
        if (pre && isValidCode(pre.textContent)) {
          result.code = pre.textContent;
          result.sourceMethod = "submission-dom";
        }
        const probLink = document.querySelector('a[href*="/tasks/"]');
        if (probLink) {
          result.problemName = text(probLink);
          const href = resolveHref(probLink);
          result.problemId = href ? href.split("/tasks/")[1] : result.submissionId;
          result.url = href || location.href;
        }
        const langTh = Array.from(document.querySelectorAll("th")).find((th) => /language/i.test(th.textContent || ""));
        if (langTh && langTh.nextElementSibling) {
          result.language = text(langTh.nextElementSibling);
          result.languageSource = "submission-table";
        }
        const statusEl = document.querySelector("#judge-status, .label-success");
        if (statusEl && /\bAC\b/.test(statusEl.textContent || "")) result.detectedAccepted = true;
      } else if (/\/tasks\/([^/?#]+)/.test(location.pathname)) {
        const tm = location.pathname.match(/\/tasks\/([^/?#]+)/);
        result.problemId = tm ? tm[1] : null;
        const h2 = document.querySelector("span.h2, h2");
        if (h2) {
          const clone = h2.cloneNode(true);
          clone.querySelectorAll("a, button, .btn").forEach((el) => el.remove());
          result.problemName = text(clone);
        }
        if (!result.problemName) {
          result.problemName = (document.title || "").replace(/\s*-\s*AtCoder\s*$/i, "").trim();
        }
        if (!result.language || result.languageSource === "editor-model") {
          const domLang = detectLanguageFromDomSelectors();
          if (domLang) {
            result.language = domLang;
            result.languageSource = "dom-selector";
          }
        }

        if (!result.code && isTop && myHandle && result.contest && result.problemId) {
          try {
            const listUrl = `/contests/${result.contest}/submissions/me?f.Task=${encodeURIComponent(result.problemId)}&f.Status=AC`;
            const resp = await fetch(listUrl, { credentials: "include" });
            if (resp.ok) {
              const html = await resp.text();
              const doc = new DOMParser().parseFromString(html, "text/html");
              const link = doc.querySelector('table tbody tr a[href*="/submissions/"]');
              if (link) {
                const detailUrl = resolveHref(link);
                const sm = detailUrl && detailUrl.match(/submissions\/(\d+)/);
                const detail = await acFetchDetail(detailUrl);
                if (detail && detail.code) {
                  result.code = detail.code;
                  if (detail.language) {
                    result.language = detail.language;
                    result.languageSource = "submission-table";
                  }
                  result.submissionId = sm ? sm[1] : null;
                  result.submissionUrl = detailUrl;
                  result.detectedAccepted = true;
                  result.sourceMethod = "submission-fetch";
                }
              }
            }
          } catch (e) {}
        }
      } else if (isTop && document.querySelector("table tbody tr")) {
        const rows = Array.from(document.querySelectorAll("table tbody tr"));
        for (const r of rows) {
          const isAC = /\bAC\b/.test(r.textContent || "") || !!r.querySelector('.label-success, [title="AC"]');
          if (!isAC) continue;
          const userLink = r.querySelector('a[href^="/users/"]');
          const userHandle = userLink && (resolveHref(userLink).match(/\/users\/([^/?#]+)/) || [])[1];
          if (myHandle && userHandle && userHandle.toLowerCase() !== myHandle.toLowerCase()) continue;
          const subLink = r.querySelector('a[href*="/submissions/"]');
          if (subLink) {
            const detailUrl = resolveHref(subLink);
            const sm = detailUrl && detailUrl.match(/submissions\/(\d+)/);
            const detail = await acFetchDetail(detailUrl);
            if (detail && detail.code) {
              result.code = detail.code;
              if (detail.language) {
                result.language = detail.language;
                result.languageSource = "submission-table";
              }
              result.problemName = detail.problemName || result.problemName;
              result.problemId = detail.problemId || result.problemId;
              result.submissionId = sm ? sm[1] : null;
              result.submissionUrl = detailUrl;
              result.detectedAccepted = true;
              result.sourceMethod = "submission-fetch";
              break;
            }
          }
        }
      }
    } else if (host.includes("hackerrank.com")) {
      result.platform = "hackerrank";
      const m = location.pathname.match(/challenges\/([^/]+)/);
      const slug = m ? m[1] : null;
      result.problemId = slug;
      result.problemName =
        text(document.querySelector("h1, .challenge-page-title, [class*='challenge-title']")) ||
        (document.title || "").replace(/\s*\|\s*HackerRank\s*$/i, "").trim();
      const diffEl = document.querySelector('.difficulty-block, [class*="difficulty" i]');
      if (diffEl) {
        const dm = (diffEl.textContent || "").match(/\b(Easy|Medium|Hard|Advanced|Expert)\b/i);
        if (dm) result.rating = dm[1];
      }
      const domLang = detectLanguageFromDomSelectors();
      if (domLang) {
        result.language = domLang;
        result.languageSource = "dom-selector";
      }

      if (/All test cases passed|Accepted|Congratulations/i.test(document.body.innerText || "")) {
        result.detectedAccepted = true;
      }

      if (isTop && slug) {
        try {
          const resp = await fetch(`https://www.hackerrank.com/rest/contests/master/challenges/${slug}/submissions/?offset=0&limit=10`, {
            credentials: "include"
          });
          if (resp.ok) {
            const data = await resp.json();
            const list = data.models || data.submissions || [];
            const accepted = list.find((s) => /accepted/i.test(s.status || s.status_text || ""));
            if (accepted) {
              let record = accepted;
              let code = accepted.code || accepted.source || accepted.solution || accepted.raw_code || (accepted.model && accepted.model.code);
              if (!code && accepted.id) {
                const dResp = await fetch(`https://www.hackerrank.com/rest/contests/master/challenges/${slug}/submissions/${accepted.id}`, {
                  credentials: "include"
                });
                if (dResp.ok) {
                  const dJson = await dResp.json();
                  record = dJson.model || dJson;
                  code = record.code || record.source || record.solution || record.raw_code || null;
                }
              }
              if (isValidCode(code)) {
                result.code = code;
                const apiLang = normalizeLanguageName(record.language || record.lang || accepted.language);
                if (apiLang) {
                  result.language = apiLang;
                  result.languageSource = "api";
                }
                result.submissionId = accepted.id ? String(accepted.id) : null;
                result.detectedAccepted = true;
                result.sourceMethod = "hackerrank-api";
              }
            }
          }
        } catch (e) {}
      }
    } else if (host.includes("vjudge.net")) {
      result.platform = "vjudge";
      result.contest = (document.title || "").replace(/\s*-\s*vJudge\s*$/i, "").trim() || null;

      const modalCode = document.querySelector("#solutionModal pre, #solutionModal code");
      if (modalCode && isValidCode(modalCode.textContent)) {
        result.code = modalCode.textContent;
        result.sourceMethod = "vjudge-modal";
      }

      if (!result.code && isTop) {
        const myUserEl = document.querySelector('#navbar a[href*="/user/"], .navbar a[href*="/user/"]');
        const myUser = myUserEl && ((myUserEl.href || "").match(/\/user\/([^/?#]+)/) || [])[1];
        const rows = Array.from(document.querySelectorAll("#listStatus tr, table tr"));
        for (const r of rows) {
          if (r.querySelector("th")) continue;
          if (!/\bAccepted\b/i.test(r.textContent || "")) continue;
          const userLink = r.querySelector('a[href*="/user/"]');
          const rowUser = userLink && ((userLink.href || "").match(/\/user\/([^/?#]+)/) || [])[1];
          if (myUser && rowUser && rowUser.toLowerCase() !== myUser.toLowerCase()) continue;
          const runId = r.getAttribute("data-id") || r.getAttribute("data-runid") ||
            ((r.querySelector('a[onclick*="showSource"], a[href*="solution"]')?.getAttribute("onclick") || "").match(/(\d{4,})/) || [])[1];
          if (runId) {
            try {
              const resp = await fetch(`/solution/data/${runId}`, { credentials: "include" });
              if (resp.ok) {
                const data = await resp.json();
                const c = data.code || data.source;
                if (isValidCode(c)) {
                  result.code = c;
                  if (data.language || data.langName) {
                    result.language = data.language || data.langName;
                    result.languageSource = "api";
                  }
                  result.submissionId = String(runId);
                  result.detectedAccepted = true;
                  result.sourceMethod = "vjudge-api";
                  const probCell = r.querySelector('[class*="problem"]') || (r.cells && r.cells[2]);
                  result.problemName = text(probCell) || result.contest;
                  result.problemId = result.problemName || String(runId);
                  break;
                }
              }
            } catch (e) {}
          }
        }
      }
      if (!result.problemName) {
        result.problemName = text(document.querySelector("#prob-title, h2, h1")) || result.contest;
      }
      if (!result.problemId) {
        result.problemId = location.pathname.split("/").filter(Boolean).pop() || result.problemName;
      }
    } else if (host.includes("neetcode.io")) {
      result.platform = "neetcode";
      result.problemId = location.pathname.split("/").filter(Boolean).pop() || null;
      result.problemName = text(document.querySelector("h1")) || (document.title || "").replace(/\s*-\s*NeetCode\s*$/i, "").trim();
      const diffEl = document.querySelector('[class*="difficulty" i], [class*="pill" i]');
      if (diffEl) {
        const dm = (diffEl.textContent || "").match(/\b(Easy|Medium|Hard)\b/i);
        if (dm) result.rating = dm[1];
      }
      if (!result.language || result.languageSource === "editor-model") {
        const domLang = detectLanguageFromDomSelectors();
        if (domLang) {
          result.language = normalizeLanguageName(domLang);
          result.languageSource = "dom-selector";
        }
      }
    } else {
      result.platform = "other";
      result.otherName = host.replace(/^www\./, "");
      result.problemId = location.pathname.split("/").filter(Boolean).pop() || result.otherName;
      result.problemName = text(document.querySelector("h1")) || document.title;
      if (!result.language || result.languageSource === "editor-model") {
        const domLang = detectLanguageFromDomSelectors();
        if (domLang) {
          result.language = normalizeLanguageName(domLang);
          result.languageSource = "dom-selector";
        }
      }
    }

    result.language = disambiguateCppVsC(result.code, result.language, result.languageSource);
  } catch (e) {
    result.error = String(e);
  }

  return result;
}

function sniffLanguageFromCode(code) {
  if (!code) return "";
  const hasCpp =
    /#include\s*<(?:iostream|bits\/stdc\+\+\.h|vector|string|algorithm|map|unordered_map|set|unordered_set|queue|stack|deque|utility|tuple|cstdio|cstdlib|cstring|iomanip|sstream|fstream|numeric|functional|memory|array|bitset|list)\b/.test(code) ||
    /\busing\s+namespace\s+std\b|\bstd::|\b(?:cout|cin|cerr)\s*(?:<<|>>)|\bclass\s+\w+\s*\{|\bpublic\s*:|\bprivate\s*:|\btemplate\s*<|\bnullptr\b|\bvector\s*</.test(code);
  if (hasCpp) return "C++17";
  const hasC =
    /#include\s*<(?:stdio\.h|stdlib\.h|string\.h|stdbool\.h|math\.h|limits\.h|stdint\.h|ctype\.h|assert\.h|time\.h|float\.h)>/.test(code) ||
    /\b(?:printf|scanf|fprintf|fscanf|sprintf|sscanf|fgets|fputs|puts|getchar|putchar|malloc|calloc|realloc|free)\s*\(|\btypedef\s+struct\b|\*\s*returnSize\b|\*\s*returnColumnSizes\b/.test(code);
  if (hasC) return "C";
  if (/^\s*def\s+\w+\s*\(|^\s*import\s+\w+|print\s*\(.*\)/m.test(code)) return "Python3";
  if (/public\s+class\s+\w+|System\.out\.println/.test(code)) return "Java";
  if (/fn\s+main\s*\(\)|println!\s*\(/.test(code)) return "Rust";
  if (/func\s+main\s*\(\)|package\s+main/.test(code)) return "Go";
  if (/console\.log\s*\(/.test(code)) return "JavaScript";
  return "";
}

function mergeFrameScanResults(injections) {
  const frames = (injections || []).map((x) => x && x.result).filter(Boolean);
  if (!frames.length) return null;

  const top = frames.find((f) => f.isTop) || frames[0];
  const merged = { ...top };

  const langPriority = (src) => {
    if (src === "api") return 4;
    if (src === "submission-table") return 3;
    if (src === "dom-selector") return 2;
    if (src === "editor-model") return 1;
    return 0;
  };

  // Prefer the best non-empty source code across all frames
  const codeFrames = frames
    .filter((f) => f.code && f.code.trim())
    .sort((a, b) => {
      const score = (f) => (f.sourceMethod && f.sourceMethod.includes("api") ? 3 : f.sourceMethod && f.sourceMethod.includes("submission") ? 3 : f.isTop ? 2 : 1);
      if (score(b) !== score(a)) return score(b) - score(a);
      return b.code.length - a.code.length;
    });

  if (codeFrames.length) {
    merged.code = codeFrames[0].code;
    merged.sourceMethod = codeFrames[0].sourceMethod;
    if (codeFrames[0].language && langPriority(codeFrames[0].languageSource) > langPriority(merged.languageSource)) {
      merged.language = codeFrames[0].language;
      merged.languageSource = codeFrames[0].languageSource;
    }
  }

  // Pick up highest-trust language and any missing metadata across frames
  for (const f of frames) {
    if (f.language && langPriority(f.languageSource) > langPriority(merged.languageSource)) {
      merged.language = f.language;
      merged.languageSource = f.languageSource;
    }
    if (!merged.submissionId && f.submissionId) merged.submissionId = f.submissionId;
    if (!merged.submissionUrl && f.submissionUrl) merged.submissionUrl = f.submissionUrl;
    if (!merged.detectedAccepted && f.detectedAccepted) merged.detectedAccepted = true;
  }

  // Final C vs C++ check using full merged code when language only came from editor-model/sniffing
  if (merged.code) {
    const sniffed = sniffLanguageFromCode(merged.code);
    if (!merged.language) {
      merged.language = sniffed || "C++17";
    } else if (langPriority(merged.languageSource) <= 1 && /^(?:c\+\+|c\+\+17|cpp)$/i.test(String(merged.language).trim()) && sniffed === "C") {
      merged.language = "C";
    }
  }

  return merged;
}

function selectManualLanguage(langRaw) {
  const select = $("mLanguage");
  const otherWrap = $("mOtherLanguageWrap");
  const otherInput = $("mOtherLanguage");
  if (!langRaw) {
    otherWrap.style.display = "none";
    return;
  }

  const raw = String(langRaw).trim();
  const low = raw.toLowerCase();

  // Direct option match first
  const exactOpt = Array.from(select.options).find((o) => o.value.toLowerCase() === low && o.value !== "other");
  if (exactOpt) {
    select.value = exactOpt.value;
    otherWrap.style.display = "none";
    otherInput.value = "";
    return;
  }

  // Normalized slug matches -> select standard dropdown options cleanly
  const slugMap = {
    "cpp": "C++17",
    "c++": "C++17",
    "c": "C",
    "python": "Python3",
    "python3": "Python3",
    "java": "Java",
    "javascript": "JavaScript",
    "js": "JavaScript",
    "typescript": "TypeScript",
    "ts": "TypeScript",
    "golang": "Go",
    "go": "Go",
    "rust": "Rust",
    "kotlin": "Kotlin",
    "csharp": "C#",
    "c#": "C#"
  };
  if (slugMap[low]) {
    select.value = slugMap[low];
    otherWrap.style.display = "none";
    otherInput.value = "";
    return;
  }

  // Rich compiler name like "GNU C++20 (64)" or "PyPy 3" -> preserve exact name via "other"
  select.value = "other";
  otherWrap.style.display = "block";
  otherInput.value = raw;
}

function applyScrapedToManualForm(data) {
  if (!data) return;
  if (data.platform && Array.from($("mPlatform").options).some((o) => o.value === data.platform && o.value !== "other")) {
    $("mPlatform").value = data.platform;
    $("mOtherWrap").style.display = "none";
    $("mOtherName").value = "";
  } else {
    $("mPlatform").value = "other";
    $("mOtherWrap").style.display = "block";
    $("mOtherName").value = data.otherName || data.platform || "";
  }

  if (data.problemId) $("mProblemId").value = data.problemId;
  if (data.problemName) $("mProblemName").value = data.problemName;
  if (data.url) $("mUrl").value = data.url;
  const groupVal = data.rating || data.contest || "";
  if (groupVal) $("mGroup").value = groupVal;
  if (data.language) selectManualLanguage(data.language);
  if (data.code) $("mCode").value = data.code;

  saveManualDraft();
}

async function runOneShotScan({ autoOpenConfirmation = true, statusEl = $("scanStatus") } = {}) {
  const scanBtn = $("scanAndPushBtn");
  const pendingScanBtn = $("scanFromPendingBtn");
  if (scanBtn) scanBtn.disabled = true;
  if (pendingScanBtn) pendingScanBtn.disabled = true;

  setStatus(statusEl, "Scanning active tab (metadata, language, code)...");

  try {
    const tab = await findTargetTab();
    if (!tab || !tab.id) {
      setStatus(statusEl, "Could not find an open judge tab to scan.", "err");
      return;
    }

    const injections = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      world: "MAIN",
      func: cpSyncScanActivePage
    });

    const scraped = mergeFrameScanResults(injections);
    if (!scraped || (!scraped.problemName && !scraped.problemId && !scraped.code)) {
      setStatus(statusEl, "Couldn't read a problem off that tab — fill in the fields below manually.", "err");
      return;
    }

    if (!autoOpenConfirmation) {
      applyScrapedToManualForm(scraped);
      setStatus(
        statusEl,
        scraped.code
          ? "Filled problem details & code from the active tab. Review and click Push to GitHub."
          : "Filled problem metadata from the active tab — paste your code below and push.",
        "ok"
      );
      return;
    }

    // If no code was captured, populate Manual Push fields so the user only pastes code
    if (!scraped.code || !scraped.code.trim()) {
      applyScrapedToManualForm(scraped);
      activateTab("manual");
      chrome.storage.local.set({ cpsync_active_tab: "manual" });
      setStatus(
        $("scanStatus"),
        "Scraped problem info, but no source code was found on the page — paste your solution below and click Push to GitHub.",
        "err"
      );
      $("mCode").focus();
      return;
    }

    // Build payload & register as pending confirmation card
    const platform = scraped.platform === "other" ? (scraped.otherName || "other") : (scraped.platform || "other");
    const payload = {
      platform,
      problemName: scraped.problemName || scraped.problemId || "problem",
      problemId: scraped.problemId || scraped.problemName || "problem",
      rating: scraped.rating || null,
      contest: scraped.contest || null,
      language: scraped.language || "unknown",
      code: scraped.code,
      url: scraped.url || tab.url || "",
      submissionId: scraped.submissionId || null,
      submissionUrl: scraped.submissionUrl || null,
      verdict: "Accepted",
      detectedAccepted: Boolean(scraped.detectedAccepted),
      manualScan: true
    };

    chrome.runtime.sendMessage({ type: "CP_SYNC_REGISTER_PENDING", payload }, (res) => {
      if (chrome.runtime.lastError) {
        setStatus(statusEl, "Scan succeeded, but failed to stage push: " + chrome.runtime.lastError.message, "err");
        return;
      }
      if (!res || !res.ok || !res.pendingItem) {
        applyScrapedToManualForm(scraped);
        setStatus(statusEl, "Could not stage push: " + (res ? res.error : "unknown error"), "err");
        return;
      }

      highlightPendingId = res.pendingItem.id;
      setStatus($("scanStatus"), "");
      setStatus($("pendingScanStatus"), "");
      activateTab("pending");
      chrome.storage.local.set({ cpsync_active_tab: "pending" });
      loadPendingItems();
      refreshStats();
    });
  } catch (e) {
    setStatus(
      statusEl,
      "Scan failed: " + (e.message || e) + " (switch to a judge tab — chrome:// or browser pages cannot be scanned)",
      "err"
    );
  } finally {
    if (scanBtn) scanBtn.disabled = false;
    if (pendingScanBtn) pendingScanBtn.disabled = false;
  }
}

if ($("scanAndPushBtn")) {
  $("scanAndPushBtn").addEventListener("click", () => {
    runOneShotScan({ autoOpenConfirmation: true, statusEl: $("scanStatus") });
  });
}

if ($("scanFromPendingBtn")) {
  $("scanFromPendingBtn").addEventListener("click", () => {
    runOneShotScan({ autoOpenConfirmation: true, statusEl: $("pendingScanStatus") });
  });
}

$("autofillBtn").addEventListener("click", () => {
  runOneShotScan({ autoOpenConfirmation: false, statusEl: $("scanStatus") });
});

$("clearAllBtn").addEventListener("click", () => {
  clearManualDraft(MANUAL_FIELD_IDS);
  $("mLanguage").value = "C++17";
  $("mPlatform").value = "codeforces";
  $("mOtherWrap").style.display = "none";
  $("mOtherLanguageWrap").style.display = "none";
  setStatus($("scanStatus"), "Cleared.", "ok");
  setStatus($("manualStatus"), "");
});

// ---------------------------------------------------------------------
// History tab
// ---------------------------------------------------------------------
function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function loadHistory() {
  chrome.runtime.sendMessage({ type: "CP_SYNC_GET_HISTORY" }, (res) => {
    const list = $("historyList");
    const history = (res && res.history) || [];
    if (!history.length) {
      list.innerHTML = '<p class="hint">No pushes yet.</p>';
      return;
    }
    list.innerHTML = history
      .map(
        (h) => `
      <div class="history-item">
        <div class="history-item-top">
          <span class="history-item-name">${escapeHtml(h.problemName || h.path || "problem")}</span>
          <span class="badge ${h.status}">${h.status}</span>
        </div>
        <div class="history-item-path">${escapeHtml(h.path || "")}</div>
        <div class="history-item-footer">
          <span class="history-item-time">${timeAgo(h.timestamp)} - ${escapeHtml(h.platform || "")}</span>
          ${h.status === "success" && h.htmlUrl ? `<a class="history-item-link" href="${escapeHtml(h.htmlUrl)}" target="_blank" rel="noopener">View on GitHub ↗</a>` : ""}
        </div>
        ${h.status === "failed" ? `<div class="history-item-detail">${escapeHtml(h.detail || "")}</div>` : ""}
      </div>`
      )
      .join("");
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

$("retryFailed").addEventListener("click", () => {
  $("retryFailed").textContent = "Retrying...";
  chrome.runtime.sendMessage({ type: "CP_SYNC_RETRY_FAILED" }, () => {
    $("retryFailed").textContent = "Retry failed";
    loadHistory();
    refreshStats();
  });
});

$("clearHistory").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CP_SYNC_CLEAR_HISTORY" }, () => loadHistory());
});

// ---------------------------------------------------------------------
// Advanced tab
// ---------------------------------------------------------------------
async function loadAdvanced() {
  const settings = await chrome.storage.sync.get(SETTINGS_DEFAULTS);
  $("commitTemplate").value = settings.commitMessageTemplate || SETTINGS_DEFAULTS.commitMessageTemplate;
  $("skipDuplicates").checked = settings.skipDuplicateCode !== false;
}

$("saveAdvanced").addEventListener("click", async () => {
  await chrome.storage.sync.set({
    commitMessageTemplate: $("commitTemplate").value.trim() || SETTINGS_DEFAULTS.commitMessageTemplate,
    skipDuplicateCode: $("skipDuplicates").checked
  });
  setStatus($("advancedStatus"), "Saved", "ok");
  setTimeout(() => setStatus($("advancedStatus"), ""), 2000);
});

$("exportSettings").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CP_SYNC_EXPORT_SETTINGS" }, (res) => {
    if (!res || !res.ok) {
      setStatus($("importExportStatus"), "Export failed.", "err");
      return;
    }
    const blob = new Blob([JSON.stringify(res.settings, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cp-sync-settings.json";
    a.click();
    URL.revokeObjectURL(url);
    setStatus($("importExportStatus"), "Exported (token excluded for safety).", "ok");
  });
});

$("importSettingsBtn").addEventListener("click", () => $("importFile").click());

$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const settings = JSON.parse(text);
    chrome.runtime.sendMessage({ type: "CP_SYNC_IMPORT_SETTINGS", settings }, (res) => {
      if (res && res.ok) {
        setStatus($("importExportStatus"), "Imported. Re-enter your token in the General tab.", "ok");
        loadGeneral();
        loadAdvanced();
      } else {
        setStatus($("importExportStatus"), "Import failed.", "err");
      }
    });
  } catch (err) {
    setStatus($("importExportStatus"), "Invalid settings file.", "err");
  }
  e.target.value = "";
});

// ---------------------------------------------------------------------
// Stats strip
// ---------------------------------------------------------------------
function refreshStats() {
  chrome.runtime.sendMessage({ type: "CP_SYNC_GET_STATS" }, (res) => {
    if (!res || !res.ok) return;
    $("streakValue").textContent = res.streak || 0;
    const total = Object.values(res.stats.totalByPlatform || {}).reduce((a, b) => a + b, 0);
    $("totalValue").textContent = total;
  });
  chrome.runtime.sendMessage({ type: "CP_SYNC_GET_PENDING_ITEMS" }, (res) => {
    const count = (res && res.items && res.items.length) || 0;
    if ($("pendingValue")) $("pendingValue").textContent = count;
    const badge = $("pendingBadge");
    if (badge) {
      if (count > 0) {
        badge.textContent = count;
        badge.style.display = "inline";
      } else {
        badge.style.display = "none";
      }
    }
  });
}

// ---------------------------------------------------------------------
// Pending Confirmations tab
// ---------------------------------------------------------------------
const QUICK_LANG_OPTIONS = [
  "C", "C++17", "Python3", "Java", "JavaScript", "TypeScript", "Go", "Rust", "Kotlin", "C#"
];

function buildPendingLangOptions(currentLang) {
  const cur = (currentLang || "unknown").trim();
  const opts = [...QUICK_LANG_OPTIONS];
  const exists = opts.some((o) => o.toLowerCase() === cur.toLowerCase());
  if (!exists && cur) opts.unshift(cur);
  return opts
    .map((o) => {
      const selected = o.toLowerCase() === cur.toLowerCase() ? "selected" : "";
      return `<option value="${escapeHtml(o)}" ${selected}>${escapeHtml(o)}</option>`;
    })
    .join("");
}

function showLastPushBanner(path, htmlUrl) {
  const banner = $("lastPushBanner");
  if (!banner) return;
  banner.innerHTML = `
    <span>✓ Pushed to <code>${escapeHtml(path)}</code></span>
    <span style="display:flex;align-items:center;gap:6px">
      ${htmlUrl ? `<a href="${escapeHtml(htmlUrl)}" target="_blank" rel="noopener">View ↗</a>` : ""}
      <button type="button" class="push-banner-close" title="Dismiss">×</button>
    </span>
  `;
  banner.style.display = "flex";
  const closeBtn = banner.querySelector(".push-banner-close");
  if (closeBtn) closeBtn.addEventListener("click", () => { banner.style.display = "none"; });
}

function loadPendingItems() {
  chrome.runtime.sendMessage({ type: "CP_SYNC_GET_PENDING_ITEMS" }, (res) => {
    const list = $("pendingList");
    if (!list) return;
    const items = ((res && res.items) || []).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!items.length) {
      list.innerHTML = '<p class="hint">No pending submissions awaiting confirmation. Click <b>Scan Tab</b> above when viewing an accepted problem.</p>';
      return;
    }

    list.innerHTML = items
      .map((item) => {
        const lineCount = (item.code || "").split(/\r?\n/).length;
        return `
      <div class="pending-card ${highlightPendingId === item.id ? "highlight" : ""}" id="card-${item.id}">
        <div class="pending-card-header">
          <span class="pending-card-title">${escapeHtml(item.problemName || item.problemId)}</span>
          <div class="pending-card-badges">
            ${item.manualScan ? '<span class="pending-card-badge scanned">SCANNED</span>' : ""}
            <span class="pending-card-badge">${escapeHtml((item.verdict || "ACCEPTED").toUpperCase())}</span>
          </div>
        </div>

        <div class="pending-grid">
          <div class="pending-grid-item">
            <span class="pending-grid-label">Platform</span>
            <span class="pending-grid-val">${escapeHtml(item.platform || "unknown")}</span>
          </div>
          <div class="pending-grid-item">
            <span class="pending-grid-label">Problem Code</span>
            <span class="pending-grid-val">${escapeHtml(item.problemId || "N/A")}</span>
          </div>
          <div class="pending-grid-item">
            <span class="pending-grid-label">Language</span>
            <select class="pending-lang-select" data-id="${item.id}" title="Switch language and update file extension">
              ${buildPendingLangOptions(item.language)}
            </select>
          </div>
          <div class="pending-grid-item">
            <span class="pending-grid-label">Target Repo</span>
            <span class="pending-grid-val">${escapeHtml(item.targetOwner || "Buddhadeb-ss")}/${escapeHtml(item.targetRepo || "coding-practice")} (${escapeHtml(item.targetBranch || "main")})</span>
          </div>
          <div class="pending-grid-item full">
            <span class="pending-grid-label">Proposed File Path</span>
            <span class="pending-grid-val mono" id="path-${item.id}">${escapeHtml(item.proposedPath || "")}</span>
          </div>
          ${item.submissionId ? `
          <div class="pending-grid-item full">
            <span class="pending-grid-label">Submission ID</span>
            <span class="pending-grid-val mono">${escapeHtml(item.submissionId)}</span>
          </div>` : ""}
        </div>

        <div>
          <div class="pending-code-header">
            <label style="margin:0">Captured Code (${lineCount} lines, ${(item.code || "").length} chars)</label>
            ${lineCount > 7 ? `<button type="button" class="code-toggle-btn" data-id="${item.id}">Expand</button>` : ""}
          </div>
          <pre class="pending-code-preview" id="code-${item.id}"><code>${escapeHtml(item.code || "")}</code></pre>
        </div>

        <div class="pending-status-msg ${item.alreadyPushed ? "info" : ""}" id="msg-${item.id}">${
          item.alreadyPushed ? "Identical code was already pushed to this path previously. Click Push Again to re-commit anyway." : ""
        }</div>

        <div class="pending-card-actions">
          <button class="secondary pending-cancel-btn" data-id="${item.id}">Cancel</button>
          <button class="secondary pending-edit-btn" data-id="${item.id}" title="Edit scraped fields in Scan &amp; Push">Edit</button>
          <button class="pending-push-btn" data-id="${item.id}">${item.alreadyPushed ? "Push Again" : "Push to GitHub"}</button>
        </div>
      </div>`;
      })
      .join("");

    highlightPendingId = null;

    // Wire action buttons
    items.forEach((item) => {
      const card = $(`card-${item.id}`);
      if (!card) return;
      const cancelBtn = card.querySelector(".pending-cancel-btn");
      const editBtn = card.querySelector(".pending-edit-btn");
      const pushBtn = card.querySelector(".pending-push-btn");
      const langSelect = card.querySelector(".pending-lang-select");
      const toggleBtn = card.querySelector(".code-toggle-btn");
      const codePre = $(`code-${item.id}`);
      const pathEl = $(`path-${item.id}`);
      const statusMsg = $(`msg-${item.id}`);
      let isConflictState = false;

      if (toggleBtn && codePre) {
        toggleBtn.addEventListener("click", () => {
          const expanded = codePre.classList.toggle("expanded");
          toggleBtn.textContent = expanded ? "Collapse" : "Expand";
        });
      }

      if (langSelect) {
        langSelect.addEventListener("change", () => {
          const nextLang = langSelect.value;
          chrome.runtime.sendMessage({ type: "CP_SYNC_UPDATE_PENDING_LANGUAGE", pendingId: item.id, language: nextLang }, (uRes) => {
            if (uRes && uRes.ok && uRes.pendingItem) {
              item.language = uRes.pendingItem.language;
              item.proposedPath = uRes.pendingItem.proposedPath;
              item.alreadyPushed = uRes.pendingItem.alreadyPushed;
              if (pathEl) pathEl.textContent = item.proposedPath;
              isConflictState = false;
              pushBtn.style.backgroundColor = "";
              pushBtn.textContent = item.alreadyPushed ? "Push Again" : "Push to GitHub";
              if (item.alreadyPushed) {
                statusMsg.className = "pending-status-msg info";
                statusMsg.textContent = "Identical code was already pushed to this path previously. Click Push Again to re-commit anyway.";
                statusMsg.style.display = "block";
              } else {
                statusMsg.className = "pending-status-msg";
                statusMsg.textContent = "";
                statusMsg.style.display = "none";
              }
            }
          });
        });
      }

      cancelBtn.addEventListener("click", () => {
        cancelBtn.disabled = true;
        editBtn.disabled = true;
        pushBtn.disabled = true;
        chrome.runtime.sendMessage({ type: "CP_SYNC_CANCEL_PENDING", pendingId: item.id }, () => {
          loadPendingItems();
          refreshStats();
        });
      });

      editBtn.addEventListener("click", () => {
        applyScrapedToManualForm({
          platform: item.platform,
          problemId: item.problemId,
          problemName: item.problemName,
          rating: item.rating,
          contest: item.contest,
          language: item.language,
          code: item.code,
          url: item.url
        });
        chrome.runtime.sendMessage({ type: "CP_SYNC_CANCEL_PENDING", pendingId: item.id }, () => {
          refreshStats();
          activateTab("manual");
          chrome.storage.local.set({ cpsync_active_tab: "manual" });
          setStatus($("scanStatus"), "Loaded into form for editing.", "ok");
        });
      });

      pushBtn.addEventListener("click", () => {
        pushBtn.disabled = true;
        editBtn.disabled = true;
        cancelBtn.disabled = true;
        statusMsg.className = "pending-status-msg";
        statusMsg.textContent = isConflictState ? "Overwriting on GitHub..." : "Pushing to GitHub...";
        statusMsg.style.display = "block";

        chrome.runtime.sendMessage(
          {
            type: "CP_SYNC_CONFIRM_PUSH",
            pendingId: item.id,
            overwrite: isConflictState,
            force: Boolean(item.alreadyPushed)
          },
          (res) => {
            if (chrome.runtime.lastError) {
              statusMsg.className = "pending-status-msg error";
              statusMsg.textContent = "Error: " + chrome.runtime.lastError.message;
              pushBtn.disabled = false;
              editBtn.disabled = false;
              cancelBtn.disabled = false;
              return;
            }

            if (res && res.conflict) {
              isConflictState = true;
              statusMsg.className = "pending-status-msg conflict";
              statusMsg.textContent = "⚠️ " + res.message;
              pushBtn.disabled = false;
              editBtn.disabled = false;
              cancelBtn.disabled = false;
              pushBtn.textContent = "Confirm Overwrite";
              pushBtn.style.backgroundColor = "#d97706";
              return;
            }

            if (res && res.ok) {
              statusMsg.className = "pending-status-msg success";
              statusMsg.textContent = `✓ Successfully pushed to ${res.path}!`;
              showLastPushBanner(res.path, res.htmlUrl);
              setTimeout(() => {
                loadPendingItems();
                refreshStats();
              }, 900);
            } else {
              statusMsg.className = "pending-status-msg error";
              statusMsg.textContent = `✗ Push failed: ${res ? res.error : "Unknown error"}`;
              pushBtn.disabled = false;
              editBtn.disabled = false;
              cancelBtn.disabled = false;
            }
          }
        );
      });
    });
  });
}

async function refreshActiveTabChip() {
  const chip = $("activeTabChip");
  if (!chip) return;
  try {
    const tab = await findTargetTab();
    if (!tab || !tab.url || !/^https?:\/\//i.test(tab.url)) {
      chip.textContent = "Open a problem tab to scan";
      chip.className = "active-tab-chip";
      return;
    }
    const u = new URL(tab.url);
    const host = u.hostname.replace(/^www\./, "");
    const title = (tab.title || u.pathname).slice(0, 38);
    chip.textContent = `Ready: ${host} • ${title}`;
    chip.className = "active-tab-chip ready";
  } catch (e) {
    chip.textContent = "Open a problem tab to scan";
    chip.className = "active-tab-chip";
  }
}

if ($("pendingStatBox")) {
  $("pendingStatBox").addEventListener("click", () => {
    activateTab("pending");
    chrome.storage.local.set({ cpsync_active_tab: "pending" });
  });
}

loadGeneral();
loadAdvanced();
refreshStats();
refreshActiveTabChip();
