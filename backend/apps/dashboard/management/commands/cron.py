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
