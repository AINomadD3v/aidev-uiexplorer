import json
import logging
from typing import AsyncGenerator

from model import LlmServiceChatRequest
from services.llm.backends import router
from services.llm.tools.rag import fetch_rag_code_snippets

logger = logging.getLogger(__name__)


async def generate_chat_completion_stream(
    request_data: LlmServiceChatRequest,
) -> AsyncGenerator[str, None]:
    """
    Main entry point for the LLM service. This function now buffers the
    complete response from the LLM to detect if it's a structured JSON tool
    call or a standard text/markdown message.
    """
    # Inject RAG context before sending the request to the LLM backend.
    if "rag_code_snippets" not in request_data.context:
        try:
            rag_snippets = await fetch_rag_code_snippets(request_data.prompt)
            request_data.context["rag_code_snippets"] = rag_snippets
            logger.info("[LLM SERVICE] Injected RAG context into request.")
        except Exception as e:
            logger.warning(f"[LLM SERVICE] Failed to inject RAG context: {e}")

    # --- Buffering Logic ---
    # Instead of streaming directly, we accumulate the full response first.
    full_response_parts = []
    async for chunk in router.dispatch_chat_completion_stream(request_data):
        full_response_parts.append(chunk)

    full_response = "".join(full_response_parts)

    if not full_response:
        logger.warning("[LLM SERVICE] Received an empty response from the backend.")
        yield ""
        return

    # --- Tool Call Detection Logic ---
    # Check if the complete response is our structured JSON tool call.
    stripped_response = full_response.strip()
    if stripped_response.startswith("{") and stripped_response.endswith("}"):
        try:
            parsed_json = json.loads(stripped_response)
            # Verify it's the tool we expect.
            if parsed_json.get("tool_name") == "propose_edit":
                logger.info(
                    "[LLM SERVICE] Detected 'propose_edit' tool call. Forwarding JSON."
                )
                yield stripped_response
                return  # End execution after forwarding the tool call.
        except json.JSONDecodeError:
            # It looked like JSON, but wasn't valid. Fall through to treat as text.
            logger.warning(
                "[LLM SERVICE] Failed to parse potential JSON, treating as plain text."
            )

    # --- Fallback for Standard Messages ---
    # If it's not a valid tool call, treat it as a standard text message.
    logger.info("[LLM SERVICE] Forwarding standard text response.")
    yield full_response
