"""Write shared/sync-schema.json, the synced tables as the phone stores them (apps/sync/schema.py)."""

from django.core.management.base import BaseCommand

from apps.sync.schema import PATH, schema_text


class Command(BaseCommand):
    help = "Write shared/sync-schema.json for the app's local database."

    def handle(self, *args, **options):
        PATH.write_text(schema_text())
        self.stdout.write(f"wrote {PATH.name}")
