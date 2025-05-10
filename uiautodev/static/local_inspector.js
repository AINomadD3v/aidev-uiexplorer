// uiautodev/static/local_inspector.js

document.addEventListener("DOMContentLoaded", function () {
  // --- Configuration ---
  const EXTENSION_ID = "fjbboaelofjaabjmlphndicacmapbalm"; // Keep for now if any part still uses it, otherwise remove if fully direct fetch

  // --- DOM Elements ---
  const messageArea = document.getElementById("message-area");
  const deviceSelect = document.getElementById("device-select");
  const deviceSerialEl = document.getElementById("device-serial");
  const deviceModelEl = document.getElementById("device-model");
  const deviceSdkEl = document.getElementById("device-sdk");
  const deviceScreenImg = document.getElementById("current-device-screen");
  const deviceScreenContainer = document.querySelector(
    ".device-screen-container",
  ); // For screenshot dimensions
  const highlightBox = document.getElementById("highlight-box");
  const refreshScreenBtn = document.getElementById("refresh-screen-btn");
  const deviceHomeBtn = document.getElementById("device-home-btn");
  const deviceBackBtn = document.getElementById("device-back-btn");

  // Python Console Elements
  const pythonEditor = document.getElementById("interactive-python-editor");
  const runPythonBtn = document.getElementById("run-python-button");
  const pythonOutput = document.getElementById("interactive-python-output");

  // Inspector Tab Elements
  const inspectorTab = document.getElementById("inspector-tab");
  const refreshHierarchyBtn = document.getElementById("refresh-hierarchy-btn");
  const hierarchyTreeViewEl = document.getElementById("hierarchy-tree-view");
  const elementPropertiesViewEl = document.getElementById(
    "element-properties-view",
  );
  const generatedXpathEl = document.getElementById("generated-xpath");

  // --- State ---
  let currentDeviceSerial = null;
  let devices = [];
  let screenshotInterval = null;
  const SCREENSHOT_REFRESH_INTERVAL_MS = 5000; // Auto-refresh screenshot every 5 seconds

  let currentHierarchyData = null; // To store the fetched UI hierarchy
  let selectedNodePath = null; // To store the "key" of the selected node in the tree
  let actualDeviceWidth = null; // To store actual device width for coordinate mapping
  let actualDeviceHeight = null; // To store actual device height

  // --- API Helper (Direct Fetch) ---
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
        let errorText = `HTTP error ${response.status}: ${response.statusText}`;
        try {
          const errorData = await response.json();
          if (errorData && (errorData.error || errorData.detail)) {
            errorText = `Error: ${errorData.error || errorData.detail} (Status: ${response.status})`;
          }
        } catch (e) {
          /* ignore */
        }
        console.error(`Backend Error for ${method} ${endpoint}:`, errorText);
        throw new Error(errorText);
      }
      const contentType = response.headers.get("content-type");
      if (expectBlob) {
        if (contentType && contentType.startsWith("image/"))
          return response.blob();
        console.warn(
          `Expected blob for ${endpoint}, but got ${contentType}. Trying text.`,
        );
        return response.text();
      } else if (contentType && contentType.includes("application/json"))
        return response.json();
      else if (contentType && contentType.includes("text/plain"))
        return response.text();
      else {
        console.warn(
          `Unexpected content type "${contentType}" for ${endpoint}. Reading as text.`,
        );
        return response.text();
      }
    } catch (error) {
      console.error(`Fetch Error for ${method} ${endpoint}:`, error);
      messageArea.innerHTML = `<span style='color: red;'>Network/Server Error: ${error.message}. Check server logs.</span>`;
      throw error;
    }
  }

  // --- Device Management ---
  async function loadDeviceList() {
    messageArea.textContent = "Loading devices...";
    deviceSelect.disabled = true;
    try {
      const data = await callBackend("GET", "/api/android/list");
      devices = data || [];
      populateDeviceDropdown(devices);
      if (devices.length > 0) {
        const lastSerial = localStorage.getItem("lastSelectedDeviceSerial");
        deviceSelect.value =
          lastSerial && devices.some((d) => d.serial === lastSerial)
            ? lastSerial
            : devices[0].serial;
        messageArea.textContent = "Select a device or refresh hierarchy.";
      } else {
        deviceSelect.innerHTML = '<option value="">No devices found</option>';
        messageArea.textContent =
          "No Android devices found. Connect a device and ensure ADB is working.";
        clearDeviceInfo();
      }
      await handleDeviceSelectionChange(); // Ensure UI updates after list load
    } catch (error) {
      deviceSelect.innerHTML =
        '<option value="">Error loading devices</option>';
      messageArea.textContent = `Error loading devices: ${error.message}`;
    } finally {
      deviceSelect.disabled = false;
    }
  }

  function populateDeviceDropdown(deviceData) {
    deviceSelect.innerHTML = "";
    if (!deviceData || deviceData.length === 0) {
      deviceSelect.innerHTML = '<option value="">No devices found</option>';
      return;
    }
    deviceData.forEach((device) => {
      const option = document.createElement("option");
      option.value = device.serial;
      option.textContent = `${device.model || device.serial} (SDK: ${device.sdkVersion || "N/A"}, ID: ${device.id || "N/A"})`;
      deviceSelect.appendChild(option);
    });
  }

  function clearDeviceInfo() {
    deviceSerialEl.textContent = "N/A";
    deviceModelEl.textContent = "N/A";
    deviceSdkEl.textContent = "N/A";
    deviceScreenImg.src =
      "https://placehold.co/360x640/e9e9e9/777?text=No+Device+Selected";
    deviceScreenImg.alt = "No Device Selected";
    currentHierarchyData = null;
    hierarchyTreeViewEl.innerHTML =
      "No device selected or hierarchy not loaded.";
    elementPropertiesViewEl.innerHTML = "Select an element.";
    generatedXpathEl.value = "";
    stopScreenshotAutoRefresh();
    hideHighlightBox();
  }

  async function handleDeviceSelectionChange() {
    currentDeviceSerial = deviceSelect.value;
    localStorage.setItem("lastSelectedDeviceSerial", currentDeviceSerial);
    if (currentDeviceSerial) {
      const selectedDevice = devices.find(
        (d) => d.serial === currentDeviceSerial,
      );
      if (selectedDevice) {
        deviceSerialEl.textContent = selectedDevice.serial;
        deviceModelEl.textContent = selectedDevice.model || "Unknown";
        deviceSdkEl.textContent = selectedDevice.sdkVersion || "Unknown";
        messageArea.textContent = `Selected device: ${selectedDevice.model || selectedDevice.serial}.`;
      }
      await fetchAndDisplayScreenshot(); // Fetch screenshot first
      await fetchDeviceWindowSize(); // Then fetch window size
      startScreenshotAutoRefresh();
      if (
        document.getElementById("inspector-tab").classList.contains("active")
      ) {
        await fetchAndRenderHierarchy(); // Fetch hierarchy if inspector tab is active
      }
    } else {
      clearDeviceInfo();
      messageArea.textContent = "No device selected.";
    }
  }

  async function fetchDeviceWindowSize() {
    if (!currentDeviceSerial) return;
    try {
      // Assuming you have an endpoint or can get this from d.info via interactive_python
      // For now, let's placeholder:
      // const windowSizeData = await callBackend('GET', `/api/android/${currentDeviceSerial}/command/getWindowSize`);
      // actualDeviceWidth = windowSizeData.width;
      // actualDeviceHeight = windowSizeData.height;
      // console.log("Device window size:", actualDeviceWidth, actualDeviceHeight);
      // As a fallback, try to get it from a d.info call if needed, or parse from hierarchy if available
      // For now, we'll rely on the hierarchy data's root node rect if available, or screenshot natural dimensions
      console.warn(
        "fetchDeviceWindowSize: Needs a reliable way to get actual device dimensions.",
      );
    } catch (error) {
      console.error("Error fetching device window size:", error);
    }
  }

  // --- Screenshot Functions ---
  async function fetchAndDisplayScreenshot() {
    if (!currentDeviceSerial) return;
    const timestamp = new Date().getTime();
    try {
      const blob = await callBackend(
        "GET",
        `/api/android/${currentDeviceSerial}/screenshot/0?t=${timestamp}`,
        null,
        true,
      );
      if (blob instanceof Blob) {
        deviceScreenImg.src = URL.createObjectURL(blob);
        deviceScreenImg.alt = `Device Screen (${currentDeviceSerial})`;
        // After image loads, we can get its displayed dimensions
        deviceScreenImg.onload = () => {
          console.log(
            `Screenshot displayed: ${deviceScreenImg.clientWidth}x${deviceScreenImg.clientHeight}, natural: ${deviceScreenImg.naturalWidth}x${deviceScreenImg.naturalHeight}`,
          );
          // If actualDeviceWidth/Height are not set, use natural dimensions as a fallback
          if (!actualDeviceWidth || !actualDeviceHeight) {
            actualDeviceWidth = deviceScreenImg.naturalWidth;
            actualDeviceHeight = deviceScreenImg.naturalHeight;
            console.log(
              `Using screenshot natural dimensions for device size: ${actualDeviceWidth}x${actualDeviceHeight}`,
            );
          }
        };
      } else {
        deviceScreenImg.src =
          "https://placehold.co/360x640/e9e9e9/777?text=No+Screenshot+Data";
      }
    } catch (error) {
      deviceScreenImg.alt = "Error loading screenshot";
      deviceScreenImg.src =
        "https://placehold.co/360x640/e9e9e9/777?text=Error+Loading+Screen";
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

  // --- UI Inspector Functions ---
  async function fetchAndRenderHierarchy() {
    if (!currentDeviceSerial) {
      hierarchyTreeViewEl.innerHTML = "Please select a device.";
      return;
    }
    hierarchyTreeViewEl.innerHTML = "Loading hierarchy...";
    elementPropertiesViewEl.innerHTML = "Select an element.";
    generatedXpathEl.value = "";
    hideHighlightBox();

    try {
      const hierarchyData = await callBackend(
        "GET",
        `/api/android/${currentDeviceSerial}/hierarchy?format=json`,
      );
      if (hierarchyData && hierarchyData.name) {
        // Check if root node exists
        currentHierarchyData = hierarchyData; // Store the whole hierarchy (root node)
        // Update actual device dimensions if available from root node's rect (absolute pixels)
        // This is a good place if the hierarchy provides the screen dimensions.
        // The 'bounds' in the Node model are relative, 'rect' is absolute.
        // Let's assume the root node's rect gives us the screen size.
        if (currentHierarchyData.rect) {
          actualDeviceWidth =
            currentHierarchyData.rect.width + currentHierarchyData.rect.x; // If rect.x is 0
          actualDeviceHeight =
            currentHierarchyData.rect.height + currentHierarchyData.rect.y; // If rect.y is 0
          console.log(
            `Device dimensions from hierarchy root: ${actualDeviceWidth}x${actualDeviceHeight}`,
          );
        } else if (
          currentHierarchyData.properties &&
          currentHierarchyData.properties.bounds
        ) {
          // Fallback: try to parse from root node properties if rect is not directly there
          // This depends on how 'bounds' string is formatted in properties.
          // Example: "[0,0][1080,1920]"
          const boundsStr = currentHierarchyData.properties.bounds;
          const coords = boundsStr.match(/\d+/g); // Extracts all numbers
          if (coords && coords.length === 4) {
            actualDeviceWidth = parseInt(coords[2]);
            actualDeviceHeight = parseInt(coords[3]);
            console.log(
              `Device dimensions from hierarchy root properties.bounds: ${actualDeviceWidth}x${actualDeviceHeight}`,
            );
          }
        }

        renderHierarchyTree(
          currentHierarchyData,
          hierarchyTreeViewEl,
          currentHierarchyData.key,
        );
        messageArea.textContent =
          "Hierarchy loaded. Click on elements to inspect.";
      } else {
        hierarchyTreeViewEl.innerHTML =
          "Failed to load hierarchy or data is empty.";
        currentHierarchyData = null;
      }
    } catch (error) {
      hierarchyTreeViewEl.innerHTML = `Error loading hierarchy: ${error.message}`;
      currentHierarchyData = null;
    }
  }

  function renderHierarchyTree(node, parentElement, currentPath) {
    if (!node) return;
    if (parentElement === hierarchyTreeViewEl) {
      // Clear only if it's the root call
      parentElement.innerHTML = ""; // Clear previous tree
    }

    const ul = document.createElement("ul");
    // Create an item for the current node itself if it's the root call,
    // or if we decide to render each node and then its children in a sub-ul.
    // For simplicity, let's assume 'node' is a parent and its 'children' are what we list.
    // If 'node' itself is the root and should be displayed, adjust accordingly.

    // If currentHierarchyData is the root node, and renderHierarchyTree is called with it,
    // we should render it first, then its children.
    // Let's adjust to render the passed 'node' and then recurse for its children.

    const li = document.createElement("li");
    let nodeText = `${node.name || "Unknown"}`;
    if (node.properties) {
      if (node.properties["resource-id"]) {
        nodeText += ` <span class="node-details">(id: ${node.properties["resource-id"].split("/").pop()})</span>`;
      } else if (node.properties["text"]) {
        let text = node.properties["text"];
        if (text.length > 30) text = text.substring(0, 27) + "...";
        nodeText += ` <span class="node-details">(text: "${text}")</span>`;
      }
    }
    li.innerHTML = nodeText;
    li.dataset.nodePath = node.key; // Use the 'key' as the unique path

    if (node.key === selectedNodePath) {
      li.classList.add("selected-node");
    }

    li.addEventListener("click", (event) => {
      event.stopPropagation(); // Prevent event bubbling to parent LIs
      selectedNodePath = node.key;
      displayNodeProperties(node);
      highlightElementOnScreen(node);
      // Re-render tree to update selection highlight (could be more efficient)
      renderHierarchyTree(
        currentHierarchyData,
        hierarchyTreeViewEl,
        currentHierarchyData.key,
      );
    });

    parentElement.appendChild(li);

    if (node.children && node.children.length > 0) {
      const childrenUl = document.createElement("ul");
      li.appendChild(childrenUl); // Append children UL to the current node's LI
      node.children.forEach((childNode, index) => {
        // The childNode.key should already be the full path from backend
        renderHierarchyTree(childNode, childrenUl, childNode.key);
      });
    }
  }

  function displayNodeProperties(node) {
    if (!node) {
      elementPropertiesViewEl.innerHTML = "No node selected.";
      generatedXpathEl.value = "";
      return;
    }

    let propertiesHtml = "<table>";
    for (const key in node.properties) {
      propertiesHtml += `<tr><th>${key}</th><td>${escapeHtml(String(node.properties[key]))}</td></tr>`;
    }
    // Add other direct properties of the node if they are not in 'properties' dict
    if (node.name)
      propertiesHtml += `<tr><th>class (name)</th><td>${escapeHtml(node.name)}</td></tr>`;
    if (node.rect)
      propertiesHtml += `<tr><th>rect (abs)</th><td>x:${node.rect.x}, y:${node.rect.y}, w:${node.rect.width}, h:${node.rect.height}</td></tr>`;
    if (node.bounds)
      propertiesHtml += `<tr><th>bounds (rel)</th><td>${node.bounds.map((b) => b.toFixed(4)).join(", ")}</td></tr>`;

    propertiesHtml += "</table>";
    elementPropertiesViewEl.innerHTML = propertiesHtml;

    generatedXpathEl.value = generateBasicXPath(node);
  }

  function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) return "";
    return unsafe
      .toString()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function generateBasicXPath(node) {
    if (!node || !node.properties) return "";

    const props = node.properties;
    let xpath = "";

    if (props["resource-id"]) {
      xpath = `//*[@resource-id='${props["resource-id"]}']`;
    } else if (props["text"]) {
      // Escape quotes in text for XPath
      const escapedText = props["text"]
        .replace(/'/g, "&apos;")
        .replace(/"/g, "&quot;");
      xpath = `//${props["class"] || node.name || "*"}[@text='${escapedText}']`;
    } else if (props["content-desc"]) {
      const escapedDesc = props["content-desc"]
        .replace(/'/g, "&apos;")
        .replace(/"/g, "&quot;");
      xpath = `//${props["class"] || node.name || "*"}[@content-desc='${escapedDesc}']`;
    } else {
      xpath = `//${props["class"] || node.name || "*"}`;
      // Could add index if multiple elements match, but that requires context from parent
    }
    // This is a very basic XPath, can be improved significantly
    return xpath;
  }

  function highlightElementOnScreen(node) {
    if (
      !node ||
      !node.bounds ||
      !deviceScreenImg.clientWidth ||
      !actualDeviceWidth
    ) {
      hideHighlightBox();
      return;
    }

    // node.bounds are relative (0.0 to 1.0)
    const [x1_rel, y1_rel, x2_rel, y2_rel] = node.bounds;

    // Dimensions of the displayed image
    const imgRect = deviceScreenImg.getBoundingClientRect();
    const containerRect = deviceScreenContainer.getBoundingClientRect();

    // Calculate position relative to the deviceScreenContainer
    const displayWidth = imgRect.width;
    const displayHeight = imgRect.height;

    const left = x1_rel * displayWidth + (imgRect.left - containerRect.left);
    const top = y1_rel * displayHeight + (imgRect.top - containerRect.top);
    const width = (x2_rel - x1_rel) * displayWidth;
    const height = (y2_rel - y1_rel) * displayHeight;

    highlightBox.style.left = `${left}px`;
    highlightBox.style.top = `${top}px`;
    highlightBox.style.width = `${width}px`;
    highlightBox.style.height = `${height}px`;
    highlightBox.style.display = "block";
  }

  function hideHighlightBox() {
    highlightBox.style.display = "none";
  }

  deviceScreenImg.addEventListener("click", handleScreenshotClick);

  async function handleScreenshotClick(event) {
    if (
      !currentHierarchyData ||
      !currentDeviceSerial ||
      !deviceScreenImg.clientWidth ||
      !actualDeviceWidth
    ) {
      console.warn(
        "Cannot handle screenshot click: missing hierarchy, device selection, or screen dimensions.",
      );
      return;
    }

    const imgRect = deviceScreenImg.getBoundingClientRect();
    const clickX_on_img = event.clientX - imgRect.left;
    const clickY_on_img = event.clientY - imgRect.top;

    // Convert click coordinates on displayed image to relative (0-1) coordinates
    const relativeX = clickX_on_img / deviceScreenImg.clientWidth;
    const relativeY = clickY_on_img / deviceScreenImg.clientHeight;

    console.log(
      `Clicked on image at: (${clickX_on_img}, ${clickY_on_img}), Relative: (${relativeX.toFixed(4)}, ${relativeY.toFixed(4)})`,
    );

    const foundNode = findElementAtRelativeCoordinates(
      currentHierarchyData,
      relativeX,
      relativeY,
    );

    if (foundNode) {
      console.log("Found node by click:", foundNode.name, foundNode.properties);
      selectedNodePath = foundNode.key; // Update selected path
      displayNodeProperties(foundNode);
      highlightElementOnScreen(foundNode);
      // Re-render tree to reflect selection (could be more efficient)
      renderHierarchyTree(
        currentHierarchyData,
        hierarchyTreeViewEl,
        currentHierarchyData.key,
      );
    } else {
      console.log("No element found at clicked coordinates.");
      hideHighlightBox();
    }
  }

  function findElementAtRelativeCoordinates(node, relX, relY) {
    if (!node || !node.bounds) return null;

    const [x1, y1, x2, y2] = node.bounds; // These are relative bounds

    let bestMatch = null;

    if (relX >= x1 && relX <= x2 && relY >= y1 && relY <= y2) {
      // This node contains the click
      bestMatch = node; // This node is a candidate

      // Check children to find the smallest, most specific match
      if (node.children && node.children.length > 0) {
        for (const child of node.children) {
          const childMatch = findElementAtRelativeCoordinates(
            child,
            relX,
            relY,
          );
          if (childMatch) {
            bestMatch = childMatch; // A child is a better (more specific) match
            break; // Found the deepest child, no need to check other children of current node at this level
          }
        }
      }
    }
    return bestMatch;
  }

  // --- Interactive Python ---
  async function handleRunPythonCode() {
    if (!currentDeviceSerial) {
      alert("Please select a device first.");
      return;
    }
    const code = pythonEditor.value;
    if (!code.trim()) {
      alert("Please enter some Python code to execute.");
      return;
    }
    pythonOutput.textContent = "Executing Python code...";
    const payload = { code: code, enable_tracing: true };
    try {
      const outputText = await callBackend(
        "POST",
        `/api/android/${currentDeviceSerial}/interactive_python`,
        payload,
      );
      pythonOutput.textContent = outputText;
    } catch (error) {
      pythonOutput.textContent = `Execution Error:\n${error.message}`;
    }
  }

  // --- Device Controls ---
  async function sendDeviceCommand(commandName) {
    if (!currentDeviceSerial) {
      alert("Please select a device first.");
      return;
    }
    messageArea.textContent = `Sending command: ${commandName}...`;
    try {
      const responseData = await callBackend(
        "POST",
        `/api/android/${currentDeviceSerial}/command/${commandName}`,
        {},
      );
      messageArea.textContent = `Command '${commandName}' sent successfully.`;
      if (["home", "back"].includes(commandName))
        setTimeout(fetchAndDisplayScreenshot, 300);
    } catch (error) {
      messageArea.textContent = `Error sending command '${commandName}': ${error.message}`;
    }
  }

  // --- Initialization ---
  function initialize() {
    messageArea.innerHTML =
      "<span style='color: blue;'>Initializing Local App Inspector...</span>";
    loadDeviceList();

    deviceSelect.addEventListener("change", handleDeviceSelectionChange);
    refreshScreenBtn.addEventListener("click", fetchAndDisplayScreenshot);
    runPythonBtn.addEventListener("click", handleRunPythonCode);
    deviceHomeBtn.addEventListener("click", () => sendDeviceCommand("home"));
    deviceBackBtn.addEventListener("click", () => sendDeviceCommand("back"));
    refreshHierarchyBtn.addEventListener("click", fetchAndRenderHierarchy);

    // Tab functionality is in the HTML's inline script.
    // Ensure the default active tab (if inspector) loads its data.
    // This is now handled by handleDeviceSelectionChange if inspector tab is active.
  }

  // Global tab function if you move it from HTML
  window.openTab = function (evt, tabName) {
    var i, tabcontent, tabbuttons;
    tabcontent = document.getElementsByClassName("tab-content");
    for (i = 0; i < tabcontent.length; i++) {
      tabcontent[i].style.display = "none";
      tabcontent[i].classList.remove("active");
    }
    tabbuttons = document.getElementsByClassName("tab-button");
    for (i = 0; i < tabbuttons.length; i++) {
      tabbuttons[i].classList.remove("active");
    }
    const activeTabContent = document.getElementById(tabName);
    if (activeTabContent) {
      activeTabContent.style.display = "flex";
      activeTabContent.classList.add("active");
    }

    if (evt && evt.currentTarget) {
      evt.currentTarget.classList.add("active");
    } else {
      // If called without event (e.g. on page load), find and activate the button
      for (i = 0; i < tabbuttons.length; i++) {
        if (
          tabbuttons[i].getAttribute("onclick").includes("'" + tabName + "'")
        ) {
          // Match single or double quotes
          tabbuttons[i].classList.add("active");
          break;
        }
      }
    }

    // If inspector tab is opened and no hierarchy data, fetch it
    if (
      tabName === "inspector-tab" &&
      !currentHierarchyData &&
      currentDeviceSerial
    ) {
      fetchAndRenderHierarchy();
    }
  };

  // Ensure the default tab is shown on load and its button is active
  const defaultTab = "interactive-python-tab"; // Or 'inspector-tab'
  const defaultTabButton = Array.from(
    document.querySelectorAll(".tab-button"),
  ).find((btn) => btn.getAttribute("onclick").includes("'" + defaultTab + "'"));
  openTab(
    defaultTabButton ? { currentTarget: defaultTabButton } : null,
    defaultTab,
  );

  initialize();
});
