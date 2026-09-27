"""`.env.example` lists every environment variable the backend reads (audit M36)."""

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
READS = re.compile(r"""os\.environ(?:\.get)?[\[(]["']([A-Z0-9_]+)["']""")


def test_env_example_lists_every_variable_the_code_reads():
    read = set()
    for folder in ("config", "apps"):
        for path in (ROOT / folder).rglob("*.py"):
            read |= set(READS.findall(path.read_text()))
    listed = set(re.findall(r"^([A-Z0-9_]+)=", (ROOT / ".env.example").read_text(), re.MULTILINE))
    assert read, "the scan found nothing: has the layout moved?"
    assert not read - listed, f"missing from .env.example: {sorted(read - listed)}"
