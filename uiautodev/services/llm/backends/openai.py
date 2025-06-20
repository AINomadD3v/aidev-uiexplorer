# uiautodev/services/llm/backends/openai.py

import asyncio
import json
import logging
import os
from typing import Any, AsyncGenerator

import httpx
from model import ChatMessageContent, LlmServiceChatRequest

from ..prompt.messages import build_llm_payload_messages
from ..tools.rag import fetch_rag_code_snippets

logger = logging.getLogger(__name__)

OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_DEFAULT_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")


async def generate_chat_completion_stream(
    request_data: LlmServiceChatRequest,
) -> AsyncGenerator[str, None]:
    """
    Stream chat completions from OpenAI using the user prompt and context.
    Injects relevant RAG documentation into the context before generation.
    """

    if not OPENAI_API_KEY:
        yield f"event: error\ndata: {json.dumps({'error': 'OpenAI API key is not configured'})}\n\n"
        yield f"event: end-of-stream\ndata: {json.dumps({'message': 'Stream terminated'})}\n\n"
        return

    # -------------------------
    # 🔍 Inject RAG into Context
    # -------------------------
    context = dict(request_data.context or {})
    if "rag_code_snippets" not in context:
        try:
            rag_snippets = await fetch_rag_code_snippets(request_data.prompt)
            context["rag_code_snippets"] = rag_snippets
            logger.info("✅ Injected RAG snippets into context")
        except Exception as e:
            logger.warning(f"⚠️ Failed to fetch RAG snippets: {e}")

    # -------------------------------
    # 🧠 Build OpenAI chat messages
    # -------------------------------
    messages = build_llm_payload_messages(
        user_prompt=request_data.prompt,
        context_data=context,
        history=request_data.history,
    )

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OPENAI_API_KEY}",
    }

    payload = {
        "model": request_data.model or OPENAI_DEFAULT_MODEL,
        "messages": messages,
        "stream": True,
        "temperature": request_data.temperature or 0.7,
        "max_tokens": request_data.max_tokens or 2048,
    }

    # ------------------------------
    # 🚀 Start OpenAI streaming request
    # ------------------------------
    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            async with client.stream(
                "POST", OPENAI_API_URL, json=payload, headers=headers
            ) as response:
                if response.status_code != 200:
                    err = await response.aread()
                    logger.error(f"❌ OpenAI returned non-200: {response.status_code}")
                    yield f"event: error\ndata: {json.dumps({'error': err.decode(errors='replace')})}\n\n"
                    yield f"event: end-of-stream\ndata: {json.dumps({'message': 'Stream failed'})}\n\n"
                    return

                async for line in response.aiter_lines():
                    if line == "data: [DONE]":
                        yield f"event: end-of-stream\ndata: {json.dumps({'message': 'Complete'})}\n\n"
                        return

                    if not line.startswith("data: "):
                        continue

                    try:
                        data = json.loads(line[6:])
                        choice = data.get("choices", [{}])[0]
                        delta = choice.get("delta", {})

                        if delta.get("content"):
                            yield f"data: {json.dumps(delta['content'])}\n\n"

                    except Exception as e:
                        logger.warning(f"⚠️ OpenAI stream parse error: {e}")

        except Exception as e:
            logger.exception("🔥 Exception during OpenAI stream")
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"
            yield f"event: end-of-stream\ndata: {json.dumps({'message': 'Stream exception'})}\n\n"
            return
