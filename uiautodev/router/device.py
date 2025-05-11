import asyncio
import io
import logging
import traceback
from typing import Any, Dict, List, Optional, Union

from fastapi import APIRouter, Body, HTTPException, Path
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

from uiautodev import command_proxy
from uiautodev.command_types import (
    Command,
    CurrentAppResponse,
    InstallAppRequest,
    InstallAppResponse,
    InteractiveCodePayload,
    TapRequest,
)
from uiautodev.driver.android import AndroidDriver
from uiautodev.model import DeviceInfo, Node, ShellResponse
from uiautodev.provider import BaseProvider
from uiautodev.utils.interactive_executor import execute_interactive_code

logger = logging.getLogger(__name__)


class AndroidShellPayload(BaseModel):
    command: str


def make_router(provider: BaseProvider) -> APIRouter:
    router = APIRouter()

    @router.get("/list", response_model=List[DeviceInfo])
    def list_devices() -> Union[List[DeviceInfo], JSONResponse]:
        """List devices"""
        try:
            return provider.list_devices()
        except NotImplementedError:
            logger.warning(
                f"list_devices not implemented for provider: {type(provider).__name__}"
            )
            return JSONResponse(
                content={"error": "list_devices not implemented"}, status_code=501
            )
        except Exception as e:
            logger.exception("list_devices failed")
            return JSONResponse(content={"error": str(e)}, status_code=500)

    @router.post("/{serial}/shell", response_model=ShellResponse)
    def run_android_shell(
        serial: str, payload: AndroidShellPayload
    ) -> Union[ShellResponse, JSONResponse]:
        """Run a shell command on an Android device"""
        try:
            driver = provider.get_device_driver(serial)
            shell_result = driver.shell(payload.command)

            if isinstance(shell_result, ShellResponse):
                return shell_result
            elif (
                isinstance(shell_result, dict) and "output" in shell_result
            ):  # Attempt to construct if dict matches
                try:
                    return ShellResponse(**shell_result)
                except Exception:  # Pydantic validation error
                    logger.error(
                        f"Shell result dict could not be parsed into ShellResponse: {shell_result}"
                    )
                    return JSONResponse(
                        content={"output": "", "error": "Shell result format error"},
                        status_code=500,
                    )
            elif isinstance(shell_result, str):
                return ShellResponse(output=shell_result, error=None)
            else:
                logger.error(
                    f"Unexpected shell result type: {type(shell_result)} for command: {payload.command}"
                )
                return JSONResponse(
                    content={
                        "output": "",
                        "error": "Unexpected shell result type from driver",
                    },
                    status_code=500,
                )
        except NotImplementedError:
            logger.warning(
                f"Shell command not implemented for driver type used with {serial}"
            )
            return JSONResponse(
                content={
                    "output": "",
                    "error": "Shell not implemented for this driver type",
                },
                status_code=501,
            )
        except Exception as e:
            logger.exception(f"Shell command failed for {serial}")
            return JSONResponse(
                content={"output": "", "error": str(e)}, status_code=500
            )

    @router.post(
        "/{serial}/interactive_python", response_model=Dict[str, Optional[Any]]
    )
    async def run_interactive_python(
        serial: str, payload: InteractiveCodePayload
    ) -> Dict[str, Optional[Any]]:
        logger.info(
            f"Received interactive python for {serial}. Code: {payload.code[:100]}..."
        )
        try:
            driver_instance = provider.get_device_driver(serial)
            if not isinstance(driver_instance, AndroidDriver):
                logger.warning(
                    f"Interactive Python attempted on non-Android driver for serial {serial}"
                )
                return {
                    "stdout": "",
                    "stderr": "Interactive Python execution is only for Android devices.",
                    "result": None,
                    "execution_error": "Driver type not supported.",
                }

            u2_device = getattr(driver_instance, "ud", None)
            if not u2_device:
                logger.error(f"AndroidDriver for {serial} missing .ud instance")
                return {
                    "stdout": "",
                    "stderr": "Failed to get uiautomator2 instance.",
                    "result": None,
                    "execution_error": "Internal server error.",
                }

            loop = asyncio.get_event_loop()
            enable_tracing_flag = getattr(payload, "enable_tracing", False)
            structured_output_dict = await loop.run_in_executor(
                None,
                execute_interactive_code,
                payload.code,
                u2_device,
                enable_tracing_flag,
            )
            return structured_output_dict
        except HTTPException:
            raise
        except Exception as e:
            logger.exception(
                f"Unhandled error executing interactive python for {serial}"
            )
            return {
                "stdout": "",
                "stderr": f"Internal server error: {str(e)}",
                "result": None,
                "execution_error": traceback.format_exc(),
            }

    @router.get(
        "/{serial}/screenshot/{id}",
        responses={200: {"content": {"image/jpeg": {}}}},
        response_class=Response,
    )
    def take_screenshot(serial: str, id: int) -> Response:
        try:
            driver = provider.get_device_driver(serial)
            pil_img = driver.screenshot(id).convert("RGB")
            buf = io.BytesIO()
            pil_img.save(buf, format="JPEG")
            return Response(content=buf.getvalue(), media_type="image/jpeg")
        except Exception as e:
            logger.exception(f"Screenshot failed for {serial}")
            return JSONResponse(content={"error": str(e)}, status_code=500)

    # MODIFIED for Hierarchy JSON serialization
    @router.get(
        "/{serial}/hierarchy", response_model=Union[Node, None]
    )  # If format=json, expect Node
    def get_dump_hierarchy(serial: str, format: str = "json") -> Response:
        """Dump the view hierarchy of an Android device"""
        try:
            driver = provider.get_device_driver(serial)
            xml_data, hierarchy_node_model = (
                driver.dump_hierarchy()
            )  # Assuming this returns (xml_str, Pydantic_Node_model)

            if format == "xml":
                return Response(content=xml_data, media_type="application/xml")
            elif format == "json":
                # Let FastAPI serialize the Pydantic model directly.
                # This assumes hierarchy_node_model is a Pydantic model instance.
                if hierarchy_node_model:
                    return hierarchy_node_model
                else:
                    # Handle case where hierarchy_node_model might be None but format is json
                    logger.warning(
                        f"Hierarchy data for JSON format is None for serial {serial}"
                    )
                    return JSONResponse(
                        content={"error": "Hierarchy data is null"}, status_code=404
                    )  # Or 200 with empty data
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

    @router.post("/{serial}/command/tap", response_model=Dict[str, str])
    def run_command_tap(
        serial: str, params: TapRequest
    ) -> Union[Dict[str, str], JSONResponse]:
        try:
            driver = provider.get_device_driver(serial)
            command_proxy.tap(driver, params)
            return {"status": "ok"}
        except Exception as e:
            logger.exception(f"Tap command failed for {serial}")
            return JSONResponse(
                content={"error": str(e), "status": "error"}, status_code=500
            )

    @router.post("/{serial}/command/installApp", response_model=InstallAppResponse)
    def run_install_app(
        serial: str, params: InstallAppRequest
    ) -> Union[InstallAppResponse, JSONResponse]:
        try:
            driver = provider.get_device_driver(serial)
            return command_proxy.app_install(driver, params)
        except Exception as e:
            logger.exception(f"Install app failed for {serial}")
            # Constructing a valid InstallAppResponse for error, or use JSONResponse
            # This assumes InstallAppResponse has these fields, or they are Optional
            return JSONResponse(
                content={"success": False, "reason": str(e), "error": str(e)},
                status_code=500,
            )

    @router.get("/{serial}/command/currentApp", response_model=CurrentAppResponse)
    def get_current_app(serial: str) -> Union[CurrentAppResponse, JSONResponse]:
        try:
            driver = provider.get_device_driver(serial)
            return command_proxy.app_current(driver)
        except Exception as e:
            logger.exception(f"Get current app failed for {serial}")
            # Ensure all fields for CurrentAppResponse are provided or optional
            return JSONResponse(
                content={
                    "package": None,
                    "activity": None,
                    "pid": None,
                    "error": str(e),
                },
                status_code=500,
            )

    @router.post("/{serial}/command/{command}")
    def run_command_proxy_other(
        serial: str, command: Command, params: Optional[Dict[str, Any]] = Body(None)
    ) -> Any:  # Return type Any as command_proxy.send_command can vary
        try:
            driver = provider.get_device_driver(serial)
            actual_params = params if params is not None else {}
            response = command_proxy.send_command(driver, command, actual_params)
            return response
        except Exception as e:
            command_value = getattr(command, "value", str(command))
            logger.exception(f"Command '{command_value}' failed for {serial}")
            return JSONResponse(content={"error": str(e)}, status_code=500)

    @router.get("/{serial}/backupApp")
    def run_backup_app(serial: str, packageName: str) -> Response:
        try:
            driver = provider.get_device_driver(serial)
            app_file_stream = driver.open_app_file(packageName)
            file_name = f"{packageName}.apk"
            headers = {"Content-Disposition": f'attachment; filename="{file_name}"'}
            return StreamingResponse(
                app_file_stream,
                headers=headers,
                media_type="application/vnd.android.package-archive",
            )
        except Exception as e:
            logger.exception(f"Backup app failed for {serial}, package {packageName}")
            return JSONResponse(content={"error": str(e)}, status_code=500)

    return router
