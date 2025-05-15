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

# Attempt to import specific exceptions directly for type hinting or internal use if needed.
# User code (executed by this executor) should do its own imports.
try:
    from uiautomator2 import AdbError, UiObjectNotFoundError
except ImportError:
    # Define placeholders if not found, for type checking or older uiautomator2 versions
    # This is mainly for the executor's own potential use, not for the code it runs.
    class AdbError(Exception):
        pass

    class UiObjectNotFoundError(Exception):
        pass


_file_contents_for_trace: Dict[str, str] = {}


class QuitError(Exception):
    """Custom exception to signal a quit request from the executed code."""

    pass


def exec_code(code: str, globals_dict: Dict[str, Any]) -> Any:
    """
    Compiles and executes the given code string.
    Attempts to compile and evaluate the code as a single expression first.
    If that fails (due to SyntaxError, e.g., if it's a statement or multi-line script),
    it compiles and executes the code as a block of statements.
    Returns the result of the evaluation if it was an expression, otherwise None.
    """
    try:
        compiled_code_for_eval = compile(code.strip(), "<string>", "eval")
        return eval(compiled_code_for_eval, globals_dict)
    except SyntaxError:
        try:
            compiled_code_for_exec = compile(code, "<string>", "exec")
            exec(compiled_code_for_exec, globals_dict)
            return None
        except Exception as e_exec:
            raise e_exec
    except Exception as e_eval:
        raise e_eval


@contextlib.contextmanager
def redirect_stdstreams_to_capture(stdout_buf: io.StringIO, stderr_buf: io.StringIO):
    """
    Context manager to redirect sys.stdout and sys.stderr to provided StringIO buffers.
    """
    original_stdout = sys.stdout
    original_stderr = sys.stderr

    class RawCaptureStream(io.TextIOBase):
        def __init__(self, buffer: io.StringIO):
            self._buffer = buffer

        def isatty(self) -> bool:
            return False

        def write(self, data: str) -> int:
            return self._buffer.write(data)

        def flush(self):
            self._buffer.flush()

    sys.stdout = RawCaptureStream(stdout_buf)
    sys.stderr = RawCaptureStream(stderr_buf)

    try:
        yield
    finally:
        sys.stdout = original_stdout
        sys.stderr = original_stderr


def getline_for_trace(
    filename: str, lineno: int, module_globals: Optional[Dict[str, Any]] = None
) -> str:
    """
    Retrieves a line of source code for tracing.
    """
    if filename == "<string>":
        code_content = _file_contents_for_trace.get(filename)
        if code_content:
            lines = code_content.splitlines()
            if 0 < lineno <= len(lines):
                return lines[lineno - 1] + "\n"
        return ""
    return linecache.getline(filename, lineno, module_globals)


def generate_trace_function(trace_target_filename: str, debug_log_list: list):
    """
    Generates a trace function for sys.settrace to log line numbers and source code.
    """

    def _trace(frame, event: str, arg: Any):
        if event == "line":
            current_lineno = frame.f_lineno
            current_filename = frame.f_code.co_filename

            if current_filename == trace_target_filename:
                source_line = getline_for_trace(
                    current_filename, current_lineno, frame.f_globals
                ).rstrip()
                debug_log_list.append(f"LNO:{current_lineno - 1}")
                debug_log_list.append(f"DBG:{current_lineno:3d} {source_line}")
        return _trace

    return _trace


def execute_interactive_code(
    code_string: str,
    u2_device_instance: Optional[u2.Device],  # Type hint for uiautomator2.Device
    enable_tracing: bool = False,
) -> Dict[str, Any]:
    """
    Executes a string of Python code in a controlled environment and returns structured output.
    """
    global _file_contents_for_trace
    if enable_tracing:
        _file_contents_for_trace["<string>"] = code_string

    stdout_buffer = io.StringIO()
    stderr_buffer = io.StringIO()
    debug_log_output = []

    execution_globals = {
        "__file__": "<string>",
        "__name__": "__main__",
        "os": os,
        "sys": sys,
        "time": time,
        "json": json,
        "uiautomator2": u2,
        "u2": u2,
        "d": u2_device_instance,
        "QuitError": QuitError,
        "print": print,
    }
    # Add uiautomator2 specific exceptions to globals if they were imported successfully
    # This allows user scripts to use them without necessarily importing if they are common
    # However, best practice is for user scripts to do their own imports.
    if "AdbError" in globals() and AdbError is not Exception:
        execution_globals["AdbError"] = AdbError
    if "UiObjectNotFoundError" in globals() and UiObjectNotFoundError is not Exception:
        execution_globals["UiObjectNotFoundError"] = UiObjectNotFoundError

    return_value = None
    execution_error_traceback: Optional[str] = None
    original_system_trace_function = sys.gettrace()
    active_custom_trace_function = None

    if enable_tracing:
        active_custom_trace_function = generate_trace_function(
            "<string>", debug_log_output
        )

    try:
        with redirect_stdstreams_to_capture(stdout_buffer, stderr_buffer):
            if active_custom_trace_function:
                sys.settrace(active_custom_trace_function)
            return_value = exec_code(code_string, execution_globals)
    except QuitError as qe:
        stderr_buffer.write(f"\nQUIT SIGNAL: {qe}\n")
        execution_error_traceback = f"QuitError: {qe}"
    except Exception:
        execution_error_traceback = traceback.format_exc()
    finally:
        if active_custom_trace_function:
            sys.settrace(original_system_trace_function)
        if enable_tracing:
            _file_contents_for_trace.pop("<string>", None)

    response = {
        "stdout": stdout_buffer.getvalue(),
        "stderr": stderr_buffer.getvalue(),
        "result": repr(return_value) if return_value is not None else None,
        "execution_error": execution_error_traceback,
    }

    if enable_tracing and debug_log_output:
        response["debug_log"] = "\n".join(debug_log_output)

    stdout_buffer.close()
    stderr_buffer.close()

    return response


if __name__ == "__main__":
    print("--- Interactive Executor Test ---")

    # For tests requiring device interaction, you would connect to a real device/emulator here,
    # or use a more sophisticated mocking library if needed.
    # For this example, we'll pass None for the device instance in most tests.
    # Example:
    # try:
    #     test_device_instance = u2.connect_usb() # or u2.connect('emulator-5554')
    #     print(f"Connected to test device: {test_device_instance.info.get('productName')}")
    # except Exception as e:
    #     print(f"Could not connect to a test device: {e}. Some tests will use None for device.")
    test_device_instance = None  # Default to None if no device connected for self-test

    test_cases = [
        {
            "name": "Simple Print",
            "code": 'print("Hello from user code!")\nprint("Line 2")',
            "tracing": False,
            "device": None,
        },
        {
            "name": "Expression Result",
            "code": "a = 10\nb = 20\na + b",
            "tracing": False,
            "device": None,
        },
        {
            "name": "Device Interaction (No Device)",
            "code": "print(type(d))\nif d: print(d.info)",  # Safe check for d
            "tracing": False,
            "device": None,  # Test with d as None
        },
        {
            "name": "Device Interaction (With Device if available)",
            "code": 'if d: print(f"Device serial: {d.serial}")\nelse: print("No device available for this test.")',
            "tracing": False,
            "device": test_device_instance,  # Pass the potentially connected device
        },
        {
            "name": "Stderr Output",
            "code": 'import sys\nprint("This is stdout")\nsys.stderr.write("This is stderr\\n")',
            "tracing": False,
            "device": None,
        },
        {
            "name": "Syntax Error in Script",
            "code": "print('hello\nval = 1 +",
            "tracing": False,
            "device": None,
        },
        {
            "name": "Syntax Error in Expression",
            "code": "1 + * 2",
            "tracing": False,
            "device": None,
        },
        {
            "name": "Runtime Error (ZeroDivision)",
            "code": 'print("Start")\nx = 1 / 0\nprint("Should not reach here")',
            "tracing": False,
            "device": None,
        },
        {
            "name": "Runtime Error (NameError in user code)",
            "code": "print(some_undefined_variable)",
            "tracing": False,
            "device": None,
        },
        {
            "name": "Multi-line Expression",
            "code": "(\n1\n+\n2\n)",
            "tracing": False,
            "device": None,
        },
        {"name": "Empty Code", "code": "", "tracing": False, "device": None},
        {
            "name": "Code with only comments",
            "code": "# This is a comment\n# Another comment",
            "tracing": False,
            "device": None,
        },
        {
            "name": "Tracing Example (No Device)",
            "code": 'x=10\ny=20\nz=x+y\nprint(f"Result: {z}")',
            "tracing": True,
            "device": None,
        },
        {
            "name": "Import uiautomator2 AdbError and use",
            "code": (
                "from uiautomator2 import AdbError\n"
                "try:\n"
                "  if d and hasattr(d, 'shell_error_test'): d.shell_error_test('trigger error') # Hypothetical error trigger\n"
                "  else: print('Skipping AdbError test: d is None or lacks test method.')\n"
                "except AdbError as e:\n"
                "  print(f'Caught expected AdbError: {e}')\n"
                "except AttributeError:\n"  # For d.shell_error_test if not present
                "  print('Skipping AdbError test: d is None or lacks test method.')"
            ),
            "tracing": False,
            "device": test_device_instance,  # This test would be more meaningful with a mock that can raise AdbError
        },
    ]

    for test in test_cases:
        print(f"\n--- Running Test: {test['name']} (Tracing: {test['tracing']}) ---")
        print(f"Code:\n{test['code']}\n---")

        # Use the device specified in the test case, which might be None or a real instance
        current_test_device = test.get("device", None)

        output_data = execute_interactive_code(
            test["code"], current_test_device, enable_tracing=test["tracing"]
        )
        print("Structured Output:")
        print("{")
        for key, value in output_data.items():
            # Safely dump string values to represent them as JSON strings (escaped)
            # and other values normally.
            if isinstance(value, str):
                print(f'  "{key}": {json.dumps(value)},')
            else:
                print(
                    f'  "{key}": {json.dumps(value, indent=None if isinstance(value, (list, dict)) else 2)},'
                )
        print("}")
        print(f"--- End Test: {test['name']} ---")
