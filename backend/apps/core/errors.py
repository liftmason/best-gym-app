"""What kind of failure a service exception is. Each service's exceptions inherit one of
these, and the API turns that into a status and one error shape (audit M19):
{"error": {"code", "message", "fields"}}. `Invalid` is also a ValueError, so callers that
catch ValueError still do.
"""

import re


class Invalid(ValueError):
    """The input is wrong: 400, with field messages where the exception has them."""

    status = 400


class NotFound(Exception):
    """Not there, or not the caller's: 404 (the API never says which)."""

    status = 404


class Conflict(Exception):
    """Allowed input, but the current state refuses it (a closed session, logged weeks): 409."""

    status = 409


class Gone(Exception):
    """It was there and can't be used any more (a used or expired invite): 410."""

    status = 410


class TooMany(Exception):
    """Too many attempts for now: 429."""

    status = 429


DEFAULT_MESSAGES = {
    400: "Check what you entered.",
    404: "Not found.",
    409: "That can't be done right now.",
    410: "That link can't be used any more.",
    429: "Too many attempts. Try again later.",
}


def describe(exc):
    """(status, body) for a service exception: body is {"error": {code, message, fields}}.
    `fields` maps field names to messages ("" for the form as a whole)."""
    status = getattr(exc, "status", 400)
    fields = {}
    if isinstance(getattr(exc, "errors", None), dict):  # InvalidDose
        fields = {k or "": v for k, v in exc.errors.items()}
    elif getattr(exc, "field", None):  # InvalidExercise
        fields = {exc.field: str(exc)}
    elif exc.args and isinstance(exc.args[0], dict):
        fields = {k or "": str(v) for k, v in exc.args[0].items()}
    message = next(iter(fields.values()), "") if fields else (str(exc) if exc.args else "")
    code = re.sub(r"(?<!^)(?=[A-Z])", "_", type(exc).__name__).lower()
    return status, {"error": {"code": code, "message": message or DEFAULT_MESSAGES[status], "fields": fields}}
