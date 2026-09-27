"""The change log phones pull from (docs/EXPO_MIGRATION.md, "Change tracking by Postgres
triggers"). Rows are written only by the `sync_log_change` trigger on each synced table
(migration 0001), so bulk updates and deletes are logged too. No foreign keys: a deleted
row's marker outlives it."""

from django.db import models


class Op(models.TextChoices):
    INSERT = "I", "Insert"
    UPDATE = "U", "Update"
    DELETE = "D", "Delete"


class Change(models.Model):
    seq = models.BigAutoField(primary_key=True)
    txid = models.BigIntegerField(db_index=True)  # the writing transaction (pg_current_xact_id)
    table = models.CharField(max_length=63)
    row_id = models.UUIDField()
    op = models.CharField(max_length=1, choices=Op.choices)
    athlete_id = models.UUIDField(null=True, db_index=True)
    gym_id = models.UUIDField(null=True, db_index=True)
    at = models.DateTimeField()

    class Meta:
        indexes = [
            models.Index(fields=["athlete_id", "txid"], name="change_by_athlete"),
            models.Index(fields=["gym_id", "txid"], name="change_by_gym"),
        ]

    def __str__(self):
        return f"{self.op} {self.table} {self.row_id}"
