from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from rest_framework import generics, permissions, serializers, status, viewsets
from rest_framework.response import Response
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import Board, Card
from .serializers import BoardSerializer, CardSerializer


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
    password = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = ["name", "email", "password"]

    def create(self, validated_data):
        return User.objects.create_user(
            username=validated_data["email"],
            email=validated_data["email"],
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
