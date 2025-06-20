from typing import AsyncGenerator

from uiautodev.model import LlmServiceChatRequest

from . import deepseek, openai  # 👈 relative import


async def dispatch_chat_completion_stream(
    request_data: LlmServiceChatRequest,
) -> AsyncGenerator[str, None]:
    """
    Routes the request to the appropriate LLM backend based on the selected provider.
    """
    provider = request_data.provider or "deepseek"

    if provider == "openai":
        async for chunk in openai.generate_chat_completion_stream(request_data):
            yield chunk
    elif provider == "deepseek":
        async for chunk in deepseek.generate_chat_completion_stream(request_data):
            yield chunk
    else:
        raise ValueError(f"Unsupported provider: {provider}")
