"""The trigger that fills sync.Change, for every table apps/core/sync.py lists as synced.
Installed by migration 0001; tests/unit/test_sync_changes.py fails for a synced table
without it (add it with a migration calling `install(apps, schema_editor, [labels])`)."""

from apps.core import sync

FUNCTION = """
CREATE OR REPLACE FUNCTION sync_log_change() RETURNS trigger AS $$
DECLARE
    new_row jsonb;
    old_row jsonb;
    owner_athlete uuid;
    owner_gym uuid;
BEGIN
    IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
    IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;
    -- An update that moves a row to another owner: a delete for the old one first.
    IF TG_OP = 'UPDATE' AND (
        old_row->>TG_ARGV[0] IS DISTINCT FROM new_row->>TG_ARGV[0]
        OR old_row->>TG_ARGV[1] IS DISTINCT FROM new_row->>TG_ARGV[1]
    ) THEN
        INSERT INTO sync_change (txid, "table", row_id, op, athlete_id, gym_id, at)
        VALUES (pg_current_xact_id()::text::bigint, TG_TABLE_NAME, (old_row->>'id')::uuid, 'D',
                (old_row->>TG_ARGV[0])::uuid, (old_row->>TG_ARGV[1])::uuid, now());
    END IF;
    IF TG_OP = 'DELETE' THEN new_row := old_row; END IF;
    owner_athlete := (new_row->>TG_ARGV[0])::uuid;
    owner_gym := (new_row->>TG_ARGV[1])::uuid;
    INSERT INTO sync_change (txid, "table", row_id, op, athlete_id, gym_id, at)
    VALUES (pg_current_xact_id()::text::bigint, TG_TABLE_NAME, (new_row->>'id')::uuid, left(TG_OP, 1),
            owner_athlete, owner_gym, now());
    RETURN NULL;
END
$$ LANGUAGE plpgsql;
"""

TRIGGER = "sync_change"


def labels():
    return sync.BY_ATHLETE + sync.BY_GYM + sync.BY_GYM_OR_ATHLETE


def owner_columns(label):
    """(athlete column, gym column) the trigger reads; a missing one is 'none'."""
    if label in sync.BY_ATHLETE:
        return "athlete_id", "none"
    if label in sync.BY_GYM:
        return "none", "gym_id"
    return "athlete_id", "gym_id"


def install(apps, schema_editor, only=None):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(FUNCTION)
        for label in only or labels():
            table = apps.get_model(label)._meta.db_table
            athlete, gym = owner_columns(label)
            cursor.execute(f'DROP TRIGGER IF EXISTS {TRIGGER} ON "{table}"')
            cursor.execute(
                f'CREATE TRIGGER {TRIGGER} AFTER INSERT OR UPDATE OR DELETE ON "{table}" '
                f"FOR EACH ROW EXECUTE FUNCTION sync_log_change('{athlete}', '{gym}')"
            )


def uninstall(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        for label in labels():
            cursor.execute(f'DROP TRIGGER IF EXISTS {TRIGGER} ON "{apps.get_model(label)._meta.db_table}"')
        cursor.execute("DROP FUNCTION IF EXISTS sync_log_change()")
