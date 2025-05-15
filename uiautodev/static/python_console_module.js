// static/python_console_module.js
(function (global) {
  "use strict";

  // console.log("python_console_module.js: Script loaded (Traceback Capture & Pyright Completions).");

  const PythonConsoleManager = {
    pythonCmEditor: null,
    interactiveOutputElement: null,
    _fullConsoleOutput: "", // To store the full historical output
    _lastCapturedTraceback: null, // To store the most recent traceback string

    dependencies: {
      callBackend: function (method, endpoint, body) {
        console.warn(
          "PCM: Generic callBackend used or called unexpectedly for completions.",
        );
        return Promise.reject(
          "Generic callBackend not suitable for LSP-like requests directly without modification.",
        );
      },
      getDeviceSerial: function () {
        return null;
      },
      updateMessage: function (text, type, duration) {
        /* console.log(`PCM_UPDATE: ${type} - ${text}`); */
      },
    },
    PYTHON_KEYWORDS: [], // Kept for potential future use or basic static fallback
    PYTHON_BUILTINS: [], // Kept for potential future use
    UIAUTOMATOR2_COMMON_METHODS: [
      "click()",
      "info",
      "exists",
      "text",
      "setText()",
      "shell()",
    ],

    debounceTimeout: null,
    completionController: null,

    // --- NEW METHOD: To be called after Python execution with the full output ---
    /**
     * Processes the full output from a Python execution, extracts the last traceback,
     * and stores it. Also appends to the full console output.
     * @param {string} outputText The combined stdout/stderr from Python execution.
     */
    processExecutionOutput: function (outputText) {
      if (typeof outputText !== "string") {
        console.warn(
          "PCM: processExecutionOutput received non-string data:",
          outputText,
        );
        return;
      }

      // Append to full historical output for the getOutput() method
      this._fullConsoleOutput += outputText + "\n";
      if (this.interactiveOutputElement) {
        // Keep the visual console updated as well
        this.interactiveOutputElement.textContent += outputText + "\n";
        this.interactiveOutputElement.scrollTop =
          this.interactiveOutputElement.scrollHeight;
      }

      // Attempt to extract the last traceback from the new outputText
      const tracebackKeywords = [
        "Traceback (most recent call last):",
        // Add other language-specific keywords if necessary, e.g., for Java exceptions if they can also appear
      ];

      let lastErrorIndex = -1;
      let foundKeyword = null;

      for (const keyword of tracebackKeywords) {
        const currentIndex = outputText.lastIndexOf(keyword);
        if (currentIndex > lastErrorIndex) {
          lastErrorIndex = currentIndex;
          foundKeyword = keyword;
        }
      }

      if (lastErrorIndex !== -1) {
        // Extract from the start of "Traceback..." to the end of the outputText chunk
        // This assumes the outputText chunk contains the full traceback if it contains the keyword.
        // More sophisticated parsing might be needed if tracebacks are split across chunks.
        let potentialTraceback = outputText.substring(lastErrorIndex);

        // Refine: Try to find the actual end of the traceback (e.g., the error message line)
        // This is a heuristic. A more robust parser would be better.
        const lines = potentialTraceback.split("\n");
        let tracebackEndLineIndex = lines.length - 1; // Default to end of chunk

        for (let i = 1; i < lines.length; i++) {
          // Start from 1, as line 0 is "Traceback..."
          // A common pattern: ErrorType: Error Message (not starting with space)
          if (
            !lines[i].startsWith(" ") &&
            lines[i].includes(":") &&
            lines[i].trim() !== ""
          ) {
            // Check if the next line is also not indented (likely new output)
            if (
              i + 1 < lines.length &&
              !lines[i + 1].startsWith(" ") &&
              lines[i + 1].trim() !== ""
            ) {
              tracebackEndLineIndex = i;
              break;
            } else if (i + 1 === lines.length) {
              // This is the last line
              tracebackEndLineIndex = i;
              break;
            }
          }
        }
        this._lastCapturedTraceback = lines
          .slice(0, tracebackEndLineIndex + 1)
          .join("\n")
          .trim();
        // console.log("PCM: Captured Traceback:\n", this._lastCapturedTraceback);
      }
      // If no "Traceback..." keyword, we don't update _lastCapturedTraceback,
      // it remains the previously captured one or null.
    },

    // --- NEW METHOD: For LlmAssistantModule to get the stored traceback ---
    getLastTraceback: function () {
      return this._lastCapturedTraceback;
    },

    // --- MODIFIED: getOutput now returns the accumulated full output ---
    getOutput: function () {
      // This method is used by LlmAssistantModule for the "general console output" context.
      // It should return the historical log.
      return this._fullConsoleOutput;
    },

    // --- EXISTING METHODS (customPythonHinter, init, getCode, setCode, refresh) ---
    customPythonHinter: async function (editor, options) {
      const cur = editor.getCursor();
      const token = editor.getTokenAt(cur);
      const fullCode = editor.getValue();
      const lineContent = editor.getLine(cur.line);

      if (token.string.trim() === "" && token.string !== ".") {
        if (
          token.type !== null &&
          token.type !== "property" &&
          token.type !== "variable"
        )
          return null;
      }

      if (this.completionController) {
        this.completionController.abort();
      }
      this.completionController = new AbortController();
      const signal = this.completionController.signal;

      try {
        const response = await fetch("/api/python/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            code: fullCode,
            line: cur.line,
            column: cur.ch,
          }),
          signal: signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(
            `PCM Hinter: Backend completion request failed: ${response.status}`,
            errorText,
          );
          return null;
        }

        const suggestions = await response.json();

        if (suggestions && suggestions.length > 0) {
          let from = CodeMirror.Pos(cur.line, token.start);
          let to = CodeMirror.Pos(cur.line, token.end);

          if (
            token.string === "." &&
            (token.type === "operator" || token.type === "property")
          ) {
            from = CodeMirror.Pos(cur.line, token.end);
            to = from;
          } else if (
            !token.string.trim() &&
            cur.ch > 0 &&
            lineContent.charAt(cur.ch - 1) === "."
          ) {
            from = CodeMirror.Pos(cur.line, cur.ch);
            to = CodeMirror.Pos(cur.line, cur.ch);
          }

          return {
            list: suggestions.map((s) => ({
              text: s.text || s.label,
              displayText: s.displayText || s.label || s.text,
              className: `cm-hint-${s.type || "lsp"}`,
              // Add a 'hint' function to handle insertion if needed, esp. for function snippets
              hint: function (cm, data, completion) {
                if (
                  completion.text.includes("(") &&
                  !completion.text.endsWith(")")
                ) {
                  // If it's a function call, place cursor inside parentheses
                  cm.replaceRange(
                    completion.text,
                    completion.from || data.from,
                    completion.to || data.to,
                  );
                  const cursorPos = cm.getCursor();
                  const openParenIndex = completion.text.lastIndexOf("(");
                  if (openParenIndex !== -1) {
                    cm.setCursor(
                      CodeMirror.Pos(
                        cursorPos.line,
                        (completion.from || data.from).ch + openParenIndex + 1,
                      ),
                    );
                  }
                } else {
                  cm.replaceRange(
                    completion.text,
                    completion.from || data.from,
                    completion.to || data.to,
                  );
                }
              },
            })),
            from: from,
            to: to,
          };
        }
      } catch (error) {
        if (error.name === "AbortError") {
          // console.log('PCM Hinter: Completion request aborted.');
        } else {
          console.error("PCM Hinter: Error fetching completions:", error);
        }
        return null;
      }
      return null;
    },

    init: function (textareaId, deps) {
      this.dependencies = { ...this.dependencies, ...deps };
      const pythonTextarea = document.getElementById(textareaId);
      this.interactiveOutputElement = document.getElementById(
        "interactive-python-output",
      );
      this._fullConsoleOutput = ""; // Initialize full output
      this._lastCapturedTraceback = null; // Initialize last traceback

      if (!this.interactiveOutputElement) {
        console.error(
          "PCM: CRITICAL - Output element '#interactive-python-output' not found!",
        );
      }

      if (pythonTextarea && typeof CodeMirror !== "undefined") {
        try {
          this.pythonCmEditor = CodeMirror.fromTextArea(pythonTextarea, {
            lineNumbers: true,
            mode: "python",
            keyMap: "vim", // Assuming you want to keep VIM mode
            theme: "material-darker",
            matchBrackets: true,
            styleActiveLine: true,
            extraKeys: {
              "Ctrl-Space": "autocomplete",
              "'.'": (cm) => {
                // Auto-trigger on dot
                setTimeout(() => {
                  cm.execCommand("autocomplete");
                }, 50); // Slight delay
                return CodeMirror.Pass; // Important to allow the dot to be inserted
              },
              "Shift-Ctrl-Space": (cm) => {
                // Example for parameter hints if supported by backend
                // This would require a different backend endpoint or request type
                console.log(
                  "PCM: Parameter hint request (not implemented in this example)",
                );
              },
            },
            hintOptions: {
              hint: (editor, options) => {
                clearTimeout(this.debounceTimeout);
                return new Promise((resolve) => {
                  this.debounceTimeout = setTimeout(async () => {
                    const result = await this.customPythonHinter(
                      editor,
                      options,
                    );
                    resolve(result);
                  }, 200); // Slightly faster debounce
                });
              },
              completeSingle: false,
              alignWithWord: true,
              closeCharacters: /[()\[\]{};:>, ]/, // Close on space too
              closeOnUnfocus: true,
            },
          });
          this.pythonCmEditor.setValue(
            "# Python code here. Vim bindings. Ctrl-Space or '.' for completions.\n" +
              "# Example: d(text='Login').click()\n# d. # (try typing 'd.')\n" +
              "print(d.info)\n",
          );
          console.log(
            "PythonConsoleManager: CodeMirror 5 editor initialized (Backend Completions Configured).",
          );
        } catch (e) {
          console.error("PCM: Failed to initialize CodeMirror 5:", e);
          if (pythonTextarea)
            pythonTextarea.value =
              "Error initializing CodeMirror. Check console.";
          if (this.dependencies.updateMessage)
            this.dependencies.updateMessage(
              "Failed to init Python editor.",
              "error",
            );
        }
      } else {
        console.error(
          `PCM: Textarea '${textareaId}' or CodeMirror lib not found.`,
        );
      }
    },

    getCode: function () {
      return this.pythonCmEditor ? this.pythonCmEditor.getValue() : "";
    },
    setCode: function (code) {
      if (this.pythonCmEditor) this.pythonCmEditor.setValue(code);
      else console.warn("PCM: Editor not initialized, cannot set code.");
    },

    refresh: function () {
      if (this.pythonCmEditor) this.pythonCmEditor.refresh();
    },

    // Method to clear all console output (visual and stored)
    clearOutput: function () {
      if (this.interactiveOutputElement) {
        this.interactiveOutputElement.textContent = "";
      }
      this._fullConsoleOutput = "";
      this._lastCapturedTraceback = null; // Also clear the last captured error
      // console.log("PCM: Console output and last error cleared.");
    },
  };

  global.PythonConsoleManager = PythonConsoleManager;
  // console.log("python_console_module.js: PythonConsoleManager object defined on window.");
})(window);
