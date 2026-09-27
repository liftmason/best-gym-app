"""Everything that puts an item in (or takes it out of) the coach's attention feed.

Events call these as they happen: `message_sent`, `thread_read`, `issue_reported`,
`issue_resolved`, `sync_prs` (after a session is finished or edited, and after the
coach decides on a PR) and `max_updates`.

Events also push to the other side's phone (apps/signin/push.py): the coach hears of
athlete messages, issues and form videos; the athlete of coach messages.

Conditions are checked by `sync_athlete` (dashboard load and the nightly job):
a program running out within PROGRAM_WARNING_DAYS (or no program at all), missing
metrics, and sessions missed in the last MISSED_LOOKBACK_DAYS. A condition's row is
deleted once it no longer holds, so it can fire again later; while it holds, a
dismissed row stays dismissed.
"""

import datetime
from urllib.parse import urlencode

from django.db import transaction
from django.utils import timezone

from apps.accounts import coaching
from apps.core import ids
from apps.signin import push

from .models import Notification, NotificationKind

PROGRAM_WARNING_DAYS = 7
MISSED_LOOKBACK_DAYS = 7


def _tab(athlete, tab, **params):
    """The app's screen for one of the athlete's tabs (app/src/app/(coaching)/athletes/[id]):
    `/athletes/<id>?tab=…`, plus `focus` (the item to scroll to), `week` or `range`. The same
    path works in the web app, so digest emails link to it."""
    query = urlencode({"tab": tab, **{k: v for k, v in params.items() if v}})
    return f"/athletes/{athlete.pk}?{query}"


def notify(athlete, kind, key, text, link, reopen=True):
    """Add or update the coach's row. `reopen` brings a handled or dismissed row back.
    Nothing for an athlete without an active coach."""
    if athlete.active_coaching is None:
        return None
    recipient = athlete.coach.user
    now = timezone.now()
    row, created = Notification.objects.get_or_create(
        recipient=recipient,
        athlete=athlete,
        kind=kind,
        dedupe_key=key,
        defaults={"text": text[:300], "link": link, "created_at": now},
    )
    if created:
        return row
    row.text, row.link = text[:300], link
    if reopen:
        row.created_at, row.read_at, row.cleared_at = now, None, None
    row.save()
    return row


def handled(athlete, kind, key=None):
    """The coach dealt with it: gone from the feed (kept, so it doesn't fire again)."""
    rows = Notification.objects.filter(
        recipient=athlete.coach.user, athlete=athlete, kind=kind, cleared_at__isnull=True
    )
    if key is not None:
        rows = rows.filter(dedupe_key=key)
    now = timezone.now()
    return rows.update(cleared_at=now, read_at=now)


def _remove(athlete, kind, keep_keys=()):
    """A condition no longer holds: delete its rows so it can fire again later."""
    Notification.objects.filter(recipient=athlete.coach.user, athlete=athlete, kind=kind).exclude(
        dedupe_key__in=list(keep_keys)
    ).delete()


# ---------------------------------------------------------------- events


def _coach_user(athlete):
    return athlete.coach.user if athlete.active_coaching else None


def message_sent(message):
    thread = message.thread
    athlete = thread.athlete
    body = " ".join(message.body.split())
    if message.sender_id == athlete.user_id:
        text = f"“{body[:120]}{'…' if len(body) > 120 else ''}”"
        notify(athlete, NotificationKind.MESSAGE, f"thread:{thread.pk}", text, _tab(athlete, "messages"))
        push.to_user(
            _coach_user(athlete), athlete.user.name, body, {"type": "message", "athlete_id": str(athlete.pk)}
        )
    else:
        handled(athlete, NotificationKind.MESSAGE, f"thread:{thread.pk}")  # the coach replied
        sender = message.sender.name if message.sender else "Your coach"
        push.to_user(athlete.user, sender, body, {"type": "message"})


def thread_read(thread):
    handled(thread.athlete, NotificationKind.MESSAGE, f"thread:{thread.pk}")


def issue_reported(issue):
    text = issue.get_kind_display() + (f" — “{issue.text[:100]}”" if issue.text else "")
    notify(issue.athlete, NotificationKind.ISSUE, f"issue:{issue.pk}", text, _tab(issue.athlete, "sessions"))
    push.to_user(
        _coach_user(issue.athlete),
        f"{issue.athlete.user.name} reported an issue",
        text,
        {"type": "issue", "athlete_id": str(issue.athlete_id)},
    )


def issue_resolved(issue):
    handled(issue.athlete, NotificationKind.ISSUE, f"issue:{issue.pk}")


def video_uploaded(video, reopen=True):
    athlete = video.session_log.athlete
    text = f"Uploaded a form video: {video.exercise_name}" + (
        f" — “{video.note[:100]}”" if video.note else ""
    )
    notify(
        athlete, NotificationKind.VIDEO, f"video:{video.pk}", text, _tab(athlete, "sessions"), reopen=reopen
    )
    if reopen:
        push.to_user(
            _coach_user(athlete),
            f"{athlete.user.name} uploaded a form video",
            video.exercise_name,
            {"type": "video", "athlete_id": str(athlete.pk)},
        )


def video_reviewed(video):
    handled(video.session_log.athlete, NotificationKind.VIDEO, f"video:{video.pk}")


def video_removed(video):
    athlete = video.session_log.athlete
    Notification.objects.filter(
        recipient=athlete.coach.user,
        athlete=athlete,
        kind=NotificationKind.VIDEO,
        dedupe_key=f"video:{video.pk}",
    ).delete()


def sync_prs(athlete):
    """One row per exercise with a session PR waiting for the coach; decided ones leave."""
    from apps.accounts import units
    from apps.workouts import prs

    unit = athlete.gym.units
    keys = []
    for c in prs.pending(athlete):
        key = f"pr:{c.exercise.pk}"
        keys.append(key)
        text = (
            f"{c.exercise.name} {units.display(c.set_log.load_kg, unit)} × {c.set_log.reps} — above the "
            f"{units.display(c.current.kg, unit)} working max. Use it, or keep the max?"
        )
        existing = Notification.objects.filter(
            recipient=athlete.coach.user, athlete=athlete, kind=NotificationKind.PR, dedupe_key=key
        ).first()
        notify(
            athlete,
            NotificationKind.PR,
            key,
            text,
            _tab(athlete, "metrics"),
            reopen=existing is None or existing.text != text,
        )
    stale = Notification.objects.filter(
        recipient=athlete.coach.user,
        athlete=athlete,
        kind=NotificationKind.PR,
        dedupe_key__startswith="pr:",
        cleared_at__isnull=True,
    ).exclude(dedupe_key__in=keys)
    now = timezone.now()
    stale.update(cleared_at=now, read_at=now)


def max_updates(log, entries):
    """The maxes a session updated automatically, for the coach's information: one row per
    session and exercise, so editing the session updates its row, and an exercise it no
    longer sets (a typo fixed) loses its row."""
    from apps.accounts import units

    athlete = log.athlete
    prefix = f"auto:{log.pk}:"
    keys = []
    for entry in entries:
        key = f"{prefix}{entry.exercise_id}"
        keys.append(key)
        kg = units.display(entry.kg, athlete.gym.units)
        text = f"{entry.exercise.name} max updated to {kg} from a session PR"
        existing = Notification.objects.filter(
            recipient=athlete.coach.user, athlete=athlete, kind=NotificationKind.PR, dedupe_key=key
        ).first()
        reopen = existing is None or existing.text != text
        notify(athlete, NotificationKind.PR, key, text, _tab(athlete, "metrics"), reopen=reopen)
    if athlete.coach is not None:
        Notification.objects.filter(
            recipient=athlete.coach.user,
            athlete=athlete,
            kind=NotificationKind.PR,
            dedupe_key__startswith=prefix,
        ).exclude(dedupe_key__in=keys).delete()


# ---------------------------------------------------------------- conditions


def program_end_date(athlete):
    """The last day with a session in a published week of the athlete's active program
    (None: nothing published). Draft weeks don't count: the athlete can't see them."""
    from apps.programs.models import ProgramDay

    program = athlete.programs.active().first()
    if program is None:
        return None, None
    day = (
        ProgramDay.objects.filter(week__program=program, week__published=True, sessions__isnull=False)
        .order_by("-date")
        .first()
    )
    return program, day.date if day else None


def _drafts(program):
    """ " (N draft weeks not yet published)" when the program has drafts with sessions."""
    count = program.weeks.filter(published=False, days__sessions__isnull=False).distinct().count()
    if not count:
        return ""
    return f"; {count} draft week{'s' if count != 1 else ''} not yet published"


def _sync_program(athlete, today):
    program, last = program_end_date(athlete)
    kind = NotificationKind.PROGRAM_ENDING
    link = _tab(athlete, "program")
    if program is None:
        key, text = "none", "No program yet — build one or apply a template"
    elif last is None:
        drafts = _drafts(program)
        key = f"program:{program.pk}"
        text = (
            f"“{program.name}” has nothing published yet{drafts}"
            if drafts
            else f"“{program.name}” has no sessions yet"
        )
    elif last < today:
        key, text = (
            f"program:{program.pk}",
            f"“{program.name}” ended {last:%a %-d %b} — nothing scheduled after{_drafts(program)}",
        )
    elif (last - today).days < PROGRAM_WARNING_DAYS:
        days = (last - today).days
        when = "today" if days == 0 else "tomorrow" if days == 1 else f"{last:%A} ({days} days)"
        key = f"program:{program.pk}"
        text = f"“{program.name}” runs out {when} — nothing scheduled after{_drafts(program)}"
    else:
        _remove(athlete, kind)
        return
    _remove(athlete, kind, keep_keys=[key])
    notify(athlete, kind, key, text, link, reopen=False)


def _sync_metrics(athlete):
    from apps.accounts.metrics import metric_specs, missing_metrics

    specs = {m.key: m.label for m in metric_specs(athlete.gym)}
    missing = [specs[k] for k in missing_metrics(athlete)]
    kind = NotificationKind.METRICS_MISSING
    if not missing:
        _remove(athlete, kind)
        return
    notify(athlete, kind, "metrics", "Missing: " + ", ".join(missing), _tab(athlete, "metrics"), reopen=False)


def _sync_missed(athlete, today):
    from apps.programs.models import ProgramDay
    from apps.workouts.history import finished_session_ids

    done = finished_session_ids(athlete)
    days = (
        ProgramDay.objects.filter(
            week__program__athlete=athlete,
            week__program__active=True,
            week__published=True,
            sessions__isnull=False,
            date__lt=today,
            date__gte=today - datetime.timedelta(days=MISSED_LOOKBACK_DAYS),
        )
        .distinct()
        .prefetch_related("sessions__prescriptions__exercise")
    )
    kind = NotificationKind.MISSED
    for day in days:
        key = f"day:{day.pk}"
        sessions = list(day.sessions.all())
        if any(s.pk in done for s in sessions):
            _remove_key(athlete, kind, key)
            continue
        names = [rx.exercise.name for s in sessions for rx in s.prescriptions.all()]
        what = " + ".join(names[:2]) + (f" + {len(names) - 2} more" if len(names) > 2 else "")
        text = f"Missed {day.date:%a %-d %b}" + (f" — {what}" if what else "")
        notify(athlete, kind, key, text, _tab(athlete, "program", week=day.week_id), reopen=False)
    # Days logged afterwards (or no longer in the program) leave the feed.
    for row in Notification.objects.filter(recipient=athlete.coach.user, athlete=athlete, kind=kind):
        day_id = ids.parse(row.dedupe_key.removeprefix("day:"))
        if day_id is None:
            continue
        day = ProgramDay.objects.filter(pk=day_id).prefetch_related("sessions").first()
        if day is None or any(s.pk in done for s in day.sessions.all()):
            row.delete()


def _remove_key(athlete, kind, key):
    Notification.objects.filter(
        recipient=athlete.coach.user, athlete=athlete, kind=kind, dedupe_key=key
    ).delete()


@transaction.atomic
def sync_athlete(athlete, today=None):
    """Bring the condition-based rows (and waiting PRs) up to date for one athlete."""
    athlete_today = athlete.today()
    _sync_program(athlete, today or athlete_today)
    _sync_metrics(athlete)
    _sync_missed(athlete, athlete_today)
    sync_prs(athlete)


def sync_coach(coach):
    for athlete in coaching.athletes_for(coach):
        sync_athlete(athlete)


def feed(coach):
    """The coach's feed: newest first, for their current athletes."""
    return (
        Notification.objects.in_feed()
        .filter(recipient=coach.user, athlete__in=coaching.athletes_for(coach).values("pk"))
        .select_related("athlete__user")
    )


def unread_count(user):
    coach = getattr(user, "coach_profile", None)
    if coach is None:
        return 0
    return feed(coach).filter(read_at__isnull=True).count()


# ---------------------------------------------------------------- where an item takes the coach


def link_for(row):
    """As close to the thing as possible: the message, the session with the issue, the PR
    card, the program's last week, the metrics, the missed day. Worked out when the feed
    is drawn (not stored), so it follows the data as it changes."""
    from apps.programs.models import ProgramDay
    from apps.workouts.models import IssueReport

    athlete, key = row.athlete, row.dedupe_key
    if athlete is None:
        return row.link
    kind = row.kind
    if kind == NotificationKind.MESSAGE:
        return _tab(athlete, "messages", focus="latest")
    if kind == NotificationKind.ISSUE and key.startswith("issue:"):
        issue = (
            IssueReport.objects.filter(pk=ids.parse(key.removeprefix("issue:")), athlete=athlete)
            .select_related("session_log")
            .first()
        )
        if issue is None:
            return _tab(athlete, "sessions")
        older = issue.session_log and (athlete.today() - issue.session_log.date).days > 56
        return _tab(athlete, "sessions", range="all" if older else None, focus=f"issue-{issue.pk}")
    if kind == NotificationKind.VIDEO and key.startswith("video:"):
        from apps.workouts.models import FormVideo

        video = FormVideo.objects.filter(
            pk=ids.parse(key.removeprefix("video:")), session_log__athlete=athlete
        ).first()
        if video is None:
            return _tab(athlete, "sessions")
        older = (athlete.today() - video.session_log.date).days > 56
        return _tab(athlete, "sessions", range="all" if older else None, focus=f"video-{video.pk}")
    if kind == NotificationKind.PR:
        return _tab(athlete, "metrics", focus="prs")
    if kind == NotificationKind.METRICS_MISSING:
        return _tab(athlete, "metrics", focus="metrics")
    if kind == NotificationKind.PROGRAM_ENDING:
        program, last = program_end_date(athlete)
        if program is None or last is None:
            return _tab(athlete, "program")
        day = ProgramDay.objects.filter(week__program=program, date=last).first()
        return _tab(
            athlete, "program", week=day.week_id if day else None, focus=f"day-{day.pk}" if day else None
        )
    if kind == NotificationKind.MISSED and key.startswith("day:"):
        day = ProgramDay.objects.filter(
            pk=ids.parse(key.removeprefix("day:")), week__program__athlete=athlete
        ).first()
        if day:
            return _tab(athlete, "program", week=day.week_id, focus=f"day-{day.pk}")
    return row.link


def dismiss(user, notification_id):
    """Tick one of the user's feed rows as read (it stays, dimmed). DoesNotExist otherwise."""
    row = Notification.objects.get(pk=notification_id, recipient=user)
    if row.read_at is None:
        row.read_at = timezone.now()
        row.save(update_fields=["read_at"])
    return row


def clear_read(coach):
    """Remove every read row from the coach's feed; returns how many."""
    return feed(coach).filter(read_at__isnull=False).update(cleared_at=timezone.now())
