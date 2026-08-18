from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import BoardViewSet, CardViewSet

router = DefaultRouter()
router.register(r"boards", BoardViewSet, basename="board")
router.register(r"cards", CardViewSet, basename="card")

urlpatterns = [
    path("", include(router.urls)),
]
