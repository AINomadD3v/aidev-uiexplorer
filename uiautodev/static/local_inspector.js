// static/local_inspector.js

document.addEventListener("DOMContentLoaded", function () {
  console.log("local_inspector.js: DOMContentLoaded event fired");

  // --- DOM Elements ---
  const messageArea = document.getElementById("message-area");
  const deviceSelect = document.getElementById("device-select");
  const overlayCanvas = document.getElementById("overlayCanvas");
  let overlayCtx = null;

  if (overlayCanvas) {
    overlayCtx = overlayCanvas.getContext("2d");
  } else {
    console.error(
      "CRITICAL DOMContentLoaded: overlayCanvas element NOT FOUND!",
    );
    if (messageArea)
      messageArea.innerHTML =
        "<span style='color: red;'>Error: Overlay Canvas missing.</span>";
    return;
  }
  if (!deviceSelect) {
    console.error("CRITICAL DOMContentLoaded: deviceSelect element NOT FOUND.");
    if (messageArea)
      messageArea.innerHTML =
        "<span style='color: red;'>Error: Device select missing. Essential for app.</span>";
    return;
  }

  const deviceScreenImg = document.getElementById("current-device-screen");
  const deviceScreenContainer = document.querySelector(
    ".device-screen-container",
  );
  const hierarchyTreeViewEl = document.getElementById("hierarchy-tree-view");
  const elementPropertiesViewEl = document.getElementById(
    "element-properties-view",
  );
  const generatedXpathEl = document.getElementById("generated-xpath");
  const hierarchySearchInput = document.getElementById(
    "hierarchy-search-input",
  );

  const llmMultiSelectToggleBtn = document.getElementById(
    "llm-multi-select-toggle-btn",
  );
  const llmMultiSelectCheckbox = document.getElementById(
    "llm-multi-select-checkbox",
  );
  const llmMultiSelectedElementsSection = document.getElementById(
    "llm-multi-selected-elements-section",
  );
  const llmMultiSelectedElementsList = document.getElementById(
    "llm-multi-selected-elements-list",
  );

  // --- State ---
  let currentDeviceSerial = null;
  let devices = [];
  let currentHierarchyData = null;
  let isHierarchyLoading = false;

  let selectedNodePath = null;
  let selectedNode = null; // Represents the primary selected node (for properties, single-select)

  let hoveredNode = null;
  let actualDeviceWidth = null;
  let actualDeviceHeight = null;
  let nodesByKey = {};
  const DEBUG_ELEMENT_FINDING = true;
  let canvasTooltip = null;

  let isMultiSelectModeActive = false;
  let multiSelectedNodes = [];

  function updateMessage(text, type = "info", duration = 4000) {
    if (messageArea) {
      messageArea.textContent = text;
      messageArea.className = "";
      let messageColor = "var(--dark-text-secondary)";

      document.body.classList.remove("message-visible"); // Remove first, then add if needed

      if (type === "error") {
        messageColor = "var(--dark-error)";
      } else if (type === "warning") {
        messageColor = "var(--dark-warning)";
      } else if (type === "success") {
        messageColor = "var(--dark-success)";
      }
      messageArea.style.color = messageColor;
      messageArea.style.display = "block";
      document.body.classList.add("message-visible");

      if (duration > 0) {
        setTimeout(() => {
          if (messageArea && messageArea.textContent === text) {
            messageArea.style.display = "none";
            document.body.classList.remove("message-visible");
          }
        }, duration);
      }
    } else {
      if (type === "error") console.error("Status:", text);
      else if (type === "warning") console.warn("Status:", text);
      else console.log("Status:", text);
    }
  }

  function createCanvasTooltip() {
    if (!document.getElementById("canvas-tooltip-id")) {
      canvasTooltip = document.createElement("div");
      canvasTooltip.id = "canvas-tooltip-id";
      Object.assign(canvasTooltip.style, {
        position: "absolute",
        display: "none",
        backgroundColor: "rgba(0,0,0,0.85)",
        color: "#f0f0f0",
        padding: "8px 10px",
        borderRadius: "5px",
        fontSize: "12px",
        fontFamily: "Menlo, Monaco, Consolas, 'Courier New', monospace",
        pointerEvents: "none",
        zIndex: "10001",
        border: "1px solid #555",
        maxWidth: "380px",
        maxHeight: "220px",
        overflowY: "auto",
        wordBreak: "break-all",
        lineHeight: "1.5",
      });
      if (deviceScreenContainer) {
        deviceScreenContainer.appendChild(canvasTooltip);
      } else {
        console.error("CRITICAL: deviceScreenContainer not found for tooltip.");
      }
    } else {
      canvasTooltip = document.getElementById("canvas-tooltip-id");
    }
  }

  async function callBackend(
    method,
    endpoint,
    body = null,
    expectBlob = false,
  ) {
    const requestOptions = {
      method: method.toUpperCase(),
      cache: "no-cache",
      headers: {},
    };
    if (body) {
      requestOptions.headers["Content-Type"] = "application/json";
      requestOptions.body = JSON.stringify(body);
    }
    try {
      const response = await fetch(endpoint, requestOptions);
      if (!response.ok) {
        let errorText = `HTTP error ${response.status}`;
        try {
          const errData = await response.json();
          errorText = `Error: ${errData.error || errData.detail || response.statusText}`;
        } catch (e) {
          /* ignore */
        }
        console.error(
          `callBackend Error (${method} ${endpoint}): ${errorText}`,
        );
        updateMessage(`API Error: ${errorText.substring(0, 100)}`, "error");
        throw new Error(errorText);
      }
      const contentType = response.headers.get("content-type");
      if (expectBlob && contentType && contentType.startsWith("image/"))
        return response.blob();
      if (contentType && contentType.includes("application/json"))
        return response.json();
      return response.text();
    } catch (error) {
      console.error(
        `callBackend Fetch Exception (${method} ${endpoint}):`,
        error.message,
      );
      updateMessage(
        `Workspace Exception: ${error.message.substring(0, 100)}`,
        "error",
      );
      throw error;
    }
  }

  function setupOverlayCanvas() {
    if (
      !deviceScreenImg ||
      !overlayCanvas ||
      !overlayCtx ||
      !deviceScreenContainer
    )
      return;
    if (deviceScreenImg.naturalWidth === 0 || !deviceScreenImg.complete) {
      if (!deviceScreenImg.dataset.onloadAttached) {
        const handler = () => {
          delete deviceScreenImg.dataset.onloadAttached;
          setupOverlayCanvas();
          deviceScreenImg.removeEventListener("load", handler);
        };
        deviceScreenImg.addEventListener("load", handler);
        deviceScreenImg.dataset.onloadAttached = "true";
      }
      return;
    }
    const containerWidth = deviceScreenContainer.clientWidth;
    const containerHeight = deviceScreenContainer.clientHeight;
    const imgNaturalWidth = deviceScreenImg.naturalWidth;
    const imgNaturalHeight = deviceScreenImg.naturalHeight;
    let displayWidth = imgNaturalWidth;
    let displayHeight = imgNaturalHeight;
    if (displayWidth === 0 || displayHeight === 0) return;
    const imgAspectRatio = imgNaturalWidth / imgNaturalHeight;
    const containerAspectRatio = containerWidth / containerHeight;
    if (imgAspectRatio > containerAspectRatio) {
      displayWidth = containerWidth;
      displayHeight = containerWidth / imgAspectRatio;
    } else {
      displayHeight = containerHeight;
      displayWidth = containerHeight * imgAspectRatio;
    }
    deviceScreenImg.style.width = `${displayWidth}px`;
    deviceScreenImg.style.height = `${displayHeight}px`;
    overlayCanvas.width = displayWidth;
    overlayCanvas.height = displayHeight;
    drawNodeOverlays();
  }

  function drawNodeOverlays() {
    if (!overlayCtx || !overlayCanvas || overlayCanvas.width === 0) return;
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (!currentHierarchyData) {
      return;
    }
    function processNode(node) {
      if (
        node &&
        node.bounds &&
        node.bounds.length === 4 &&
        node.bounds.every((b) => typeof b === "number" && !isNaN(b))
      ) {
        const [x1_rel, y1_rel, x2_rel, y2_rel] = node.bounds;
        const rectX = x1_rel * overlayCanvas.width;
        const rectY = y1_rel * overlayCanvas.height;
        const rectW = (x2_rel - x1_rel) * overlayCanvas.width;
        const rectH = (y2_rel - y1_rel) * overlayCanvas.height;
        if (rectW <= 0 || rectH <= 0) return;

        overlayCtx.beginPath();
        overlayCtx.rect(rectX, rectY, rectW, rectH);

        const isNodePrimarySelected =
          selectedNode && selectedNode.key === node.key;
        const isNodeInMultiSelectionGroup =
          isMultiSelectModeActive &&
          multiSelectedNodes.some((selNode) => selNode.key === node.key);

        if (isNodeInMultiSelectionGroup) {
          overlayCtx.strokeStyle = "rgba(255, 165, 0, 0.9)";
          overlayCtx.lineWidth = 2;
          if (isNodePrimarySelected) {
            overlayCtx.fillStyle = "rgba(255, 165, 0, 0.1)";
            overlayCtx.fill();
            overlayCtx.strokeStyle = "rgba(255, 140, 0, 0.95)";
          }
        } else if (isNodePrimarySelected) {
          overlayCtx.strokeStyle = "rgba(255, 0, 0, 0.9)";
          overlayCtx.lineWidth = 2;
        } else if (hoveredNode && hoveredNode.key === node.key) {
          overlayCtx.strokeStyle = "rgba(0,120,255,0.9)";
          overlayCtx.lineWidth = 2;
        } else {
          overlayCtx.strokeStyle = "rgba(150,150,150,0.4)";
          overlayCtx.lineWidth = 1;
        }
        overlayCtx.stroke();
      }
      if (node && node.children) node.children.forEach(processNode);
    }
    processNode(currentHierarchyData);
  }

  function updateAndShowTooltip(node, pageX, pageY) {
    if (!canvasTooltip) createCanvasTooltip();
    if (!canvasTooltip || !node || !deviceScreenContainer) {
      hideTooltip();
      return;
    }
    try {
      const name = node.name || "Unnamed";
      let rectInfo = "Rect (Device): N/A";
      if (node.rect && typeof node.rect.x === "number") {
        rectInfo = `[${node.rect.x}, ${node.rect.y}, ${node.rect.width}, ${node.rect.height}]`;
      } else if (node.bounds && actualDeviceWidth && actualDeviceHeight) {
        const devX = Math.round(node.bounds[0] * actualDeviceWidth);
        const devY = Math.round(node.bounds[1] * actualDeviceHeight);
        const devW = Math.round(
          (node.bounds[2] - node.bounds[0]) * actualDeviceWidth,
        );
        const devH = Math.round(
          (node.bounds[3] - node.bounds[1]) * actualDeviceHeight,
        );
        rectInfo = `~[${devX}, ${devY}, ${devW}, ${devH}] (Est. Device)`;
      }
      const contentDesc = node.properties?.["content-desc"] || "N/A";
      const resourceId = node.properties?.["resource-id"] || "N/A";
      const xpath = generateBasicXPath(node) || "N/A";
      canvasTooltip.innerHTML = `<div style="margin-bottom:3px; font-weight:bold; color:#92c9ff;">${escapeHtml(name)}</div><div style="margin-bottom:3px;">${escapeHtml(rectInfo)}</div><div style="margin-bottom:3px;"><span style="color:#aaa;">Desc:</span> ${escapeHtml(contentDesc)}</div><div style="margin-bottom:3px;"><span style="color:#aaa;">ID:</span> ${escapeHtml(resourceId)}</div><div><span style="color:#aaa;">XPath:</span> ${escapeHtml(xpath)}</div>`;
      const containerRect = deviceScreenContainer.getBoundingClientRect();
      let targetX = pageX - containerRect.left + 25;
      let targetY = pageY - containerRect.top + 15;
      if (
        targetX + canvasTooltip.offsetWidth >
        deviceScreenContainer.clientWidth - 10
      ) {
        targetX = pageX - containerRect.left - canvasTooltip.offsetWidth - 25;
      }
      if (targetX < 5) targetX = 5;
      if (
        targetY + canvasTooltip.offsetHeight >
        deviceScreenContainer.clientHeight - 10
      ) {
        targetY = pageY - containerRect.top - canvasTooltip.offsetHeight - 15;
      }
      if (targetY < 5) targetY = 5;
      canvasTooltip.style.left = `${Math.max(0, targetX)}px`;
      canvasTooltip.style.top = `${Math.max(0, targetY)}px`;
      canvasTooltip.style.display = "block";
    } catch (e) {
      console.error("Error in updateAndShowTooltip:", e, "for node:", node);
      hideTooltip();
    }
  }

  function hideTooltip() {
    if (canvasTooltip) canvasTooltip.style.display = "none";
  }

  function startScreenshotAutoRefresh() {
    if (currentDeviceSerial) {
      fetchAndDisplayScreenshot();
    }
  }
  function stopScreenshotAutoRefresh() {
    // Placeholder if intervals were used
  }

  async function loadDeviceList() {
    updateMessage("Loading devices...", "info");
    if (deviceSelect) deviceSelect.disabled = true;
    try {
      const data = await callBackend("GET", "/api/android/list");
      devices = Array.isArray(data) ? data : [];
      populateDeviceDropdown(devices);
      if (devices.length > 0) {
        const lastSerial = localStorage.getItem("lastSelectedDeviceSerial");
        const deviceToSelect =
          devices.find((d) => d.serial === lastSerial) || devices[0];
        if (deviceToSelect) {
          deviceSelect.value = deviceToSelect.serial;
        }
        updateMessage(
          "Select a device or check connection if list is empty.",
          "info",
        );
      } else {
        updateMessage(
          "No devices found. Ensure ADB is connected and device is authorized.",
          "warning",
        );
        clearDeviceInfo();
      }
      if (deviceSelect.value) {
        await handleDeviceSelectionChange();
      } else {
        clearDeviceInfo();
      }
    } catch (e) {
      console.error("loadDeviceList: CATCH_ERROR:", e.message);
      updateMessage(
        `Error loading devices: ${e.message.substring(0, 100)}`,
        "error",
      );
      if (deviceSelect)
        deviceSelect.innerHTML = `<option value="">Error loading</option>`;
      clearDeviceInfo();
    } finally {
      if (deviceSelect) deviceSelect.disabled = false;
    }
  }

  function populateDeviceDropdown(deviceData) {
    if (!deviceSelect) return;
    deviceSelect.innerHTML = "";
    if (!deviceData || deviceData.length === 0) {
      deviceSelect.innerHTML = '<option value="">No devices found</option>';
      return;
    }
    deviceData.forEach((d) => {
      const o = document.createElement("option");
      o.value = d.serial;
      o.textContent = `${d.model || d.serial || "Unknown"} (SDK:${d.sdkVersion || "N/A"})`;
      deviceSelect.appendChild(o);
    });
  }

  function clearDeviceInfo() {
    stopScreenshotAutoRefresh();
    if (overlayCtx)
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    hideTooltip();
    currentDeviceSerial = null;
    currentHierarchyData = null;
    selectedNode = null;
    selectedNodePath = null;
    hoveredNode = null;
    actualDeviceWidth = null;
    actualDeviceHeight = null;
    isHierarchyLoading = false;
    nodesByKey = {};

    multiSelectedNodes = [];
    if (isMultiSelectModeActive) {
      isMultiSelectModeActive = false;
      if (llmMultiSelectCheckbox) llmMultiSelectCheckbox.checked = false;
      if (llmMultiSelectToggleBtn) {
        llmMultiSelectToggleBtn.classList.remove("active");
        const labelSpan = document.getElementById("llm-multi-select-label");
        if (labelSpan) labelSpan.textContent = "Multi-Select";
      }
    }
    updateMultiSelectedElementsDisplay();

    if (deviceScreenImg) {
      deviceScreenImg.src =
        "https://placehold.co/320x680/252526/777?text=No+Device";
      deviceScreenImg.style.width = "auto";
      deviceScreenImg.style.height = "auto";
    }
    if (overlayCanvas) {
      overlayCanvas.width = 0;
      overlayCanvas.height = 0;
    }
    if (hierarchyTreeViewEl)
      hierarchyTreeViewEl.innerHTML = "No device selected.";
    if (elementPropertiesViewEl) elementPropertiesViewEl.innerHTML = "";
    if (generatedXpathEl) generatedXpathEl.value = "";
    updateMessage("No device selected or device disconnected.", "info");

    if (
      window.LlmAssistantModule &&
      typeof window.LlmAssistantModule.notifyNodeSelectionChanged === "function"
    ) {
      window.LlmAssistantModule.notifyNodeSelectionChanged(null);
    }
  }

  async function handleDeviceSelectionChange() {
    if (!deviceSelect) return;
    const newSerial = deviceSelect.value;
    if (!newSerial) {
      clearDeviceInfo();
      return;
    }

    currentDeviceSerial = newSerial;
    localStorage.setItem("lastSelectedDeviceSerial", currentDeviceSerial);

    selectedNode = null;
    selectedNodePath = null;
    multiSelectedNodes = [];
    updateMultiSelectedElementsDisplay();

    hoveredNode = null;
    hideTooltip();
    currentHierarchyData = null;
    isHierarchyLoading = false;
    nodesByKey = {};
    if (overlayCtx)
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    updateMessage(`Loading ${currentDeviceSerial}...`, "info");

    if (
      window.LlmAssistantModule &&
      typeof window.LlmAssistantModule.notifyNodeSelectionChanged === "function"
    ) {
      window.LlmAssistantModule.notifyNodeSelectionChanged(null);
    }
    try {
      await fetchAndDisplayScreenshot();
      const hierarchyTabContent = document.getElementById(
        "hierarchy-tab-content",
      );
      if (
        hierarchyTabContent &&
        hierarchyTabContent.classList.contains("active")
      ) {
        await fetchAndRenderHierarchy(true);
      } else {
        if (hierarchyTreeViewEl)
          hierarchyTreeViewEl.innerHTML =
            "Select a device and load hierarchy...";
      }
    } catch (error) {
      console.error(
        `handleDeviceSelectionChange: Error for ${currentDeviceSerial}:`,
        error,
      );
      updateMessage(`Error setting up device ${currentDeviceSerial}.`, "error");
      clearDeviceInfo();
    }
  }

  async function fetchAndDisplayScreenshot() {
    if (!currentDeviceSerial || !deviceScreenImg) return;
    updateMessage("Fetching screenshot...", "info");
    deviceScreenImg.removeAttribute("src");
    deviceScreenImg.src =
      "https://placehold.co/320x680/252526/777?text=Loading+Screen...";
    if (overlayCtx)
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    const ts = new Date().getTime();
    try {
      const blob = await callBackend(
        "GET",
        `/api/android/${currentDeviceSerial}/screenshot/0?t=${ts}`,
        null,
        true,
      );
      const prevLoadHandler = deviceScreenImg.onload;
      const prevErrorHandler = deviceScreenImg.onerror;
      if (typeof prevLoadHandler === "function")
        deviceScreenImg.removeEventListener("load", prevLoadHandler);
      if (typeof prevErrorHandler === "function")
        deviceScreenImg.removeEventListener("error", prevErrorHandler);
      if (blob instanceof Blob && blob.size > 0) {
        const imgLoadHandler = () => {
          actualDeviceWidth = deviceScreenImg.naturalWidth;
          actualDeviceHeight = deviceScreenImg.naturalHeight;
          setupOverlayCanvas();
          updateMessage("Screenshot updated.", "success", 2000);
          deviceScreenImg.removeEventListener("load", imgLoadHandler);
          deviceScreenImg.removeEventListener("error", imgErrorHandler);
        };
        const imgErrorHandler = () => {
          deviceScreenImg.src =
            "https://placehold.co/320x680/777/eee?text=LoadErr";
          setupOverlayCanvas();
          updateMessage("Screenshot load error.", "error");
          deviceScreenImg.removeEventListener("load", imgLoadHandler);
          deviceScreenImg.removeEventListener("error", imgErrorHandler);
        };
        deviceScreenImg.addEventListener("load", imgLoadHandler);
        deviceScreenImg.addEventListener("error", imgErrorHandler);
        deviceScreenImg.src = URL.createObjectURL(blob);
      } else {
        deviceScreenImg.src =
          "https://placehold.co/320x680/777/eee?text=NoData";
        setupOverlayCanvas();
        updateMessage("No screenshot data received.", "warning");
      }
    } catch (e) {
      deviceScreenImg.src =
        "https://placehold.co/320x680/777/eee?text=FetchErr";
      setupOverlayCanvas();
      updateMessage("Screenshot fetch error.", "error");
    }
  }

  function buildNodesByKeyMap(node) {
    if (!node || !node.key) return;
    nodesByKey[node.key] = node;
    if (node.children && node.children.length > 0) {
      node.children.forEach(buildNodesByKeyMap);
    }
  }

  async function fetchAndRenderHierarchy(expandAll = false) {
    if (!currentDeviceSerial || !hierarchyTreeViewEl) return;
    if (isHierarchyLoading) return;
    isHierarchyLoading = true;
    hierarchyTreeViewEl.innerHTML = "Loading hierarchy...";
    updateMessage("Loading UI Hierarchy...", "info");
    if (overlayCtx)
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    try {
      const hData = await callBackend(
        "GET",
        `/api/android/${currentDeviceSerial}/hierarchy?format=json`,
      );
      if (hData && typeof hData === "object" && hData.name) {
        currentHierarchyData = hData;
        buildNodesByKeyMap(currentHierarchyData);
        if (
          hData.rect &&
          typeof hData.rect.width === "number" &&
          typeof hData.rect.height === "number"
        ) {
          if (
            (!actualDeviceWidth || actualDeviceWidth === 0) &&
            hData.rect.width > 0
          )
            actualDeviceWidth = (hData.rect.x || 0) + hData.rect.width;
          if (
            (!actualDeviceHeight || actualDeviceHeight === 0) &&
            hData.rect.height > 0
          )
            actualDeviceHeight = (hData.rect.y || 0) + hData.rect.height;
        }
        if (
          deviceScreenImg &&
          deviceScreenImg.naturalWidth === 0 &&
          actualDeviceWidth &&
          actualDeviceHeight
        ) {
          setupOverlayCanvas();
        }
        renderHierarchyTree(
          currentHierarchyData,
          hierarchyTreeViewEl,
          true,
          expandAll,
        );
        updateMessage("Hierarchy loaded.", "success", 2000);
        drawNodeOverlays();
      } else {
        console.error("HIERARCHY: Failed to load/parse.", hData);
        hierarchyTreeViewEl.innerHTML = "Failed to load hierarchy.";
        currentHierarchyData = null;
        updateMessage("Failed to load hierarchy.", "error");
      }
    } catch (e) {
      console.error("HIERARCHY: Exception:", e.message);
      hierarchyTreeViewEl.innerHTML = `Error: ${e.message.substring(0, 100)}`;
      currentHierarchyData = null;
      updateMessage(`Error loading hierarchy.`, "error");
    } finally {
      isHierarchyLoading = false;
    }
  }

  function renderHierarchyTree(
    node,
    parentElement,
    isRootCall = false,
    expandAll = false,
  ) {
    if (!node) return;
    if (isRootCall && parentElement === hierarchyTreeViewEl) {
      parentElement.innerHTML = "";
    }
    const li = document.createElement("li");
    const safeNodeKey = node.key
      ? String(node.key).replace(/[^a-zA-Z0-9-_]/g, "_")
      : `node-rand-${Math.random().toString(36).substr(2, 9)}`;
    li.id = `li-key-${safeNodeKey}`;
    li.dataset.nodeKey = node.key;
    const nodeContentDiv = document.createElement("div");
    nodeContentDiv.className = "node-content";
    let childUl = null;
    if (node.children && node.children.length > 0) {
      const toggle = document.createElement("span");
      toggle.className = "toggle";
      toggle.textContent = expandAll ? "▼" : "►";
      nodeContentDiv.appendChild(toggle);
      childUl = document.createElement("ul");
      if (!expandAll) childUl.classList.add("collapsed");
      toggle.addEventListener("click", (evt) => {
        evt.stopPropagation();
        const isCollapsed = childUl.classList.toggle("collapsed");
        toggle.textContent = isCollapsed ? "►" : "▼";
      });
    } else {
      const spacer = document.createElement("span");
      spacer.className = "toggle spacer";
      nodeContentDiv.appendChild(spacer);
    }
    const nodeTextWrapper = document.createElement("span");
    nodeTextWrapper.className = "node-text-wrapper";
    let txt = `${node.name || "Node"}`;
    if (node.properties) {
      if (node.properties["resource-id"])
        txt += ` <small>(id:${node.properties["resource-id"].split("/").pop()})</small>`;
      else if (
        node.properties["text"] &&
        String(node.properties["text"]).trim()
      )
        txt += ` <small>(text:"${escapeHtml(String(node.properties["text"]).substring(0, 20))}")</small>`;
    }
    nodeTextWrapper.innerHTML = txt;
    nodeContentDiv.appendChild(nodeTextWrapper);
    li.appendChild(nodeContentDiv);
    parentElement.appendChild(li);

    nodeContentDiv.addEventListener("click", (evt) => {
      evt.stopPropagation();
      // Tree click always results in a single, primary selection, turning multi-select mode OFF if it was on.
      if (isMultiSelectModeActive) {
        isMultiSelectModeActive = false;
        if (llmMultiSelectCheckbox) llmMultiSelectCheckbox.checked = false;
        if (llmMultiSelectToggleBtn) {
          llmMultiSelectToggleBtn.classList.remove("active");
          const labelSpan = document.getElementById("llm-multi-select-label");
          if (labelSpan) labelSpan.textContent = "Multi-Select";
        }
        updateMessage(
          "Multi-Select Mode Disabled (Tree Selection)",
          "info",
          2000,
        );
      }
      handleSingleNodeSelection(node); // New function for single selection logic
    });

    // Visual selection in tree based on primary selectedNode
    if (selectedNode && node.key === selectedNode.key) {
      li.classList.add("tree-node-selected");
    }

    if (childUl && node.children) {
      node.children.forEach((c) =>
        renderHierarchyTree(c, childUl, false, expandAll),
      );
      li.appendChild(childUl);
    }
  }

  // Renamed from handleTreeSelection to clarify its role as setting a single primary selection
  function handleSingleNodeSelection(nodeToSelect) {
    if (!nodeToSelect || !nodeToSelect.key) {
      console.warn(
        "handleSingleNodeSelection: Invalid node or key.",
        nodeToSelect,
      );
      return;
    }

    selectedNodePath = nodeToSelect.key;
    selectedNode = nodeToSelect;
    multiSelectedNodes = []; // Clear multi-selection when a single item is explicitly chosen

    updateMultiSelectedElementsDisplay();
    displayNodeProperties(selectedNode);
    drawNodeOverlays();

    const previouslySelectedLi = hierarchyTreeViewEl.querySelector(
      "li.tree-node-selected",
    );
    if (previouslySelectedLi)
      previouslySelectedLi.classList.remove("tree-node-selected");
    const safeNodeKey = String(nodeToSelect.key).replace(
      /[^a-zA-Z0-9-_]/g,
      "_",
    );
    const targetLi = document.getElementById(`li-key-${safeNodeKey}`);
    if (targetLi) {
      targetLi.classList.add("tree-node-selected");
      expandAndScrollToNode(nodeToSelect.key);
    }

    if (
      window.LlmAssistantModule &&
      typeof window.LlmAssistantModule.notifyNodeSelectionChanged === "function"
    ) {
      // LlmAssistantModule's notifyNodeSelectionChanged expects a single node or null for its UI checkbox.
      window.LlmAssistantModule.notifyNodeSelectionChanged(selectedNode);
    }
  }

  function expandAndScrollToNode(nodeKey) {
    if (!nodeKey || !hierarchyTreeViewEl) return;
    const safeNodeKey = String(nodeKey).replace(/[^a-zA-Z0-9-_]/g, "_");
    const targetLi = document.getElementById(`li-key-${safeNodeKey}`);
    if (targetLi) {
      if (DEBUG_ELEMENT_FINDING)
        console.log("HIERARCHY_SCROLL: Scrolling for key:", nodeKey);
      let current = targetLi.parentElement;
      while (
        current &&
        current !== hierarchyTreeViewEl &&
        current.tagName === "UL"
      ) {
        if (current.classList.contains("collapsed")) {
          current.classList.remove("collapsed");
          const parentLiOfUl = current.parentElement;
          if (parentLiOfUl) {
            const toggle = parentLiOfUl.querySelector(
              ".node-content > .toggle:not(.spacer)",
            );
            if (toggle) toggle.textContent = "▼";
          }
        }
        if (
          !current.parentElement ||
          !current.parentElement.parentElement ||
          current.parentElement.parentElement === hierarchyTreeViewEl
        )
          break;
        current = current.parentElement.parentElement;
      }
      setTimeout(() => {
        targetLi.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
        if (DEBUG_ELEMENT_FINDING)
          console.log("HIERARCHY_SCROLL: Scrolled to", targetLi.id);
      }, 50);
    } else {
      if (DEBUG_ELEMENT_FINDING)
        console.warn("HIERARCHY_SCROLL: Could not find li for key:", nodeKey);
    }
  }

  function displayNodeProperties(nodeToDisplay) {
    if (!elementPropertiesViewEl || !generatedXpathEl) {
      console.warn(
        "displayNodeProperties: Essential property view elements not found.",
      );
      return;
    }
    if (!nodeToDisplay) {
      elementPropertiesViewEl.innerHTML =
        "No element selected. Click on the screenshot or tree. In Multi-Select mode, Ctrl+Click to add elements.";
      generatedXpathEl.value = "";
      return;
    }
    let html = "<table class='properties-panel'>";
    if (nodeToDisplay.properties) {
      for (const k in nodeToDisplay.properties)
        html += `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(String(nodeToDisplay.properties[k]))}</td></tr>`;
    }
    if (nodeToDisplay.name)
      html += `<tr><th>class</th><td>${escapeHtml(nodeToDisplay.name)}</td></tr>`;
    if (nodeToDisplay.rect)
      html += `<tr><th>rect (device)</th><td>x:${nodeToDisplay.rect.x}, y:${nodeToDisplay.rect.y}, w:${nodeToDisplay.rect.width}, h:${nodeToDisplay.rect.height}</td></tr>`;
    if (nodeToDisplay.bounds && Array.isArray(nodeToDisplay.bounds))
      html += `<tr><th>bounds (relative)</th><td>${nodeToDisplay.bounds.map((b) => (typeof b === "number" ? b.toFixed(4) : String(b))).join(", ")}</td></tr>`;
    html += "</table>";
    elementPropertiesViewEl.innerHTML = html;
    generatedXpathEl.value = generateBasicXPath(nodeToDisplay);
  }

  function escapeHtml(unsafe) {
    return String(unsafe)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  function generateBasicXPath(node) {
    if (!node || !node.properties) return "";
    const p = node.properties;
    const c = escapeHtml(p["class"] || node.name || "*");
    if (p["resource-id"])
      return `//*[@resource-id='${escapeHtml(p["resource-id"])}']`;
    if (p["text"])
      return `//${c}[@text='${escapeHtml(p["text"]).replace(/'/g, "&apos;")}']`;
    if (p["content-desc"])
      return `//${c}[@content-desc='${escapeHtml(p["content-desc"]).replace(/'/g, "&apos;")}']`;
    let path = `//${c}`;
    return path;
  }

  const KNOWN_OVERLAY_IDS = [
    "com.instagram.android:id/overlay_layout_container",
    "com.instagram.android:id/quick_capture_root_container",
  ];
  function findBestElementFromCandidates(candidates, relX, relY) {
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    candidates.sort((a, b) => {
      const aBoundsValid =
        a.bounds &&
        a.bounds.length === 4 &&
        a.bounds.every((val) => typeof val === "number" && !isNaN(val));
      const bBoundsValid =
        b.bounds &&
        b.bounds.length === 4 &&
        b.bounds.every((val) => typeof val === "number" && !isNaN(val));
      if (!aBoundsValid && bBoundsValid) return 1;
      if (aBoundsValid && !bBoundsValid) return -1;
      if (!aBoundsValid && !bBoundsValid) return 0;
      const aIsKnownOverlay = KNOWN_OVERLAY_IDS.includes(
        a.properties?.["resource-id"],
      );
      const bIsKnownOverlay = KNOWN_OVERLAY_IDS.includes(
        b.properties?.["resource-id"],
      );
      if (aIsKnownOverlay && !bIsKnownOverlay && candidates.length > 1)
        return 1;
      if (!aIsKnownOverlay && bIsKnownOverlay && candidates.length > 1)
        return -1;
      const aClickable =
        a.properties?.clickable === "true" || a.properties?.clickable === true; // Handle boolean true
      const bClickable =
        b.properties?.clickable === "true" || b.properties?.clickable === true;
      if (aClickable && !bClickable) return -1;
      if (!aClickable && bClickable) return 1;
      const aArea = (a.bounds[2] - a.bounds[0]) * (a.bounds[3] - a.bounds[1]);
      const bArea = (b.bounds[2] - b.bounds[0]) * (b.bounds[3] - b.bounds[1]);
      if (Math.abs(aArea - bArea) < 0.0001) {
        const aScore =
          (a.properties?.["resource-id"] ? 2 : 0) +
          (a.properties?.text ? 1 : 0) +
          (a.properties?.["content-desc"] ? 1 : 0) -
          (a.name === "android.widget.FrameLayout" ||
          a.name === "android.view.ViewGroup"
            ? 1
            : 0);
        const bScore =
          (b.properties?.["resource-id"] ? 2 : 0) +
          (b.properties?.text ? 1 : 0) +
          (b.properties?.["content-desc"] ? 1 : 0) -
          (b.name === "android.widget.FrameLayout" ||
          b.name === "android.view.ViewGroup"
            ? 1
            : 0);
        if (aScore > bScore) return -1;
        if (bScore > aScore) return 1;
      } else {
        if (aArea < bArea) return -1;
        if (aArea > bArea) return 1;
      }
      return 0;
    });
    return candidates[0];
  }
  function findAllElementsRecursive(node, relX, relY, candidatesList) {
    if (!node) return;
    if (
      !node.bounds ||
      !Array.isArray(node.bounds) ||
      node.bounds.length !== 4 ||
      node.bounds.some((b) => typeof b !== "number" || isNaN(b))
    )
      return;
    const [x1, y1, x2, y2] = node.bounds;
    const nodeWidth = x2 - x1;
    const nodeHeight = y2 - y1;
    if (
      nodeWidth <= 0 ||
      nodeHeight <= 0 ||
      node.properties?.visibility === "gone"
    )
      return;
    const isXWithin = relX >= x1 && relX <= x2;
    const isYWithin = relY >= y1 && relY <= y2;
    if (isXWithin && isYWithin) {
      candidatesList.push(node);
      if (node.children && node.children.length > 0) {
        for (const child of node.children) {
          if (child && typeof child === "object") {
            findAllElementsRecursive(child, relX, relY, candidatesList);
          }
        }
      }
    }
  }
  function findElementAtCanvasCoordinates(canvasX, canvasY) {
    if (!currentHierarchyData) return null;
    if (
      !overlayCanvas ||
      overlayCanvas.width === 0 ||
      overlayCanvas.height === 0
    )
      return null;
    const relX = canvasX / overlayCanvas.width;
    const relY = canvasY / overlayCanvas.height;
    let hierarchyToSearch = currentHierarchyData;
    if (hierarchyToSearch) {
      if (
        !hierarchyToSearch.bounds ||
        !Array.isArray(hierarchyToSearch.bounds) ||
        hierarchyToSearch.bounds.length !== 4 ||
        hierarchyToSearch.bounds.some((b) => typeof b !== "number" || isNaN(b))
      ) {
        hierarchyToSearch = {
          ...hierarchyToSearch,
          bounds: [0.0, 0.0, 1.0, 1.0],
        };
      }
    } else {
      return null;
    }
    const allPotentialMatches = [];
    findAllElementsRecursive(
      hierarchyToSearch,
      relX,
      relY,
      allPotentialMatches,
    );
    const bestFound = findBestElementFromCandidates(
      allPotentialMatches,
      relX,
      relY,
    );
    return bestFound;
  }
  function performHierarchySearch(searchText) {
    /* ... existing unchanged ... */
  }

  function toggleMultiSelectMode() {
    isMultiSelectModeActive = !isMultiSelectModeActive;
    if (llmMultiSelectCheckbox) {
      llmMultiSelectCheckbox.checked = isMultiSelectModeActive;
    }
    if (llmMultiSelectToggleBtn) {
      llmMultiSelectToggleBtn.classList.toggle(
        "active",
        isMultiSelectModeActive,
      );
      const labelSpan = document.getElementById("llm-multi-select-label");
      if (labelSpan)
        labelSpan.textContent = isMultiSelectModeActive
          ? "Multi (Ctrl+Clk)"
          : "Multi-Select";
    }
    updateMessage(
      `Multi-Select Mode ${isMultiSelectModeActive ? "Enabled (Ctrl+Click elements to add/remove)" : "Disabled"}.`,
      "info",
      3000,
    );

    if (!isMultiSelectModeActive) {
      // When turning OFF, if a primary 'selectedNode' exists, keep it.
      // Clear the multi-select list but ensure 'selectedNode' (if any) is the only one.
      multiSelectedNodes = selectedNode ? [selectedNode] : [];
    } else {
      // When turning ON, if a single 'selectedNode' is already active, make it the start of the multi-selection.
      if (
        selectedNode &&
        !multiSelectedNodes.find((n) => n.key === selectedNode.key)
      ) {
        multiSelectedNodes = [selectedNode];
      } else if (!selectedNode && multiSelectedNodes.length > 0) {
        // If no primary selection but multi-list has items (e.g., from previous mode), set primary
        selectedNode = multiSelectedNodes[0]; // Make the first in list the primary
        selectedNodePath = selectedNode.key;
      } else if (!selectedNode && multiSelectedNodes.length === 0) {
        // Multi-mode on, but no selections yet.
      }
    }
    drawNodeOverlays(); // Update visual highlights
    updateMultiSelectedElementsDisplay(); // Update the list in the context panel

    // Notify LLM module about the current selection state
    if (
      window.LlmAssistantModule &&
      typeof window.LlmAssistantModule.notifyNodeSelectionChanged === "function"
    ) {
      // Send the primary selectedNode for the checkbox, or null if multi-list is active but empty
      const nodeForLlmCheckbox =
        isMultiSelectModeActive && multiSelectedNodes.length > 0
          ? multiSelectedNodes[0]
          : selectedNode;
      window.LlmAssistantModule.notifyNodeSelectionChanged(nodeForLlmCheckbox);
    }
  }

  function updateMultiSelectedElementsDisplay() {
    if (!llmMultiSelectedElementsList || !llmMultiSelectedElementsSection)
      return;
    llmMultiSelectedElementsList.innerHTML = "";

    if (isMultiSelectModeActive && multiSelectedNodes.length > 0) {
      llmMultiSelectedElementsSection.style.display = "block";
      multiSelectedNodes.forEach((node, index) => {
        const listItem = document.createElement("li");
        listItem.className = "multi-selected-item";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = true;
        checkbox.dataset.elementKey = node.key;

        checkbox.addEventListener("change", (event) => {
          if (!event.target.checked) {
            multiSelectedNodes = multiSelectedNodes.filter(
              (n) => n.key !== node.key,
            );
            // If the de-selected node was the primary 'selectedNode', update 'selectedNode'
            if (selectedNode && selectedNode.key === node.key) {
              selectedNode =
                multiSelectedNodes.length > 0
                  ? multiSelectedNodes[multiSelectedNodes.length - 1]
                  : null;
              selectedNodePath = selectedNode ? selectedNode.key : null;
              displayNodeProperties(selectedNode); // Update properties panel
            }
          }
          // Re-render the list and overlays
          updateMultiSelectedElementsDisplay();
          drawNodeOverlays();
          // Notify LLM module about the change in selection
          if (
            window.LlmAssistantModule &&
            typeof window.LlmAssistantModule.notifyNodeSelectionChanged ===
              "function"
          ) {
            const nodeForLlmCheckbox =
              isMultiSelectModeActive && multiSelectedNodes.length > 0
                ? multiSelectedNodes[0]
                : selectedNode;
            window.LlmAssistantModule.notifyNodeSelectionChanged(
              nodeForLlmCheckbox,
            );
          }
        });

        const span = document.createElement("span");
        let desc = `[${index + 1}] ${node.name || "Elem"}`;
        const id = node.properties?.["resource-id"]?.split("/")?.pop();
        const text = node.properties?.text;
        if (id) {
          desc += ` (id: ...${id.slice(-15)})`;
        } else if (text) {
          desc += ` (text: "${String(text).substring(0, 15)}...")`;
        } else {
          desc += ` (key: ...${String(node.key).slice(-10)})`;
        }
        span.textContent = desc;
        span.title = `${node.name || "Unnamed Element"} - Key: ${node.key}\nresource-id: ${node.properties?.["resource-id"] || "N/A"}\ntext: ${node.properties?.text || "N/A"}`;

        listItem.appendChild(checkbox);
        listItem.appendChild(span);
        llmMultiSelectedElementsList.appendChild(listItem);
      });
    } else {
      llmMultiSelectedElementsSection.style.display = "none";
    }
  }

  if (overlayCanvas) {
    overlayCanvas.addEventListener("mousemove", function (event) {
      if (!currentHierarchyData || !overlayCtx || isHierarchyLoading) return;
      const rect = overlayCanvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const nodeUnderMouse = findElementAtCanvasCoordinates(x, y);
      if (hoveredNode?.key !== nodeUnderMouse?.key) {
        hoveredNode = nodeUnderMouse;
        drawNodeOverlays();
        if (hoveredNode) {
          updateAndShowTooltip(hoveredNode, event.pageX, event.pageY);
        } else {
          hideTooltip();
        }
      } else if (hoveredNode && nodeUnderMouse) {
        updateAndShowTooltip(hoveredNode, event.pageX, event.pageY);
      }
    });
    overlayCanvas.addEventListener("mouseleave", function () {
      hideTooltip();
      if (hoveredNode) {
        hoveredNode = null;
        drawNodeOverlays();
      }
    });

    overlayCanvas.addEventListener("click", function (event) {
      if (isHierarchyLoading || !currentHierarchyData) {
        console.warn("CLICK_HANDLER: Click ignored, hierarchy not ready.");
        updateMessage("Hierarchy is loading or not available.", "warning");
        return;
      }
      const rect = overlayCanvas.getBoundingClientRect();
      const canvasX = event.clientX - rect.left;
      const canvasY = event.clientY - rect.top;
      const clickedNodeObject = findElementAtCanvasCoordinates(
        canvasX,
        canvasY,
      );

      if (isMultiSelectModeActive) {
        if (clickedNodeObject) {
          if (event.ctrlKey || event.metaKey) {
            const existingNodeIndex = multiSelectedNodes.findIndex(
              (node) => node.key === clickedNodeObject.key,
            );
            if (existingNodeIndex > -1) {
              multiSelectedNodes.splice(existingNodeIndex, 1);
            } else {
              multiSelectedNodes.push(clickedNodeObject);
            }
            selectedNode =
              multiSelectedNodes.length > 0
                ? multiSelectedNodes[multiSelectedNodes.length - 1]
                : clickedNodeObject; // Make last interacted the primary
            selectedNodePath = selectedNode ? selectedNode.key : null;
          } else {
            multiSelectedNodes = [clickedNodeObject];
            selectedNode = clickedNodeObject;
            selectedNodePath = clickedNodeObject.key;
          }
        } else {
          if (!(event.ctrlKey || event.metaKey)) {
            multiSelectedNodes = [];
            selectedNode = null;
            selectedNodePath = null;
          }
        }

        updateMultiSelectedElementsDisplay();
        displayNodeProperties(selectedNode);
        drawNodeOverlays();
        if (
          selectedNode &&
          multiSelectedNodes.some((n) => n.key === selectedNode.key)
        ) {
          updateAndShowTooltip(selectedNode, event.pageX, event.pageY);
        } else {
          hideTooltip();
        }

        if (
          window.LlmAssistantModule &&
          typeof window.LlmAssistantModule.notifyNodeSelectionChanged ===
            "function"
        ) {
          const nodeForLlmCheckbox =
            multiSelectedNodes.length > 0 ? multiSelectedNodes[0] : null;
          window.LlmAssistantModule.notifyNodeSelectionChanged(
            nodeForLlmCheckbox,
          );
        }
      } else {
        if (clickedNodeObject) {
          handleSingleNodeSelection(clickedNodeObject);
          updateAndShowTooltip(clickedNodeObject, event.pageX, event.pageY);
        } else {
          selectedNode = null;
          selectedNodePath = null;
          multiSelectedNodes = [];
          updateMultiSelectedElementsDisplay();
          hideTooltip();
          if (elementPropertiesViewEl)
            elementPropertiesViewEl.innerHTML = "No element selected.";
          if (generatedXpathEl) generatedXpathEl.value = "";
          drawNodeOverlays();
          const RTreeEl = hierarchyTreeViewEl.querySelector(
            "li.tree-node-selected",
          );
          if (RTreeEl) RTreeEl.classList.remove("tree-node-selected");
          if (
            window.LlmAssistantModule &&
            typeof window.LlmAssistantModule.notifyNodeSelectionChanged ===
              "function"
          ) {
            window.LlmAssistantModule.notifyNodeSelectionChanged(null);
          }
        }
      }
    });
  }

  async function handleRunPythonCode() {
    const pythonOutputDiv = document.getElementById(
      "interactive-python-output",
    );
    let code = "";
    if (
      window.PythonConsoleManager &&
      typeof window.PythonConsoleManager.getCode === "function"
    ) {
      code = window.PythonConsoleManager.getCode();
    } else {
      console.error(
        "PythonConsoleManager or getCode method is not available. Cannot run Python code.",
      );
      alert("Python editor is not properly initialized. Cannot run code.");
      return;
    }
    if (!currentDeviceSerial) {
      alert("Please select a device first to run Python code.");
      return;
    }
    if (!pythonOutputDiv) {
      console.error(
        "Python output element (#interactive-python-output) not found.",
      );
      return;
    }
    if (!code.trim()) {
      alert("Please enter Python code to run.");
      return;
    }

    pythonOutputDiv.textContent = "Executing Python code...";
    pythonOutputDiv.style.color = "var(--dark-text-secondary)";
    try {
      const responseData = await callBackend(
        "POST",
        `/api/android/${currentDeviceSerial}/interactive_python`,
        { code: code, enable_tracing: false },
      );
      let formattedOutput = "";
      if (responseData) {
        if (responseData.stdout && responseData.stdout.trim() !== "") {
          formattedOutput += responseData.stdout;
        }
        if (
          responseData.result !== null &&
          responseData.result !== undefined &&
          String(responseData.result).trim() !== ""
        ) {
          if (formattedOutput.length > 0 && !formattedOutput.endsWith("\n")) {
            formattedOutput += "\n";
          }
          if (String(responseData.result) !== "None") {
            formattedOutput += `>>> ${responseData.result}\n`;
          }
        }
        if (responseData.stderr && responseData.stderr.trim() !== "") {
          if (formattedOutput.length > 0 && !formattedOutput.endsWith("\n")) {
            formattedOutput += "\n";
          }
          formattedOutput += "--- STDERR ---\n" + responseData.stderr;
        }
        if (
          responseData.execution_error &&
          responseData.execution_error.trim() !== ""
        ) {
          if (formattedOutput.length > 0 && !formattedOutput.endsWith("\n")) {
            formattedOutput += "\n";
          }
          formattedOutput +=
            "--- TRACEBACK ---\n" + responseData.execution_error;
          pythonOutputDiv.style.color = "var(--dark-error)";
        }
      } else {
        formattedOutput = "# No structured output received from backend.";
      }
      pythonOutputDiv.textContent =
        formattedOutput.trim() === "" ? "# No output" : formattedOutput;
      // After execution, process the output for tracebacks
      if (
        window.PythonConsoleManager &&
        typeof window.PythonConsoleManager.processExecutionOutput === "function"
      ) {
        window.PythonConsoleManager.processExecutionOutput(formattedOutput);
      }
    } catch (e) {
      pythonOutputDiv.textContent = `Error communicating with backend: ${e.message}`;
      pythonOutputDiv.style.color = "var(--dark-error)";
      console.error("Error in handleRunPythonCode during backend call:", e);
      if (
        window.PythonConsoleManager &&
        typeof window.PythonConsoleManager.processExecutionOutput === "function"
      ) {
        window.PythonConsoleManager.processExecutionOutput(
          `Frontend Error: ${e.message}\n${e.stack || ""}`,
        );
      }
    }
  }
  async function sendDeviceCommand(commandName) {
    if (!currentDeviceSerial) {
      alert("Select device.");
      return;
    }
    updateMessage(`Sending: ${commandName}...`, "info");
    try {
      await callBackend(
        "POST",
        `/api/android/${currentDeviceSerial}/command/${commandName}`,
        {},
      );
      updateMessage(`Command '${commandName}' sent.`, "success");
      if (["home", "back"].includes(commandName)) {
        setTimeout(async () => {
          if (DEBUG_ELEMENT_FINDING)
            console.log(
              `Device command '${commandName}' executed, refreshing screen & hierarchy.`,
            );
          await fetchAndDisplayScreenshot();
          await fetchAndRenderHierarchy(true);
        }, 300);
      }
    } catch (e) {
      updateMessage(`Error sending command: ${e.message}`, "error");
    }
  }

  function getAppVariablesForLlm() {
    let elementsForLlmContext = [];
    if (isMultiSelectModeActive && multiSelectedNodes.length > 0) {
      elementsForLlmContext = multiSelectedNodes.map((node) =>
        JSON.parse(JSON.stringify(node)),
      );
    } else if (selectedNode) {
      elementsForLlmContext = [JSON.parse(JSON.stringify(selectedNode))];
    }

    return {
      selectedElements: elementsForLlmContext,
      currentHierarchyData: currentHierarchyData
        ? JSON.parse(JSON.stringify(currentHierarchyData))
        : null,
      currentDeviceSerial: currentDeviceSerial,
      devices: devices ? JSON.parse(JSON.stringify(devices)) : [],
      actualDeviceWidth: actualDeviceWidth,
      actualDeviceHeight: actualDeviceHeight,
      generatedXpathValue: generatedXpathEl ? generatedXpathEl.value : "",
    };
  }

  function initialize() {
    console.log("local_inspector.js: Initializing application...");
    updateMessage("Initializing UI...", "info");
    createCanvasTooltip();

    if (
      window.PythonConsoleManager &&
      typeof window.PythonConsoleManager.init === "function"
    ) {
      console.log(
        "local_inspector.js: Initializing Python Console via PythonConsoleManager...",
      );
      window.PythonConsoleManager.init("interactive-python-editor", {
        callBackend: callBackend,
        getDeviceSerial: function () {
          return currentDeviceSerial;
        },
        updateMessage: updateMessage,
      });
    } else {
      console.error(
        "PythonConsoleManager is not available at initialize. Python editor will not be set up.",
      );
      updateMessage(
        "Python console module failed to load or initialize correctly.",
        "error",
      );
      const pythonTextarea = document.getElementById(
        "interactive-python-editor",
      );
      if (pythonTextarea)
        pythonTextarea.value =
          "Python Console module failed to load. Completions/VIM will not work.";
    }

    if (deviceSelect) {
      console.log("Calling loadDeviceList from initialize...");
      loadDeviceList();
    } else {
      updateMessage(
        "UI Error: device-select missing. Device functionality will be unavailable.",
        "error",
      );
    }

    window.addEventListener("resize", setupOverlayCanvas);
    if (deviceScreenImg) {
      if (!deviceScreenImg.onloadAttachedToInspector) {
        deviceScreenImg.addEventListener("load", setupOverlayCanvas);
        deviceScreenImg.onloadAttachedToInspector = true;
      }
    } else console.warn("Init: deviceScreenImg not found");

    if (llmMultiSelectToggleBtn && llmMultiSelectCheckbox) {
      llmMultiSelectToggleBtn.addEventListener("click", toggleMultiSelectMode);
    } else {
      console.warn(
        "Multi-select toggle button or checkbox not found during init.",
      );
    }

    const localRefreshScreenBtn = document.getElementById("refresh-screen-btn"); // This ID was removed from HTML. If needed, re-add or remove this.
    if (localRefreshScreenBtn)
      localRefreshScreenBtn.addEventListener(
        "click",
        fetchAndDisplayScreenshot,
      );

    if (deviceSelect)
      deviceSelect.addEventListener("change", handleDeviceSelectionChange);

    const localRunPythonBtn = document.getElementById("run-python-button");
    if (localRunPythonBtn)
      localRunPythonBtn.addEventListener("click", handleRunPythonCode);

    // Device control buttons were removed from HTML, these listeners will do nothing if buttons are gone.
    // const localDeviceHomeBtn = document.getElementById("device-home-btn");
    // if (localDeviceHomeBtn) localDeviceHomeBtn.addEventListener("click", () => sendDeviceCommand("home"));
    // const localDeviceBackBtn = document.getElementById("device-back-btn");
    // if (localDeviceBackBtn) localDeviceBackBtn.addEventListener("click", () => sendDeviceCommand("back"));

    const localRefreshHierarchyBtn = document.getElementById(
      "refresh-hierarchy-btn",
    );
    if (localRefreshHierarchyBtn) {
      localRefreshHierarchyBtn.addEventListener("click", async function () {
        if (!currentDeviceSerial) {
          updateMessage("Please select a device first.", "warning");
          return;
        }
        updateMessage("Refreshing screen and hierarchy...", "info");
        if (DEBUG_ELEMENT_FINDING)
          console.log("REFRESH_ALL_BTN: Manual full refresh triggered.");
        try {
          await fetchAndDisplayScreenshot();
          await fetchAndRenderHierarchy(true);
          updateMessage("Screen and hierarchy refreshed.", "success");
        } catch (error) {
          console.error("REFRESH_ALL_BTN: Error during manual refresh:", error);
          updateMessage("Error during refresh. Check console.", "error");
        }
      });
    }
    if (hierarchySearchInput) {
      hierarchySearchInput.addEventListener("input", function (e) {
        performHierarchySearch(e.target.value);
      });
    } else {
      console.warn("Hierarchy search input not found during initialization.");
    }

    if (
      window.LlmAssistantModule &&
      typeof window.LlmAssistantModule.init === "function"
    ) {
      console.log("local_inspector.js: Initializing LlmAssistantModule...");
      window.LlmAssistantModule.init({
        getAppVariables: getAppVariablesForLlm,
        PythonConsoleManager: window.PythonConsoleManager,
        updateMessage: updateMessage,
        callBackend: callBackend,
        escapeHtml: escapeHtml,
        openGlobalTab: window.openTab,
      });
    } else {
      console.error(
        "LlmAssistantModule is not available at initialize. LLM features will be disabled.",
      );
      updateMessage("LLM Assistant module failed to load.", "error", 0);
    }

    console.log(
      "local_inspector.js: Application initialize function completed.",
    );
  }

  if (typeof window.openTab !== "function") {
    console.log("local_inspector.js: Defining window.openTab for main panels");
    window.openTab = function (evt, tabName) {
      console.log(`window.openTab (main panel) called for: ${tabName}`);
      let i, tc, tb;
      tc = document.querySelectorAll("#panel-hierarchy-code > .tab-content");
      for (i = 0; i < tc.length; i++) {
        tc[i].style.display = "none";
        tc[i].classList.remove("active");
      }
      tb = document.querySelectorAll(
        "#panel-hierarchy-code > .tabs > .tab-button",
      );
      for (i = 0; i < tb.length; i++) {
        tb[i].classList.remove("active");
      }
      const actTab = document.getElementById(tabName);
      if (actTab) {
        actTab.style.display = "flex";
        actTab.classList.add("active");
      }
      if (evt && evt.currentTarget) {
        evt.currentTarget.classList.add("active");
      } else {
        for (i = 0; i < tb.length; i++) {
          const onC = tb[i].getAttribute("onclick");
          if (
            onC &&
            (onC.includes("'" + tabName + "'") ||
              onC.includes('"' + tabName + '"'))
          ) {
            tb[i].classList.add("active");
            break;
          }
        }
      }
      const hierarchyTabContent = document.getElementById(
        "hierarchy-tab-content",
      );
      if (
        actTab === hierarchyTabContent &&
        !currentHierarchyData &&
        !isHierarchyLoading &&
        currentDeviceSerial
      ) {
        if (DEBUG_ELEMENT_FINDING)
          console.log(
            "Inspector tab (hierarchy) opened/focused, fetching hierarchy...",
          );
        fetchAndRenderHierarchy(true);
      }
      if (
        actTab &&
        actTab.id === "python-tab-content" &&
        window.PythonConsoleManager &&
        typeof window.PythonConsoleManager.refresh === "function"
      ) {
        console.log(
          "local_inspector.js: Refreshing Python console via PythonConsoleManager.",
        );
        window.PythonConsoleManager.refresh();
      }
    };
  } else {
    console.log(
      "local_inspector.js: window.openTab (main panel) was already defined.",
    );
  }

  function initializeDefaultTab() {
    console.log(
      "local_inspector.js: Initializing default tab for main panel (#panel-hierarchy-code)...",
    );
    const panelHierarchyCode = document.getElementById("panel-hierarchy-code");
    if (!panelHierarchyCode) {
      console.warn("Default tab init: #panel-hierarchy-code not found.");
      return;
    }
    let defaultTabButton = panelHierarchyCode.querySelector(
      ".tabs .tab-button.active",
    );
    let defaultTabToOpen;
    if (defaultTabButton) {
      defaultTabToOpen = defaultTabButton
        .getAttribute("onclick")
        ?.match(/openTab\(event, ['"]([^'"]+)['"]\)/)?.[1];
    } else {
      defaultTabButton = panelHierarchyCode.querySelector(".tabs .tab-button");
      if (defaultTabButton) {
        defaultTabToOpen = defaultTabButton
          .getAttribute("onclick")
          ?.match(/openTab\(event, ['"]([^'"]+)['"]\)/)?.[1];
      }
    }
    if (
      defaultTabButton &&
      defaultTabToOpen &&
      typeof window.openTab === "function"
    ) {
      console.log(`Default main panel tab to open: ${defaultTabToOpen}`);
      window.openTab({ currentTarget: defaultTabButton }, defaultTabToOpen);
    } else {
      console.warn(
        "No tab buttons found or window.openTab not defined for #panel-hierarchy-code, cannot initialize a default tab.",
      );
    }
  }

  try {
    initialize();
    initializeDefaultTab();
    console.log("local_inspector.js: Initialization sequence complete.");
  } catch (e) {
    console.error(
      "local_inspector.js: CRITICAL ERROR during initialization sequence:",
      e,
    );
    if (messageArea)
      messageArea.innerHTML = `<span style='color:red;'>Critical error during page load: ${e.message}. Check console.</span>`;
  }
});
