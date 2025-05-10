// uiautodev/static/local_inspector.js
document.addEventListener("DOMContentLoaded", function () {
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
  if (!messageArea || !deviceSelect) {
    console.error(
      "CRITICAL DOMContentLoaded: messageArea or deviceSelect element NOT FOUND.",
    );
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
  const refreshHierarchyBtn = document.getElementById("refresh-hierarchy-btn");
  // ... other element getters

  // --- State ---
  let currentDeviceSerial = null;
  let devices = [];
  let screenshotInterval = null;
  const SCREENSHOT_REFRESH_INTERVAL_MS = 5000;
  let currentHierarchyData = null;
  let isHierarchyLoading = false;
  let selectedNodePath = null;
  let selectedNode = null;
  let hoveredNode = null;
  let actualDeviceWidth = null;
  let actualDeviceHeight = null;

  const DEBUG_ELEMENT_FINDING = true;
  let canvasTooltip = null;

  function createCanvasTooltip() {
    if (!document.getElementById("canvas-tooltip-id")) {
      canvasTooltip = document.createElement("div");
      canvasTooltip.id = "canvas-tooltip-id";
      canvasTooltip.style.position = "absolute";
      canvasTooltip.style.display = "none";
      canvasTooltip.style.backgroundColor = "rgba(0, 0, 0, 0.85)";
      canvasTooltip.style.color = "#f0f0f0";
      canvasTooltip.style.padding = "8px 10px";
      canvasTooltip.style.borderRadius = "5px";
      canvasTooltip.style.fontSize = "12px";
      canvasTooltip.style.fontFamily =
        "Menlo, Monaco, Consolas, 'Courier New', monospace";
      canvasTooltip.style.pointerEvents = "none";
      canvasTooltip.style.zIndex = "10001";
      canvasTooltip.style.border = "1px solid #555";
      canvasTooltip.style.maxWidth = "380px"; // Slightly wider for potentially long XPaths
      canvasTooltip.style.maxHeight = "220px";
      canvasTooltip.style.overflowY = "auto";
      canvasTooltip.style.wordBreak = "break-all";
      canvasTooltip.style.lineHeight = "1.5";
      if (deviceScreenContainer) {
        deviceScreenContainer.appendChild(canvasTooltip);
        if (DEBUG_ELEMENT_FINDING)
          console.log(
            "Tooltip: Created and appended to deviceScreenContainer.",
          );
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
        } catch (e) {}
        console.error(
          `callBackend Error (${method} ${endpoint}): ${errorText}`,
        );
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
      if (messageArea)
        messageArea.innerHTML = `<span style='color: red;'>API Error: ${error.message.substring(0, 100)}</span>`;
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
      if (!deviceScreenImg.onloadAttached) {
        deviceScreenImg.onload = () => {
          deviceScreenImg.onloadAttached = false;
          setupOverlayCanvas();
        };
        deviceScreenImg.onloadAttached = true;
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
      if (DEBUG_ELEMENT_FINDING)
        console.warn(
          "drawNodeOverlays: currentHierarchyData is null, cannot draw overlays.",
        );
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

        if (rectW <= 0 || rectH <= 0) {
          // Do not draw zero-area or negative-area boxes
          // if(DEBUG_ELEMENT_FINDING) console.log("drawNodeOverlays: Skipping node with zero/negative area:", node.name, node.key, "W:", rectW, "H:", rectH);
          return;
        }
        overlayCtx.beginPath();
        overlayCtx.rect(rectX, rectY, rectW, rectH);

        let styleApplied = false;
        if (selectedNode && selectedNode.key === node.key) {
          overlayCtx.strokeStyle = "rgba(255,0,0,0.9)";
          overlayCtx.lineWidth = 2;
          if (DEBUG_ELEMENT_FINDING)
            console.log(
              `DRAW_SELECTED: Preparing to stroke selected ${node.name} (Key:${node.key}) at [${rectX.toFixed(1)},${rectY.toFixed(1)},${rectW.toFixed(1)},${rectH.toFixed(1)}] with ${overlayCtx.strokeStyle}`,
            );
          styleApplied = true;
        } else if (hoveredNode && hoveredNode.key === node.key) {
          overlayCtx.strokeStyle = "rgba(0,120,255,0.9)";
          overlayCtx.lineWidth = 2;
          styleApplied = true;
        } else {
          overlayCtx.strokeStyle = "rgba(150,150,150,0.4)";
          overlayCtx.lineWidth = 1;
          // No need to set styleApplied = true for default, only for specific highlights
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
        console.warn(
          "Tooltip: updateAndShowTooltip - Prerequisites not met (canvasTooltip, node, or deviceScreenContainer). Node:",
          node,
        );
      hideTooltip();
      return;
    }
    // if (DEBUG_ELEMENT_FINDING) console.log("Tooltip: updateAndShowTooltip - Updating for node:", node.name, "Key:", node.key, "at mouse", pageX, pageY);
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
      canvasTooltip.innerHTML = `
        <div style="margin-bottom:3px; font-weight:bold; color:#92c9ff;">${escapeHtml(name)}</div>
        <div style="margin-bottom:3px;">${escapeHtml(rectInfo)}</div>
        <div style="margin-bottom:3px;"><span style="color:#888;">Desc:</span> ${escapeHtml(contentDesc)}</div>
        <div style="margin-bottom:3px;"><span style="color:#888;">ID:</span> ${escapeHtml(resourceId)}</div>
        <div><span style="color:#888;">XPath:</span> ${escapeHtml(xpath)}</div>`;
      const containerRect = deviceScreenContainer.getBoundingClientRect();
      let targetX = pageX - containerRect.left + 25; // 25px to the right of cursor
      let targetY = pageY - containerRect.top + 15; // 15px below cursor
      if (
        targetX + canvasTooltip.offsetWidth >
        deviceScreenContainer.clientWidth - 10
      ) {
        // 10px padding from edge
        targetX = pageX - containerRect.left - canvasTooltip.offsetWidth - 25; // Try 25px left of cursor
      }
      if (targetX < 5) targetX = 5;
      if (
        targetY + canvasTooltip.offsetHeight >
        deviceScreenContainer.clientHeight - 10
      ) {
        // 10px padding from edge
        targetY = pageY - containerRect.top - canvasTooltip.offsetHeight - 15; // Try 15px above cursor
      }
      if (targetY < 5) targetY = 5;
      canvasTooltip.style.left = `${Math.max(0, targetX)}px`;
      canvasTooltip.style.top = `${Math.max(0, targetY)}px`;
      canvasTooltip.style.display = "block";
      // if (DEBUG_ELEMENT_FINDING) {
      //   console.log("Tooltip: Displayed. Content:", canvasTooltip.textContent.replace(/\s\s+/g, ' ').substring(0,100)+"...");
      //   console.log("Tooltip: Style - top:", canvasTooltip.style.top, "left:", canvasTooltip.style.left, "display:", canvasTooltip.style.display);
      // }
    } catch (e) {
      console.error("Error in updateAndShowTooltip:", e, "for node:", node);
      hideTooltip();
    }
  }
  function hideTooltip() {
    if (canvasTooltip) {
      // if (DEBUG_ELEMENT_FINDING && canvasTooltip.style.display !== 'none') console.log("Tooltip: Hiding tooltip.");
      canvasTooltip.style.display = "none";
    }
  }

  function startScreenshotAutoRefresh() {
    stopScreenshotAutoRefresh();
    if (currentDeviceSerial) {
      fetchAndDisplayScreenshot();
      screenshotInterval = setInterval(
        fetchAndDisplayScreenshot,
        SCREENSHOT_REFRESH_INTERVAL_MS,
      );
    }
  }
  function stopScreenshotAutoRefresh() {
    if (screenshotInterval) clearInterval(screenshotInterval);
    screenshotInterval = null;
  }
  async function loadDeviceList() {
    if (messageArea) messageArea.textContent = "Loading devices...";
    if (deviceSelect) deviceSelect.disabled = true;
    try {
      const data = await callBackend("GET", "/api/android/list");
      devices = Array.isArray(data) ? data : [];
      populateDeviceDropdown(devices);
      if (devices.length > 0) {
        const lastSerial = localStorage.getItem("lastSelectedDeviceSerial");
        const deviceToSelect =
          devices.find((d) => d.serial === lastSerial) || devices[0];
        if (deviceToSelect) deviceSelect.value = deviceToSelect.serial;
        if (messageArea) messageArea.textContent = "Select a device.";
      } else {
        if (messageArea) messageArea.textContent = "No devices found.";
        clearDeviceInfo();
      }
      await handleDeviceSelectionChange(); // This will trigger hierarchy load if needed
    } catch (e) {
      console.error("loadDeviceList CATCH:", e.message);
      if (deviceSelect)
        deviceSelect.innerHTML = `<option value="">Err:${e.message.substring(0, 20)}</option>`;
      if (messageArea) messageArea.textContent = `Error: ${e.message}`;
    } finally {
      if (deviceSelect) deviceSelect.disabled = false;
    }
  }
  function populateDeviceDropdown(deviceData) {
    if (!deviceSelect) return;
    deviceSelect.innerHTML = "";
    if (!deviceData || deviceData.length === 0) {
      deviceSelect.innerHTML = '<option value="">No devices</option>';
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
    if (deviceScreenImg) {
      deviceScreenImg.src =
        "https://placehold.co/360x640/e9e9e9/777?text=NoDevice";
      deviceScreenImg.style.width = "auto";
      deviceScreenImg.style.height = "auto";
    }
    if (overlayCanvas) {
      overlayCanvas.width = 0;
      overlayCanvas.height = 0;
    }
    if (hierarchyTreeViewEl) hierarchyTreeViewEl.innerHTML = "No device.";
    if (elementPropertiesViewEl) elementPropertiesViewEl.innerHTML = "";
    if (generatedXpathEl) generatedXpathEl.value = "";
  }

  async function handleDeviceSelectionChange() {
    if (!deviceSelect) return;
    currentDeviceSerial = deviceSelect.value;
    localStorage.setItem("lastSelectedDeviceSerial", currentDeviceSerial);
    selectedNode = null;
    selectedNodePath = null;
    hoveredNode = null;
    hideTooltip();
    currentHierarchyData = null;
    isHierarchyLoading = false;
    if (overlayCtx)
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (currentDeviceSerial) {
      if (messageArea)
        messageArea.textContent = `Loading ${currentDeviceSerial}...`;
      await fetchAndDisplayScreenshot();
      const iTab = document.getElementById("inspector-tab");
      if (iTab && iTab.classList.contains("active")) {
        await fetchAndRenderHierarchy();
      } else {
        if (DEBUG_ELEMENT_FINDING)
          console.log(
            "Inspector tab not active on device change, hierarchy will load when tab is opened.",
          );
      }
      startScreenshotAutoRefresh();
    } else {
      clearDeviceInfo();
      if (messageArea) messageArea.textContent = "No device selected.";
      stopScreenshotAutoRefresh();
    }
  }

  async function fetchAndDisplayScreenshot() {
    if (!currentDeviceSerial || !deviceScreenImg) return;
    deviceScreenImg.removeAttribute("src");
    deviceScreenImg.src =
      "https://placehold.co/360x640/e9e9e9/777?text=Loading...";
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
      if (blob instanceof Blob && blob.size > 0) {
        deviceScreenImg.onload = () => {
          deviceScreenImg.onloadAttached = false;
          actualDeviceWidth = deviceScreenImg.naturalWidth;
          actualDeviceHeight = deviceScreenImg.naturalHeight;
          if (DEBUG_ELEMENT_FINDING)
            console.log(
              "SCREENSHOT: Loaded, actualDeviceWidth:",
              actualDeviceWidth,
              "actualDeviceHeight:",
              actualDeviceHeight,
            );
          setupOverlayCanvas();
        };
        deviceScreenImg.onloadAttached = true;
        deviceScreenImg.onerror = () => {
          deviceScreenImg.src =
            "https://placehold.co/360x640/e9e9e9/777?text=LoadErr";
          setupOverlayCanvas();
        };
        deviceScreenImg.src = URL.createObjectURL(blob);
      } else {
        deviceScreenImg.onload = null;
        deviceScreenImg.src =
          "https://placehold.co/360x640/e9e9e9/777?text=NoData";
        setupOverlayCanvas();
      }
    } catch (e) {
      deviceScreenImg.onload = null;
      deviceScreenImg.src =
        "https://placehold.co/360x640/e9e9e9/777?text=FetchErr";
      setupOverlayCanvas();
    }
  }

  async function fetchAndRenderHierarchy() {
    if (!currentDeviceSerial || !hierarchyTreeViewEl) {
      if (DEBUG_ELEMENT_FINDING)
        console.warn(
          "HIERARCHY: Pre-conditions not met for fetch (no serial or tree view).",
        );
      return;
    }
    if (isHierarchyLoading) {
      if (DEBUG_ELEMENT_FINDING)
        console.warn("HIERARCHY: Fetch already in progress. Skipping.");
      return;
    }
    if (DEBUG_ELEMENT_FINDING)
      console.log("HIERARCHY: Starting fetchAndRenderHierarchy...");
    isHierarchyLoading = true;
    hierarchyTreeViewEl.innerHTML = "Loading hierarchy...";
    currentHierarchyData = null;
    if (overlayCtx)
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    try {
      const hData = await callBackend(
        "GET",
        `/api/android/${currentDeviceSerial}/hierarchy?format=json`,
      );
      if (hData && typeof hData === "object" && hData.name) {
        currentHierarchyData = hData;
        if (
          hData.rect &&
          typeof hData.rect.width === "number" &&
          typeof hData.rect.height === "number"
        ) {
          // Only set actualDeviceWidth/Height from hierarchy if not already set by screenshot (which is usually more accurate for physical pixels)
          if (!actualDeviceWidth && hData.rect.width > 0)
            actualDeviceWidth = hData.rect.x + hData.rect.width;
          if (!actualDeviceHeight && hData.rect.height > 0)
            actualDeviceHeight = hData.rect.y + hData.rect.height;
        }
        if (
          deviceScreenImg &&
          deviceScreenImg.naturalWidth === 0 &&
          actualDeviceWidth &&
          actualDeviceHeight
        )
          setupOverlayCanvas();
        renderHierarchyTree(currentHierarchyData, hierarchyTreeViewEl);
        if (messageArea)
          messageArea.textContent =
            "Hierarchy loaded. You can now interact with the screen.";
        drawNodeOverlays();
        if (DEBUG_ELEMENT_FINDING)
          console.log(
            "HIERARCHY: Successfully fetched and rendered. currentHierarchyData is SET.",
          );
      } else {
        console.error(
          "HIERARCHY: Failed to load or parse hierarchy data. Response:",
          hData,
        );
        hierarchyTreeViewEl.innerHTML =
          "Failed to load hierarchy. Check console for details.";
        currentHierarchyData = null;
        if (messageArea) messageArea.textContent = "Failed to load hierarchy.";
        if (overlayCtx)
          overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      }
    } catch (e) {
      console.error(
        "HIERARCHY: Exception during fetchAndRenderHierarchy:",
        e.message,
      );
      hierarchyTreeViewEl.innerHTML = `Error loading hierarchy: ${e.message.substring(0, 100)}`;
      currentHierarchyData = null;
      if (messageArea) messageArea.textContent = `Error loading hierarchy.`;
      if (overlayCtx)
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    } finally {
      isHierarchyLoading = false;
      if (DEBUG_ELEMENT_FINDING)
        console.log(
          "HIERARCHY: fetchAndRenderHierarchy finished. Loading flag reset.",
        );
    }
  }

  function renderHierarchyTree(node, parentElement) {
    /* ... (same) ... */
    if (!node) return;
    if (parentElement === hierarchyTreeViewEl) parentElement.innerHTML = "";
    const li = document.createElement("li");
    let txt = `${node.name || "Node"}`;
    if (node.properties) {
      if (node.properties["resource-id"])
        txt += ` <small>(id:${node.properties["resource-id"].split("/").pop()})</small>`;
      else if (node.properties["text"])
        txt += ` <small>(text:"${escapeHtml((node.properties["text"] || "").substring(0, 20))}")</small>`;
    }
    li.innerHTML = txt;
    li.dataset.nodePath = node.key;
    if (node.key === selectedNodePath) li.classList.add("selected-node");
    li.addEventListener("click", (evt) => {
      evt.stopPropagation();
      selectedNodePath = node.key;
      selectedNode = node;
      if (DEBUG_ELEMENT_FINDING)
        console.log(
          `HIERARCHY_CLICK: Tree node selected - ${selectedNode ? selectedNode.name : "None"} (Key: ${node.key})`,
        );
      displayNodeProperties(node);
      drawNodeOverlays();
      const currentlySelectedLi =
        hierarchyTreeViewEl.querySelector("li.selected-node");
      if (currentlySelectedLi)
        currentlySelectedLi.classList.remove("selected-node");
      li.classList.add("selected-node");
    });
    parentElement.appendChild(li);
    if (node.children) node.children.forEach((c) => renderHierarchyTree(c, li));
  }
  function displayNodeProperties(node) {
    /* ... (same) ... */
    if (!elementPropertiesViewEl || !generatedXpathEl) return;
    if (!node) {
      elementPropertiesViewEl.innerHTML = "No node selected.";
      generatedXpathEl.value = "";
      return;
    }
    let html = "<table>";
    if (node.properties)
      for (const k in node.properties)
        html += `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(String(node.properties[k]))}</td></tr>`;
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
    /* ... (same) ... */ return String(unsafe)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  function generateBasicXPath(node) {
    /* ... (same) ... */
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

  function findElementAtCanvasCoordinates(canvasX, canvasY) {
    if (DEBUG_ELEMENT_FINDING)
      console.log(
        `findElementAtCanvasCoordinates: Entry (X:${canvasX.toFixed(1)}, Y:${canvasY.toFixed(1)}). currentHierarchyData is ${currentHierarchyData ? "PRESENT" : "NULL"}`,
      );
    if (!currentHierarchyData) {
      if (DEBUG_ELEMENT_FINDING)
        console.warn(
          "findElementAtCanvasCoordinates: currentHierarchyData is null. Cannot find element.",
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
            `CanvasInteraction DBG: Root node for search ('${hierarchyToSearch.name || "Unnamed Root"}', Key: '${hierarchyToSearch.key || "Unknown Key"}') has missing/invalid/NaN bounds. Applying default [0.0, 0.0, 1.0, 1.0]. Original bounds:`,
            hierarchyToSearch.bounds,
          );
        hierarchyToSearch = {
          ...hierarchyToSearch,
          bounds: [0.0, 0.0, 1.0, 1.0],
        };
      }
    } else {
      if (DEBUG_ELEMENT_FINDING)
        console.error(
          "Logic Error: hierarchyToSearch became null after currentHierarchyData check.",
        );
      return null;
    }

    const found = findElementAtRelativeCoordinates(
      hierarchyToSearch,
      relX,
      relY,
      "root",
      0,
    ); // Pass initial depth

    if (DEBUG_ELEMENT_FINDING)
      console.log(
        `findElementAtCanvasCoordinates: Final result - ${found ? found.name + " (Key:" + found.key + ")" : "None"}`,
      );
    return found;
  }

  // Modified findElementAtRelativeCoordinates to potentially favor smaller, clickable elements
  function findElementAtRelativeCoordinates(
    node,
    relX,
    relY,
    pathForDebug,
    depth,
  ) {
    if (!node) return null;
    if (
      !node.bounds ||
      !Array.isArray(node.bounds) ||
      node.bounds.length !== 4 ||
      node.bounds.some((b) => typeof b !== "number" || isNaN(b))
    ) {
      // if (DEBUG_ELEMENT_FINDING && pathForDebug === "root") console.warn(`  Recursive Find: Path ${pathForDebug} - Node ${node.name || node.key || "Unknown"} has invalid/NaN bounds:`, node.bounds);
      return null;
    }

    const [x1, y1, x2, y2] = node.bounds;
    const nodeWidth = x2 - x1;
    const nodeHeight = y2 - y1;
    if (nodeWidth <= 0 || nodeHeight <= 0) return null;

    const isXWithin = relX >= x1 && relX <= x2;
    const isYWithin = relY >= y1 && relY <= y2;

    if (isXWithin && isYWithin) {
      let bestMatch = node; // Current node is a candidate.

      if (node.children && node.children.length > 0) {
        for (let i = 0; i < node.children.length; i++) {
          const child = node.children[i];
          if (child && typeof child === "object") {
            const childCandidate = findElementAtRelativeCoordinates(
              child,
              relX,
              relY,
              pathForDebug + "/" + i,
              depth + 1,
            );
            if (childCandidate) {
              // Heuristic to prefer a more specific (often smaller, clickable) child
              if (
                bestMatch === node || // current bestMatch is the parent itself
                (childCandidate.properties?.clickable === "true" &&
                  bestMatch.properties?.clickable !== "true") || // child is clickable, parent isn't
                ((childCandidate.bounds[2] - childCandidate.bounds[0]) *
                  (childCandidate.bounds[3] - childCandidate.bounds[1]) <
                  (bestMatch.bounds[2] - bestMatch.bounds[0]) *
                    (bestMatch.bounds[3] - bestMatch.bounds[1]) &&
                  !(bestMatch.properties?.clickable === "true")) // child is smaller and current best isn't clickable
              ) {
                // If the child is significantly smaller, or more interactive, it's often a better target than a large container parent.
                // This helps "pierce" through large containers if a more specific child is found.
                // However, we still need to ensure the deepest specific match is found.
                // The recursive nature should handle "deepest". This logic is more about "better" at the same effective visual layer.

                // The current recursive approach for `bestMatch` is "deepest wins". Let's keep that for now
                // and address the "greedy overlay" by a different filter if needed or by enhancing this heuristic.
                // For now, simple deepest wins:
                bestMatch = childCandidate;
              }
            }
          }
        }
      }
      return bestMatch; // This will be the deepest node that geometrically matches.
    }
    return null;
  }

  if (overlayCanvas) {
    overlayCanvas.addEventListener("mousemove", function (event) {
      if (!currentHierarchyData || !overlayCtx || isHierarchyLoading) return;
      const rect = overlayCanvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const nodeUnderMouse = findElementAtCanvasCoordinates(x, y);
      if (hoveredNode?.key !== nodeUnderMouse?.key) {
        // if (DEBUG_ELEMENT_FINDING && nodeUnderMouse) console.log("MOUSEMOVE: Hover changed to ->", nodeUnderMouse.name, nodeUnderMouse.key);
        // else if (DEBUG_ELEMENT_FINDING && !nodeUnderMouse && hoveredNode) console.log("MOUSEMOVE: Hover ended from", hoveredNode.name, hoveredNode.key);
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
        console.warn(
          "CLICK_HANDLER: Click ignored, hierarchy not loaded or is loading.",
        );
        if (messageArea)
          messageArea.textContent =
            "Hierarchy is loading or not available. Please wait or refresh.";
        return;
      }
      const rect = overlayCanvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (DEBUG_ELEMENT_FINDING)
        console.log(
          "CLICK_HANDLER: Click event triggered at canvas coords:",
          x.toFixed(1),
          y.toFixed(1),
        );
      const clickedNode = findElementAtCanvasCoordinates(x, y);
      console.log(
        `CLICK_HANDLER: Node found by findElementAtCanvasCoordinates: ${clickedNode ? clickedNode.name + " (Key:" + clickedNode.key + ")" : "None"}`,
      );
      if (clickedNode) {
        selectedNode = clickedNode;
        selectedNodePath = clickedNode.key;
        if (DEBUG_ELEMENT_FINDING)
          console.log(
            `CLICK_HANDLER: Set selectedNode to ${selectedNode.name} (Key: ${selectedNodePath})`,
          );
        drawNodeOverlays();
        displayNodeProperties(selectedNode);
        updateAndShowTooltip(selectedNode, event.pageX, event.pageY);
        if (generatedXpathEl)
          generatedXpathEl.value = generateBasicXPath(selectedNode);
        const RTreeElOld =
          hierarchyTreeViewEl.querySelector("li.selected-node");
        if (RTreeElOld) RTreeElOld.classList.remove("selected-node");
        const RTreeElNew = hierarchyTreeViewEl.querySelector(
          `li[data-node-path="${selectedNodePath}"]`,
        );
        if (RTreeElNew) {
          RTreeElNew.classList.add("selected-node");
          if (DEBUG_ELEMENT_FINDING)
            console.log(
              "CLICK_HANDLER: Highlighted in hierarchy tree for path:",
              selectedNodePath,
            );
        } else {
          if (DEBUG_ELEMENT_FINDING)
            console.warn(
              "CLICK_HANDLER: Could not find <li> in hierarchy tree for path:",
              selectedNodePath,
            );
        }
      } else {
        selectedNode = null;
        selectedNodePath = null;
        hideTooltip();
        if (elementPropertiesViewEl)
          elementPropertiesViewEl.innerHTML = "No element selected.";
        if (generatedXpathEl) generatedXpathEl.value = "";
        drawNodeOverlays();
        const RTreeEl = hierarchyTreeViewEl.querySelector("li.selected-node");
        if (RTreeEl) RTreeEl.classList.remove("selected-node");
        if (DEBUG_ELEMENT_FINDING)
          console.log(
            "CLICK_HANDLER: Clicked on empty space, selection cleared.",
          );
      }
    });
  }

  async function handleRunPythonCode() {
    /* ... (same) ... */
    if (!currentDeviceSerial || !pythonEditor || !pythonOutput) return;
    const code = pythonEditor.value;
    if (!code.trim()) {
      alert("Enter Python code.");
      return;
    }
    pythonOutput.textContent = "Executing...";
    try {
      const output = await callBackend(
        "POST",
        `/api/android/${currentDeviceSerial}/interactive_python`,
        { code },
      );
      pythonOutput.textContent = String(output);
    } catch (e) {
      pythonOutput.textContent = `Error: ${e.message}`;
    }
  }
  async function sendDeviceCommand(commandName) {
    /* ... (same) ... */
    if (!currentDeviceSerial) {
      alert("Select device.");
      return;
    }
    if (messageArea) messageArea.textContent = `Sending: ${commandName}...`;
    try {
      await callBackend(
        "POST",
        `/api/android/${currentDeviceSerial}/command/${commandName}`,
        {},
      );
      if (messageArea)
        messageArea.textContent = `Command '${commandName}' sent.`;
      if (["home", "back"].includes(commandName))
        setTimeout(fetchAndDisplayScreenshot, 300);
    } catch (e) {
      if (messageArea) messageArea.textContent = `Error: ${e.message}`;
    }
  }

  function initialize() {
    /* ... (same, with button consts local if not already) ... */
    if (messageArea)
      messageArea.innerHTML =
        "<span style='color: blue;'>Initializing...</span>";
    createCanvasTooltip();
    if (deviceSelect) loadDeviceList();
    else if (messageArea)
      messageArea.innerHTML =
        "<span style='color: red;'>UI Error: device-select missing.</span>";
    window.addEventListener("resize", setupOverlayCanvas);
    if (deviceScreenImg) {
      if (!deviceScreenImg.onloadAttachedToInspector) {
        deviceScreenImg.addEventListener("load", setupOverlayCanvas);
        deviceScreenImg.onloadAttachedToInspector = true;
      }
    } else console.warn("Init: deviceScreenImg not found");
    const localRefreshScreenBtn = document.getElementById("refresh-screen-btn"); // Ensure using local consts
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
    if (localRefreshHierarchyBtn)
      localRefreshHierarchyBtn.addEventListener(
        "click",
        fetchAndRenderHierarchy,
      );
  }

  if (typeof window.openTab !== "function") {
    /* ... (same openTab definition) ... */
    window.openTab = function (evt, tabName) {
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
      if (
        tabName === "inspector-tab" &&
        !currentHierarchyData &&
        !isHierarchyLoading &&
        currentDeviceSerial
      ) {
        if (DEBUG_ELEMENT_FINDING)
          console.log("Inspector tab opened/focused, fetching hierarchy...");
        fetchAndRenderHierarchy();
      }
    };
  }

  const defaultTabNameFromHTML = document.querySelector(".tab-button.active")
    ? document
        .querySelector(".tab-button.active")
        .getAttribute("onclick")
        ?.match(/openTab\(event, ['"]([^'"]+)['"]\)/)?.[1]
    : null;
  const defaultTabToOpen = defaultTabNameFromHTML || "interactive-python-tab";
  const defaultTabButton = Array.from(
    document.querySelectorAll(".tab-button"),
  ).find((b) => {
    const o = b.getAttribute("onclick");
    return (
      o &&
      (o.includes("'" + defaultTabToOpen + "'") ||
        o.includes('"' + defaultTabToOpen + '"'))
    );
  });
  if (defaultTabButton && window.openTab) {
    window.openTab({ currentTarget: defaultTabButton }, defaultTabToOpen);
  } else if (window.openTab) {
    const firstTabButton = document.querySelector(".tab-button");
    if (firstTabButton) {
      const onclickAttr = firstTabButton.getAttribute("onclick");
      const match = onclickAttr
        ? onclickAttr.match(/openTab\(event, ['"]([^'"]+)['"]\)/)
        : null;
      if (match && match[1])
        window.openTab({ currentTarget: firstTabButton }, match[1]);
    }
  }

  initialize();
});
