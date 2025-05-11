import contextlib
import io
import json
import linecache
import os
import sys
import time
import traceback
from typing import Any, Dict, Optional

# This will be provided by the uiautodev environment
import uiautomator2 as u2

_file_contents_for_trace: Dict[str, str] = {}  # For trace mode, if ever re-enabled


class QuitError(Exception):
    pass


def exec_code(code: str, globals_dict: Dict[str, Any]) -> Any:
    """
    Compiles and executes the given code string.
    Tries to eval the code as a single expression first.
    If that fails, it executes the code as a block of statements.
    Returns the result of the evaluation if it was an expression, otherwise None.
    """
    try:
        # Attempt to compile and eval as a single expression
        compiled_code = compile(code.strip(), "<string>", "eval")
        return eval(compiled_code, globals_dict)
    except SyntaxError:
        # If not a valid single expression (or empty), compile and exec as statements
        # This also handles multi-line statements or code that doesn't return a value.
        try:
            compiled_code = compile(code, "<string>", "exec")
            exec(compiled_code, globals_dict)
            return None  # exec doesn't return a value
        except Exception:
            raise  # Re-raise a more specific exec error for the main handler
    except Exception:
        raise  # Re-raise other eval errors


@contextlib.contextmanager
def redirect_stdstreams_to_capture(stdout_buf: io.StringIO, stderr_buf: io.StringIO):
    """
    Context manager to redirect sys.stdout and sys.stderr to provided StringIO buffers.
    Writes raw string data without prefixes or JSON dumping for print().
    """
    original_stdout = sys.stdout
    original_stderr = sys.stderr

    class RawCaptureStream:
        def __init__(self, buffer: io.StringIO):
            self._buffer = buffer

        def isatty(self) -> bool:
            return False

        def write(self, data: str):
            self._buffer.write(data)  # Write raw data directly

        def flush(self):
            pass  # io.StringIO doesn't typically require explicit flush

    sys.stdout = RawCaptureStream(stdout_buf)
    sys.stderr = RawCaptureStream(stderr_buf)

    try:
        yield
    finally:
        sys.stdout = original_stdout
        sys.stderr = original_stderr


def getline_for_trace(filename: str, lineno: int) -> str:
    if filename == "<string>":
        code_content = _file_contents_for_trace.get(filename)
        if code_content:
            lines = code_content.splitlines()
            if 0 <= lineno < len(lines):
                return lines[lineno] + "\n"
        return ""
    return linecache.getline(filename, lineno + 1)


def generate_trace_function(trace_target_filename: str, debug_log_list: list):
    def _trace(frame, event: str, arg: Any):
        if event == "line":
            current_lineno_0_based = frame.f_lineno - 1
            current_filename = frame.f_globals.get("__file__")
            if current_filename == trace_target_filename:
                source_line = getline_for_trace(
                    current_filename, current_lineno_0_based
                ).rstrip()
                debug_log_list.append(
                    f"LNO:{current_lineno_0_based}"
                )  # For structured log
                debug_log_list.append(
                    f"DBG:{current_lineno_0_based:3d} {source_line}"
                )  # For structured log
        return _trace

    return _trace


def execute_interactive_code(
    code_string: str,
    u2_device_instance: Optional[
        u2.Device
    ],  # Make it optional if testing without real device
    enable_tracing: bool = False,  # <<< MODIFICATION: Tracing OFF by default
) -> Dict[str, Any]:
    """
    Executes a string of Python code and returns structured output.

    Args:
        code_string: The Python code to execute.
        u2_device_instance: An initialized uiautomator2.Device instance (or None for mock).
        enable_tracing: Whether to enable line-by-line tracing for debug logs.

    Returns:
        A dictionary containing stdout, stderr, result, and error_traceback.
    """
    global _file_contents_for_trace
    if enable_tracing:  # Only store if tracing is on
        _file_contents_for_trace["<string>"] = code_string

    stdout_buffer = io.StringIO()
    stderr_buffer = io.StringIO()
    debug_log_output = []  # For LNO/DBG if tracing enabled

    execution_globals = {
        "__file__": "<string>",
        "__name__": "__main__",
        "os": os,
        "time": time,
        "json": json,  # User can still use json module if they want
        "uiautomator2": u2,
        "u2": u2,
        "d": u2_device_instance,
    }

    return_value = None
    execution_error_traceback: Optional[str] = None

    original_trace_function = sys.gettrace()
    active_trace_function = None
    if enable_tracing:
        active_trace_function = generate_trace_function("<string>", debug_log_output)

    try:
        with redirect_stdstreams_to_capture(stdout_buffer, stderr_buffer):
            if active_trace_function:
                sys.settrace(active_trace_function)

            return_value = exec_code(code_string, execution_globals)

            # If return_value is not None (meaning it was an expression),
            # it's captured. If it was exec, it's None.
            # Python REPL implicitly prints the result of expressions if not None.
            # We will put this in a separate 'result' field.

    except QuitError as qe:
        # If you want to handle QuitError specifically in output
        stderr_buffer.write(f"QUIT SIGNAL: {qe}\n")
    except Exception:
        execution_error_traceback = traceback.format_exc()
        # The exception itself will be printed to our captured stderr by Python's default excepthook
        # or we can choose to format it directly into the stderr_buffer if redirect_stdstreams_to_capture
        # doesn't catch it before the finally block (it should).
        # Let's ensure it's in stderr_buffer:
        # stderr_buffer.write(execution_error_traceback) # This might duplicate if already printed
    finally:
        if active_trace_function:
            sys.settrace(original_trace_function)
        # _file_contents_for_trace.pop("<string>", None) # Clean up if tracing was on

    # Construct the structured response
    response = {
        "stdout": stdout_buffer.getvalue(),
        "stderr": stderr_buffer.getvalue(),
        "result": (
            repr(return_value) if return_value is not None else None
        ),  # Represent the result
        "execution_error": execution_error_traceback,  # This will contain formatted traceback if exec_code failed
    }

    # If tracing was enabled, add the debug logs as a separate field
    if enable_tracing and debug_log_output:
        response["debug_log"] = "\n".join(debug_log_output)

    stdout_buffer.close()
    stderr_buffer.close()

    return response


if __name__ == "__main__":
    print("--- Interactive Executor Test ---")

    class MockDevice:
        def __init__(self, serial="mockdevice"):
            self.serial = serial
            self.info = {"serial": self.serial, "productName": "Mockingjay Phone"}
            self._internal_call_count = 0
            print(f"MockDevice '{self.serial}' initialized for testing.")

        def shell(self, cmd, timeout=None):
            self._internal_call_count += 1
            print(
                f"MockDevice: Shell command #{self._internal_call_count}: '{cmd}' (timeout: {timeout})"
            )
            if "echo hello" in cmd:
                return "hello from mock shell\n"
            if "error" in cmd:
                raise u2.exceptions.AdbError("mock adb error", f"output for {cmd}")
            return f"output for {cmd}\n"

        def click(self, x, y):
            print(f"MockDevice: click at ({x}, {y})")
            return True

    mock_d = MockDevice()

    test_cases = [
        {
            "name": "Simple Print",
            "code": 'print("Hello from user code!")\nprint("Line 2")',
        },
        {"name": "Expression Result", "code": "a = 10\nb = 20\na + b"},
        {
            "name": "Device Interaction",
            "code": 'print(d.info)\nprint(d.shell("echo test"))\nd.click(100,200)',
        },
        {
            "name": "Stderr Output",
            "code": 'import sys\nprint("This is stdout")\nsys.stderr.write("This is stderr\\n")',
        },
        {"name": "Syntax Error", "code": "print('hello\nval = 1 +"},
        {
            "name": "Runtime Error",
            "code": 'print("Start")\nx = 1 / 0\nprint("Should not reach here")',
        },
        {"name": "Multi-line Expression", "code": "(\n1\n+\n2\n)"},  # Will be eval'd
        {"name": "Empty Code", "code": ""},
        {
            "name": "Code with only comments",
            "code": "# This is a comment\n# Another comment",
        },
    ]

    for test in test_cases:
        print(f"\n--- Running Test: {test['name']} ---")
        print(f"Code:\n{test['code']}\n---")
        # Test with tracing OFF (default)
        output_data_no_trace = execute_interactive_code(
            test["code"], mock_d, enable_tracing=False
        )
        print("Structured Output (No Tracing):")
        print(json.dumps(output_data_no_trace, indent=2))

        # Test with tracing ON
        # output_data_with_trace = execute_interactive_code(test['code'], mock_d, enable_tracing=True)
        # print("\nStructured Output (WITH Tracing):")
        # print(json.dumps(output_data_with_trace, indent=2))
        print(f"--- End Test: {test['name']} ---")
