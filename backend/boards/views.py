import json
import requests

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from rest_framework import generics, permissions, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import Board, Card
from .serializers import BoardSerializer, CardSerializer
from dotenv import load_dotenv
from django.utils import timezone
from rest_framework.throttling import UserRateThrottle

load_dotenv()

class SummaryRateThrottle(UserRateThrottle):
    scope = "summary"

class EmailTokenObtainPairSerializer(TokenObtainPairSerializer):
    username_field = "email"

    def validate(self, attrs):
        user = authenticate(
            username=attrs["email"], password=attrs["password"]
        )
        if user is None or not user.is_active:
            raise serializers.ValidationError(
                "No active account found with the given credentials"
            )
        refresh = RefreshToken.for_user(user)
        return {"access": str(refresh.access_token), "refresh": str(refresh)}


class EmailTokenObtainPairView(TokenObtainPairView):
    serializer_class = EmailTokenObtainPairSerializer


class RegisterSerializer(serializers.ModelSerializer):
    name = serializers.CharField(
        max_length=150, write_only=True, required=True, allow_blank=False
    )
    email = serializers.EmailField(write_only=True)
    password = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = ["name", "email", "password"]

    def validate_email(self, value):
        value = value.strip().lower()
        try:
            validate_email(value)
        except ValidationError:
            raise serializers.ValidationError(
                "Please enter a valid email address."
            )
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError(
                "An account with this email already exists."
            )
        return value

    def validate_name(self, value):
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError(
                "Name must be at least 2 characters."
            )
        if not any(ch.isalnum() for ch in value):
            raise serializers.ValidationError(
                "Name must contain letters or numbers."
            )
        return value

    def validate_password(self, value):
        try:
            validate_password(value)
        except ValidationError as exc:
            raise serializers.ValidationError(list(exc.messages))
        return value

    def create(self, validated_data):
        email = validated_data["email"]
        return User.objects.create_user(
            username=email,
            email=email,
            password=validated_data["password"],
            first_name=validated_data["name"],
        )


class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]
    authentication_classes = []


class UserListSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source="first_name", read_only=True)

    class Meta:
        model = User
        fields = ["id", "email", "name"]


class UserListView(generics.ListAPIView):
    queryset = User.objects.all()
    serializer_class = UserListSerializer
    permission_classes = [permissions.IsAuthenticated]


class BoardViewSet(viewsets.ModelViewSet):
    queryset = Board.objects.all()
    serializer_class = BoardSerializer
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=True, methods=["post"], throttle_classes=[SummaryRateThrottle])
    def summary(self, request, pk=None):
        board = self.get_object()
        cards = board.cards.all()
        latest_update = cards.order_by("-updated_at").values_list(
            "updated_at", flat=True
        ).first()
        # Serve the cached summary if nothing on the board changed since it 
        # was generated — avoids burning API calls/quota unnecessarily.
        if (
            board.last_summary
            and board.last_summary_at
            and (latest_update is None or latest_update <= board.last_summary_at)
        ):
            return Response({"summary": board.last_summary, "cached": True})
        titles = {"todo": [], "doing": [], "done": []}
        assignments = {}
        for card in cards:
            titles.setdefault(card.column, []).append(card.title)
            if card.assignee:
                who = card.assignee.first_name or card.assignee.email
                assignments.setdefault(who, []).append(card.title)

        if not settings.AI_API_KEY:
            return Response(
                {
                    "detail": (
                        "AI summaries are not configured. "
                        "Set the AI_API_KEY environment variable on the server."
                    )
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        prompt = (
            f"Board name: {board.name}\n"
            f"Total cards: {cards.count()}\n"
            f"To Do ({len(titles['todo'])}): "
            f"{', '.join(titles['todo']) or 'none'}\n"
            f"In Progress ({len(titles['doing'])}): "
            f"{', '.join(titles['doing']) or 'none'}\n"
            f"Done ({len(titles['done'])}): "
            f"{', '.join(titles['done']) or 'none'}\n"
            f"Assignments: {assignments or 'none'}\n\n"
            "Write a concise summary of this board covering progress, "
            "completed/in-progress/pending work, assignments, and useful "
            "insights. Use plain text. Keep it within 250 words."
        )

        try:
            # print("DEBUG:", settings.AI_API_URL, settings.AI_MODEL, settings.AI_API_KEY[:10])
            text = self._call_ai(prompt)
        except Exception as exc:
            return Response(
                {"detail": f"Could not generate the summary: {exc}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        board.last_summary = text
        board.last_summary_at = timezone.now()
        board.save(update_fields=["last_summary", "last_summary_at"])
        return Response({"summary": text, "cached": False})

    def _call_ai(self, prompt):
        response = requests.post(
            settings.AI_API_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {settings.AI_API_KEY}",
            },
            json={
                "model": settings.AI_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.5,
            },
            timeout=60,
        )
        if response.status_code != 200:
            raise Exception(
                f"AI API returned {response.status_code}: {response.text}"
            )
        data = response.json()
        return data["choices"][0]["message"]["content"].strip()


class CardViewSet(viewsets.ModelViewSet):
    queryset = Card.objects.select_related("board")
    serializer_class = CardSerializer
    permission_classes = [permissions.IsAuthenticated]

    def _broadcast(self, board_id, event_type, data):
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f"board_{board_id}",
            {"type": event_type, "data": data},
        )

    def perform_create(self, serializer):
        card = serializer.save(
            created_by=self.request.user, updated_by=self.request.user
        )
        self._broadcast(
            card.board_id, "card_created", CardSerializer(card).data
        )

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        partial = kwargs.pop("partial", False)
        serializer = self.get_serializer(
            instance, data=request.data, partial=partial
        )

        expected = request.data.get("expected_updated_at")
        if expected is not None:
            current = CardSerializer(instance).data["updated_at"]
            if expected != current:
                return Response(
                    CardSerializer(instance).data,
                    status=status.HTTP_409_CONFLICT,
                )

        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=self.request.user)
        moved = "column" in serializer.validated_data or (
            "position" in serializer.validated_data
        )
        event_type = "card_moved" if moved else "card_updated"
        self._broadcast(
            instance.board_id,
            event_type,
            CardSerializer(instance).data,
        )
        return Response(CardSerializer(instance).data)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        board_id = instance.board_id
        card_id = str(instance.id)
        self.perform_destroy(instance)
        self._broadcast(board_id, "card_deleted", {"id": card_id})
        return Response(status=status.HTTP_204_NO_CONTENT)
