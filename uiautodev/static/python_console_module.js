// static/python_console_module.js
// Manages the CodeMirror 5 instance for the Python console

(function (global) {
  "use strict";

  console.log("python_console_module.js: Script loaded and executing.");

  let pythonCmEditor = null;
  let dependencies = {
    callBackend: function () {
      console.error("PythonConsoleManager: callBackend not initialized!");
      return Promise.reject("callBackend not set");
    },
    getDeviceSerial: function () {
      console.warn("PythonConsoleManager: getDeviceSerial not initialized!");
      return null;
    },
    updateMessage: function (text, type) {
      console.log(
        `PythonConsoleManager (updateMessage not set): ${type} - ${text}`,
      );
    },
  };

  const PYTHON_KEYWORDS = [
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
  ];
  const PYTHON_BUILTINS = [
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
  ];

  async function customPythonHinter(editor, options) {
    const cur = editor.getCursor();
    const token = editor.getTokenAt(cur);
    const lineContent = editor.getLine(cur.line);

    let wordStart = token.start;
    let wordEnd = cur.ch;
    let currentWord = ""; // Word being typed by the user for completion

    // Heuristic to determine the actual word/prefix being typed
    // If token is a property or variable, use it. Otherwise, we might be after a dot.
    if (
      (token.type === "property" ||
        token.type === "variable" ||
        token.type === "variable-2") &&
      token.string.length > 0
    ) {
      currentWord = token.string;
      wordStart = token.start;
    } else if (
      token.string === "." ||
      token.type === null ||
      token.type === undefined
    ) {
      // Often happens after a dot or at start of new word
      let tempStart = cur.ch;
      while (tempStart > 0 && /[\w$]/.test(lineContent.charAt(tempStart - 1))) {
        tempStart--;
      }
      currentWord = lineContent.slice(tempStart, cur.ch);
      wordStart = tempStart;
    }

    let contextIdentifier = ""; // e.g., "d" if we're typing "d.something"
    let prefixForBackend = currentWord; // What we send to the backend

    // Check if we are completing an attribute of an object (e.g., "d.")
    if (wordStart > 0 && lineContent.charAt(wordStart - 1) === ".") {
      let objNameStart = wordStart - 2; // Start before the dot
      while (
        objNameStart >= 0 &&
        /[\w$]/.test(lineContent.charAt(objNameStart))
      ) {
        objNameStart--;
      }
      objNameStart++; // Move to the beginning of the identifier
      contextIdentifier = lineContent.slice(objNameStart, wordStart - 1);
      if (contextIdentifier === "d") {
        prefixForBackend = `d.${currentWord}`;
      } else {
        // Could be another object, let backend Jedi handle if possible
        prefixForBackend = `${contextIdentifier}.${currentWord}`;
      }
    }

    console.log(
      `Hinter: currentWord='${currentWord}', context='${contextIdentifier}', prefixForBackend='${prefixForBackend}', fromCh=${wordStart}, toCh=${wordEnd}`,
    );

    let suggestions = [];
    const currentDeviceSerial = dependencies.getDeviceSerial
      ? dependencies.getDeviceSerial()
      : null;

    if (currentDeviceSerial && dependencies.callBackend) {
      try {
        if (dependencies.updateMessage)
          dependencies.updateMessage("Fetching completions...", "info");
        const backendResult = await dependencies.callBackend(
          "POST",
          `/api/android/${currentDeviceSerial}/python_completions`,
          {
            code: editor.getValue(),
            line: cur.line + 1,
            column: cur.ch,
            prefix: prefixForBackend,
          },
        );

        if (backendResult && Array.isArray(backendResult.completions)) {
          suggestions = backendResult.completions.map((comp) =>
            typeof comp === "string" ? { text: comp, displayText: comp } : comp,
          );
          console.log("Backend completions:", suggestions);
        } else {
          console.warn(
            "Backend completions format unexpected or empty:",
            backendResult,
          );
        }
      } catch (error) {
        console.error("Error fetching backend completions:", error);
        if (dependencies.updateMessage)
          dependencies.updateMessage("Error fetching completions.", "error");
      }
    }

    // If backend provided no suggestions, or backend call failed/not applicable, try local fallbacks
    if (suggestions.length === 0) {
      const lowerCurrentWord = currentWord.toLowerCase();
      if (lowerCurrentWord.length > 0) {
        // Only provide local suggestions if there's a prefix
        const allLocalPythonWords = PYTHON_KEYWORDS.concat(PYTHON_BUILTINS);
        let localSuggestions = allLocalPythonWords.filter((kw) =>
          kw.toLowerCase().startsWith(lowerCurrentWord),
        );

        if (
          localSuggestions.length === 0 &&
          typeof CodeMirror.hint !== "undefined" &&
          CodeMirror.hint.anyword
        ) {
          console.log("Trying CodeMirror.hint.anyword as fallback");
          const anywordHints = CodeMirror.hint.anyword(editor, {
            word: /[\w$]+/,
          }); // Ensure it matches words
          if (anywordHints && anywordHints.list) {
            // anyword already filters by the current word based on the regex
            localSuggestions = anywordHints.list;
          }
        }
        suggestions = localSuggestions.map((s) =>
          typeof s === "string" ? { text: s, displayText: s } : s,
        );
      }
    }

    if (suggestions.length > 0) {
      return {
        list: suggestions,
        from: CodeMirror.Pos(cur.line, wordStart),
        to: CodeMirror.Pos(cur.line, wordEnd),
      };
    }
    return null;
  }

  global.PythonConsoleManager = {
    init: function (textareaId, deps) {
      console.log(
        "PythonConsoleManager: Initializing editor for textarea ID:",
        textareaId,
      );
      if (deps.callBackend) dependencies.callBackend = deps.callBackend;
      else
        console.error(
          "PythonConsoleManager: 'callBackend' dependency not provided!",
        );
      if (deps.getDeviceSerial)
        dependencies.getDeviceSerial = deps.getDeviceSerial;
      else
        console.error(
          "PythonConsoleManager: 'getDeviceSerial' dependency not provided!",
        );
      if (deps.updateMessage) dependencies.updateMessage = deps.updateMessage;
      else
        console.warn(
          "PythonConsoleManager: 'updateMessage' dependency not provided, console logs will be used.",
        );

      const pythonTextarea = document.getElementById(textareaId);
      if (pythonTextarea) {
        if (
          typeof CodeMirror !== "undefined" &&
          CodeMirror.commands &&
          typeof CodeMirror.commands.autocomplete !== "undefined"
        ) {
          try {
            pythonCmEditor = CodeMirror.fromTextArea(pythonTextarea, {
              lineNumbers: true,
              mode: "python",
              keyMap: "vim",
              theme: "material-darker",
              matchBrackets: true,
              styleActiveLine: true,
              extraKeys: {
                "Ctrl-Space": "autocomplete",
                "'.'": function (cm) {
                  setTimeout(function () {
                    if (cm.state.completionActive) {
                      /* cm.state.completionActive.close(); */
                    }
                    cm.showHint({
                      hint: customPythonHinter,
                      completeSingle: false,
                      alignWithWord: true,
                    });
                  }, 50);
                  return CodeMirror.Pass;
                },
              },
              hintOptions: {
                hint: customPythonHinter,
                completeSingle: false,
                alignWithWord: true,
              },
            });
            pythonCmEditor.setValue(
              "# Python code here\n# Ctrl-Space for completions\n# Type 'd.' for device object completions\n\nprint(d.info)\n",
            );
            console.log(
              "PythonConsoleManager: CodeMirror 5 editor initialized successfully.",
            );
          } catch (e) {
            console.error(
              "PythonConsoleManager: Failed to initialize CodeMirror 5:",
              e,
            );
            if (pythonTextarea)
              pythonTextarea.value =
                "Error initializing Python code editor (CM). Check console.";
            if (dependencies.updateMessage)
              dependencies.updateMessage(
                "Failed to initialize Python editor (CM).",
                "error",
              );
          }
        } else {
          console.error(
            "PythonConsoleManager: CodeMirror 5 library or show-hint addon not loaded properly!",
          );
          if (dependencies.updateMessage)
            dependencies.updateMessage(
              "CM5 library/show-hint addon failed. Completions unavailable.",
              "error",
            );
          if (pythonTextarea)
            pythonTextarea.value =
              "CodeMirror library/addons (hint) failed to load.";
        }
      } else {
        console.error(
          `PythonConsoleManager: Textarea with ID '${textareaId}' not found!`,
        );
        if (dependencies.updateMessage)
          dependencies.updateMessage(
            "Python editor UI element missing.",
            "error",
          );
      }
    },
    getCode: function () {
      if (pythonCmEditor) {
        return pythonCmEditor.getValue();
      }
      console.warn(
        "PythonConsoleManager: Editor not initialized, cannot get code.",
      );
      return "";
    },
    setCode: function (code) {
      if (pythonCmEditor) {
        pythonCmEditor.setValue(code);
      } else {
        console.warn(
          "PythonConsoleManager: Editor not initialized, cannot set code.",
        );
      }
    },
    refresh: function () {
      if (pythonCmEditor) {
        pythonCmEditor.refresh();
        console.log("PythonConsoleManager: CodeMirror instance refreshed.");
      } else {
        console.warn(
          "PythonConsoleManager: Editor not initialized, cannot refresh.",
        );
      }
    },
  };
  console.log("PythonConsoleManager object created on window.");
})(window);
