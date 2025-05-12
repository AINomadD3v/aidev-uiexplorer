# uiautodev/app.py

import json
import logging
import os
import platform
import signal
import sys  # Import sys to access sys.path
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional

import jedi
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
else:
    print(
        f"WARNING: app.py - .env file not found at {DOTENV_PATH}. "
        "Relying on system environment variables or defaults."
    )
# --- End of early .env loading ---

from uiautodev import __version__
from uiautodev.common import convert_bytes_to_image, ocr_image
from uiautodev.model import Node
from uiautodev.provider import AndroidProvider
from uiautodev.router.device import make_router
from uiautodev.services.llm_service import ChatMessageContent as LlmServiceChatMessage
from uiautodev.services.llm_service import (
    LlmServiceChatRequest,
    generate_chat_completion_stream,
)

logger = logging.getLogger(__name__)

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
    print(
        f"ERROR: app.py - Static files directory not found at: {static_files_path}. UI may not load correctly."
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


class ApiChatMessage(BaseModel):
    role: str
    content: str


class ApiLlmChatRequest(BaseModel):
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
    filename: Optional[str] = (
        "inspector_code.py"  # Provide a consistent, albeit virtual, filename
    )


class PythonCompletionSuggestion(BaseModel):
    text: str
    displayText: str
    type: Optional[str] = None


# --- Python Completion API Endpoint ---
# Initialize a Jedi project. This can be done once if the project path and sys.path don't change.
# For an interactive console that doesn't have a fixed "project root" for user code,
# using the CWD of the server and the server's sys.path is a reasonable default.
try:
    # Using the parent of the 'uiautodev' directory as the project root for Jedi.
    # This might help Jedi resolve things if your 'uiautodev' package is part of a larger structure
    # or if you have other local modules you might want to complete.
    # If your console code is mostly self-contained or uses stdlib/installed packages,
    # os.getcwd() might also work fine as a project_path.
    jedi_project_path = str(PROJECT_ROOT)
    logger.info(
        f"Initializing Jedi Project with path: {jedi_project_path} and current sys.path."
    )
    # smart_sys_path=True allows Jedi to try and find virtualenvs or other relevant paths.
    jedi_project = jedi.Project(
        path=jedi_project_path, sys_path=sys.path, smart_sys_path=True
    )
    logger.info(f"Jedi Project sys.path: {jedi_project.sys_path}")
except Exception as e:
    logger.error(f"Failed to initialize Jedi Project: {e}", exc_info=True)
    jedi_project = None  # Fallback if project initialization fails


@app.post("/api/python/completions", response_model=List[PythonCompletionSuggestion])
async def get_python_completions(request_data: PythonCompletionRequest):
    # logger.info(f"Completion req: line={request_data.line}, col={request_data.column}, file='{request_data.filename}'")
    # logger.debug(f"Code for completion (first 100): {request_data.code[:100]}")

    if not jedi_project:
        logger.error("Jedi project not initialized, cannot provide completions.")
        return []

    try:
        jedi_line = request_data.line + 1  # Jedi is 1-based for lines
        jedi_column = request_data.column  # Jedi is 0-based for columns

        # Create a script object within the context of our pre-initialized project
        script = jedi.Script(
            code=request_data.code, path=request_data.filename, project=jedi_project
        )
        completions = script.complete(line=jedi_line, column=jedi_column)

        # logger.info(f"Jedi returned {len(completions)} raw completions.")

        suggestions = []
        if completions:
            for comp_index, comp in enumerate(completions):
                # logger.debug(f"  Raw Jedi comp #{comp_index}: name='{comp.name}', type='{comp.type}', complete='{getattr(comp, 'complete', '')}'")

                display_text_value = getattr(
                    comp, "name_with_symbols", None
                )  # Access as property
                display_text = display_text_value if display_text_value else comp.name
                text_to_insert = getattr(
                    comp, "complete", comp.name
                )  # .complete is a property giving the text to insert

                suggestion = PythonCompletionSuggestion(
                    text=text_to_insert, displayText=display_text, type=comp.type
                )
                suggestions.append(suggestion)

        # if not suggestions: logger.info("No suggestions formatted for client.")
        # else: logger.info(f"Formatted {len(suggestions)} suggestions.")
        return suggestions
    except Exception as e:
        logger.error(f"Error during Jedi completion processing: {e}", exc_info=True)
        return []


# --- LLM Chat API Endpoint ---
@app.post("/api/llm/chat")
# ... (LLM chat endpoint code remains unchanged) ...
async def handle_llm_chat_via_service(
    client_request_data: ApiLlmChatRequest, http_request: Request
):
    client_host = http_request.client.host if http_request.client else "unknown"
    # logger.info(f"LLM Chat: {client_request_data.prompt[:70]}... from {client_host}")
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
# ... (get_application_info code remains unchanged) ...
def get_application_info() -> InfoResponse:
    return InfoResponse(
        version=__version__,
        description="Local uiautodev server.",
        platform=platform.system(),
        code_language="Python",
        cwd=os.getcwd(),
        drivers=["android"],
    )


@app.post("/api/ocr_image", response_model=List[Node])
# ... (perform_ocr_on_image code remains unchanged) ...
async def perform_ocr_on_image(file: UploadFile = File(...)) -> List[Node]:
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


# --- Server Control and Static Content ---
@app.get("/shutdown", summary="Shutdown Server")
# ... (shutdown_server code remains unchanged) ...
def shutdown_server() -> JSONResponse:
    logger.info("Shutdown endpoint called. Sending SIGINT to process %d.", os.getpid())
    os.kill(os.getpid(), signal.SIGINT)
    return JSONResponse(content={"message": "Server shutting down..."})


@app.get("/demo", summary="Serve Local Inspector UI", include_in_schema=True)
# ... (serve_local_inspector_ui code remains unchanged) ...
async def serve_local_inspector_ui():
    ui_html_file = static_files_path / "demo.html"
    if not ui_html_file.is_file():
        logger.error(f"UI HTML file not found: {ui_html_file}")
        return JSONResponse(content={"error": "UI HTML not found."}, status_code=404)
    return FileResponse(ui_html_file)


@app.get("/", summary="Redirect to Local Inspector UI", include_in_schema=False)
# ... (redirect_to_local_ui code remains unchanged) ...
async def redirect_to_local_ui():
    try:
        local_ui_url = app.url_path_for("serve_local_inspector_ui")
    except Exception:
        local_ui_url = "/demo"
    return RedirectResponse(url=local_ui_url)


# --- Main Entry Point for Uvicorn ---
if __name__ == "__main__":
    # ... (Uvicorn setup code remains largely unchanged, ensure logging is configured before Jedi Project init if Jedi is moved here) ...
    server_port = int(os.getenv("UIAUTODEV_PORT", "20242"))
    server_host = os.getenv("UIAUTODEV_HOST", "127.0.0.1")
    reload_enabled = os.getenv("UIAUTODEV_RELOAD", "True").lower() in (
        "true",
        "1",
        "yes",
    )
    log_level_str = os.getenv("UIAUTODEV_LOG_LEVEL", "info").lower()

    numeric_log_level = getattr(logging, log_level_str.upper(), logging.INFO)
    if not isinstance(numeric_log_level, int):
        print(
            f"WARNING: Invalid UIAUTODEV_LOG_LEVEL: {log_level_str}. Defaulting to INFO."
        )
        numeric_log_level = logging.INFO

    logging.basicConfig(
        level=numeric_log_level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    # It's important that Jedi Project initialization log appears after basicConfig is set,
    # so moving the jedi_project initialization from module level to here might be an idea
    # if there are issues with its own logging. For now, keeping it at module level for simplicity.
    # If jedi_project failed, logger.error would have been called.

    logger.info(
        f"Starting uiautodev server v{__version__} on http://{server_host}:{server_port}"
    )
    if DOTENV_PATH.exists():
        logger.info(f"Loaded .env from: {DOTENV_PATH}")
    else:
        logger.warning(f".env not found at {DOTENV_PATH}. Secrets might be missing.")
    if not jedi_project:  # Log if Jedi project failed to init earlier
        logger.error(
            "Jedi project could not be initialized. Python completions might be degraded or unavailable."
        )

    uvicorn.run(
        "uiautodev.app:app",
        host=server_host,
        port=server_port,
        reload=reload_enabled,
        log_level=log_level_str,
    )
