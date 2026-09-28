"""The Render blueprint (render.yaml at the repo root) sets up every variable the backend
reads, so a new setting can't be forgotten at deploy time, and keeps everything in one
region (docs/EXPO_MIGRATION.md: Render, Virginia). During the free test run it also serves
the web app as a static site (docs/plans/S8B_TEST_RUN.md)."""

import pathlib
import re

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[2]
BLUEPRINT = (ROOT.parent / "render.yaml").read_text()
SPEC = yaml.safe_load(BLUEPRINT)
HEADERS_FILE = ROOT.parent / "app" / "public" / "_headers"
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


def service(name):
    return next(s for s in SPEC["services"] if s["name"] == name)


def test_everything_runs_in_virginia():
    # Static sites are served from Render's CDN and take no region; everything else does.
    # The free test run has no cron service: GitHub Actions calls /api/v1/ops/cron instead.
    # Going public adds it back.
    placed = [s for s in SPEC["services"] if s.get("runtime") != "static"] + SPEC["databases"]
    assert [s["name"] for s in placed] == ["gymtrainer", "gymtrainer-db"]
    assert {s["region"] for s in placed} == {"virginia"}


def test_the_free_web_service_migrates_at_start():
    # Free services have no pre-deploy step, so migrations run before gunicorn starts.
    web = service("gymtrainer")
    assert web["plan"] == "free" and "preDeployCommand" not in web
    assert "manage.py migrate --noinput && python manage.py ensure_admin && gunicorn" in web["startCommand"]
    # The hourly jobs run inside one request (/api/v1/ops/cron): gunicorn's default 30 seconds
    # would kill the worker partway through a slow digest run.
    assert "--timeout 120" in web["startCommand"]


def headers_file():
    """(path, name, value) for each header in app/public/_headers (Cloudflare Pages' format)."""
    rules, path = [], None
    for line in HEADERS_FILE.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line[0].isspace():
            path = line.strip()
        else:
            name, _, value = line.strip().partition(":")
            rules.append((path, name.strip(), value.strip()))
    return rules


def test_the_web_app_is_a_static_site_with_the_same_headers_as_cloudflare():
    site = next(s for s in SPEC["services"] if s.get("runtime") == "static")
    # The API's address is built into the app, so the build checks it first (app/scripts).
    assert "node scripts/check-api-url.mjs && npx expo export --platform web" in site["buildCommand"]
    assert site["staticPublishPath"] == "app/dist"
    # The local database needs cross-origin isolation, so every header in app/public/_headers
    # must be served here too.
    served = {(h["path"], h["name"]): h["value"] for h in site["headers"]}
    assert headers_file() and all(served.get((path, name)) == value for path, name, value in headers_file())
    # One page app: any path without a file is the app's router's to handle.
    assert {"type": "rewrite", "source": "/*", "destination": "/index.html"} in site["routes"]
    env = {e["key"]: e for e in site["envVars"]}
    # Set here, not typed into the dashboard: a pasted-over value shipped a broken first build.
    # Render's fromService only gives the private hostname, so the public address is written out.
    assert re.fullmatch(r"https://[a-z0-9-]+(\.[a-z0-9-]+)+", env["EXPO_PUBLIC_API_URL"]["value"])
    assert env["EXPO_PUBLIC_WEB_REMEMBER_SIGN_IN"]["value"] == "1"
