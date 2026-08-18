from django.contrib.auth.models import User
from rest_framework import serializers

from .models import Board, Card


class CardSerializer(serializers.ModelSerializer):
    created_by = serializers.SerializerMethodField()
    updated_by = serializers.SerializerMethodField()
    assignee = serializers.SerializerMethodField()
    assignee_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(),
        source="assignee",
        write_only=True,
        required=False,
        allow_null=True,
    )

    class Meta:
        model = Card
        fields = [
            "id",
            "board",
            "title",
            "column",
            "position",
            "updated_at",
            "created_by",
            "updated_by",
            "assignee",
            "assignee_id",
        ]

    def get_created_by(self, obj):
        return self._user_summary(obj.created_by)

    def get_updated_by(self, obj):
        return self._user_summary(obj.updated_by)

    def get_assignee(self, obj):
        return self._user_summary(obj.assignee)

    def _user_summary(self, user):
        if user is None:
            return None
        return {
            "id": user.id,
            "email": user.email,
            "name": user.first_name,
        }


class BoardSerializer(serializers.ModelSerializer):
    cards = CardSerializer(many=True, read_only=True)

    class Meta:
        model = Board
        fields = ["id", "name", "created_at", "cards"]
        read_only_fields = ["id", "created_at"]
