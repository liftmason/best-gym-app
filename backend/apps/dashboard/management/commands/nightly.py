"""Brings every coach's attention feed up to date: programs running out, missing metrics,
missed sessions and PRs waiting (apps/dashboard/alerts.py). Run by the hourly cron job
(`manage.py cron`). Each coach is synced on their own, so one failure doesn't stop the rest.
"""

import logging

from django.core.management.base import BaseCommand, CommandError

from apps.accounts.models import Coach
from apps.dashboard import alerts

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Bring every coach's attention feed up to date."

    def handle(self, *args, **options):
        synced, failed = 0, 0
        for coach in Coach.objects.select_related("user"):
            try:
                alerts.sync_coach(coach)
                synced += 1
            except Exception:
                logger.exception("nightly: alerts for coach %s failed", coach.pk)
                failed += 1
        self.stdout.write(self.style.SUCCESS(f"nightly: synced alerts for {synced} coach(es)"))
        if failed:
            raise CommandError(f"nightly: {failed} coach(es) failed")
