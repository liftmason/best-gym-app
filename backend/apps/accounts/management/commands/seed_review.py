"""The app-review account's gym (docs/plans/S8_LAUNCH.md, decision F): Apple's and Google's
reviewers sign in with REVIEW_ACCOUNT_EMAIL and its fixed code (REVIEW_ACCOUNT_CODE) and
find a real-looking gym. The account coaches it and also trains in it, so one sign-in
shows both sides (More → Switch to Training).

It builds only its own gym (REVIEW_GYM) and never touches another. Its athletes have
addresses that can't receive email or sign in. `--reset` rebuilds it with fresh dates.
"""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import Gym, User

from .seed_demo import build_gym, remove_gym

REVIEW_GYM = f"{settings.APP_NAME} Review Gym"
TRAINS_AS = "maya@ironridge.example"  # the demo athlete with the fullest program


class Command(BaseCommand):
    help = "Build or rebuild the app-review gym for REVIEW_ACCOUNT_EMAIL."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Remove the review gym, then build it.")

    @transaction.atomic
    def handle(self, *args, **options):
        email, code = settings.REVIEW_ACCOUNT_EMAIL, settings.REVIEW_ACCOUNT_CODE
        if not email or not code:
            raise CommandError("Set REVIEW_ACCOUNT_EMAIL and REVIEW_ACCOUNT_CODE first.")
        existing = User.objects.filter(email__iexact=email).first()
        coach = getattr(existing, "coach", None)
        if coach is not None and coach.gym is not None and coach.gym.name != REVIEW_GYM:
            raise CommandError(f"{email} already coaches {coach.gym.name}; use an address of its own.")
        if options["reset"]:
            remove_gym(REVIEW_GYM)
        elif Gym.objects.filter(name=REVIEW_GYM).exists():
            raise CommandError(f"{REVIEW_GYM} exists. Pass --reset to rebuild it.")
        build_gym(
            self.stdout,
            gym_name=REVIEW_GYM,
            coach=(email, "App Review", "Head coach"),
            email_for=lambda spec: f"{spec['email'].split('@')[0]}@review.liftmason.invalid",
            coach_trains_as=TRAINS_AS,
            meso=False,
        )
        done = f"{REVIEW_GYM} is ready: sign in as {email} with the review code."
        self.stdout.write(self.style.SUCCESS(done))
