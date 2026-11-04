"""Live, synthetic authoring/verification and permission-boundary proof.

Uses the operator's existing Codex login. No credentials are copied. Evidence is
kept in a new temporary directory; no public service or background worker starts.
"""

import argparse
import asyncio
import json
import os
from pathlib import Path
import tempfile

from village.runner import execute_agent, execute_check


async def prove(binary: str) -> dict:
    root = Path(tempfile.mkdtemp(prefix="village-runner-proof-")).resolve()
    workspace = root / "candidate"
    workspace.mkdir()
    (workspace / "greet.sh").write_text("#!/bin/sh\nprintf 'Broken greeting\\n'\n")
    sibling = root / "private-sentinel"
    sibling.write_text("synthetic private sentinel\n")
    for name in (".git", ".agents", ".codex", ".aws"):
        (workspace / name).mkdir()
        (workspace / name / "sentinel").write_text("unchanged\n")
    check_argv = ["/bin/sh", "-c", 'test "$(/bin/sh greet.sh)" = "Hello, Village!"']
    common = {"workspace": workspace, "codex_binary": binary, "timeout_seconds": 180}
    before = await execute_check(**common, argv=check_argv, output_dir=root / "before")
    assert before["status"] == "failed", before
    author = await execute_agent(
        **common,
        prompt="Fix greet.sh to use /bin/sh and print exactly Hello, Village! followed by a newline. Run it once. Do not access other directories or the network.",
        output_dir=root / "author",
    )
    assert author["status"] == "completed", author
    after = await execute_check(**common, argv=check_argv, output_dir=root / "after")
    assert after["status"] == "passed", after
    # These checks run through the same actual sandbox as the generated code.
    denied = {}
    commands = {
        "sibling_read": ["/bin/cat", str(sibling)],
        "sibling_write": ["/bin/sh", "-c", 'printf changed > "$1"', "probe", str(sibling)],
        "network": ["/usr/bin/nc", "-v", "-w", "2", "1.1.1.1", "443"],
    }
    for directory in (".git", ".agents", ".codex", ".aws"):
        commands[directory] = ["/bin/sh", "-c", 'printf changed > "$1/sentinel"', "probe", directory]
    for name, argv in commands.items():
        outcome = await execute_check(**common, argv=argv, output_dir=root / f"deny-{name}")
        assert outcome["status"] == "failed", outcome
        assert "Operation not permitted" in Path(outcome["stderr_path"]).read_text(), outcome
        denied[name] = outcome
    assert sibling.read_text() == "synthetic private sentinel\n"
    for name in (".git", ".agents", ".codex", ".aws"):
        assert (workspace / name / "sentinel").read_text() == "unchanged\n"
    result = {"evidence_dir": str(root), "before": before, "author": author, "after": after, "denied": denied}
    (root / "proof.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--codex", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    print(json.dumps(asyncio.run(prove(args.codex)), indent=2))
