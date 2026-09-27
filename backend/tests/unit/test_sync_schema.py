"""shared/sync-schema.json: the phone's tables, generated from what pull sends."""

import pytest

from apps.sync import scope
from apps.sync.schema import PATH, column_type, schema_text


def test_the_committed_sync_schema_is_current():
    """Also fails for a synced field whose type the phone has no column for."""
    fix = "run: python manage.py sync_schema, then npm run db:schema in app/"
    assert PATH.read_text() == schema_text(), fix


def test_every_row_pull_sends_has_exactly_the_schemas_columns():
    for label in [*scope.ATHLETE, *scope.LIBRARY]:
        names = [f.attname for f in scope.fields(label)]
        assert "id" in names and len(names) == len(set(names)), label


def test_an_unknown_field_type_is_refused():
    from django.db import models

    field = models.DurationField(name="span")
    field.model = type("Odd", (), {})  # a field on no real model: nothing is registered
    with pytest.raises(ValueError, match="Odd.span: no phone column type for DurationField"):
        column_type(field)
