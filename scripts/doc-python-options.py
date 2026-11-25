"""Read argument declarations without importing a documented program."""
import ast
import json
import sys


def options(source):
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Compare) and any(
            ast.unparse(value) == "sys.argv" for value in node.comparators
        ):
            if isinstance(node.left, ast.Constant) and isinstance(node.left.value, str):
                if node.left.value.startswith("--"):
                    yield node.left.value[2:], "switch"
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        if node.func.attr != "add_argument":
            continue
        help_text = next(
            (kw.value.value for kw in node.keywords
             if kw.arg == "help" and isinstance(kw.value, ast.Constant)), ""
        )
        for arg in node.args:
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str) and arg.value.startswith("--"):
                yield arg.value[2:], help_text


print(json.dumps(list(options(sys.stdin.read()))))
