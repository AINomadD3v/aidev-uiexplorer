import asyncio
import json
import logging
import os
from typing import Any, AsyncGenerator, Dict, List, Optional, Union

import httpx

# --- MODIFIED: Import Pydantic models from model.py ---
from model import (
    ChatMessageContent,
    ChatMessageDelta,
    LlmServiceChatRequest,
    ToolCall,
    ToolCallFunction,
)

# Pydantic BaseModel is still needed for the classes if they are not all imported
# from pydantic import BaseModel # BaseModel itself might not be needed if all models are imported

# Note: If model.py also contains DeviceInfo, ShellResponse, Rect, Node, OCRNode, WindowSize, AppInfo,
# they are not directly used in this llm_service.py file, so they are not explicitly imported here
# unless a function signature or internal logic were to require them.

logger = logging.getLogger(__name__)

# --- LLM Configuration ---
DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions"
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
DEEPSEEK_DEFAULT_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

# --- RAG API Configuration ---
COCOINDEX_SEARCH_API_URL = os.getenv(
    "COCOINDEX_SEARCH_API_URL",
    "http://localhost:8000/search",  # Default for your RAG API
)
# --------------------------

# --- Configuration for User-Provided Error Traceback ---
MAX_CAPTURED_ERROR_LEN = 6000  # Max length for the explicitly included error traceback
MAX_GENERAL_CONSOLE_LEN = 1000  # Max length for general console output (existing)
# ----------------------------------------------------


if not DEEPSEEK_API_KEY:
    logger.warning(
        "DEEPSEEK_API_KEY not found in environment variables. "
        "LLM service will not function correctly."
    )
if not COCOINDEX_SEARCH_API_URL:
    logger.warning(
        "COCOINDEX_SEARCH_API_URL not found in environment variables. "
        "RAG context retrieval will not function."
    )


# --- Pydantic Models for LLM Interaction ---
# These are now imported from .model


# --- RAG Context Retrieval Function (existing function unchanged) ---
async def _fetch_rag_code_snippets(query: str, top_k: int = 3) -> str:
    """
    Fetches relevant code snippets from the CocoIndex RAG API.
    """
    if not COCOINDEX_SEARCH_API_URL:
        logger.error("LLM Service: COCOINDEX_SEARCH_API_URL is not configured.")
        return "Error: RAG service URL not configured for snippet retrieval."

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            logger.info(
                f"LLM Service: Querying RAG API ({COCOINDEX_SEARCH_API_URL}) for snippets: '{query[:70]}...'"
            )
            response = await client.get(
                COCOINDEX_SEARCH_API_URL, params={"query": query, "limit": top_k}
            )
            response.raise_for_status()
            search_data = response.json()

            results = search_data.get("results", [])
            if not results:
                logger.info(
                    f"LLM Service: RAG API returned no snippets for query: '{query[:70]}...'"
                )
                return "No specific code snippets found in the uiautomator2 codebase relevant to this query."

            context_str = ""
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

                context_str += f"Snippet {i+1} (from {filename}, score: {score:.2f}):\n"
                context_str += "```python\n"
                context_str += f"{text}\n"
                context_str += "```\n\n"
            logger.info(
                f"LLM Service: Successfully fetched {len(results)} RAG snippets."
            )
            return context_str.strip()
    except httpx.RequestError as e:
        logger.error(f"LLM Service RAG API RequestError: {e}", exc_info=True)
        return f"Error: Could not connect to the code snippet search service: {str(e)}"
    except httpx.HTTPStatusError as e:
        logger.error(
            f"LLM Service RAG API HTTPStatusError: {e.response.status_code} - {e.response.text}",
            exc_info=True,
        )
        return f"Error: Code snippet search service returned an error: {e.response.status_code}"
    except Exception as e:
        logger.error(
            f"LLM Service: Unexpected error fetching RAG snippets: {e}", exc_info=True
        )
        return "Error: An unexpected error occurred while retrieving code snippets."


# --- LLM Payload Construction (MODIFIED for new error context and system prompt) ---
def _build_llm_payload_messages(
    user_prompt: str,
    context_data: Dict[str, Any],
    history: List[ChatMessageContent],  # Type hint uses imported model
    system_prompt_override: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Helper function to construct the 'messages' list for the LLM API payload.
    """
    system_prompt_content = system_prompt_override or (
        # Using r""" (raw triple-quoted string) to avoid issues with backslashes in the prompt itself,
        # though the primary fix is removing the erroneous \` sequences.
        r"""
You are an elite Python automation assistant embedded inside a UI inspection and scripting tool for Android.
You specialize in UI automation using the `uiautomator2` library. Crucially, you operate through an **already-initialized and connected device object named `d`**.
You **never** include `import uiautomator2` or attempt to initialize `d` (e.g., `d = uiautomator2.connect()`). It is always provided by the tool.
However, you **must import specific exceptions or classes from `uiautomator2` if they are needed** for robust code, such as in `try-except` blocks (e.g., `from uiautomator2 import UiObjectNotFoundError, AdbError, DeviceError`). You may also import standard Python libraries (e.g., `time`, `random`) as needed.

Your primary mission is to collaboratively build and incrementally evolve a complete, directly executable Python script for UI automation, based on the user's step-by-step requests.

---

## 1. CONTEXT AND KNOWLEDGE STRATEGY

### A. 🥇 **Retrieved `uiautomator2` Code Snippets (RAG Context) - Your Primary `uiautomator2` Knowledge Source**
-   **Mandatory Use:** All `uiautomator2`-specific API calls, methods, selector strategies, and coding patterns **must be directly based on information from the "Retrieved `uiautomator2` Code Snippets" (RAG context)** provided by the system. This is your highest authority for `uiautomator2` tasks.
-   **Explicit Citation:** When you use information from a RAG snippet, **you must explicitly say so and briefly mention which part of the snippet is guiding your code.** Examples:
    -   _"Based on the RAG snippet for `d.click()`, I will use coordinates..."_
    -   _"The provided RAG example for `set_text` shows direct input, so I'll apply that."_
    -   _"Using the RAG snippet detailing `wait_for_selector` for robust element presence checks..."_
-   **Foundation & Extension:** If RAG snippets only partially cover the request, use them as the core foundation and fill any logical gaps using general Python best practices. If a RAG snippet is unclear or seems contradictory for `uiautomator2` usage, point this out.
-   **No RAG, No `uiautomator2` Invention:** If the RAG context provides no relevant information for a specific `uiautomator2` task or API usage requested by the user, **do not invent or guess `uiautomator2` solutions.** Clearly state that the RAG context is insufficient for that specific `uiautomator2` aspect and ask for more details or suggest alternative approaches that *are* supported by the provided RAG snippets.

### B. 🛠️ Tool Context (UI Hierarchy, Selected Elements, Console Output, History)
-   Always integrate information from the available tool context: selected UI elements, the full UI hierarchy, console logs (especially Python tracebacks which indicate script failures) from previous executions, and the ongoing conversation history.
-   Assume selected elements are the immediate target for interaction unless specified otherwise.
-   Use this context to inform choices for selectors, click targets, explicit waits, action sequencing, and understanding element relationships (parent/child/sibling).

### C. 🧠 General Python Knowledge & Fallback
-   For general Python programming logic, script structure (outside of `uiautomator2` specifics), control flow, and standard library usage, leverage your comprehensive internal knowledge.
-   If RAG and tool context are insufficient for `uiautomator2` specifics, you will have already stated this (as per 1.A). For other aspects of the request, clearly state when you are using general programming knowledge.

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

-   **Element Bounds & Coordinates:**
    -   `element.info['bounds']` provides a dictionary with `'left'`, `'top'`, `'right'`, `'bottom'` keys.
    -   **Crucial:** Calculate `width` as `bounds['right'] - bounds['left']` and `height` as `bounds['bottom'] - bounds['top']`. Do NOT assume `'width'` or `'height'` keys exist directly in `element.info['bounds']`.
-   **Clicking Elements:**
    -   For a standard click on an element, `element.click()` is often sufficient (verify with RAG).
    -   For clicks with *relative offsets*, `element.click(offset=(x_ratio, y_ratio))` expects `x_ratio` and `y_ratio` to be **floats between 0.0 and 1.0** (e.g., 0.5 for center).
    -   For clicks at *specific pixel coordinates within an element's area*, you must first get the element's absolute `bounds`, calculate the target absolute screen coordinates (e.g., `target_x = bounds['left'] + internal_pixel_offset_x`), and then use `d.click(target_x, target_y)`.
-   **Resource ID Typos:** Double-check for common typos in package names (e.g., ensure `com.instagram.android` not `com.instagram.androie`). The tool context might provide the correct IDs.
-   **Existence Checks:** Before interacting with an element, especially after an action or wait, consider if an existence check like `element.exists` or `element.wait(timeout=...)` is appropriate, as shown in RAG snippets.

---

## 2. CODE OUTPUT AND SCRIPTING BEHAVIOR

### Rule 1 – Output Format: Directly Executable Python
-   All generated code **must** be presented as a single, complete Python code block, wrapped in triple backticks and labeled as `python`.
-   This entire block will be sent by the user directly to the tool's interactive Python console for immediate execution.

### Rule 2 – `uiautomator2` Initialization and Imports
-   **No `uiautomator2` Setup:** Reiteration: Never include `import uiautomator2` or `d = uiautomator2.connect()`. Assume `d` is ready.
-   **Necessary Imports Only:** You **must** include import statements at the top of the script for any other modules or specific classes/exceptions needed, for example:
    -   `from uiautomator2 import UiObjectNotFoundError, AdbError`
    -   `import time`
    -   `import random`

### Rule 3 – Iterative, Testable Workflow: The `main_flow(d)` Function
-   **Core Structure:** Your primary output is an evolving Python script. This script **must** define helper functions for discrete actions/logics at the top. These helper functions should then be called in sequence from a central orchestrating function, typically named `main_flow(d)`.
-   **Always Include `main_flow(d)`:** Every response containing code must include the complete `main_flow(d)` function, reflecting all requested steps up to that point, and any necessary helper functions.
-   **Testability:** The script must conclude with a standard Python `if __name__ == '__main__':` block that calls `main_flow(d)`. This ensures the entire workflow can be tested by the user immediately.
    ```python
    # Example Structure:
    # from uiautomator2 import UiObjectNotFoundError # If needed
    # import time
    # import random

    # def helper_function_one(d, params):
    # # ... uiautomator2 code based on RAG ...
    # pass

    # def helper_function_two(d, other_params):
    # # ... uiautomator2 code based on RAG ...
    # pass

    # def main_flow(d):
    # # Step 1
    # helper_function_one(d, ...)
    # # Step 2 (added in a later interaction)
    # helper_function_two(d, ...)
    # # ... more steps added iteratively

    # if __name__ == '__main__':
    # # The user's environment provides 'd', so no connection here.
    # # This block allows the tool to execute main_flow.
    # main_flow(d)
    ```

### Rule 4 – Refactor, Don't Reset: Building the Workflow Incrementally
-   **Cumulative Scripting:** Treat every user request as an instruction to **modify and extend the *current existing script***. You are building a single, coherent workflow over the course of the conversation.
-   **Modify `main_flow(d)`:** When the user asks to "click this button" then later "wait for this text", the second request means adding the wait logic *into the `main_flow(d)` sequence after the button click logic* from the first request, potentially by adding a new helper function and calling it from `main_flow(d)`.
-   **Refactor for Clarity:** As `main_flow(d)` grows, if a sequence of operations becomes complex, encapsulate it into a new helper function and call that new helper from `main_flow(d)`. The goal is a readable, maintainable, and evolving script.
-   **Always Show the Full Script:** Do not provide just the new function or fragment. Present the *entire updated Python script block*, including all helper functions and the complete `main_flow(d)` with the new logic integrated.

### Rule 5 – Human-Like Interactions
-   When appropriate or requested, enhance automation with human-like behavior. Base these techniques on RAG snippets if available, or use standard practices:
    -   Random `time.sleep()` intervals between actions.
    -   Clicking at slight random offsets within an element's bounds.
    -   Simulating character-by-character text input with small delays.

### Rule 6 – Intelligent Uncertainty Handling
-   If a user's request is vague, ambiguous, or if `uiautomator2` context seems insufficient:
    -   **Do not guess** or make assumptions about element selectors or actions.
    -   Instead, ask specific clarifying questions.
    -   Suggest using tool features like `d.dump_hierarchy()` or inspecting `d.info` to get more precise information, and explain what you'd need from that output.

---

## 3. EXECUTION CONTEXT AWARENESS

-   **Direct Execution:** The entire Python code block you provide (containing helper functions, `main_flow(d)`, and the `if __name__ == '__main__':` block) will be executed directly in the tool's interactive console.
-   **Sequential `main_flow(d)`:** Ensure that `main_flow(d)` correctly orchestrates all defined helper functions in the order they represent the cumulative workflow. Explain how new additions fit into this sequence.

---

## 4. TONE & PERSONALITY – Tactical, Sharp, and Focused

You are intelligent, dry, and unapologetically efficient. You don't waste words. You deliver precision Python and call out nonsense when you see it (politely, if it's user error; humorously, if it's an Android quirk).

-   **Humor:** Optional, subtle, and must never distract from clarity or correctness. Confine it to brief post-code comments or one-liners.
-   **Target of Humor:** Never the user. Focus on quirky UIs, fragile Android layouts, absurd edge cases, or the occasional drama of automation.
-   **Example one-liners (only after providing the complete code block):**
    -   _"Workflow updated. That UI element was surprisingly cooperative."_
    -   _"Element located and action sequenced. Android still has a few tricks, apparently."_
    -   _"Delays peppered in. Because even robots need to look like they're thinking."_
-   **Tone Hierarchy:** **Correctness & RAG-Adherence > Clarity > Cleverness**

---

## 5. SUMMARY OF YOUR ROLE

You are **not** a general-purpose chatbot. You are an **elite `uiautomator2` automation specialist integrated into a high-speed development toolchain.**

You will:
-   **Author an incrementally evolving, multi-step `uiautomator2` script centered around a `main_flow(d)` function.**
-   **Strictly prioritize and base all `uiautomator2` logic on the provided RAG code snippets and UI tool context.**
-   **Output only complete, directly executable Python scripts that will run cleanly in the tool's environment (assuming `d` is provided).**
-   **Intelligently update and refactor the active `main_flow(d)` and its helpers with each user request, never starting from scratch or providing isolated fragments.**
-   **Inject wit sparingly and appropriately—but never compromise on function or clarity.**

When the user provides new instructions, you don't just generate new code; you **integrate and refactor** the existing workflow. Your goal is to leave the user with a more complete and robust automation script after every interaction.
"""
    )
    messages_for_api = [{"role": "system", "content": system_prompt_content}]
    for msg_content_model in history:  # history elements are ChatMessageContent
        messages_for_api.append(msg_content_model.model_dump(exclude_none=True))

    context_sections_for_llm = []

    # 1. Add RAG Code Snippets (if available in context_data)
    rag_code_snippets = context_data.get("rag_code_snippets")
    if (
        rag_code_snippets
        and "Error:" not in rag_code_snippets
        and "No specific code snippets found" not in rag_code_snippets
    ):
        context_sections_for_llm.append(
            f"## Retrieved uiautomator2 Code Snippets (RAG Context):\n{rag_code_snippets}"
        )

    # ----> Add User-Captured Last Error Traceback (HIGH PRIORITY) <----
    user_captured_error = context_data.get(
        "pythonLastErrorTraceback"
    )  # Key from JS client
    if user_captured_error:
        error_content_for_llm = user_captured_error
        if len(user_captured_error) > MAX_CAPTURED_ERROR_LEN:
            half_len = MAX_CAPTURED_ERROR_LEN // 2
            start_slice_len = max(0, half_len - 50)  # Ensure non-negative
            end_slice_start_offset = max(0, half_len - 50)  # Ensure non-negative

            error_content_for_llm = (
                f"{user_captured_error[:start_slice_len]}\n"
                f"... (Full Traceback Truncated due to excessive length) ...\n"
                f"{user_captured_error[-end_slice_start_offset:]}"
            )
            logger.warning(
                f"User-captured error traceback was truncated from {len(user_captured_error)} to {len(error_content_for_llm)} chars."
            )

        context_sections_for_llm.append(
            f"## ❗ CRITICAL: User-Provided Last Python Error Traceback:\n"
            f"The user has explicitly included the following error traceback. "
            f"This is the primary issue to diagnose and fix in the script.\n"
            f"```text\n{error_content_for_llm}\n```"
        )

    # 2. Add Other Tool Context (selected element, hierarchy, console, etc.)
    tool_context_specific_parts = []
    if cd_se := context_data.get("selectedElement"):
        se_brief = {
            "name": cd_se.get("name"),
            "properties": {
                k: v
                for k, v in cd_se.get("properties", {}).items()
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
            "rect": cd_se.get("rect"),
            "generatedXPath": cd_se.get("generatedXPath"),
        }
        tool_context_specific_parts.append(
            f"### Selected Element:\n```json\n{json.dumps(se_brief, indent=2)}\n```"
        )

    if cd_hier := context_data.get("uiHierarchy"):
        root_name = cd_hier.get("name", "N/A")
        num_children = len(cd_hier.get("children", []))
        tool_context_specific_parts.append(
            f"### UI Hierarchy Overview: Root element is '{root_name}' "
            f"with {num_children} direct children. Focus on relevant parts based on the query."
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
    # logger.debug(f"LLM Service: Messages for LLM API: {json.dumps(messages_for_api, indent=2)}")
    return messages_for_api


# --- Main LLM Interaction Function (Unchanged from previous version with error context) ---
async def generate_chat_completion_stream(
    request_data: LlmServiceChatRequest,  # Type hint uses imported model
) -> AsyncGenerator[str, None]:
    if not DEEPSEEK_API_KEY:
        error_msg = "Error: DeepSeek API key is not configured on the server."
        yield f"event: error\ndata: {json.dumps({'error': error_msg})}\n\n"
        yield f"event: end-of-stream\ndata: {json.dumps({'message': 'Stream ended due to configuration error'})}\n\n"
        return

    logger.info(
        f"LLM Service: Fetching RAG snippets for prompt: {request_data.prompt[:70]}..."
    )
    rag_snippets_context = await _fetch_rag_code_snippets(request_data.prompt)

    current_context_data = dict(request_data.context) if request_data.context else {}
    current_context_data["rag_code_snippets"] = rag_snippets_context

    if (
        "Error:" in rag_snippets_context
        or "No specific code snippets found" in rag_snippets_context
    ):
        logger.info(f"LLM Service: RAG snippets status: {rag_snippets_context}")
    else:
        logger.info(
            f"LLM Service: Successfully fetched RAG snippets (length: {len(rag_snippets_context)})."
        )

    messages_for_api = _build_llm_payload_messages(
        user_prompt=request_data.prompt,
        context_data=current_context_data,
        history=request_data.history,
    )

    payload = {
        "model": request_data.model or DEEPSEEK_DEFAULT_MODEL,
        "messages": messages_for_api,
        "stream": True,
        "temperature": (
            request_data.temperature if request_data.temperature is not None else 0.7
        ),
        "max_tokens": (
            request_data.max_tokens if request_data.max_tokens is not None else 2048
        ),
    }
    payload = {k: v for k, v in payload.items() if v is not None}

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            logger.info(
                f"LLM Service: Streaming request to DeepSeek API. Model: {payload.get('model')}. "
                f"User prompt (start): {request_data.prompt[:70]}..."
            )
            # Enable for full prompt debugging:
            # if messages_for_api and messages_for_api[-1]['role'] == 'user':
            #    logger.debug(f"LLM Service: Full user content being sent to LLM: \n{messages_for_api[-1]['content']}")

            async with client.stream(
                "POST", DEEPSEEK_API_URL, json=payload, headers=headers
            ) as response:
                if response.status_code != 200:
                    error_content_bytes = await response.aread()
                    error_content_str = error_content_bytes.decode(errors="replace")
                    logger.error(
                        f"DeepSeek API Error: {response.status_code} - {error_content_str}"
                    )
                    api_error_detail = (
                        f"LLM API Error ({response.status_code}): {error_content_str}"
                    )
                    try:
                        err_json = json.loads(error_content_str)
                        api_error_detail = err_json.get("error", {}).get(
                            "message", api_error_detail
                        )
                    except json.JSONDecodeError:
                        pass
                    yield f"event: error\ndata: {json.dumps({'error': api_error_detail})}\n\n"
                    yield f"event: end-of-stream\ndata: {json.dumps({'message': 'Stream ended due to API error'})}\n\n"
                    return

                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    if line == "data: [DONE]":
                        logger.info("DeepSeek stream finished with [DONE].")
                        yield f"event: end-of-stream\ndata: {json.dumps({'message': 'Stream completed by [DONE]'})}\n\n"
                        return
                    if line.startswith("data: "):
                        json_data_str = line[len("data: ") :]
                        try:
                            chunk_data = json.loads(json_data_str)
                            choice = chunk_data.get("choices", [{}])[0]
                            delta = choice.get("delta", {})  # This is ChatMessageDelta
                            delta_content_text = delta.get("content")
                            if delta_content_text is not None:
                                yield f"data: {json.dumps(delta_content_text)}\n\n"

                            finish_reason = choice.get("finish_reason")
                            if finish_reason:
                                logger.info(
                                    f"LLM reported finish_reason: {finish_reason}"
                                )
                                full_message_on_finish = choice.get(
                                    "message", {}
                                )  # This is ChatMessageContent
                                if finish_reason == "tool_calls":
                                    tool_calls_from_message = (
                                        full_message_on_finish.get(
                                            "tool_calls"
                                        )  # This is List[ToolCall]
                                    )
                                    if tool_calls_from_message:
                                        logger.info(
                                            f"Completed tool_calls received: {json.dumps(tool_calls_from_message)}"
                                        )
                                        # Validate with Pydantic if necessary before yielding
                                        # validated_tool_calls = [ToolCall.model_validate(tc) for tc in tool_calls_from_message]
                                        yield f"event: tool_request_details\ndata: {json.dumps(tool_calls_from_message)}\n\n"
                                    else:
                                        logger.warning(
                                            "finish_reason was 'tool_calls' but no tool_calls found in message."
                                        )
                            if usage_data := chunk_data.get("usage"):
                                if payload.get("stream_options", {}).get(
                                    "include_usage"
                                ):
                                    logger.info(
                                        f"Token usage from stream: {usage_data}"
                                    )
                                    yield f"event: usage_update\ndata: {json.dumps(usage_data)}\n\n"
                        except (json.JSONDecodeError, IndexError) as e:
                            logger.error(
                                f"Error processing/parsing chunk from DeepSeek stream: '{json_data_str}', Error: {e}"
                            )

                logger.warning(
                    "DeepSeek stream loop finished without explicit [DONE] message. Signaling end-of-stream."
                )
                yield f"event: end-of-stream\ndata: {json.dumps({'message': 'Stream ended (no explicit [DONE] received).'})}\n\n"

        except httpx.RequestError as e:
            error_message = f"Network issue contacting LLM provider: {str(e)}"
            logger.error(error_message, exc_info=True)
            yield f"event: error\ndata: {json.dumps({'error': error_message})}\n\n"
            yield f"event: end-of-stream\ndata: {json.dumps({'message': 'Stream ended due to network error.'})}\n\n"
        except Exception as e:
            error_message = (
                f"An unexpected error occurred within the LLM service: {str(e)}"
            )
            logger.error(error_message, exc_info=True)
            yield f"event: error\ndata: {json.dumps({'error': error_message})}\n\n"
            yield f"event: end-of-stream\ndata: {json.dumps({'message': 'Stream ended due to unexpected server error.'})}\n\n"
