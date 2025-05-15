from __future__ import annotations

import typing
from typing import Dict, List, Optional, Tuple, Union

from pydantic import BaseModel


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
    children: List[Node] = []


class OCRNode(Node):
    confidence: float


class WindowSize(typing.NamedTuple):
    width: int
    height: int


class AppInfo(BaseModel):
    packageName: str


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
