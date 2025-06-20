# uiautodev/model.py
from __future__ import annotations

import typing  # Import the 'typing' module itself
from typing import Optional  # Specific types from 'typing'
from typing import Any, Dict, List, Tuple, Union

from pydantic import BaseModel, Field, field_validator


class DeviceInfo(BaseModel):
    serial: str
    model: str = ""
    name: str = ""
    status: str = ""
    enabled: bool = True


class ShellResponse(BaseModel):
    output: str
    error: Optional[str] = ""


class Rect(BaseModel):
    x: int
    y: int
    width: int
    height: int


class Node(BaseModel):
    key: str
    name: str  # can be seen as description
    bounds: Optional[Tuple[float, float, float, float]] = None
    rect: Optional[Rect] = None
    properties: Dict[str, Union[str, bool]] = {}
    children: List[Node] = []  # Forward reference to Node itself


class OCRNode(Node):  # Inherits from Node
    confidence: float


class WindowSize(typing.NamedTuple):  # Using typing.NamedTuple
    width: int
    height: int


class AppInfo(BaseModel):
    packageName: str


# --- Models previously in llm_service.py, now here ---
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
    context: Dict[str, Any] = Field(default_factory=dict)
    history: List[ChatMessageContent] = Field(default_factory=list)
    model: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    provider: Optional[str] = None

    @field_validator("history", mode="plain")
    @classmethod
    def coerce_history(cls, v):
        if isinstance(v, list):
            return [
                ChatMessageContent(**item) if isinstance(item, dict) else item
                for item in v
            ]
        raise ValueError("history must be a list")


# Rebuild models involved in LlmServiceChatRequest first, or those with forward refs.
Node.model_rebuild(force=True)  # Node has a forward reference to itself in children
OCRNode.model_rebuild(force=True)  # Inherits from Node

ToolCallFunction.model_rebuild(force=True)
ToolCall.model_rebuild(force=True)
ChatMessageDelta.model_rebuild(force=True)
ChatMessageContent.model_rebuild(force=True)
LlmServiceChatRequest.model_rebuild(force=True)  # This is the one causing the error

# Rebuild other models in the file for good measure
DeviceInfo.model_rebuild(force=True)
ShellResponse.model_rebuild(force=True)
Rect.model_rebuild(force=True)
AppInfo.model_rebuild(force=True)

# Note: typing.NamedTuple (WindowSize) does not have model_rebuild
