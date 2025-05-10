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

  // pythonCmEditor is now managed by PythonConsoleManager
  // let pythonCmEditor = null;

  // --- State ---
  let currentDeviceSerial = null;
  let devices = [];
  let currentHierarchyData = null;
  let isHierarchyLoading = false;
  let selectedNodePath = null;
  let selectedNode = null;
  let hoveredNode = null;
  let actualDeviceWidth = null;
  let actualDeviceHeight = null;
  let nodesByKey = {};
  const DEBUG_ELEMENT_FINDING = true;
  let canvasTooltip = null;

  function updateMessage(text, type = "info") {
    if (messageArea) {
      messageArea.textContent = text;
      messageArea.className = "";
      messageArea.style.color =
        type === "error"
          ? "var(--dark-error)"
          : type === "warning"
            ? "var(--dark-warning)"
            : "var(--dark-text-secondary)";
      messageArea.style.display = "block";
      if (type !== "error" && type !== "warning") {
        setTimeout(() => {
          if (messageArea && messageArea.textContent === text)
            messageArea.style.display = "none";
        }, 4000);
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
        if (DEBUG_ELEMENT_FINDING)
          console.log("Tooltip: Created and appended.");
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
      if (DEBUG_ELEMENT_FINDING && !isHierarchyLoading)
        console.warn("drawNodeOverlays: currentHierarchyData is null.");
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
        if (selectedNode && selectedNode.key === node.key) {
          overlayCtx.strokeStyle = "rgba(255,0,0,0.9)";
          overlayCtx.lineWidth = 2;
          if (DEBUG_ELEMENT_FINDING && node.name)
            console.log(
              `DRAW_SELECTED: Highlighting selected ${node.name} (Key:${node.key})`,
            );
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
      if (DEBUG_ELEMENT_FINDING)
        console.warn("Tooltip: updateAndShowTooltip - Prerequisites not met.");
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
    if (canvasTooltip) {
      canvasTooltip.style.display = "none";
    }
  }
  function startScreenshotAutoRefresh() {
    if (currentDeviceSerial) {
      fetchAndDisplayScreenshot();
      if (DEBUG_ELEMENT_FINDING)
        console.log(
          "SCREENSHOT_REFRESH: Auto-refresh DISABLED. Initial screenshot fetched.",
        );
    }
  }
  function stopScreenshotAutoRefresh() {
    if (DEBUG_ELEMENT_FINDING)
      console.log(
        "SCREENSHOT_REFRESH: stopScreenshotAutoRefresh called (no active interval expected).",
      );
  }

  async function loadDeviceList() {
    console.log("loadDeviceList: Attempting to load devices...");
    updateMessage("Loading devices...", "info");
    if (deviceSelect) deviceSelect.disabled = true;
    try {
      if (DEBUG_ELEMENT_FINDING)
        console.log("loadDeviceList: Fetching /api/android/list");
      const data = await callBackend("GET", "/api/android/list");
      if (DEBUG_ELEMENT_FINDING)
        console.log("loadDeviceList: Received data:", data);
      devices = Array.isArray(data) ? data : [];
      populateDeviceDropdown(devices);
      if (devices.length > 0) {
        const lastSerial = localStorage.getItem("lastSelectedDeviceSerial");
        const deviceToSelect =
          devices.find((d) => d.serial === lastSerial) || devices[0];
        if (deviceToSelect) {
          if (DEBUG_ELEMENT_FINDING)
            console.log(
              "loadDeviceList: Attempting to select device:",
              deviceToSelect.serial,
            );
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
        console.log(
          "loadDeviceList: Device selected in dropdown, calling handleDeviceSelectionChange:",
          deviceSelect.value,
        );
        await handleDeviceSelectionChange();
      } else {
        if (DEBUG_ELEMENT_FINDING)
          console.log(
            "loadDeviceList: No device selected in dropdown after populating.",
          );
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
      if (DEBUG_ELEMENT_FINDING) console.log("loadDeviceList: Finished.");
    }
  }

  function populateDeviceDropdown(deviceData) {
    if (!deviceSelect) {
      console.error("populateDeviceDropdown: deviceSelect element not found!");
      return;
    }
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
  }

  async function handleDeviceSelectionChange() {
    if (!deviceSelect) {
      console.error("handleDeviceSelectionChange: deviceSelect is null!");
      return;
    }
    const newSerial = deviceSelect.value;
    if (DEBUG_ELEMENT_FINDING)
      console.log(
        `handleDeviceSelectionChange: Value changed to "${newSerial}". Current serial: ${currentDeviceSerial}`,
      );
    if (!newSerial) {
      console.log(
        "handleDeviceSelectionChange: No device serial selected. Clearing info.",
      );
      clearDeviceInfo();
      return;
    }
    currentDeviceSerial = newSerial;
    localStorage.setItem("lastSelectedDeviceSerial", currentDeviceSerial);
    selectedNode = null;
    selectedNodePath = null;
    hoveredNode = null;
    hideTooltip();
    currentHierarchyData = null;
    isHierarchyLoading = false;
    nodesByKey = {};
    if (overlayCtx)
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    updateMessage(`Loading ${currentDeviceSerial}...`, "info");
    try {
      await fetchAndDisplayScreenshot();
      const hierarchyTabContent = document.getElementById(
        "hierarchy-tab-content",
      );
      if (
        hierarchyTabContent &&
        hierarchyTabContent.classList.contains("active")
      ) {
        if (DEBUG_ELEMENT_FINDING)
          console.log(
            "handleDeviceSelectionChange: Hierarchy tab active, fetching hierarchy.",
          );
        await fetchAndRenderHierarchy(true);
      } else {
        if (DEBUG_ELEMENT_FINDING)
          console.log("handleDeviceSelectionChange: Hierarchy tab not active.");
        if (hierarchyTreeViewEl)
          hierarchyTreeViewEl.innerHTML =
            "Select a device and load hierarchy...";
      }
    } catch (error) {
      console.error(
        `handleDeviceSelectionChange: Error during setup for ${currentDeviceSerial}:`,
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
          if (DEBUG_ELEMENT_FINDING)
            console.log(
              "SCREENSHOT: Loaded,",
              actualDeviceWidth,
              actualDeviceHeight,
            );
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
    if (!currentDeviceSerial || !hierarchyTreeViewEl) {
      if (DEBUG_ELEMENT_FINDING)
        console.warn("HIERARCHY: Pre-conditions for fetch not met.");
      return;
    }
    if (isHierarchyLoading) {
      if (DEBUG_ELEMENT_FINDING)
        console.warn("HIERARCHY: Fetch already in progress.");
      return;
    }
    if (DEBUG_ELEMENT_FINDING)
      console.log("HIERARCHY: Starting fetch for", currentDeviceSerial);
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
        if (DEBUG_ELEMENT_FINDING)
          console.log("HIERARCHY: Successfully fetched, rendered.");
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
      if (DEBUG_ELEMENT_FINDING)
        console.log("HIERARCHY: fetchAndRenderHierarchy finished.");
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
      handleTreeSelection(node);
    });
    if (node.key === selectedNodePath) {
      li.classList.add("tree-node-selected");
    }
    if (childUl && node.children) {
      node.children.forEach((c) =>
        renderHierarchyTree(c, childUl, false, expandAll),
      );
      li.appendChild(childUl);
    }
  }

  function handleTreeSelection(node) {
    if (!node || !node.key) {
      console.warn("handleTreeSelection: Invalid node or key.", node);
      return;
    }
    if (DEBUG_ELEMENT_FINDING)
      console.log(
        `TREE_SELECTION: Node selected/clicked: ${node.name} (Key: ${node.key})`,
      );
    selectedNodePath = node.key;
    selectedNode = node;
    displayNodeProperties(node);
    drawNodeOverlays();
    const previouslySelectedLi = hierarchyTreeViewEl.querySelector(
      "li.tree-node-selected",
    );
    if (previouslySelectedLi)
      previouslySelectedLi.classList.remove("tree-node-selected");
    const safeNodeKey = String(node.key).replace(/[^a-zA-Z0-9-_]/g, "_");
    const targetLi = document.getElementById(`li-key-${safeNodeKey}`);
    if (targetLi) {
      targetLi.classList.add("tree-node-selected");
      if (DEBUG_ELEMENT_FINDING)
        console.log(
          "TREE_SELECTION: Applied .tree-node-selected to li:",
          targetLi.id,
        );
      expandAndScrollToNode(node.key);
    } else {
      if (DEBUG_ELEMENT_FINDING)
        console.warn("TREE_SELECTION: Could not find li for key", node.key);
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

  function displayNodeProperties(node) {
    const elementPropertiesViewEl = document.getElementById(
      "element-properties-view",
    );
    const generatedXpathEl = document.getElementById("generated-xpath");
    if (!elementPropertiesViewEl || !generatedXpathEl) return;
    if (!node) {
      elementPropertiesViewEl.innerHTML = "No node selected.";
      generatedXpathEl.value = "";
      return;
    }
    let html = "<table class='properties-panel'>";
    if (node.properties) {
      for (const k in node.properties)
        html += `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(String(node.properties[k]))}</td></tr>`;
    }
    if (node.name)
      html += `<tr><th>class</th><td>${escapeHtml(node.name)}</td></tr>`;
    if (node.rect)
      html += `<tr><th>rect (device)</th><td>x:${node.rect.x}, y:${node.rect.y}, w:${node.rect.width}, h:${node.rect.height}</td></tr>`;
    if (node.bounds && Array.isArray(node.bounds))
      html += `<tr><th>bounds (relative)</th><td>${node.bounds.map((b) => (typeof b === "number" ? b.toFixed(4) : String(b))).join(", ")}</td></tr>`;
    html += "</table>";
    elementPropertiesViewEl.innerHTML = html;
    generatedXpathEl.value = generateBasicXPath(node);
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
    return `//${c}`;
  }
  const KNOWN_OVERLAY_IDS = [
    "com.instagram.androie:id/overlay_layout_container",
    "com.instagram.androie:id/quick_capture_root_container",
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
      if (aIsKnownOverlay && !bIsKnownOverlay) return 1;
      if (!aIsKnownOverlay && bIsKnownOverlay) return -1;
      const aClickable = a.properties?.clickable === "true";
      const bClickable = b.properties?.clickable === "true";
      if (aClickable && !bClickable) return -1;
      if (!aClickable && bClickable) return 1;
      const aArea = (a.bounds[2] - a.bounds[0]) * (a.bounds[3] - a.bounds[1]);
      const bArea = (b.bounds[2] - b.bounds[0]) * (b.bounds[3] - b.bounds[1]);
      if (Math.abs(aArea - bArea) < 0.001) {
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
    if (DEBUG_ELEMENT_FINDING && candidates.length > 0)
      console.log(
        `findBestElementFromCandidates: Chose ${candidates[0].name} (Key: ${candidates[0].key}, Clickable: ${candidates[0].properties?.clickable}) from ${candidates.length} candidates.`,
      );
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
    if (nodeWidth <= 0 || nodeHeight <= 0) return;
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
    if (DEBUG_ELEMENT_FINDING)
      console.log(
        `findElementAtCanvasCoordinates: Entry (X:${canvasX.toFixed(1)}, Y:${canvasY.toFixed(1)}). currentHierarchyData is ${currentHierarchyData ? "PRESENT" : "NULL"}`,
      );
    if (!currentHierarchyData) {
      if (DEBUG_ELEMENT_FINDING)
        console.warn(
          "findElementAtCanvasCoordinates: currentHierarchyData is null.",
        );
      return null;
    }
    if (
      !overlayCanvas ||
      overlayCanvas.width === 0 ||
      overlayCanvas.height === 0
    ) {
      if (DEBUG_ELEMENT_FINDING)
        console.warn(
          "findElementAtCanvasCoordinates: overlayCanvas not ready.",
        );
      return null;
    }
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
        if (DEBUG_ELEMENT_FINDING)
          console.warn(
            `CanvasInteraction DBG: Root node for search ('${hierarchyToSearch.name || "Unnamed Root"}', Key: '${hierarchyToSearch.key || "Unknown Key"}') has invalid/NaN bounds. Applying default [0.0, 0.0, 1.0, 1.0]. Original bounds:`,
            hierarchyToSearch.bounds,
          );
        hierarchyToSearch = {
          ...hierarchyToSearch,
          bounds: [0.0, 0.0, 1.0, 1.0],
        };
      }
    } else {
      if (DEBUG_ELEMENT_FINDING)
        console.error("Logic Error: hierarchyToSearch became null.");
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
    if (DEBUG_ELEMENT_FINDING)
      console.log(
        `findElementAtCanvasCoordinates: Final best result - ${bestFound ? bestFound.name + " (Key:" + bestFound.key + ")" : "None"}`,
      );
    return bestFound;
  }
  function performHierarchySearch(searchText) {
    if (!hierarchyTreeViewEl || !currentHierarchyData || !nodesByKey) return;
    const searchTerm = searchText.toLowerCase().trim();
    const allLiElements =
      hierarchyTreeViewEl.querySelectorAll("li[id^='li-key-']");
    if (DEBUG_ELEMENT_FINDING)
      console.log(
        `SEARCH: Searching for "${searchTerm}". Found ${allLiElements.length} li elements.`,
      );
    if (!searchTerm) {
      allLiElements.forEach((li) => {
        li.style.display = "";
      });
      if (selectedNode && selectedNode.key)
        expandAndScrollToNode(selectedNode.key);
      return;
    }
    allLiElements.forEach((li) => (li.style.display = "none"));
    let firstMatchLi = null;
    let matchCount = 0;
    for (const key in nodesByKey) {
      const node = nodesByKey[key];
      let isMatch = false;
      const nodeText =
        `${node.name || ""} ${node.properties?.["resource-id"] || ""} ${node.properties?.text || ""} ${node.properties?.["content-desc"] || ""}`.toLowerCase();
      if (nodeText.includes(searchTerm)) isMatch = true;
      if (isMatch) {
        matchCount++;
        const safeNodeKey = String(node.key).replace(/[^a-zA-Z0-9-_]/g, "_");
        const liElement = document.getElementById(`li-key-${safeNodeKey}`);
        if (liElement) {
          if (!firstMatchLi) firstMatchLi = liElement;
          liElement.style.display = "";
          let parentLi = liElement.parentElement?.parentElement;
          while (
            parentLi &&
            parentLi.tagName === "LI" &&
            parentLi.id.startsWith("li-key-")
          ) {
            parentLi.style.display = "";
            const childUl = parentLi.querySelector("ul");
            const toggle = parentLi.querySelector(".toggle:not(.spacer)");
            if (childUl && childUl.classList.contains("collapsed")) {
              childUl.classList.remove("collapsed");
              if (toggle) toggle.textContent = "▼";
            }
            parentLi = parentLi.parentElement?.parentElement;
          }
        }
      }
    }
    if (firstMatchLi && searchTerm) {
      handleTreeSelection(nodesByKey[firstMatchLi.dataset.nodeKey]);
      if (DEBUG_ELEMENT_FINDING)
        console.log(
          `SEARCH: Scrolled to first of ${matchCount} matches: ${firstMatchLi.id}`,
        );
    } else if (DEBUG_ELEMENT_FINDING) {
      console.log(`SEARCH: No matches found for "${searchTerm}".`);
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
          displayNodeProperties(hoveredNode);
          updateAndShowTooltip(hoveredNode, event.pageX, event.pageY);
        } else {
          hideTooltip();
          if (selectedNode) displayNodeProperties(selectedNode);
          else if (elementPropertiesViewEl)
            elementPropertiesViewEl.innerHTML = "Hover or select an element.";
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
        if (selectedNode) displayNodeProperties(selectedNode);
        else if (elementPropertiesViewEl)
          elementPropertiesViewEl.innerHTML = "Select an element.";
      }
    });
    overlayCanvas.addEventListener("click", function (event) {
      if (isHierarchyLoading || !currentHierarchyData) {
        console.warn("CLICK_HANDLER: Click ignored, hierarchy not ready.");
        updateMessage("Hierarchy is loading or not available.", "warning");
        return;
      }
      const rect = overlayCanvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (DEBUG_ELEMENT_FINDING)
        console.log(
          "CLICK_HANDLER: Click event at canvas coords:",
          x.toFixed(1),
          y.toFixed(1),
        );
      const clickedNode = findElementAtCanvasCoordinates(x, y);
      if (clickedNode) {
        handleTreeSelection(clickedNode);
        updateAndShowTooltip(clickedNode, event.pageX, event.pageY);
      } else {
        selectedNode = null;
        selectedNodePath = null;
        hideTooltip();
        if (elementPropertiesViewEl)
          elementPropertiesViewEl.innerHTML = "No element selected.";
        if (generatedXpathEl) generatedXpathEl.value = "";
        drawNodeOverlays();
        const RTreeEl = hierarchyTreeViewEl.querySelector(
          "li.tree-node-selected",
        );
        if (RTreeEl) RTreeEl.classList.remove("tree-node-selected");
        if (DEBUG_ELEMENT_FINDING)
          console.log(
            "CLICK_HANDLER: Clicked on empty space, selection cleared.",
          );
      }
    });
  }

  async function handleRunPythonCode() {
    const pythonOutput = document.getElementById("interactive-python-output");
    let code = "";
    if (
      window.PythonConsoleManager &&
      typeof window.PythonConsoleManager.getCode === "function"
    ) {
      code = window.PythonConsoleManager.getCode();
    } else {
      console.error("PythonConsoleManager or getCode method is not available.");
      alert("Python editor is not properly initialized.");
      return;
    }

    if (!currentDeviceSerial) {
      alert("Please select a device first to run Python code.");
      return;
    }
    if (!pythonOutput) {
      console.error(
        "Python output element (#interactive-python-output) not found.",
      );
      return;
    }
    if (!code.trim()) {
      alert("Please enter Python code to run.");
      return;
    }

    pythonOutput.textContent = "Executing Python code...";
    try {
      const responseData = await callBackend(
        "POST",
        `/api/android/${currentDeviceSerial}/interactive_python`,
        { code },
      );
      pythonOutput.textContent =
        typeof responseData === "object" &&
        responseData !== null &&
        responseData.hasOwnProperty("result")
          ? String(responseData.result)
          : String(responseData);
      console.log("Python execution output:", pythonOutput.textContent);
    } catch (e) {
      pythonOutput.textContent = `Error executing Python: ${e.message}`;
      console.error("Error in handleRunPythonCode:", e);
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
    const localRefreshScreenBtn = document.getElementById("refresh-screen-btn");
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
    const localDeviceHomeBtn = document.getElementById("device-home-btn");
    if (localDeviceHomeBtn)
      localDeviceHomeBtn.addEventListener("click", () =>
        sendDeviceCommand("home"),
      );
    const localDeviceBackBtn = document.getElementById("device-back-btn");
    if (localDeviceBackBtn)
      localDeviceBackBtn.addEventListener("click", () =>
        sendDeviceCommand("back"),
      );
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
    console.log(
      "local_inspector.js: Application initialize function completed.",
    );
  }

  if (typeof window.openTab !== "function") {
    console.log("local_inspector.js: Defining window.openTab");
    window.openTab = function (evt, tabName) {
      console.log(`window.openTab called for: ${tabName}`);
      let i, tc, tb;
      tc = document.getElementsByClassName("tab-content");
      for (i = 0; i < tc.length; i++) {
        tc[i].style.display = "none";
        tc[i].classList.remove("active");
      }
      tb = document.getElementsByClassName("tab-button");
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
    console.log("local_inspector.js: window.openTab was already defined.");
  }

  function initializeDefaultTab() {
    console.log("local_inspector.js: Initializing default tab...");
    const defaultTabNameFromHTML = document
      .querySelector("#panel-hierarchy-code .tab-button.active")
      ?.getAttribute("onclick")
      ?.match(/openTab\(event, ['"]([^'"]+)['"]\)/)?.[1];
    const defaultTabToOpen = defaultTabNameFromHTML || "hierarchy-tab-content";
    console.log(`Default tab to open: ${defaultTabToOpen}`);
    const defaultTabButton = Array.from(
      document.querySelectorAll("#panel-hierarchy-code .tab-button"),
    ).find((b) => {
      const o = b.getAttribute("onclick");
      return (
        o &&
        (o.includes("'" + defaultTabToOpen + "'") ||
          o.includes('"' + defaultTabToOpen + '"'))
      );
    });
    if (defaultTabButton && window.openTab) {
      console.log("Opening default tab via found button.");
      window.openTab({ currentTarget: defaultTabButton }, defaultTabToOpen);
    } else if (window.openTab) {
      console.log("Default tab button not found, trying first tab in group.");
      const firstTabInGroup = document.querySelector(
        "#panel-hierarchy-code .tab-button",
      );
      if (firstTabInGroup) {
        const onclickAttr = firstTabInGroup.getAttribute("onclick");
        const match = onclickAttr
          ? onclickAttr.match(/openTab\(event, ['"]([^'"]+)['"]\)/)
          : null;
        if (match && match[1]) {
          window.openTab({ currentTarget: firstTabInGroup }, match[1]);
        }
      } else {
        console.warn("No tab buttons found to initialize a default tab.");
      }
    } else {
      console.warn(
        "window.openTab not defined, cannot initialize default tab.",
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
