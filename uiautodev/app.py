import logging
import os
import platform
import signal
from pathlib import Path
from typing import List

import uvicorn
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from uiautodev import __version__
from uiautodev.common import convert_bytes_to_image, ocr_image
from uiautodev.model import Node
from uiautodev.provider import AndroidProvider  # Removed MockProvider
from uiautodev.router.device import make_router

# Removed: from uiautodev.utils.envutils import Environment

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
    logger.info(f"Serving static files from: {static_files_path} at /static")
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
# Setup for AndroidProvider (real devices) only
android_provider = AndroidProvider()
android_router = make_router(android_provider)

logger.info("Using real Android device provider.")
app.include_router(android_router, prefix="/api/android", tags=["Android"])

# Removed all MockProvider instantiation, mock_router, and the conditional block
# Removed: mock_provider = MockProvider()
# Removed: mock_router = make_router(mock_provider)
# Removed: app.include_router(mock_router, prefix="/api/mock", tags=["Mock"])
# Removed: if Environment.UIAUTODEV_MOCK: ... else: ... block


# --- API Models ---
class InfoResponse(BaseModel):
    version: str
    description: str
    platform: str
    code_language: str
    cwd: str
    drivers: List[str]


# --- Core API Endpoints ---
@app.get("/api/info", response_model=InfoResponse)
def get_application_info() -> InfoResponse:
    """
    Provides general information about the uiautodev server and environment.
    """
    return InfoResponse(
        version=__version__,
        description="Local uiautodev server for device inspection and automation.",
        platform=platform.system(),
        code_language="Python",
        cwd=os.getcwd(),
        drivers=["android"],  # Updated to reflect only Android
    )


@app.post("/api/ocr_image", response_model=List[Node])
async def perform_ocr_on_image(file: UploadFile = File(...)) -> List[Node]:
    """
    Accepts an image file and performs OCR, returning identified UI nodes.
    """
    try:
        image_data = await file.read()
        image = convert_bytes_to_image(image_data)
        ocr_results = ocr_image(image)
        return ocr_results
    except Exception as e:
        logger.exception("OCR image processing failed.")
        raise
    finally:
        if file and not file.file.closed:  # Ensure file is not already closed
            await file.close()


# --- Server Control and Static Content ---
@app.get("/shutdown", summary="Shutdown Server")
def shutdown_server() -> JSONResponse:
    """
    Triggers a graceful shutdown of the uvicorn server.
    """
    logger.info("Shutdown endpoint called. Sending SIGINT to process %d.", os.getpid())
    os.kill(os.getpid(), signal.SIGINT)
    return JSONResponse(content={"message": "Server shutting down..."})


@app.get("/demo", summary="Serve Local Inspector UI")
def serve_local_inspector_ui():
    """
    Serves the main HTML page for the local UI inspector.
    """
    ui_html_file = static_files_path / "demo.html"

    if not ui_html_file.is_file():
        logger.error(f"Local UI HTML file not found at {ui_html_file}")
        return JSONResponse(
            content={"error": "UI HTML file not found."}, status_code=404
        )

    logger.info(f"Serving local UI from: {ui_html_file}")
    return FileResponse(ui_html_file)


@app.get("/", summary="Redirect to Local Inspector UI", include_in_schema=False)
def redirect_to_local_ui():
    """
    Redirects the root path ("/") to the local inspector UI ("/demo").
    """
    local_ui_path = "/demo"
    logger.debug(f"Root path accessed, redirecting to {local_ui_path}")
    return RedirectResponse(url=local_ui_path)


# --- Main Entry Point for Uvicorn ---
if __name__ == "__main__":
    server_port = int(os.getenv("UIAUTODEV_PORT", 4000))
    server_host = os.getenv("UIAUTODEV_HOST", "127.0.0.1")
    reload_enabled = os.getenv("UIAUTODEV_RELOAD", "True").lower() == "true"

    logger.info(
        f"Starting uiautodev server v{__version__} on http://{server_host}:{server_port}"
    )
    uvicorn.run(
        "uiautodev.app:app",
        host=server_host,
        port=server_port,
        reload=reload_enabled,
        use_colors=True,
        log_level="info",
    )
