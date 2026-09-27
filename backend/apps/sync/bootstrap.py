"""Bootstrap: a new device's first copy of its scope, and the cursor to pull from after."""

from . import scope


def library_rows(gym):
    """Every library row of the gym, as pull sends them (the phone replaces its library)."""
    if gym is None:
        return []
    out = []
    for label in scope.LIBRARY:
        for obj in scope.visible(label, None, gym):
            out.append(
                {
                    "table": scope.table_of(label),
                    "id": str(obj.pk),
                    "op": "upsert",
                    "row": scope.serialize(label, obj),
                }
            )
    return out
