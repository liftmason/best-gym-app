"""The JSON API at /api/v1/ (docs/plans/S2_API.md). Endpoints live next to their services
(`apps/<app>/api.py`) and hold no rules: they parse, call a service, and shape the answer.

- Authentication: `Authorization: Bearer <access token>` on everything unless an endpoint
  says `auth=None`. The signed-in device is `request.device`, its user `request.user`.
- Errors: one shape, {"error": {"code", "message", "fields"}}, from the service exception's
  category (apps/core/errors.py). Not found and not yours are the same 404.
- The web app sends `X-Client: web`; see apps/signin/api.py for its refresh cookie.
"""

from django.core.exceptions import ObjectDoesNotExist
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404
from ninja import NinjaAPI
from ninja.errors import AuthenticationError
from ninja.errors import ValidationError as SchemaError
from ninja.security import HttpBearer

from apps.core import errors


class Bearer(HttpBearer):
    def authenticate(self, request, token):
        from apps.signin import services

        session = services.authenticate(token)
        if session is None:
            return None
        request.device, request.user = session, session.user
        return session


api = NinjaAPI(
    title="GymTrainer API",
    version="1",
    urls_namespace="api",
    auth=Bearer(),
    docs_url="/docs",
)


def error(request, status, code, message, fields=None):
    return api.create_response(
        request, {"error": {"code": code, "message": message, "fields": fields or {}}}, status=status
    )


def _service_error(request, exc):
    status, body = errors.describe(exc)
    return api.create_response(request, body, status=status)


for category in (
    errors.Invalid,
    errors.NotSignedIn,
    errors.NotFound,
    errors.Conflict,
    errors.Gone,
    errors.TooMany,
):
    api.add_exception_handler(category, _service_error)


@api.exception_handler(ObjectDoesNotExist)
def _missing(request, exc):
    return error(request, 404, "not_found", errors.DEFAULT_MESSAGES[404])


@api.exception_handler(Http404)
def _http404(request, exc):
    return error(request, 404, "not_found", errors.DEFAULT_MESSAGES[404])


@api.exception_handler(AuthenticationError)
def _signed_out(request, exc):
    return error(request, 401, "not_signed_in", errors.DEFAULT_MESSAGES[401])


@api.exception_handler(SchemaError)
def _bad_request(request, exc):
    """The request didn't match the endpoint's schema (a missing field, a wrong type)."""
    fields = {}
    for e in exc.errors:
        loc = [str(part) for part in e.get("loc", [])]
        # ("body", <the endpoint's parameter name>, field…) or ("query"/"path", field…)
        loc = loc[2:] if loc[:1] == ["body"] else loc[1:]
        fields[".".join(loc)] = e.get("msg", "Invalid")
    return error(request, 400, "invalid_request", errors.DEFAULT_MESSAGES[400], fields)


@api.exception_handler(DjangoValidationError)
def _model_invalid(request, exc):
    fields = {k: " ".join(v) for k, v in exc.message_dict.items()} if hasattr(exc, "error_dict") else {}
    return error(request, 400, "invalid", " ".join(exc.messages), fields)


def limit(request, name, count, seconds, key=None):
    """Apply a rate limit (docs/plans/S0_TEST_TRIAGE.md): by the caller's address unless a
    key is given. TooMany when it's used up."""
    from apps import ratelimit

    if not ratelimit.hit(name, key if key is not None else ratelimit.client_ip(request), count, seconds):
        raise errors.TooMany()


def _routers():
    from apps.accounts.api import router as accounts
    from apps.accounts.coach_api import router as athletes
    from apps.accounts.settings_api import router as settings
    from apps.dashboard.api import router as dashboard
    from apps.exercises.api import router as library
    from apps.library.api import router as templates
    from apps.library.apply_api import router as applying
    from apps.messaging.api import router as messages
    from apps.programs.board_api import router as board
    from apps.programs.habits_api import router as habits
    from apps.signin.api import router as signin
    from apps.workouts.coach_api import router as training
    from apps.workouts.questions_api import router as questions

    api.add_router("/auth", signin)
    api.add_router("", accounts)
    api.add_router("", dashboard)
    api.add_router("", athletes)
    api.add_router("", training)
    api.add_router("", messages)
    api.add_router("", habits)
    api.add_router("", questions)
    api.add_router("", board)
    api.add_router("", library)
    api.add_router("", templates)
    api.add_router("", applying)
    api.add_router("", settings)


def coach_of(request):
    """The signed-in coach; NotFound for anyone else (coach endpoints don't exist for them)."""
    coach = request.user.coach_profile
    if coach is None or coach.membership is None or coach.membership.ended_at is not None:
        raise errors.NotFound()
    return coach


def athlete_of(request):
    """The signed-in athlete profile (with or without a coach); NotFound for anyone else."""
    athlete = getattr(request.user, "athlete", None)
    if athlete is None:
        raise errors.NotFound()
    return athlete


_routers()  # last: the routers import the helpers above
