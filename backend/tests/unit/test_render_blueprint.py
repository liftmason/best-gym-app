"""The Render blueprint (render.yaml at the repo root) sets up every variable the backend
reads, so a new setting can't be forgotten at deploy time, and keeps everything in one
region (docs/EXPO_MIGRATION.md: Render, Virginia)."""

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
BLUEPRINT = (ROOT.parent / "render.yaml").read_text()
READS = re.compile(r"""os\.environ(?:\.get)?[\[(]["']([A-Z0-9_]+)["']""")
NOT_SET = {
    "RENDER_EXTERNAL_HOSTNAME": "Render sets it",
    "RENDER_EXTERNAL_URL": "Render sets it",
    "DEMO_PASSWORD": "only for seed_demo on a public demo site, never at launch",
}


def test_the_blueprint_sets_every_variable_the_backend_reads():
    read = set()
    for folder in ("config", "apps"):
        for path in (ROOT / folder).rglob("*.py"):
            read |= set(READS.findall(path.read_text()))
    listed = set(re.findall(r"key: ([A-Z0-9_]+)", BLUEPRINT))
    assert read, "the scan found nothing: has the layout moved?"
    missing = read - listed - set(NOT_SET)
    assert not missing, f"missing from render.yaml: {sorted(missing)}"


def test_everything_runs_in_virginia():
    services = len(re.findall(r"^  - type: ", BLUEPRINT, re.MULTILINE))
    databases = len(re.findall(r"^  - name: ", BLUEPRINT.split("\ndatabases:")[1], re.MULTILINE))
    assert (services, databases) == (2, 1)  # the API and the cron job; Postgres
    assert BLUEPRINT.count("region: virginia") == services + databases
