"""Live, synthetic authoring/verification and permission-boundary proof.

Uses the operator's existing Codex login. No credentials are copied. Evidence is
kept in a new temporary directory; no public service or background worker starts.
"""

import argparse
import asyncio
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile

from village.runner import execute_agent, execute_check


CHECK_ARGV = [
    "/bin/bash", "-o", "pipefail", "-c",
    "/bin/sh greet.sh | /usr/bin/cmp -s - <(printf 'Hello, Village!\\n')",
]


async def prove(binary: str, model: str) -> dict:
    root = Path(tempfile.mkdtemp(prefix="village-runner-proof-")).resolve()
    workspace = root / "candidate"
    workspace.mkdir()
    (workspace / "greet.sh").write_text("#!/bin/sh\nprintf 'Broken greeting\\n'\n")
    sibling = root / "private-sentinel"
    sentinels = {sibling: "synthetic private sentinel\n"}
    for name in (".git", ".agents", ".codex", ".aws"):
        (workspace / name).mkdir()
        sentinels[workspace / name / "sentinel"] = "unchanged\n"
    for path, contents in sentinels.items():
        path.write_text(contents)
    common = {"workspace": workspace, "codex_binary": binary, "timeout_seconds": 180}
    before = await execute_check(**common, argv=CHECK_ARGV, output_dir=root / "before")
    assert before["status"] == "failed", before
    author = await execute_agent(
        **common,
        model=model,
        prompt="Fix greet.sh to use /bin/sh and print exactly Hello, Village! followed by a newline. Run it once. Do not access other directories or the network.",
        output_dir=root / "author",
    )
    assert author["status"] == "completed", author
    after = await execute_check(**common, argv=CHECK_ARGV, output_dir=root / "after")
    assert after["status"] == "passed", after
    # These checks run through the same actual sandbox as the generated code.
    denied = {}
    commands = {
        "sibling_read": ["/bin/cat", str(sibling)],
        "sibling_write": ["/bin/sh", "-c", 'printf changed > "$1"', "probe", str(sibling)],
    }
    for directory in (".git", ".agents", ".codex", ".aws"):
        commands[directory] = ["/bin/sh", "-c", 'printf changed > "$1/sentinel"', "probe", directory]
    for name, argv in commands.items():
        control = subprocess.run(argv, cwd=workspace, capture_output=True, timeout=5)
        assert control.returncode == 0, control.stderr
        for path, contents in sentinels.items():
            path.write_text(contents)
        outcome = await execute_check(**common, argv=argv, output_dir=root / f"deny-{name}")
        assert outcome["status"] == "failed", outcome
        for path, contents in sentinels.items():
            assert path.read_text() == contents, path
        denied[name] = outcome
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        argv = ["/bin/bash", "-c", 'exec 3<>/dev/tcp/127.0.0.1/$1', "probe", str(listener.getsockname()[1])]
        control = subprocess.run(argv, capture_output=True, timeout=5)
        assert control.returncode == 0, control.stderr
        outcome = await execute_check(**common, argv=argv, output_dir=root / "deny-network")
        assert outcome["status"] == "failed", outcome
        denied["network"] = outcome
    result = {"evidence_dir": str(root), "requested_model": model, "before": before, "author": author, "after": after, "denied": denied}
    (root / "proof.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--codex", required=True)
    parser.add_argument("--model", default="gpt-6.1-sol")
    args = parser.parse_args()
    os.umask(0o077)
    print(json.dumps(asyncio.run(prove(args.codex, args.model)), indent=2))
