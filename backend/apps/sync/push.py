"""Push: a batch of the athlete's actions, in the order they happened (docs/EXPO_MIGRATION.md,
"Push").

- Each action runs in its own transaction with the athlete's row locked, so one athlete's
  pushes run one at a time, and its result is stored under the phone's action id. The same
  action again (a retry after a lost answer) returns the stored result and changes nothing.
- A permanent rejection (invalid, not allowed, not found, rate-limited) is stored too: the
  phone drops that action, and the batch carries on.
- Anything else (a server error, the database going away) is temporary: nothing is stored
  for it, and the batch stops there so the phone retries it and what follows, in order.
- A session started offline that another device had already started keeps the server's
  ids; the actions after it in the batch are rewritten to them (actions.ALIASES).
"""

import datetime
import logging

import pydantic
from django.core.exceptions import ObjectDoesNotExist
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone

from apps.core import errors
from apps.core import models as core

from .actions import ACTIONS, ALIASES
from .models import SyncAction

logger = logging.getLogger(__name__)
PERMANENT = (
    errors.Invalid,
    errors.NotFound,
    errors.Conflict,
    errors.Gone,
    errors.PaymentRequired,
    errors.TooMany,
    ObjectDoesNotExist,
    pydantic.ValidationError,
    DjangoValidationError,
)
MAX_BATCH = 200
OLDEST = datetime.timedelta(days=30)  # an action's time is trusted this far back


def _error(exc):
    if isinstance(exc, pydantic.ValidationError):
        fields = {".".join(str(p) for p in e["loc"]): e["msg"] for e in exc.errors()}
        return {"code": "invalid_payload", "message": errors.DEFAULT_MESSAGES[400], "fields": fields}
    if isinstance(exc, ObjectDoesNotExist):
        return {"code": "not_found", "message": errors.DEFAULT_MESSAGES[404], "fields": {}}
    if isinstance(exc, DjangoValidationError):
        return {"code": "invalid", "message": " ".join(exc.messages), "fields": {}}
    return errors.describe(exc)[1]["error"]


def _day(athlete, at):
    """The athlete's date when they did it: from the action's time if it's believable."""
    now = timezone.now()
    if at is None or not now - OLDEST <= at <= now + datetime.timedelta(minutes=10):
        return athlete.today()
    return timezone.localdate(at, athlete.user.zoneinfo)


def _stored(row):
    if row.ok:
        return {"id": str(row.pk), "status": "done", "result": row.result}
    return {"id": str(row.pk), "status": "rejected", "error": row.result}


def _run(athlete, action):
    """(outcome dict, stop?) for one action."""
    action_id = action["id"]
    try:
        with transaction.atomic():
            core.lock(athlete)
            done = SyncAction.objects.filter(pk=action_id).first()
            if done is not None:
                if done.athlete_id != athlete.pk:
                    raise errors.NotFound()
                return _stored(done), False
            name = action.get("name")
            if name not in ACTIONS:
                raise errors.Invalid({"name": f"Unknown action {name!r}."})
            schema, handler = ACTIONS[name]
            data = schema.model_validate(action.get("payload") or {})
            try:
                with transaction.atomic():  # a rejected action's own writes are undone
                    result = handler(athlete, data, _day(athlete, action.get("at")))
            except PERMANENT as exc:
                row = SyncAction.objects.create(
                    id=action_id, athlete=athlete, name=name, ok=False, result=_error(exc)
                )
                return _stored(row), False
            row = SyncAction.objects.create(id=action_id, athlete=athlete, name=name, ok=True, result=result)
            return _stored(row), False
    except PERMANENT as exc:  # a bad envelope, or someone else's action id: not stored
        return {"id": str(action_id), "status": "rejected", "error": _error(exc)}, False
    except Exception:
        logger.exception("sync: action %s (%s) failed; the phone will retry", action_id, action.get("name"))
        return {"id": str(action_id), "status": "retry"}, True


def _aliased(value, aliases):
    """`value` with every id in `aliases` replaced, however deep."""
    if isinstance(value, dict):
        return {k: _aliased(v, aliases) for k, v in value.items()}
    if isinstance(value, list):
        return [_aliased(v, aliases) for v in value]
    return aliases.get(str(value), value) if aliases else value


def push(athlete, actions):
    """[{id, status: done|rejected|retry, result|error}] for each action, in order. After a
    "retry" the rest aren't run: they come back as "retry" too."""
    if len(actions) > MAX_BATCH:
        raise errors.Invalid({"actions": f"Send at most {MAX_BATCH} actions at a time."})
    results, stopped, aliases = [], False, {}
    for action in actions:
        if stopped:
            results.append({"id": str(action["id"]), "status": "retry"})
            continue
        payload = _aliased(action.get("payload") or {}, aliases)
        outcome, stopped = _run(athlete, {**action, "payload": payload})
        results.append(outcome)
        if outcome["status"] == "done" and action.get("name") in ALIASES:
            aliases.update(ALIASES[action["name"]](payload, outcome["result"]))
    return results
