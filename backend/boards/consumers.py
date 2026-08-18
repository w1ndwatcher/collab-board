import json

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from rest_framework.utils.encoders import JSONEncoder
from rest_framework_simplejwt.authentication import JWTAuthentication


class BoardConsumer(AsyncJsonWebsocketConsumer):
    @database_sync_to_async
    def _get_user_from_token(self, token):
        try:
            validated = JWTAuthentication().get_validated_token(token)
            user = JWTAuthentication().get_user(validated)
        except Exception:
            return None
        return user

    async def connect(self):
        self.board_id = self.scope["url_route"]["kwargs"]["board_id"]
        self.board_group_name = f"board_{self.board_id}"

        # Read the JWT access token from the connection URL query string.
        token = self.scope["query_string"].decode().split("token=")[-1]
        self.user = await self._get_user_from_token(token)
        if self.user is None:
            await self.close(code=4401)
            return

        await self.channel_layer.group_add(
            self.board_group_name, self.channel_name
        )
        await self.accept()

    async def disconnect(self, code):
        await self.channel_layer.group_discard(
            self.board_group_name, self.channel_name
        )

    async def receive_json(self, content, **kwargs):
        # The consumer focuses on broadcasting board events. Inbound client
        # messages are currently ignored; state changes flow through the
        # REST API which triggers the broadcast handlers below.
        pass

    async def card_created(self, event):
        await self._broadcast("card_created", event)

    async def card_updated(self, event):
        await self._broadcast("card_updated", event)

    async def card_moved(self, event):
        await self._broadcast("card_moved", event)

    async def card_deleted(self, event):
        await self._broadcast("card_deleted", event)

    async def _broadcast(self, event_type, event):
        payload = event.get("data", {})
        await self.send(
            text_data=json.dumps(
                {"type": event_type, "data": payload},
                cls=JSONEncoder,
            )
        )
