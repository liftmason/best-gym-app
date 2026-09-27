"""The Render cron job's command, run hourly (deploy/render.paid.yaml).

Every run: bring every coach's attention feed up to date (`nightly`), delete form videos
past their keep period, delete expired rate-limit counters, and send the morning digest to
coaches whose gym is past 7am and haven't had today's.

Each step, and each coach's digest, runs on its own: a failure is logged (and reported to
Sentry when it's set up) and the rest still run; the command then exits with an error so
the failed run shows in Render (audit H10).
"""

import logging

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

from apps import ratelimit
from apps.accounts.models import Coach
from apps.dashboard import digest
from apps.sync import purge as sync_purge
from apps.workouts import videos

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Hourly jobs: alerts, form-video clean-up, rate-limit counters, morning digests."

    def handle(self, *args, **options):
        self.failures = []
        self.step("alerts", lambda: call_command("nightly", stdout=self.stdout))
        expired, abandoned = self.step("form videos", videos.expire) or (0, 0)
        self.step("rate-limit counters", ratelimit.purge)
        self.step("sync change log", sync_purge.purge)
        sent = 0
        for coach in Coach.objects.select_related("user"):
            if self.step(f"digest for coach {coach.pk}", lambda coach=coach: digest.send(coach)):
                sent += 1
        self.stdout.write(
            f"cron: {expired} video(s) expired, {abandoned} unfinished upload(s) removed, "
            f"{sent} digest(s) sent"
        )
        if self.failures:
            raise CommandError(f"cron: {len(self.failures)} failed: {', '.join(self.failures)}")

    def step(self, name, fn):
        try:
            return fn()
        except Exception:
            logger.exception("cron: %s failed", name)
            self.failures.append(name)
            return None
