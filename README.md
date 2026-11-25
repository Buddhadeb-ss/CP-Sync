# CP Sync v2.2.0

[![Version](https://img.shields.io/badge/version-2.2.0-brightgreen.svg)](https://github.com/Buddhadeb-ss/CP-Sync)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)

**CP Sync** is a modern Chromium browser extension (Microsoft Edge, Google Chrome, Brave) that watches competitive programming platforms for **Accepted** solutions — or scans an open accepted problem on demand — and commits your code directly to your GitHub repository with **zero false positives**, **accurate C vs. C++ detection**, and **explicit user confirmation**.

---

## What Makes CP Sync v2.2.0 Better?

Previous versions of competitive programming sync extensions suffered from aggressive interval scraping: opening an old submission, refreshing a problem tab, or simply viewing a problem statement would accidentally trigger automatic git commits of whatever text was in the editor.

**CP Sync v2.2.0** pairs zero-false-positive event-driven detection with a fast one-shot active-tab scanner and polished confirmation UX:

| Feature | Legacy CP Sync | **CP Sync v2.2.0** |
|---|---|---|
| **Trigger Mechanism** | Unconditional 1.2s polling loop | **Strict Event-Driven State Machine** + **One-Shot Active Tab Scan** |
| **False Positive Prevention** | None (opening tabs pushes code) | **Zero False Positives** (opening tabs never pushes unless you explicitly click Scan) |
| **User Confirmation** | Auto-pushed without permission | **Explicit Confirmation Card** with code preview & inline language switcher |
| **Language Accuracy** | Generic editor mode (`cpp` for C) | **C vs. C++ Disambiguation** (`API > DOM selector > code markers > editor`) |
| **Popup Review** | No pending view | **Dedicated Pending Tab, Amber Badge & Direct GitHub Links** |
| **Conflict Safety** | Silent file overwrite | **GitHub Conflict Detection** & explicit **Push Again** override |
| **Persistence** | Wiped on reload | **Session-Backed** (survives page redirects, reloads, and multi-frame IDEs) |
| **Detection Reliability** | Brittle CSS class matching | **Dual-Channel** (Main-world all-frames scan + DOM & judge APIs) |
| **Cancellation Protection** | None | **Cancellation Blacklist** (canceled auto-items are never re-prompted) |

### What's New in v2.2.0
- **One-Shot Scan Page & Push**: Open any accepted problem or submission tab, click **Scan Page & Push** (or **Scan Tab** in Pending), and CP Sync scans all frames in the page's main world once to extract title, ID, difficulty/contest, language, submission ID, and source code straight into a confirmation card.
- **Accurate C vs. C++ Detection**: Uses a prioritized pipeline (`platform API > submission table > anchored DOM language selector > C/C++ header & keyword disambiguation > editor model`) plus boundary-safe `.c` extension mapping so C solutions are never misfiled under `Cpp/`.
- **Upgraded Confirmation & Popup UX**: Inline language dropdown on the Pending card (updates target file path live), expandable code preview, persistent **View on GitHub** links after pushing & in History, live active-tab target chip, token visibility toggle, and smart default tab routing.
- **Clean Extension Folder (`cp-sync/`)**: Renamed from `CP Sync 2.0.0` to `cp-sync` to eliminate spaces and stale version numbers in unpacked paths.

---

## Supported Platforms

| Platform | Domain | Supported Features |
|---|---|---|
| **CodeChef** | `codechef.com` | Standard problems, Contests, and modern **Practice / Course IDEs** (`/practice/course/...`) |
| **Codeforces** | `codeforces.com` | Accepted & Pretests Passed; categorized by rating brackets (e.g. `1500-1599/`) |
| **LeetCode** | `leetcode.com` | Solved submissions; categorized by difficulty (`Easy/`, `Medium/`, `Hard/`) |
| **NeetCode** | `neetcode.io` | Solved tracking & progress sync |
| **HackerRank** | `hackerrank.com` | Practice & Contests |
| **AtCoder** | `atcoder.jp` | Contests & ABC/ARC/AGC tasks |
| **vJudge** | `vjudge.net` | Virtual Judge problem sets |
| **Custom / Other Judges** | Any judge site | **Scan Page & Push** (active-tab scraping) & editable Manual Push |

---

## Organized Repository Structure

Your repository stays tidy and structured automatically:

```text
your-repo/
├── CodeChef/
│   ├── Cpp/
│   │   └── START01 - Number-Mirror.cpp
│   └── Python/
│       └── FLOW001 - Add-Two-Numbers.py
├── codeforces/
│   ├── 1500-1599/
│   │   └── 1873A.cpp
│   └── Unrated/
│       └── 200B.cpp
├── leetcode/
│   ├── Easy/
│   │   └── two-sum.py
│   └── Medium/
│       └── add-two-numbers.java
├── atcoder/
│   └── abc321/
│       └── A.cpp
└── hackerrank/
    └── Practice/
        └── simple-array-sum.cpp
```

Each committed solution includes a header comment with problem title, code, platform, submission ID, problem URL, and timestamp:

```cpp
// Problem: Number Mirror
// Problem Code: START01
// Platform: CodeChef
// Language: C++17
// Verdict: Accepted
// Problem URL: https://www.codechef.com/problems/START01
// Submission ID: 12345678
// Solved on: 2026-10-26T22:30:00.000Z

#include <iostream>
using namespace std;
int main() {
    int n;
    if (cin >> n) cout << n << endl;
    return 0;
}
```

---

## Installation & Setup

### 1. Load the Extension into Edge / Chrome / Brave

1. Clone or download this repository:
   ```bash
   git clone https://github.com/Buddhadeb-ss/CP-Sync.git
   ```
2. Open your browser's extension manager:
   - Microsoft Edge: `edge://extensions`
   - Google Chrome: `chrome://extensions`
   - Brave: `brave://extensions`
3. Enable **Developer mode** (toggle in the sidebar or top-right corner).
4. Click **Load unpacked** and select the `cp-sync` folder.
5. Pin the **CP Sync** icon to your toolbar for easy access.

---

### 2. Generate a GitHub Personal Access Token

1. Visit [GitHub Tokens (Fine-grained Beta)](https://github.com/settings/tokens?type=beta).
2. Set **Token name** (e.g. `CP-Sync-Token`) and set an expiration duration.
3. Under **Repository access**, select **Only select repositories** and pick your target repository (e.g. `coding-practice`).
4. Under **Repository permissions**, grant:
   - **Contents**: `Access: Read and write`
5. Click **Generate token** and copy the resulting `github_pat_...` string.

---

### 3. Configure CP Sync

1. Click the CP Sync extension icon in your browser toolbar.
2. In the **Settings** tab (shown automatically until configured):
   - **GitHub Personal Access Token**: Paste your token (use **Show/Hide** to verify if needed).
   - **GitHub Username / Org**: Your username (e.g. `Buddhadeb-ss`).
   - **Repository**: Your target repository name (e.g. `coding-practice`).
   - **Branch**: Target branch (default is `main`).
   - Select the platforms you want to sync.
3. Click **Save Settings**, then click **Test Connection** to confirm connectivity.

---

## How It Works: The 7-Stage Pipeline

```text
[1. Problem Page Opened]
        │
        ▼ (No action taken, no automatic scanning)
[2. Code Edited in Monaco / IDE]
        │
        ▼ (No action taken)
[3. User Clicks Submit or Ctrl+Enter]
        │
        ▼ (Snapshot editor source code, problem metadata, and solution IDs)
[4. State: Evaluating Verdict]
   ├── Non-Accepted (WA / TLE / Error / Partial) ──► Abort & Discard Attempt
   └── Verified Accepted (or Score 100) ───────────► Prepare Pending Item
        │
        ▼
[5. In-Page Confirmation Modal Displayed + Amber Badge]
   ├── Cancel / Dismiss / Escape ──────────────────► Blacklist Item (Never Retry)
   └── User Clicks [ Push to GitHub ]
        │
        ▼
[6. GitHub Safety & Conflict Check]
   ├── File exists with DIFFERENT content ────────► Show Conflict & Require Confirm Overwrite
   └── Clean / Overwrite Confirmed
        │
        ▼
[7. Commit Pushed via GitHub Contents API & Badge Cleared]
```

---

## One-Shot Scan & Manual Push

If you have an accepted problem or past submission open in front of you (or auto-detection missed it):
1. Open the CP Sync popup — the **Scan & Push** tab displays a live chip confirming the detected browser tab.
2. Click **Scan Page & Push** (or **Scan Tab** in **Pending**). CP Sync scans the active tab once across all editor frames (`MAIN` world) and judge APIs to scrape the problem title, ID, rating/contest, language, submission ID, and source code.
3. Review the **Pending** confirmation card: adjust the language inline if needed (updates the file path live), expand the code preview, and click **Push to GitHub** (or **Push Again** if identical code was pushed before).
4. Need to customize metadata or push when no code is on the page? Click **Edit** on the confirmation card or **Fill Fields Only** in **Scan & Push** to populate the editable form.

---

## Security & Privacy

- **No Remote Servers**: CP Sync has no analytics, tracking, or intermediary servers. All requests go directly from your browser to the judge site and `api.github.com`.
- **Token Protection**: Your GitHub token is stored solely in local extension storage (`chrome.storage.sync`) and is never exported in backup files.
- **Manifest V3 Compliant**: Built strictly on modern Chromium MV3 standards with background service workers.

---

## License

Distributed under the [MIT License](LICENSE). Copyright (c) 2026 Buddhadeb Banik.
