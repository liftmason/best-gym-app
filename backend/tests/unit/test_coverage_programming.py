"""Rules that were only tested through the pages (S0 step 2 triage), now tested directly: the
program board, logged days, undo, the rail and library search, tracked lifts, deleting
exercises, templates and the question builder."""

import datetime
import uuid
from decimal import Decimal

import pytest

from apps.accounts.models import MaxEntry
from apps.exercises import deletion
from apps.exercises import services as library
from apps.exercises.models import Exercise, Tag, TrackedLift
from apps.library import services as templates
from apps.library.models import TemplateKind
from apps.programs import rail, services, undo
from apps.programs.dose import validate
from apps.programs.models import Prescription, ProgramSession, WeekType
from apps.workouts import questions, sessions
from apps.workouts.models import QuestionType, install_default_questions

from ..conftest import cat, ex
from ..factories import AthleteFactory, CoachFactory, GymFactory

pytestmark = pytest.mark.django_db
DAY = datetime.timedelta(days=1)


@pytest.fixture
def program(athlete, coach, gym):
    week_type = WeekType.objects.get(gym=gym, name="Accumulation")
    return services.start_program(athlete, "P", athlete.today() - 7 * DAY, 3, week_type, by=coach.user)


def day_of(program, date):
    return program.weeks.get(days__date=date).days.get(date=date)


# ---------------------------------------------------------------- the board


def test_a_dropped_session_decides_the_day(program, athlete, coach, gym):
    today = day_of(program, athlete.today())
    tomorrow = day_of(program, athlete.today() + DAY)
    target = services.session_for(tomorrow)
    rx = services.add_prescription(today, ex(gym, "sn"), athlete, session_id=target.pk)
    assert rx.session == target and rx.session.day == tomorrow
    other = AthleteFactory(coach=coach)
    elsewhere = services.start_program(
        other, "Q", other.today(), 1, program.weeks.first().week_type, by=coach.user
    )
    foreign = services.session_for(elsewhere.weeks.get().days.first())
    with pytest.raises(services.NotAllowed):
        services.add_prescription(today, ex(gym, "sn"), athlete, session_id=foreign.pk)


def test_adding_at_a_position(program, athlete, gym):
    day = day_of(program, athlete.today())
    a = services.add_prescription(day, ex(gym, "sn"), athlete)
    b = services.add_prescription(day, ex(gym, "cj"), athlete)
    c = services.add_prescription(day, ex(gym, "bsq"), athlete, index=1)
    d = services.add_prescription(day, ex(gym, "fsq"), athlete, index=0)
    assert list(day.sessions.get().prescriptions.values_list("pk", flat=True)) == [d.pk, a.pk, c.pk, b.pk]


def test_moving_the_last_item_off_a_day_deletes_the_empty_session(program, athlete, gym):
    today, tomorrow = day_of(program, athlete.today()), day_of(program, athlete.today() + DAY)
    rx = services.add_prescription(today, ex(gym, "sn"), athlete)
    source = rx.session
    services.move_prescription(rx, services.session_for(tomorrow), 0)
    assert not ProgramSession.objects.filter(pk=source.pk).exists()


def test_a_swap_keeps_the_dose(program, athlete, coach, gym):
    rx = services.add_prescription(day_of(program, athlete.today()), ex(gym, "sn"), athlete)
    services.edit_prescription(
        rx, validate({"sets": 5, "rep_scheme": "2", "load_basis": "percent", "load_value": "75"}, "kg")
    )
    services.swap_exercise(rx, ex(gym, "psn"), by=coach.user)
    rx.refresh_from_db()
    assert (rx.exercise, rx.sets, rx.rep_scheme, rx.load_value) == (ex(gym, "psn"), 5, "2", Decimal("75"))


def test_publishing_stamps_the_time(program):
    week = program.weeks.first()
    services.set_published(week, True)
    assert week.published and week.published_at
    services.set_published(week, False)
    assert not week.published and week.published_at is None


def test_deleting_a_session_deletes_its_exercises(program, athlete, gym):
    rx = services.add_prescription(day_of(program, athlete.today()), ex(gym, "sn"), athlete)
    services.delete_session(rx.session)
    assert not Prescription.objects.filter(pk=rx.pk).exists()


def test_logged_days_are_protected(program, athlete, gym):
    yesterday, today = day_of(program, athlete.today() - DAY), day_of(program, athlete.today())
    done = services.add_prescription(yesterday, ex(gym, "sn"), athlete)
    paused = services.add_prescription(today, ex(gym, "cj"), athlete)
    sessions.finish(sessions.start(athlete, done.session), 7)
    sessions.start(athlete, paused.session)  # started, not finished
    week = today.week
    assert services.locked_day_ids(week) == {yesterday.pk}  # a paused session doesn't lock its day
    assert services.clear_week(week) == 1
    assert ProgramSession.objects.filter(day=yesterday).exists()
    with pytest.raises(services.HasLoggedSessions):
        services.delete_week(program.weeks.first())
    with pytest.raises(services.HasLoggedSessions):
        services.duplicate_week(program.weeks.first())
    logged = ProgramSession.objects.get(day=yesterday)
    for rx in list(logged.prescriptions.all()):
        services.remove_prescription(rx)
    assert ProgramSession.objects.filter(pk=logged.pk).exists()  # its log keeps it


def test_undo_steps_back_in_reverse_order(program, athlete, coach, gym):
    today, tomorrow = day_of(program, athlete.today()), day_of(program, athlete.today() + DAY)
    week = today.week
    rx = services.add_prescription(today, ex(gym, "sn"), athlete, by=coach.user)
    services.edit_prescription(
        rx, validate({"sets": 6, "rep_scheme": "1", "load_basis": "none"}, "kg"), by=coach.user
    )
    services.move_prescription(rx, services.session_for(tomorrow), 0, by=coach.user)
    assert undo.undo(week) == "Move Snatch"
    rx.refresh_from_db()
    assert rx.session.day == today and rx.sets == 6
    assert undo.undo(week) == "Edit Snatch"
    rx.refresh_from_db()
    assert rx.sets != 6
    assert undo.undo(week) == "Add Snatch"
    assert not Prescription.objects.exists()
    assert undo.undo(week) is None


# ---------------------------------------------------------------- the rail and library search


def test_rail_tags_combine_with_and(gym):
    overhead, strength = Tag.objects.get(gym=gym, name="overhead"), Tag.objects.get(gym=gym, name="strength")
    both, _ = rail.search(gym, tag_ids=[overhead.pk, strength.pk], sort="az")
    assert both and all({overhead, strength} <= set(e.tags.all()) for e in both)
    assert len(both) < len(rail.search(gym, tag_ids=[overhead.pk], sort="az")[0])


def test_library_search_matches_cues_and_tag_names(gym):
    cued, _ = library.search(gym, "punch under")  # the snatch's cue
    assert ex(gym, "sn") in cued
    tagged, _ = library.search(gym, "posterior")
    assert ex(gym, "rdl") in tagged
    overhead, strength = Tag.objects.get(gym=gym, name="overhead"), Tag.objects.get(gym=gym, name="strength")
    both, _ = library.search(gym, tag_ids=[overhead.pk, strength.pk])
    assert all({overhead, strength} <= set(e.tags.all()) for e in both)


def test_demo_links(gym):
    exercise = library.save_exercise(
        gym, name="Tall Clean", category=cat(gym, "clean & jerk"), youtube_url="youtube.com/x"
    )
    assert exercise.youtube_url == "https://youtube.com/x"
    for bad in ("javascript:alert(1)", "not a link"):
        with pytest.raises(library.InvalidExercise):
            library.save_exercise(
                gym, name="Tall Clean 2", category=cat(gym, "clean & jerk"), youtube_url=bad
            )


def test_editing_keeps_the_starter_key(gym):
    edited = library.save_exercise(
        gym, exercise=ex(gym, "sn"), name="Snatch (full)", category=cat(gym, "snatch")
    )
    assert edited.key == "sn"


def test_tracking_refuses_archived_and_other_gyms_lifts_and_reorders(gym):
    library.archive(ex(gym, "fsq"))
    with pytest.raises(library.TrackingRefused):
        library.track(gym, ex(gym, "fsq").pk)
    with pytest.raises(library.TrackingRefused):
        library.track(gym, ex(GymFactory(pack="weightlifting"), "pp").pk)
    order = list(TrackedLift.objects.filter(gym=gym))
    library.move_tracked(gym, order[2].pk, "up")
    assert list(TrackedLift.objects.filter(gym=gym)) == [order[0], order[2], order[1]]


# ---------------------------------------------------------------- deleting exercises


def test_only_archived_exercises_can_be_deleted(gym):
    with pytest.raises(deletion.CannotDelete):
        deletion.check_deletable(ex(gym, "sn"))


def test_deletion_impact_and_delete(program, athlete, gym):
    snatch = ex(gym, "sn")
    MaxEntry.objects.create(athlete=athlete, exercise=snatch, date=athlete.today(), kg=80, source="coach")
    rx = services.add_prescription(day_of(program, athlete.today() + DAY), snatch, athlete)
    dependents = list(Exercise.objects.filter(percent_of=snatch).values_list("name", flat=True))
    library.archive(snatch)
    impact = deletion.deletion_impact(snatch)
    assert impact["max_entries"] == 1 and impact["athletes"] == ["Maya Torres"]
    assert impact["prescriptions"] == 1 and impact["programmed_for"] == ["Maya Torres"]
    assert impact["dependents"] == sorted(dependents)
    deletion.delete_exercise(snatch)
    assert not MaxEntry.objects.exists() and not Prescription.objects.filter(pk=rx.pk).exists()
    assert not Exercise.objects.filter(gym=gym, name__in=dependents, percent_of__isnull=False).exists()


# ---------------------------------------------------------------- templates


def test_removing_a_template_week_renumbers_the_rest(coach, gym):
    template = templates.new_template(gym, TemplateKind.PROGRAM, coach.user)
    templates.add_week(template)
    templates.add_week(template)
    templates.remove_week(template.weeks.first())
    assert list(template.weeks.values_list("order", flat=True)) == [0, 1]


def test_a_two_tag_slot_defaults_to_an_exercise_with_both(coach, gym):
    template = templates.new_template(gym, TemplateKind.PROGRAM, coach.user)
    tags = [Tag.objects.get(gym=gym, name="overhead"), Tag.objects.get(gym=gym, name="strength")]
    slot = templates.add_tag_slot(template.weeks.get().sessions.first(), tags)
    assert set(tags) <= set(slot.exercise.tags.all())


def test_template_slots_only_take_the_gyms_live_exercises(coach, gym):
    template = templates.new_template(gym, TemplateKind.PROGRAM, coach.user)
    session = template.weeks.get().sessions.first()
    with pytest.raises(templates.InvalidTemplate):
        templates.add_slot(session, ex(GymFactory(pack="weightlifting"), "sn"))
    library.archive(ex(gym, "cj"))
    with pytest.raises(templates.InvalidTemplate):
        templates.add_slot(session, ex(gym, "cj"))


def test_template_habits_follow_the_habit_rules(coach, gym):
    from apps.programs.habits import InvalidHabit

    template = templates.new_template(gym, TemplateKind.PROGRAM, coach.user)
    assert templates.add_habit(template, "  Sleep  8h ", "", "daily").name == "Sleep 8h"
    with pytest.raises(InvalidHabit):
        templates.add_habit(template, "", "😴", "daily")


def test_template_week_types_refuse_newly_archived_ones(coach, gym):
    template = templates.new_template(gym, TemplateKind.PROGRAM, coach.user)
    deload = WeekType.objects.get(gym=gym, name="Deload")
    deload.archived = True
    deload.save()
    with pytest.raises(templates.InvalidTemplate):
        templates.set_week_type(template.weeks.get(), deload)


def test_saving_parts_checks_names(program, athlete, coach, gym):
    services.add_prescription(day_of(program, athlete.today()), ex(gym, "sn"), athlete)
    week = day_of(program, athlete.today()).week
    with pytest.raises(templates.InvalidTemplate):
        templates.save_week(gym, coach.user, week, "x" * 81)
    saved = templates.save_week(gym, coach.user, week, "  Heavy   week ")
    assert saved.name == "Heavy week"


def test_a_program_note_is_saved_on_the_template(coach, gym):
    template = templates.new_template(gym, TemplateKind.PROGRAM, coach.user)
    templates.update_meta(template, program_note="  Rest as needed. ")
    template.refresh_from_db()
    assert template.program_note == "Rest as needed."


def test_warmup_slots_move_first(coach, gym):
    from apps.programs import dose

    template = templates.new_template(gym, TemplateKind.PROGRAM, coach.user)
    session = template.weeks.get().sessions.first()
    lift = templates.add_slot(session, ex(gym, "sn"))
    drill = templates.add_slot(session, ex(gym, "mob"))
    dose.apply(
        drill, validate({"sets": 1, "load_basis": "none", "warmup": True, "rep_scheme": "5 min"}, "kg")
    )
    assert list(session.slots.values_list("pk", flat=True)) == [drill.pk, lift.pk]


# ---------------------------------------------------------------- the question builder


def test_removing_an_option_that_isnt_there(athlete):
    q = questions.add(athlete, QuestionType.CHOICE)
    with pytest.raises(questions.InvalidQuestion):
        questions.remove_option(q, 9)


def test_push_defaults_leaves_another_coachs_athletes_alone(coach, athlete, gym):
    install_default_questions(gym)
    other_coach = CoachFactory(gym=gym)
    theirs = AthleteFactory(coach=other_coach)
    questions.add(theirs, QuestionType.TEXT)
    questions.push_defaults(coach)
    assert [q.type for q in questions.active(theirs)] == [QuestionType.TEXT]


def test_pending_edits_save_before_an_action(athlete):
    q = questions.add(athlete, QuestionType.SCALE)
    questions.save_pending_edits(
        athlete,
        {f"text_{q.pk}": " Sore? ", f"low_label_{q.pk}": "no", f"text_{uuid.uuid7()}": "x", "text_x": "x"},
    )
    q.refresh_from_db()
    assert (q.text, q.low_label) == ("Sore?", "no")
    questions.save_pending_edits(athlete, {f"text_{q.pk}": "   "})  # a cleared wording is left alone
    q.refresh_from_db()
    assert q.text == "Sore?"


def test_athlete_copies_keep_the_follow_up_box(gym, athlete):
    from apps.workouts.models import CheckinQuestion

    q = CheckinQuestion.objects.create(gym=gym, type=QuestionType.SCALE, text="Sore?", detail_label="Where?")
    assert q.copy_for(athlete).detail_label == "Where?"
