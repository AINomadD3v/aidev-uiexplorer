// static/llm_assistant_module.js
console.log("LLM_MOD_LOG: llm_assistant_module.js script started loading.");

window.LlmAssistantModule = (function () {
  console.log("LLM_MOD_LOG: LlmAssistantModule IIFE invoked.");
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
      console.log(
        `LLM_MOD_LOG: updateMessage dependency called with: ${type} - ${text}`,
      );
    },
    callBackend: async (method, endpoint, body) => {
      console.warn(
        "LLM_MOD_LOG: LLM_callBackend dependency used for non-streaming or fallback.",
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
      console.log(
        `LLM_MOD_LOG: openGlobalTab dependency called for ${tabName}`,
      );
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

  // --- Private Functions ---

  function _fetchLlmDomElements() {
    console.log("LLM_MOD_LOG: _fetchLlmDomElements() called.");
    let allCriticalFound = true;

    llmChatHistoryEl = document.getElementById("llm-chat-history");
    if (!llmChatHistoryEl) {
      console.error("LLM_MOD_LOG: 'llm-chat-history' NOT FOUND!");
      allCriticalFound = false;
    } else {
      console.log("LLM_MOD_LOG: 'llm-chat-history' found.");
    }

    llmPromptInputEl = document.getElementById("llm-prompt-input");
    if (!llmPromptInputEl) {
      console.error("LLM_MOD_LOG: 'llm-prompt-input' NOT FOUND!");
      allCriticalFound = false;
    } else {
      console.log("LLM_MOD_LOG: 'llm-prompt-input' found.");
    }

    llmSendPromptBtn = document.getElementById("llm-send-prompt-btn");
    if (!llmSendPromptBtn) {
      console.error("LLM_MOD_LOG: 'llm-send-prompt-btn' NOT FOUND!");
      allCriticalFound = false;
    } else {
      console.log("LLM_MOD_LOG: 'llm-send-prompt-btn' found.");
    }

    llmClearConversationBtn = document.getElementById(
      "llm-clear-conversation-btn",
    );
    if (!llmClearConversationBtn) {
      console.error("LLM_MOD_LOG: 'llm-clear-conversation-btn' NOT FOUND!");
      allCriticalFound = false;
    } else {
      console.log("LLM_MOD_LOG: 'llm-clear-conversation-btn' found.");
    }

    llmContextUiHierarchyCheckbox = document.getElementById(
      "llm-context-ui-hierarchy",
    );
    if (!llmContextUiHierarchyCheckbox)
      console.warn(
        "LLM_MOD_LOG: Optional 'llm-context-ui-hierarchy' not found.",
      );
    llmContextSelectedElementCheckbox = document.getElementById(
      "llm-context-selected-element",
    );
    if (!llmContextSelectedElementCheckbox)
      console.warn(
        "LLM_MOD_LOG: Optional 'llm-context-selected-element' not found.",
      );
    llmContextPythonConsoleOutputCheckbox = document.getElementById(
      "llm-context-python-console-output",
    );
    if (!llmContextPythonConsoleOutputCheckbox)
      console.warn(
        "LLM_MOD_LOG: Optional 'llm-context-python-console-output' not found.",
      );
    llmContextPythonConsoleOutputLinesSelect = document.getElementById(
      "llm-context-python-console-output-lines",
    );
    if (!llmContextPythonConsoleOutputLinesSelect)
      console.warn(
        "LLM_MOD_LOG: Optional 'llm-context-python-console-output-lines' not found.",
      );
    llmContextPythonCodeCheckbox = document.getElementById(
      "llm-context-python-code",
    );
    if (!llmContextPythonCodeCheckbox)
      console.warn(
        "LLM_MOD_LOG: Optional 'llm-context-python-code' not found.",
      );
    llmContextDeviceInfoCheckbox = document.getElementById(
      "llm-context-device-info",
    );
    if (!llmContextDeviceInfoCheckbox)
      console.warn(
        "LLM_MOD_LOG: Optional 'llm-context-device-info' not found.",
      );

    if (!allCriticalFound) {
      console.error(
        "LLM_MOD_LOG: At least one CRITICAL LLM chat UI element was NOT found!",
      );
      dependencies.updateMessage(
        "LLM Chat UI failed to load critical elements.",
        "error",
        0,
      );
      return false;
    }
    console.log(
      "LLM_MOD_LOG: _fetchLlmDomElements() finished. All critical elements reported found.",
    );
    return true;
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
        "LLM_MOD_LOG: _addMessageToChatHistory - llmChatHistoryEl is null!",
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
            console.error("LLM_MOD_LOG: Failed to copy code:", err);
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
    _addCodeActionButtonsToMessage(messageDiv);
  }

  function _clearLlmChat() {
    console.log("LLM_MOD_LOG: _clearLlmChat() called.");
    if (llmChatHistoryEl) llmChatHistoryEl.innerHTML = "";
    llmConversationHistory = [];
    _addMessageToChatHistory(
      "Chat cleared. How can I help you next?",
      "assistant",
    );
    dependencies.updateMessage("Chat conversation cleared.", "info");
    console.log("LLM_MOD_LOG: _clearLlmChat() finished.");
  }

  async function _handleSendLlmPrompt() {
    console.log(
      "LLM_MOD_LOG: _handleSendLlmPrompt() CALLED. This is the click handler.",
    );
    if (!llmPromptInputEl || !llmSendPromptBtn) {
      console.error(
        "LLM_MOD_LOG: _handleSendLlmPrompt - Critical UI elements missing.",
      );
      return;
    }

    const promptText = llmPromptInputEl.value.trim();
    console.log(
      "LLM_MOD_LOG: _handleSendLlmPrompt - Prompt text from input: '",
      promptText + "'",
    );
    if (!promptText) {
      dependencies.updateMessage(
        "Please enter a message for the assistant.",
        "warning",
        2000,
      );
      console.warn(
        "LLM_MOD_LOG: _handleSendLlmPrompt - Prompt text is empty. Aborting.",
      );
      return;
    }

    _addMessageToChatHistory(promptText, "user");
    llmConversationHistory.push({ role: "user", content: promptText });

    llmPromptInputEl.value = "";
    llmPromptInputEl.style.height = "auto";
    llmPromptInputEl.disabled = true;
    llmSendPromptBtn.disabled = true;

    const context = _getSelectedLlmContext(); // This function now has more logging
    console.log(
      "LLM_MOD_LOG: _handleSendLlmPrompt - Context data for payload:",
      JSON.stringify(context).substring(0, 500) + "...",
    );
    const payload = {
      prompt: promptText,
      context: context,
      history: llmConversationHistory.slice(-7, -1),
    };
    console.log(
      "LLM_MOD_LOG: _handleSendLlmPrompt - Payload for API:",
      JSON.stringify(payload),
    );

    const assistantMessageDiv = _addMessageToChatHistory(
      "<i>Assistant is thinking...</i>",
      "assistant",
      true,
      true,
    );
    let accumulatedResponse = "";

    console.log(
      "LLM_MOD_LOG: _handleSendLlmPrompt - Attempting fetch to /api/llm/chat",
    );
    try {
      const response = await fetch("/api/llm/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(payload),
      });
      console.log(
        "LLM_MOD_LOG: _handleSendLlmPrompt - Fetch response status:",
        response.status,
      );

      if (!response.ok) {
        let errorDetail = `HTTP error ${response.status}: ${response.statusText}`;
        try {
          const errorJson = await response.json();
          errorDetail = errorJson.detail || errorJson.error || errorDetail;
        } catch (e) {
          /* ignore */
        }
        console.error(
          "LLM_MOD_LOG: _handleSendLlmPrompt - Fetch not OK:",
          errorDetail,
        );
        throw new Error(errorDetail);
      }
      if (!response.body) {
        console.error(
          "LLM_MOD_LOG: _handleSendLlmPrompt - Response body is null.",
        );
        throw new Error("Response body is null, cannot read stream.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamShouldEnd = false;

      console.log(
        "LLM_MOD_LOG: _handleSendLlmPrompt - Starting to read stream.",
      );
      if (assistantMessageDiv) {
        assistantMessageDiv.dataset.rawContent = "";
        assistantMessageDiv.innerHTML = "";
      }

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          console.log(
            "LLM_MOD_LOG: _handleSendLlmPrompt - Stream reader 'done'.",
          );
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
            if (line.startsWith("event:")) {
              currentEventType = line.substring("event:".length).trim();
            } else if (line.startsWith("data:")) {
              dataContent = line.substring("data:".length).trim();
            }
          });

          if (dataContent) {
            try {
              const parsedData = JSON.parse(dataContent);
              if (currentEventType === "error") {
                console.error(
                  "LLM_MOD_LOG: SSE Event 'error':",
                  parsedData.error,
                );
                const errorChunk = `\n[Stream Error: ${dependencies.escapeHtml(parsedData.error)}]`;
                accumulatedResponse += errorChunk;
                _updateStreamedMessage(assistantMessageDiv, errorChunk);
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
                console.log(
                  "LLM_MOD_LOG: SSE Event 'end-of-stream':",
                  parsedData.message,
                );
                _updateStreamedMessage(assistantMessageDiv, "", true);
                streamShouldEnd = true;
                break;
              }
            } catch (e) {
              console.error(
                "LLM_MOD_LOG: Error parsing JSON from stream data:",
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
        if (streamShouldEnd) {
          console.log("LLM_MOD_LOG: Breaking outer stream read loop.");
          break;
        }
      }

      console.log(
        "LLM_MOD_LOG: _handleSendLlmPrompt - Finished reading stream.",
      );
      llmConversationHistory.push({
        role: "assistant",
        content: accumulatedResponse,
      });
    } catch (error) {
      console.error(
        "LLM_MOD_LOG: _handleSendLlmPrompt - Error during fetch/stream processing:",
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
        content: `Error: ${error.message}`,
      });
    } finally {
      console.log(
        "LLM_MOD_LOG: _handleSendLlmPrompt - Finally block executing.",
      );
      if (llmPromptInputEl) llmPromptInputEl.disabled = false;
      if (llmSendPromptBtn) llmSendPromptBtn.disabled = false;
      if (llmPromptInputEl) llmPromptInputEl.focus();
      console.log(
        "LLM_MOD_LOG: _handleSendLlmPrompt - UI elements re-enabled.",
      );
    }
    console.log("LLM_MOD_LOG: _handleSendLlmPrompt() finished.");
  }

  function _getSelectedLlmContext() {
    console.log("LLM_MOD_LOG: _getSelectedLlmContext() called.");
    const context = {};
    const appVars = dependencies.getAppVariables();
    if (!appVars) {
      console.error(
        "LLM_MOD_LOG: getAppVariables dependency is not available or returned null/undefined.",
      );
      return context;
    }

    const noDeviceContextNeeded = !(
      llmContextUiHierarchyCheckbox?.checked ||
      llmContextSelectedElementCheckbox?.checked ||
      llmContextDeviceInfoCheckbox?.checked
    );
    if (!appVars.currentDeviceSerial && !noDeviceContextNeeded) {
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

    // --- Enhanced logging for Python Console Output ---
    if (llmContextPythonConsoleOutputCheckbox?.checked) {
      if (
        dependencies.PythonConsoleManager &&
        typeof dependencies.PythonConsoleManager.getOutput === "function"
      ) {
        const outputLinesCount =
          llmContextPythonConsoleOutputLinesSelect?.value;
        const fullOutput = dependencies.PythonConsoleManager.getOutput();
        console.log(
          "LLM_MOD_LOG: PythonConsoleManager.getOutput() returned:",
          fullOutput
            ? `"${fullOutput.substring(0, 200)}..."`
            : "''(empty) or null",
        );

        if (fullOutput) {
          if (outputLinesCount === "all") {
            context.pythonConsoleOutput = fullOutput;
            console.log("LLM_MOD_LOG: Python Context: Sending all output.");
          } else if (outputLinesCount === "lastError") {
            console.log(
              "LLM_MOD_LOG: Python Context: Attempting to find last error.",
            );
            const errorKeywords = [
              "Traceback (most recent call last):",
              "Error:",
              "Exception:",
            ]; // Case-sensitive
            let lastErrorIndex = -1;
            let foundKeyword = "";

            for (const keyword of errorKeywords) {
              const currentIndex = fullOutput.lastIndexOf(keyword);
              if (currentIndex > lastErrorIndex) {
                // Ensure we get the truly last one if keywords overlap
                lastErrorIndex = currentIndex;
                foundKeyword = keyword;
              }
            }
            console.log(
              `LLM_MOD_LOG: Python Context 'lastError' - Found keyword: '${foundKeyword}', Index: ${lastErrorIndex}`,
            );
            if (lastErrorIndex !== -1) {
              context.pythonConsoleOutput =
                fullOutput.substring(lastErrorIndex);
              console.log(
                "LLM_MOD_LOG: Python Context 'lastError' - Extracted error text:\n---\n",
                context.pythonConsoleOutput.substring(0, 500) + "...\n---",
              );
            } else {
              context.pythonConsoleOutput =
                "# No error found in recent Python console output.";
              console.log(
                "LLM_MOD_LOG: Python Context 'lastError' - No error keywords matched.",
              );
            }
          } else {
            // "5", "10"
            const linesToGet = parseInt(outputLinesCount, 10);
            if (!isNaN(linesToGet) && linesToGet > 0) {
              const lines = fullOutput.split("\n");
              context.pythonConsoleOutput = lines.slice(-linesToGet).join("\n");
              console.log(
                `LLM_MOD_LOG: Python Context: Sending last ${linesToGet} lines.`,
              );
            } else {
              console.warn(
                `LLM_MOD_LOG: Python Context: Invalid number of lines to get: ${outputLinesCount}`,
              );
            }
          }
        } else {
          console.log(
            "LLM_MOD_LOG: Python Context: Full output from PythonConsoleManager was empty or null.",
          );
          context.pythonConsoleOutput =
            "# Python console output is currently empty.";
        }
      } else {
        console.warn(
          "LLM_MOD_LOG: PythonConsoleManager.getOutput is not available. Cannot get Python console output.",
        );
        context.pythonConsoleOutput =
          "# Python console output is unavailable (manager error).";
      }
    }
    // --- End of Python Console Output logging ---

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
    console.log("LLM_MOD_LOG: _getSelectedLlmContext completed.");
    return context;
  }

  function init(initDeps) {
    console.log(
      "LLM_MOD_LOG: LlmAssistantModule.init() called with dependencies:",
      Object.keys(initDeps),
    );
    dependencies = { ...dependencies, ...initDeps };
    if (typeof dependencies.getAppVariables !== "function") {
      console.error(
        "LLM_MOD_LOG: CRITICAL - 'getAppVariables' dependency missing in init().",
      );
      return;
    }
    if (typeof dependencies.updateMessage !== "function") {
      console.error(
        "LLM_MOD_LOG: CRITICAL - 'updateMessage' dependency missing in init().",
      );
      return;
    }

    const domElementsFetched = _fetchLlmDomElements();
    console.log(
      "LLM_MOD_LOG: LlmAssistantModule.init - _fetchLlmDomElements result:",
      domElementsFetched,
    );
    if (!domElementsFetched) {
      console.error(
        "LLM_MOD_LOG: LlmAssistantModule.init - SKIPPING event listener attachment due to missing critical DOM elements.",
      );
      return;
    }

    if (llmSendPromptBtn) {
      llmSendPromptBtn.addEventListener("click", _handleSendLlmPrompt);
      console.log(
        "LLM_MOD_LOG: LlmAssistantModule.init - Event listener ATTACHED to llm-send-prompt-btn.",
      );
    } else {
      console.error(
        "LLM_MOD_LOG: LlmAssistantModule.init - llmSendPromptBtn is NULL post-fetch. CANNOT attach click listener.",
      );
    }
    if (llmPromptInputEl) {
      llmPromptInputEl.addEventListener("keypress", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          console.log(
            "LLM_MOD_LOG: Enter pressed in prompt input, calling _handleSendLlmPrompt.",
          );
          _handleSendLlmPrompt();
        }
      });
      llmPromptInputEl.addEventListener("input", function () {
        this.style.height = "auto";
        this.style.height = Math.min(this.scrollHeight, 120) + "px";
      });
      console.log(
        "LLM_MOD_LOG: LlmAssistantModule.init - Event listeners for llmPromptInputEl (keypress, input) attached.",
      );
    } else {
      console.error(
        "LLM_MOD_LOG: LlmAssistantModule.init - llmPromptInputEl is NULL post-fetch.",
      );
    }
    if (llmClearConversationBtn) {
      llmClearConversationBtn.addEventListener("click", _clearLlmChat);
      console.log(
        "LLM_MOD_LOG: LlmAssistantModule.init - Event listener attached to llm-clear-conversation-btn.",
      );
    } else {
      console.error(
        "LLM_MOD_LOG: LlmAssistantModule.init - llmClearConversationBtn is NULL post-fetch.",
      );
    }
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
    console.log(`LLM_MOD_LOG: openPropertiesTab called for: ${tabName}`);
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

  console.log(
    "LLM_MOD_LOG: LlmAssistantModule IIFE structure defined, returning public methods.",
  );
  return {
    init: init,
    notifyNodeSelectionChanged: notifyNodeSelectionChanged,
    openPropertiesTab: openPropertiesTab,
  };
})();

console.log(
  "LLM_MOD_LOG: IIFE executed. Checking window.LlmAssistantModule:",
  window.LlmAssistantModule,
);
if (
  window.LlmAssistantModule &&
  typeof window.LlmAssistantModule.openPropertiesTab === "function"
) {
  window.openPropertiesTab = window.LlmAssistantModule.openPropertiesTab;
  console.log(
    "LLM_MOD_LOG: window.openPropertiesTab function has been successfully assigned from LlmAssistantModule.",
  );
} else {
  console.error(
    "LLM_MOD_LOG: CRITICAL - Failed to assign window.openPropertiesTab.",
  );
  if (!window.LlmAssistantModule)
    console.error(
      "LLM_MOD_LOG: Detail - window.LlmAssistantModule is undefined.",
    );
  else
    console.error(
      "LLM_MOD_LOG: Detail - window.LlmAssistantModule.openPropertiesTab is not a function.",
    );
}
