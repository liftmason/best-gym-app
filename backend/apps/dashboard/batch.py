"""Everything the coach dashboard reads about its athletes, loaded for all of them at once
(audit H4, M17): a fixed number of queries however many athletes there are. The rules are
the same as the per-athlete ones in apps/workouts/history.py (compliance, day status) and
apps/dashboard/alerts.py (when a program runs out); tests/unit/test_dashboard_summary.py
checks the two agree.
"""

import datetime
from collections import defaultdict

from django.db.models import Count

from apps.accounts.metrics import metric_specs
from apps.accounts.models import BodyweightEntry, MaxEntry
from apps.programs.models import Prescription, Program, ProgramSession, ProgramWeek
from apps.workouts.models import SessionLog

DAY = datetime.timedelta(days=1)


class Loaded:
    """Per-athlete facts for a list of athletes, read in bulk."""

    def __init__(self, athletes, gym):
        self.athletes = list(athletes)
        self.gym = gym
        ids = [a.pk for a in self.athletes]
        self.today = {a.pk: a.today() for a in self.athletes}

        # Every planned session in a published week of each active program: compliance,
        # when the program runs out, and today's sessions all come from these rows.
        self.sessions = defaultdict(list)  # athlete id -> [(date, session id)], oldest first
        for athlete_id, date, session_id in (
            ProgramSession.objects.filter(
                day__week__program__athlete__in=ids,
                day__week__program__active=True,
                day__week__published=True,
            )
            .order_by("day__date")
            .values_list("day__week__program__athlete_id", "day__date", "pk")
        ):
            self.sessions[athlete_id].append((date, session_id))
        self.done_sessions = set(
            SessionLog.objects.finished()
            .filter(athlete__in=ids, program_session__isnull=False)
            .values_list("program_session_id", flat=True)
        )
        self.programs = {p.athlete_id: p for p in Program.objects.active().filter(athlete__in=ids)}

        earliest = min(self.today.values(), default=None)
        weeks = (
            ProgramWeek.objects.filter(
                program__athlete__in=ids, program__active=True, start_date__gt=earliest - 7 * DAY
            )
            .select_related("week_type", "program")
            .order_by("start_date")
            if earliest
            else []
        )
        self.weeks = defaultdict(list)
        for w in weeks:
            self.weeks[w.program.athlete_id].append(w)

        self.last_logs = {
            log.athlete_id: log
            for log in SessionLog.objects.finished()
            .filter(athlete__in=ids)
            .order_by("athlete_id", "-date", "-finished_at")
            .distinct("athlete_id")
            .prefetch_related("answers")
        }

        self.specs = metric_specs(gym)
        lift_ids = [m.exercise.pk for m in self.specs if m.exercise is not None]
        self.bodyweights = set(
            BodyweightEntry.objects.filter(athlete__in=ids).values_list("athlete_id", flat=True).distinct()
        )
        self.lifts = defaultdict(set)
        for athlete_id, exercise_id in (
            MaxEntry.objects.filter(athlete__in=ids, exercise__in=lift_ids)
            .values_list("athlete_id", "exercise_id")
            .distinct()
        ):
            self.lifts[athlete_id].add(exercise_id)

        today_ids = [s for a in self.athletes for d, s in self.sessions[a.pk] if d == self.today[a.pk]]
        self.exercise_counts = dict(
            Prescription.objects.filter(session__in=today_ids, warmup=False)
            .values("session")
            .annotate(n=Count("pk"))
            .values_list("session", "n")
        )

    # ---------------------------------------------------------------- per athlete

    def days(self, athlete):
        """{date: done} for days with a planned session (any of the day's sessions done)."""
        result = {}
        for date, session_id in self.sessions[athlete.pk]:
            result[date] = result.get(date, False) or session_id in self.done_sessions
        return result

    def compliance(self, athlete, start, end):
        """(done, scheduled) from start to end; today counts only once it's done."""
        today = self.today[athlete.pk]
        rows = [done for d, done in self.days(athlete).items() if start <= d <= end and (d < today or done)]
        return sum(rows), len(rows)

    def program_end(self, athlete):
        """(program, last day with a published session) as alerts.program_end_date gives."""
        program = self.programs.get(athlete.pk)
        dates = self.sessions[athlete.pk]
        return program, (dates[-1][0] if program and dates else None)

    def current_week(self, athlete):
        today = self.today[athlete.pk]
        return next(
            (w for w in self.weeks[athlete.pk] if w.start_date <= today < w.start_date + 7 * DAY), None
        )

    def last_log(self, athlete):
        return self.last_logs.get(athlete.pk)

    def missing_metrics(self, athlete):
        missing = []
        for m in self.specs:
            if m.key == "bodyweight":
                ok = athlete.pk in self.bodyweights
            elif m.key == "height_cm":
                ok = athlete.height_cm is not None
            elif m.key == "years_training":
                ok = bool(athlete.years_training)
            else:
                ok = m.exercise.pk in self.lifts[athlete.pk]
            if not ok:
                missing.append(m.key)
        return missing

    def today_sessions(self, athlete):
        """(exercises planned today, warm-up drills aside; whether any of today's is done)."""
        today = self.today[athlete.pk]
        ids = [s for d, s in self.sessions[athlete.pk] if d == today]
        return sum(self.exercise_counts.get(s, 0) for s in ids), any(s in self.done_sessions for s in ids)
