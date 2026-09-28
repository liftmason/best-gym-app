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
