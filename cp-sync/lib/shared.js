// lib/shared.js
// NOTE: Content scripts are loaded as plain scripts (no ES module imports),
// so this file's contents are duplicated inline into each content script
// where needed. This copy is kept here as the single source of truth -
// if you change logic here, copy the change into the content scripts too.

/**
 * Sends a "solved problem" payload to the background service worker,
 * which will push the code to GitHub.
 *
 * payload shape:
 * {
 *   platform: 'codeforces' | 'codechef' | 'leetcode' | 'neetcode' | 'hackerrank' | 'vjudge' | 'atcoder',
 *   problemName: string,
 *   problemId: string,          // e.g. "1873A", "two-sum"
 *   rating: string | null,      // e.g. "1500" or "Medium" - used for folder grouping
 *   contest: string | null,     // e.g. "Codeforces Round 900 (Div 3)"
 *   language: string,           // e.g. "C++17", "Python3"
 *   code: string,               // full source code
 *   url: string,                // link back to the submission/problem
 *   verdict: string             // should be "Accepted" / "AC"
 * }
 */
function cpSyncSendSolved(payload) {
  try {
    chrome.runtime.sendMessage({ type: "CP_SYNC_SOLVED", payload }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("[CP Sync] message failed:", chrome.runtime.lastError.message);
        return;
      }
      console.log("[CP Sync] background response:", response);
    });
  } catch (e) {
    console.warn("[CP Sync] could not send message:", e);
  }
}

// Simple de-dupe helper so we don't push the same submission twice per page
// session (uses sessionStorage keyed by a unique id you pass in).
function cpSyncAlreadyHandled(uniqueId) {
  const key = "cpsync_handled_" + uniqueId;
  if (sessionStorage.getItem(key)) return true;
  sessionStorage.setItem(key, "1");
  return false;
}

// File-extension lookup used when building the GitHub file path.
const CP_SYNC_EXT_MAP = {
  "cpp": "cpp", "c": "c", "java": "java", "python": "py", "python3": "py",
  "javascript": "js", "typescript": "ts", "golang": "go", "rust": "rs", "kotlin": "kt",
  "csharp": "cs", "ruby": "rb", "swift": "swift", "scala": "scala", "php": "php",
  "haskell": "hs", "pascal": "pas", "dart": "dart",
  "c++": "cpp", "gnu c++": "cpp", "g++": "cpp", "c++17": "cpp", "c++20": "cpp", "c++14": "cpp", "c++11": "cpp",
  "gnu c": "c", "gnu c11": "c", "gnu c17": "c", "clang c": "c", "c99": "c", "c11": "c", "c17": "c",
  "java 8": "java", "java 11": "java", "java 17": "java",
  "python 3": "py", "pypy": "py", "pypy 3": "py", "pyth 3": "py",
  "node.js": "js",
  "go ": "go",
  "c#": "cs", "mono c#": "cs"
};

function cpSyncGuessExtension(languageRaw) {
  if (!languageRaw) return "txt";
  const lang = languageRaw.toLowerCase().trim();
  if (CP_SYNC_EXT_MAP[lang]) return CP_SYNC_EXT_MAP[lang];
  const keys = Object.keys(CP_SYNC_EXT_MAP).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (key === "c") {
      if (/(?:^|[^a-z])c(?:\d{2}|[^a-z+#]|$)/.test(lang)) return "c";
      continue;
    }
    if (lang.includes(key)) return CP_SYNC_EXT_MAP[key];
  }
  return "txt";
}

// Sanitize a string for safe use as a folder/file name.
function cpSyncSanitize(name) {
  return (name || "untitled")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 100);
}
