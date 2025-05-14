# uiautodev/app.py

import json
import logging
import os
import platform
import signal
import sys
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional

import jedi  # Keep if used, otherwise can be removed if Python completions aren't a focus
import uvicorn
from dotenv import load_dotenv
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
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DOTENV_PATH = PROJECT_ROOT / ".env"

if DOTENV_PATH.exists():
    load_dotenv(dotenv_path=DOTENV_PATH, override=True, verbose=False)
# Ensure logging is configured before other modules that might log
logging.basicConfig(
    level=os.getenv("UIAUTODEV_LOG_LEVEL", "info").upper(),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)  # Define logger early

if not DOTENV_PATH.exists():
    logger.warning(
        f"app.py - .env file not found at {DOTENV_PATH}. "
        "Relying on system environment variables or defaults."
    )
# --- End of early .env loading ---

from uiautodev import __version__
from uiautodev.common import convert_bytes_to_image, ocr_image
from uiautodev.model import Node
from uiautodev.provider import AndroidProvider
from uiautodev.router.device import make_router

# Ensure correct import path if ChatMessageContent from llm_service is LlmServiceChatMessage
from uiautodev.services.llm_service import ChatMessageContent as LlmServiceChatMessage
from uiautodev.services.llm_service import (
    LlmServiceChatRequest,
    generate_chat_completion_stream,
)

# --- FastAPI App Initialization ---
app = FastAPI(
    title="uiautodev Local Server",
    description="Backend server for the local uiautodev inspection and automation tool.",
    version=__version__,
)

# --- Static Files Mounting ---
current_file_dir = Path(__file__).parent
static_files_path = current_file_dir / "static"
if static_files_path.is_dir():
    app.mount("/static", StaticFiles(directory=static_files_path), name="static")
else:
    logger.error(
        f"Static files directory not found at: {static_files_path}. UI may not load correctly."
    )

# --- Middleware ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# --- Providers and Routers ---
android_provider = AndroidProvider()
android_router = make_router(android_provider)
app.include_router(android_router, prefix="/api/android", tags=["Android"])


# --- API Models ---
class InfoResponse(BaseModel):
    version: str
    description: str
    platform: str
    code_language: str
    cwd: str
    drivers: List[str]


class ApiChatMessage(BaseModel):  # For frontend<->uiautodev API
    role: str
    content: str


class ApiLlmChatRequest(BaseModel):  # For frontend<->uiautodev API
    prompt: str
    context: Dict[str, Any] = {}
    history: List[ApiChatMessage] = []
    model: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None


class PythonCompletionRequest(BaseModel):
    code: str
    line: int
    column: int
    filename: Optional[str] = "inspector_code.py"


class PythonCompletionSuggestion(BaseModel):
    text: str
    displayText: str
    type: Optional[str] = None


# --- NEW: Model for Service Configurations ---
class ServiceConfigResponse(BaseModel):
    ragApiBaseUrl: Optional[str] = None


# ------------------------------------------

# --- Python Completion API Endpoint ---
try:
    jedi_project_path = str(PROJECT_ROOT)
    logger.info(
        f"Initializing Jedi Project with path: {jedi_project_path} and current sys.path."
    )
    jedi_project = jedi.Project(
        path=jedi_project_path, sys_path=sys.path, smart_sys_path=True
    )
    # logger.info(f"Jedi Project sys.path: {jedi_project.sys_path}") # Can be verbose
except Exception as e:
    logger.error(f"Failed to initialize Jedi Project: {e}", exc_info=True)
    jedi_project = None


@app.post("/api/python/completions", response_model=List[PythonCompletionSuggestion])
async def get_python_completions(request_data: PythonCompletionRequest):
    if not jedi_project:
        logger.error("Jedi project not initialized, cannot provide completions.")
        return []
    try:
        jedi_line = request_data.line + 1
        jedi_column = request_data.column
        script = jedi.Script(
            code=request_data.code, path=request_data.filename, project=jedi_project
        )
        completions = script.complete(line=jedi_line, column=jedi_column)
        suggestions = []
        if completions:
            for comp in completions:
                display_text_value = getattr(comp, "name_with_symbols", comp.name)
                text_to_insert = getattr(comp, "complete", comp.name)
                suggestions.append(
                    PythonCompletionSuggestion(
                        text=text_to_insert,
                        displayText=display_text_value,
                        type=comp.type,
                    )
                )
        return suggestions
    except Exception as e:
        logger.error(f"Error during Jedi completion processing: {e}", exc_info=True)
        return []


# --- LLM Chat API Endpoint ---
@app.post("/api/llm/chat")
async def handle_llm_chat_via_service(
    client_request_data: ApiLlmChatRequest, http_request: Request
):
    # Convert ApiChatMessage to LlmServiceChatMessage for the service layer
    service_history = [
        LlmServiceChatMessage(
            role=msg.role, content=msg.content
        )  # Make sure LlmServiceChatMessage takes these
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
    # ... (implementation unchanged) ...
    return InfoResponse(
        version=__version__,
        description="Local uiautodev server.",
        platform=platform.system(),
        code_language="Python",
        cwd=os.getcwd(),
        drivers=["android"],
    )


@app.post("/api/ocr_image", response_model=List[Node])
async def perform_ocr_on_image(file: UploadFile = File(...)) -> List[Node]:
    # ... (implementation unchanged) ...
    try:
        image_data = await file.read()
        image = convert_bytes_to_image(image_data)
        return ocr_image(image)
    except Exception as e:
        logger.exception("OCR image processing failed.")
        return JSONResponse(
            status_code=500, content={"error": "OCR failed", "detail": str(e)}
        )
    finally:
        if hasattr(file, "close") and callable(file.close):
            try:
                await file.close()
            except Exception as e_close:
                logger.warning(f"Error closing OCR file: {e_close}")


# --- NEW: Endpoint to provide service configurations to frontend ---
RAG_API_SEARCH_URL_FROM_ENV = os.getenv(
    "COCOINDEX_SEARCH_API_URL", "http://localhost:8000/search"
)
RAG_API_BASE_URL_FOR_FRONTEND = RAG_API_SEARCH_URL_FROM_ENV
if RAG_API_BASE_URL_FOR_FRONTEND.endswith("/search"):
    RAG_API_BASE_URL_FOR_FRONTEND = RAG_API_BASE_URL_FOR_FRONTEND[: -len("/search")]


@app.get("/api/config/services", response_model=ServiceConfigResponse)
async def get_service_configurations():
    logger.info(
        f"Providing RAG API base URL to frontend: {RAG_API_BASE_URL_FOR_FRONTEND}"
    )
    return ServiceConfigResponse(ragApiBaseUrl=RAG_API_BASE_URL_FOR_FRONTEND)


# --------------------------------------------------------------------


# --- Server Control and Static Content ---
@app.get("/shutdown", summary="Shutdown Server")
def shutdown_server() -> JSONResponse:
    # ... (implementation unchanged) ...
    logger.info("Shutdown endpoint called. Sending SIGINT to process %d.", os.getpid())
    os.kill(os.getpid(), signal.SIGINT)
    return JSONResponse(content={"message": "Server shutting down..."})


@app.get("/demo", summary="Serve Local Inspector UI", include_in_schema=True)
async def serve_local_inspector_ui():
    # ... (implementation unchanged) ...
    ui_html_file = static_files_path / "demo.html"
    if not ui_html_file.is_file():
        logger.error(f"UI HTML file not found: {ui_html_file}")
        return JSONResponse(content={"error": "UI HTML not found."}, status_code=404)
    return FileResponse(ui_html_file)


@app.get("/", summary="Redirect to Local Inspector UI", include_in_schema=False)
async def redirect_to_local_ui():
    # ... (implementation unchanged) ...
    try:
        local_ui_url = app.url_path_for("serve_local_inspector_ui")
    except Exception:
        local_ui_url = "/demo"
    return RedirectResponse(url=local_ui_url)


# --- Main Entry Point for Uvicorn ---
if __name__ == "__main__":
    # Logging is configured at the top of the file now
    server_port = int(os.getenv("UIAUTODEV_PORT", "20242"))
    server_host = os.getenv("UIAUTODEV_HOST", "127.0.0.1")
    reload_enabled = os.getenv("UIAUTODEV_RELOAD", "True").lower() in (
        "true",
        "1",
        "yes",
    )
    log_level_str = os.getenv(
        "UIAUTODEV_LOG_LEVEL", "info"
    ).lower()  # Uvicorn's log_level uses this string

    logger.info(
        f"Starting uiautodev server v{__version__} on http://{server_host}:{server_port}"
    )
    if DOTENV_PATH.exists():
        logger.info(f"Loaded .env from: {DOTENV_PATH}")
    else:
        logger.warning(f".env not found at {DOTENV_PATH}. Secrets might be missing.")
    if not jedi_project:
        logger.error(
            "Jedi project could not be initialized. Python completions might be degraded."
        )

    uvicorn.run(
        "uiautodev.app:app",
        host=server_host,
        port=server_port,
        reload=reload_enabled,
        log_level=log_level_str,  # Use the string for Uvicorn's log_level
    )
