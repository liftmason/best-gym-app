"""Write the API's OpenAPI schema to backend/openapi.json. The Expo app generates its
TypeScript types from it (sub-project 4); tests/unit/test_api.py fails when it's stale."""

import json

from django.conf import settings
from django.core.management.base import BaseCommand

from apps.api.main import api

PATH = settings.BASE_DIR / "openapi.json"


def schema_text():
    return json.dumps(api.get_openapi_schema(path_prefix="/api/v1"), indent=2, sort_keys=True) + "\n"


class Command(BaseCommand):
    help = "Write the API's OpenAPI schema to openapi.json."

    def handle(self, *args, **options):
        PATH.write_text(schema_text())
        self.stdout.write(f"wrote {PATH.name}")
