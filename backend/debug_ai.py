import os
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "collab_board.settings")
django.setup()

from django.conf import settings

print("=" * 50)
print("Django settings check")
print("=" * 50)
print("AI_API_URL:", settings.AI_API_URL)
print("AI_MODEL:", settings.AI_MODEL)
print("AI_API_KEY (first 10 chars):", settings.AI_API_KEY[:10] if settings.AI_API_KEY else "(EMPTY!)")
print()

print("=" * 50)
print("Direct API call test")
print("=" * 50)

import requests

response = requests.post(
    settings.AI_API_URL,
    headers={
        "Authorization": f"Bearer {settings.AI_API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "model": settings.AI_MODEL,
        "messages": [{"role": "user", "content": "say hi"}],
    },
)

print("Status code:", response.status_code)
print("Response body:", response.text)