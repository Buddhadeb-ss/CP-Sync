// background.js - MV3 service worker
//
// Responsibilities:
//   1. Receive "solved problem" events from content scripts (or the manual
//      push form) and commit the code to GitHub via the Contents API.
//   2. Retry failed pushes with exponential backoff, and respect GitHub's
//      rate-limit headers instead of hammering the API.
//   3. Skip re-committing identical code (content-hash dedupe) so
//      resubmitting the same accepted solution doesn't spam your repo.
//   4. Keep a local history log + solve stats/streak, and expose them to
//      the popup.
//

const DEFAULT_COMMIT_TEMPLATE = "Solved: {problem} ({platform})";

const EXT_MAP = {
  // Exact short slugs used by LeetCode/HackerRank-style APIs - checked as
  // an exact match first, so "cpp" never gets shadowed by the plain "c" key.
  "cpp": "cpp", "c": "c", "java": "java", "python": "py", "python3": "py",
  "javascript": "js", "typescript": "ts", "golang": "go", "rust": "rs", "kotlin": "kt",
  "csharp": "cs", "ruby": "rb", "swift": "swift", "scala": "scala", "php": "php",
  "racket": "rkt", "erlang": "erl", "elixir": "ex", "dart": "dart", "mysql": "sql",
  "typescript3": "ts", "golang1": "go",
  // Display-name style strings (Codeforces/AtCoder/CodeChef/etc.) - used
  // as a substring fallback if no exact match above was found.
  "c++": "cpp", "gnu c++": "cpp", "c++17": "cpp", "c++20": "cpp", "c++14": "cpp", "c++11": "cpp",
  "gnu c": "c",
  "java 8": "java", "java 11": "java", "java 17": "java",
  "python 3": "py", "pypy": "py", "pypy 3": "py",
  "node.js": "js",
  "go ": "go",
  "c#": "cs", "mono c#": "cs",
  "sql": "sql",
  "markdown": "md",
  "haskell": "hs"
};

function guessExtension(languageRaw) {
  if (!languageRaw) return null;
  const lang = languageRaw.toLowerCase().trim();

  // Exact match wins outright - this is what fixes short API slugs like
  // "cpp" (which contains the letter "c" and would otherwise incorrectly
  // match the plain "c" key under naive substring matching).
  if (EXT_MAP[lang]) return EXT_MAP[lang];

  // Substring fallback, longest key first, so a more specific match like
  // "c++17" always wins over a shorter one like "c" for the same string.
  const keys = Object.keys(EXT_MAP).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (lang.includes(key)) return EXT_MAP[key];
  }
  return null;
}

// Fallback used only when the language string couldn't be read from the
// page at all (site DOM changed, etc.) - sniff the code itself rather
// than silently defaulting to .txt.
function guessExtensionFromCode(code) {
  if (!code) return "txt";
  if (/#include\s*<.*bits\/stdc\+\+|#include\s*<iostream>|std::|cout\s*<<|cin\s*>>/.test(code)) return "cpp";
  if (/#include\s*<stdio\.h>|printf\s*\(|scanf\s*\(/.test(code)) return "c";
  if (/^\s*def\s+\w+\s*\(|^\s*import\s+\w+|print\s*\(.*\)/m.test(code)) return "py";
  if (/public\s+class\s+\w+|System\.out\.println/.test(code)) return "java";
  if (/fn\s+main\s*\(\)|println!\s*\(/.test(code)) return "rs";
  if (/func\s+main\s*\(\)|package\s+main/.test(code)) return "go";
  if (/console\.log\s*\(/.test(code)) return "js";
  return "txt";
}

function sanitize(name) {
  return (name || "untitled")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 100);
}

function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// ----------
// Settings
// ---------------------------------------------------------------------------

const SETTINGS_DEFAULTS = {
  githubToken: "",
  githubOwner: "Buddhadeb-ss",
  githubRepo: "coding-practice",
  githubBranch: "main",
  commitMessageTemplate: DEFAULT_COMMIT_TEMPLATE,
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

const KNOWN_PLATFORMS = ["codeforces", "codechef", "leetcode", "neetcode", "hackerrank", "vjudge", "atcoder"];

async function getSettings() {
  return chrome.storage.sync.get(SETTINGS_DEFAULTS);
}

async function setSettings(partial) {
  await chrome.storage.sync.set(partial);
}

// ---------------------------------------------------------------------
// Local storage: history, stats, dedupe hashes, failed-push queue
// ---------------------------------------------------------------------

const HISTORY_KEY = "cpsync_history";
const STATS_KEY = "cpsync_stats";
const DEDUPE_KEY = "cpsync_dedupe";
const FAILED_QUEUE_KEY = "cpsync_failed_queue";
const PENDING_KEY = "cpsync_pending_items";
const CANCELED_KEY = "cpsync_canceled_items";
const MAX_HISTORY = 200;

async function getLocal(key, fallback) {
  const obj = await chrome.storage.local.get({ [key]: fallback });
  return obj[key];
}

async function setLocal(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

async function getPendingMap() {
  return getLocal(PENDING_KEY, {});
}

async function setPendingMap(map) {
  await setLocal(PENDING_KEY, map);
}

async function getCanceledList() {
  return getLocal(CANCELED_KEY, []);
}

async function addCanceled(identifier) {
  if (!identifier) return;
  const list = await getCanceledList();
  if (!list.includes(identifier)) {
    list.push(identifier);
    if (list.length > 500) list.shift();
    await setLocal(CANCELED_KEY, list);
  }
}

async function addHistoryEntry(entry) {
  const history = await getLocal(HISTORY_KEY, []);
  history.unshift({ ...entry, timestamp: Date.now() });
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  await setLocal(HISTORY_KEY, history);
}

async function updateStats(platform) {
  const stats = await getLocal(STATS_KEY, { totalByPlatform: {}, solvedDates: [] });
  stats.totalByPlatform[platform] = (stats.totalByPlatform[platform] || 0) + 1;
  const key = todayKey();
  if (!stats.solvedDates.includes(key)) stats.solvedDates.push(key);
  if (stats.solvedDates.length > 400) stats.solvedDates = stats.solvedDates.slice(-400);
  await setLocal(STATS_KEY, stats);
  await updateBadge(stats);
  return stats;
}

function computeStreak(solvedDates) {
  const set = new Set(solvedDates);
  let streak = 0;
  const cursor = new Date();
  if (!set.has(todayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (set.has(todayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

async function updateBadge(statsMaybe) {
  const pendingMap = await getPendingMap();
  const pendingCount = Object.keys(pendingMap).length;
  if (pendingCount > 0) {
    chrome.action.setBadgeText({ text: String(pendingCount) });
    chrome.action.setBadgeBackgroundColor({ color: "#d97706" });
    return;
  }
  const stats = statsMaybe || (await getLocal(STATS_KEY, { totalByPlatform: {}, solvedDates: [] }));
  const streak = computeStreak(stats.solvedDates || []);
  chrome.action.setBadgeText({ text: streak > 0 ? String(streak) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#238636" });
}

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getFailedQueue() {
  return getLocal(FAILED_QUEUE_KEY, []);
}

async function addToFailedQueue(payload) {
  const queue = await getFailedQueue();
  queue.push({ payload, failedAt: Date.now() });
  await setLocal(FAILED_QUEUE_KEY, queue);
}

async function removeFromFailedQueue(index) {
  const queue = await getFailedQueue();
  queue.splice(index, 1);
  await setLocal(FAILED_QUEUE_KEY, queue);
}

// ---------------------------------------------------------------------
// Path / commit message building
// ---------------------------------------------------------------------

function buildPath(payload) {
  const platform = sanitize(payload.platform || "misc").toLowerCase();
  const ext = guessExtension(payload.language) || guessExtensionFromCode(payload.code);
  let groupFolder = "misc";

  if (platform === "codeforces") {
    if (payload.rating) {
      const r = parseInt(payload.rating, 10);
      const bucketStart = Math.floor(r / 100) * 100;
      groupFolder = `${bucketStart}-${bucketStart + 99}`;
    } else {
      groupFolder = "Unrated";
    }
  } else if (platform === "leetcode") {
    groupFolder = sanitize(payload.rating || "Unrated");
  } else if (platform === "codechef") {
    const langFolderMap = {
      "c": "C",
      "cpp": "Cpp",
      "py": "Python",
      "java": "Java",
      "js": "JavaScript",
      "ts": "TypeScript",
      "go": "Go",
      "rs": "Rust",
      "cs": "CSharp",
      "kt": "Kotlin",
      "rb": "Ruby",
      "php": "PHP",
      "hs": "Haskell",
      "scala": "Scala",
      "swift": "Swift"
    };
    const langFolder = langFolderMap[ext] || (payload.language ? sanitize(payload.language) : "Other");
    const probId = sanitize(payload.problemId || "");
    const probName = sanitize(payload.problemName || "");
    let baseFileName = probId || probName || "solution";
    if (probId && probName && probName.toLowerCase() !== probId.toLowerCase()) {
      if (probName.toLowerCase().startsWith(probId.toLowerCase())) {
        baseFileName = probName;
      } else {
        baseFileName = `${probId} - ${probName}`;
      }
    }
    const fileName = `${baseFileName}.${ext}`;
    return `CodeChef/${langFolder}/${fileName}`;
  } else if (platform === "atcoder") {
    groupFolder = sanitize(payload.contest || "Contests");
  } else if (platform === "hackerrank") {
    groupFolder = sanitize(payload.rating || payload.contest || "Practice");
  } else if (platform === "vjudge") {
    groupFolder = sanitize(payload.contest || "Contests");
  } else if (platform === "neetcode") {
    groupFolder = sanitize(payload.rating || "Uncategorized");
  }

  const fileName = `${sanitize(payload.problemId || payload.problemName)}.${ext}`;
  return `${platform}/${groupFolder}/${fileName}`;
}

function buildCommitMessage(template, payload) {
  return (template || DEFAULT_COMMIT_TEMPLATE)
    .replace(/\{problem\}/g, payload.problemName || payload.problemId || "problem")
    .replace(/\{platform\}/g, payload.platform || "")
    .replace(/\{contest\}/g, payload.contest || "")
    .replace(/\{rating\}/g, payload.rating || "")
    .replace(/\{language\}/g, payload.language || "");
}

function buildFileHeader(payload) {
  const ext = guessExtension(payload.language) || guessExtensionFromCode(payload.code);
  const isHashComment = ["py", "rb", "sh", "bash", "pl", "r"].includes(ext);
  const isDashComment = ["sql", "lua", "hs"].includes(ext);
  const pfx = isHashComment ? "# " : (isDashComment ? "-- " : "// ");

  const lines = [
    `${pfx}Problem: ${payload.problemName || payload.problemId || ""}`,
    payload.problemId ? `${pfx}Problem Code: ${payload.problemId}` : null,
    `${pfx}Platform: CodeChef`,
    payload.contest ? `${pfx}Contest: ${payload.contest}` : null,
    payload.rating ? `${pfx}Difficulty / Rating: ${payload.rating}` : null,
    `${pfx}Language: ${payload.language || ext || "unknown"}`,
    payload.verdict ? `${pfx}Verdict: ${payload.verdict}` : null,
    payload.url ? `${pfx}Problem URL: ${payload.url}` : null,
    payload.submissionId ? `${pfx}Submission ID: ${payload.submissionId}` : null,
    payload.submissionUrl ? `${pfx}Submission URL: ${payload.submissionUrl}` : null,
    `${pfx}Solved on: ${new Date().toISOString()}`,
    "",
    ""
  ].filter((l) => l !== null);
  return lines.join("\n");
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function notify(title, message) {
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title,
      message,
      buttons: [{ title: "Dismiss" }],
      priority: 0
    });
  } catch (e) {
    /* notifications may be unavailable in some environments; ignore */
  }
}

chrome.notifications.onButtonClicked.addListener((notificationId) => {
  chrome.notifications.clear(notificationId);
});

chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.notifications.clear(notificationId);
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------
// GitHub push (with retry/backoff + rate-limit awareness)
// ---------------------------------------------------------------------

async function githubRequest(url, options, attempt = 1) {
  const resp = await fetch(url, options);

  if (resp.status === 403 && resp.headers.get("x-ratelimit-remaining") === "0") {
    const resetEpoch = parseInt(resp.headers.get("x-ratelimit-reset") || "0", 10);
    const resetDate = resetEpoch ? new Date(resetEpoch * 1000).toLocaleTimeString() : "soon";
    throw new Error(`GitHub API rate limit hit. Resets around ${resetDate}.`);
  }

  if (resp.status >= 500 && attempt < 3) {
    await sleep(500 * Math.pow(2, attempt)); // 1s, 2s
    return githubRequest(url, options, attempt + 1);
  }

  return resp;
}

async function pushToGithub(payload, { isRetry = false, sha: explicitSha = null } = {}) {
  const settings = await getSettings();
  const { githubToken, githubOwner, githubRepo, githubBranch, commitMessageTemplate, skipDuplicateCode } = settings;

  if (settings.extensionEnabled === false) {
    return { ok: false, error: "extension_disabled", skipped: true };
  }

  if (!githubToken || !githubOwner || !githubRepo) {
    notify("CP Sync: Setup needed", "Open the extension popup and add your GitHub token, owner, and repo name.");
    return { ok: false, error: "not_configured" };
  }

  const isKnownPlatform = KNOWN_PLATFORMS.includes((payload.platform || "").toLowerCase());
  if (isKnownPlatform && settings.platformsEnabled && settings.platformsEnabled[payload.platform] === false) {
    return { ok: false, error: "platform_disabled", skipped: true };
  }
  if (!isKnownPlatform && settings.otherJudgesEnabled === false) {
    return { ok: false, error: "other_judges_disabled", skipped: true };
  }

  const path = payload.proposedPath || buildPath(payload);
  const content = buildFileHeader(payload) + (payload.code || "// (no source captured)");
  const codeHash = await sha256Hex(payload.code || "");

  if (skipDuplicateCode) {
    const dedupeMap = await getLocal(DEDUPE_KEY, {});
    if (dedupeMap[path] === codeHash) {
      await addHistoryEntry({ platform: payload.platform, problemName: payload.problemName, path, status: "skipped", detail: "identical code already pushed" });
      return { ok: true, skipped: true, path };
    }
  }

  const encodedContent = utf8ToBase64(content);
  const apiBase = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${githubToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  try {
    let sha = explicitSha;
    if (!sha) {
      const getResp = await githubRequest(`${apiBase}?ref=${encodeURIComponent(githubBranch)}`, { headers });
      if (getResp.status === 200) {
        const existing = await getResp.json();
        sha = existing.sha;
      }
    }

    const body = {
      message: buildCommitMessage(commitMessageTemplate, payload),
      content: encodedContent,
      branch: githubBranch
    };
    if (sha) body.sha = sha;

    const putResp = await githubRequest(apiBase, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (putResp.status === 200 || putResp.status === 201) {
      const dedupeMap = await getLocal(DEDUPE_KEY, {});
      dedupeMap[path] = codeHash;
      await setLocal(DEDUPE_KEY, dedupeMap);

      await addHistoryEntry({ platform: payload.platform, problemName: payload.problemName, path, status: "success", url: payload.url });
      await updateStats(payload.platform);

      notify("Pushed to GitHub", `${payload.problemName || payload.problemId} -> ${path}`);
      return { ok: true, path };
    }

    const errBody = await putResp.text();
    throw new Error(`GitHub responded ${putResp.status}: ${errBody.slice(0, 300)}`);
  } catch (e) {
    console.error("[CP Sync] push failed", e);
    await addHistoryEntry({ platform: payload.platform, problemName: payload.problemName, path, status: "failed", detail: String(e.message || e) });
    if (!isRetry) await addToFailedQueue(payload);
    notify("GitHub push failed", String(e.message || e));
    return { ok: false, error: String(e.message || e) };
  }
}

async function registerPendingItem(payload, sender) {
  if (!payload || (payload.verdict || "").toLowerCase() !== "accepted") {
    return { ok: false, error: "Verdict is not Accepted" };
  }
  if (!payload.code || typeof payload.code !== "string" || !payload.code.trim()) {
    return { ok: false, error: "Source code was not captured" };
  }

  const settings = await getSettings();
  if (settings.extensionEnabled === false) {
    return { ok: false, error: "extension_disabled", skipped: true };
  }

  const isKnownPlatform = KNOWN_PLATFORMS.includes((payload.platform || "").toLowerCase());
  if (isKnownPlatform && settings.platformsEnabled && settings.platformsEnabled[payload.platform] === false) {
    return { ok: false, error: "platform_disabled", skipped: true };
  }
  if (!isKnownPlatform && settings.otherJudgesEnabled === false) {
    return { ok: false, error: "other_judges_disabled", skipped: true };
  }

  const path = buildPath(payload);
  const codeHash = await sha256Hex(payload.code || "");

  // Check canceled list
  const canceledList = await getCanceledList();
  const subKey = payload.submissionId ? "sub_" + payload.submissionId : "hash_" + codeHash;
  if (canceledList.includes(subKey)) {
    return { ok: false, skipped: true, error: "This submission was previously canceled by user." };
  }

  // Check if identical code was already pushed
  if (settings.skipDuplicateCode) {
    const dedupeMap = await getLocal(DEDUPE_KEY, {});
    if (dedupeMap[path] === codeHash) {
      return { ok: false, skipped: true, error: "This exact code is already pushed to GitHub." };
    }
  }

  // Check if identical item is already pending
  const pendingMap = await getPendingMap();
  for (const id of Object.keys(pendingMap)) {
    const item = pendingMap[id];
    if (item.proposedPath === path && item.code === payload.code) {
      return { ok: true, pendingItem: item, existing: true };
    }
  }

  const pendingId = "pend_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  const pendingItem = {
    id: pendingId,
    platform: payload.platform || "codechef",
    problemName: payload.problemName || payload.problemId || "problem",
    problemId: payload.problemId || "problem",
    language: payload.language || "unknown",
    code: payload.code,
    url: payload.url || "",
    submissionId: payload.submissionId || null,
    submissionUrl: payload.submissionUrl || null,
    verdict: "Accepted",
    targetOwner: settings.githubOwner || "Buddhadeb-ss",
    targetRepo: settings.githubRepo || "coding-practice",
    targetBranch: settings.githubBranch || "main",
    proposedPath: path,
    createdAt: Date.now(),
    status: "pending_confirmation"
  };

  pendingMap[pendingId] = pendingItem;
  await setPendingMap(pendingMap);
  await updateBadge();

  notify("CP Sync: Solution Accepted", `${pendingItem.problemName} is ready to push. Review and confirm.`);
  return { ok: true, pendingItem };
}

async function confirmAndPush(pendingId, overwrite = false) {
  const pendingMap = await getPendingMap();
  const pendingItem = pendingMap[pendingId];
  if (!pendingItem || pendingItem.status !== "pending_confirmation") {
    return { ok: false, error: "Pending item not found or already processed." };
  }

  const settings = await getSettings();
  const { githubToken, githubOwner, githubRepo, githubBranch } = settings;
  const path = pendingItem.proposedPath;
  const apiBase = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${githubToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  try {
    let sha = null;
    const getResp = await githubRequest(`${apiBase}?ref=${encodeURIComponent(githubBranch)}`, { headers });
    if (getResp.status === 200) {
      const existing = await getResp.json();
      sha = existing.sha;
      if (!overwrite) {
        // Decode existing content and check if different
        let existingContent = "";
        try {
          const binary = atob((existing.content || "").replace(/\s/g, ""));
          const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
          existingContent = new TextDecoder().decode(bytes);
        } catch (e) {
          existingContent = "";
        }
        const proposedContent = buildFileHeader(pendingItem) + pendingItem.code;
        if (existingContent.trim() !== proposedContent.trim()) {
          return {
            ok: false,
            conflict: true,
            pendingId: pendingId,
            path: path,
            existingSha: sha,
            message: `A file already exists at ${path} on GitHub with different content.`
          };
        }
      }
    }

    const pushResult = await pushToGithub(pendingItem, { sha: sha });
    if (pushResult && pushResult.ok) {
      delete pendingMap[pendingId];
      await setPendingMap(pendingMap);
      await updateBadge();
      return { ok: true, path: path };
    } else {
      return { ok: false, error: pushResult ? pushResult.error : "Unknown push error" };
    }
  } catch (err) {
    console.error("[CP Sync] Confirm push failed:", err);
    return { ok: false, error: String(err.message || err) };
  }
}

async function cancelPendingItem(pendingId) {
  const pendingMap = await getPendingMap();
  const pendingItem = pendingMap[pendingId];
  if (pendingItem) {
    if (pendingItem.submissionId) {
      await addCanceled("sub_" + pendingItem.submissionId);
    }
    const codeHash = await sha256Hex(pendingItem.code || "");
    await addCanceled("hash_" + codeHash);
    delete pendingMap[pendingId];
    await setPendingMap(pendingMap);

    // Also purge from failedQueue if present
    const queue = await getFailedQueue();
    const filteredQueue = queue.filter((item) => {
      if (pendingItem.submissionId && item.payload && item.payload.submissionId === pendingItem.submissionId) return false;
      if (item.payload && item.payload.code === pendingItem.code) return false;
      return true;
    });
    if (filteredQueue.length !== queue.length) {
      await setLocal(FAILED_QUEUE_KEY, filteredQueue);
    }

    await updateBadge();
  }
  return { ok: true };
}

async function retryFailedQueue() {
  const queue = await getFailedQueue();
  const canceledList = await getCanceledList();
  const results = [];
  const remaining = [];
  for (const item of queue) {
    const codeHash = await sha256Hex((item.payload && item.payload.code) || "");
    const subKey = (item.payload && item.payload.submissionId) ? "sub_" + item.payload.submissionId : "hash_" + codeHash;
    if (canceledList.includes(subKey)) {
      continue; // Never retry a canceled item
    }
    const result = await pushToGithub(item.payload, { isRetry: true });
    results.push(result);
    if (!result.ok && !result.skipped) remaining.push(item);
  }
  await setLocal(FAILED_QUEUE_KEY, remaining);
  return { ok: true, attempted: queue.length, stillFailing: remaining.length };
}

async function testConnection() {
  const settings = await getSettings();
  const { githubToken, githubOwner, githubRepo } = settings;
  if (!githubToken || !githubOwner || !githubRepo) {
    return { ok: false, error: "Missing token, owner, or repo." };
  }
  try {
    const resp = await fetch(`https://api.github.com/repos/${githubOwner}/${githubRepo}`, {
      headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" }
    });
    if (resp.status === 200) {
      const data = await resp.json();
      return { ok: true, fullName: data.full_name, defaultBranch: data.default_branch };
    }
    return { ok: false, error: `GitHub responded with status ${resp.status}` };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// Message router
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  switch (message.type) {
    case "CP_SYNC_SOLVED":
    case "CP_SYNC_REGISTER_PENDING":
      registerPendingItem(message.payload, sender).then(sendResponse);
      return true;

    case "CP_SYNC_CONFIRM_PUSH":
      confirmAndPush(message.pendingId, message.overwrite).then(sendResponse);
      return true;

    case "CP_SYNC_CANCEL_PENDING":
      cancelPendingItem(message.pendingId).then(sendResponse);
      return true;

    case "CP_SYNC_GET_PENDING_ITEMS":
      getPendingMap().then((map) => sendResponse({ ok: true, items: Object.values(map) }));
      return true;

    case "CP_SYNC_MANUAL_PUSH":
      pushToGithub(message.payload).then(sendResponse);
      return true;

    case "CP_SYNC_TEST_CONNECTION":
      testConnection().then(sendResponse);
      return true;

    case "CP_SYNC_GET_HISTORY":
      getLocal(HISTORY_KEY, []).then((history) => sendResponse({ ok: true, history }));
      return true;

    case "CP_SYNC_CLEAR_HISTORY":
      setLocal(HISTORY_KEY, []).then(() => sendResponse({ ok: true }));
      return true;

    case "CP_SYNC_GET_STATS":
      getLocal(STATS_KEY, { totalByPlatform: {}, solvedDates: [] }).then((stats) => {
        sendResponse({ ok: true, stats, streak: computeStreak(stats.solvedDates || []) });
      });
      return true;

    case "CP_SYNC_GET_FAILED_QUEUE":
      getFailedQueue().then((queue) => sendResponse({ ok: true, queue }));
      return true;

    case "CP_SYNC_RETRY_FAILED":
      retryFailedQueue().then(sendResponse);
      return true;

    case "CP_SYNC_DISMISS_FAILED":
      removeFromFailedQueue(message.index).then(() => sendResponse({ ok: true }));
      return true;

    case "CP_SYNC_EXPORT_SETTINGS":
      getSettings().then((settings) => {
        const exportable = { ...settings, githubToken: "" }; // never export the secret token
        sendResponse({ ok: true, settings: exportable });
      });
      return true;

    case "CP_SYNC_IMPORT_SETTINGS":
      setSettings(message.settings || {}).then(() => sendResponse({ ok: true }));
      return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
});
