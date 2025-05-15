import asyncio
import json
import logging
import os
from typing import Any, AsyncGenerator, Dict, List, Optional, Union

import httpx
from model import ToolCall  # Assuming this is for LLM's request to call a tool
from model import ToolCallFunction  # Assuming this is for LLM's request to call a tool
from model import ChatMessageContent, ChatMessageDelta, LlmServiceChatRequest

logger = logging.getLogger(__name__)

DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions"
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
DEEPSEEK_DEFAULT_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

COCOINDEX_SEARCH_API_URL = os.getenv(
    "COCOINDEX_SEARCH_API_URL",
    "http://localhost:8000/search",
)

MAX_CAPTURED_ERROR_LEN = 6000
MAX_GENERAL_CONSOLE_LEN = 1000
MAX_RAG_SNIPPET_LEN_FOR_LLM = 7000  # Max length for RAG snippets to send back to LLM

RAG_TOOL_DEFINITION = [
    {
        "type": "function",
        "function": {
            "name": "search_uiautomator2_code_snippets",
            "description": "Searches a specialized knowledge base for uiautomator2 code snippets, examples, and API usage. Use this tool when you need specific uiautomator2 code patterns, selector examples, or how to use certain uiautomator2 methods to answer a user's query about uiautomator2 automation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "A concise and targeted search query for uiautomator2 information. Example: 'uiautomator2 wait for element visible' or 'uiautomator2 selector by resourceId and text'.",
                    }
                },
                "required": ["query"],
            },
        },
    }
]


if not DEEPSEEK_API_KEY:
    logger.warning("DEEPSEEK_API_KEY not found. LLM service will not function.")
if not COCOINDEX_SEARCH_API_URL:
    logger.warning(
        "COCOINDEX_SEARCH_API_URL not found. RAG context retrieval will not function."
    )


async def _fetch_rag_code_snippets(
    query: str, top_k: int = 5
) -> str:  # Increased top_k for LLM query
    if not COCOINDEX_SEARCH_API_URL:
        logger.error("LLM Service: COCOINDEX_SEARCH_API_URL is not configured.")
        return "Error: RAG service URL not configured for snippet retrieval."
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            logger.info(
                f"LLM Service (Tool Call): Querying RAG API ({COCOINDEX_SEARCH_API_URL}) for snippets: '{query[:100]}...'"
            )
            response = await client.get(
                COCOINDEX_SEARCH_API_URL, params={"query": query, "limit": top_k}
            )
            response.raise_for_status()
            search_data = response.json()
            results = search_data.get("results", [])
            if not results:
                logger.info(
                    f"LLM Service (Tool Call): RAG API returned no snippets for query: '{query[:100]}...'"
                )
                return "No specific code snippets found in the uiautomator2 codebase relevant to this query."

            context_str = "Relevant uiautomator2 Code Snippets Found:\n\n"
            for i, snippet_data in enumerate(results):
                filename = (
                    snippet_data.get("filename", "N/A")
                    if isinstance(snippet_data, dict)
                    else "N/A"
                )
                score = (
                    snippet_data.get("score", 0.0)
                    if isinstance(snippet_data, dict)
                    else 0.0
                )
                text = (
                    snippet_data.get("text", "")
                    if isinstance(snippet_data, dict)
                    else ""
                )

                # Truncate individual snippets if they are too long
                max_individual_snippet_len = MAX_RAG_SNIPPET_LEN_FOR_LLM // top_k
                if len(text) > max_individual_snippet_len:
                    text = (
                        text[: max_individual_snippet_len - 50]
                        + "... (snippet truncated)"
                    )

                context_str += f"Snippet {i+1} (from {filename}, score: {score:.2f}):\n"
                context_str += "```python\n"
                context_str += f"{text}\n"
                context_str += "```\n\n"

            logger.info(
                f"LLM Service (Tool Call): Successfully fetched {len(results)} RAG snippets for LLM query."
            )
            if len(context_str) > MAX_RAG_SNIPPET_LEN_FOR_LLM:
                # Further truncate the whole block if necessary
                context_str = (
                    context_str[: MAX_RAG_SNIPPET_LEN_FOR_LLM - 100]
                    + "\n... (overall RAG context truncated)"
                )
            return context_str.strip()

    except Exception as e:  # Catching generic exception for simplicity here
        logger.error(
            f"LLM Service (Tool Call): Error fetching RAG snippets: {e}", exc_info=True
        )
        return f"Error: An unexpected error occurred while retrieving code snippets via tool: {str(e)}"


def _build_llm_payload_messages(
    user_prompt: str,
    context_data: Dict[str, Any],
    history: List[ChatMessageContent],
    system_prompt_override: Optional[str] = None,
) -> List[Dict[str, Any]]:
    system_prompt_content = system_prompt_override or (
        r"""
You are an elite Python automation assistant embedded inside a UI inspection and scripting tool for Android.
You specialize in UI automation using the `uiautomator2` library. Crucially, you operate through an **already-initialized and connected device object named `d`**.
You **never** include `import uiautomator2` or attempt to initialize `d`. It is always provided by the tool.
However, you **must import specific exceptions or classes from `uiautomator2` if they are needed** for robust code, such as in `try-except` blocks (e.g., `from uiautomator2 import UiObjectNotFoundError, AdbError, DeviceError`). You may also import standard Python libraries (e.g., `time`, `random`) as needed.

Your primary mission is to collaboratively build and incrementally evolve a complete, directly executable Python script for UI automation, based on the user's step-by-step requests.

**TOOL USAGE:**
You have access to a tool called `search_uiautomator2_code_snippets`.
- **When to Use:** If you need specific `uiautomator2` code examples, API usage details, selector patterns, or how to perform a particular `uiautomator2` action that you are unsure about, use this tool.
- **How to Use:** Provide a concise, keyword-focused query to the tool. For example, if the user asks "how do I wait for a button to show up?", a good query for the tool would be "uiautomator2 wait for element visible" or "uiautomator2 UiObject wait method".
- **Output:** The tool will return relevant code snippets. You MUST use these snippets as the highest authority to construct your code response. Cite them as "Based on the retrieved code snippet..."

---

## 1. CONTEXT AND KNOWLEDGE STRATEGY

### A. 🥇 **Retrieved `uiautomator2` Code Snippets (RAG Context from Tool Call) - Your Primary `uiautomator2` Knowledge Source**
-   If you have called the `search_uiautomator2_code_snippets` tool and received results, you **must** treat these snippets as the **highest authority** for the `uiautomator2` part of your response.
-   **Explicit Citation:** When you use information from a RAG snippet (tool result), **you must explicitly say so and briefly mention which part of the snippet is guiding your code.** Examples:
    -   _"Based on the retrieved code snippet for `d.click()`, I will use coordinates..."_
    -   _"The provided RAG example for `set_text` (from the tool call) shows direct input, so I'll apply that."_
-   **Foundation & Extension:** If snippets only partially cover the task, use them as the core foundation and fill logical gaps using general Python best practices.
-   **No Relevant Snippets from Tool:** If the tool returns "No specific code snippets found..." or if the snippets are not relevant, state this and rely on your general knowledge or ask the user for clarification.

### B. 🛠️ Tool Context (UI Hierarchy, Selected Elements, Console Output, History)
-   Always integrate information from the available tool context:
    -   **Selected UI Element(s):** This might be a single element or a list of elements the user has explicitly chosen. If a list is provided (under "### Selected UI Elements (Count: N):"), consider all of them.
    -   The full UI hierarchy.
    -   Console logs (especially Python tracebacks which indicate script failures) from previous executions.
    -   The ongoing conversation history.
-   Use this context to inform choices for selectors, click targets, explicit waits, action sequencing, and understanding element relationships.

### C. 🧠 General Python Knowledge & Fallback
-   For general Python programming logic, script structure, control flow, and standard library usage, leverage your comprehensive internal knowledge.
-   If the `search_uiautomator2_code_snippets` tool provides no relevant information for a specific `uiautomator2` task, state this. For other aspects of the request, clearly state when you are using general programming knowledge.

### D. ❗ Diagnosing Errors - User-Provided Traceback First!
-   If the context includes a section titled `## ❗ CRITICAL: User-Provided Last Python Error Traceback:`, this indicates the user has explicitly flagged a Python error for you to fix.
-   **This user-provided traceback is your ABSOLUTE HIGHEST PRIORITY for analysis.**
-   Your immediate goal is to:
    1.  Understand this specific error.
    2.  Explain its cause in the context of the script.
    3.  Provide a corrected version of the *entire script*, focusing on fixing this error.
-   Only if this specific error section is NOT present should you then examine the general "Recent Python Console Output" for any tracebacks or errors.

---
## X. KEY `uiautomator2` REMINDERS & COMMON PITFALLS (Always verify with RAG for full context)
(Keep this section as previously defined)
-   **Element Bounds & Coordinates:** `element.info['bounds']` -> `'left'`, `'top'`, `'right'`, `'bottom'`. Calculate `width` and `height`.
-   **Clicking Elements:** `element.click()`, `element.click(offset=(float, float))`, or `d.click(abs_x, abs_y)`.
-   **Resource ID Typos:** Check package names (e.g., `com.instagram.android`).
-   **Existence Checks:** `element.exists`, `element.wait(timeout=...)`.
---

## 2. CODE OUTPUT AND SCRIPTING BEHAVIOR
(Keep Rules 1-6 as previously defined, ensuring Rule 3's example code block does not use invalid escapes)
### Rule 1 – Output Format: Directly Executable Python
-   All generated code **must** be presented as a single, complete Python code block, wrapped in triple backticks and labeled as `python`.
### Rule 2 – `uiautomator2` Initialization and Imports
-   **No `uiautomator2` Setup:** Never `import uiautomator2` or `d = uiautomator2.connect()`.
-   **Necessary Imports Only:** `from uiautomator2 import UiObjectNotFoundError, AdbError`, `import time`, etc.
### Rule 3 – Iterative, Testable Workflow: The `main_flow(d)` Function
-   Core structure: helper functions, then `main_flow(d)` calling them. Conclude with `if __name__ == '__main__': main_flow(d)`.
    ```python
    # Example Structure:
    # from uiautomator2 import UiObjectNotFoundError # If needed
    # import time
    # import random

    # def helper_function_one(d, params):
    # # ... uiautomator2 code based on RAG ...
    # pass

    # def main_flow(d):
    # helper_function_one(d, ...)

    # if __name__ == '__main__':
    # main_flow(d)
    ```
### Rule 4 – Refactor, Don't Reset
### Rule 5 – Human-Like Interactions
### Rule 6 – Intelligent Uncertainty Handling
---
## 3. EXECUTION CONTEXT AWARENESS 
(Keep as previously defined)
---
## 4. TONE & PERSONALITY – Tactical, Sharp, and Focused
(Keep as previously defined)
---
## 5. SUMMARY OF YOUR ROLE
(Keep as previously defined, emphasizing RAG comes from tool calls if needed)

You will:
-   Author an incrementally evolving `uiautomator2` script via `main_flow(d)`.
-   **If unsure about `uiautomator2` specifics, use the `search_uiautomator2_code_snippets` tool to get information. Base your `uiautomator2` logic on the snippets returned by this tool.**
-   Output complete, executable Python scripts.
-   Intelligently refactor the active workflow.
"""
    )
    messages_for_api = [{"role": "system", "content": system_prompt_content}]

    # Add history, excluding any previous RAG tool responses if they are too verbose or handled differently
    for msg_content_model in history:
        # Potentially filter out or summarize very long tool responses from history here if needed
        messages_for_api.append(msg_content_model.model_dump(exclude_none=True))

    context_sections_for_llm = []

    # RAG snippets are now primarily added via tool call responses,
    # but this section can remain if context_data might contain them from other sources or for direct display.
    # If RAG snippets are ONLY from tool calls, this specific block might be less used for initial prompt.
    rag_code_snippets = context_data.get(
        "rag_code_snippets"
    )  # This key might be populated by tool call results
    if (
        rag_code_snippets
        and "Error:" not in rag_code_snippets
        and "No specific code snippets found" not in rag_code_snippets
    ):
        context_sections_for_llm.append(
            f"## Retrieved uiautomator2 Code Snippets (Potentially from Tool Call / Cache):\n{rag_code_snippets}"
        )

    user_captured_error = context_data.get("pythonLastErrorTraceback")
    if user_captured_error:
        error_content_for_llm = user_captured_error
        if len(user_captured_error) > MAX_CAPTURED_ERROR_LEN:
            half_len = MAX_CAPTURED_ERROR_LEN // 2
            start_slice_len = max(0, half_len - 50)
            end_slice_start_offset = max(0, half_len - 50)
            error_content_for_llm = (
                f"{user_captured_error[:start_slice_len]}\n"
                f"... (Full Traceback Truncated due to excessive length) ...\n"
                f"{user_captured_error[-end_slice_start_offset:]}"
            )
        context_sections_for_llm.append(
            f"## ❗ CRITICAL: User-Provided Last Python Error Traceback:\n"
            f"The user has explicitly included the following error traceback. "
            f"This is the primary issue to diagnose and fix in the script.\n"
            f"```text\n{error_content_for_llm}\n```"
        )

    tool_context_specific_parts = []
    selected_elements_data = context_data.get("selectedElements")
    if selected_elements_data and isinstance(selected_elements_data, list):
        elements_details_for_llm = []
        for i, elem_data in enumerate(selected_elements_data):
            if not isinstance(elem_data, dict):
                continue
            properties = elem_data.get("properties", {})
            se_brief = {
                "name": elem_data.get("name"),
                "properties": {
                    k: v
                    for k, v in properties.items()
                    if k
                    in [
                        "resource-id",
                        "text",
                        "content-desc",
                        "class",
                        "package",
                        "clickable",
                        "enabled",
                    ]
                },
                "rect": elem_data.get("rect"),
                "generatedXPath": elem_data.get("generatedXPath"),
                "key_for_reference": elem_data.get("key"),
            }
            elements_details_for_llm.append(
                f"#### Element {i+1} (User Selection Order - Key: {elem_data.get('key', 'N/A')}):\n```json\n{json.dumps(se_brief, indent=2)}\n```"
            )
        if elements_details_for_llm:
            tool_context_specific_parts.append(
                f"### Selected UI Elements ({len(elements_details_for_llm)}):\n"
                + "\n\n".join(elements_details_for_llm)
            )

    if cd_hier := context_data.get("uiHierarchy"):
        root_name = cd_hier.get("name", "N/A")
        num_children = len(cd_hier.get("children", []))
        tool_context_specific_parts.append(
            f"### UI Hierarchy Overview: Root element is '{root_name}' "
            f"with {num_children} direct children."
        )

    general_console_output = context_data.get("pythonConsoleOutput")
    if general_console_output:
        is_redundant = user_captured_error and (
            user_captured_error == general_console_output
            or user_captured_error in general_console_output
        )
        if not is_redundant:
            truncated_general_output = general_console_output[-MAX_GENERAL_CONSOLE_LEN:]
            tool_context_specific_parts.append(
                f"### General Recent Python Console Output (last {MAX_GENERAL_CONSOLE_LEN} chars):\n"
                f"(Note: If a 'CRITICAL: User-Provided Last Python Error' section is present above, prioritize analyzing that.)\n"
                f"```\n{truncated_general_output}\n```"
            )

    if cd_py_code := context_data.get("pythonCode"):
        tool_context_specific_parts.append(
            f"### Current Python Code in Editor:\n```python\n{cd_py_code}\n```"
        )
    if cd_dev_info := context_data.get("deviceInfo"):
        tool_context_specific_parts.append(
            f"### Device Info:\n```json\n{json.dumps(cd_dev_info, indent=2)}\n```"
        )

    if tool_context_specific_parts:
        context_sections_for_llm.append(
            "## Current UI/System Context (from Tool):\n"
            + "\n\n".join(tool_context_specific_parts)
        )

    full_user_content = ""
    if context_sections_for_llm:
        full_user_content += "\n\n".join(context_sections_for_llm) + "\n\n"
    full_user_content += f"## User Request:\n{user_prompt}"

    messages_for_api.append({"role": "user", "content": full_user_content})
    return messages_for_api


async def generate_chat_completion_stream(
    request_data: LlmServiceChatRequest,
) -> AsyncGenerator[str, None]:
    if not DEEPSEEK_API_KEY:
        error_msg = "Error: DeepSeek API key is not configured on the server."
        yield f"event: error\ndata: {json.dumps({'error': error_msg})}\n\n"
        yield f"event: end-of-stream\ndata: {json.dumps({'message': 'Stream ended due to configuration error'})}\n\n"
        return

    # Initial messages for the LLM (system, history, user prompt with context)
    # RAG snippets are NOT fetched upfront anymore.
    current_context_data = dict(request_data.context) if request_data.context else {}

    # Remove any stale rag_code_snippets from the initial context if it's purely tool-driven now
    # current_context_data.pop("rag_code_snippets", None) # Optional: ensure no old RAG data is sent initially

    messages = _build_llm_payload_messages(
        user_prompt=request_data.prompt,
        context_data=current_context_data,  # This includes UI context, errors, etc.
        history=request_data.history,
    )

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
    }

    tool_choice_setting = "auto"  # Let the LLM decide if it needs the tool

    async with httpx.AsyncClient(timeout=120.0) as client:
        iteration_count = 0
        max_iterations = 3  # Prevent infinite tool call loops

        while iteration_count < max_iterations:
            iteration_count += 1
            logger.info(f"LLM Service: API Call Iteration {iteration_count}")

            payload = {
                "model": request_data.model or DEEPSEEK_DEFAULT_MODEL,
                "messages": messages,
                "stream": True,
                "temperature": (
                    request_data.temperature
                    if request_data.temperature is not None
                    else 0.7
                ),
                "max_tokens": (
                    request_data.max_tokens
                    if request_data.max_tokens is not None
                    else 2048
                ),
                "tools": RAG_TOOL_DEFINITION,
                "tool_choice": tool_choice_setting,
            }
            payload = {k: v for k, v in payload.items() if v is not None}

            logger.info(
                f"LLM Service: Streaming request to DeepSeek API. Model: {payload.get('model')}. Iteration: {iteration_count}"
            )
            if messages and messages[-1]["role"] == "user":
                logger.debug(
                    f"LLM Service (Iteration {iteration_count}): Full user content to LLM: \n{messages[-1]['content'][:500]}..."
                )
            elif messages and messages[-1]["role"] == "tool":
                logger.debug(
                    f"LLM Service (Iteration {iteration_count}): Tool response to LLM: \n{messages[-1]['content'][:500]}..."
                )

            full_response_content = (
                ""  # To accumulate non-tool-call content if tool_choice was "none"
            )
            tool_calls_to_process: Optional[List[Dict[str, Any]]] = None

            try:
                async with client.stream(
                    "POST", DEEPSEEK_API_URL, json=payload, headers=headers
                ) as response:
                    if response.status_code != 200:
                        # ... (existing error handling for API non-200 status) ...
                        error_content_bytes = await response.aread()
                        error_content_str = error_content_bytes.decode(errors="replace")
                        logger.error(
                            f"DeepSeek API Error: {response.status_code} - {error_content_str}"
                        )
                        # ... (yield error and end-of-stream) ...
                        yield f"event: error\ndata: {json.dumps({'error': f'LLM API Error ({response.status_code})'})}\n\n"
                        yield f"event: end-of-stream\ndata: {json.dumps({'message': 'Stream ended due to API error'})}\n\n"
                        return

                    async for line in response.aiter_lines():
                        if not line.strip():
                            continue
                        if line == "data: [DONE]":
                            logger.info(
                                f"DeepSeek stream finished with [DONE] for iteration {iteration_count}."
                            )
                            # If [DONE] is received and no tool_calls were processed, then this is the final response.
                            if not tool_calls_to_process:
                                yield f"event: end-of-stream\ndata: {json.dumps({'message': 'Stream completed by [DONE]'})}\n\n"
                                return
                            break  # Break from line iteration to process tool_calls

                        if line.startswith("data: "):
                            json_data_str = line[len("data: ") :]
                            try:
                                chunk_data = json.loads(json_data_str)
                                choice = chunk_data.get("choices", [{}])[0]
                                delta = choice.get("delta", {})

                                if delta.get("tool_calls"):
                                    # Accumulate tool calls from delta
                                    if tool_calls_to_process is None:
                                        tool_calls_to_process = []

                                    for tc_delta in delta["tool_calls"]:
                                        # DeepSeek might send tool calls incrementally.
                                        # We need to reconstruct them.
                                        # Assuming tc_delta has 'index', 'id', 'type', 'function': {'name', 'arguments'}
                                        # This logic might need refinement based on actual DeepSeek delta structure for tool_calls
                                        idx = tc_delta.get(
                                            "index", 0
                                        )  # Should have index
                                        if idx >= len(tool_calls_to_process):
                                            tool_calls_to_process.append(
                                                {}
                                            )  # Add new tool call object

                                        # Merge parts of the tool call
                                        current_tc = tool_calls_to_process[idx]
                                        if "id" not in current_tc and tc_delta.get(
                                            "id"
                                        ):
                                            current_tc["id"] = tc_delta.get("id")
                                        if "type" not in current_tc and tc_delta.get(
                                            "type"
                                        ):
                                            current_tc["type"] = tc_delta.get("type")

                                        if "function" not in current_tc:
                                            current_tc["function"] = {}

                                        if tc_delta.get("function"):
                                            if "name" not in current_tc[
                                                "function"
                                            ] and tc_delta["function"].get("name"):
                                                current_tc["function"]["name"] = (
                                                    tc_delta["function"]["name"]
                                                )
                                            if tc_delta["function"].get("arguments"):
                                                current_tc["function"]["arguments"] = (
                                                    current_tc["function"].get(
                                                        "arguments", ""
                                                    )
                                                    + tc_delta["function"]["arguments"]
                                                )
                                    logger.debug(
                                        f"LLM Service: Received tool_call delta: {tc_delta}"
                                    )

                                delta_content_text = delta.get("content")
                                if delta_content_text is not None:
                                    full_response_content += delta_content_text
                                    yield f"data: {json.dumps(delta_content_text)}\n\n"

                                finish_reason = choice.get("finish_reason")
                                if finish_reason:
                                    logger.info(
                                        f"LLM reported finish_reason: {finish_reason} in iteration {iteration_count}"
                                    )
                                    if finish_reason == "tool_calls":
                                        # The full tool_calls might be in choice.message if not fully in delta
                                        if not tool_calls_to_process and choice.get(
                                            "message", {}
                                        ).get("tool_calls"):
                                            tool_calls_to_process = choice["message"][
                                                "tool_calls"
                                            ]
                                        logger.info(
                                            f"LLM wants to make tool calls: {tool_calls_to_process}"
                                        )
                                    # If finish_reason is 'stop' and we have accumulated content, it's a direct answer.
                                    elif (
                                        finish_reason == "stop"
                                        and not tool_calls_to_process
                                    ):
                                        yield f"event: end-of-stream\ndata: {json.dumps({'message': 'Stream completed by stop reason'})}\n\n"
                                        return
                                    # Other finish reasons might also indicate end of this turn.
                            except (json.JSONDecodeError, IndexError) as e:
                                logger.error(
                                    f"Error processing chunk: '{json_data_str}', Error: {e}"
                                )

            except httpx.RequestError as e:  # Network errors for this iteration
                # ... (yield error and end-of-stream) ...
                yield f"event: error\ndata: {json.dumps({'error': f'Network error: {e}'})}\n\n"
                yield f"event: end-of-stream\ndata: {json.dumps({'message': 'Stream ended due to network error.'})}\n\n"
                return
            except Exception as e:  # Other errors for this iteration
                # ... (yield error and end-of-stream) ...
                yield f"event: error\ndata: {json.dumps({'error': f'Unexpected error: {e}'})}\n\n"
                yield f"event: end-of-stream\ndata: {json.dumps({'message': 'Stream ended due to server error.'})}\n\n"
                return

            if tool_calls_to_process:
                # Add the assistant's message that requested the tool call to history
                # The 'content' might be null if it only made tool calls.
                # The actual tool_calls structure is now in tool_calls_to_process
                assistant_message_with_tool_call = {
                    "role": "assistant",
                    "content": full_response_content or None,
                }
                # Reconstruct the tool_calls part for the history message based on DeepSeek's API
                # This assumes tool_calls_to_process is a list of fully formed tool call objects
                assistant_message_with_tool_call["tool_calls"] = tool_calls_to_process
                messages.append(assistant_message_with_tool_call)

                logger.info(
                    f"LLM Assistant message with tool_calls: {json.dumps(assistant_message_with_tool_call)}"
                )

                for tool_call_data in tool_calls_to_process:
                    function_name = tool_call_data.get("function", {}).get("name")
                    tool_call_id = tool_call_data.get("id")

                    if function_name == "search_uiautomator2_code_snippets":
                        try:
                            arguments = json.loads(
                                tool_call_data.get("function", {}).get(
                                    "arguments", "{}"
                                )
                            )
                            query = arguments.get("query")
                            if not query:
                                raise ValueError(
                                    "Query not found in tool call arguments"
                                )
                        except (json.JSONDecodeError, ValueError) as e:
                            logger.error(
                                f"Error parsing arguments for tool {function_name}: {e}"
                            )
                            tool_response_content = (
                                f"Error: Invalid arguments for {function_name}: {e}"
                            )
                        else:
                            logger.info(
                                f"LLM Tool Call: Executing {function_name} with query: '{query}'"
                            )
                            tool_response_content = await _fetch_rag_code_snippets(
                                query
                            )

                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "name": function_name,
                                "content": tool_response_content,
                            }
                        )
                        logger.info(
                            f"LLM Tool Call: Appended tool response for {function_name} to messages."
                        )
                    else:
                        logger.warning(
                            f"LLM Tool Call: Unknown function name '{function_name}' requested."
                        )
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "name": function_name,
                                "content": f"Error: Unknown tool '{function_name}'.",
                            }
                        )
                tool_choice_setting = (
                    "none"  # Next turn, LLM should respond directly after tool use
                )
            else:
                # No tool calls, means LLM provided a direct answer or finished.
                # The stream loop for lines should have handled yielding content and end-of-stream.
                logger.info(
                    f"LLM Service: No tool calls to process in iteration {iteration_count}. Assuming direct answer or end."
                )
                # If we are here, it implies [DONE] was not hit, or it was but tool_calls were processed
                # and now we are in a subsequent iteration where no tool calls were made.
                # This path should ideally be covered by the line iteration loop's end-of-stream.
                if (
                    not full_response_content and iteration_count > 1
                ):  # No content and not first iteration
                    logger.warning(
                        "LLM Service: No content and no tool calls after tool processing. Ending."
                    )
                yield f"event: end-of-stream\ndata: {json.dumps({'message': 'Stream ended after processing.'})}\n\n"
                return

        logger.warning(
            f"LLM Service: Exceeded max iterations ({max_iterations}). Ending stream."
        )
        yield f"event: error\ndata: {json.dumps({'error': 'Processing loop exceeded max iterations.'})}\n\n"
        yield f"event: end-of-stream\ndata: {json.dumps({'message': 'Stream ended due to max iterations.'})}\n\n"
