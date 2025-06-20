import logging
from typing import AsyncGenerator

from model import LlmServiceChatRequest
from services.llm.backends import router
from services.llm.tools.rag import fetch_rag_code_snippets  # ✅ Add this

logger = logging.getLogger(__name__)


async def generate_chat_completion_stream(
    request_data: LlmServiceChatRequest,
) -> AsyncGenerator[str, None]:
    """
    Main entry point for the LLM service. Uses the selected provider (openai/deepseek)
    and dispatches to the appropriate backend via router.
    """
    # ✅ Inject RAG context before sending downstream
    if "rag_code_snippets" not in request_data.context:
        try:
            rag_snippets = await fetch_rag_code_snippets(request_data.prompt)
            request_data.context["rag_code_snippets"] = rag_snippets
            logger.info("[LLM SERVICE] Injected RAG context into request_data.context")
        except Exception as e:
            logger.warning(f"[LLM SERVICE] Failed to inject RAG: {e}")

    async for chunk in router.dispatch_chat_completion_stream(request_data):
        yield chunk
