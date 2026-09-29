"""The rate limiter (apps/ratelimit): counters in their own table, one atomic statement per
hit (audit C1, C2, M25, T2)."""

import datetime
import threading

import pytest
from django.db import connection
from django.test import RequestFactory

from apps import ratelimit
from apps.accounts import metrics
from apps.ratelimit.models import Counter

pytestmark = pytest.mark.django_db


def test_a_window_keeps_counting_through_idle_minutes(frozen_clock):
    # C1: the cache-based counter forgot everything after 5 idle minutes.
    for _ in range(3):
        assert ratelimit.hit("t", "k", 3, 15 * 60)
    frozen_clock.shift(datetime.timedelta(minutes=10))
    assert not ratelimit.hit("t", "k", 3, 15 * 60)


def test_a_new_window_starts_once_the_old_one_ends(frozen_clock):
    for _ in range(3):
        ratelimit.hit("t", "k", 3, 60)
    frozen_clock.shift(datetime.timedelta(seconds=61))
    assert ratelimit.hit("t", "k", 3, 60)
    assert Counter.objects.get().count == 1


def test_many_other_keys_do_not_reset_a_counter():
    # C2: the database cache culled entries once it held 300 (the first keys in sort order).
    for _ in range(3):
        ratelimit.hit("t", "a-victim", 3, 900)
    for i in range(400):
        ratelimit.hit("t", f"junk{i}", 3, 900)
    assert not ratelimit.hit("t", "a-victim", 3, 900)


def test_long_keys_are_hashed():
    long_key = "x" * 1000 + "@example.com"
    assert ratelimit.hit("login-email", long_key, 1, 60)
    assert not ratelimit.hit("login-email", long_key, 1, 60)
    assert len(Counter.objects.get().key) <= 200


def test_expired_counters_are_purged(frozen_clock):
    ratelimit.hit("t", "old", 3, 60)
    ratelimit.hit("t", "new", 3, 3600)
    frozen_clock.shift(datetime.timedelta(minutes=5))
    assert ratelimit.purge() == 1
    assert Counter.objects.count() == 1


@pytest.mark.django_db(transaction=True)
def test_parallel_hits_are_all_counted():
    # Two workers counting at once must not lose updates (get-then-set did).
    threads, per_thread = 4, 25
    start = threading.Barrier(threads)

    def work():
        start.wait()
        try:
            for _ in range(per_thread):
                ratelimit.hit("t", "shared", 1000, 900)
        finally:
            connection.close()

    workers = [threading.Thread(target=work) for _ in range(threads)]
    for w in workers:
        w.start()
    for w in workers:
        w.join()
    assert Counter.objects.get().count == threads * per_thread


def test_the_client_address_is_the_one_the_proxy_appended():
    # A client can put anything at the front of X-Forwarded-For; Render appends the real one.
    request = RequestFactory().get("/", HTTP_X_FORWARDED_FOR="1.2.3.4, 203.0.113.7", REMOTE_ADDR="10.0.0.1")
    assert ratelimit.client_ip(request) == "203.0.113.7"
    assert ratelimit.client_ip(RequestFactory().get("/", REMOTE_ADDR="10.0.0.1")) == "10.0.0.1"


def test_on_render_the_visitor_is_the_address_its_edge_names(settings):
    # M24, checked live with LOG_CLIENT_IP: behind Render the last X-Forwarded-For entry is
    # Render's own (10.x), the same for everyone, so every visitor shared one limit. Render's
    # edge (Cloudflare) names the visitor in Cf-Connecting-Ip, overwriting anything sent.
    settings.CLIENT_IP_HEADER = "Cf-Connecting-Ip"
    seen = {"HTTP_X_FORWARDED_FOR": "71.184.230.155, 104.23.211.11, 10.24.32.58", "REMOTE_ADDR": "127.0.0.1"}
    request = RequestFactory().get("/", HTTP_CF_CONNECTING_IP="71.184.230.155", **seen)
    assert ratelimit.client_ip(request) == "71.184.230.155"
    # Without the header (a request that didn't come through the edge), the old rule applies.
    assert ratelimit.client_ip(RequestFactory().get("/", **seen)) == "10.24.32.58"


def test_the_named_header_is_ignored_unless_the_host_is_set_to_trust_it(settings):
    # Elsewhere anyone can send Cf-Connecting-Ip and pick their own rate-limit key.
    settings.CLIENT_IP_HEADER = ""
    request = RequestFactory().get("/", HTTP_CF_CONNECTING_IP="9.9.9.9", REMOTE_ADDR="10.0.0.1")
    assert ratelimit.client_ip(request) == "10.0.0.1"


def test_metrics_reminders_are_limited_per_athlete(athlete, mailoutbox):
    # M25: a coach could send any number of reminder emails.
    assert metrics.remind(athlete, "https://example.com")
    with pytest.raises(metrics.RemindedRecently):
        metrics.remind(athlete, "https://example.com")
    assert len(mailoutbox) == 1
