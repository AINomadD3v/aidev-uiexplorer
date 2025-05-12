// static/python_console_module.js
(function (global) {
  "use strict";

  // console.log("python_console_module.js: Script loaded (Pyright/LSP-style Completions Version).");

  const PythonConsoleManager = {
    pythonCmEditor: null,
    interactiveOutputElement: null,
    dependencies: {
      callBackend: function (method, endpoint, body) {
        // This specific callBackend might be for general inspector use.
        // For completions, we might use a direct fetch or a specialized version.
        // For now, let's assume a direct fetch will be used in the hinter.
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
    // Static lists can serve as an initial/fallback or be removed if backend is comprehensive
    PYTHON_KEYWORDS: [
      "and",
      "as",
      "assert",
      "async",
      "await",
      "break",
      "class",
      "continue",
      "def",
      "del",
      "elif",
      "else",
      "except",
      "False",
      "finally",
      "for",
      "from",
      "global",
      "if",
      "import",
      "in",
      "is",
      "lambda",
      "None",
      "nonlocal",
      "not",
      "or",
      "pass",
      "raise",
      "return",
      "True",
      "try",
      "while",
      "with",
      "yield",
    ],
    PYTHON_BUILTINS: [
      "abs",
      "all",
      "any",
      "print",
      "len",
      "dict",
      "list",
      "str",
      "int",
      "float",
      "range",
      "d",
      "device", // Keep common ones
    ],
    UIAUTOMATOR2_COMMON_METHODS: [
      // Useful for 'd.' if backend doesn't provide them quickly
      "click()",
      "info",
      "exists",
      "text",
      "setText()",
      "shell()",
    ],

    debounceTimeout: null,
    completionController: null, // To abort previous requests

    // Async hinter to fetch suggestions from the backend
    customPythonHinter: async function (editor, options) {
      const cur = editor.getCursor();
      const token = editor.getTokenAt(cur);
      const fullCode = editor.getValue();

      // Basic check: don't trigger on empty space or after certain non-alphanumeric chars unless it's a dot
      if (token.string.trim() === "" && token.string !== ".") {
        if (token.type !== null) return null; // Don't hint on pure whitespace tokens unless forced
      }

      // Abort any existing request
      if (this.completionController) {
        this.completionController.abort();
      }
      this.completionController = new AbortController();
      const signal = this.completionController.signal;

      // console.log(`PCM Hinter: Requesting completions for line ${cur.line}, col ${cur.ch}`);

      try {
        // Use direct fetch for more control over request, esp. AbortController
        const response = await fetch("/api/python/completions", {
          // ADJUST THIS URL AS NEEDED
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            code: fullCode,
            line: cur.line, // 0-indexed
            column: cur.ch, // 0-indexed
            // You might send filename or document URI if your LSP setup needs it
            // documentUri: "file:///virtual/script.py"
          }),
          signal: signal, // Pass the abort signal
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
          // Pyright/LSP might return a range or expect client to figure it out.
          // For simplicity, we'll use the token range or cursor if after a dot.
          let from = CodeMirror.Pos(cur.line, token.start);
          let to = CodeMirror.Pos(cur.line, token.end);

          // If completion is for attributes after a '.', token might be just '.'
          if (token.string === "." && token.type === "operator") {
            from = CodeMirror.Pos(cur.line, token.end); // Start replacing after the dot
            to = from; // Replace nothing initially, just insert
          } else if (
            !token.string.trim() &&
            lineContent.charAt(cur.ch - 1) === "."
          ) {
            // Cursor is right after a dot, token is empty
            from = CodeMirror.Pos(cur.line, cur.ch);
            to = CodeMirror.Pos(cur.line, cur.ch);
          }

          return {
            list: suggestions.map((s) => ({
              text: s.text || s.label, // LSP uses 'label', 'insertText' or 'textEdit'
              displayText: s.displayText || s.label || s.text,
              className: `cm-hint-${s.type || "lsp"}`, // Style based on type
              // To handle complex LSP TextEdit objects, more logic is needed here.
              // For now, assuming simple text replacement.
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
            keyMap: "vim",
            theme: "material-darker",
            matchBrackets: true,
            styleActiveLine: true,
            extraKeys: {
              "Ctrl-Space": "autocomplete",
              // Optionally trigger on '.' if your backend is fast enough
              // "'.'": (cm) => { cm.showHint({completeSingle: false}); return CodeMirror.Pass; }
            },
            hintOptions: {
              hint: (editor, options) => {
                // Debounce the call to the hinter
                clearTimeout(this.debounceTimeout);
                return new Promise((resolve) => {
                  this.debounceTimeout = setTimeout(async () => {
                    const result = await this.customPythonHinter(
                      editor,
                      options,
                    );
                    resolve(result);
                  }, 250); // Debounce by 250ms, adjust as needed
                });
              },
              completeSingle: false,
              alignWithWord: true,
              closeCharacters: /[()\[\]{};:>,]/, // Characters that close the hint box
              closeOnUnfocus: true,
            },
          });
          this.pythonCmEditor.setValue(
            "# Python code here. Vim bindings. Ctrl-Space for completions.\n" +
              "# Example: d(text='Login').click()\n# d. # (try Ctrl-Space after d.)\n" +
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
    getOutput: function () {
      // Assuming you added this based on previous discussions
      return this.interactiveOutputElement
        ? this.interactiveOutputElement.textContent || ""
        : "";
    },
    refresh: function () {
      if (this.pythonCmEditor) this.pythonCmEditor.refresh();
    },
  };

  global.PythonConsoleManager = PythonConsoleManager;
  // console.log("python_console_module.js: PythonConsoleManager object defined on window.");
})(window);
