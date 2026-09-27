import uuid


def parse(value):
    """`value` as a UUID, or None when it isn't one (ids posted from a form or the app)."""
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except ValueError:
        return None
