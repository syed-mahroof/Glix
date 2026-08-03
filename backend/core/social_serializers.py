"""
backend/core/social_serializers.py

Serializers for the follow graph, user search, and connections lists
(Phase 74). Not to be confused with core/social_auth.py, which is OAuth
identity linking (Google/Apple) — a completely different concept that
happens to share the word "social".

PublicUserSerializer is deliberately a plain serializers.Serializer, NOT
a ModelSerializer on UserProfile or User — a ModelSerializer with an
explicit field list is one careless `fields = "__all__"` away from
leaking email, reviews, or private lists. The public shape is built by
hand here instead.
"""

from rest_framework import serializers


class PublicUserSerializer(serializers.Serializer):
    """User search results + generic "public user" shape. `is_following`
    comes from a queryset annotation (search) or precomputed context set
    (list views) — see social_views.py for both patterns."""

    id = serializers.IntegerField()
    username = serializers.CharField()
    profile_picture = serializers.SerializerMethodField()
    is_following = serializers.SerializerMethodField()

    def get_profile_picture(self, obj):
        profile = getattr(obj, "profile", None)
        return profile.profile_picture if profile else None

    def get_is_following(self, obj):
        # UserSearchView annotates this directly onto the queryset (one
        # query, no per-row lookup). Falls back to context for call sites
        # that can't annotate the base queryset — see FollowEdgeSerializer.
        return getattr(obj, "is_following", False)


class FollowEdgeSerializer(serializers.Serializer):
    """
    Followers/following list rows. The base queryset is `Follow`, not
    `User` — context["edge_side"] ("follower" or "following") picks which
    side of the edge to serialize, since a followers list wants the
    *follower* user on each row and a following list wants the *following*
    user. is_following is resolved once per page by the view (a single
    `IN` query), passed in via context["is_following_ids"], not
    per-row — see FollowerListView/FollowingListView.
    """

    id = serializers.SerializerMethodField()
    username = serializers.SerializerMethodField()
    profile_picture = serializers.SerializerMethodField()
    is_following = serializers.SerializerMethodField()
    # Phase 75.6: your own row in your own followers/following list has
    # is_following always False (Follow's own follow_not_self constraint
    # forbids a self-follow row existing at all), which rendered a tappable
    # "Follow" button next to your own username that 400'd on press.
    # is_self lets the client render that row without a follow button
    # instead of inferring it client-side.
    is_self = serializers.SerializerMethodField()
    followed_at = serializers.DateTimeField(source="created_at")

    def _user(self, obj):
        side = self.context.get("edge_side", "follower")
        return obj.follower if side == "follower" else obj.following

    def get_id(self, obj):
        return self._user(obj).id

    def get_username(self, obj):
        return self._user(obj).username

    def get_profile_picture(self, obj):
        profile = getattr(self._user(obj), "profile", None)
        return profile.profile_picture if profile else None

    def get_is_following(self, obj):
        return self._user(obj).id in self.context.get("is_following_ids", set())

    def get_is_self(self, obj):
        return self._user(obj).id == self.context.get("viewer_id")
