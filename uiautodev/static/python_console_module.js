// static/python_console_module.js

(function (global) {
  "use strict";

  console.log(
    "python_console_module.js: Script loaded and executing (Completions OFF Version).",
  );

  const PythonConsoleManager = {
    pythonCmEditor: null,
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

    // Keywords/Builtins are not strictly needed if all hinting is off
    // but kept for completeness if you toggle hints later via options.
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
      "ascii",
      "bin",
      "bool",
      "breakpoint",
      "bytearray",
      "bytes",
      "callable",
      "chr",
      "classmethod",
      "compile",
      "complex",
      "delattr",
      "dict",
      "dir",
      "divmod",
      "enumerate",
      "eval",
      "exec",
      "filter",
      "float",
      "format",
      "frozenset",
      "getattr",
      "globals",
      "hasattr",
      "hash",
      "help",
      "hex",
      "id",
      "input",
      "int",
      "isinstance",
      "issubclass",
      "iter",
      "len",
      "list",
      "locals",
      "map",
      "max",
      "memoryview",
      "min",
      "next",
      "object",
      "oct",
      "open",
      "ord",
      "pow",
      "print",
      "property",
      "range",
      "repr",
      "reversed",
      "round",
      "set",
      "setattr",
      "slice",
      "sorted",
      "staticmethod",
      "str",
      "sum",
      "super",
      "tuple",
      "type",
      "vars",
      "zip",
      "__import__",
    ],

    // The customPythonHinter function is not called if hintOptions/extraKeys are disabled.
    // It's kept here in case you want to re-enable completions later.
    customPythonHinter: async function (editor, options) {
      console.log(
        "PCM Hinter: customPythonHinter called, but completions are meant to be off in current CM config.",
      );
      // This function would contain logic to call backend and provide suggestions
      // For now, it will do nothing or return minimal local suggestions if ever called.
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
      if (pythonTextarea) {
        // Only CodeMirror core is strictly needed if hints are off.
        // show-hint.js (for CodeMirror.commands.autocomplete) is not strictly needed
        // if extraKeys for autocomplete are removed.
        if (typeof CodeMirror !== "undefined") {
          try {
            this.pythonCmEditor = CodeMirror.fromTextArea(pythonTextarea, {
              lineNumbers: true,
              mode: "python",
              keyMap: "vim",
              theme: "material-darker",
              matchBrackets: true,
              styleActiveLine: true,
              // NO extraKeys for "autocomplete"
              // NO hintOptions
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
