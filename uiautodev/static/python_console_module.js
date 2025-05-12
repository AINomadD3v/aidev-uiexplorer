// static/python_console_module.js

(function (global) {
  "use strict";

  console.log(
    "python_console_module.js: Script loaded and executing (Completions OFF Version).",
  );

  const PythonConsoleManager = {
    pythonCmEditor: null,
    interactiveOutputElement: null, // ADDED: To store the output div
    dependencies: {
      callBackend: function (m, e, b) {
        console.error("PCM: callBackend not initialized!");
        return Promise.reject("callBackend not set");
      },
      getDeviceSerial: function () {
        console.warn("PCM: getDeviceSerial not initialized!");
        return null;
      },
      updateMessage: function (text, type) {
        console.log(`PCM (updateMessage N/A): ${type} - ${text}`);
      },
    },

    PYTHON_KEYWORDS: [
      /* ... your keywords ... */
    ],
    PYTHON_BUILTINS: [
      /* ... your builtins ... */
    ],

    customPythonHinter: async function (editor, options) {
      // console.log("PCM Hinter: customPythonHinter called, completions are OFF.");
      const cur = editor.getCursor();
      const token = editor.getTokenAt(cur);
      const wordStart = token.start;
      const wordEnd = cur.ch;
      const currentWord = token.string.toLowerCase();
      let suggestions = [];
      if (currentWord.length > 0) {
        const allLocalPythonWords = this.PYTHON_KEYWORDS.concat(
          this.PYTHON_BUILTINS,
        );
        suggestions = allLocalPythonWords
          .filter((kw) => kw.toLowerCase().startsWith(currentWord))
          .map((s) => ({ text: s, displayText: s }));
      }
      if (suggestions.length > 0) {
        return {
          list: suggestions,
          from: CodeMirror.Pos(cur.line, wordStart),
          to: CodeMirror.Pos(cur.line, wordEnd),
        };
      }
      return null;
    },

    init: function (textareaId, deps) {
      console.log(
        "PythonConsoleManager: Initializing editor for textarea ID:",
        textareaId,
        "(Completions Explicitly OFF)",
      );
      this.dependencies = { ...this.dependencies, ...deps };

      const pythonTextarea = document.getElementById(textareaId);
      // Get the output element as well
      this.interactiveOutputElement = document.getElementById(
        "interactive-python-output",
      );
      if (!this.interactiveOutputElement) {
        console.error(
          "PythonConsoleManager: CRITICAL - Output element '#interactive-python-output' not found!",
        );
        // Optionally call updateMessage if available and critical
        // if (this.dependencies.updateMessage) {
        // this.dependencies.updateMessage("Python console output area not found.", "error");
        // }
      }

      if (pythonTextarea) {
        if (typeof CodeMirror !== "undefined") {
          try {
            this.pythonCmEditor = CodeMirror.fromTextArea(pythonTextarea, {
              lineNumbers: true,
              mode: "python",
              keyMap: "vim",
              theme: "material-darker",
              matchBrackets: true,
              styleActiveLine: true,
            });
            this.pythonCmEditor.setValue(
              "# Python code here\n# Vim bindings enabled.\n# Autocompletions are OFF.\n\nprint(d.info)\n",
            );
            console.log(
              "PythonConsoleManager: CodeMirror 5 editor initialized (Completions OFF).",
            );
          } catch (e) {
            console.error(
              "PythonConsoleManager: Failed to initialize CodeMirror 5:",
              e,
            );
            if (pythonTextarea)
              pythonTextarea.value =
                "Error initializing Python code editor (PCM). Check console.";
            if (this.dependencies.updateMessage)
              this.dependencies.updateMessage(
                "Failed to initialize Python editor (PCM).",
                "error",
              );
          }
        } else {
          console.error(
            "PythonConsoleManager: CodeMirror 5 library not loaded properly!",
          );
          if (this.dependencies.updateMessage)
            this.dependencies.updateMessage(
              "CM5 library failed. Python editor unavailable.",
              "error",
            );
          if (pythonTextarea)
            pythonTextarea.value = "CodeMirror library failed to load.";
        }
      } else {
        console.error(
          `PythonConsoleManager: Textarea with ID '${textareaId}' not found!`,
        );
        if (this.dependencies.updateMessage)
          this.dependencies.updateMessage(
            "Python editor UI element missing.",
            "error",
          );
      }
    },

    getCode: function () {
      if (this.pythonCmEditor) {
        return this.pythonCmEditor.getValue();
      }
      console.warn(
        "PythonConsoleManager: Editor not initialized, cannot get code.",
      );
      return "";
    },

    setCode: function (code) {
      if (this.pythonCmEditor) {
        this.pythonCmEditor.setValue(code);
      } else {
        console.warn(
          "PythonConsoleManager: Editor not initialized, cannot set code.",
        );
      }
    },

    // **** ADDED getOutput METHOD ****
    getOutput: function () {
      if (this.interactiveOutputElement) {
        return this.interactiveOutputElement.textContent || "";
      }
      console.warn(
        "PythonConsoleManager: interactiveOutputElement not initialized, cannot get output.",
      );
      return "";
    },
    // **** END OF ADDED METHOD ****

    refresh: function () {
      if (this.pythonCmEditor) {
        this.pythonCmEditor.refresh();
        console.log("PythonConsoleManager: CodeMirror instance refreshed.");
      } else {
        console.warn(
          "PythonConsoleManager: Editor not initialized, cannot refresh.",
        );
      }
    },
  };

  global.PythonConsoleManager = PythonConsoleManager;
  console.log(
    "python_console_module.js: PythonConsoleManager object defined on window (Completions OFF Version).",
  );
})(window);
