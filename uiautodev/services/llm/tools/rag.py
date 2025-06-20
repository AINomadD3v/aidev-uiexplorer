# uiautodev/services/llm/tools/rag.py

import json
import logging
import os
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

COCOINDEX_SEARCH_API_URL = os.getenv(
    "COCOINDEX_SEARCH_API_URL", "http://localhost:8000/search"
)

MAX_RAG_SNIPPET_LEN_FOR_LLM = 7000


async def fetch_rag_code_snippets(query: str, top_k: int = 5) -> str:
    """
    Queries the local RAG API (CocoIndex) for uiautomator2 code snippets based on the input query.
    Truncates results to a safe length and formats them for LLM context injection.
    """
    if not COCOINDEX_SEARCH_API_URL:
        logger.error("RAG: COCOINDEX_SEARCH_API_URL is not configured.")
        return "Error: RAG service URL not configured for snippet retrieval."

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            logger.info(
                f"RAG: Querying {COCOINDEX_SEARCH_API_URL} for: '{query[:80]}...'"
            )
            response = await client.get(
                COCOINDEX_SEARCH_API_URL, params={"query": query, "limit": top_k}
            )
            response.raise_for_status()

            results = response.json().get("results", [])
            if not results:
                return "No specific code snippets found in the uiautomator2 codebase relevant to this query."

            context_str = "Relevant uiautomator2 Code Snippets Found:\n\n"
            max_individual = MAX_RAG_SNIPPET_LEN_FOR_LLM // top_k

            for i, r in enumerate(results):
                filename = r.get("filename", "N/A")
                score = r.get("score", 0.0)
                text = r.get("text", "")

                if len(text) > max_individual:
                    text = text[: max_individual - 50] + "... (truncated)"

                context_str += f"Snippet {i+1} (from {filename}, score: {score:.2f}):\n"
                context_str += "```python\n"
                context_str += text.strip() + "\n```\n\n"

            if len(context_str) > MAX_RAG_SNIPPET_LEN_FOR_LLM:
                context_str = (
                    context_str[: MAX_RAG_SNIPPET_LEN_FOR_LLM - 100]
                    + "\n... (overall RAG context truncated)"
                )

            return context_str.strip()

    except Exception as e:
        logger.exception(f"RAG: Unexpected error fetching snippets: {e}")
        return f"Error: {str(e)}"
