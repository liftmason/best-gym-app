"""Trimming the change log (the hourly cron). Phones pull at least daily in normal use; one
that hasn't pulled for KEEP_DAYS gets a "bootstrap again" (410) instead of a partial log."""

import datetime

from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from .models import Change, Purge

KEEP_DAYS = 90


@transaction.atomic
def purge(now=None):
    """Delete changes older than KEEP_DAYS; returns how many."""
    cutoff = (now or timezone.now()) - datetime.timedelta(days=KEEP_DAYS)
    old = Change.objects.filter(at__lt=cutoff)
    newest = old.aggregate(m=Max("txid"))["m"]
    if newest is None:
        return 0
    deleted, _ = Change.objects.filter(txid__lte=newest).delete()
    mark, _ = Purge.objects.get_or_create(pk=1)
    mark.below_txid, mark.at = max(mark.below_txid, newest + 1), timezone.now()
    mark.save()
    return deleted


def below():
    mark = Purge.objects.filter(pk=1).first()
    return mark.below_txid if mark else 0
