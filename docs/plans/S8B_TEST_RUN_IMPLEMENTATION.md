# S8b test run: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the backend deployable on Render's free tier for the web test run: a free blueprint, the hourly jobs triggered over HTTP from a scheduled GitHub Actions workflow, and the owner's runbook rewritten to match.

**Architecture:** The hourly job's steps move out of the `cron` management command into one function (`apps/dashboard/jobs.py: run_hourly`). The command and a new token-protected endpoint (`POST /api/v1/ops/cron`) both call it. `render.yaml` switches to free plans with no cron service, and `.github/workflows/cron.yml` calls the endpoint every hour. Going public reverses the blueprint changes. The endpoint stays, off while `CRON_TOKEN` is unset.

**Tech Stack:** Django 5.2 and Django Ninja (`backend/`), pytest with pytest-django, Render Blueprint YAML, GitHub Actions.

**Spec:** `docs/plans/S8B_TEST_RUN.md` (read it first: sections 2, 3 and 5 are what this implements).

## Global Constraints

- Branch `s8b-test-run` (built on `docs/web-first-launch`, PR #18). One PR.
- Run backend commands from the repo root with `make test`, `make lint`, `make check`, or from `backend/` with `.venv/bin/python -m pytest …`. Ruff line length 110.
- Endpoints hold no rules: they parse, call a service, and shape the answer (`backend/apps/api/main.py` docstring).
- Every variable the backend reads must be listed in `render.yaml` (`backend/tests/unit/test_render_blueprint.py` enforces it).
- Everything in `render.yaml` stays in `region: virginia`.
- The endpoint answers **404** when `CRON_TOKEN` is unset, or when the token is missing or wrong. It compares in constant time and is `include_in_schema=False`, so `backend/openapi.json` and `app/src/api/schema.d.ts` don't change.
- On success it answers 200 with the counts. If any step failed, it answers 500 **after running every step**.
- Comments explain why, in plain sentences; docstrings are short. Match the surrounding code.
- Test first for every behaviour change.

## Review Focus

1. **An empty token must never match.** With `CRON_TOKEN=""` and a request sending `Authorization: Bearer ` (empty), `hmac.compare_digest("", "")` is True. The endpoint must answer 404. (Test in Task 2.)
2. **A user's sign-in token isn't a cron token.** A coach's valid access token in the `Authorization` header must get 404, because the endpoint is `auth=None` and checks only `CRON_TOKEN`. (Test in Task 2.)
3. **A token pasted with a trailing newline or spaces** into Render's dashboard must still work. The setting is stripped when read. (Test in Task 2.)
4. **A step failing mid-run:** the other steps and every other coach's digest still run, and the HTTP answer is 500 with the failed step's name. (Test in Task 2.)
5. **Two runs overlapping:** a curl retry after a cold-start timeout while the first run is still going. The workflow uses a `concurrency` group so scheduled runs never overlap. The steps are safe to repeat: the digest skips coaches who already had today's, and video expiry is idempotent. (Covered in Task 4's workflow and in the existing digest tests.)

---

### Task 1: One function for the hourly steps

**Files:**
- Create: `backend/apps/dashboard/jobs.py`
- Modify: `backend/apps/dashboard/management/commands/cron.py` (whole file)
- Test: `backend/tests/unit/test_jobs.py` (add below `test_cron_command_runs_everything`)

**Interfaces:**
- Produces: `apps.dashboard.jobs.run_hourly(stdout) -> Hourly`, where `stdout` is a text stream passed to `call_command("nightly", stdout=...)`, and `Hourly` is a dataclass with `expired: int`, `abandoned: int`, `sent: int`, `failures: list[str]`, and a `summary()` method returning `"cron: {expired} video(s) expired, {abandoned} unfinished upload(s) removed, {sent} digest(s) sent"`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/unit/test_jobs.py`:

```python
def test_run_hourly_reports_what_it_did_and_what_failed(coach, athlete, monkeypatch):
    import io

    from apps.dashboard import jobs

    result = jobs.run_hourly(io.StringIO())
    assert result.failures == [] and result.sent >= 0
    assert result.summary().startswith("cron: ")

    def broken(coach):
        raise ConnectionError("email provider down")

    monkeypatch.setattr(digest, "send", broken)
    result = jobs.run_hourly(io.StringIO())
    assert result.failures == [f"digest for coach {coach.pk}"]
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd backend && .venv/bin/python -m pytest tests/unit/test_jobs.py -k run_hourly -v`
Expected: FAIL with `ImportError: cannot import name 'jobs'`.

- [ ] **Step 3: Write `backend/apps/dashboard/jobs.py`**

```python
"""The hourly jobs, run by `manage.py cron` (Render's cron job, once paid) and by
POST /api/v1/ops/cron (the free test run's GitHub Actions schedule; docs/plans/S8B_TEST_RUN.md).

Every run: bring every coach's attention feed up to date (`nightly`), delete form videos
past their keep period, delete expired rate-limit counters and old sync changes, and send
the morning digest to coaches whose gym is past 7am and haven't had today's.

Each step, and each coach's digest, runs on its own: a failure is logged (and reported to
Sentry when it's set up) and the rest still run (audit H10). The caller reports the failures.
"""

import dataclasses
import logging

from django.core.management import call_command

from apps import ratelimit
from apps.accounts.models import Coach
from apps.dashboard import digest
from apps.sync import purge as sync_purge
from apps.workouts import videos

logger = logging.getLogger(__name__)


@dataclasses.dataclass
class Hourly:
    expired: int = 0
    abandoned: int = 0
    sent: int = 0
    failures: list[str] = dataclasses.field(default_factory=list)

    def summary(self):
        return (
            f"cron: {self.expired} video(s) expired, {self.abandoned} unfinished upload(s) removed, "
            f"{self.sent} digest(s) sent"
        )


def run_hourly(stdout):
    result = Hourly()

    def step(name, fn):
        try:
            return fn()
        except Exception:
            logger.exception("cron: %s failed", name)
            result.failures.append(name)
            return None

    step("alerts", lambda: call_command("nightly", stdout=stdout))
    result.expired, result.abandoned = step("form videos", videos.expire) or (0, 0)
    step("rate-limit counters", ratelimit.purge)
    step("sync change log", sync_purge.purge)
    for coach in Coach.objects.select_related("user"):
        if step(f"digest for coach {coach.pk}", lambda coach=coach: digest.send(coach)):
            result.sent += 1
    return result
```

- [ ] **Step 4: Make the command call it**

Replace `backend/apps/dashboard/management/commands/cron.py` with:

```python
"""The hourly jobs (apps/dashboard/jobs.py), as a command for Render's cron job. It exits
with an error when a step failed, after running the rest, so the failed run shows in Render
(audit H10)."""

from django.core.management.base import BaseCommand, CommandError

from apps.dashboard import jobs


class Command(BaseCommand):
    help = "Hourly jobs: alerts, form-video clean-up, rate-limit counters, morning digests."

    def handle(self, *args, **options):
        result = jobs.run_hourly(self.stdout)
        self.stdout.write(result.summary())
        if result.failures:
            raise CommandError(f"cron: {len(result.failures)} failed: {', '.join(result.failures)}")
```

- [ ] **Step 5: Check that the existing tests still patch the right place**

The existing test that makes one coach's digest fail patches `digest.send` on the `apps.dashboard.digest` module. `jobs.py` looks up `digest.send` at call time, so it still works.

Run: `cd backend && .venv/bin/python -m pytest tests/unit/test_jobs.py -v`
Expected: all PASS, including `test_cron_command_runs_everything` and the new test.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/dashboard/jobs.py backend/apps/dashboard/management/commands/cron.py backend/tests/unit/test_jobs.py
git commit -m "The hourly steps in one function, for the cron command and the endpoint to come"
```

---

### Task 2: The cron endpoint and `CRON_TOKEN`

**Files:**
- Create: `backend/apps/dashboard/ops_api.py`
- Modify: `backend/apps/api/main.py` (the router imports and `add_router` calls, around lines 120–154)
- Modify: `backend/config/settings/base.py` (after the billing block, around line 170)
- Modify: `render.yaml` (the web service's `envVars`, next to `LOG_CLIENT_IP`)
- Test: `backend/tests/unit/test_ops_cron.py`

**Interfaces:**
- Consumes: `apps.dashboard.jobs.run_hourly(stdout) -> Hourly` (Task 1); `apps.core.errors.NotFound`.
- Produces: `POST /api/v1/ops/cron`, answering 200 `{"expired": int, "abandoned": int, "digests": int, "failed": []}` or 500 with the same shape and `failed` listing step names. The setting is `settings.CRON_TOKEN: str` (stripped, `""` when unset).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/test_ops_cron.py`:

```python
"""POST /api/v1/ops/cron: the hourly jobs for hosts without a cron service (the free test
run, docs/plans/S8B_TEST_RUN.md). It hides behind 404 unless CRON_TOKEN matches."""

import pytest
from django.test import Client

from apps.dashboard import digest

pytestmark = pytest.mark.django_db

URL = "/api/v1/ops/cron"
TOKEN = "a-long-random-cron-token-for-tests"


def call(header=None):
    extra = {"HTTP_AUTHORIZATION": header} if header is not None else {}
    return Client().post(URL, **extra)


@pytest.fixture
def cron_on(settings):
    settings.CRON_TOKEN = TOKEN


def test_off_without_a_token_configured(settings):
    settings.CRON_TOKEN = ""
    assert call(f"Bearer {TOKEN}").status_code == 404
    assert call("Bearer ").status_code == 404  # an empty token never matches an empty setting
    assert call().status_code == 404


def test_a_missing_or_wrong_token_is_not_found(cron_on):
    assert call().status_code == 404
    assert call("Bearer wrong").status_code == 404
    assert call(TOKEN).status_code == 404  # no scheme


def test_a_sign_in_token_is_not_a_cron_token(cron_on, coach):
    from apps.signin import services

    access = services.open_session(coach.user).access
    assert call(f"Bearer {access}").status_code == 404


def test_the_right_token_runs_the_jobs(cron_on, coach, athlete):
    answer = call(f"Bearer {TOKEN}")
    assert answer.status_code == 200
    body = answer.json()
    assert body["failed"] == [] and {"expired", "abandoned", "digests"} <= body.keys()


def test_a_failed_step_is_a_500_after_the_rest_ran(cron_on, coach, athlete, monkeypatch):
    def broken(coach):
        raise ConnectionError("email provider down")

    monkeypatch.setattr(digest, "send", broken)
    answer = call(f"Bearer {TOKEN}")
    assert answer.status_code == 500
    assert answer.json()["failed"] == [f"digest for coach {coach.pk}"]


def test_the_setting_ignores_spaces_pasted_around_the_token(monkeypatch):
    import importlib

    from config.settings import base

    monkeypatch.setenv("CRON_TOKEN", f"  {TOKEN}\n")
    assert importlib.reload(base).CRON_TOKEN == TOKEN
    monkeypatch.delenv("CRON_TOKEN")
    importlib.reload(base)
```

(`services.open_session(user)` returns `Tokens(session, access, refresh)`, and `backend/tests/unit/test_api.py` uses it the same way.)

- [ ] **Step 2: Run them to see them fail**

Run: `cd backend && .venv/bin/python -m pytest tests/unit/test_ops_cron.py -v`
Expected: the token tests FAIL. There's no such URL yet, and Django answers 404 for every case, so `test_the_right_token_runs_the_jobs` and the 500 test fail while the 404 tests may already pass. `test_the_setting_ignores_spaces…` fails with `AttributeError: module 'config.settings.base' has no attribute 'CRON_TOKEN'`.

- [ ] **Step 3: Add the setting**

In `backend/config/settings/base.py`, after the billing block (`STRIPE_WEBHOOK_SECRET = …`):

```python

# The hourly jobs over HTTP (POST /api/v1/ops/cron), for hosts with no cron service: the
# free test run calls it from GitHub Actions (docs/plans/S8B_TEST_RUN.md). Blank turns the
# endpoint off; once Render's cron job runs `manage.py cron`, leave it blank.
CRON_TOKEN = os.environ.get("CRON_TOKEN", "").strip()
```

- [ ] **Step 4: Write the endpoint**

Create `backend/apps/dashboard/ops_api.py`:

```python
"""POST /api/v1/ops/cron: the hourly jobs (jobs.py) for hosts with no cron service, called
by .github/workflows/cron.yml with CRON_TOKEN. Anything else gets the same 404 as a URL that
doesn't exist, so the endpoint doesn't reveal that it's there."""

import hmac
import io

from django.conf import settings
from ninja import Router, Schema, Status

from apps.core import errors

from . import jobs

router = Router(tags=["Operations"])


class HourlyOut(Schema):
    expired: int
    abandoned: int
    digests: int
    failed: list[str]


def _allowed(request):
    expected = settings.CRON_TOKEN
    scheme, _, given = request.headers.get("Authorization", "").partition(" ")
    # An empty setting must never match an empty token.
    return bool(expected) and scheme.lower() == "bearer" and hmac.compare_digest(given, expected)


@router.post("/ops/cron", auth=None, response={200: HourlyOut, 500: HourlyOut}, include_in_schema=False)
def cron(request):
    if not _allowed(request):
        raise errors.NotFound()
    result = jobs.run_hourly(io.StringIO())
    body = {
        "expired": result.expired,
        "abandoned": result.abandoned,
        "digests": result.sent,
        "failed": result.failures,
    }
    return Status(500 if result.failures else 200, body)
```

- [ ] **Step 5: Register the router**

In `backend/apps/api/main.py`, add the import next to the other dashboard routers (keep the alphabetical order of the import block):

```python
    from apps.dashboard.ops_api import router as ops
```

and after `api.add_router("", sync)`:

```python
    api.add_router("", ops)
```

- [ ] **Step 6: List the setting in the blueprint**

Run `cd backend && .venv/bin/python -m pytest tests/unit/test_render_blueprint.py -v`. Expected: FAIL, `missing from render.yaml: ['CRON_TOKEN']`.

In `render.yaml`, in the **web service's** `envVars`, just after the `LOG_CLIENT_IP` entry, add:

```yaml
      # The free test run's hourly jobs: a long random value, the same as the GitHub
      # repository secret CRON_TOKEN (.github/workflows/cron.yml). Blank once the cron job runs.
      - key: CRON_TOKEN
        sync: false
```

- [ ] **Step 7: Run the tests**

Run: `cd backend && .venv/bin/python -m pytest tests/unit/test_ops_cron.py tests/unit/test_render_blueprint.py tests/unit/test_jobs.py -v`
Expected: all PASS.

- [ ] **Step 8: Check the API schema didn't change**

`manage.py openapi` writes `backend/openapi.json` itself, and `tests/unit/test_api.py` fails when the file is stale.
Run: `cd backend && .venv/bin/python manage.py openapi && git diff --exit-code openapi.json`
Expected: exit 0, no difference.

- [ ] **Step 9: Commit**

```bash
git add backend/apps/dashboard/ops_api.py backend/apps/api/main.py backend/config/settings/base.py render.yaml backend/tests/unit/test_ops_cron.py
git commit -m "POST /ops/cron: the hourly jobs over HTTP, behind CRON_TOKEN"
```

---

### Task 3: The blueprint on free plans

**Files:**
- Modify: `render.yaml` (header comment lines 1–6; the web service; the cron service at about lines 112–150; the database)
- Test: `backend/tests/unit/test_render_blueprint.py` (`test_everything_runs_in_virginia`)

**Interfaces:**
- Consumes: `CRON_TOKEN` in the web service's env (Task 2).
- Produces: a blueprint with one web service (`gymtrainer`, `plan: free`) and one database (`gymtrainer-db`, `plan: free`).

- [ ] **Step 1: Update the test first**

In `backend/tests/unit/test_render_blueprint.py`, replace the last test with:

```python
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd backend && .venv/bin/python -m pytest tests/unit/test_render_blueprint.py -v`
Expected: FAIL. `(2, 1) != (1, 1)`, and `plan: free` is not in the web service.

- [ ] **Step 3: Edit `render.yaml`**

1. Replace the header comment (lines 1–6) with:

```yaml
# Render blueprint (docs/LAUNCH.md, "The backend (Render)"): the API and Postgres, in
# Virginia (docs/EXPO_MIGRATION.md, decision log). Nothing deploys until the owner
# connects this repository as a Blueprint in their Render account.
#
# The free test run (docs/plans/S8B_TEST_RUN.md). Going public reverses these, in one commit:
# - the web service is `plan: free`: migrations run in the start command (free services have
#   no pre-deploy step), with 2 workers for 512 MB. Paid: `plan: starter`, `preDeployCommand:
#   python manage.py migrate --noinput && python manage.py ensure_admin`, 3 workers;
# - the database is `plan: free`, deleted 30 days after it's created unless upgraded.
#   Paid: `plan: basic-256mb` (upgrading keeps the data);
# - there's no cron service (Render has none free): .github/workflows/cron.yml calls
#   /api/v1/ops/cron hourly with CRON_TOKEN. Paid: the `gymtrainer-cron` service (git history,
#   docs/plans/S8B_TEST_RUN.md section 5) and CRON_TOKEN removed.
# Every variable the backend reads is listed here (backend/tests/unit/test_render_blueprint.py).
```

2. In the web service: change `plan: starter` to `plan: free`, delete the `preDeployCommand:` line, and set:

```yaml
    startCommand: python manage.py migrate --noinput && python manage.py ensure_admin && gunicorn config.wsgi:application --workers 2 --access-logfile -
```

3. Delete the whole `gymtrainer-cron` service block. It starts at the comment `# Hourly: alerts, form-video clean-up, …` and runs up to, but not including, `databases:`. Don't delete the `envVarGroups` entries it shared; the web service still uses them.

4. In `databases:`, change `plan: basic-256mb` to `plan: free`.

5. Check whether the shared env group's comments mention "both services" or "the cron job" and would now be wrong: `grep -n "cron" render.yaml`. Reword any that are. The shared group is kept so the paid setup's cron service can use it again.

- [ ] **Step 4: Run the tests**

Run: `cd backend && .venv/bin/python -m pytest tests/unit/test_render_blueprint.py -v`
Expected: all PASS, including `test_the_blueprint_sets_every_variable_the_backend_reads`.

- [ ] **Step 5: Check the YAML parses**

Run: `python3 -c "import yaml,sys; d=yaml.safe_load(open('render.yaml')); print([s['name'] for s in d['services']], [x['name'] for x in d['databases']])"`
Expected: `['gymtrainer'] ['gymtrainer-db']`. If PyYAML isn't installed, use `backend/.venv/bin/python`, which has it if Django's dependencies pulled it in; otherwise `uvx --from pyyaml python -c …`.

- [ ] **Step 6: Commit**

```bash
git add render.yaml backend/tests/unit/test_render_blueprint.py
git commit -m "The blueprint on free plans for the test run; going public reverses it"
```

---

### Task 4: The hourly workflow

**Files:**
- Create: `.github/workflows/cron.yml`

**Interfaces:**
- Consumes: `POST /api/v1/ops/cron` with `Authorization: Bearer <CRON_TOKEN>` (Task 2); the repository secret `CRON_TOKEN`; the optional repository variable `API_URL` (default `https://api.liftmason.com`).

- [ ] **Step 1: Write the workflow**

```yaml
# The hourly jobs for the free test run (docs/plans/S8B_TEST_RUN.md): Render has no free
# cron jobs, so GitHub calls the API's /api/v1/ops/cron every hour. It does nothing until
# the repository secret CRON_TOKEN is set, and should be emptied when the paid setup's cron
# service takes over. GitHub may start scheduled runs late (alerts and the "after 7am"
# digest allow for it) and turns schedules off after 60 days with no repository activity.
name: Hourly jobs

on:
  schedule:
    - cron: "0 * * * *"
  workflow_dispatch:

permissions: {}

# Never two runs at once: a slow cold start mustn't overlap the next hour's run.
concurrency:
  group: hourly-jobs
  cancel-in-progress: false

jobs:
  cron:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Run the hourly jobs on the API
        env:
          CRON_TOKEN: ${{ secrets.CRON_TOKEN }}
          API_URL: ${{ vars.API_URL || 'https://api.liftmason.com' }}
        run: |
          if [ -z "$CRON_TOKEN" ]; then
            echo "CRON_TOKEN isn't set: nothing to do."
            exit 0
          fi
          # A free service asleep takes about a minute to wake, hence the long timeout.
          # The answer holds only counts and step names, so it's safe in public logs.
          curl --fail-with-body --silent --show-error --max-time 240 --retry 2 --retry-delay 30 \
            -X POST -H "Authorization: Bearer $CRON_TOKEN" "$API_URL/api/v1/ops/cron"
```

- [ ] **Step 2: Lint it**

Run: `uvx --from actionlint-py actionlint .github/workflows/cron.yml`. If that isn't available, try `brew list actionlint && actionlint .github/workflows/cron.yml`.
Expected: no output (clean). If neither tool is available, parse it: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/cron.yml'))"`, and note in the PR that actionlint wasn't run.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/cron.yml
git commit -m "The hourly jobs from GitHub Actions for the free test run"
```

---

### Task 5: The runbook and the docs

**Files:**
- Modify: `docs/LAUNCH.md` (Part 1 and the costs table; add "Upgrading to paid")
- Modify: `docs/OPERATIONS.md` ("Services (`render.yaml`)" around line 30 and "The cron job" around line 101)
- Modify: `docs/EXPO_MIGRATION.md` ("Decided at launch" table; the Handoff's 8b row)

- [ ] **Step 1: `docs/LAUNCH.md`**

Rewrite Part 1 to follow `docs/plans/S8B_TEST_RUN.md` section 3, steps 1–10, in that order. Keep the existing wording and tables for steps whose content hasn't changed: Resend's DNS and DMARC, R2, the Render settings table, and Cloudflare Pages. Specifically:
- **The intro:** Part 1 is a free test run in the owner's name, and going public is an upgrade (link the plan).
- **Section 0, the costs table:** Part 1 costs the domain only. Render moves to "free during testing; about $14 a month when going public". Add rows for Render Pro ($25 a month) and Sentry Team ($26 a month), marked "only if Steven needs his own login".
- **New step 1, "GitHub":** create the `liftmason` organization, transfer the repo, make Steven an owner, and `git remote set-url origin git@github.com:liftmason/best-gym-app.git`. Change `spearw/best-gym-app` to `liftmason/best-gym-app` in the Render step.
- **Accounts:** sign up with `ops@liftmason.com`, except Cloudflare. Add Cloudflare Email Routing (`ops@` to the owner's Gmail, with a copy to Steven). Two-factor sign-in everywhere. Domain auto-renew on. Steven's access per service, from the table in plan section 1.
- **Render:** "on the day testing starts" (the free database's 30 days). Add `CRON_TOKEN` (generate with `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`) to the settings table. `storage_setup` runs from a laptop with the four `STORAGE_*` settings exported, or the owner sets the CORS rule in R2's dashboard. Remove the Render-shell instructions: free services have no shell.
- **New step, "The hourly job":** add the repository secret `CRON_TOKEN` (GitHub → the repo → Settings → Secrets and variables → Actions). Then Actions → "Hourly jobs" → Run workflow. **Check:** the run is green, and Render's log shows the `ensure_admin`/gunicorn start and a request to `/api/v1/ops/cron` with status 200.
- **"What the web app can't do yet":** add the first-visit wake-up (about a minute after 15 minutes of quiet).
- **"After the first deploy":** the backup drill moves to "Upgrading to paid" (the free database has no backups). Add the day-25 diary note.
- **New section after Part 1, "Upgrading to paid (going public)":** plan section 5, steps 1–6, as the owner's steps.
- **Checklist:** Part 1's list follows the new steps; add an "Upgrading" list.

- [ ] **Step 2: `docs/OPERATIONS.md`**

- **"Services (`render.yaml`)":** say the file describes the free test run (one web service and a free database). The paid setup adds `gymtrainer-cron` (link `docs/plans/S8B_TEST_RUN.md` section 5). Keep the table, add a "Test run" column or note, and remove the stale paragraph about deleting `gymtrainer-nightly`.
- **"The cron job":** the steps are in `apps/dashboard/jobs.py`. They run either as `manage.py cron` (Render's cron job, paid), or through `POST /api/v1/ops/cron` from `.github/workflows/cron.yml` (the free test run, with `CRON_TOKEN` on both sides). A failed run shows as a failed command in Render, or a red workflow run in GitHub (500). Add: "rate-limit counters and old sync changes are cleaned up too", which the current list omits.

- [ ] **Step 3: `docs/EXPO_MIGRATION.md`**

Add a row to the "Decided at launch" table:

```markdown
| Hosting for the test run (owner, 28 September 2026) | **Free tiers in the owner's name** (`docs/plans/S8B_TEST_RUN.md`): Render's free web service and database, the hourly jobs from GitHub Actions, the repo in a `liftmason` GitHub organization with Steven as an owner. Going public upgrades Render in place (about $14 a month); a business owning the accounts is decided before opening Apple or Google. | **Paid hosting from the start:** about $14–65 a month (Render Pro and Sentry Team for a second login) while the product is still changing. **A business entity now:** not decided yet, and only Apple and Google are hard to move later. |
```

In the Handoff table, change the 8b row's plan cell to `` `docs/plans/S8B_TEST_RUN.md`, `docs/LAUNCH.md` ``.

- [ ] **Step 4: Check the docs agree with the code**

Run: `grep -n "preDeployCommand\|gymtrainer-cron\|Render → .*Shell\|spearw/best-gym-app" docs/LAUNCH.md docs/OPERATIONS.md`
Expected: matches only in the "Upgrading to paid" section or where the paid setup is described as such.

- [ ] **Step 5: Commit**

```bash
git add docs/LAUNCH.md docs/OPERATIONS.md docs/EXPO_MIGRATION.md
git commit -m "Runbook: the free test run in the owner's name, and upgrading to paid"
```

---

### Task 6: Whole-branch verification

**Files:** none new.

- [ ] **Step 1: Backend tests, lint, deploy checks**

Run from the repo root: `make test && make lint && make check`
Expected: all pass. (`make check` runs `check --deploy` with production settings; `CRON_TOKEN` blank is fine.)

- [ ] **Step 2: The app's API types are unchanged**

Run: `cd app && npm run api:types && git diff --exit-code src/api/schema.d.ts`
Expected: exit 0 (no diff), because the endpoint is excluded from the schema.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin s8b-test-run
gh pr create --base docs/web-first-launch --title "S8b: the test run on free tiers" --body "<summary of docs/plans/S8B_TEST_RUN.md and the tasks above; the owner's steps are in docs/LAUNCH.md Part 1>"
```

If PR #18 has merged by then, use `--base main`.
