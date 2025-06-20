import json
import os
from typing import Any, Dict, List, Optional

from uiautodev.model import ChatMessageContent


def load_system_prompt() -> str:
    """
    Load the system prompt from the local system_prompt.txt file.
    This is the instruction given to the model to define its behavior.
    """
    system_prompt_path = os.path.join(os.path.dirname(__file__), "system_prompt.txt")
    with open(system_prompt_path, "r", encoding="utf-8") as f:
        return f.read()


def build_llm_payload_messages(
    user_prompt: str,
    context_data: Dict[str, Any],
    history: List[ChatMessageContent],
    system_prompt_override: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Builds a list of chat messages for the OpenAI-compatible LLM API.
    It merges system prompt, history, RAG context, UI hierarchy info,
    traceback, selected elements, console output, and the final user request.
    """

    # Step 1: Load system prompt
    system_prompt_content = system_prompt_override or load_system_prompt()

    # Step 2: Start with the system prompt
    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": system_prompt_content}
    ]

    # Step 3: Append prior conversation history (if any)
    for msg in history:
        messages.append(msg.model_dump(exclude_none=True))

    # Step 4: Build a context block to send with the final user message
    context_sections: List[str] = []

    # Inject relevant code snippets from RAG (CocoIndex)
    rag_snippets = context_data.get("rag_code_snippets")
    if rag_snippets and "Error:" not in rag_snippets:
        context_sections.append(
            f"## 📚 Retrieved uiautomator2 Code Snippets:\n{rag_snippets}"
        )

    # Include traceback if Python error captured
    if trace := context_data.get("pythonLastErrorTraceback"):
        context_sections.append(
            f"## ❗ Last Python Error Traceback:\n```text\n{trace[:3000]}\n```"
        )

    # Include current code in editor
    if ui_code := context_data.get("pythonCode"):
        context_sections.append(
            f"## 💡 Current Python Editor Code:\n```python\n{ui_code}\n```"
        )

    # UI element selection (from screen)
    if sel_elements := context_data.get("selectedElements"):
        limited = json.dumps(sel_elements[:3], indent=2)
        context_sections.append(f"## 🎯 Selected UI Elements:\n```json\n{limited}\n```")

    # UI hierarchy snapshot (compact summary)
    if hier := context_data.get("uiHierarchy"):
        root = hier.get("name", "unknown")
        children = len(hier.get("children", []))
        context_sections.append(
            f"## 🧭 UI Hierarchy:\nRoot Node: `{root}`, Children: {children}"
        )

    # Last known console output
    if out := context_data.get("pythonConsoleOutput"):
        context_sections.append(f"## 🖥️ Python Console Output:\n```\n{out[-1000:]}\n```")

    # Device metadata (model, resolution, etc.)
    if devinfo := context_data.get("deviceInfo"):
        devjson = json.dumps(devinfo, indent=2)
        context_sections.append(f"## 📱 Device Info:\n```json\n{devjson}\n```")

    # Step 5: Merge all context sections into one block
    context_blob = "\n\n".join(context_sections).strip()

    # Step 6: Place user intent *first*, followed by supporting context
    final_prompt = (
        f"## 🧠 User Request:\n{user_prompt.strip()}\n\n{context_blob}"
        if context_blob
        else user_prompt.strip()
    )

    # Step 7: Append the final prompt to the message chain
    messages.append({"role": "user", "content": final_prompt})

    return messages
