# uiautodev/utils/interactive_executor.py
# coding: utf-8

import contextlib
import io
import json
import linecache
import os
import sys
import time
import traceback
from typing import Any, Dict, Union

# This will be provided by the uiautodev environment when this module is used
import uiautomator2 as u2

# Global to store code content for linecache, specific to the current execution context
# In a multi-threaded server, care must be taken if this approach is used directly.
# For simplicity, we'll set it per call. A more robust solution might involve
# passing it around or using thread-locals if filename != "<string>" was common.
_file_contents_for_trace: Dict[str, str] = {}


class QuitError(Exception):
    """Custom exception to signal a quit from the execution logic."""

    pass


def exec_code(code: str, globals_dict: Dict[str, Any]) -> Union[Any, None]:
    """
    Compiles and executes the given code string.
    It tries to eval first, then exec.
    """
    try:
        # Try to compile as an expression (for eval)
        compiled_code = compile(code, "<string>", "eval")
        is_expression = True
    except SyntaxError:
        # If it's not an expression, compile as statements (for exec)
        compiled_code = compile(code, "<string>", "exec")
        is_expression = False

    if is_expression:
        return eval(compiled_code, globals_dict)
    else:
        exec(compiled_code, globals_dict)
        return None


def getline_for_trace(filename: str, lineno: int) -> str:
    """
    Retrieves a specific line from a file or from the in-memory code string.
    Args:
        lineno: Line number, starting from 0.
    Note:
        linecache.getline expects lineno starting from 1.
    """
    if filename == "<string>":
        code_content = _file_contents_for_trace.get(filename)
        if code_content:
            lines = code_content.splitlines()
            if 0 <= lineno < len(lines):
                return lines[lineno] + "\n"  # linecache.getline includes newline
        return ""
    # Fallback for actual files (though likely not used if filename is always "<string>")
    return linecache.getline(filename, lineno + 1)


@contextlib.contextmanager
def redirect_stdstreams_to_buffer(output_buffer: io.StringIO, wrt_prefix="WRT:"):
    """
    Context manager to redirect sys.stdout and sys.stderr to an in-memory buffer.
    Output from user's print() calls will be prefixed with wrt_prefix and JSON dumped.
    """
    original_stdout = sys.stdout
    original_stderr = sys.stderr

    class MockOutputStream:
        def __init__(self, buffer: io.StringIO, prefix: str):
            self._buffer = buffer
            self._prefix = prefix

        def isatty(self) -> bool:
            return False

        def write(self, data: str):
            # Replicates the original weditor logic:
            # if data is not an empty string, prefix with WRT: and json.dumps it.
            # This means print("hello") -> data="hello\n" -> WRT:"hello\\n"\n
            # And print("h", end="") -> data="h" -> WRT:"h"\n
            if (
                data
            ):  # Original script checked `if data != ""`. Empty string won't be written.
                try:
                    self._buffer.write(self._prefix + json.dumps(data) + "\n")
                except Exception as e:
                    # Fallback if json.dumps fails (e.g., complex object that's not serializable by default)
                    # This case should be rare for string data from print.
                    self._buffer.write(f"ERR:Failed to JSON dump output: {str(e)}\n")

        def flush(self):
            # io.StringIO doesn't require explicit flush for its content to be readable.
            pass

    sys.stdout = MockOutputStream(output_buffer, wrt_prefix)
    sys.stderr = MockOutputStream(
        output_buffer, "ERR:"
    )  # Use a different prefix for stderr for clarity

    try:
        yield
    finally:
        sys.stdout = original_stdout
        sys.stderr = original_stderr


def generate_trace_function(trace_target_filename: str, output_buffer: io.StringIO):
    """
    Creates a trace function that writes LNO: and DBG: messages to the output buffer.
    """

    def _trace(frame, event: str, arg: Any):
        if event == "line":
            # f_lineno is 1-based, convert to 0-based
            current_lineno_0_based = frame.f_lineno - 1
            # __file__ in the frame's globals should be "<string>" for our executed code
            current_filename = frame.f_globals.get("__file__")

            if current_filename == trace_target_filename:
                source_line = getline_for_trace(
                    current_filename, current_lineno_0_based
                ).rstrip()
                try:
                    output_buffer.write(f"LNO:{current_lineno_0_based}\n")
                    output_buffer.write(
                        f"DBG:{current_lineno_0_based:3d} {source_line}\n"
                    )
                except Exception as e:
                    # Avoid crashing the trace function itself. Log to original stderr as a last resort.
                    # In a server, this might go to server logs.
                    sys.__stderr__.write(f"CRITICAL_TRACE_ERROR: {e}\n")
        return _trace

    return _trace


def execute_interactive_code(
    code_string: str, u2_device_instance: u2.Device, enable_tracing: bool = True
) -> str:
    """
    Executes a string of Python code in an environment with uiautomator2.

    Args:
        code_string: The Python code to execute.
        u2_device_instance: An initialized uiautomator2.Device instance.
        enable_tracing: Whether to enable line-by-line tracing (LNO:, DBG:).

    Returns:
        A string containing all captured output, formatted with prefixes.
    """
    global _file_contents_for_trace
    # Store the code for the current execution so getline_for_trace can access it.
    # This assumes execute_interactive_code is not called concurrently in a way
    # that would cause race conditions on _file_contents_for_trace["<string>"].
    # If FastAPI runs this function in threads, this global is shared, which is problematic.
    # A cleaner way would be to pass _file_contents_for_trace to gen_tracefunc or make it thread-local.
    # For now, keeping it simple as per original script's implicit single-threaded assumption.
    _file_contents_for_trace["<string>"] = code_string

    output_buffer = io.StringIO()
    start_execution_time = time.time()

    # Globals available to the executed code
    execution_globals = {
        "__file__": "<string>",  # Essential for the trace function to identify the code
        "__name__": "__main__",
        "os": os,
        # "sys": sys, # Exposing server's sys can be risky; user code will use the mocked sys.stdout/stderr
        "time": time,
        "json": json,
        "uiautomator2": u2,  # The uiautomator2 module itself
        "u2": u2,  # Shorthand alias for uiautomator2
        "d": u2_device_instance,  # The connected uiautomator2.Device instance
        # The 'print' built-in will be automatically redirected by redirect_stdstreams_to_buffer
    }

    original_trace_function = sys.gettrace()
    active_trace_function = None
    if enable_tracing:
        active_trace_function = generate_trace_function("<string>", output_buffer)

    try:
        # Redirect stdout/stderr for the duration of the code execution
        with redirect_stdstreams_to_buffer(output_buffer):
            if active_trace_function:
                sys.settrace(active_trace_function)

            # Execute the user's code
            return_value = exec_code(code_string, execution_globals)

            # If exec_code evaluated an expression, print its return value
            # This print will go through the mocked stdout, getting the WRT: prefix
            if return_value is not None:
                print(return_value)

    except QuitError as e:
        # Custom quit signal from the original script's logic (if adapted)
        output_buffer.write(f"DBG:{e!r}\n")  # Write DBG directly as per original
        output_buffer.write("QUIT\n")  # Write QUIT directly
    except Exception:
        # Capture and format any other exceptions
        # The print call here will use the mocked stdout via redirect_stdstreams_to_buffer,
        # so the traceback will be prefixed with WRT: (or ERR: if it was stderr).
        # Original script did: flines[0] + "".join(flines[5:]).rstrip()
        # We want to ensure this gets written to the buffer correctly.
        tb_text = traceback.format_exc()
        # To mimic the original structure (first line + selected later lines)
        tb_lines = tb_text.splitlines(keepends=True)
        formatted_tb = tb_lines[0]  # Usually "Traceback (most recent call last):"
        # Find where the "<string>" execution starts in traceback
        trace_start_index = -1
        for i, line in enumerate(tb_lines):
            if 'File "<string>"' in line:
                trace_start_index = i
                break

        if trace_start_index != -1:
            # Show from the File "<string>" part onwards
            formatted_tb += "".join(tb_lines[trace_start_index:])
        else:  # Fallback, show most of it
            formatted_tb += "".join(tb_lines[1:])

        # Write this formatted traceback using the mocked print to get WRT: prefix
        # The mocked print handles json.dumps.
        print(formatted_tb.rstrip())

    finally:
        # Crucially, restore the original trace function
        if active_trace_function:  # Only restore if we set one
            sys.settrace(original_trace_function)

        # Calculate execution time and append EOF marker
        execution_millis = (time.time() - start_execution_time) * 1000
        output_buffer.write(f"EOF:{int(execution_millis)}\n")  # Write EOF directly

        # Clear the specific key from the global map if it helps with memory, though "<string>" is fixed
        # if "<string>" in _file_contents_for_trace:
        #     del _file_contents_for_trace["<string>"]

    return output_buffer.getvalue()


if __name__ == "__main__":
    # Example usage:
    # This requires a uiautomator2.Device instance.
    # For local testing, you might connect to a device first.
    print("--- Example Test ---")

    # Mock u2.Device for local testing if no device is connected
    class MockDevice:
        def __init__(self, serial="mockdevice"):
            self.serial = serial
            self.info = {"serial": serial, "productName": "Mock Phone"}
            print(f"MockDevice created for {self.serial}")

        def shell(self, cmd):
            print(f"MockDevice: Shell command '{cmd}'")
            if "echo hello" in cmd:
                return "hello from mock shell\n"
            return ""

        def __str__(self):
            return f"<MockDevice serial={self.serial}>"

    try:
        # test_device = u2.connect() # Connect to a real device if available
        test_device = MockDevice()
        print(f"Using device: {test_device.info}")
    except Exception as e:
        print(f"Could not connect to a uiautomator2 device for testing: {e}")
        print("Falling back to a mock device for demonstration.")
        test_device = MockDevice()

    test_code_simple_print = 'print("Hello from interactive code!")'
    test_code_u2_info = 'print(d.info)\nprint(f"Device serial: {d.serial}")'
    test_code_multi_line = 'a = 10\nb = 20\nprint(f"Sum: {a+b}")\nprint("Done.")'
    test_code_eval = "x = 100\nx * 2"  # Last line is an expression
    test_code_error = 'print("Start")\n1/0\nprint("End")'
    test_code_shell = 'print(d.shell("echo hello world"))'

    tests = {
        "Simple Print": test_code_simple_print,
        "U2 Info": test_code_u2_info,
        "Multi-Line": test_code_multi_line,
        "Evaluation": test_code_eval,
        "Error Case": test_code_error,
        "Shell Command": test_code_shell,
    }

    for name, code in tests.items():
        print(f"\n--- Running Test: {name} ---")
        print(f"Code:\n{code}\n---")
        output = execute_interactive_code(code, test_device, enable_tracing=True)
        print("Captured Output:\n" + output)
        print(f"--- End Test: {name} ---")

    # Test without tracing
    print(f"\n--- Running Test (No Tracing): Simple Print ---")
    output_no_trace = execute_interactive_code(
        test_code_simple_print, test_device, enable_tracing=False
    )
    print("Captured Output (No Tracing):\n" + output_no_trace)
    print(f"--- End Test (No Tracing) ---")
