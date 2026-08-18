import uuid

from django.conf import settings
from django.db import models


class Board(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class Card(models.Model):
    class Column(models.TextChoices):
        TODO = "todo", "To Do"
        DOING = "doing", "Doing"
        DONE = "done", "Done"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    board = models.ForeignKey(
        Board, on_delete=models.CASCADE, related_name="cards"
    )
    title = models.CharField(max_length=300)
    column = models.CharField(
        max_length=20, choices=Column.choices, default=Column.TODO
    )
    position = models.FloatField(default=0.0)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        on_delete=models.SET_NULL,
        related_name="cards_created",
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        on_delete=models.SET_NULL,
        related_name="cards_updated",
    )
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="assigned_cards",
    )

    def __str__(self):
        return self.title
