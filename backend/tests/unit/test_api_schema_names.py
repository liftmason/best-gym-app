"""Schemas that share a name have the same fields. The OpenAPI document (and the app's types
generated from it) keeps one schema per name, so two different classes called `Move` in
different routers would silently publish only one of them, and the app would be typed
against the wrong one. Give a new schema a name of its own."""

import collections

from ninja import Schema

from apps.api.main import api


def _subclasses(cls):
    for sub in cls.__subclasses__():
        yield sub
        yield from _subclasses(sub)


def test_schemas_that_share_a_name_have_the_same_fields():
    assert api.urls  # every router is loaded
    shapes = collections.defaultdict(dict)
    for schema in _subclasses(Schema):
        if schema.__module__.startswith("apps."):
            shapes[schema.__name__][schema.__module__] = sorted(schema.model_fields)
    differing = {
        name: by_module
        for name, by_module in shapes.items()
        if len({tuple(fields) for fields in by_module.values()}) > 1
    }
    assert differing == {}
