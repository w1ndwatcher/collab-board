from django.contrib import admin
from django.urls import include, path
from rest_framework_simplejwt.views import TokenRefreshView

from boards.views import (
    EmailTokenObtainPairView,
    RegisterView,
    UserListView,
)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/register/", RegisterView.as_view(), name="auth-register"),
    path("api/auth/login/", EmailTokenObtainPairView.as_view(), name="auth-login"),
    path(
        "api/auth/token/refresh/",
        TokenRefreshView.as_view(),
        name="auth-refresh",
    ),
    path("api/auth/users/", UserListView.as_view(), name="auth-users"),
    path("api/", include("boards.urls")),
]
