// static/llm_assistant_module.js

window.LlmAssistantModule = (function () {
  // --- Private Variables ---
  let llmConversationHistory = [];
  let dependencies = {
    getAppVariables: () => {
      return {
        selectedElements: null,
        currentHierarchyData: null,
        currentDeviceSerial: null,
        devices: [],
        actualDeviceWidth: null,
        actualDeviceHeight: null,
        generatedXpathValue: "",
      };
    },
    PythonConsoleManager: null,
    updateMessage: (text, type, duration) => {},
    callBackend: async (method, endpoint, body) => {
      console.warn(
        "LLM_MOD_WARN: LLM_callBackend dependency used (should be rare).",
      );
      throw new Error(
        "callBackend fallback not fully implemented here if needed by LLM module directly.",
      );
    },
    escapeHtml: (s) =>
      String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;"),
    openGlobalTab: (evt, tabName) => {},
  };

  // DOM Elements
  let llmChatHistoryEl,
    llmPromptInputEl,
    llmSendPromptBtn,
    llmClearConversationBtn,
    llmProviderSelect,
    llmContextUiHierarchyCheckbox,
    llmContextSelectedElementCheckbox,
    llmContextPythonConsoleOutputCheckbox,
    llmContextPythonConsoleOutputLinesSelect,
    llmContextPythonCodeCheckbox,
    llmContextDeviceInfoCheckbox;

  let llmIncludeLastErrorBtn;
  let capturedLastErrorForNextPrompt = null;

  let ragApiStatusIndicatorEl;
  let ragApiStatusTextEl;
  let RAG_API_HEALTH_URL = null;
  let ragApiPollIntervalId = null;

  let currentSelectedNodesForLlm = null;

  function _fetchLlmDomElements() {
    llmChatHistoryEl = document.getElementById("llm-chat-history");
    llmPromptInputEl = document.getElementById("llm-prompt-input");
    llmSendPromptBtn = document.getElementById("llm-send-prompt-btn");
    llmProviderSelect = document.getElementById("llm-provider-select");

    llmClearConversationBtn = document.getElementById(
      "llm-clear-conversation-btn",
    );

    llmContextUiHierarchyCheckbox = document.getElementById(
      "llm-context-ui-hierarchy",
    );
    llmContextSelectedElementCheckbox = document.getElementById(
      "llm-context-selected-element",
    );
    llmContextPythonConsoleOutputCheckbox = document.getElementById(
      "llm-context-python-console-output",
    );
    llmContextPythonConsoleOutputLinesSelect = document.getElementById(
      "llm-context-python-console-output-lines",
    );
    llmContextPythonCodeCheckbox = document.getElementById(
      "llm-context-python-code",
    );
    llmContextDeviceInfoCheckbox = document.getElementById(
      "llm-context-device-info",
    );
    llmIncludeLastErrorBtn = document.getElementById(
      "llm-include-last-error-btn",
    );

    ragApiStatusIndicatorEl = document.getElementById(
      "rag-api-status-indicator",
    );
    ragApiStatusTextEl = document.getElementById("rag-api-status-text");

    let allCriticalFound =
      llmChatHistoryEl &&
      llmPromptInputEl &&
      llmSendPromptBtn &&
      llmClearConversationBtn;
    if (!allCriticalFound && dependencies.updateMessage) {
      dependencies.updateMessage(
        "LLM Chat UI failed to load critical elements.",
        "error",
        0,
      );
    }
    if (!llmIncludeLastErrorBtn)
      console.warn(
        "LLM_MOD_WARN: 'llm-include-last-error-btn' element NOT FOUND!",
      );
    if (!ragApiStatusIndicatorEl || !ragApiStatusTextEl)
      console.warn(
        "LLM_MOD_WARN: RAG API status elements in header NOT FOUND!",
      );

    return allCriticalFound;
  }

  async function _fetchServiceConfigsAndInitRagPolling() {
    try {
      const response = await fetch("/api/config/services");
      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          "LLM_MOD_ERR: Failed to fetch service configurations:",
          response.status,
          errorText,
        );
        _setRagApiStatus("error", "Config Error");
        return;
      }
      const config = await response.json();
      if (config.ragApiBaseUrl) {
        RAG_API_HEALTH_URL =
          config.ragApiBaseUrl.replace(/\/$/, "") + "/health";
        _pollRagApiStatus();
      } else {
        console.warn(
          "LLM_MOD_WARN: RAG API Base URL not provided in service configurations.",
        );
        _setRagApiStatus("error", "Config Missing");
      }
    } catch (error) {
      console.error(
        "LLM_MOD_ERR: Error fetching service configurations:",
        error,
      );
      _setRagApiStatus("error", "Config Fetch Failed");
    }
  }

  function _setRagApiStatus(statusType, detailMessage = "") {
    if (!ragApiStatusIndicatorEl || !ragApiStatusTextEl) return;
    ragApiStatusIndicatorEl.classList.remove(
      "status-ok",
      "status-error",
      "status-degraded",
    );
    let statusTextContent = "RAG Status";
    let tooltipText = "RAG API Status: ";

    if (statusType === "ok") {
      ragApiStatusIndicatorEl.classList.add("status-ok");
      statusTextContent = "RAG Online";
      tooltipText += "Operational";
    } else if (statusType === "degraded") {
      ragApiStatusIndicatorEl.classList.add("status-degraded");
      statusTextContent = "RAG Degraded";
      tooltipText += `Degraded (${detailMessage || "Partial service"})`;
    } else if (statusType === "error") {
      ragApiStatusIndicatorEl.classList.add("status-error");
      statusTextContent = "RAG Error";
      tooltipText += `Error (${detailMessage || "Service issue"})`;
    } else {
      statusTextContent = "RAG Unknown";
      tooltipText += `Unknown (${detailMessage || "Checking..."})`;
    }
    ragApiStatusTextEl.textContent = statusTextContent;
    if (
      ragApiStatusIndicatorEl.parentElement &&
      ragApiStatusIndicatorEl.parentElement.classList.contains(
        "rag-api-status-container",
      )
    ) {
      ragApiStatusIndicatorEl.parentElement.title = tooltipText;
    }
  }

  async function _checkRagApiStatus() {
    if (!RAG_API_HEALTH_URL || !ragApiStatusIndicatorEl || !ragApiStatusTextEl)
      return;
    try {
      const response = await fetch(RAG_API_HEALTH_URL, {
        method: "GET",
        cache: "no-store",
      });
      if (response.ok) {
        const data = await response.json();
        _setRagApiStatus(
          data.status === "ok" ? "ok" : "degraded",
          data.status || "Unknown",
        );
      } else {
        _setRagApiStatus("error", `HTTP ${response.status}`);
      }
    } catch (error) {
      console.warn(
        "LLM_MOD_WARN: Error polling RAG API status:",
        error.message,
      );
      _setRagApiStatus("error", "Unreachable");
    }
  }

  function _pollRagApiStatus() {
    if (ragApiPollIntervalId) clearInterval(ragApiPollIntervalId);
    _checkRagApiStatus();
    ragApiPollIntervalId = setInterval(_checkRagApiStatus, 15000);
  }

  function _handleIncludeLastErrorClick() {
    if (
      !dependencies.PythonConsoleManager ||
      typeof dependencies.PythonConsoleManager.getLastTraceback !== "function"
    ) {
      console.error(
        "LLM_MOD_ERR: PythonConsoleManager.getLastTraceback() is not available.",
      );
      dependencies.updateMessage(
        "Error: Cannot retrieve last error (ConsoleManager misconfigured).",
        "error",
        3000,
      );
      return;
    }
    const lastTraceback = dependencies.PythonConsoleManager.getLastTraceback();
    if (capturedLastErrorForNextPrompt) {
      capturedLastErrorForNextPrompt = null;
      dependencies.updateMessage(
        "Captured Python error cleared from next prompt.",
        "info",
        3000,
      );
      if (llmIncludeLastErrorBtn) {
        llmIncludeLastErrorBtn.classList.remove("active");
        llmIncludeLastErrorBtn.textContent = "❗ Include Error";
      }
    } else if (lastTraceback && lastTraceback.trim() !== "") {
      capturedLastErrorForNextPrompt = lastTraceback;
      dependencies.updateMessage(
        "Last Python error captured. It will be sent with your next message.",
        "success",
        3000,
      );
      if (llmIncludeLastErrorBtn) {
        llmIncludeLastErrorBtn.classList.add("active");
        llmIncludeLastErrorBtn.textContent = "✔️ Error Captured";
      }
    } else {
      dependencies.updateMessage(
        "No last Python error found in the console to include.",
        "warning",
        3000,
      );
      if (llmIncludeLastErrorBtn) {
        llmIncludeLastErrorBtn.classList.remove("active");
        llmIncludeLastErrorBtn.textContent = "❗ Include Error";
      }
    }
  }

  function _formatResponseForDisplay(rawText) {
    let escapedText = dependencies.escapeHtml(rawText);
    let html = escapedText.replace(
      /```(\w*)\n?([\s\S]*?)\n?```/g,
      (match, lang, code) => {
        const languageClass = lang ? `language-${lang}` : "language-plaintext";
        return `<pre><code class="${languageClass}">${code}</code></pre>`;
      },
    );
    const parts = html.split(/(<pre(?:.|\n)*?<\/pre>)/);
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) parts[i] = parts[i].replace(/\n/g, "<br>");
    }
    return parts.join("");
  }

  function _addMessageToChatHistory(
    initialContent = "",
    type = "assistant",
    isHtml = false,
    isStreaming = false,
  ) {
    if (!llmChatHistoryEl) return null;
    const messageDiv = document.createElement("div");
    messageDiv.classList.add("llm-message", `llm-message-${type}`);
    messageDiv.dataset.rawContent = isStreaming
      ? initialContent
      : isHtml
        ? "HTML_CONTENT_NO_RAW"
        : initialContent;
    messageDiv.innerHTML = isHtml
      ? initialContent
      : _formatResponseForDisplay(initialContent);
    llmChatHistoryEl.appendChild(messageDiv);
    llmChatHistoryEl.scrollTop = llmChatHistoryEl.scrollHeight;
    if (type === "assistant") _addCodeActionButtonsToMessage(messageDiv);
    return messageDiv;
  }

  function _addCodeActionButtonsToMessage(messageDiv) {
    if (
      !messageDiv ||
      !dependencies.PythonConsoleManager ||
      typeof dependencies.PythonConsoleManager.setCode !== "function"
    )
      return;
    messageDiv
      .querySelectorAll(".llm-code-action-buttons")
      .forEach((btnContainer) => btnContainer.remove());
    const preElements = messageDiv.querySelectorAll("pre");
    preElements.forEach((preElement) => {
      const codeElement = preElement.querySelector("code");
      // Ensure codeText is just the code, trimmed of extra whitespace from HTML parsing
      const codeText = codeElement
        ? codeElement.textContent.trim()
        : preElement.textContent.trim();

      const buttonsContainer = document.createElement("div");
      buttonsContainer.className = "llm-code-action-buttons";
      const copyButton = document.createElement("button");
      copyButton.textContent = "Copy";
      copyButton.className = "llm-code-copy-btn";
      copyButton.title = "Copy code to clipboard";
      copyButton.addEventListener("click", (e) => {
        e.stopPropagation();
        navigator.clipboard
          .writeText(codeText)
          .then(() => {
            dependencies.updateMessage("Code copied!", "success", 1500);
            copyButton.textContent = "Copied!";
            setTimeout(() => {
              copyButton.textContent = "Copy";
            }, 1500);
          })
          .catch((err) => {
            console.error("LLM_MOD_ERR: Failed to copy code:", err);
            dependencies.updateMessage("Failed to copy.", "error");
          });
      });
      const insertButton = document.createElement("button");
      insertButton.textContent = "To Console";
      insertButton.className = "llm-code-insert-btn";
      insertButton.title = "Insert code into Python Console (applies diff)";
      insertButton.addEventListener("click", (e) => {
        e.stopPropagation();
        applyDiffOrSetCode(codeText);
        dependencies.updateMessage(
          "Code processed for Python console.",
          "success",
          2000,
        );
        if (dependencies.openGlobalTab)
          dependencies.openGlobalTab(null, "python-tab-content");
      });
      buttonsContainer.appendChild(copyButton);
      buttonsContainer.appendChild(insertButton);
      preElement.style.position = "relative";
      preElement.appendChild(buttonsContainer);
    });
  }

  function applyDiffOrSetCode(newLlmScript) {
    console.log("LLM_MOD_LOG: applyDiffOrSetCode called.");
    if (
      !dependencies.PythonConsoleManager ||
      typeof dependencies.PythonConsoleManager.getCode !== "function" ||
      typeof dependencies.PythonConsoleManager.setCode !== "function"
    ) {
      console.error(
        "LLM_MOD_ERR: PythonConsoleManager getCode/setCode not available for diffing.",
      );
      if (
        dependencies.PythonConsoleManager &&
        typeof dependencies.PythonConsoleManager.setCode === "function"
      ) {
        dependencies.PythonConsoleManager.setCode(newLlmScript);
      }
      return;
    }

    const currentEditorCode = dependencies.PythonConsoleManager.getCode();
    console.log(
      "LLM_MOD_LOG: Current editor code (for diff):\n",
      currentEditorCode,
    );
    console.log("LLM_MOD_LOG: New LLM script (for diff):\n", newLlmScript);

    if (typeof diff_match_patch === "undefined") {
      console.warn(
        "LLM_MOD_WARN: diff_match_patch library not found. Falling back to full overwrite.",
      );
      dependencies.PythonConsoleManager.setCode(newLlmScript);
      return;
    }

    try {
      const dmp = new diff_match_patch();
      // Ensure both texts are strings and handle potential undefined/null
      const text1 = currentEditorCode || "";
      const text2 = newLlmScript || "";

      const diffs = dmp.diff_main(text1, text2);
      console.log(
        "LLM_MOD_LOG: Diffs computed:",
        JSON.stringify(diffs.slice(0, 5)) + (diffs.length > 5 ? "..." : ""),
      ); // Log first few diffs

      dmp.diff_cleanupSemantic(diffs);
      console.log(
        "LLM_MOD_LOG: Diffs after cleanupSemantic:",
        JSON.stringify(diffs.slice(0, 5)) + (diffs.length > 5 ? "..." : ""),
      );

      const patches = dmp.patch_make(text1, diffs); // Or dmp.patch_make(diffs) if text1 is implicit in diffs
      console.log(
        "LLM_MOD_LOG: Patches created:",
        patches
          .map((p) => p.toString())
          .join("\n")
          .substring(0, 200) + "...",
      );

      const [patchedText, results] = dmp.patch_apply(patches, text1);
      console.log("LLM_MOD_LOG: Patch apply results:", results);
      console.log("LLM_MOD_LOG: Patched text proposal:\n", patchedText);

      let allAppliedCleanly = true;
      for (let i = 0; i < results.length; i++) {
        if (!results[i]) {
          allAppliedCleanly = false;
          break;
        }
      }

      if (allAppliedCleanly) {
        dependencies.PythonConsoleManager.setCode(patchedText);
        console.log("LLM_MOD_LOG: Code updated via diff patch.");
        dependencies.updateMessage("Code updated with changes.", "info", 2000);
      } else {
        console.warn(
          "LLM_MOD_WARN: Diff patch did not apply cleanly. Results:",
          results,
          "Falling back to full overwrite.",
        );
        dependencies.PythonConsoleManager.setCode(newLlmScript);
        dependencies.updateMessage(
          "Code updated (full overwrite due to complex changes).",
          "warning",
          3000,
        );
      }
    } catch (e) {
      console.error("LLM_MOD_ERR: Error during diff_match_patch process:", e);
      dependencies.PythonConsoleManager.setCode(newLlmScript);
      dependencies.updateMessage(
        "Error applying code changes, did full overwrite.",
        "error",
        3000,
      );
    }
  }

  function _updateStreamedMessage(messageDiv, newChunk, isComplete = false) {
    if (!messageDiv) return;
    messageDiv.dataset.rawContent += newChunk;
    messageDiv.innerHTML = _formatResponseForDisplay(
      messageDiv.dataset.rawContent,
    );
    if (llmChatHistoryEl)
      llmChatHistoryEl.scrollTop = llmChatHistoryEl.scrollHeight;
    if (isComplete) _addCodeActionButtonsToMessage(messageDiv);
  }

  function _clearLlmChat() {
    if (llmChatHistoryEl) llmChatHistoryEl.innerHTML = "";
    llmConversationHistory = [];
    _addMessageToChatHistory(
      "Chat cleared. How can I help you next?",
      "assistant",
    );
    if (dependencies.updateMessage)
      dependencies.updateMessage("Chat conversation cleared.", "info");
    capturedLastErrorForNextPrompt = null;
    if (llmIncludeLastErrorBtn) {
      llmIncludeLastErrorBtn.classList.remove("active");
      llmIncludeLastErrorBtn.textContent = "❗ Include Error";
    }
  }
  async function _handleSendLlmPrompt() {
    if (!llmPromptInputEl || !llmSendPromptBtn) return;

    const promptText = llmPromptInputEl.value.trim();
    if (!promptText) {
      if (dependencies.updateMessage)
        dependencies.updateMessage(
          "Please enter a message for the assistant.",
          "warning",
          2000,
        );
      return;
    }

    // Add user message to history and clear input field
    _addMessageToChatHistory(promptText, "user");
    llmConversationHistory.push({ role: "user", content: promptText });
    llmPromptInputEl.value = "";
    llmPromptInputEl.style.height = "auto";
    llmPromptInputEl.disabled = true;
    llmSendPromptBtn.disabled = true;

    const context = _getSelectedLlmContext();

    // 🧠 Get selected provider from dropdown
    const selectedProvider = llmProviderSelect?.value || "deepseek";
    console.log("🔥 Selected LLM provider from dropdown:", selectedProvider);

    // Compose payload with provider
    const payload = {
      prompt: promptText,
      context: context,
      history: llmConversationHistory.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      provider: selectedProvider,
    };

    // Clear captured error if being sent
    if (capturedLastErrorForNextPrompt && context.pythonLastErrorTraceback) {
      capturedLastErrorForNextPrompt = null;
      if (llmIncludeLastErrorBtn) {
        llmIncludeLastErrorBtn.classList.remove("active");
        llmIncludeLastErrorBtn.textContent = "❗ Include Error";
      }
    }

    const assistantMessageDiv = _addMessageToChatHistory(
      "<i>Assistant is thinking...</i>",
      "assistant",
      true,
      true,
    );
    let accumulatedResponse = "";

    try {
      const response = await fetch("/api/llm/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let errorDetail = `HTTP error ${response.status}: ${response.statusText}`;
        try {
          const errorJson = await response.json();
          errorDetail = errorJson.detail || errorJson.error || errorDetail;
        } catch (_) {}
        console.error(
          "LLM_MOD_ERR: _handleSendLlmPrompt - Fetch not OK:",
          errorDetail,
        );
        throw new Error(errorDetail);
      }

      if (!response.body)
        throw new Error("Response body is null, cannot read stream.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamShouldEnd = false;

      if (assistantMessageDiv) {
        assistantMessageDiv.dataset.rawContent = "";
        assistantMessageDiv.innerHTML = "";
      }

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          _updateStreamedMessage(assistantMessageDiv, "", true);
          streamShouldEnd = true;
        } else {
          buffer += decoder.decode(value, { stream: true });
        }

        let eolIndex;
        while ((eolIndex = buffer.indexOf("\n\n")) >= 0) {
          const sseMessage = buffer.slice(0, eolIndex);
          buffer = buffer.slice(eolIndex + 2);

          let currentEventType = "message";
          let dataContent = "";

          sseMessage.split("\n").forEach((line) => {
            if (line.startsWith("event:"))
              currentEventType = line.substring("event:".length).trim();
            else if (line.startsWith("data:"))
              dataContent = line.substring("data:".length).trim();
          });

          if (dataContent) {
            try {
              const parsedData = JSON.parse(dataContent);
              if (currentEventType === "error") {
                const errorChunk = `\n[Stream Error: ${dependencies.escapeHtml(parsedData.error)}]`;
                accumulatedResponse += errorChunk;
                _updateStreamedMessage(assistantMessageDiv, errorChunk);
                if (dependencies.updateMessage)
                  dependencies.updateMessage(
                    `LLM Error: ${parsedData.error}`,
                    "error",
                  );
                streamShouldEnd = true;
                break;
              } else if (
                currentEventType === "message" ||
                currentEventType === "data"
              ) {
                const textChunk =
                  typeof parsedData === "string"
                    ? parsedData
                    : parsedData.content || "";
                accumulatedResponse += textChunk;
                _updateStreamedMessage(assistantMessageDiv, textChunk);
              } else if (currentEventType === "end-of-stream") {
                _updateStreamedMessage(assistantMessageDiv, "", true);
                streamShouldEnd = true;
                break;
              }
            } catch (e) {
              console.error(
                "LLM_MOD_ERR: Error parsing JSON from stream data:",
                dataContent,
                e,
              );
              if (
                currentEventType === "message" ||
                currentEventType === "data"
              ) {
                accumulatedResponse += dataContent;
                _updateStreamedMessage(assistantMessageDiv, dataContent);
              }
            }
          }
          if (streamShouldEnd) break;
        }
        if (streamShouldEnd) break;
      }

      // Final message handling
      const lastMessage = llmConversationHistory.at(-1);
      if (!lastMessage || lastMessage.role !== "assistant") {
        llmConversationHistory.push({
          role: "assistant",
          content: accumulatedResponse,
        });
      } else {
        lastMessage.content = accumulatedResponse;
      }
    } catch (error) {
      console.error("LLM_MOD_ERR: Fetch/Stream error:", error);
      const errorMsg = `Sorry, I encountered an error: ${dependencies.escapeHtml(error.message)}`;
      if (assistantMessageDiv) {
        assistantMessageDiv.dataset.rawContent = errorMsg;
        assistantMessageDiv.innerHTML = _formatResponseForDisplay(errorMsg);
        _addCodeActionButtonsToMessage(assistantMessageDiv);
      } else {
        _addMessageToChatHistory(errorMsg, "assistant", false);
      }
      llmConversationHistory.push({
        role: "assistant",
        content: `Error: ${error.message}`,
      });
    } finally {
      if (llmPromptInputEl) llmPromptInputEl.disabled = false;
      if (llmSendPromptBtn) llmSendPromptBtn.disabled = false;
      if (llmPromptInputEl) llmPromptInputEl.focus();
    }
  }

  function _getSelectedLlmContext() {
    const context = {};
    const appVars = dependencies.getAppVariables
      ? dependencies.getAppVariables()
      : {};

    const noDeviceContextNeeded = !(
      llmContextUiHierarchyCheckbox?.checked ||
      llmContextSelectedElementCheckbox?.checked ||
      llmContextDeviceInfoCheckbox?.checked
    );
    if (
      !appVars.currentDeviceSerial &&
      !noDeviceContextNeeded &&
      dependencies.updateMessage
    ) {
      dependencies.updateMessage(
        "Please select a device to include its context.",
        "warning",
      );
    }

    if (
      llmContextUiHierarchyCheckbox?.checked &&
      appVars.currentHierarchyData &&
      appVars.currentDeviceSerial
    ) {
      context.uiHierarchy = appVars.currentHierarchyData;
    }

    if (
      llmContextSelectedElementCheckbox?.checked &&
      appVars.selectedElements &&
      appVars.selectedElements.length > 0 &&
      appVars.currentDeviceSerial
    ) {
      context.selectedElements = appVars.selectedElements;
    }

    if (capturedLastErrorForNextPrompt) {
      context.pythonLastErrorTraceback = capturedLastErrorForNextPrompt;
    }

    if (llmContextPythonConsoleOutputCheckbox?.checked) {
      if (
        dependencies.PythonConsoleManager &&
        typeof dependencies.PythonConsoleManager.getOutput === "function"
      ) {
        const outputLinesCount =
          llmContextPythonConsoleOutputLinesSelect?.value;
        const fullOutput = dependencies.PythonConsoleManager.getOutput();
        if (fullOutput) {
          let outputToSend =
            "# General console output is configured but empty or failed to retrieve.";
          if (outputLinesCount === "all") {
            outputToSend = fullOutput;
          } else if (outputLinesCount === "lastError") {
            const errorKeywords = [
              "Traceback (most recent call last):",
              "Error:",
              "Exception:",
            ];
            let lastErrorIndex = -1;
            for (const keyword of errorKeywords) {
              const currentIndex = fullOutput.lastIndexOf(keyword);
              if (currentIndex > lastErrorIndex) lastErrorIndex = currentIndex;
            }
            outputToSend =
              lastErrorIndex !== -1
                ? fullOutput.substring(lastErrorIndex)
                : "# No specific error signature found in general console output via dropdown logic.";
          } else {
            const linesToGet = parseInt(outputLinesCount, 10);
            if (!isNaN(linesToGet) && linesToGet > 0) {
              outputToSend = fullOutput
                .split("\n")
                .slice(-linesToGet)
                .join("\n");
            } else {
              outputToSend = `# Invalid line count for general console output: ${outputLinesCount}`;
            }
          }
          if (
            !capturedLastErrorForNextPrompt ||
            !capturedLastErrorForNextPrompt.includes(outputToSend.trim())
          ) {
            context.pythonConsoleOutput = outputToSend;
          } else if (
            capturedLastErrorForNextPrompt &&
            outputToSend &&
            capturedLastErrorForNextPrompt !== outputToSend.trim()
          ) {
            context.pythonConsoleOutput = outputToSend;
          }
        } else {
          context.pythonConsoleOutput =
            "# Python console output is currently empty.";
        }
      } else {
        context.pythonConsoleOutput =
          "# Python console output is unavailable (manager error).";
      }
    }

    if (
      llmContextPythonCodeCheckbox?.checked &&
      dependencies.PythonConsoleManager?.getCode
    ) {
      context.pythonCode = dependencies.PythonConsoleManager.getCode();
    }
    if (
      llmContextDeviceInfoCheckbox?.checked &&
      appVars.currentDeviceSerial &&
      appVars.devices
    ) {
      const currentDevice = appVars.devices.find(
        (d) => d.serial === appVars.currentDeviceSerial,
      );
      if (currentDevice) {
        context.deviceInfo = {
          serial: currentDevice.serial,
          model: currentDevice.model,
          sdkVersion: currentDevice.sdkVersion,
          actualWidth: appVars.actualDeviceWidth,
          actualHeight: appVars.actualDeviceHeight,
        };
      }
    }
    return context;
  }

  function notifyNodeSelectionChanged(nodes) {
    if (Array.isArray(nodes)) {
      currentSelectedNodesForLlm = nodes.length > 0 ? nodes : null;
    } else if (nodes) {
      currentSelectedNodesForLlm = [nodes];
    } else {
      currentSelectedNodesForLlm = null;
    }
    if (llmContextSelectedElementCheckbox) {
      llmContextSelectedElementCheckbox.checked = !!(
        currentSelectedNodesForLlm && currentSelectedNodesForLlm.length > 0
      );
    }
  }

  function init(initDeps) {
    dependencies = { ...dependencies, ...initDeps };
    if (
      !dependencies.getAppVariables ||
      !dependencies.updateMessage ||
      !dependencies.PythonConsoleManager
    ) {
      console.error(
        "LLM_MOD_ERR: Core dependencies missing in LlmAssistantModule.init()!",
      );
      return;
    }
    if (!_fetchLlmDomElements()) {
      console.error(
        "LLM_MOD_ERR: LlmAssistantModule.init failed due to missing critical DOM elements.",
      );
      return;
    }

    if (llmSendPromptBtn)
      llmSendPromptBtn.addEventListener("click", _handleSendLlmPrompt);
    if (llmPromptInputEl) {
      llmPromptInputEl.addEventListener("keypress", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          _handleSendLlmPrompt();
        }
      });
      llmPromptInputEl.addEventListener("input", function () {
        this.style.height = "auto";
        this.style.height = Math.min(this.scrollHeight, 120) + "px";
      });
    }
    if (llmClearConversationBtn)
      llmClearConversationBtn.addEventListener("click", _clearLlmChat);
    if (llmIncludeLastErrorBtn)
      llmIncludeLastErrorBtn.addEventListener(
        "click",
        _handleIncludeLastErrorClick,
      );

    _fetchServiceConfigsAndInitRagPolling();

    if (
      llmChatHistoryEl &&
      llmChatHistoryEl.children.length === 0 &&
      llmConversationHistory.length === 0
    ) {
      _addMessageToChatHistory(
        "Hello! How can I assist you with your UI automation tasks today?",
        "assistant",
      );
    }
    console.log(
      "LLM_MOD_LOG: LlmAssistantModule.init() finished successfully.",
    );
  }

  function openPropertiesTab(evt, tabName) {
    let i, tabcontent, tablinks;
    tabcontent = document.querySelectorAll("#panel-properties > .tab-content");
    for (i = 0; i < tabcontent.length; i++) {
      tabcontent[i].style.display = "none";
      tabcontent[i].classList.remove("active");
    }
    tablinks = document.querySelectorAll("#properties-panel-tabs .tab-button");
    for (i = 0; i < tablinks.length; i++) {
      tablinks[i].classList.remove("active");
    }
    const activeTab = document.getElementById(tabName);
    if (activeTab) {
      activeTab.style.display = "flex";
      activeTab.classList.add("active");
    }
    if (evt && evt.currentTarget) {
      evt.currentTarget.classList.add("active");
    } else {
      for (i = 0; i < tablinks.length; i++) {
        const onclickAttr = tablinks[i].getAttribute("onclick");
        if (
          onclickAttr &&
          (onclickAttr.includes("'" + tabName + "'") ||
            onclickAttr.includes('"' + tabName + '"'))
        ) {
          tablinks[i].classList.add("active");
          break;
        }
      }
    }
  }

  return {
    init: init,
    notifyNodeSelectionChanged: notifyNodeSelectionChanged,
    openPropertiesTab: openPropertiesTab,
  };
})();

if (
  window.LlmAssistantModule &&
  typeof window.LlmAssistantModule.openPropertiesTab === "function"
) {
  window.openPropertiesTab = window.LlmAssistantModule.openPropertiesTab;
} else {
  console.error(
    "LLM_MOD_ERR: CRITICAL - Failed to assign window.openPropertiesTab from LlmAssistantModule.",
  );
}
