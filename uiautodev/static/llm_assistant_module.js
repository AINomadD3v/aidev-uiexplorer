// static/llm_assistant_module.js
// console.log("LLM_MOD_LOG: llm_assistant_module.js script started loading.");

window.LlmAssistantModule = (function () {
  // console.log("LLM_MOD_LOG: LlmAssistantModule IIFE invoked.");
  // --- Private Variables ---
  let llmConversationHistory = [];
  let dependencies = {
    getAppVariables: () => {
      return {
        selectedNode: null,
        currentHierarchyData: null,
        currentDeviceSerial: null,
        devices: [],
        actualDeviceWidth: null,
        actualDeviceHeight: null,
        generatedXpathValue: "",
      };
    },
    PythonConsoleManager: null,
    updateMessage: (text, type, duration) => {
      // This log can be useful to know if the LLM module is trying to communicate status
      // console.log(`LLM_MOD_LOG: updateMessage dependency called with: ${type} - ${text}`);
    },
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
    openGlobalTab: (evt, tabName) => {
      // console.log(`LLM_MOD_LOG: openGlobalTab dependency called for ${tabName}`);
    },
  };

  // DOM Elements
  let llmChatHistoryEl,
    llmPromptInputEl,
    llmSendPromptBtn,
    llmClearConversationBtn;
  let llmContextUiHierarchyCheckbox,
    llmContextSelectedElementCheckbox,
    llmContextPythonConsoleOutputCheckbox,
    llmContextPythonConsoleOutputLinesSelect,
    llmContextPythonCodeCheckbox,
    llmContextDeviceInfoCheckbox;

  // --- NEW: RAG API Status Variables ---
  let ragApiStatusIndicatorEl;
  let RAG_API_HEALTH_URL = null;
  let ragApiPollIntervalId = null;
  // --- END NEW ---

  // --- Private Functions ---

  function _fetchLlmDomElements() {
    // console.log("LLM_MOD_LOG: _fetchLlmDomElements() called.");
    let allCriticalFound = true;

    llmChatHistoryEl = document.getElementById("llm-chat-history");
    if (!llmChatHistoryEl) {
      console.error("LLM_MOD_ERR: 'llm-chat-history' NOT FOUND!");
      allCriticalFound = false;
    }

    llmPromptInputEl = document.getElementById("llm-prompt-input");
    if (!llmPromptInputEl) {
      console.error("LLM_MOD_ERR: 'llm-prompt-input' NOT FOUND!");
      allCriticalFound = false;
    }

    llmSendPromptBtn = document.getElementById("llm-send-prompt-btn");
    if (!llmSendPromptBtn) {
      console.error("LLM_MOD_ERR: 'llm-send-prompt-btn' NOT FOUND!");
      allCriticalFound = false;
    }

    llmClearConversationBtn = document.getElementById(
      "llm-clear-conversation-btn",
    );
    if (!llmClearConversationBtn) {
      console.error("LLM_MOD_ERR: 'llm-clear-conversation-btn' NOT FOUND!");
      allCriticalFound = false;
    }

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

    // --- NEW: Fetch RAG API Status Indicator Element ---
    ragApiStatusIndicatorEl = document.getElementById(
      "rag-api-status-indicator",
    );
    if (!ragApiStatusIndicatorEl) {
      // This is not critical for core chat functionality, so a warning is okay.
      console.warn(
        "LLM_MOD_WARN: Optional 'rag-api-status-indicator' element NOT FOUND!",
      );
    }
    // --- END NEW ---

    if (!allCriticalFound && dependencies.updateMessage) {
      // Check if updateMessage exists before calling
      dependencies.updateMessage(
        "LLM Chat UI failed to load critical elements.",
        "error",
        0,
      );
    }
    return allCriticalFound;
  }

  // --- NEW: Functions for RAG API Status Polling ---
  async function _fetchServiceConfigsAndInitRagPolling() {
    try {
      const response = await fetch("/api/config/services"); // Endpoint in uiautodev/app.py
      if (!response.ok) {
        const errorText = await response.text(); // Get error text for better debugging
        console.error(
          "LLM_MOD_ERR: Failed to fetch service configurations:",
          response.status,
          errorText,
        );
        _setRagApiStatus("error", "RAG API Status: Config Error (Server)");
        return;
      }
      const config = await response.json();
      if (config.ragApiBaseUrl) {
        RAG_API_HEALTH_URL =
          config.ragApiBaseUrl.replace(/\/$/, "") + "/health"; // Ensure no trailing slash then add /health
        // console.log("LLM_MOD_LOG: RAG API Health URL configured:", RAG_API_HEALTH_URL);
        _pollRagApiStatus(); // Start polling now that we have the URL
      } else {
        console.warn(
          "LLM_MOD_WARN: RAG API Base URL not provided in service configurations.",
        );
        _setRagApiStatus("error", "RAG API Status: Config Missing (Server)");
      }
    } catch (error) {
      console.error(
        "LLM_MOD_ERR: Error fetching service configurations:",
        error,
      );
      _setRagApiStatus("error", "RAG API Status: Config Fetch Failed");
    }
  }

  function _setRagApiStatus(statusType, detailMessage = "") {
    if (!ragApiStatusIndicatorEl) return;

    ragApiStatusIndicatorEl.classList.remove(
      "status-ok",
      "status-error",
      "status-degraded",
    );
    let tooltipText = "RAG API Status: ";

    if (statusType === "ok") {
      ragApiStatusIndicatorEl.classList.add("status-ok");
      tooltipText += "Operational";
    } else if (statusType === "degraded") {
      ragApiStatusIndicatorEl.classList.add("status-degraded");
      tooltipText += `Degraded (${detailMessage || "Partial service"})`;
    } else if (statusType === "error") {
      ragApiStatusIndicatorEl.classList.add("status-error");
      tooltipText += `Error (${detailMessage || "Service issue"})`;
    } else {
      // Unknown or initializing state
      // Default to grey, no specific class needed if CSS handles default #888
      // ragApiStatusIndicatorEl.style.backgroundColor = '#888';
      tooltipText += `Unknown (${detailMessage || "Checking..."})`;
    }
    ragApiStatusIndicatorEl.title = tooltipText;
  }

  async function _checkRagApiStatus() {
    if (!RAG_API_HEALTH_URL) {
      // This should be caught by _fetchServiceConfigsAndInitRagPolling setting an error.
      // If it happens, it means polling started before config was fetched or config failed.
      // _setRagApiStatus('error', 'RAG API URL Not Configured'); // Optionally set error here too
      return;
    }
    if (!ragApiStatusIndicatorEl) return;

    try {
      const response = await fetch(RAG_API_HEALTH_URL, {
        method: "GET",
        cache: "no-store", // Ensure fresh data
      });

      if (response.ok) {
        const data = await response.json();
        if (data.status === "ok") {
          _setRagApiStatus("ok"); // Default tooltip "Operational"
        } else {
          _setRagApiStatus("degraded", data.status || "Unknown Reason");
        }
      } else {
        _setRagApiStatus("error", `HTTP ${response.status}`);
      }
    } catch (error) {
      console.warn(
        "LLM_MOD_WARN: Error polling RAG API status (RAG API likely unreachable):",
        error.message,
      );
      _setRagApiStatus("error", "Unreachable");
    }
  }

  function _pollRagApiStatus() {
    if (ragApiPollIntervalId) {
      clearInterval(ragApiPollIntervalId); // Clear existing interval if any, good practice
    }
    _checkRagApiStatus(); // Perform an initial check immediately
    ragApiPollIntervalId = setInterval(_checkRagApiStatus, 15000); // Poll every 15 seconds
  }
  // --- END NEW RAG API Status Functions ---

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
      if (i % 2 === 0) {
        parts[i] = parts[i].replace(/\n/g, "<br>");
      }
    }
    html = parts.join("");
    return html;
  }

  function _addMessageToChatHistory(
    initialContent = "",
    type = "assistant",
    isHtml = false,
    isStreaming = false,
  ) {
    if (!llmChatHistoryEl) {
      console.error(
        "LLM_MOD_ERR: _addMessageToChatHistory - llmChatHistoryEl is null!",
      );
      return null;
    }
    const messageDiv = document.createElement("div");
    messageDiv.classList.add("llm-message", `llm-message-${type}`);
    messageDiv.dataset.rawContent = isStreaming
      ? initialContent
      : isHtml
        ? "HTML_CONTENT_NO_RAW"
        : initialContent;

    if (isHtml) {
      messageDiv.innerHTML = initialContent;
    } else {
      messageDiv.innerHTML = _formatResponseForDisplay(initialContent);
    }

    llmChatHistoryEl.appendChild(messageDiv);
    llmChatHistoryEl.scrollTop = llmChatHistoryEl.scrollHeight;

    if (type === "assistant") {
      _addCodeActionButtonsToMessage(messageDiv);
    }
    return messageDiv;
  }

  function _addCodeActionButtonsToMessage(messageDiv) {
    if (
      !messageDiv ||
      !dependencies.PythonConsoleManager ||
      typeof dependencies.PythonConsoleManager.setCode !== "function"
    ) {
      return;
    }
    messageDiv
      .querySelectorAll(".llm-code-action-buttons")
      .forEach((btnContainer) => btnContainer.remove());
    const preElements = messageDiv.querySelectorAll("pre");
    preElements.forEach((preElement) => {
      const codeElement = preElement.querySelector("code");
      const codeText = codeElement
        ? codeElement.textContent
        : preElement.textContent;

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
      insertButton.title = "Insert code into Python Console";
      insertButton.addEventListener("click", (e) => {
        e.stopPropagation();
        dependencies.PythonConsoleManager.setCode(codeText);
        dependencies.updateMessage(
          "Code inserted into Python console.",
          "success",
          2000,
        );
        if (dependencies.openGlobalTab) {
          dependencies.openGlobalTab(null, "python-tab-content");
        }
      });

      buttonsContainer.appendChild(copyButton);
      buttonsContainer.appendChild(insertButton);
      preElement.style.position = "relative";
      preElement.appendChild(buttonsContainer);
    });
  }

  function _updateStreamedMessage(messageDiv, newChunk, isComplete = false) {
    if (!messageDiv) return;
    messageDiv.dataset.rawContent += newChunk;
    messageDiv.innerHTML = _formatResponseForDisplay(
      messageDiv.dataset.rawContent,
    );
    if (llmChatHistoryEl) {
      llmChatHistoryEl.scrollTop = llmChatHistoryEl.scrollHeight;
    }
    _addCodeActionButtonsToMessage(messageDiv); // Re-add buttons as innerHTML is overwritten
  }

  function _clearLlmChat() {
    // console.log("LLM_MOD_LOG: _clearLlmChat() called.");
    if (llmChatHistoryEl) llmChatHistoryEl.innerHTML = "";
    llmConversationHistory = [];
    _addMessageToChatHistory(
      "Chat cleared. How can I help you next?",
      "assistant",
    );
    if (dependencies.updateMessage)
      dependencies.updateMessage("Chat conversation cleared.", "info");
  }

  async function _handleSendLlmPrompt() {
    // console.log("LLM_MOD_LOG: _handleSendLlmPrompt() CALLED.");
    if (!llmPromptInputEl || !llmSendPromptBtn) {
      console.error(
        "LLM_MOD_ERR: _handleSendLlmPrompt - Critical UI elements missing.",
      );
      return;
    }

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

    _addMessageToChatHistory(promptText, "user");
    llmConversationHistory.push({ role: "user", content: promptText });

    llmPromptInputEl.value = "";
    llmPromptInputEl.style.height = "auto";
    llmPromptInputEl.disabled = true;
    llmSendPromptBtn.disabled = true;

    const context = _getSelectedLlmContext();
    const payload = {
      prompt: promptText,
      context: context,
      history: llmConversationHistory.slice(-7, -1), // Send last 3 user/assistant pairs, not including current user prompt
    };

    const assistantMessageDiv = _addMessageToChatHistory(
      "<i>Assistant is thinking...</i>",
      "assistant",
      true, // isHtml
      true, // isStreaming
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
        } catch (e) {
          /* ignore if response is not json */
        }
        console.error(
          "LLM_MOD_ERR: _handleSendLlmPrompt - Fetch not OK:",
          errorDetail,
        );
        throw new Error(errorDetail);
      }
      if (!response.body) {
        console.error(
          "LLM_MOD_ERR: _handleSendLlmPrompt - Response body is null.",
        );
        throw new Error("Response body is null, cannot read stream.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamShouldEnd = false;

      if (assistantMessageDiv) {
        assistantMessageDiv.dataset.rawContent = ""; // Clear "thinking..."
        assistantMessageDiv.innerHTML = "";
      }

      while (true) {
        // Outer loop for reading stream chunks
        const { value, done } = await reader.read();
        if (done) {
          _updateStreamedMessage(assistantMessageDiv, "", true); // Final update for any remaining content
          streamShouldEnd = true;
        } else {
          buffer += decoder.decode(value, { stream: true });
        }

        let eolIndex;
        // Inner loop for processing complete SSE messages from buffer
        while ((eolIndex = buffer.indexOf("\n\n")) >= 0) {
          const sseMessage = buffer.slice(0, eolIndex);
          buffer = buffer.slice(eolIndex + 2); // Consume message and the two newlines
          let currentEventType = "message"; // Default if no event line
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
                console.error(
                  "LLM_MOD_ERR: SSE Event 'error':",
                  parsedData.error,
                );
                const errorChunk = `\n[Stream Error: ${dependencies.escapeHtml(parsedData.error)}]`;
                accumulatedResponse += errorChunk;
                _updateStreamedMessage(assistantMessageDiv, errorChunk);
                if (dependencies.updateMessage)
                  dependencies.updateMessage(
                    `LLM Error: ${parsedData.error}`,
                    "error",
                  );
                streamShouldEnd = true; // Error means stream is effectively over
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
                // console.log("LLM_MOD_LOG: SSE Event 'end-of-stream':", parsedData.message);
                _updateStreamedMessage(assistantMessageDiv, "", true); // Final update
                streamShouldEnd = true;
                break;
              }
              // Handle other event types like 'tool_request_details', 'usage_update' if needed
            } catch (e) {
              console.error(
                "LLM_MOD_ERR: Error parsing JSON from stream data:",
                dataContent,
                e,
              );
              // If parsing fails but it was a message event, treat dataContent as raw text.
              if (
                currentEventType === "message" ||
                currentEventType === "data"
              ) {
                accumulatedResponse += dataContent;
                _updateStreamedMessage(assistantMessageDiv, dataContent);
              }
            }
          }
          if (streamShouldEnd) break; // Break inner while if stream should end
        }
        if (streamShouldEnd) break; // Break outer while if stream should end
      }

      // Final processing after stream has ended
      if (
        llmConversationHistory[llmConversationHistory.length - 1].role !==
        "assistant"
      ) {
        // Only add if the last message isn't already the assistant's full response
        llmConversationHistory.push({
          role: "assistant",
          content: accumulatedResponse,
        });
      } else if (llmConversationHistory.length > 0) {
        // Update the last assistant message if it was partial
        llmConversationHistory[llmConversationHistory.length - 1].content =
          accumulatedResponse;
      }
    } catch (error) {
      console.error(
        "LLM_MOD_ERR: _handleSendLlmPrompt - Error during fetch/stream processing:",
        error,
      );
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
        content: `Error: ${error.message}`, // Store a more structured error
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
      context.uiHierarchy = JSON.parse(
        JSON.stringify(appVars.currentHierarchyData),
      );
    }
    if (
      llmContextSelectedElementCheckbox?.checked &&
      appVars.selectedNode &&
      appVars.currentDeviceSerial
    ) {
      context.selectedElement = JSON.parse(
        JSON.stringify(appVars.selectedNode),
      );
      if (appVars.generatedXpathValue) {
        context.selectedElement.generatedXPath = appVars.generatedXpathValue;
      }
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
          if (outputLinesCount === "all") {
            context.pythonConsoleOutput = fullOutput;
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
            if (lastErrorIndex !== -1) {
              context.pythonConsoleOutput =
                fullOutput.substring(lastErrorIndex);
            } else {
              context.pythonConsoleOutput =
                "# No error found in recent Python console output.";
            }
          } else {
            const linesToGet = parseInt(outputLinesCount, 10);
            if (!isNaN(linesToGet) && linesToGet > 0) {
              const lines = fullOutput.split("\n");
              context.pythonConsoleOutput = lines.slice(-linesToGet).join("\n");
            } else {
              console.warn(
                `LLM_MOD_WARN: Python Context: Invalid number of lines to get: ${outputLinesCount}`,
              );
            }
          }
        } else {
          context.pythonConsoleOutput =
            "# Python console output is currently empty.";
        }
      } else {
        console.warn(
          "LLM_MOD_WARN: PythonConsoleManager.getOutput is not available.",
        );
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

  // --- Public Functions (exposed via return) ---
  function init(initDeps) {
    // console.log("LLM_MOD_LOG: LlmAssistantModule.init() called.");
    dependencies = { ...dependencies, ...initDeps };
    if (
      typeof dependencies.getAppVariables !== "function" ||
      typeof dependencies.updateMessage !== "function"
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

    if (llmSendPromptBtn) {
      llmSendPromptBtn.addEventListener("click", _handleSendLlmPrompt);
    }
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
    if (llmClearConversationBtn) {
      llmClearConversationBtn.addEventListener("click", _clearLlmChat);
    }

    // --- NEW: Start fetching service configs which will then trigger RAG API status polling ---
    _fetchServiceConfigsAndInitRagPolling();
    // ------------------------------------------------------------------------------------

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

  function notifyNodeSelectionChanged(node) {
    if (llmContextSelectedElementCheckbox) {
      llmContextSelectedElementCheckbox.checked = !!(node && node.key);
    }
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
      // Fallback to find button by tabName if event is not passed (e.g., initial load)
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

  // console.log("LLM_MOD_LOG: LlmAssistantModule IIFE structure defined, returning public methods.");
  return {
    init: init,
    notifyNodeSelectionChanged: notifyNodeSelectionChanged,
    openPropertiesTab: openPropertiesTab,
  };
})();

// console.log("LLM_MOD_LOG: IIFE executed. Checking window.LlmAssistantModule:", window.LlmAssistantModule);
if (
  window.LlmAssistantModule &&
  typeof window.LlmAssistantModule.openPropertiesTab === "function"
) {
  window.openPropertiesTab = window.LlmAssistantModule.openPropertiesTab;
  // console.log("LLM_MOD_LOG: window.openPropertiesTab function has been successfully assigned from LlmAssistantModule.");
} else {
  console.error(
    "LLM_MOD_ERR: CRITICAL - Failed to assign window.openPropertiesTab from LlmAssistantModule.",
  );
}
