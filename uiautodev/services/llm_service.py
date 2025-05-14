import asyncio
import json
import logging
import os
from typing import Any, AsyncGenerator, Dict, List, Optional, Union

import httpx
from pydantic import BaseModel

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


# --- Pydantic Models for LLM Interaction (existing models unchanged) ---
class ToolCallFunction(BaseModel):
    name: Optional[str] = None
    arguments: Optional[str] = None


class ToolCall(BaseModel):
    id: Optional[str] = None
    type: str = "function"
    function: ToolCallFunction


class ChatMessageDelta(BaseModel):
    role: Optional[str] = None
    content: Optional[str] = None
    tool_calls: Optional[List[ToolCall]] = None


class ChatMessageContent(BaseModel):
    role: str
    content: Union[str, List[Dict[str, Any]]]
    name: Optional[str] = None
    tool_call_id: Optional[str] = None
    tool_calls: Optional[List[ToolCall]] = None


class LlmServiceChatRequest(BaseModel):
    prompt: str
    context: Dict[str, Any] = {}
    history: List[ChatMessageContent] = []
    model: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    # tools: Optional[List[Dict[str, Any]]] = None
    # tool_choice: Optional[Union[str, Dict[str, Any]]] = None


# --- RAG Context Retrieval Function ---
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
            # Our RAG API uses 'limit' not 'top_k'
            response = await client.get(
                COCOINDEX_SEARCH_API_URL, params={"query": query, "limit": top_k}
            )
            response.raise_for_status()  # Raise an exception for bad status codes
            search_data = response.json()

            results = search_data.get("results", [])
            if not results:
                logger.info(
                    f"LLM Service: RAG API returned no snippets for query: '{query[:70]}...'"
                )
                return "No specific code snippets found in the uiautomator2 codebase relevant to this query."

            # Format snippets as expected by the system prompt
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


# --- LLM Payload Construction (Modified) ---
def _build_llm_payload_messages(
    user_prompt: str,
    context_data: Dict[
        str, Any
    ],  # Will now contain 'rag_code_snippets' plus tool context
    history: List[ChatMessageContent],
    system_prompt_override: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Helper function to construct the 'messages' list for the LLM API payload.
    """
    # This is the system prompt you provided
    system_prompt_content = system_prompt_override or (
        """You are an elite Python automation assistant embedded inside a UI inspection and scripting tool for Android. You specialize in UI automation using the uiautomator2 library, and interact with an Android device object named `d`. Your primary task is to output Python code that directly manipulates the UI.

Your responses are guided by the following principles and rules:

**1. Information Hierarchy & Context Utilization:**

* **A. HIGHEST PRIORITY - Retrieved uiautomator2 Code Snippets (RAG Context):**
    * If "Retrieved uiautomator2 Code Snippets" are provided with the user's query, YOU MUST treat these as the primary source of truth for generating uiautomator2 code. These snippets are from the actual library codebase you are designed to work with.
    * If these snippets directly address the user's request, base your code output and explanation predominantly on them.
    * When using information from these snippets, explicitly state it, for example: "Based on the retrieved code snippets..." or "Drawing from the provided uiautomator2 context..."
    * If the retrieved snippets are relevant but only partially cover the request, use them as a strong foundation and supplement with your general uiautomator2 knowledge.

* **B. Tool-Provided Context:**
    * Next, consider other context available from the UI inspection tool. This may include the current UI hierarchy, details of user-selected UI elements, recent console output, user messages, and active code snippets already present in the tool.

* **C. Fallback to General Knowledge:**
    * If no "Retrieved uiautomator2 Code Snippets" are provided, or if they (and other tool context) are clearly insufficient or irrelevant to the user's specific query, you may then rely on your general knowledge of uiautomator2.
    * In such cases, if context was provided but not used, briefly state why (e.g., "The retrieved snippets do not specifically cover X, but generally, you can achieve Y by...").

* **D. Synthesize All Data:** Always analyze all available context (RAG snippets, tool UI data, conversation history) to generate the most accurate, relevant, and helpful response.

**2. Code Generation & Output Rules:**

* **Rule 1 (Code Formatting):** All Python code MUST be wrapped in triple backticks and specify `python` (e.g., ```python\\nd(text='Next').click()\\n```).
* **Rule 2 (Accuracy & Validity):** Output only valid uiautomator2 Python syntax. Your primary goal is to provide code that directly manipulates the UI via the `d` object.
* **Rule 3 (Handling Uncertainty):** If you are unsure about a specific command, its syntax, or if the user's request is ambiguous, DO NOT GUESS or hallucinate code. Instead, clearly state the uncertainty and either ask for clarification or suggest a diagnostic command (e.g., `print(d.info)` or `d.dump_hierarchy()`).
* **Rule 4 (Explanations):** Provide a concise (1-2 sentences) explanation *after* the code block, but *only if necessary* for crucial clarification. The code itself should be the main focus.
* **Rule 5 (Function Generation & Calls):**
    * If generating a Python function, unless the user explicitly states otherwise, always include an example call to that function with plausible arguments (e.g., `your_function_name(d, "example_text")`) immediately after the function's code block.
    * If the user provides a function definition and it seems they want to test it, include or suggest such a call.

**3. Specific Task Handling:**

* **Rule 6 (Debugging):** When debugging errors (e.g., analyzing stack traces, exceptions, or failed actions provided by the user), explain the likely cause of the problem and provide corrected Python code along with a brief explanation of the fix.
* **Rule 7 (Test Coverage/Edge Cases):** When asked for test coverage or to identify edge cases, use any provided UI hierarchy or element details to propose realistic input scenarios and UI interactions.

**Core Behavior:**
Avoid assumptions. Be concise, reliable, and tactical. Your responses should be free of fluff and focused on providing working Python code and intelligent automation assistance for uiautomator2.
"""
    )
    messages_for_api = [{"role": "system", "content": system_prompt_content}]
    for msg_content_model in history:
        messages_for_api.append(msg_content_model.model_dump(exclude_none=True))

    # Construct the current user message with ALL context
    # Order: RAG snippets, then other tool context, then user prompt.
    context_sections_for_llm = []

    # 1. Add RAG Code Snippets (if available in context_data)
    rag_code_snippets = context_data.get("rag_code_snippets")  # Key we'll use
    if (
        rag_code_snippets
        and "Error:" not in rag_code_snippets
        and "No specific code snippets found" not in rag_code_snippets
    ):
        context_sections_for_llm.append(
            f"## Retrieved uiautomator2 Code Snippets (RAG Context):\n{rag_code_snippets}"
        )

    # 2. Add Other Tool Context (selected element, hierarchy, console, etc.)
    tool_context_specific_parts = []  # For items under "Current UI/System Context"
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

    if cd_py_out := context_data.get("pythonConsoleOutput"):
        tool_context_specific_parts.append(
            f"### Recent Python Console Output (last 1000 chars):\n```\n{cd_py_out[-1000:]}\n```"
        )

    if cd_py_code := context_data.get("pythonCode"):
        tool_context_specific_parts.append(
            f"### Current Python Code in Editor:\n```python\n{cd_py_code}\n```"
        )

    if cd_dev_info := context_data.get("deviceInfo"):
        tool_context_specific_parts.append(
            f"### Device Info:\n```json\n{json.dumps(cd_dev_info, indent=2)}\n```"
        )

    if tool_context_specific_parts:  # If there's any tool-specific context
        context_sections_for_llm.append(
            "## Current UI/System Context (from Tool):\n"
            + "\n\n".join(tool_context_specific_parts)
        )

    # Construct full_user_content
    full_user_content = ""
    if context_sections_for_llm:
        full_user_content += "\n\n".join(context_sections_for_llm) + "\n\n"

    full_user_content += f"## User Request:\n{user_prompt}"

    messages_for_api.append({"role": "user", "content": full_user_content})
    # logger.debug(f"LLM Service: Messages for LLM API: {json.dumps(messages_for_api, indent=2)}")
    return messages_for_api


# --- Main LLM Interaction Function (Modified) ---
async def generate_chat_completion_stream(
    request_data: LlmServiceChatRequest,
) -> AsyncGenerator[str, None]:
    if not DEEPSEEK_API_KEY:
        error_msg = "Error: DeepSeek API key is not configured on the server."
        yield f"event: error\ndata: {json.dumps({'error': error_msg})}\n\n"
        yield f"event: end-of-stream\ndata: {json.dumps({'message': 'Stream ended due to configuration error'})}\n\n"
        return

    # --- 1. Fetch RAG Code Snippets using the user's prompt ---
    logger.info(
        f"LLM Service: Fetching RAG snippets for prompt: {request_data.prompt[:70]}..."
    )
    rag_snippets_context = await _fetch_rag_code_snippets(request_data.prompt)
    # ----------------------------------------------------------

    # --- 2. Prepare context_data for _build_llm_payload_messages ---
    # Start with context from the original request (tool context)
    # and add/update the RAG context.
    current_context_data = dict(request_data.context) if request_data.context else {}
    current_context_data["rag_code_snippets"] = rag_snippets_context  # Add RAG context

    if (
        "Error:" in rag_snippets_context
        or "No specific code snippets found" in rag_snippets_context
    ):
        logger.info(f"LLM Service: RAG snippets status: {rag_snippets_context}")
    else:
        logger.info(
            f"LLM Service: Successfully fetched RAG snippets (length: {len(rag_snippets_context)})."
        )
        logger.debug(
            f"LLM Service: RAG snippets (first 200 chars): {rag_snippets_context[:200]}"
        )
    # ----------------------------------------------------------------

    # --- 3. Build messages for the LLM API call ---
    messages_for_api = _build_llm_payload_messages(
        user_prompt=request_data.prompt,  # The original user prompt
        context_data=current_context_data,  # Now includes RAG + tool context
        history=request_data.history,
    )
    # -------------------------------------------

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
            # For debugging the full prompt sent to LLM:
            # if messages_for_api and messages_for_api[-1]['role'] == 'user':
            #     logger.debug(f"LLM Service: Full user content being sent to LLM: \n{messages_for_api[-1]['content']}")

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
                            delta = choice.get("delta", {})
                            delta_content_text = delta.get("content")
                            if delta_content_text is not None:
                                yield f"data: {json.dumps(delta_content_text)}\n\n"

                            finish_reason = choice.get("finish_reason")
                            if finish_reason:
                                logger.info(
                                    f"LLM reported finish_reason: {finish_reason}"
                                )
                                full_message_on_finish = choice.get("message", {})
                                if finish_reason == "tool_calls":
                                    tool_calls_from_message = (
                                        full_message_on_finish.get("tool_calls")
                                    )
                                    if tool_calls_from_message:
                                        logger.info(
                                            f"Completed tool_calls received: {json.dumps(tool_calls_from_message)}"
                                        )
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
