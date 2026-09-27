"""The phone's copy of the synced tables, described for the app (shared/sync-schema.json).
The app generates its SQLite tables from this file (app/scripts/db-schema.mjs), so what
pull sends and what the phone stores can't drift apart: `manage.py sync_schema` rewrites
it, and tests fail on both sides until it's current.

Column types follow serialize(): ids, decimals, dates and times are text; JSON is text
holding JSON; booleans are integers the app reads as booleans.
"""

import json

from django.conf import settings

from . import scope

PATH = settings.BASE_DIR.parent / "shared" / "sync-schema.json"

# The shape of the phone's local database the server speaks to. Bump it when a synced table
# changes shape (this file then changes too); the server accepts this version and the one
# before, so phones not yet updated keep working for one release (docs/EXPO_MIGRATION.md,
# "Versioning").
SCHEMA_VERSION = 1

TEXT = {
    "CharField",
    "TextField",
    "EmailField",
    "SlugField",
    "URLField",
    "UUIDField",
    "DecimalField",
    "DateField",
    "DateTimeField",
    "TimeField",
    "ForeignKey",
    "OneToOneField",
}
INTEGER = {
    "IntegerField",
    "SmallIntegerField",
    "BigIntegerField",
    "PositiveIntegerField",
    "PositiveSmallIntegerField",
    "PositiveBigIntegerField",
}


def column_type(field):
    kind = field.get_internal_type()
    if kind in TEXT:
        return "text"
    if kind in INTEGER:
        return "integer"
    if kind == "BooleanField":
        return "boolean"
    if kind == "FloatField":
        return "real"
    if kind == "JSONField":
        return "json"
    raise ValueError(f"{field.model.__name__}.{field.name}: no phone column type for {kind}")


def describe():
    tables = []
    for group, labels in (("athlete", scope.ATHLETE), ("library", scope.LIBRARY)):
        for label in labels:
            tables.append(
                {
                    "name": scope.table_of(label),
                    "model": scope.model(label).__name__,
                    "scope": group,
                    "columns": [
                        {
                            "name": f.attname,
                            "type": column_type(f),
                            "nullable": f.null,
                            "index": f.is_relation,
                        }
                        for f in scope.fields(label)
                    ],
                }
            )
    return {"version": SCHEMA_VERSION, "tables": tables}


def schema_text():
    return json.dumps(describe(), indent=2) + "\n"
