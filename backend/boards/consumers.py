from channels.generic.websocket import AsyncJsonWebsocketConsumer


class BoardConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.board_id = self.scope["url_route"]["kwargs"]["board_id"]
        self.board_group_name = f"board_{self.board_id}"

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
        await self.send_json({"type": event_type, "data": payload})
