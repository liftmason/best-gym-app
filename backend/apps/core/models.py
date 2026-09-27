import uuid

from django.db import models


class Model(models.Model):
    """Base for every table. Ids are UUIDv7: made on the phone as well as the server
    (offline sync), and time-ordered, so they index as well as integers."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)

    class Meta:
        abstract = True
