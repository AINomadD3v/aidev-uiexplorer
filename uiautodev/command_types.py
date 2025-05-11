import enum
from typing import List, Optional, Union

from pydantic import BaseModel

from uiautodev.model import Node


# POST /api/v1/device/{serial}/command/{command}
class Command(str, enum.Enum):
    TAP = "tap"
    TAP_ELEMENT = "tapElement"  # Not seen in router/device.py, but keeping for completeness if used elsewhere
    APP_INSTALL = "installApp"
    APP_CURRENT = "currentApp"
    APP_LAUNCH = "appLaunch"
    APP_TERMINATE = "appTerminate"
    APP_LIST = "appList"

    GET_WINDOW_SIZE = "getWindowSize"
    HOME = "home"
    DUMP = "dump"  # Seems like /hierarchy endpoint covers this, but keeping if used by command_proxy
    WAKE_UP = "wakeUp"
    FIND_ELEMENTS = "findElements"
    CLICK_ELEMENT = "clickElement"  # Not seen in router/device.py, but keeping

    LIST = "list"  # For listing devices, handled differently in router but good to have if generic

    # 0.4.0
    BACK = "back"
    APP_SWITCH = "appSwitch"
    VOLUME_UP = "volumeUp"
    VOLUME_DOWN = "volumeDown"
    VOLUME_MUTE = "volumeMute"


class TapRequest(BaseModel):
    x: Union[int, float]
    y: Union[int, float]
    isPercent: bool = False


class InstallAppRequest(BaseModel):
    url: str  # Note: driver/android.py app_install takes app_path (local path). If URL, conversion/download needed.


class InstallAppResponse(BaseModel):
    success: (
        bool  # This might need to be derived from whether an exception occurs or not
    )
    id: Optional[str] = None  # Corresponds to what? package name?


class CurrentAppResponse(BaseModel):
    package: str
    activity: Optional[str] = None
    pid: Optional[int] = None


class AppLaunchRequest(BaseModel):
    package: str
    stop: bool = (
        False  # Note: driver/android.py app_launch doesn't use a 'stop' param directly
    )


class AppTerminateRequest(BaseModel):
    package: str


class WindowSizeResponse(BaseModel):
    width: int
    height: int


class DumpResponse(
    BaseModel
):  # Likely for XML string if /hierarchy endpoint is not used for raw dump
    value: str


class By(str, enum.Enum):
    ID = "id"
    TEXT = "text"
    XPATH = "xpath"
    CLASS_NAME = "className"


class FindElementRequest(BaseModel):
    by: str  # Should ideally be By enum, but str is fine for FastAPI conversion
    value: str
    timeout: float = 10.0


class FindElementResponse(BaseModel):
    count: int
    value: List[Node]


class InteractiveCodePayload(BaseModel):
    """
    Payload for sending Python code to be executed interactively.
    """

    code: str
    enable_tracing: bool = (
        True  # Optional: allows the client to control if LNO/DBG lines are generated
    )
