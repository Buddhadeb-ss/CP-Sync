// content_scripts/codechef.js
// CP Sync — Event-Driven, Multi-Trigger, Confirmation-Gated CodeChef Sync

(function () {
  console.log("[CP Sync] v" + chrome.runtime.getManifest().version + " initialized on frame:", location.href, "- top frame:", window === window.top);

  const PROMPT_MODAL_ID = "cpsync-confirmation-modal";
  const SESSION_SUB_KEY = "cpsync_active_submission";

  // -------------------------------------------------------------------------
  // Session-Backed Active Submission State
  // -------------------------------------------------------------------------
  function saveActiveSubmission(sub) {
    try {
      sessionStorage.setItem(SESSION_SUB_KEY, JSON.stringify(sub));
    } catch (e) {}
  }

  function getActiveSubmission() {
    try {
      const raw = sessionStorage.getItem(SESSION_SUB_KEY);
      if (!raw) return null;
      const sub = JSON.parse(raw);
      if (Date.now() - sub.initiatedAt > 240000) { // 4 min timeout
        clearActiveSubmission();
        return null;
      }
      return sub;
    } catch (e) {
      return null;
    }
  }

  function clearActiveSubmission() {
    try {
      sessionStorage.removeItem(SESSION_SUB_KEY);
    } catch (e) {}
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  function isInsideAiTutor(el) {
    if (!el || typeof el.closest !== "function") return false;
    return !!el.closest(
      '[class*="tutor" i], [id*="tutor" i], [class*="assistant" i], [id*="assistant" i], ' +
      '[class*="chat" i], [id*="chat" i], [class*="copilot" i], [id*="copilot" i]'
    );
  }

  function getProblemMeta() {
    const parts = location.pathname.split("/").filter(Boolean);
    let problemCode = "problem";
    let isViewSolution = false;
    let submissionId = null;

    if (parts.includes("viewsolution")) {
      isViewSolution = true;
      const idx = parts.indexOf("viewsolution");
      submissionId = parts[idx + 1] || null;
      const probLink = document.querySelector('a[href*="/problems/"], a[href*="/submit/"]');
      if (probLink) {
        const m = probLink.href.match(/\/(?:problems|submit)\/([^/?#]+)/);
        if (m) problemCode = m[1];
      }
    } else {
      problemCode = parts[parts.length - 1] || "problem";
      if (problemCode.toLowerCase() === "submit" && parts.length > 1) {
        problemCode = parts[parts.length - 2];
      }
    }

    const candidates = Array.from(document.querySelectorAll("h1, h2, .problem-title, ._problem-title, [class*='problemTitle'], [data-cy='problem-name']"));
    const titleEl = candidates.find((el) => !isInsideAiTutor(el));
    const title = titleEl ? titleEl.textContent.trim() : problemCode;
    return { problemCode, title, isViewSolution, submissionId };
  }

  function findSolutionLinks() {
    return Array.from(document.querySelectorAll('a[href*="/viewsolution/"], a[href*="/view/solution/"]'));
  }

  function idFromLink(link) {
    if (!link || !link.href) return "";
    const m = link.href.match(/(\d+)\s*$/);
    return m ? m[1] : link.href;
  }

  function requestCodeFromLiveEditor(timeoutMs = 1500) {
    return new Promise((resolve) => {
      const requestId = Math.random().toString(36).slice(2);
      function handler(event) {
        if (event.source !== window) return;
        const msg = event.data;
        if (!msg || msg.source !== "cpsync" || msg.type !== "CPSYNC_CODE_RESPONSE" || msg.requestId !== requestId) return;
        window.removeEventListener("message", handler);
        clearTimeout(timer);
        resolve({ code: msg.code || null, language: msg.language || null });
      }
      window.addEventListener("message", handler);
      const timer = setTimeout(() => {
        window.removeEventListener("message", handler);
        resolve({ code: null, language: null });
      }, timeoutMs);
      window.postMessage({ source: "cpsync", type: "CPSYNC_REQUEST_CODE", requestId }, "*");
    });
  }

  function normalizeText(text) {
    return (text || "")
      .toLowerCase()
      .replace(/[\u2018\u2019\u02BC\u00B4`']/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // -------------------------------------------------------------------------
  // Submission Initiation Detection (Multi-Trigger)
  // -------------------------------------------------------------------------
  function isSubmitClick(target) {
    if (!target) return false;
    let el = target;
    let depth = 0;
    while (el && el !== document.body && depth < 8) {
      if (isInsideAiTutor(el)) return false;
      const text = (el.innerText || el.textContent || el.value || "").trim().toLowerCase();
      const dataCy = (el.getAttribute("data-cy") || "").toLowerCase();
      const testId = (el.getAttribute("data-testid") || "").toLowerCase();
      const id = (el.id || "").toLowerCase();
      const cls = (el.className || "").toString().toLowerCase();
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();

      // Check specific submit attributes
      if (
        dataCy.includes("submit") ||
        testId.includes("submit") ||
        id.includes("submit") ||
        cls.includes("submit") ||
        aria.includes("submit")
      ) {
        if (!text.includes("run") && !cls.includes("run")) {
          return true;
        }
      }

      // Check button or clickable text
      const tag = (el.tagName || "").toLowerCase();
      const role = (el.getAttribute("role") || "").toLowerCase();
      if (tag === "button" || tag === "a" || role === "button" || cls.includes("btn") || cls.includes("button")) {
        if (text.startsWith("submit") || /\bsubmit\b/i.test(text)) {
          if (!text.includes("run")) {
            return true;
          }
        }
      }
      el = el.parentElement;
      depth++;
    }
    return false;
  }

  async function handleSubmissionInitiated(triggerSource, extraData = {}) {
    // If user is merely on a historical /viewsolution/ page, ignore
    if (location.pathname.includes("/viewsolution/")) return;

    const meta = getProblemMeta();
    console.log("[CP Sync] Submission attempt initiated via", triggerSource, "for problem:", meta.problemCode);

    // Snapshot existing solution links
    const initialSolutionIds = Array.from(findSolutionLinks().map(idFromLink));

    // Capture code and language
    let capturedCode = extraData.code || null;
    let capturedLang = extraData.language || null;

    if (!capturedCode) {
      const liveRes = await requestCodeFromLiveEditor();
      if (liveRes && liveRes.code) {
        capturedCode = liveRes.code;
        if (liveRes.language) capturedLang = liveRes.language;
      }
    }

    if (!capturedLang) {
      const langEl = document.querySelector('[class*="language"]');
      capturedLang = langEl ? langEl.textContent.trim() : "";
    }

    const sub = {
      initiatedAt: Date.now(),
      problemCode: meta.problemCode,
      problemTitle: meta.title,
      problemUrl: location.href,
      code: capturedCode,
      language: capturedLang,
      initialSolutionIds: initialSolutionIds,
      status: "evaluating"
    };

    saveActiveSubmission(sub);

    // If code wasn't captured immediately, retry shortly
    if (!sub.code) {
      setTimeout(async () => {
        const cur = getActiveSubmission();
        if (cur && !cur.code) {
          const retryRes = await requestCodeFromLiveEditor();
          if (retryRes && retryRes.code) {
            cur.code = retryRes.code;
            if (retryRes.language) cur.language = retryRes.language;
            saveActiveSubmission(cur);
          }
        }
      }, 500);
    }
  }

  // Intercept click on submit buttons
  document.addEventListener("click", (e) => {
    if (isSubmitClick(e.target)) {
      handleSubmissionInitiated("submit_button_click");
    }
  }, true);

  // Intercept Ctrl+Enter / Cmd+Enter
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      handleSubmissionInitiated("keyboard_shortcut");
    }
  }, true);

  // Intercept Network Submission from editor_hook.js
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== "cpsync") return;

    if (msg.type === "CPSYNC_NETWORK_SUBMISSION") {
      handleSubmissionInitiated("network_api_call", { code: msg.code, language: msg.language });
    } else if (msg.type === "CPSYNC_NETWORK_VERDICT") {
      const sub = getActiveSubmission();
      if (sub && sub.status === "evaluating") {
        if (msg.verdict === "Accepted") {
          console.log("[CP Sync] ACCEPTED verdict verified via Network API!");
          clearActiveSubmission();
          handleAcceptedVerdict(sub, msg.submissionId);
        } else {
          console.log("[CP Sync] REJECTED verdict received via Network API:", msg);
          clearActiveSubmission();
        }
      }
    } else if (msg.type === "CPSYNC_SHOW_MODAL" && window === window.top) {
      showConfirmationModal(msg.pendingItem);
    }
  });

  // -------------------------------------------------------------------------
  // Verdict Detection Engine (DOM-based)
  // -------------------------------------------------------------------------
  const ACCEPTED_PATTERNS = [
    "well done its correct",
    "correct answer",
    "accepted",
    "100 100",
    "100 pts",
    "score 100",
    "task score 100",
    "perfect answer",
    "awesome you nailed it",
    "you got it right",
    "hooray you did it",
    "excellent work",
    "great job keep it up"
  ];

  const REJECTED_PATTERNS = [
    "wrong answer",
    "time limit exceeded",
    "runtime error",
    "compilation error",
    "compile error",
    "internal error",
    "partially solved",
    "failed"
  ];

  function checkActiveSubmissionResult() {
    const sub = getActiveSubmission();
    if (!sub || sub.status !== "evaluating") return;

    // Scan page text excluding AI Tutor
    let bodyText = document.body ? document.body.innerText : "";
    const tutorEls = document.querySelectorAll(
      '[class*="tutor" i], [id*="tutor" i], [class*="assistant" i], [id*="assistant" i], [class*="chat" i], [id*="chat" i]'
    );
    tutorEls.forEach((el) => {
      if (el && el.innerText) {
        bodyText = bodyText.replace(el.innerText, " ");
      }
    });

    const normalized = normalizeText(bodyText);
    if (!normalized) return;

    // Check for negative verdicts or zero score first
    const rejectedMatch = REJECTED_PATTERNS.find((kw) => normalized.includes(kw));
    const isZeroScore = /\b(?:score\s*0|task score\s*0|0\s*100|0\s*pts)\b/.test(normalized);
    if (rejectedMatch || isZeroScore) {
      console.log("[CP Sync] Submission result is non-accepted:", rejectedMatch || "zero score");
      clearActiveSubmission();
      return;
    }

    // Ensure it's not a partial score (e.g. 1-99 out of 100)
    const isPartialScore = /\b[1-9][0-9]?\s*100\b/.test(normalized);
    if (isPartialScore && !normalized.includes("100 100")) {
      console.log("[CP Sync] Submission is only partially solved. Not publishing.");
      clearActiveSubmission();
      return;
    }

    // Check for accepted verdict
    const acceptedMatch = ACCEPTED_PATTERNS.find((kw) => normalized.includes(kw));
    if (!acceptedMatch) return;

    console.log("[CP Sync] ACCEPTED verdict verified via DOM text:", acceptedMatch, "for problem:", sub.problemCode);
    clearActiveSubmission();

    // Find any new solution link
    const currentLinks = findSolutionLinks();
    const initialSet = new Set(sub.initialSolutionIds || []);
    const newLink = currentLinks.find((l) => !initialSet.has(idFromLink(l)));
    const subId = newLink ? idFromLink(newLink) : null;

    handleAcceptedVerdict(sub, subId);
  }

  // Poll only while activeSubmission exists in session!
  setInterval(checkActiveSubmissionResult, 1000);

  // -------------------------------------------------------------------------
  // Handle Accepted Solution & Show Confirmation
  // -------------------------------------------------------------------------
  async function handleAcceptedVerdict(sub, submissionId = null) {
    let code = sub.code;
    if (!code) {
      const finalRes = await requestCodeFromLiveEditor();
      code = finalRes ? finalRes.code : null;
      if (finalRes && finalRes.language && !sub.language) sub.language = finalRes.language;
    }

    if (!code) {
      console.warn("[CP Sync] Accepted verdict verified, but source code was missing. Checking editors...");
      const textareas = Array.from(document.querySelectorAll("textarea")).map((t) => t.value).filter(Boolean);
      if (textareas.length) code = textareas[0];
    }

    if (!code) {
      console.warn("[CP Sync] Could not extract source code for confirmed solution. Skipping.");
      return;
    }

    const payload = {
      platform: "codechef",
      problemName: sub.problemTitle || sub.problemCode,
      problemId: sub.problemCode,
      language: sub.language || "unknown",
      code: code,
      url: sub.problemUrl || location.href,
      submissionId: submissionId,
      submissionUrl: submissionId ? `https://www.codechef.com/viewsolution/${submissionId}` : null,
      verdict: "Accepted"
    };

    chrome.runtime.sendMessage({ type: "CP_SYNC_REGISTER_PENDING", payload }, (res) => {
      if (chrome.runtime.lastError) {
        console.error("[CP Sync] Error registering pending item:", chrome.runtime.lastError.message);
        return;
      }
      if (res && res.ok && res.pendingItem) {
        if (window === window.top) {
          showConfirmationModal(res.pendingItem);
        } else {
          window.top.postMessage({ source: "cpsync", type: "CPSYNC_SHOW_MODAL", pendingItem: res.pendingItem }, "*");
        }
      } else if (res && res.skipped) {
        console.log("[CP Sync] Pending item skipped:", res.error);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Confirmation Modal Interface (In-Page)
  // -------------------------------------------------------------------------
  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function removeConfirmationModal() {
    const existing = document.getElementById(PROMPT_MODAL_ID);
    if (existing) existing.remove();
  }

  function showConfirmationModal(pendingItem) {
    removeConfirmationModal();

    const overlay = document.createElement("div");
    overlay.id = PROMPT_MODAL_ID;

    overlay.innerHTML = `
      <style>
        #${PROMPT_MODAL_ID} {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          background: rgba(13, 17, 23, 0.82);
          backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #e6edf3;
        }
        #${PROMPT_MODAL_ID} .cpsync-card {
          background: #0d1117;
          border: 1px solid #30363d;
          border-radius: 12px;
          width: 530px;
          max-width: 92vw;
          max-height: 88vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 20px 48px rgba(0, 0, 0, 0.75);
          overflow: hidden;
          animation: cpsyncFadeIn 0.15s ease-out;
        }
        @keyframes cpsyncFadeIn {
          from { opacity: 0; transform: scale(0.97); }
          to { opacity: 1; transform: scale(1); }
        }
        #${PROMPT_MODAL_ID} .cpsync-header {
          padding: 16px 20px;
          border-bottom: 1px solid #21262d;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #161b22;
        }
        #${PROMPT_MODAL_ID} .cpsync-title-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        #${PROMPT_MODAL_ID} .cpsync-badge {
          background: #238636;
          color: white;
          font-size: 11px;
          font-weight: 700;
          padding: 3px 8px;
          border-radius: 12px;
        }
        #${PROMPT_MODAL_ID} .cpsync-header h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
        }
        #${PROMPT_MODAL_ID} .cpsync-close {
          background: none;
          border: none;
          color: #8b949e;
          font-size: 20px;
          cursor: pointer;
          padding: 0 4px;
          line-height: 1;
        }
        #${PROMPT_MODAL_ID} .cpsync-close:hover { color: #f85149; }
        #${PROMPT_MODAL_ID} .cpsync-body {
          padding: 18px 20px;
          overflow-y: auto;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        #${PROMPT_MODAL_ID} .cpsync-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px 12px;
          background: #161b22;
          border: 1px solid #21262d;
          border-radius: 8px;
          padding: 12px 14px;
        }
        #${PROMPT_MODAL_ID} .cpsync-grid-item {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        #${PROMPT_MODAL_ID} .cpsync-grid-item.full {
          grid-column: 1 / -1;
        }
        #${PROMPT_MODAL_ID} .cpsync-label {
          font-size: 10.5px;
          color: #8b949e;
          text-transform: uppercase;
          font-weight: 600;
        }
        #${PROMPT_MODAL_ID} .cpsync-val {
          font-size: 12.5px;
          color: #e6edf3;
          word-break: break-all;
        }
        #${PROMPT_MODAL_ID} .cpsync-val.mono {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          color: #58a6ff;
          font-size: 12px;
        }
        #${PROMPT_MODAL_ID} .cpsync-preview-wrap {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        #${PROMPT_MODAL_ID} .cpsync-preview-header {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: #8b949e;
          font-weight: 600;
        }
        #${PROMPT_MODAL_ID} pre.cpsync-code {
          margin: 0;
          padding: 10px 12px;
          background: #090d13;
          border: 1px solid #30363d;
          border-radius: 6px;
          max-height: 160px;
          overflow-y: auto;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 11.5px;
          color: #c9d1d9;
          white-space: pre;
          line-height: 1.45;
        }
        #${PROMPT_MODAL_ID} .cpsync-status-area {
          font-size: 12px;
          min-height: 16px;
          display: none;
          padding: 8px 12px;
          border-radius: 6px;
        }
        #${PROMPT_MODAL_ID} .cpsync-status-area.error {
          display: block;
          background: rgba(248, 81, 73, 0.15);
          color: #f85149;
          border: 1px solid rgba(248, 81, 73, 0.4);
        }
        #${PROMPT_MODAL_ID} .cpsync-status-area.conflict {
          display: block;
          background: rgba(217, 119, 6, 0.15);
          color: #fbbf24;
          border: 1px solid rgba(217, 119, 6, 0.4);
        }
        #${PROMPT_MODAL_ID} .cpsync-status-area.success {
          display: block;
          background: rgba(35, 134, 54, 0.15);
          color: #3fb950;
          border: 1px solid rgba(35, 134, 54, 0.4);
        }
        #${PROMPT_MODAL_ID} .cpsync-footer {
          padding: 14px 20px;
          border-top: 1px solid #21262d;
          background: #161b22;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }
        #${PROMPT_MODAL_ID} button.cpsync-btn {
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid transparent;
          transition: 0.15s;
        }
        #${PROMPT_MODAL_ID} button.cpsync-btn-cancel {
          background: #21262d;
          color: #c9d1d9;
          border-color: #30363d;
        }
        #${PROMPT_MODAL_ID} button.cpsync-btn-cancel:hover {
          background: #30363d;
        }
        #${PROMPT_MODAL_ID} button.cpsync-btn-push {
          background: #238636;
          color: white;
          border-color: rgba(240, 246, 252, 0.1);
        }
        #${PROMPT_MODAL_ID} button.cpsync-btn-push:hover {
          background: #2ea043;
        }
        #${PROMPT_MODAL_ID} button.cpsync-btn-push.conflict {
          background: #d97706;
        }
        #${PROMPT_MODAL_ID} button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      </style>

      <div class="cpsync-card">
        <div class="cpsync-header">
          <div class="cpsync-title-wrap">
            <span class="cpsync-badge">ACCEPTED</span>
            <h3>Push to GitHub?</h3>
          </div>
          <button class="cpsync-close" id="cpsync-close-btn" title="Cancel & Close">×</button>
        </div>

        <div class="cpsync-body">
          <div class="cpsync-grid">
            <div class="cpsync-grid-item">
              <span class="cpsync-label">Problem</span>
              <span class="cpsync-val">${escapeHtml(pendingItem.problemName)} (${escapeHtml(pendingItem.problemId)})</span>
            </div>
            <div class="cpsync-grid-item">
              <span class="cpsync-label">Language</span>
              <span class="cpsync-val">${escapeHtml(pendingItem.language)}</span>
            </div>
            <div class="cpsync-grid-item">
              <span class="cpsync-label">Target Repository</span>
              <span class="cpsync-val">${escapeHtml(pendingItem.targetOwner)}/${escapeHtml(pendingItem.targetRepo)}</span>
            </div>
            <div class="cpsync-grid-item">
              <span class="cpsync-label">Branch</span>
              <span class="cpsync-val">${escapeHtml(pendingItem.targetBranch)}</span>
            </div>
            <div class="cpsync-grid-item full">
              <span class="cpsync-label">Proposed File Path</span>
              <span class="cpsync-val mono">${escapeHtml(pendingItem.proposedPath)}</span>
            </div>
            ${pendingItem.submissionId ? `
            <div class="cpsync-grid-item full">
              <span class="cpsync-label">Submission ID</span>
              <span class="cpsync-val mono">${escapeHtml(pendingItem.submissionId)}</span>
            </div>` : ''}
          </div>

          <div class="cpsync-preview-wrap">
            <div class="cpsync-preview-header">
              <span>CAPTURED SOURCE CODE</span>
              <span>${(pendingItem.code || "").length} characters</span>
            </div>
            <pre class="cpsync-code"><code>${escapeHtml(pendingItem.code || "")}</code></pre>
          </div>

          <div id="cpsync-status-area" class="cpsync-status-area"></div>
        </div>

        <div class="cpsync-footer">
          <button id="cpsync-cancel-btn" class="cpsync-btn cpsync-btn-cancel">Cancel</button>
          <button id="cpsync-confirm-btn" class="cpsync-btn cpsync-btn-push">Push to GitHub</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const closeBtn = document.getElementById("cpsync-close-btn");
    const cancelBtn = document.getElementById("cpsync-cancel-btn");
    const confirmBtn = document.getElementById("cpsync-confirm-btn");
    const statusArea = document.getElementById("cpsync-status-area");

    let isConflictState = false;

    function handleCancel() {
      chrome.runtime.sendMessage({ type: "CP_SYNC_CANCEL_PENDING", pendingId: pendingItem.id });
      removeConfirmationModal();
    }

    closeBtn.addEventListener("click", handleCancel);
    cancelBtn.addEventListener("click", handleCancel);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) handleCancel();
    });

    function keyHandler(e) {
      if (e.key === "Escape") {
        window.removeEventListener("keydown", keyHandler);
        handleCancel();
      }
    }
    window.addEventListener("keydown", keyHandler);

    confirmBtn.addEventListener("click", () => {
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      statusArea.className = "cpsync-status-area";
      statusArea.textContent = isConflictState ? "Overwriting on GitHub..." : "Pushing commit to GitHub...";
      statusArea.style.display = "block";

      chrome.runtime.sendMessage(
        { type: "CP_SYNC_CONFIRM_PUSH", pendingId: pendingItem.id, overwrite: isConflictState },
        (res) => {
          if (chrome.runtime.lastError) {
            statusArea.className = "cpsync-status-area error";
            statusArea.textContent = "Error: " + chrome.runtime.lastError.message;
            confirmBtn.disabled = false;
            cancelBtn.disabled = false;
            return;
          }

          if (res && res.conflict) {
            isConflictState = true;
            statusArea.className = "cpsync-status-area conflict";
            statusArea.textContent = "⚠️ " + res.message;
            confirmBtn.disabled = false;
            cancelBtn.disabled = false;
            confirmBtn.textContent = "Confirm Overwrite";
            confirmBtn.classList.add("conflict");
            return;
          }

          if (res && res.ok) {
            statusArea.className = "cpsync-status-area success";
            statusArea.textContent = `✓ Successfully pushed to ${res.path}!`;
            setTimeout(() => {
              removeConfirmationModal();
            }, 2000);
          } else {
            statusArea.className = "cpsync-status-area error";
            statusArea.textContent = `✗ Push failed: ${res ? res.error : "Unknown error"}`;
            confirmBtn.disabled = false;
            cancelBtn.disabled = false;
          }
        }
      );
    });
  }
})();
