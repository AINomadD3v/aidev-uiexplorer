#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Created on Fri Mar 01 2024 14:00:10 by codeskyblue"""

import asyncio  # <-- ADDED: For asyncio.get_event_loop()
import io
import logging
from typing import Any, Dict, List

from fastapi import APIRouter, Response

# ADDED: JSONResponse for structured error responses
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from uiautodev import command_proxy

# Assuming InteractiveCodePayload will be added to command_types.py
from uiautodev.command_types import (
    InteractiveCodePayload,
)  # <-- ADDED: Import the new payload model
from uiautodev.command_types import (
    Command,
    CurrentAppResponse,
    InstallAppRequest,
    InstallAppResponse,
    TapRequest,
)

# ADDED: To check instance type and access .ud property safely
from uiautodev.driver.android import AndroidDriver
from uiautodev.model import DeviceInfo, Node, ShellResponse
from uiautodev.provider import BaseProvider

# ADDED: Import your interactive executor function
from uiautodev.utils.interactive_executor import execute_interactive_code

logger = logging.getLogger(__name__)


class AndroidShellPayload(BaseModel):
    command: str


# If InteractiveCodePayload is not in command_types.py, you can define it here:
# class InteractiveCodePayload(BaseModel):
#     code: str
#     # enable_tracing: bool = True # Optional: allow client to control tracing


def make_router(provider: BaseProvider) -> APIRouter:
    router = APIRouter()

    @router.get("/list")
    def _list() -> List[DeviceInfo]:
        """List devices"""
        try:
            return provider.list_devices()
        except NotImplementedError as e:  # Keep existing error handling
            logger.warning(
                f"list_devices not implemented for provider: {type(provider).__name__}"
            )
            return JSONResponse(
                content={"error": "list_devices not implemented"}, status_code=501
            )
        except Exception as e:
            logger.exception("list_devices failed")
            return JSONResponse(content={"error": str(e)}, status_code=500)

    @router.post("/{serial}/shell")
    def android_shell(serial: str, payload: AndroidShellPayload) -> ShellResponse:
        """Run a shell command on an Android device"""
        try:
            driver = provider.get_device_driver(serial)
            return driver.shell(payload.command)
        except NotImplementedError as e:  # Keep existing error handling
            logger.warning(
                f"Shell command not implemented for driver: {type(driver).__name__}"
            )
            return JSONResponse(
                content={"error": "Shell not implemented"}, status_code=501
            )
        except Exception as e:
            logger.exception(f"Shell command failed for {serial}")
            # Ensure ShellResponse can handle an error field if it's a Pydantic model,
            # otherwise return a generic JSONResponse for errors.
            # Assuming ShellResponse is designed for this or returning a general error:
            return JSONResponse(
                content={"output": "", "error": str(e)}, status_code=500
            )

    # ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    # +++ ADDED: New endpoint for Interactive Python Execution +++++++++++++++
    # ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    @router.post("/{serial}/interactive_python")
    async def run_interactive_python(
        serial: str, payload: InteractiveCodePayload
    ) -> Response:
        """
        Execute a Python code snippet interactively on an Android device
        using uiautomator2.
        """
        logger.info(
            f"Received interactive python for {serial}. Code: {payload.code[:100]}..."
        )  # Log snippet
        try:
            driver_instance = provider.get_device_driver(serial)

            # This feature relies on uiautomator2, which is specific to AndroidDriver's .ud property
            if not isinstance(driver_instance, AndroidDriver):
                logger.warning(
                    f"Interactive Python attempted on non-Android driver for serial {serial}"
                )
                return JSONResponse(
                    status_code=400,
                    content={
                        "error": "Interactive Python execution is currently only supported for Android devices."
                    },
                )

            # Access the uiautomator2.Device object
            u2_device = driver_instance.ud
            if (
                not u2_device
            ):  # Should not happen if AndroidDriver is correctly initialized
                logger.error(
                    f"AndroidDriver for {serial} does not have a uiautomator2 device instance (.ud)"
                )
                return JSONResponse(
                    status_code=500,
                    content={
                        "error": "Failed to get uiautomator2 device instance from Android driver."
                    },
                )

            # Execute the user's code using the refactored script logic.
            # This runs the synchronous execute_interactive_code in a separate thread
            # to avoid blocking FastAPI's asynchronous event loop.
            loop = asyncio.get_event_loop()
            structured_output_string = await loop.run_in_executor(
                None,  # Uses the default ThreadPoolExecutor
                execute_interactive_code,
                payload.code,
                u2_device,
                # True # enable_tracing, assuming it's a param in execute_interactive_code
            )

            # The execute_interactive_code function returns a multi-line string
            # with custom formatting (WRT:, LNO:, EOF:).
            # Returning it as plain text is suitable for a console-like display on the frontend.
            return Response(content=structured_output_string, media_type="text/plain")

        except Exception as e:
            logger.exception(f"Error executing interactive python for {serial}")
            return JSONResponse(status_code=500, content={"error": str(e)})

    # ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    # +++ End of New Endpoint ++++++++++++++++++++++++++++++++++++++++++++++++++
    # ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

    @router.get(
        "/{serial}/screenshot/{id}",
        responses={200: {"content": {"image/jpeg": {}}}},
        response_class=Response,
    )
    def _screenshot(serial: str, id: int) -> Response:
        """Take a screenshot of device"""
        try:
            driver = provider.get_device_driver(serial)
            pil_img = driver.screenshot(id).convert("RGB")
            buf = io.BytesIO()
            pil_img.save(buf, format="JPEG")
            image_bytes = buf.getvalue()
            return Response(content=image_bytes, media_type="image/jpeg")
        except Exception as e:
            logger.exception(f"Screenshot failed for {serial}")
            return JSONResponse(content={"error": str(e)}, status_code=500)

    @router.get("/{serial}/hierarchy")
    def dump_hierarchy(
        serial: str, format: str = "json"
    ) -> Response:  # Return type changed to Response for flexibility
        """Dump the view hierarchy of an Android device"""
        try:
            driver = provider.get_device_driver(serial)
            xml_data, hierarchy_node = (
                driver.dump_hierarchy()
            )  # Assuming hierarchy_node is a Pydantic Node model
            if format == "xml":
                return Response(content=xml_data, media_type="text/xml")
            elif format == "json":
                # If hierarchy_node is already a Pydantic model, FastAPI handles serialization
                return hierarchy_node  # FastAPI will convert this to JSONResponse
            else:
                logger.warning(f"Invalid format requested for hierarchy: {format}")
                return JSONResponse(
                    content={
                        "error": f"Invalid format: {format}. Valid formats are 'json' or 'xml'."
                    },
                    status_code=400,
                )
        except Exception as e:
            logger.exception(f"Dump hierarchy failed for {serial}")
            return JSONResponse(content={"error": str(e)}, status_code=500)

    @router.post("/{serial}/command/tap")
    def command_tap(serial: str, params: TapRequest):
        """Run a tap command on the device"""
        try:
            driver = provider.get_device_driver(serial)
            command_proxy.tap(
                driver, params
            )  # Assuming this raises errors or command_proxy handles them
            return {"status": "ok"}
        except Exception as e:
            logger.exception(f"Tap command failed for {serial}")
            return JSONResponse(
                content={"error": str(e), "status": "error"}, status_code=500
            )

    @router.post("/{serial}/command/installApp")
    def install_app(serial: str, params: InstallAppRequest) -> InstallAppResponse:
        """Install app"""
        try:
            driver = provider.get_device_driver(serial)
            # Assuming app_install returns a Pydantic model or dict that FastAPI can serialize
            return command_proxy.app_install(driver, params)
        except Exception as e:
            logger.exception(f"Install app failed for {serial}")
            # Match InstallAppResponse structure for error or use generic JSONResponse
            return JSONResponse(
                content={"error": str(e)}, status_code=500
            )  # Adjust if InstallAppResponse has error fields

    @router.get("/{serial}/command/currentApp")
    def current_app(serial: str) -> CurrentAppResponse:
        """Get current app"""
        try:
            driver = provider.get_device_driver(serial)
            return command_proxy.app_current(driver)
        except Exception as e:
            logger.exception(f"Get current app failed for {serial}")
            # Match CurrentAppResponse structure for error or use generic JSONResponse
            return JSONResponse(
                content={"package": "", "activity": "", "pid": 0, "error": str(e)},
                status_code=500,
            )

    @router.post("/{serial}/command/{command}")
    def _command_proxy_other(
        serial: str, command: Command, params: Dict[str, Any] = None
    ):
        """Run a generic command on the device via command_proxy"""
        try:
            driver = provider.get_device_driver(serial)
            response = command_proxy.send_command(driver, command, params)
            return response
        except Exception as e:
            logger.exception(f"Command '{command.value}' failed for {serial}")
            return JSONResponse(content={"error": str(e)}, status_code=500)

    @router.get("/{serial}/backupApp")
    def _backup_app(serial: str, packageName: str):
        """Backup app. Added in 0.5.0"""
        try:
            driver = provider.get_device_driver(serial)
            file_name = f"{packageName}.apk"
            headers = {"Content-Disposition": f'attachment; filename="{file_name}"'}
            return StreamingResponse(driver.open_app_file(packageName), headers=headers)
        except Exception as e:
            logger.exception(f"Backup app failed for {serial}, package {packageName}")
            return JSONResponse(content={"error": str(e)}, status_code=500)

    return router
