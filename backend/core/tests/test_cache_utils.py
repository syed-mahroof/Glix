"""
backend/core/tests/test_cache_utils.py

core/cache_utils.py exists specifically for the case a live Redis instance
can't reproduce on demand in CI: a mid-request Redis outage. Mocking
django.core.cache.cache to raise is the only practical way to prove the
degrade-to-miss behavior actually holds, short of killing the test
container's Redis mid-suite.
"""

from unittest.mock import patch

from redis.exceptions import ConnectionError as RedisConnectionError

from core.cache_utils import safe_cache_delete, safe_cache_get, safe_cache_set


def test_safe_cache_get_returns_default_on_redis_error():
    with patch("core.cache_utils.cache.get", side_effect=RedisConnectionError("down")):
        assert safe_cache_get("some-key") is None
        assert safe_cache_get("some-key", default="fallback") == "fallback"


def test_safe_cache_get_returns_real_value_when_redis_is_up():
    with patch("core.cache_utils.cache.get", return_value="real-value") as mock_get:
        assert safe_cache_get("some-key") == "real-value"
        mock_get.assert_called_once_with("some-key", None)


def test_safe_cache_set_swallows_redis_error():
    with patch("core.cache_utils.cache.set", side_effect=RedisConnectionError("down")):
        # Must not raise — a dropped cache write should never surface as a
        # request failure.
        safe_cache_set("some-key", {"a": 1}, timeout=60)


def test_safe_cache_delete_swallows_redis_error():
    with patch("core.cache_utils.cache.delete", side_effect=RedisConnectionError("down")):
        # Must not raise — signals.py calls this from an on_commit callback
        # after a write already succeeded; the invalidation failing must not
        # turn a successful mutation into a 500.
        safe_cache_delete("some-key")
