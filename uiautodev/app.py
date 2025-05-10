#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Created on Sun Feb 18 2024 13:48:55 by codeskyblue"""

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
from fastapi.staticfiles import StaticFiles  # <<< ADDED: For serving static files
from pydantic import BaseModel

from uiautodev import __version__
from uiautodev.common import convert_bytes_to_image, ocr_image
from uiautodev.model import Node
from uiautodev.provider import (
    AndroidProvider,
    HarmonyProvider,
    IOSProvider,
    MockProvider,
)
from uiautodev.router.device import make_router
from uiautodev.router.xml import router as xml_router
from uiautodev.utils.envutils import Environment

logger = logging.getLogger(__name__)

# --- FastAPI App Initialization ---
app = FastAPI(
    title="uiautodev Local Server",
    description="Backend server for the local uiautodev inspection and automation tool.",
    version=__version__,
)

# --- Static Files Mounting ---
# Get the directory where this app.py file is located
current_file_dir = Path(__file__).parent
# Mount the 'static' directory located at the same level as this 'app.py' file (i.e., uiautodev/static)
# It will be accessible under the path "/static"
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
android_provider = AndroidProvider()
ios_provider = IOSProvider()
harmony_provider = HarmonyProvider()
mock_provider = MockProvider()

android_router = make_router(android_provider)
ios_router = make_router(ios_provider)
harmony_router = make_router(harmony_provider)
mock_router = make_router(mock_provider)

app.include_router(mock_router, prefix="/api/mock", tags=["Mock"])

if Environment.UIAUTODEV_MOCK:
    logger.info(
        "UIAUTODEV_MOCK environment variable is set. Using mock providers for device APIs."
    )
    app.include_router(mock_router, prefix="/api/android", tags=["Android (Mocked)"])
    app.include_router(mock_router, prefix="/api/ios", tags=["iOS (Mocked)"])
    app.include_router(mock_router, prefix="/api/harmony", tags=["HarmonyOS (Mocked)"])
else:
    logger.info("Using real device providers.")
    app.include_router(android_router, prefix="/api/android", tags=["Android"])
    app.include_router(ios_router, prefix="/api/ios", tags=["iOS"])
    app.include_router(harmony_router, prefix="/api/harmony", tags=["HarmonyOS"])

app.include_router(xml_router, prefix="/api/xml", tags=["XML Utilities"])


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
        drivers=["android", "ios", "harmonyos"],
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
    This should be your local_inspector_ui.html content.
    """
    # Path is now relative to this app.py file, using static_files_path defined above
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
    server_port = int(
        os.getenv("UIAUTODEV_PORT", 4000)
    )  # Defaulted to 4000 as per your previous app.py
    server_host = os.getenv("UIAUTODEV_HOST", "127.0.0.1")
    reload_enabled = (
        os.getenv("UIAUTODEV_RELOAD", "True").lower() == "true"
    )  # Default to True for dev

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
