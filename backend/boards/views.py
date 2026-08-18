from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from rest_framework import status, viewsets
from rest_framework.response import Response

from .models import Board, Card
from .serializers import BoardSerializer, CardSerializer


class BoardViewSet(viewsets.ModelViewSet):
    queryset = Board.objects.all()
    serializer_class = BoardSerializer


class CardViewSet(viewsets.ModelViewSet):
    queryset = Card.objects.select_related("board")
    serializer_class = CardSerializer

    def _broadcast(self, board_id, event_type, data):
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f"board_{board_id}",
            {"type": event_type, "data": data},
        )

    def perform_create(self, serializer):
        card = serializer.save()
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
        moved = "column" in serializer.validated_data or (
            "position" in serializer.validated_data
        )
        self.perform_update(serializer)
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
