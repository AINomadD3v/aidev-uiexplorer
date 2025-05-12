# uiautodev/app.py

import json
import logging  # Standard library logging
import os
import platform
import signal
from pathlib import Path  # For robust path handling
from typing import Any, AsyncGenerator, Dict, List, Optional

import uvicorn
from dotenv import load_dotenv  # For loading .env files
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import (
    FileResponse,
    JSONResponse,
    RedirectResponse,
    StreamingResponse,
)
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# --- Early .env loading and diagnostics ---
# Calculate the project root directory (assuming .env is there)
# If app.py is in uiautodev/, then project_root is one level up.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DOTENV_PATH = PROJECT_ROOT / ".env"

print(f"INFO: app.py - Current Working Directory: {os.getcwd()}")
print(f"INFO: app.py - Script location (__file__): {Path(__file__).resolve()}")
print(f"INFO: app.py - Calculated Project Root: {PROJECT_ROOT}")
print(f"INFO: app.py - Expected .env path: {DOTENV_PATH}")

if DOTENV_PATH.exists():
    print(f"INFO: app.py - Found .env file at: {DOTENV_PATH}. Attempting to load.")
    # override=True ensures .env takes precedence. verbose=True gives loading feedback.
    load_dotenv(dotenv_path=DOTENV_PATH, override=True, verbose=True)
else:
    print(
        f"WARNING: app.py - .env file not found at {DOTENV_PATH}. "
        "Relying on system environment variables or defaults."
    )

# Diagnostic print for the specific key after attempting to load .env
# This helps confirm if load_dotenv had an effect from this file's perspective.
# Note: llm_service.py will do its own os.getenv() when it's imported.
DEEPSEEK_API_KEY_IN_APP_PY_SCOPE = os.getenv("DEEPSEEK_API_KEY")
print(
    f"INFO: app.py - DEEPSEEK_API_KEY after load_dotenv (in app.py scope): "
    f"'{'******' if DEEPSEEK_API_KEY_IN_APP_PY_SCOPE else 'Not set or empty'}'"
)
# End of early .env loading

# --- Now, import project modules that might depend on these env vars ---
from uiautodev import __version__
from uiautodev.common import convert_bytes_to_image, ocr_image
from uiautodev.model import Node
from uiautodev.provider import AndroidProvider
from uiautodev.router.device import make_router

# Import from the new LLM service
# This import happens AFTER load_dotenv() above, so llm_service.py
# should see the environment variables loaded from .env
from uiautodev.services.llm_service import ChatMessageContent as LlmServiceChatMessage
from uiautodev.services.llm_service import (
    LlmServiceChatRequest,
    generate_chat_completion_stream,
)

# Configure logging (basicConfig should ideally be called once, as early as possible)
# We will configure it more formally in the `if __name__ == "__main__":` block
# For now, get a logger instance. It will inherit root logger config initially.
logger = logging.getLogger(__name__)


# --- FastAPI App Initialization ---
app = FastAPI(
    title="uiautodev Local Server",
    description="Backend server for the local uiautodev inspection and automation tool.",
    version=__version__,
)

# --- Static Files Mounting ---
# current_file_dir should be the directory of app.py (e.g., uiautodev/)
current_file_dir = Path(__file__).parent
static_files_path = current_file_dir / "static"
if static_files_path.is_dir():
    app.mount("/static", StaticFiles(directory=static_files_path), name="static")
    # Use print here if logger might not be configured yet, or ensure logger is configured before this.
    # For consistency with early .env loading messages, using print for now.
    print(f"INFO: app.py - Serving static files from: {static_files_path} at /static")
else:
    # This is a more significant issue, so logger.error is appropriate if logger is configured.
    # If not, print with a clear warning.
    print(
        f"ERROR: app.py - Static files directory not found at: {static_files_path}. "
        "UI may not load correctly."
    )
    # logger.error(f"Static files directory not found at: {static_files_path}. UI may not load correctly.")


# --- Middleware ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production for security
    allow_credentials=True,
    allow_methods=["GET", "POST"],  # Specify methods explicitly
    allow_headers=["*"],  # Or be more specific with allowed headers
)

# --- Providers and Routers ---
android_provider = AndroidProvider()
android_router = make_router(android_provider)
# Using print for startup info consistency, or configure logger earlier.
print("INFO: app.py - Using real Android device provider.")
# logger.info("Using real Android device provider.")
app.include_router(android_router, prefix="/api/android", tags=["Android"])


# --- API Models ---
class InfoResponse(BaseModel):
    version: str
    description: str
    platform: str
    code_language: str
    cwd: str
    drivers: List[str]


class ApiChatMessage(BaseModel):
    """Model for chat messages as received from the client."""

    role: str
    content: str


class ApiLlmChatRequest(BaseModel):
    """Model for the overall chat request from the client."""

    prompt: str
    context: Dict[str, Any] = {}
    history: List[ApiChatMessage] = []
    model: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None


# --- LLM Chat API Endpoint ---
@app.post("/api/llm/chat")
async def handle_llm_chat_via_service(
    client_request_data: ApiLlmChatRequest, http_request: Request
):
    """
    Handles LLM chat requests by delegating to the LlmService.
    It converts API-facing models to service-layer models.
    """
    # Logger should be configured by now if running via `if __name__ == "__main__"`
    # or by Uvicorn's logging setup.
    client_host = http_request.client.host if http_request.client else "unknown"
    logger.info(
        f"LLM Chat Stream request from {client_host}. "
        f"Client Prompt (start): {client_request_data.prompt[:70]}..."
    )

    service_history = [
        LlmServiceChatMessage(role=msg.role, content=msg.content)
        for msg in client_request_data.history
    ]

    service_request_data = LlmServiceChatRequest(
        prompt=client_request_data.prompt,
        context=client_request_data.context,
        history=service_history,
        model=client_request_data.model,
        temperature=client_request_data.temperature,
        max_tokens=client_request_data.max_tokens,
    )

    return StreamingResponse(
        generate_chat_completion_stream(service_request_data),
        media_type="text/event-stream",
    )


# --- Core API Endpoints (Info, OCR) ---
@app.get("/api/info", response_model=InfoResponse)
def get_application_info() -> InfoResponse:
    return InfoResponse(
        version=__version__,
        description="Local uiautodev server for device inspection and automation.",
        platform=platform.system(),
        code_language="Python",
        cwd=os.getcwd(),
        drivers=["android"],
    )


@app.post("/api/ocr_image", response_model=List[Node])
async def perform_ocr_on_image(file: UploadFile = File(...)) -> List[Node]:
    try:
        image_data = await file.read()
        image = convert_bytes_to_image(image_data)
        ocr_results = ocr_image(image)
        return ocr_results
    except Exception as e:
        logger.exception("OCR image processing failed.")  # Good use of logger.exception
        return JSONResponse(
            status_code=500,
            content={"error": "OCR processing failed", "detail": str(e)},
        )
    finally:
        # Ensure file is closed if it's an UploadFile instance
        if hasattr(file, "close") and callable(file.close):  # Simplified check
            try:
                await file.close()
            except Exception as e_close:
                logger.warning(f"Error closing OCR image file: {e_close}")


# --- Server Control and Static Content ---
@app.get("/shutdown", summary="Shutdown Server")
def shutdown_server() -> JSONResponse:
    logger.info("Shutdown endpoint called. Sending SIGINT to process %d.", os.getpid())
    os.kill(os.getpid(), signal.SIGINT)  # For graceful shutdown with Uvicorn
    return JSONResponse(content={"message": "Server shutting down..."})


@app.get(
    "/demo", summary="Serve Local Inspector UI", include_in_schema=True
)  # Made include_in_schema True for visibility
async def serve_local_inspector_ui():
    ui_html_file = static_files_path / "demo.html"
    if not ui_html_file.is_file():
        logger.error(f"Local UI HTML file not found at {ui_html_file}")
        return JSONResponse(
            content={"error": "UI HTML file not found."}, status_code=404
        )
    logger.info(f"Serving local UI from: {ui_html_file}")
    return FileResponse(ui_html_file)


@app.get("/", summary="Redirect to Local Inspector UI", include_in_schema=False)
async def redirect_to_local_ui():
    # Use FastAPI's URL path generation for robustness
    try:
        local_ui_url = app.url_path_for("serve_local_inspector_ui")
    except Exception:  # Fallback if route name changes or not found
        local_ui_url = "/demo"
    logger.debug(f"Root path accessed, redirecting to {local_ui_url}")
    return RedirectResponse(url=local_ui_url)


# --- Main Entry Point for Uvicorn ---
if __name__ == "__main__":
    # Get Uvicorn server settings from environment variables with defaults
    server_port = int(
        os.getenv("UIAUTODEV_PORT", "20242")
    )  # Changed default to your log's port
    server_host = os.getenv("UIAUTODEV_HOST", "127.0.0.1")
    reload_enabled_str = os.getenv("UIAUTODEV_RELOAD", "True")
    reload_enabled = reload_enabled_str.lower() in ("true", "1", "yes")

    log_level_str = os.getenv("UIAUTODEV_LOG_LEVEL", "info").lower()
    # Ensure numeric_log_level is a valid level for logging.basicConfig
    numeric_log_level = getattr(logging, log_level_str.upper(), None)
    if not isinstance(numeric_log_level, int):
        print(
            f"WARNING: Invalid UIAUTODEV_LOG_LEVEL: {log_level_str}. Defaulting to INFO."
        )
        numeric_log_level = logging.INFO

    # Configure basic logging for the application
    # This will affect the logger instance obtained by `logging.getLogger(__name__)`
    logging.basicConfig(
        level=numeric_log_level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Now that logging is configured, messages from `logger.info` etc. will use this format.
    logger.info(  # This will now use the configured format.
        f"Starting uiautodev server v{__version__} on http://{server_host}:{server_port}"
    )
    if DOTENV_PATH.exists():
        logger.info(f"Successfully loaded environment variables from: {DOTENV_PATH}")
    else:
        logger.warning(
            f".env file was not found at {DOTENV_PATH}. API keys and other secrets might be missing."
        )

    uvicorn.run(
        "uiautodev.app:app",  # Path to the FastAPI app instance
        host=server_host,
        port=server_port,
        reload=reload_enabled,
        log_level=log_level_str,  # Uvicorn uses string for its own logger configuration
    )
