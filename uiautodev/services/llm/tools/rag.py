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
    Queries the RAG API for uiautomator2 snippets and formats them for LLM context.
    This function is designed to be resilient to failures in the RAG service.
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
            response.raise_for_status()  # This will raise an exception for 4xx or 5xx statuses

            results = response.json().get("results", [])
            if not results:
                return "No specific code snippets found in the uiautomator2 codebase relevant to this query."

            # --- Format successful results for the LLM ---
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

    # --- Resilient Error Handling ---
    except httpx.HTTPStatusError as e:
        # Catches 4xx and 5xx errors from the RAG service.
        logger.error(f"RAG: HTTP Status Error contacting RAG service: {e}")
        return "Note: The code snippet retrieval service (RAG) failed with a server error. Proceeding with general knowledge."

    except httpx.RequestError as e:
        # Catches network-level errors, like connection refused, timeout, etc.
        logger.error(f"RAG: Network error contacting RAG service: {e}")
        return "Note: The code snippet retrieval service (RAG) is currently unreachable. Proceeding with general knowledge."

    except Exception as e:
        # A general catch-all for any other unexpected errors.
        logger.exception(
            f"RAG: An unexpected error occurred while fetching snippets: {e}"
        )
        return f"Error: An unexpected issue occurred with the RAG service: {str(e)}"
