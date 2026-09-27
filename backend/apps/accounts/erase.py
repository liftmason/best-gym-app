"""Erasing an athlete for privacy. Training history is protected from deletion (a
session log, program, max, bodyweight or habit blocks deleting its athlete), so a slip in
the admin or a cascade can't wipe it. This is the one way to remove it: explicitly, in
an order the protections allow.
"""

from django.db import transaction

from apps.accounts.models import BodyweightEntry, Coaching, MaxEntry
from apps.messaging.models import Thread
from apps.programs.models import Habit, Program
from apps.workouts import videos
from apps.workouts.models import FormVideo, SessionLog


@transaction.atomic
def erase_athlete(athlete):
    """Delete the athlete and everything recorded about them: sessions, sets, check-ins,
    form videos (files too), programs, maxes, bodyweights, habits, issues, coaching links,
    messages and alerts. The user account goes as well unless it is also a coach's."""
    user = athlete.user
    keys = list(FormVideo.objects.filter(session_log__athlete=athlete).values_list("key", flat=True))
    MaxEntry.objects.filter(athlete=athlete).delete()
    BodyweightEntry.objects.filter(athlete=athlete).delete()
    Habit.objects.filter(athlete=athlete).delete()
    SessionLog.objects.filter(athlete=athlete).delete()
    Program.objects.filter(athlete=athlete).delete()
    Thread.objects.filter(athlete=athlete).delete()
    Coaching.objects.filter(athlete=athlete).delete()
    athlete.delete()
    if not hasattr(user, "coach"):
        user.delete()
    if keys and videos.enabled():
        # After the rows, once the transaction commits: a failed erase keeps its files.
        transaction.on_commit(lambda: [videos.delete(key) for key in keys])
