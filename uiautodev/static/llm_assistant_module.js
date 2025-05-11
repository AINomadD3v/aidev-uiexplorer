// static/llm_assistant_module.js
console.log("llm_assistant_module.js: Loaded");

const LlmAssistantModule = (function () {
  // --- Private Variables ---
  let llmConversationHistory = [];
  let dependencies = {
    getAppVariables: () => ({
      selectedNode: null,
      currentHierarchyData: null,
      currentDeviceSerial: null,
      devices: [],
      actualDeviceWidth: null,
      actualDeviceHeight: null,
      generatedXpathValue: "",
    }),
    PythonConsoleManager: null,
    updateMessage: (text, type, duration) =>
      console.log(`LLM_UpdateMessage: ${type} - ${text}`),
    callBackend: async (method, endpoint, body) => {
      // This will NOT be used for the streaming chat call
      console.warn("LLM_callBackend used for non-streaming or fallback.");
      // Original implementation of callBackend is assumed to be passed via initDeps
      // and would handle non-streaming API calls if any were needed by this module.
      // For the streaming chat, we'll use fetch directly.
      throw new Error(
        "callBackend fallback not fully implemented here if needed by LLM module directly.",
      );
    },
    escapeHtml: (s) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;"),
    openGlobalTab: (evt, tabName) =>
      console.log(`LLM_openGlobalTab for ${tabName}`),
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

  // --- Private Functions ---

  function _fetchLlmDomElements() {
    llmChatHistoryEl = document.getElementById("llm-chat-history");
    llmPromptInputEl = document.getElementById("llm-prompt-input");
    llmSendPromptBtn = document.getElementById("llm-send-prompt-btn");
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

    if (
      !llmChatHistoryEl ||
      !llmPromptInputEl ||
      !llmSendPromptBtn ||
      !llmClearConversationBtn
    ) {
      console.error("LLM_MODULE: Critical LLM chat UI elements not found!");
      dependencies.updateMessage(
        "LLM Chat UI failed to load critical elements.",
        "error",
        0,
      );
      return false;
    }
    return true;
  }

  function _formatResponseForDisplay(rawText) {
    // Ensure code blocks are formatted correctly.
    // This regex handles various languages and ensures ``` is on its own line or start/end of content.
    let html = rawText.replace(
      /```(\w*)\n?([\s\S]*?)\n?```/g,
      (match, lang, code) => {
        const languageClass = lang ? `language-${lang.trim()}` : "";
        // Trim trailing newline from code block if present, as <pre> handles it
        const trimmedCode = code.replace(/\n$/, "");
        return `<pre><code class="${languageClass}">${dependencies.escapeHtml(trimmedCode)}</code></pre>`;
      },
    );
    // Convert other newlines to <br>, but not those inside <pre>
    // This is tricky. A common approach is to split by <pre> blocks, process, then rejoin.
    const parts = html.split(/(<pre(?:.|\n)*?<\/pre>)/);
    for (let i = 0; i < parts.length; i++) {
      if (!parts[i].startsWith("<pre")) {
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
    if (!llmChatHistoryEl) return null;

    const messageDiv = document.createElement("div");
    messageDiv.classList.add("llm-message", `llm-message-${type}`);

    // Store raw content for streaming updates
    messageDiv.dataset.rawContent = isStreaming
      ? initialContent
      : isHtml
        ? "HTML_NO_RAW"
        : initialContent;

    if (isHtml || isStreaming) {
      // For streaming, initial content might be "Thinking..." or empty, then updated
      messageDiv.innerHTML = isStreaming
        ? _formatResponseForDisplay(initialContent)
        : initialContent;
    } else {
      const p = document.createElement("p");
      p.textContent = initialContent;
      messageDiv.appendChild(p);
    }

    llmChatHistoryEl.appendChild(messageDiv);
    llmChatHistoryEl.scrollTop = llmChatHistoryEl.scrollHeight;

    // Code block buttons will be added by _updateStreamedMessage or after full non-streamed message
    if (type === "assistant" && (isHtml || isStreaming)) {
      _addCodeActionButtonsToMessage(messageDiv);
    }
    return messageDiv; // Return the created div for potential stream updates
  }

  function _addCodeActionButtonsToMessage(messageDiv) {
    if (!messageDiv) return;
    // Remove existing buttons to prevent duplication during stream updates
    messageDiv
      .querySelectorAll(".llm-code-action-buttons")
      .forEach((btnContainer) => btnContainer.remove());

    const preElements = messageDiv.querySelectorAll("pre");
    preElements.forEach((preElement) => {
      // Ensure pre isn't already processed by checking for existing button container
      if (preElement.querySelector(".llm-code-action-buttons")) return;

      const codeElement = preElement.querySelector("code");
      const codeText = codeElement
        ? codeElement.textContent
        : preElement.textContent;

      const buttonsContainer = document.createElement("div");
      buttonsContainer.className = "llm-code-action-buttons";

      const copyBtn = document.createElement("button");
      copyBtn.textContent = "Copy";
      copyBtn.className = "llm-code-copy-btn";
      copyBtn.title = "Copy code to clipboard";
      copyBtn.onclick = (e) => {
        e.stopPropagation();
        navigator.clipboard
          .writeText(codeText)
          .then(() =>
            dependencies.updateMessage("Code copied!", "success", 1500),
          )
          .catch((err) =>
            dependencies.updateMessage("Failed to copy code.", "error", 3000),
          );
      };
      buttonsContainer.appendChild(copyBtn);

      const insertBtn = document.createElement("button");
      insertBtn.textContent = "Insert";
      insertBtn.className = "llm-code-insert-btn";
      insertBtn.title = "Insert code into Python Console";
      insertBtn.onclick = (e) => {
        e.stopPropagation();
        if (
          dependencies.PythonConsoleManager &&
          typeof dependencies.PythonConsoleManager.setCode === "function"
        ) {
          dependencies.PythonConsoleManager.setCode(codeText);
          dependencies.updateMessage(
            "Code inserted into Python Console!",
            "success",
            2000,
          );
          if (typeof dependencies.openGlobalTab === "function") {
            const pythonTabButton = Array.from(
              document.querySelectorAll("#panel-hierarchy-code .tab-button"),
            ).find((btn) =>
              btn.getAttribute("onclick")?.includes("python-tab-content"),
            );
            if (pythonTabButton) {
              dependencies.openGlobalTab(
                { currentTarget: pythonTabButton },
                "python-tab-content",
              );
            }
          }
        } else {
          dependencies.updateMessage(
            "Python Console Manager not available.",
            "error",
            3000,
          );
        }
      };
      buttonsContainer.appendChild(insertBtn);
      preElement.appendChild(buttonsContainer);
    });
  }

  function _updateStreamedMessage(messageDiv, newChunk, isComplete = false) {
    if (!messageDiv) return;

    // Append new chunk to raw content
    messageDiv.dataset.rawContent += newChunk;

    // Re-render the entire message content with formatting
    messageDiv.innerHTML = _formatResponseForDisplay(
      messageDiv.dataset.rawContent,
    );

    // Re-attach code action buttons after innerHTML is overwritten
    _addCodeActionButtonsToMessage(messageDiv);

    llmChatHistoryEl.scrollTop = llmChatHistoryEl.scrollHeight; // Scroll to bottom

    if (isComplete) {
      // Any final processing after stream is complete
      // For example, explicitly save to conversation history if not done elsewhere
    }
  }

  function _clearLlmChat() {
    if (llmChatHistoryEl) llmChatHistoryEl.innerHTML = "";
    llmConversationHistory = [];
    _addMessageToChatHistory(
      "Chat cleared. How can I help you next?",
      "assistant",
      false,
    );
    dependencies.updateMessage("Chat conversation cleared.", "info");
  }

  async function _handleSendLlmPrompt() {
    if (!llmPromptInputEl || !llmSendPromptBtn) return;
    const promptText = llmPromptInputEl.value.trim();
    if (!promptText) {
      dependencies.updateMessage(
        "Please enter a message for the assistant.",
        "warning",
      );
      return;
    }

    _addMessageToChatHistory(dependencies.escapeHtml(promptText), "user");
    llmConversationHistory.push({ role: "user", content: promptText });
    llmPromptInputEl.value = "";
    llmPromptInputEl.style.height = "auto";
    llmPromptInputEl.disabled = true;
    llmSendPromptBtn.disabled = true;

    const context = _getSelectedLlmContext();
    const payload = {
      prompt: promptText,
      context: context,
      // Send recent history, e.g., last 6 messages (3 user, 3 assistant) + system prompt handled by backend
      history: llmConversationHistory.slice(-7, -1), // Exclude current user prompt, already in payload.prompt
    };

    // Create an empty container for the assistant's streamed response
    const assistantMessageDiv = _addMessageToChatHistory(
      "<i>Assistant is thinking...</i>",
      "assistant",
      true,
      true,
    );
    let accumulatedResponse = ""; // To store the full raw text for history

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
        // Try to parse error from backend if JSON, otherwise use status text
        let errorDetail = `HTTP error ${response.status}: ${response.statusText}`;
        try {
          const errorJson = await response.json();
          errorDetail = errorJson.detail || errorJson.error || errorDetail;
        } catch (e) {
          /* Ignore if not JSON */
        }
        throw new Error(errorDetail);
      }

      if (!response.body) {
        throw new Error("Response body is null, cannot read stream.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = ""; // To handle partial SSE messages

      // Clear "Thinking..." and prepare for actual content
      if (assistantMessageDiv) {
        assistantMessageDiv.dataset.rawContent = ""; // Reset raw content
        assistantMessageDiv.innerHTML = ""; // Clear "Thinking..."
      }

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          _updateStreamedMessage(assistantMessageDiv, "", true); // Final update, ensures buttons if any
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        let eolIndex;

        // Process complete SSE messages (lines ending in \n\n)
        while ((eolIndex = buffer.indexOf("\n\n")) >= 0) {
          const sseMessage = buffer.slice(0, eolIndex);
          buffer = buffer.slice(eolIndex + 2); // Consume the message and the two newlines

          let eventType = "message"; // Default SSE event type
          let dataContent = "";

          sseMessage.split("\n").forEach((line) => {
            if (line.startsWith("event: ")) {
              eventType = line.substring("event: ".length).trim();
            } else if (line.startsWith("data: ")) {
              // Data can span multiple "data:" lines, but our backend sends one JSON string per data.
              // For simplicity, we assume one data line here as per our backend's current yield.
              dataContent = line.substring("data: ".length).trim();
            }
          });

          if (dataContent) {
            try {
              const parsedData = JSON.parse(dataContent); // Backend sends JSON string: "chunk"

              if (eventType === "error") {
                console.error("Stream error event:", parsedData.error);
                accumulatedResponse += `\n\n**Error from LLM:** ${parsedData.error}`;
                _updateStreamedMessage(
                  assistantMessageDiv,
                  `\n\n**Error from LLM:** ${dependencies.escapeHtml(parsedData.error)}`,
                );
                // Potentially stop processing further if it's a fatal error
                break; // Break from while ((eolIndex... loop
              } else if (eventType === "message") {
                const textChunk =
                  typeof parsedData === "string"
                    ? parsedData
                    : parsedData.content || "";
                accumulatedResponse += textChunk;
                _updateStreamedMessage(assistantMessageDiv, textChunk);
              } else if (eventType === "end-of-stream") {
                console.log("End-of-stream event received from backend.");
                // This break is for the inner `while ((eolIndex...))` loop.
                // The outer `while (true)` loop will break when `reader.read()` returns `done: true`.
                break;
              }
              // Handle other custom events if necessary
            } catch (e) {
              console.error(
                "Error parsing JSON from stream data:",
                dataContent,
                e,
              );
              // It might be a plain text chunk if JSON.parse fails and backend changes format.
              // For now, we assume JSON string data as per backend setup.
              // accumulatedResponse += dataContent; // Fallback: treat as raw text
              // _updateStreamedMessage(assistantMessageDiv, dataContent);
            }
          }
        } // end while for SSE message processing
      } // end while for reader.read()

      llmConversationHistory.push({
        role: "assistant",
        content: accumulatedResponse,
      });
    } catch (error) {
      console.error("LLM_MODULE: Error during LLM stream processing:", error);
      const errorMsg = `Sorry, I encountered an error: ${dependencies.escapeHtml(error.message)}`;
      if (assistantMessageDiv) {
        _updateStreamedMessage(assistantMessageDiv, errorMsg, true);
      } else {
        _addMessageToChatHistory(errorMsg, "assistant", true);
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
    const appVars = dependencies.getAppVariables();

    if (
      !appVars.currentDeviceSerial &&
      (llmContextUiHierarchyCheckbox?.checked ||
        llmContextSelectedElementCheckbox?.checked ||
        llmContextDeviceInfoCheckbox?.checked)
    ) {
      dependencies.updateMessage(
        "No device selected. Some LLM context might be limited.",
        "warning",
        3000,
      );
    }

    if (
      llmContextUiHierarchyCheckbox?.checked &&
      appVars.currentHierarchyData
    ) {
      context.uiHierarchy = JSON.parse(
        JSON.stringify(appVars.currentHierarchyData),
      );
    }
    if (llmContextSelectedElementCheckbox?.checked && appVars.selectedNode) {
      context.selectedElement = JSON.parse(
        JSON.stringify(appVars.selectedNode),
      );
      if (appVars.generatedXpathValue) {
        context.selectedElement.generatedXPath = appVars.generatedXpathValue;
      }
    }
    if (llmContextPythonConsoleOutputCheckbox?.checked) {
      const outputEl = document.getElementById("interactive-python-output");
      if (
        outputEl?.textContent &&
        outputEl.textContent.trim() !== "" &&
        outputEl.textContent.trim() !== "# Output will appear here..." &&
        outputEl.textContent.trim() !== "# No output"
      ) {
        const linesToGet = llmContextPythonConsoleOutputLinesSelect.value;
        const fullOutput = outputEl.textContent;
        if (linesToGet === "lastError") {
          const errorMarker = "--- TRACEBACK ---";
          const stderrMarker = "--- STDERR ---";
          let errorIndex = fullOutput.lastIndexOf(errorMarker);
          if (errorIndex === -1)
            errorIndex = fullOutput.lastIndexOf(stderrMarker);
          context.pythonConsoleOutput =
            errorIndex !== -1
              ? fullOutput.substring(errorIndex)
              : fullOutput.split("\n").slice(-10).join("\n");
        } else if (linesToGet === "all") {
          context.pythonConsoleOutput = fullOutput;
        } else {
          context.pythonConsoleOutput = fullOutput
            .split("\n")
            .slice(-parseInt(linesToGet, 10))
            .join("\n");
        }
      }
    }
    if (
      llmContextPythonCodeCheckbox?.checked &&
      dependencies.PythonConsoleManager?.getCode
    ) {
      const pyCode = dependencies.PythonConsoleManager.getCode();
      if (pyCode?.trim() !== "") context.pythonCode = pyCode;
    }
    if (
      llmContextDeviceInfoCheckbox?.checked &&
      appVars.currentDeviceSerial &&
      appVars.devices
    ) {
      const selectedDeviceData = appVars.devices.find(
        (d) => d.serial === appVars.currentDeviceSerial,
      );
      context.deviceInfo = {
        serial: appVars.currentDeviceSerial,
        model: selectedDeviceData?.model || "N/A",
        sdkVersion: selectedDeviceData?.sdkVersion || "N/A",
        actualDeviceWidth: appVars.actualDeviceWidth,
        actualDeviceHeight: appVars.actualDeviceHeight,
      };
    }
    return context;
  }

  // _callBackendLlmChat is removed as its functionality is now part of _handleSendLlmPrompt with fetch

  // --- Public Functions (exposed via return) ---
  function init(initDeps) {
    console.log("LlmAssistantModule: Initializing...");
    dependencies = { ...dependencies, ...initDeps };

    if (!_fetchLlmDomElements()) {
      console.error(
        "LLM_MODULE: Initialization failed due to missing DOM elements.",
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
        this.style.height =
          Math.min(
            this.scrollHeight,
            parseInt(getComputedStyle(this).maxHeight) || 120,
          ) + "px";
      });
    }
    if (llmClearConversationBtn)
      llmClearConversationBtn.addEventListener("click", _clearLlmChat);

    if (
      llmConversationHistory.length === 0 &&
      llmChatHistoryEl &&
      llmChatHistoryEl.children.length === 0
    ) {
      _addMessageToChatHistory(
        "Hello! How can I assist you with your UI automation tasks today?",
        "assistant",
      );
    }
    console.log("LlmAssistantModule: Initialization complete.");
  }

  function notifyNodeSelectionChanged(node) {
    if (llmContextSelectedElementCheckbox) {
      llmContextSelectedElementCheckbox.checked = !!(node && node.key);
    }
  }

  function openPropertiesTab(evt, tabName) {
    console.log(`LLM_MODULE: openPropertiesTab called for: ${tabName}`);
    let i, tc, tb;
    tc = document.querySelectorAll("#panel-properties > .tab-content");
    for (i = 0; i < tc.length; i++) {
      tc[i].style.display = "none";
      tc[i].classList.remove("active");
    }
    tb = document.querySelectorAll("#properties-panel-tabs .tab-button");
    for (i = 0; i < tb.length; i++) {
      tb[i].classList.remove("active");
    }
    const activeTabContent = document.getElementById(tabName);
    if (activeTabContent) {
      activeTabContent.style.display = "flex";
      activeTabContent.classList.add("active");
    }
    if (evt && evt.currentTarget) {
      evt.currentTarget.classList.add("active");
    }
    // if (tabName === "llm-assistant-tab-content" && llmPromptInputEl) {
    // llmPromptInputEl.focus(); // Optional
    // }
  }

  return {
    init: init,
    notifyNodeSelectionChanged: notifyNodeSelectionChanged,
    openPropertiesTab: openPropertiesTab,
  };
})();

if (LlmAssistantModule && LlmAssistantModule.openPropertiesTab) {
  window.openPropertiesTab = LlmAssistantModule.openPropertiesTab;
}
