import json  # For parsing/formatting JSON and context
import logging
import os
import platform
import signal
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional  # Added AsyncGenerator

import httpx  # For making API calls
import uvicorn
from dotenv import load_dotenv  # For loading .env file
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

from uiautodev import __version__
from uiautodev.common import convert_bytes_to_image, ocr_image
from uiautodev.model import Node  # Assuming Node is a Pydantic model or similar
from uiautodev.provider import AndroidProvider
from uiautodev.router.device import make_router

# Load environment variables from .env file
load_dotenv()

logger = logging.getLogger(__name__)

# --- FastAPI App Initialization ---
app = FastAPI(
    title="uiautodev Local Server",
    description="Backend server for the local uiautodev inspection and automation tool.",
    version=__version__,
    # docs_url="/api/docs",  # Optional: if you want to move docs
    # redoc_url="/api/redoc" # Optional: if you want to move redoc
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
    allow_origins=["*"],  # Restrict in production
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# --- Providers and Routers ---
android_provider = AndroidProvider()
android_router = make_router(android_provider)
logger.info("Using real Android device provider.")
app.include_router(android_router, prefix="/api/android", tags=["Android"])


# --- API Models ---
class InfoResponse(BaseModel):
    version: str
    description: str
    platform: str
    code_language: str
    cwd: str
    drivers: List[str]


# --- LLM Chat API Models ---
class ChatMessage(BaseModel):
    role: str  # "user", "assistant", or "system"
    content: str


class LlmChatRequest(BaseModel):
    prompt: str
    context: Dict[str, Any] = {}
    history: List[ChatMessage] = []
    # You can add other DeepSeek parameters here if you want the client to control them
    # e.g., temperature: Optional[float] = None, max_tokens: Optional[int] = None


# --- DeepSeek API Interaction Logic (Streaming) ---
DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions"
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")

if not DEEPSEEK_API_KEY:
    logger.warning(
        "DEEPSEEK_API_KEY not found in environment variables. LLM chat will not function."
    )


async def stream_deepseek_response(
    user_prompt: str,
    context_data: dict,
    history: List[ChatMessage],
    # Add other parameters like temperature, max_tokens if they come from LlmChatRequest
) -> AsyncGenerator[str, None]:
    if not DEEPSEEK_API_KEY:
        error_msg = "Error: DeepSeek API key is not configured on the server."
        yield f"event: error\ndata: {json.dumps({'error': error_msg})}\n\n"
        return

    system_prompt_content = (
        "You are an expert UI automation assistant specializing in Android automation with Python using uiautomator2-like syntax. "
        "Analyze the provided context (UI hierarchy, selected elements, console output, current code) to understand the user's current state. "
        "Generate concise and accurate Python code snippets for UI interaction (e.g., d(text='...').click()). "
        "Explain your reasoning clearly. If asked to debug, analyze the error and provide a corrected code snippet and explanation. "
        "If asked for test cases, suggest relevant interactions based on the visible UI elements. "
        "Always enclose Python code in triple backticks (```python ... ```)."
    )
    messages = [{"role": "system", "content": system_prompt_content}]

    for msg in history:
        messages.append({"role": msg.role, "content": msg.content})

    context_str_parts = []
    if context_data:
        context_str_parts.append("## Current UI/System Context:")
        if cd_se := context_data.get("selectedElement"):
            se_info = {
                k: v
                for k, v in cd_se.items()
                if k not in ["children", "parentKey", "bounds"]
            }  # Concise
            context_str_parts.append(
                f"### Selected Element:\n```json\n{json.dumps(se_info, indent=2)}\n```"
            )
        if cd_hier := context_data.get("uiHierarchy"):
            # Summarize hierarchy for brevity in prompt, LLM can ask for more if needed
            root_name = cd_hier.get("name", "N/A")
            num_children = len(cd_hier.get("children", []))
            context_str_parts.append(
                f"### UI Hierarchy Overview: Root element is '{root_name}' with {num_children} direct children. Relevant parts will be considered based on the query."
            )
        if cd_py_out := context_data.get("pythonConsoleOutput"):
            context_str_parts.append(
                f"### Last Python Console Output:\n```\n{cd_py_out[-1000:]}\n```"
            )  # Last 1000 chars
        if cd_py_code := context_data.get("pythonCode"):
            context_str_parts.append(
                f"### Current Python Code in Editor:\n```python\n{cd_py_code}\n```"
            )
        if cd_dev_info := context_data.get("deviceInfo"):
            context_str_parts.append(
                f"### Device Info:\n```json\n{json.dumps(cd_dev_info, indent=2)}\n```"
            )

    full_user_content = user_prompt
    if context_str_parts:
        full_user_content = (
            "\n\n".join(context_str_parts) + f"\n\n## User Request:\n{user_prompt}"
        )

    messages.append({"role": "user", "content": full_user_content})

    payload = {
        "model": "deepseek-chat",  # Or "deepseek-coder" might be better for code-heavy tasks
        "messages": messages,
        "stream": True,
        "temperature": 0.7,  # Adjust as needed
        "max_tokens": 2048,  # Adjust as needed
        # "stream_options": {"include_usage": True} # Optional: if you want usage statistics
    }
    # Add other params from LlmChatRequest if present e.g. payload["temperature"] = request_data.temperature

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
    }

    async with httpx.AsyncClient(
        timeout=120.0
    ) as client:  # Longer timeout for streaming
        try:
            logger.info(
                f"Streaming request to DeepSeek API. Model: {payload['model']}. User prompt: {user_prompt[:50]}..."
            )
            async with client.stream(
                "POST", DEEPSEEK_API_URL, json=payload, headers=headers
            ) as response:
                if response.status_code != 200:
                    error_content = await response.aread()
                    logger.error(
                        f"DeepSeek API Error: {response.status_code} - {error_content.decode()}"
                    )
                    yield f"event: error\ndata: {json.dumps({'error': f'LLM API Error ({response.status_code}): {error_content.decode()}'})}\n\n"
                    return

                async for line in response.aiter_lines():
                    if line.strip():
                        if line == "data: [DONE]":
                            logger.info("DeepSeek stream finished with [DONE].")
                            yield "event: end-of-stream\ndata: {}\n\n"  # Custom event for client
                            break
                        if line.startswith("data: "):
                            json_data_str = line[len("data: ") :]
                            try:
                                chunk_data = json.loads(json_data_str)
                                delta_content = (
                                    chunk_data.get("choices", [{}])[0]
                                    .get("delta", {})
                                    .get("content")
                                )
                                if delta_content is not None:  # Can be an empty string
                                    # Send each text chunk as a JSON string for easy parsing on client
                                    # This handles newlines and special characters within the chunk.
                                    yield f"data: {json.dumps(delta_content)}\n\n"
                                # Handle stream_options: include_usage if you enabled it
                                # if chunk_data.get("usage") is not None and payload.get("stream_options", {}).get("include_usage"):
                                #    logger.info(f"Token usage: {chunk_data['usage']}")
                                #    yield f"event: usage\ndata: {json.dumps(chunk_data['usage'])}\n\n"

                            except (json.JSONDecodeError, IndexError) as e:
                                logger.error(
                                    f"Error processing chunk from DeepSeek stream: {json_data_str}, Error: {e}"
                                )
                        # else: # Other SSE lines like 'event:', 'id:' - DeepSeek usually just sends 'data:'
                        #    logger.debug(f"Received non-data line from DeepSeek: {line}")

        except (
            httpx.HTTPStatusError
        ) as e:  # Should be caught by response.status_code check above, but as fallback
            error_message = (
                f"LLM API HTTP Error ({e.response.status_code}): {e.response.text}"
            )
            logger.error(error_message)
            yield f"event: error\ndata: {json.dumps({'error': error_message})}\n\n"
        except httpx.RequestError as e:
            error_message = f"Network issue contacting LLM: {str(e)}"
            logger.error(error_message)
            yield f"event: error\ndata: {json.dumps({'error': error_message})}\n\n"
        except Exception as e:
            error_message = (
                f"An unexpected error occurred with the LLM service: {str(e)}"
            )
            logger.exception("Unexpected error during DeepSeek stream.")
            yield f"event: error\ndata: {json.dumps({'error': error_message})}\n\n"


# --- LLM Chat API Endpoint ---
@app.post("/api/llm/chat")
async def handle_llm_chat_stream(request_data: LlmChatRequest, httprequest: Request):
    client_host = httprequest.client.host if httprequest.client else "unknown"
    logger.info(
        f"LLM Chat Stream request from {client_host}. Prompt: {request_data.prompt[:50]}..."
    )

    if not DEEPSEEK_API_KEY:
        # For streaming, raising HTTPException might close connection before client processes.
        # It's better to send an error event over the stream.
        async def error_stream():
            yield f"event: error\ndata: {json.dumps({'error': 'LLM service is not configured (API key missing).'})}\n\n"

        return StreamingResponse(error_stream(), media_type="text/event-stream")

    return StreamingResponse(
        stream_deepseek_response(
            request_data.prompt,
            request_data.context,
            request_data.history,
            # Pass other params from request_data if added to LlmChatRequest model
        ),
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
        logger.exception("OCR image processing failed.")
        return JSONResponse(
            status_code=500,
            content={"error": "OCR processing failed", "detail": str(e)},
        )
    finally:
        if file and hasattr(file, "file") and file.file and not file.file.closed:
            await file.close()


# --- Server Control and Static Content ---
@app.get("/shutdown", summary="Shutdown Server")
def shutdown_server() -> JSONResponse:
    logger.info("Shutdown endpoint called. Sending SIGINT to process %d.", os.getpid())
    os.kill(os.getpid(), signal.SIGINT)
    return JSONResponse(content={"message": "Server shutting down..."})


@app.get("/demo", summary="Serve Local Inspector UI")
def serve_local_inspector_ui():
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
    local_ui_path = "/demo"
    logger.debug(f"Root path accessed, redirecting to {local_ui_path}")
    return RedirectResponse(url=local_ui_path)


# --- Main Entry Point for Uvicorn ---
if __name__ == "__main__":
    server_port = int(os.getenv("UIAUTODEV_PORT", 4000))
    server_host = os.getenv("UIAUTODEV_HOST", "127.0.0.1")
    reload_enabled = os.getenv("UIAUTODEV_RELOAD", "True").lower() == "true"
    log_level_str = os.getenv("UIAUTODEV_LOG_LEVEL", "info").lower()

    logging.basicConfig(
        level=getattr(logging, log_level_str.upper(), logging.INFO),
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    logger.info(
        f"Starting uiautodev server v{__version__} on http://{server_host}:{server_port}"
    )
    uvicorn.run(
        "uiautodev.app:app",
        host=server_host,
        port=server_port,
        reload=reload_enabled,
        log_level=log_level_str,
    )
