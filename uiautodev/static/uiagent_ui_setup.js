// static/uiagent_ui_setup.js
// This file contains the UI setup scripts previously inline in demo.html

document.addEventListener("DOMContentLoaded", function () {
  console.log("uiagent_ui_setup.js: DOMContentLoaded event fired");

  const messageArea = document.getElementById("message-area");

  // Make updateMessage globally available for other modules if they don't have it passed as a dependency
  // This is useful if other modules load and try to use it before local_inspector.js initializes it via dependencies.
  if (!window.updateGlobalMessage) {
    window.updateGlobalMessage = function (
      text,
      type = "info",
      duration = 3000,
    ) {
      if (messageArea) {
        messageArea.textContent = text;
        messageArea.className = ""; // Clear previous type classes
        let messageColor = "var(--dark-text-secondary)";

        // Remove first, then add if needed to ensure correct body padding calculation
        document.body.classList.remove("message-visible");

        if (type === "error") {
          messageColor = "var(--dark-error)";
        } else if (type === "warning") {
          messageColor = "var(--dark-warning)";
        } else if (type === "success") {
          messageColor = "var(--dark-success)";
        }

        messageArea.style.color = messageColor;
        messageArea.style.display = "block";
        document.body.classList.add("message-visible"); // Add class to body for padding

        if (duration > 0) {
          setTimeout(() => {
            // Only hide if it's still the same message
            if (
              messageArea &&
              messageArea.textContent === text &&
              messageArea.style.display === "block"
            ) {
              messageArea.style.display = "none";
              document.body.classList.remove("message-visible"); // Remove class from body
            }
          }, duration);
        }
      } else {
        // Fallback if messageArea is not found (should not happen in this app)
        if (type === "error") console.error("Status Update:", text);
        else if (type === "warning") console.warn("Status Update:", text);
        else console.log("Status Update:", text);
      }
    };
  }

  // Device selection toggle
  const toggleDeviceSelectBtn = document.getElementById(
    "toggle-device-select-btn",
  );
  const deviceSelectionArea = document.getElementById(
    "device-selection-area-collapsible",
  );
  if (toggleDeviceSelectBtn && deviceSelectionArea) {
    toggleDeviceSelectBtn.addEventListener("click", function () {
      deviceSelectionArea.classList.toggle("collapsed");
    });
  } else {
    console.warn(
      "UI Setup: Toggle device select button or device selection area not found.",
    );
  }

  // Initialize default tab for Properties Panel (LLM Assistant / Element Details)
  function initializePropertiesPanelDefaultTab() {
    // This function relies on window.openPropertiesTab which is defined in llm_assistant_module.js
    // Ensure llm_assistant_module.js is loaded and window.openPropertiesTab is available.
    if (typeof window.openPropertiesTab === "function") {
      try {
        const defaultPropertiesTabButton = document.querySelector(
          "#properties-panel-tabs .tab-button.active",
        );
        if (defaultPropertiesTabButton) {
          const defaultTabNameMatch = defaultPropertiesTabButton
            .getAttribute("onclick")
            ?.match(/openPropertiesTab\(event, ['"]([^'"]+)['"]\)/);
          if (defaultTabNameMatch && defaultTabNameMatch[1]) {
            window.openPropertiesTab(
              { currentTarget: defaultPropertiesTabButton },
              defaultTabNameMatch[1],
            );
            console.log(
              "UI Setup: Default properties tab initialized to:",
              defaultTabNameMatch[1],
            );
          } else {
            console.warn(
              "UI Setup: Could not determine default tab name for properties panel from active button's onclick attribute.",
            );
          }
        } else {
          console.warn(
            "UI Setup: No active default tab button found for properties panel.",
          );
        }
      } catch (e) {
        console.error(
          "UI Setup: Error during default properties tab initialization:",
          e,
        );
      }
    } else {
      console.warn(
        "UI Setup: window.openPropertiesTab is not defined. Properties panel default tab not set. This might be a load order issue or LlmAssistantModule not loaded.",
      );
    }
  }
  // Delay slightly to ensure LlmAssistantModule might have initialized openPropertiesTab
  setTimeout(initializePropertiesPanelDefaultTab, 150);

  // Setup for Python Console Output Panel (resizer and toggle)
  function setupPythonConsoleResizer() {
    const pythonTabContent = document.getElementById("python-tab-content");
    if (!pythonTabContent) {
      console.warn("Python Console Resizer: python-tab-content not found.");
      return;
    }
    const editorArea = pythonTabContent.querySelector(".python-editor-area");
    const outputPanel = pythonTabContent.querySelector("#python-output-panel");
    const dragHandle = pythonTabContent.querySelector(
      "#python-output-drag-handle",
    );
    const toggleButton = pythonTabContent.querySelector(
      "#toggle-python-output-btn",
    );

    if (!editorArea || !outputPanel || !dragHandle || !toggleButton) {
      console.error(
        "Python console UI elements for resizing/toggling not all found. Aborting resizer setup.",
      );
      return;
    }

    let isOutputPanelOpen = false; // Default to closed
    const defaultOpenHeight = 150; // Default height when opened by toggle
    const collapsedHeight = 0;
    let currentPanelHeight = defaultOpenHeight;

    function applyPanelState(shouldBeOpen, newHeight) {
      if (shouldBeOpen) {
        outputPanel.classList.add("open");
        let targetHeight =
          newHeight !== undefined ? newHeight : currentPanelHeight;
        outputPanel.style.height = `${Math.max(parseInt(getComputedStyle(outputPanel).minHeight) || 60, targetHeight)}px`;
        toggleButton.textContent = "Hide Output";
      } else {
        if (
          outputPanel.classList.contains("open") &&
          parseInt(outputPanel.style.height) >
            (parseInt(getComputedStyle(outputPanel).minHeight) || 60)
        ) {
          localStorage.setItem(
            "pythonOutputPanelHeight",
            outputPanel.style.height,
          );
        }
        outputPanel.classList.remove("open");
        outputPanel.style.height = `${collapsedHeight}px`;
        toggleButton.textContent = "Show Output";
      }

      if (
        window.PythonConsoleManager &&
        typeof window.PythonConsoleManager.refresh === "function"
      ) {
        setTimeout(() => {
          if (pythonTabContent.classList.contains("active")) {
            window.PythonConsoleManager.refresh();
          }
        }, 50);
      }
    }

    const storedHeightStr = localStorage.getItem("pythonOutputPanelHeight");
    if (storedHeightStr) {
      currentPanelHeight = parseInt(storedHeightStr, 10);
    }
    const storedOpenState = localStorage.getItem("pythonOutputPanelOpen");
    isOutputPanelOpen = storedOpenState === "true"; // Default to false if not found or invalid

    applyPanelState(isOutputPanelOpen, currentPanelHeight); // Apply initial state

    toggleButton.addEventListener("click", () => {
      isOutputPanelOpen = !isOutputPanelOpen;
      if (isOutputPanelOpen) {
        const heightToRestore = localStorage.getItem("pythonOutputPanelHeight");
        currentPanelHeight = heightToRestore
          ? parseInt(heightToRestore, 10)
          : defaultOpenHeight;
        applyPanelState(true, currentPanelHeight);
      } else {
        applyPanelState(false);
      }
      localStorage.setItem(
        "pythonOutputPanelOpen",
        isOutputPanelOpen.toString(),
      );
    });

    let startY_drag, initialDragHeight_drag;
    let isDragging_drag = false;

    dragHandle.addEventListener("mousedown", function (e) {
      if (!isOutputPanelOpen) return;
      e.preventDefault();
      isDragging_drag = true;
      startY_drag = e.clientY;
      initialDragHeight_drag = outputPanel.offsetHeight;
      document.body.classList.add("dragging-ns");
    });

    document.addEventListener("mousemove", function (e) {
      if (!isDragging_drag || !isOutputPanelOpen) return;
      const deltaY = startY_drag - e.clientY;
      let newHeight = initialDragHeight_drag + deltaY;
      const minHeight = parseInt(getComputedStyle(outputPanel).minHeight) || 60;
      const maxAllowedHeight =
        editorArea.clientHeight -
        (parseInt(getComputedStyle(dragHandle).height) || 12) -
        20;

      newHeight = Math.max(minHeight, Math.min(newHeight, maxAllowedHeight));
      outputPanel.style.height = `${newHeight}px`;
      currentPanelHeight = newHeight;

      if (
        window.PythonConsoleManager?.refresh &&
        pythonTabContent.classList.contains("active")
      ) {
        window.PythonConsoleManager.refresh();
      }
    });

    document.addEventListener("mouseup", function () {
      if (isDragging_drag) {
        isDragging_drag = false;
        document.body.classList.remove("dragging-ns");
        if (isOutputPanelOpen) {
          localStorage.setItem(
            "pythonOutputPanelHeight",
            outputPanel.offsetHeight.toString(),
          );
        }
        if (
          window.PythonConsoleManager?.refresh &&
          pythonTabContent.classList.contains("active")
        ) {
          window.PythonConsoleManager.refresh();
        }
      }
    });
    console.log("UI Setup: Python console resizer initialized.");
  }
  setupPythonConsoleResizer();

  // Setup for LLM Context Panel Toggle
  function setupAttachContextToggleNew() {
    const contextToggleButton = document.getElementById(
      "attach-context-toggle-btn",
    );
    const contextPanelUpwards = document.getElementById("attach-context-panel");
    const contextToggleIcon = contextToggleButton
      ? contextToggleButton.querySelector(".llm-context-toggle-icon")
      : null;

    if (contextToggleButton && contextPanelUpwards && contextToggleIcon) {
      // Initial state based on HTML class
      if (contextPanelUpwards.classList.contains("collapsed")) {
        contextToggleButton.classList.remove("open");
        contextToggleIcon.textContent = "▼";
      } else {
        contextToggleButton.classList.add("open");
        contextToggleIcon.textContent = "▲";
      }

      contextToggleButton.addEventListener("click", (event) => {
        event.stopPropagation();
        const isCurrentlyCollapsed =
          contextPanelUpwards.classList.contains("collapsed");
        contextPanelUpwards.classList.toggle("collapsed");
        contextToggleButton.classList.toggle("open", isCurrentlyCollapsed);
        contextToggleIcon.textContent = isCurrentlyCollapsed ? "▲" : "▼";
      });

      document.addEventListener("click", function (event) {
        if (!contextPanelUpwards.classList.contains("collapsed")) {
          const isClickInsidePanel = contextPanelUpwards.contains(event.target);
          const isClickOnToggleButton = contextToggleButton.contains(
            event.target,
          );
          if (!isClickInsidePanel && !isClickOnToggleButton) {
            contextPanelUpwards.classList.add("collapsed");
            contextToggleButton.classList.remove("open");
            contextToggleIcon.textContent = "▼";
          }
        }
      });
      console.log("UI Setup: LLM attach context toggle initialized.");
    } else {
      console.warn("UI Setup: LLM Attach Context toggle elements not found.");
    }
  }
  setupAttachContextToggleNew();

  console.log(
    "uiagent_ui_setup.js: All DOMContentLoaded setup functions called.",
  );
});
