// uiautodev/static/local_inspector.js

document.addEventListener("DOMContentLoaded", function () {
  console.log("DOMContentLoaded: Event FIRED."); // Added: Log DOMContentLoaded

  // --- Configuration ---
  const EXTENSION_ID = "fjbboaelofjaabjmlphndicacmapbalm"; // Keep for now

  // --- DOM Elements ---
  // Attempt to get elements and log if they are found or not
  const messageArea = document.getElementById("message-area");
  console.log(
    "DOMContentLoaded: messageArea element:",
    messageArea ? "Found" : "NOT FOUND",
  );

  const deviceSelect = document.getElementById("device-select");
  console.log(
    "DOMContentLoaded: deviceSelect element:",
    deviceSelect ? "Found" : "NOT FOUND",
  );

  // It's good practice to check if critical elements exist before proceeding
  if (!messageArea || !deviceSelect) {
    console.error(
      "DOMContentLoaded: CRITICAL - A required element (messageArea or deviceSelect) was not found. Further UI operations may fail.",
    );
    if (messageArea) {
      // If messageArea exists, at least show an error there
      messageArea.innerHTML =
        "<span style='color: red;'>Critical Frontend Error: UI elements missing. Check HTML IDs.</span>";
    }
    // Optionally, you could return here to prevent other code from running if these are absolutely essential from the start
    // return;
  }

  const deviceSerialEl = document.getElementById("device-serial"); // Not critical for initial load, but good to know
  const deviceModelEl = document.getElementById("device-model");
  const deviceSdkEl = document.getElementById("device-sdk");
  console.log(
    "DOMContentLoaded: deviceSerialEl:",
    deviceSerialEl ? "Found" : "NOT FOUND",
  );
  console.log(
    "DOMContentLoaded: deviceModelEl:",
    deviceModelEl ? "Found" : "NOT FOUND",
  );
  console.log(
    "DOMContentLoaded: deviceSdkEl:",
    deviceSdkEl ? "Found" : "NOT FOUND",
  );

  const deviceScreenImg = document.getElementById("current-device-screen");
  const deviceScreenContainer = document.querySelector(
    ".device-screen-container",
  );
  const highlightBox = document.getElementById("highlight-box");
  const refreshScreenBtn = document.getElementById("refresh-screen-btn");
  const deviceHomeBtn = document.getElementById("device-home-btn");
  const deviceBackBtn = document.getElementById("device-back-btn");

  const pythonEditor = document.getElementById("interactive-python-editor");
  const runPythonBtn = document.getElementById("run-python-button");
  const pythonOutput = document.getElementById("interactive-python-output");

  const inspectorTab = document.getElementById("inspector-tab");
  const refreshHierarchyBtn = document.getElementById("refresh-hierarchy-btn");
  const hierarchyTreeViewEl = document.getElementById("hierarchy-tree-view");
  const elementPropertiesViewEl = document.getElementById(
    "element-properties-view",
  );
  const generatedXpathEl = document.getElementById("generated-xpath");

  // --- State ---
  let currentDeviceSerial = null;
  let devices = []; // Global 'devices' array
  let screenshotInterval = null;
  const SCREENSHOT_REFRESH_INTERVAL_MS = 5000;

  let currentHierarchyData = null;
  let selectedNodePath = null;
  let actualDeviceWidth = null;
  let actualDeviceHeight = null;

  // --- API Helper (Direct Fetch) ---
  async function callBackend(
    method,
    endpoint,
    body = null,
    expectBlob = false,
  ) {
    console.log(
      `callBackend: Requesting ${method} ${endpoint}`,
      body ? { body } : "",
    ); // Added: Log API calls
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
      console.log(
        `callBackend: Response received for ${method} ${endpoint}. Status: ${response.status}`,
      ); // Added: Log response status

      if (!response.ok) {
        let errorText = `HTTP error ${response.status}: ${response.statusText}`;
        try {
          const errorData = await response.json();
          console.warn(
            `callBackend: Error data from backend for ${method} ${endpoint}:`,
            errorData,
          ); // Added: Log error data
          if (errorData && (errorData.error || errorData.detail)) {
            errorText = `Error: ${errorData.error || errorData.detail} (Status: ${response.status})`;
          }
        } catch (e) {
          console.warn(
            `callBackend: Could not parse error response as JSON for ${method} ${endpoint}.`,
          );
        }
        console.error(
          `callBackend: Backend Error for ${method} ${endpoint}:`,
          errorText,
        );
        throw new Error(errorText);
      }
      const contentType = response.headers.get("content-type");
      console.log(
        `callBackend: Response Content-Type for ${method} ${endpoint}: ${contentType}`,
      ); // Added: Log content type

      if (expectBlob) {
        if (contentType && contentType.startsWith("image/")) {
          console.log(
            `callBackend: Expecting blob and got image for ${method} ${endpoint}. Returning blob.`,
          );
          return response.blob();
        }
        console.warn(
          `callBackend: Expected blob for ${method} ${endpoint}, but got ${contentType}. Trying text.`,
        );
        return response.text();
      } else if (contentType && contentType.includes("application/json")) {
        console.log(
          `callBackend: Expecting JSON and got JSON for ${method} ${endpoint}. Returning json().`,
        );
        return response.json();
      } else if (
        contentType &&
        (contentType.includes("text/plain") ||
          contentType.includes("text/html"))
      ) {
        // Allow text/html too
        console.log(
          `callBackend: Got text content for ${method} ${endpoint}. Returning text().`,
        );
        return response.text();
      } else {
        console.warn(
          `callBackend: Unexpected content type "${contentType}" for ${method} ${endpoint}. Reading as text.`,
        );
        return response.text();
      }
    } catch (error) {
      console.error(
        `callBackend: Fetch Error for ${method} ${endpoint}:`,
        error,
      );
      if (messageArea) {
        // Check if messageArea exists
        messageArea.innerHTML = `<span style='color: red;'>Network/Server Error: ${error.message}. Check server logs.</span>`;
      }
      throw error;
    }
  }

  // --- Device Management ---
  async function loadDeviceList() {
    console.log("loadDeviceList: Function CALLED."); // 1. Start of function

    if (!deviceSelect) {
      // Re-check deviceSelect as it's critical here
      console.error(
        "loadDeviceList: CRITICAL - deviceSelect element is null or undefined here! Cannot proceed.",
      );
      if (messageArea)
        messageArea.textContent =
          "Frontend Error: Device select element not found.";
      return;
    }
    console.log("loadDeviceList: deviceSelect element IS available."); // 2. Element found (or confirmed from global)

    if (messageArea) messageArea.textContent = "Loading devices...";
    deviceSelect.disabled = true;

    try {
      console.log(
        "loadDeviceList: TRY block entered. Calling backend for /api/android/list...",
      ); // 3. Before fetch
      const data = await callBackend("GET", "/api/android/list");
      // Using a different variable name here to avoid confusion with the global 'devices' before assignment
      console.log(
        "loadDeviceList: Backend call FINISHED. Raw data received from /api/android/list:",
        JSON.stringify(data),
      ); // 4. After fetch - VERY IMPORTANT

      if (data === null) {
        console.warn("loadDeviceList: Data from backend is null.");
      } else if (data === undefined) {
        console.warn("loadDeviceList: Data from backend is undefined.");
      } else if (typeof data === "string") {
        console.warn("loadDeviceList: Data from backend is a STRING:", data);
        // It's possible callBackend already tried to parse it if content-type was wrong.
        // If it's still a string here, it implies text/plain or similar was returned for /api/android/list
      } else if (typeof data === "object" && !Array.isArray(data)) {
        console.warn(
          "loadDeviceList: Data from backend is an OBJECT, not an array:",
          JSON.stringify(data),
        );
      } else if (Array.isArray(data)) {
        console.log(
          "loadDeviceList: Data from backend IS an ARRAY. Length:",
          data.length,
        );
      }

      devices = data || []; // Assign to global 'devices'
      // Ensure 'devices' is an array after the assignment. If 'data' was not an array and not falsy, 'devices' would be 'data'.
      if (!Array.isArray(devices)) {
        console.error(
          "loadDeviceList: CRITICAL - 'devices' is NOT AN ARRAY after assignment from 'data'. Value:",
          JSON.stringify(devices),
        );
        // If devices is not an array, populateDeviceDropdown will fail.
        // Set a specific error and stop.
        deviceSelect.innerHTML =
          '<option value="">Error: Invalid device data format</option>';
        if (messageArea)
          messageArea.textContent =
            "Error: Invalid device data received from server.";
        devices = []; // Reset to empty array to prevent further errors
      } else {
        console.log(
          "loadDeviceList: 'devices' variable successfully set as array:",
          JSON.stringify(devices),
        ); // 5. After `devices` is set
      }
      console.log(
        "loadDeviceList: Type of 'devices' now:",
        typeof devices,
        "Is Array?",
        Array.isArray(devices),
      ); // 6. Type check

      populateDeviceDropdown(devices);
      console.log("loadDeviceList: populateDeviceDropdown CALLED."); // 7. After populate

      if (devices && devices.length > 0) {
        console.log(
          "loadDeviceList: Devices available. Count:",
          devices.length,
        ); // 8. Devices available
        const lastSerial = localStorage.getItem("lastSelectedDeviceSerial");
        let deviceFoundToSelect = devices.some((d) => d.serial === lastSerial);

        deviceSelect.value =
          lastSerial && deviceFoundToSelect ? lastSerial : devices[0].serial;
        console.log(
          "loadDeviceList: deviceSelect.value set to:",
          deviceSelect.value,
        );
        if (messageArea)
          messageArea.textContent = "Select a device or refresh hierarchy.";
      } else {
        console.warn(
          "loadDeviceList: No devices found or 'devices' is empty after processing 'data'.",
        ); // 9. No devices
        // This should be handled by populateDeviceDropdown if devices is an empty array.
        // If populateDeviceDropdown was skipped due to non-array, this message might be more relevant.
        if (messageArea)
          messageArea.textContent =
            "No Android devices found. Connect a device and ensure ADB is working.";
        clearDeviceInfo(); // This also clears a lot of UI
      }
      await handleDeviceSelectionChange(); // This might run even if no devices, need to check its logic
      console.log("loadDeviceList: handleDeviceSelectionChange CALLED."); // 10. End of try
    } catch (error) {
      console.error("loadDeviceList: CATCH block executed!"); // 11. CATCH BLOCK
      console.error("Error in loadDeviceList (raw error object):", error);
      // Attempt to stringify the error to see its properties
      try {
        console.log(
          "loadDeviceList error object stringified:",
          JSON.stringify(error, Object.getOwnPropertyNames(error)),
        );
      } catch (e) {
        console.log(
          "loadDeviceList: Could not stringify error object. Message:",
          error.message,
          "Stack:",
          error.stack,
        );
      }

      if (deviceSelect) {
        // Check if deviceSelect is still valid
        deviceSelect.innerHTML =
          '<option value="">Error loading devices (JS catch)</option>';
      } else {
        console.error(
          "loadDeviceList: CATCH BLOCK - deviceSelect element is NULL or undefined here!",
        );
      }
      if (messageArea) {
        messageArea.textContent = `Error loading devices (catch): ${error.message || "Unknown error"}`;
      }
    } finally {
      console.log("loadDeviceList: FINALLY block executed."); // 12. FINALLY
      if (deviceSelect) {
        // Check if deviceSelect is still valid
        deviceSelect.disabled = false;
      }
    }
  }

  function populateDeviceDropdown(deviceData) {
    console.log(
      "populateDeviceDropdown: CALLED with deviceData:",
      JSON.stringify(deviceData),
    ); // P1. Entry

    if (!deviceSelect) {
      // Use the global deviceSelect, assuming it was found at DOMContentLoaded
      console.error(
        "populateDeviceDropdown: CRITICAL - deviceSelect element is NULL or undefined! Cannot populate.",
      );
      return;
    }

    deviceSelect.innerHTML = ""; // Clear previous options
    if (!deviceData || !Array.isArray(deviceData) || deviceData.length === 0) {
      console.warn(
        "populateDeviceDropdown: deviceData is not a valid array or is empty. Setting 'No devices found'.",
      ); // P2. No data
      deviceSelect.innerHTML = '<option value="">No devices found</option>';
      return;
    }

    console.log(
      "populateDeviceDropdown: deviceData is a valid array, proceeding to create options. Length:",
      deviceData.length,
    ); // P3. Valid data
    try {
      deviceData.forEach((device, index) => {
        console.log(
          `populateDeviceDropdown: Processing device ${index}:`,
          JSON.stringify(device),
        ); // P4. Each device
        if (typeof device !== "object" || device === null) {
          console.warn(
            `populateDeviceDropdown: Device at index ${index} is not an object or is null:`,
            device,
          );
          return; // Skip this iteration of forEach (continue to next)
        }
        if (!device.serial) {
          console.warn(
            `populateDeviceDropdown: Device at index ${index} is missing 'serial' property:`,
            device,
          );
          // Optionally, skip or provide a default value. For now, it will result in option.value being undefined.
        }
        const option = document.createElement("option");
        option.value = device.serial;
        console.log(
          `populateDeviceDropdown: Device ${index} serial for option.value: '${device.serial}'`,
        ); // P5. Serial
        option.textContent = `${device.model || device.serial || "Unknown Device"} (SDK: ${device.sdkVersion || "N/A"}, ID: ${device.id || "N/A"})`;
        deviceSelect.appendChild(option);
      });
      console.log("populateDeviceDropdown: FINISHED creating options."); // P6. Finish
    } catch (e) {
      console.error(
        "populateDeviceDropdown: ERROR during forEach loop or option creation:",
        e,
      ); // P7. Error in loop
      deviceSelect.innerHTML =
        '<option value="">Error processing device data</option>';
    }
  }

  function clearDeviceInfo() {
    console.log("clearDeviceInfo: CALLED"); // Added log
    if (deviceSerialEl) deviceSerialEl.textContent = "N/A";
    if (deviceModelEl) deviceModelEl.textContent = "N/A";
    if (deviceSdkEl) deviceSdkEl.textContent = "N/A";
    if (deviceScreenImg) {
      deviceScreenImg.src =
        "https://placehold.co/360x640/e9e9e9/777?text=No+Device+Selected";
      deviceScreenImg.alt = "No Device Selected";
    }
    currentHierarchyData = null;
    if (hierarchyTreeViewEl)
      hierarchyTreeViewEl.innerHTML =
        "No device selected or hierarchy not loaded.";
    if (elementPropertiesViewEl)
      elementPropertiesViewEl.innerHTML = "Select an element.";
    if (generatedXpathEl) generatedXpathEl.value = "";
    stopScreenshotAutoRefresh();
    hideHighlightBox();
  }

  async function handleDeviceSelectionChange() {
    console.log("handleDeviceSelectionChange: CALLED"); // Added log
    if (!deviceSelect) {
      console.error(
        "handleDeviceSelectionChange: deviceSelect element is not available!",
      );
      return;
    }
    currentDeviceSerial = deviceSelect.value;
    console.log(
      "handleDeviceSelectionChange: currentDeviceSerial set to:",
      currentDeviceSerial,
    ); // Added log
    localStorage.setItem("lastSelectedDeviceSerial", currentDeviceSerial);

    if (currentDeviceSerial) {
      const selectedDevice = devices.find(
        // Ensure 'devices' is the global array
        (d) => d.serial === currentDeviceSerial,
      );
      console.log(
        "handleDeviceSelectionChange: selectedDevice object:",
        JSON.stringify(selectedDevice),
      ); // Added log
      if (selectedDevice) {
        if (deviceSerialEl) deviceSerialEl.textContent = selectedDevice.serial;
        if (deviceModelEl)
          deviceModelEl.textContent = selectedDevice.model || "Unknown";
        if (deviceSdkEl)
          deviceSdkEl.textContent = selectedDevice.sdkVersion || "Unknown"; // sdkVersion might be undefined
        if (messageArea)
          messageArea.textContent = `Selected device: ${selectedDevice.model || selectedDevice.serial}.`;
      } else {
        console.warn(
          "handleDeviceSelectionChange: No selectedDevice found in 'devices' array for serial:",
          currentDeviceSerial,
        );
        // This case might occur if the dropdown is somehow out of sync with the `devices` array
        if (messageArea)
          messageArea.textContent = `Device ${currentDeviceSerial} details not found.`;
      }

      // Check if the inspector tab is active for fetching hierarchy
      const inspectorTabElement = document.getElementById("inspector-tab");
      const isInspectorTabActive =
        inspectorTabElement && inspectorTabElement.classList.contains("active");
      console.log(
        "handleDeviceSelectionChange: Is inspector tab active?",
        isInspectorTabActive,
      );

      // It's generally safer to call these after confirming a device is truly selected and valid
      await fetchAndDisplayScreenshot();
      await fetchDeviceWindowSize();
      startScreenshotAutoRefresh();

      if (isInspectorTabActive) {
        console.log(
          "handleDeviceSelectionChange: Inspector tab is active, fetching hierarchy.",
        );
        await fetchAndRenderHierarchy();
      } else {
        console.log(
          "handleDeviceSelectionChange: Inspector tab NOT active, hierarchy not fetched on selection change.",
        );
      }
    } else {
      console.log(
        "handleDeviceSelectionChange: No currentDeviceSerial. Clearing device info.",
      ); // Added log
      clearDeviceInfo();
      if (messageArea) messageArea.textContent = "No device selected.";
    }
  }

  async function fetchDeviceWindowSize() {
    console.log(
      "fetchDeviceWindowSize: CALLED for serial:",
      currentDeviceSerial,
    ); // Added log
    if (!currentDeviceSerial) return;
    try {
      console.warn(
        "fetchDeviceWindowSize: Needs a reliable way to get actual device dimensions. Placeholder logic.",
      );
    } catch (error) {
      console.error("Error fetching device window size:", error);
    }
  }

  async function fetchAndDisplayScreenshot() {
    console.log(
      "fetchAndDisplayScreenshot: CALLED for serial:",
      currentDeviceSerial,
    ); // Added log
    if (!currentDeviceSerial) {
      console.log(
        "fetchAndDisplayScreenshot: No current device serial, returning.",
      );
      return;
    }
    if (!deviceScreenImg) {
      console.error(
        "fetchAndDisplayScreenshot: deviceScreenImg element not found!",
      );
      return;
    }
    const timestamp = new Date().getTime();
    try {
      const blob = await callBackend(
        "GET",
        `/api/android/${currentDeviceSerial}/screenshot/0?t=${timestamp}`,
        null,
        true,
      );
      if (blob instanceof Blob) {
        console.log(
          "fetchAndDisplayScreenshot: Screenshot blob received, size:",
          blob.size,
        ); // Added log
        deviceScreenImg.src = URL.createObjectURL(blob);
        deviceScreenImg.alt = `Device Screen (${currentDeviceSerial})`;
        deviceScreenImg.onload = () => {
          console.log(
            `Screenshot displayed: ${deviceScreenImg.clientWidth}x${deviceScreenImg.clientHeight}, natural: ${deviceScreenImg.naturalWidth}x${deviceScreenImg.naturalHeight}`,
          );
          if (!actualDeviceWidth || !actualDeviceHeight) {
            actualDeviceWidth = deviceScreenImg.naturalWidth;
            actualDeviceHeight = deviceScreenImg.naturalHeight;
            console.log(
              `Using screenshot natural dimensions for device size: ${actualDeviceWidth}x${actualDeviceHeight}`,
            );
          }
        };
        deviceScreenImg.onerror = () => {
          // Added: log if image fails to load from blob URL
          console.error(
            "fetchAndDisplayScreenshot: Error loading image from blob URL:",
            deviceScreenImg.src,
          );
        };
      } else {
        console.warn(
          "fetchAndDisplayScreenshot: Screenshot data was not a Blob. Received:",
          blob,
        ); // Added log
        deviceScreenImg.src =
          "https://placehold.co/360x640/e9e9e9/777?text=No+Screenshot+Data";
      }
    } catch (error) {
      console.error(
        "fetchAndDisplayScreenshot: Error fetching or displaying screenshot:",
        error,
      ); // Added log
      deviceScreenImg.alt = "Error loading screenshot";
      deviceScreenImg.src =
        "https://placehold.co/360x640/e9e9e9/777?text=Error+Loading+Screen";
    }
  }

  function startScreenshotAutoRefresh() {
    console.log("startScreenshotAutoRefresh: CALLED"); // Added log
    stopScreenshotAutoRefresh(); // Clear any existing interval
    if (currentDeviceSerial) {
      console.log(
        "startScreenshotAutoRefresh: Starting auto-refresh for serial:",
        currentDeviceSerial,
      );
      fetchAndDisplayScreenshot(); // Initial fetch
      screenshotInterval = setInterval(
        fetchAndDisplayScreenshot,
        SCREENSHOT_REFRESH_INTERVAL_MS,
      );
    } else {
      console.log(
        "startScreenshotAutoRefresh: No current device serial, auto-refresh not started.",
      );
    }
  }
  function stopScreenshotAutoRefresh() {
    if (screenshotInterval) {
      console.log("stopScreenshotAutoRefresh: Clearing screenshot interval."); // Added log
      clearInterval(screenshotInterval);
      screenshotInterval = null;
    }
  }

  async function fetchAndRenderHierarchy() {
    console.log(
      "fetchAndRenderHierarchy: CALLED for serial:",
      currentDeviceSerial,
    ); // Added log
    if (!currentDeviceSerial) {
      if (hierarchyTreeViewEl)
        hierarchyTreeViewEl.innerHTML = "Please select a device.";
      return;
    }
    if (!hierarchyTreeViewEl || !elementPropertiesViewEl || !generatedXpathEl) {
      console.error(
        "fetchAndRenderHierarchy: One or more UI elements for hierarchy is missing!",
      );
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
      console.log(
        "fetchAndRenderHierarchy: Hierarchy data received:",
        JSON.stringify(hierarchyData).substring(0, 500) + "...",
      ); // Log snippet

      if (
        hierarchyData &&
        typeof hierarchyData === "object" &&
        hierarchyData.name
      ) {
        // Check if it's an object and has a 'name' (root node)
        currentHierarchyData = hierarchyData;
        if (currentHierarchyData.rect) {
          actualDeviceWidth =
            currentHierarchyData.rect.width + currentHierarchyData.rect.x;
          actualDeviceHeight =
            currentHierarchyData.rect.height + currentHierarchyData.rect.y;
          console.log(
            `Device dimensions from hierarchy root: ${actualDeviceWidth}x${actualDeviceHeight}`,
          );
        } else if (
          currentHierarchyData.properties &&
          currentHierarchyData.properties.bounds
        ) {
          const boundsStr = currentHierarchyData.properties.bounds;
          const coords = boundsStr.match(/\d+/g);
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
        if (messageArea)
          messageArea.textContent =
            "Hierarchy loaded. Click on elements to inspect.";
      } else {
        console.warn(
          "fetchAndRenderHierarchy: Failed to load valid hierarchy data or data is empty/not an object. Received:",
          hierarchyData,
        ); // Added log
        if (hierarchyTreeViewEl)
          hierarchyTreeViewEl.innerHTML =
            "Failed to load hierarchy or data is empty.";
        currentHierarchyData = null;
      }
    } catch (error) {
      console.error("fetchAndRenderHierarchy: Error loading hierarchy:", error); // Added log
      if (hierarchyTreeViewEl)
        hierarchyTreeViewEl.innerHTML = `Error loading hierarchy: ${error.message}`;
      currentHierarchyData = null;
    }
  }

  function renderHierarchyTree(node, parentElement, currentPath) {
    // node.key is used as currentPath now
    // console.log("renderHierarchyTree: CALLED for node path:", node ? node.key : "null node"); // Can be very verbose
    if (!node) return;
    if (parentElement === hierarchyTreeViewEl) {
      parentElement.innerHTML = "";
    }

    const li = document.createElement("li");
    let nodeText = `${node.name || "Unknown Node"}`; // Ensure some text even if name is missing
    if (node.properties) {
      if (node.properties["resource-id"]) {
        nodeText += ` <span class="node-details">(id: ${node.properties["resource-id"].split("/").pop()})</span>`;
      } else if (node.properties["text"]) {
        let text = node.properties["text"];
        if (text.length > 30) text = text.substring(0, 27) + "...";
        nodeText += ` <span class="node-details">(text: "${escapeHtml(text)}")</span>`; // Escape text here too
      }
    }
    li.innerHTML = nodeText;
    li.dataset.nodePath = node.key;

    if (node.key === selectedNodePath) {
      li.classList.add("selected-node");
    }

    li.addEventListener("click", (event) => {
      event.stopPropagation();
      console.log("renderHierarchyTree: Node clicked. Path:", node.key); // Added log
      selectedNodePath = node.key;
      displayNodeProperties(node);
      highlightElementOnScreen(node);
      // Re-rendering the whole tree on click is inefficient but ensures selection highlight.
      // For large hierarchies, this could be slow. Consider a more targeted update.
      if (currentHierarchyData) {
        // Ensure currentHierarchyData is available
        renderHierarchyTree(
          currentHierarchyData,
          hierarchyTreeViewEl,
          currentHierarchyData.key,
        );
      } else {
        console.warn(
          "renderHierarchyTree click handler: currentHierarchyData is null, cannot re-render tree.",
        );
      }
    });

    parentElement.appendChild(li);

    if (node.children && node.children.length > 0) {
      const childrenUl = document.createElement("ul");
      li.appendChild(childrenUl);
      node.children.forEach((childNode) => {
        // No need for index if childNode.key is absolute
        renderHierarchyTree(childNode, childrenUl, childNode.key);
      });
    }
  }

  function displayNodeProperties(node) {
    console.log(
      "displayNodeProperties: CALLED for node path:",
      node ? node.key : "null node",
    ); // Added log
    if (!elementPropertiesViewEl || !generatedXpathEl) {
      console.error(
        "displayNodeProperties: Properties or XPath element not found!",
      );
      return;
    }
    if (!node) {
      elementPropertiesViewEl.innerHTML = "No node selected.";
      generatedXpathEl.value = "";
      return;
    }

    let propertiesHtml = "<table>";
    if (node.properties) {
      for (const key in node.properties) {
        propertiesHtml += `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(String(node.properties[key]))}</td></tr>`;
      }
    }
    if (node.name)
      propertiesHtml += `<tr><th>class (name)</th><td>${escapeHtml(node.name)}</td></tr>`;
    if (node.rect)
      propertiesHtml += `<tr><th>rect (abs)</th><td>x:${node.rect.x}, y:${node.rect.y}, w:${node.rect.width}, h:${node.rect.height}</td></tr>`;
    if (node.bounds)
      propertiesHtml += `<tr><th>bounds (rel)</th><td>${node.bounds.map((b) => (typeof b === "number" ? b.toFixed(4) : String(b))).join(", ")}</td></tr>`;
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
    const className = escapeHtml(props["class"] || node.name || "*");

    if (props["resource-id"]) {
      xpath = `//*[@resource-id='${escapeHtml(props["resource-id"])}']`;
    } else if (props["text"]) {
      const escapedText = escapeHtml(props["text"]).replace(/'/g, "&apos;"); // Further escape for XPath string literal
      xpath = `//${className}[@text='${escapedText}']`;
    } else if (props["content-desc"]) {
      const escapedDesc = escapeHtml(props["content-desc"]).replace(
        /'/g,
        "&apos;",
      );
      xpath = `//${className}[@content-desc='${escapedDesc}']`;
    } else {
      xpath = `//${className}`;
    }
    return xpath;
  }

  function highlightElementOnScreen(node) {
    // console.log("highlightElementOnScreen: CALLED for node path:", node ? node.key : "null node"); // Can be verbose
    if (!highlightBox || !deviceScreenImg || !deviceScreenContainer) {
      console.warn(
        "highlightElementOnScreen: Highlight-related DOM elements not found.",
      );
      return;
    }
    if (
      !node ||
      !node.bounds ||
      !Array.isArray(node.bounds) ||
      node.bounds.length !== 4 ||
      !deviceScreenImg.clientWidth ||
      !actualDeviceWidth
    ) {
      hideHighlightBox();
      return;
    }

    const [x1_rel, y1_rel, x2_rel, y2_rel] = node.bounds;
    const imgRect = deviceScreenImg.getBoundingClientRect();
    const containerRect = deviceScreenContainer.getBoundingClientRect();
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
    if (highlightBox) highlightBox.style.display = "none";
  }

  if (deviceScreenImg) {
    // Check if exists before adding listener
    deviceScreenImg.addEventListener("click", handleScreenshotClick);
  } else {
    console.warn(
      "Device screen image element not found, click listener not added.",
    );
  }

  async function handleScreenshotClick(event) {
    console.log("handleScreenshotClick: CALLED"); // Added log
    if (
      !currentHierarchyData ||
      !currentDeviceSerial ||
      !deviceScreenImg ||
      !deviceScreenImg.clientWidth ||
      !actualDeviceWidth
    ) {
      console.warn(
        "Cannot handle screenshot click: missing hierarchy, device selection, image element, or screen dimensions.",
      );
      return;
    }

    const imgRect = deviceScreenImg.getBoundingClientRect();
    const clickX_on_img = event.clientX - imgRect.left;
    const clickY_on_img = event.clientY - imgRect.top;
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
      console.log(
        "Found node by click:",
        foundNode.name,
        "Path:",
        foundNode.key,
      ); // Added log
      selectedNodePath = foundNode.key;
      displayNodeProperties(foundNode);
      highlightElementOnScreen(foundNode);
      if (currentHierarchyData) {
        renderHierarchyTree(
          currentHierarchyData,
          hierarchyTreeViewEl,
          currentHierarchyData.key,
        );
      }
    } else {
      console.log("No element found at clicked coordinates.");
      hideHighlightBox();
    }
  }

  function findElementAtRelativeCoordinates(node, relX, relY) {
    if (
      !node ||
      !node.bounds ||
      !Array.isArray(node.bounds) ||
      node.bounds.length !== 4
    )
      return null;
    const [x1, y1, x2, y2] = node.bounds;
    let bestMatch = null;

    if (relX >= x1 && relX <= x2 && relY >= y1 && relY <= y2) {
      bestMatch = node;
      if (node.children && node.children.length > 0) {
        for (const child of node.children) {
          const childMatch = findElementAtRelativeCoordinates(
            child,
            relX,
            relY,
          );
          if (childMatch) {
            bestMatch = childMatch;
            // Keep searching in case multiple children overlap; the deepest one that still contains the point is preferred.
            // For true smallest area, you'd compare areas if multiple children match.
            // For now, deepest takes precedence.
          }
        }
      }
    }
    return bestMatch; // This will return the deepest matching node.
  }

  async function handleRunPythonCode() {
    console.log("handleRunPythonCode: CALLED"); // Added log
    if (!currentDeviceSerial) {
      alert("Please select a device first.");
      return;
    }
    if (!pythonEditor || !pythonOutput) {
      console.error("Python editor or output element not found!");
      return;
    }
    const code = pythonEditor.value;
    if (!code.trim()) {
      alert("Please enter some Python code to execute.");
      return;
    }
    pythonOutput.textContent = "Executing Python code...";
    const payload = { code: code, enable_tracing: true }; // enable_tracing might not be used by backend
    try {
      const outputText = await callBackend(
        "POST",
        `/api/android/${currentDeviceSerial}/interactive_python`,
        payload,
      );
      pythonOutput.textContent =
        typeof outputText === "string"
          ? outputText
          : JSON.stringify(outputText); // Ensure it's a string
    } catch (error) {
      pythonOutput.textContent = `Execution Error:\n${error.message}`;
    }
  }

  async function sendDeviceCommand(commandName) {
    console.log(
      "sendDeviceCommand: CALLED for command:",
      commandName,
      "on serial:",
      currentDeviceSerial,
    ); // Added log
    if (!currentDeviceSerial) {
      alert("Please select a device first.");
      return;
    }
    if (messageArea)
      messageArea.textContent = `Sending command: ${commandName}...`;
    try {
      const responseData = await callBackend(
        "POST",
        `/api/android/${currentDeviceSerial}/command/${commandName}`,
        {},
      );
      console.log("sendDeviceCommand: Response from command:", responseData); // Added log
      if (messageArea)
        messageArea.textContent = `Command '${commandName}' sent successfully.`;
      if (["home", "back"].includes(commandName)) {
        setTimeout(fetchAndDisplayScreenshot, 300); // Give time for UI to update
      }
    } catch (error) {
      if (messageArea)
        messageArea.textContent = `Error sending command '${commandName}': ${error.message}`;
    }
  }

  function initialize() {
    console.log("initialize: CALLED"); // Added log
    if (messageArea) {
      messageArea.innerHTML =
        "<span style='color: blue;'>Initializing Local App Inspector...</span>";
    } else {
      console.warn(
        "initialize: messageArea not found, cannot set initializing message.",
      );
    }

    // Only call loadDeviceList if deviceSelect element actually exists
    if (deviceSelect) {
      loadDeviceList();
    } else {
      console.error(
        "initialize: deviceSelect element not found. Device list will not be loaded.",
      );
      if (messageArea)
        messageArea.innerHTML =
          "<span style='color: red;'>Error: UI component 'device-select' missing.</span>";
      return; // Stop initialization if critical component is missing
    }

    // Add event listeners only if the elements exist
    if (deviceSelect)
      deviceSelect.addEventListener("change", handleDeviceSelectionChange);
    else
      console.warn(
        "initialize: deviceSelect not found, 'change' listener not added.",
      );

    if (refreshScreenBtn)
      refreshScreenBtn.addEventListener("click", fetchAndDisplayScreenshot);
    else
      console.warn(
        "initialize: refreshScreenBtn not found, listener not added.",
      );

    if (runPythonBtn)
      runPythonBtn.addEventListener("click", handleRunPythonCode);
    else
      console.warn("initialize: runPythonBtn not found, listener not added.");

    if (deviceHomeBtn)
      deviceHomeBtn.addEventListener("click", () => sendDeviceCommand("home"));
    else
      console.warn("initialize: deviceHomeBtn not found, listener not added.");

    if (deviceBackBtn)
      deviceBackBtn.addEventListener("click", () => sendDeviceCommand("back"));
    else
      console.warn("initialize: deviceBackBtn not found, listener not added.");

    if (refreshHierarchyBtn)
      refreshHierarchyBtn.addEventListener("click", fetchAndRenderHierarchy);
    else
      console.warn(
        "initialize: refreshHierarchyBtn not found, listener not added.",
      );

    console.log("initialize: Event listeners setup (if elements found).");
  }

  // Ensure openTab is globally available if demo.html still relies on it directly.
  // It's better if demo.html's inline script calls a function defined within this main IIFE if possible,
  // or this script sets up tab listeners directly.
  window.openTab = function (evt, tabName) {
    console.log("openTab: CALLED for tabName:", tabName); // Added log
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
    } else {
      console.warn("openTab: Could not find tab content for ID:", tabName);
    }

    if (evt && evt.currentTarget) {
      evt.currentTarget.classList.add("active");
    } else {
      for (i = 0; i < tabbuttons.length; i++) {
        const onclickAttr = tabbuttons[i].getAttribute("onclick");
        // Be careful with string matching for onclick if it becomes more complex
        if (
          onclickAttr &&
          (onclickAttr.includes("'" + tabName + "'") ||
            onclickAttr.includes('"' + tabName + '"'))
        ) {
          tabbuttons[i].classList.add("active");
          break;
        }
      }
    }

    if (
      tabName === "inspector-tab" &&
      !currentHierarchyData &&
      currentDeviceSerial
    ) {
      console.log("openTab: Inspector tab opened, fetching hierarchy.");
      fetchAndRenderHierarchy();
    }
  };

  console.log("DOMContentLoaded: Initializing default tab.");
  const defaultTab = "interactive-python-tab";
  const defaultTabButton = Array.from(
    document.querySelectorAll(".tab-button"),
  ).find((btn) => {
    const onclickAttr = btn.getAttribute("onclick");
    return (
      onclickAttr &&
      (onclickAttr.includes("'" + defaultTab + "'") ||
        onclickAttr.includes('"' + defaultTab + '"'))
    );
  });

  if (defaultTabButton) {
    console.log(
      "DOMContentLoaded: Found default tab button, opening tab:",
      defaultTab,
    );
    openTab({ currentTarget: defaultTabButton }, defaultTab);
  } else {
    // Fallback if button not found by onclick attribute (e.g. if event listeners are used instead)
    // or manually activate first tab if any
    const firstTabButton = document.querySelector(".tab-button");
    if (firstTabButton) {
      console.warn(
        `DOMContentLoaded: Default tab button for '${defaultTab}' not found by onclick, trying first tab button:`,
        firstTabButton,
      );
      const firstTabName = firstTabButton
        .getAttribute("onclick")
        .match(/openTab\(event, ['"](.*?)['"]\)/);
      if (firstTabName && firstTabName[1]) {
        openTab({ currentTarget: firstTabButton }, firstTabName[1]);
      } else {
        console.error(
          "DOMContentLoaded: Could not determine tab name from first tab button's onclick.",
        );
      }
    } else {
      console.error(
        "DOMContentLoaded: No tab buttons found to set a default active tab.",
      );
    }
  }

  initialize(); // Call main initialization logic
  console.log("DOMContentLoaded: Script execution FINISHED."); // Added: Log end of script
});
