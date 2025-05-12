# uiautodev/services/llm_service.py

import asyncio
import json
import logging
import os
from typing import Any, AsyncGenerator, Dict, List, Optional, Union  # Added Union

import httpx
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# --- LLM Configuration ---
DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions"
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
DEEPSEEK_DEFAULT_MODEL = os.getenv(
    "DEEPSEEK_MODEL", "deepseek-chat"
)  # e.g., deepseek-coder or deepseek-reasoner

if not DEEPSEEK_API_KEY:
    logger.warning(
        "DEEPSEEK_API_KEY not found in environment variables. "
        "LLM service will not function correctly."
    )

# --- Pydantic Models for LLM Interaction ---
# These models are internal to the llm_service or can be shared if appropriate.


class ToolCallFunction(BaseModel):
    name: Optional[str] = None
    arguments: Optional[str] = None


class ToolCall(BaseModel):
    id: Optional[str] = (
        None  # Optional: DeepSeek might not always provide it for delta, but will for full message
    )
    type: str = "function"
    function: ToolCallFunction


class ChatMessageDelta(BaseModel):  # For message deltas in stream
    role: Optional[str] = None
    content: Optional[str] = None
    tool_calls: Optional[List[ToolCall]] = None


class ChatMessageContent(
    BaseModel
):  # For full messages (history, initial prompt, tool results)
    role: str
    content: Union[
        str, List[Dict[str, Any]]
    ]  # Content can be string or list of parts for multimodal
    name: Optional[str] = None  # For tool calls or differentiating participants
    tool_call_id: Optional[str] = None  # For role 'tool'
    tool_calls: Optional[List[ToolCall]] = None  # For role 'assistant' if calling tools


class LlmServiceChatRequest(BaseModel):
    """Data model for requests to this LLM service."""

    prompt: str  # The primary user prompt for this turn
    context: Dict[str, Any] = {}
    history: List[ChatMessageContent] = []  # Conversation history
    model: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    # Future: Add fields for tools and tool_choice when ready for full agentic behavior
    # tools: Optional[List[Dict[str, Any]]] = None
    # tool_choice: Optional[Union[str, Dict[str, Any]]] = None


# --- Placeholder for Future Tool Definitions ---
# Example:
# AVAILABLE_TOOLS_DEFINITION = [
#     {
#         "type": "function",
#         "function": {
#             "name": "get_element_details_by_id",
#             "description": "Get detailed properties of a specific UI element using its resource-id.",
#             "parameters": { /* ... JSON schema ... */ },
#         },
#     }
# ]
#
# async def get_element_details_by_id_tool(element_id: str, # (other necessary context/dependencies)
#                                    ):
#     # ... implementation ...
#     pass
#
# TOOL_FUNCTION_MAP = {
#    "get_element_details_by_id": get_element_details_by_id_tool,
# }


def _build_llm_payload_messages(
    user_prompt: str,
    context_data: Dict[str, Any],
    history: List[ChatMessageContent],
    system_prompt_override: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Helper function to construct the 'messages' list for the LLM API payload.
    """
    system_prompt_content = system_prompt_override or (
        "You are an elite Python automation assistant embedded inside a UI inspection and scripting tool for Android. "
        "You specialize in UI automation using the uiautomator2 library, and interact with an Android device object named `d`. "
        "Your primary task is to output Python code that directly manipulates the UI, like:\n"
        "```python\n"
        "d(text='Next').click()\n"
        "```\n\n"
        "You always follow these rules:\n"
        "1. Wrap all code in triple backticks and specify `python`.\n"
        "2. Output only valid uiautomator2 syntax. If you're unsure, say so — don't guess.\n"
        "3. Provide a 1-2 sentence explanation **after** the code, only if needed.\n"
        "4. When debugging errors (e.g., stack traces, exceptions, or failed actions), analyze the problem and return corrected code + explanation.\n"
        "5. When asked for test coverage or edge cases, use the visible UI structure to propose realistic input scenarios.\n\n"
        "Context may include UI hierarchy, selected elements, recent console output, user messages, and active code snippets. "
        "Analyze all available data and adapt your response accordingly.\n\n"
        "Avoid assumptions. If something is unclear, ask the user or suggest a diagnostic command like `print(d.info)`.\n"
        "Be concise, reliable, and tactical. No fluff. No hallucinations. Just working Python code and smart automation help."
    )

    # Initialize messages with the system prompt
    messages_for_api = [{"role": "system", "content": system_prompt_content}]

    # Add past history
    for msg_content_model in history:
        # Convert Pydantic model to dict suitable for API, excluding None values
        messages_for_api.append(msg_content_model.model_dump(exclude_none=True))

    # Construct the current user message with context
    context_str_parts = []
    if context_data:
        context_str_parts.append("## Current UI/System Context:")
        if cd_se := context_data.get("selectedElement"):
            # Filter out potentially very large or complex fields from selected element for brevity
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
            context_str_parts.append(
                f"### Selected Element:\n```json\n{json.dumps(se_brief, indent=2)}\n```"
            )

        if cd_hier := context_data.get("uiHierarchy"):
            # Summarize hierarchy instead of sending the whole thing
            root_name = cd_hier.get("name", "N/A")
            num_children = len(cd_hier.get("children", []))
            context_str_parts.append(
                f"### UI Hierarchy Overview: Root element is '{root_name}' "
                f"with {num_children} direct children. Focus on relevant parts based on the query."
            )

        if cd_py_out := context_data.get("pythonConsoleOutput"):
            # Send only the last N characters/lines to manage token size
            context_str_parts.append(
                f"### Recent Python Console Output (last 1000 chars):\n```\n{cd_py_out[-1000:]}\n```"
            )

        if cd_py_code := context_data.get("pythonCode"):
            context_str_parts.append(
                f"### Current Python Code in Editor:\n```python\n{cd_py_code}\n```"
            )

        if cd_dev_info := context_data.get("deviceInfo"):
            context_str_parts.append(
                f"### Device Info:\n```json\n{json.dumps(cd_dev_info, indent=2)}\n```"
            )

        context_str_parts.append("--- End of Context ---")

    full_user_content = user_prompt
    if context_str_parts:  # If there's any context, prepend it to the user's prompt
        full_user_content = (
            "\n\n".join(context_str_parts) + f"\n\n## User Request:\n{user_prompt}"
        )

    messages_for_api.append({"role": "user", "content": full_user_content})

    # logger.debug(f"Messages for LLM API: {json.dumps(messages_for_api, indent=2)}")
    return messages_for_api


async def generate_chat_completion_stream(
    request_data: LlmServiceChatRequest,
) -> AsyncGenerator[str, None]:
    """
    Main function to interact with DeepSeek for streaming chat completions.
    This function handles a single pass to the LLM. For tool use, a higher-level
    agentic loop would call this, then process tool calls, then call this again with tool results.
    """
    if not DEEPSEEK_API_KEY:
        error_msg = "Error: DeepSeek API key is not configured on the server."
        yield f"event: error\ndata: {json.dumps({'error': error_msg})}\n\n"
        yield f"event: end-of-stream\ndata: {json.dumps({'message': 'Stream ended due to configuration error'})}\n\n"
        return

    messages_for_api = _build_llm_payload_messages(
        request_data.prompt, request_data.context, request_data.history
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
        # "stream_options": {"include_usage": True}, # Optional: if you want usage statistics
        # --- Tool related parameters (Uncomment and populate when ready for tool use) ---
        # "tools": AVAILABLE_TOOLS_DEFINITION if request_data.tools else None,
        # "tool_choice": request_data.tool_choice or "auto" if request_data.tools else None,
    }
    # Remove None values from payload to use API defaults, especially for tools/tool_choice
    payload = {k: v for k, v in payload.items() if v is not None}

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
    }

    # This is a single pass. An agentic loop would manage multiple calls for tool execution.
    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            logger.info(
                f"Streaming request to DeepSeek API. Model: {payload.get('model')}. "
                f"User prompt (start): {request_data.prompt[:70]}..."
            )
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
                    try:  # Try to parse JSON error from DeepSeek if any
                        err_json = json.loads(error_content_str)
                        api_error_detail = err_json.get("error", {}).get(
                            "message", api_error_detail
                        )
                    except json.JSONDecodeError:
                        pass
                    yield f"event: error\ndata: {json.dumps({'error': api_error_detail})}\n\n"
                    yield f"event: end-of-stream\ndata: {json.dumps({'message': 'Stream ended due to API error'})}\n\n"
                    return

                # Variables to accumulate parts of the response if needed (e.g., for tool calls)
                # current_assistant_message_content = ""
                # current_tool_calls: List[ToolCall] = []

                async for line in response.aiter_lines():
                    if not line.strip():  # Skip empty lines, common in SSE
                        continue

                    if line == "data: [DONE]":
                        logger.info("DeepSeek stream finished with [DONE].")
                        yield f"event: end-of-stream\ndata: {json.dumps({'message': 'Stream completed by [DONE]'})}\n\n"
                        return  # Explicitly stop generation here

                    if line.startswith("data: "):
                        json_data_str = line[len("data: ") :]
                        try:
                            chunk_data = json.loads(json_data_str)
                            # logger.debug(f"Raw LLM chunk: {chunk_data}") # Very verbose

                            choice = chunk_data.get("choices", [{}])[0]
                            delta = choice.get(
                                "delta", {}
                            )  # Delta contains the streamed update

                            # 1. Handle content delta
                            delta_content_text = delta.get("content")
                            if delta_content_text is not None:  # Can be an empty string
                                # current_assistant_message_content += delta_content_text
                                yield f"data: {json.dumps(delta_content_text)}\n\n"  # Send text chunk

                            # 2. Handle tool_calls delta (more complex for streaming)
                            # DeepSeek might stream tool_calls. Each part could be an item in delta.tool_calls
                            # Example delta: {"role":"assistant","tool_calls":[{"index":0,"id":"call_xxx","function":{"name":"get_weather","arguments":""}}]}
                            # And then: {"tool_calls":[{"index":0,"function":{"arguments":"{\n"}}]}
                            # And then: {"tool_calls":[{"index":0,"function":{"arguments":" \"city"}}]} etc.
                            # This requires careful accumulation.
                            # For a first pass, we mostly care about the 'finish_reason' being 'tool_calls'
                            # and then the *complete* tool_calls block which might be in the 'message' part
                            # of a chunk when finish_reason is present, or needs to be assembled.

                            # 3. Check for finish_reason
                            finish_reason = choice.get("finish_reason")
                            if finish_reason:
                                logger.info(
                                    f"LLM reported finish_reason: {finish_reason}"
                                )
                                # The 'message' field in the choice (not delta) might contain the full tool_calls
                                # if the stream ends because of it.
                                full_message_on_finish = choice.get("message", {})

                                if finish_reason == "tool_calls":
                                    tool_calls_from_message = (
                                        full_message_on_finish.get("tool_calls")
                                    )
                                    if tool_calls_from_message:
                                        logger.info(
                                            f"Completed tool_calls received: {json.dumps(tool_calls_from_message)}"
                                        )
                                        # TODO: Signal to agent/caller that tools need to be executed.
                                        # This service's responsibility for *this* call ends here or after sending the tool_calls info.
                                        # The agent would then call the tools and re-invoke this service with tool results.
                                        # For now, we can send a special event.
                                        yield f"event: tool_request_details\ndata: {json.dumps(tool_calls_from_message)}\n\n"
                                    else:
                                        logger.warning(
                                            "finish_reason was 'tool_calls' but no tool_calls found in the message part."
                                        )

                                # If finish_reason is 'stop', 'length', etc., the stream will typically be followed by [DONE].
                                # No special SSE event needed here beyond what [DONE] handles.

                            # Handle stream_options: include_usage if enabled and present in chunk_data
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
                            # Optionally send a special error event for this chunk parse error, or just log
                            # yield f"event: error\ndata: {json.dumps({'error': 'Error parsing LLM stream chunk.'})}\n\n"

                # This part should ideally not be reached if "[DONE]" is always sent.
                logger.warning(
                    "DeepSeek stream loop finished without explicit [DONE] message. Signaling end-of-stream."
                )
                yield f"event: end-of-stream\ndata: {json.dumps({'message': 'Stream ended (no explicit [DONE] received).'})}\n\n"

        except (
            httpx.RequestError
        ) as e:  # Handles network errors, timeouts before response started
            error_message = f"Network issue contacting LLM provider: {str(e)}"
            logger.error(error_message, exc_info=True)
            yield f"event: error\ndata: {json.dumps({'error': error_message})}\n\n"
            yield f"event: end-of-stream\ndata: {json.dumps({'message': 'Stream ended due to network error.'})}\n\n"
        except Exception as e:  # Catch-all for other unexpected errors in this service
            error_message = (
                f"An unexpected error occurred within the LLM service: {str(e)}"
            )
            logger.error(error_message, exc_info=True)
            yield f"event: error\ndata: {json.dumps({'error': error_message})}\n\n"
            yield f"event: end-of-stream\ndata: {json.dumps({'message': 'Stream ended due to unexpected server error.'})}\n\n"
