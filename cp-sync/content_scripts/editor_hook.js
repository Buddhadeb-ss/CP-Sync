// content_scripts/editor_hook.js

(function () {
  if (window.__cpSyncEditorHookInstalled) return;
  window.__cpSyncEditorHookInstalled = true;

  function isExcluded(el) {
    if (!el || typeof el.closest !== "function") return false;
    return !!el.closest(
      '[class*="tutor" i], [id*="tutor" i], [class*="assistant" i], [id*="assistant" i], ' +
      '[class*="chat" i], [id*="chat" i], [class*="copilot" i], [id*="copilot" i], ' +
      '[class*="reference" i], [id*="reference" i], [class*="cheatsheet" i], [id*="cheatsheet" i], ' +
      '[class*="cheat-sheet" i], [id*="cheat-sheet" i], [class*="keyword" i], [id*="keyword" i], ' +
      '[class*="snippet-list" i], [id*="snippet-list" i], [class*="helper" i], [id*="helper" i], ' +
      '[class*="hint" i], [id*="hint" i], [class*="suggest-widget" i], [class*="hover-widget" i]'
    );
  }

  function looksLikeRealEditor(el) {
    if (!el || typeof el.closest !== "function") return false;
    return !!el.closest(
      '[class*="solution" i], [id*="solution" i], [class*="code-editor" i], [id*="code-editor" i], ' +
      '[class*="ide" i], [id*="ide" i], [data-testid*="editor" i]'
    );
  }


  function looksLikeGarbage(text) {
    if (!text) return true;
    if (/(.)\1{14,}/.test(text)) return true;
    return false;
  }

  function pickBest(candidates) {
    // candidates: [{ el, value, language }]
    const valid = candidates.filter((c) => c.value && !looksLikeGarbage(c.value));
    if (!valid.length) return null;

    const realEditorCandidates = valid.filter((c) => looksLikeRealEditor(c.el));
    const pool = realEditorCandidates.length ? realEditorCandidates : valid;

    let best = pool[0];
    for (const c of pool) {
      if (c.value.length > best.value.length) best = c;
    }
    return { code: best.value, language: best.language || null };
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
            return { el: ed.getDomNode(), value: ed.getValue() || "", language: lang };
          });
        const result = pickBest(candidates);
        if (result) return result;
      }

      // Fallback: bare models, no DOM filtering possible - only used if
      // getEditors() wasn't available or returned nothing usable.
      const models = window.monaco.editor.getModels();
      if (models && models.length) {
        const candidates = models.map((m) => {
          let lang = null;
          try {
            if (typeof m.getLanguageId === "function") lang = m.getLanguageId();
          } catch (e) {}
          return { el: null, value: m.getValue() || "", language: lang };
        });
        const result = pickBest(candidates);
        if (result) return result;
      }
    } catch (e) {}
    return null;
  }

  function readCodeMirror() {
    try {
      const nodes = Array.from(document.querySelectorAll(".CodeMirror")).filter((node) => !isExcluded(node));
      const candidates = nodes
        .map((node) => {
          const cm = node.CodeMirror;
          return cm && typeof cm.getValue === "function" ? { el: node, value: cm.getValue() || "" } : null;
        })
        .filter(Boolean);
      return pickBest(candidates);
    } catch (e) {
      return null;
    }
  }

  function readAce() {
    try {
      const nodes = Array.from(document.querySelectorAll(".ace_editor")).filter((node) => !isExcluded(node));
      const candidates = [];
      for (const node of nodes) {
        let value = null;
        try {
          if (node.env && node.env.editor && typeof node.env.editor.getValue === "function") {
            value = node.env.editor.getValue();
          } else if (window.ace && typeof window.ace.edit === "function") {
            value = window.ace.edit(node).getValue();
          }
        } catch (e) {}
        if (value) candidates.push({ el: node, value });
      }
      return pickBest(candidates);
    } catch (e) {
      return null;
    }
  }

  function readTextarea() {
    try {
      const areas = Array.from(document.querySelectorAll("textarea")).filter(
        (area) => !isExcluded(area) && !area.closest(".monaco-editor") && !area.closest(".CodeMirror") && !area.closest(".ace_editor")
      );
      const candidates = areas.map((area) => ({ el: area, value: area.value || "" }));
      return pickBest(candidates);
    } catch (e) {
      return null;
    }
  }

  function readCurrentCode() {
    return readMonaco() || readCodeMirror() || readAce() || readTextarea() || null;
  }

  function diagnosticSnapshot() {
    const snap = {
      hasMonacoGlobal: !!(window.monaco && window.monaco.editor),
      monacoEditorsCount: 0,
      monacoModelsCount: 0,
      codeMirrorNodeCount: document.querySelectorAll(".CodeMirror").length,
      aceNodeCount: document.querySelectorAll(".ace_editor").length,
      textareaCount: document.querySelectorAll("textarea").length
    };
    try {
      if (window.monaco && window.monaco.editor) {
        if (typeof window.monaco.editor.getEditors === "function") {
          snap.monacoEditorsCount = window.monaco.editor.getEditors().length;
        }
        if (typeof window.monaco.editor.getModels === "function") {
          snap.monacoModelsCount = window.monaco.editor.getModels().length;
        }
      }
    } catch (e) {}
    return snap;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== "cpsync" || msg.type !== "CPSYNC_REQUEST_CODE") return;

    const snap = diagnosticSnapshot();
    const res = readCurrentCode();
    const code = res ? (typeof res === "string" ? res : res.code) : null;
    const language = res && typeof res === "object" ? res.language : null;
    console.log(
      "[CP Sync] v2.1.0 editor_hook diagnostic on", location.href, "-",
      "Monaco global:", snap.hasMonacoGlobal, "editors:", snap.monacoEditorsCount, "models:", snap.monacoModelsCount,
      "- CodeMirror nodes:", snap.codeMirrorNodeCount, "- Ace nodes:", snap.aceNodeCount, "- textareas:", snap.textareaCount,
      "- captured code length:", code ? code.length : 0,
      "- language:", language,
      "- preview:", code ? JSON.stringify(code.slice(0, 80)) : null
    );

    window.postMessage({ source: "cpsync", type: "CPSYNC_CODE_RESPONSE", requestId: msg.requestId, code, language }, "*");
  });

  // -------------------------------------------------------------------------
  // Network Hook: Intercept CodeChef submit & verdict API calls
  // -------------------------------------------------------------------------
  function setupNetworkHook() {
    try {
      // 1. Hook window.fetch
      const originalFetch = window.fetch;
      if (typeof originalFetch === "function") {
        window.fetch = async function (...args) {
          const url = (typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "").toLowerCase();
          const options = args[1] || {};

          // Detect submission attempt in fetch
          if (
            url.includes("submit") ||
            url.includes("/ide/run") ||
            (options.body && typeof options.body === "string" && (options.body.includes("sourceCode") || options.body.includes("source_code")))
          ) {
            try {
              let submittedCode = null;
              let submittedLang = null;
              let probCode = null;
              if (options.body && typeof options.body === "string") {
                try {
                  const parsed = JSON.parse(options.body);
                  submittedCode = parsed.sourceCode || parsed.source_code || parsed.code || parsed.solution || null;
                  submittedLang = parsed.language || parsed.lang || null;
                  probCode = parsed.problemCode || parsed.problem_code || null;
                } catch (e) {}
              }
              const liveRes = readCurrentCode();
              const finalCode = submittedCode || (liveRes && liveRes.code);
              const finalLang = submittedLang || (liveRes && liveRes.language);
              console.log("[CP Sync] Network submission initiated on:", url, "- code length:", (finalCode || "").length);
              window.postMessage({
                source: "cpsync",
                type: "CPSYNC_NETWORK_SUBMISSION",
                code: finalCode,
                language: finalLang,
                problemCode: probCode,
                url: location.href
              }, "*");
            } catch (e) {}
          }

          const response = await originalFetch.apply(this, args);

          // Detect verdict response in fetch
          if (url.includes("status") || url.includes("submission") || url.includes("submit") || url.includes("result")) {
            try {
              const clone = response.clone();
              clone.json().then((data) => {
                if (!data) return;
                const resultCode = (data.result_code || data.resultCode || data.verdict || data.status || "").toLowerCase();
                const score = data.score !== undefined ? data.score : (data.task_score !== undefined ? data.task_score : null);
                const subId = data.submission_id || data.submissionId || data.id || null;

                if (resultCode === "accepted" || resultCode === "ac" || score === 100 || score === "100") {
                  console.log("[CP Sync] Network verdict ACCEPTED detected:", data);
                  window.postMessage({
                    source: "cpsync",
                    type: "CPSYNC_NETWORK_VERDICT",
                    verdict: "Accepted",
                    submissionId: subId,
                    score: 100
                  }, "*");
                } else if (
                  resultCode.includes("wrong") ||
                  resultCode === "wa" ||
                  resultCode.includes("tle") ||
                  resultCode.includes("error") ||
                  score === 0 ||
                  score === "0"
                ) {
                  console.log("[CP Sync] Network verdict REJECTED detected:", data);
                  window.postMessage({
                    source: "cpsync",
                    type: "CPSYNC_NETWORK_VERDICT",
                    verdict: "Rejected",
                    submissionId: subId
                  }, "*");
                }
              }).catch(() => {});
            } catch (e) {}
          }

          return response;
        };
      }

      // 2. Hook XMLHttpRequest
      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSend = XMLHttpRequest.prototype.send;

      XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__cpsync_url = (url || "").toString().toLowerCase();
        this.__cpsync_method = (method || "").toString().toUpperCase();
        return originalOpen.apply(this, [method, url, ...rest]);
      };

      XMLHttpRequest.prototype.send = function (body) {
        const url = this.__cpsync_url || "";
        if (url.includes("submit") || (body && typeof body === "string" && (body.includes("sourceCode") || body.includes("source_code")))) {
          try {
            const liveRes = readCurrentCode();
            window.postMessage({
              source: "cpsync",
              type: "CPSYNC_NETWORK_SUBMISSION",
              code: liveRes ? liveRes.code : null,
              language: liveRes ? liveRes.language : null,
              url: location.href
            }, "*");
          } catch (e) {}
        }

        this.addEventListener("load", function () {
          if (url.includes("status") || url.includes("submission") || url.includes("submit") || url.includes("result")) {
            try {
              const data = JSON.parse(this.responseText);
              if (!data) return;
              const resultCode = (data.result_code || data.resultCode || data.verdict || data.status || "").toLowerCase();
              const score = data.score !== undefined ? data.score : (data.task_score !== undefined ? data.task_score : null);
              const subId = data.submission_id || data.submissionId || data.id || null;

              if (resultCode === "accepted" || resultCode === "ac" || score === 100 || score === "100") {
                window.postMessage({
                  source: "cpsync",
                  type: "CPSYNC_NETWORK_VERDICT",
                  verdict: "Accepted",
                  submissionId: subId
                }, "*");
              } else if (resultCode.includes("wrong") || resultCode === "wa" || resultCode.includes("tle") || resultCode.includes("error") || score === 0) {
                window.postMessage({
                  source: "cpsync",
                  type: "CPSYNC_NETWORK_VERDICT",
                  verdict: "Rejected",
                  submissionId: subId
                }, "*");
              }
            } catch (e) {}
          }
        });

        return originalSend.apply(this, [body]);
      };
    } catch (e) {
      console.warn("[CP Sync] Network hook installation failed:", e);
    }
  }

  setupNetworkHook();
})();
