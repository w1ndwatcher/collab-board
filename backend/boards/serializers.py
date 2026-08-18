from rest_framework import serializers

from .models import Board, Card


class CardSerializer(serializers.ModelSerializer):
    class Meta:
        model = Card
        fields = ["id", "board", "title", "column", "position", "updated_at"]
        read_only_fields = ["id", "updated_at"]


class BoardSerializer(serializers.ModelSerializer):
    cards = CardSerializer(many=True, read_only=True)

    class Meta:
        model = Board
        fields = ["id", "name", "created_at", "cards"]
        read_only_fields = ["id", "created_at"]
