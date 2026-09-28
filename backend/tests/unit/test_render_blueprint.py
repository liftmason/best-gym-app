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
    # The API and Postgres. The free test run has no cron service: GitHub Actions calls
    # /api/v1/ops/cron instead (docs/plans/S8B_TEST_RUN.md). Going public adds it back.
    assert (services, databases) == (1, 1)
    assert BLUEPRINT.count("region: virginia") == services + databases


def test_the_free_web_service_migrates_at_start():
    # Free services have no pre-deploy step, so migrations run before gunicorn starts.
    web = BLUEPRINT.split("  - type: web")[1].split("\n  - type: ")[0]
    assert "plan: free" in web and "preDeployCommand" not in web
    assert "manage.py migrate --noinput && python manage.py ensure_admin && gunicorn" in web
    # The hourly jobs run inside one request (/api/v1/ops/cron): gunicorn's default 30 seconds
    # would kill the worker partway through a slow digest run.
    assert "--timeout 120" in web
