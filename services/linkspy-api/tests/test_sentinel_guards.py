"""Sentinel guards — the pure verdicts, tested without a network."""
from sentinel_guards import (registrable_candidates, parse_rdap, dns_snapshot, dns_drift,
                             spf_verdict, dmarc_verdict, email_verdict, security_verdict,
                             seo_verdict, a11y_verdict, guard_cards, guard_alerts)


# ─── the registrable domain ────────────────────────────────────────────────
def test_www_is_walked_down_to_the_registration_rdap_knows():
    # The domain card showed "unavailable" for every site registered with www:
    # RDAP has no record for www.apexure.com, only for apexure.com.
    assert registrable_candidates("www.apexure.com") == ["www.apexure.com", "apexure.com"]
    assert registrable_candidates("apexure.com") == ["apexure.com"]
    assert registrable_candidates("shop.example.co.uk") == ["shop.example.co.uk", "example.co.uk"]
    assert registrable_candidates("www.shop.example.com.au")[-1] == "example.com.au"


def test_things_that_are_not_domains_are_not_looked_up():
    assert registrable_candidates("localhost") == []
    assert registrable_candidates("127.0.0.1") == []
    assert registrable_candidates("") == []
    assert registrable_candidates("Example.COM.") == ["example.com"]


def test_rdap_gives_expiry_and_registrar_and_never_invents_either():
    data = {"events": [{"eventAction": "registration", "eventDate": "2016-01-01T00:00:00Z"},
                       {"eventAction": "expiration", "eventDate": "2027-03-04T12:00:00Z"}],
            "entities": [{"roles": ["registrar"], "vcardArray": ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Cloudflare, Inc."]]]}]}
    exp, reg = parse_rdap(data)
    assert exp.startswith("2027-03-04")
    assert reg == "Cloudflare, Inc."
    assert parse_rdap({"events": [{"eventAction": "registration", "eventDate": "2016-01-01T00:00:00Z"}]}) == (None, None)
    assert parse_rdap({}) == (None, None)


# ─── DNS drift ─────────────────────────────────────────────────────────────
def test_a_snapshot_is_normalised_so_order_and_case_cannot_read_as_change():
    a = dns_snapshot(ns=["NS2.Example.com.", "ns1.example.com"], a=["1.2.3.4"], mx=["10 mail.example.com."])
    b = dns_snapshot(ns=["ns1.example.com", "ns2.example.com"], a=["1.2.3.4"], mx=["10 mail.example.com"])
    assert dns_drift(a, b) == []


def test_a_nameserver_change_is_drift_and_a_resolver_outage_is_not():
    before = dns_snapshot(ns=["ns1.old.com", "ns2.old.com"], a=["1.2.3.4"], mx=[], www_cname=["old.com"])
    moved = dns_snapshot(ns=["a.new.net", "b.new.net"], a=["1.2.3.4"], mx=[], www_cname=["old.com"])
    assert dns_drift(before, moved) == [("ns", ["ns1.old.com", "ns2.old.com"], ["a.new.net", "b.new.net"])]
    outage = dns_snapshot(ns=None, a=["1.2.3.4"], mx=[], www_cname=["old.com"])
    assert dns_drift(before, outage) == [], "a lookup that did not answer must never read as a migration"
    assert dns_drift(None, moved) == [], "a first snapshot has nothing to drift from"


# ─── email ─────────────────────────────────────────────────────────────────
def test_spf_reads_the_all_mechanism_and_counts_records():
    assert spf_verdict(["v=spf1 include:_spf.google.com ~all"]) == ("ok", "SPF: ~all")
    assert spf_verdict(["v=spf1 ip4:1.2.3.4 -all"]) == ("ok", "SPF: -all")
    assert spf_verdict(["v=spf1 +all"])[0] == "warn"
    assert spf_verdict(["some other txt"]) == ("warn", "SPF: none")
    assert spf_verdict(["v=spf1 -all", "v=spf1 ~all"])[0] == "critical"
    assert spf_verdict(None) == ("unknown", "SPF: unavailable")


def test_dmarc_reads_the_policy():
    assert dmarc_verdict(["v=DMARC1; p=quarantine; sp=none; rua=mailto:x@y"]) == ("ok", "DMARC: p=quarantine")
    assert dmarc_verdict(["v=DMARC1; p=reject"]) == ("ok", "DMARC: p=reject")
    assert dmarc_verdict(["v=DMARC1; p=none; rua=mailto:x@y"]) == ("notice", "DMARC: p=none (monitoring only)")
    assert dmarc_verdict([]) == ("warn", "DMARC: none")
    assert dmarc_verdict(None)[0] == "unknown"


def test_email_card_is_the_worst_of_its_parts_but_a_domain_with_no_mail_is_not_punished():
    overall, checks = email_verdict(["1 aspmx.l.google.com"], ["v=spf1 include:_spf.google.com ~all"], ["v=DMARC1; p=quarantine"], "google")
    assert overall == "ok"
    assert [c["status"] for c in checks] == ["ok", "ok", "ok", "ok"]
    overall, _ = email_verdict(["1 aspmx.l.google.com"], ["v=spf1 ~all"], [], None)
    assert overall == "warn", "no DMARC on a mail domain lands leads in spam"
    overall, checks = email_verdict([], [], [], None)
    assert overall == "notice", "no MX means the domain does not receive mail; that is a note, not a fault"
    overall, _ = email_verdict(None, None, None, None)
    assert overall == "unknown"


# ─── security ──────────────────────────────────────────────────────────────
GOOD = {"Strict-Transport-Security": "max-age=31536000; includeSubDomains", "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin"}


def test_a_well_set_up_site_is_all_clear():
    overall, checks = security_verdict(GOOD, "<html><script src='https://cdn.x/a.js'></script></html>", {"status": 301, "location": "https://example.com/"})
    assert overall == "ok", checks


def test_plain_http_served_without_a_redirect_is_critical():
    overall, checks = security_verdict(GOOD, "<html></html>", {"status": 200, "location": None})
    assert overall == "critical"
    assert next(c for c in checks if c["key"] == "https")["status"] == "critical"


def test_active_mixed_content_is_critical_and_passive_is_a_warning():
    overall, checks = security_verdict(GOOD, '<script src="http://cdn.x/a.js"></script>', {"status": 301, "location": "https://x/"})
    assert overall == "critical"
    overall, checks = security_verdict(GOOD, '<img src="http://cdn.x/a.png">', {"status": 301, "location": "https://x/"})
    assert overall == "warn"


def test_missing_headers_are_warnings_or_notices_never_critical():
    overall, checks = security_verdict({}, "<html></html>", {"status": 301, "location": "https://x/"})
    assert overall == "warn"
    assert next(c for c in checks if c["key"] == "hsts")["text"] == "HSTS: missing"
    assert next(c for c in checks if c["key"] == "csp")["status"] == "warn"
    overall, checks = security_verdict({"strict-transport-security": "max-age=300"}, "<html></html>", {"status": 301, "location": "https://x/"})
    assert next(c for c in checks if c["key"] == "hsts")["status"] == "notice"


def test_what_could_not_be_reached_is_unknown_not_bad():
    overall, checks = security_verdict(GOOD, None, None)
    assert next(c for c in checks if c["key"] == "https")["status"] == "unknown"
    assert next(c for c in checks if c["key"] == "mixed")["status"] == "unknown"
    assert overall == "ok", "the headers that were read are fine; the unknowns do not vote"


# ─── seo ───────────────────────────────────────────────────────────────────
PAGE = """<html lang="en"><head><title>Radiant heating for real homes — WBI</title>
<meta name="description" content="Pre-assembled boiler boards and complete hydronic mechanical packages, engineered and shipped ready to install.">
<link rel="canonical" href="https://wbiwarm.com/wbi-mechanical-systems/">
<meta property="og:title" content="x"><meta property="og:description" content="y"><meta property="og:image" content="https://wbiwarm.com/i.jpg">
</head><body><h1>Radiant Heating</h1><h2>Boards</h2><img src="a.jpg" alt="A board"><a href="/q">Request a quote</a>
<label for="e">Email</label><input id="e" type="email"></body></html>"""


def test_a_described_homepage_is_all_clear():
    overall, checks = seo_verdict(PAGE, "https://wbiwarm.com/wbi-mechanical-systems/")
    assert overall == "ok", checks


def test_seo_names_what_is_missing_and_is_never_critical():
    overall, checks = seo_verdict("<html><head></head><body><h1>a</h1><h1>b</h1></body></html>", "https://x.test/")
    assert overall == "warn"
    by = {c["key"]: c for c in checks}
    assert by["title"]["text"] == "Title: missing"
    assert by["description"]["text"] == "Meta description: missing"
    assert by["h1"]["text"] == "H1: 2"
    assert by["canonical"]["status"] == "notice"
    assert "missing title, description, image" in by["og"]["text"]


def test_a_canonical_on_another_host_is_a_warning():
    html = '<html><head><title>Ten chars ok</title><meta name="description" content="' + "d" * 60 + '"><link rel="canonical" href="https://elsewhere.com/"></head><body><h1>x</h1></body></html>'
    _, checks = seo_verdict(html, "https://x.test/")
    assert next(c for c in checks if c["key"] == "canonical")["status"] == "warn"


def test_seo_unavailable_when_the_page_could_not_be_read():
    assert seo_verdict(None, "https://x.test/")[0] == "unknown"


# ─── a11y ──────────────────────────────────────────────────────────────────
def test_an_accessible_homepage_is_all_clear():
    overall, checks = a11y_verdict(PAGE)
    assert overall == "ok", checks


def test_a11y_counts_the_faults_and_ignores_decorative_images():
    html = """<html><body><img src="a.jpg"><img src="b.jpg" role="presentation"><img src="c.jpg" alt="">
    <input type="text" name="q"><input type="hidden" name="t"><a href="/x"></a><button><svg></svg></button>
    <h1>One</h1><h3>Skipped</h3><div id="d"></div><div id="d"></div></body></html>"""
    overall, checks = a11y_verdict(html)
    by = {c["key"]: c for c in checks}
    assert by["alt"]["text"] == "Images: 1 of 2 without alt", "alt='' is a deliberate empty alt; role=presentation is decorative"
    assert by["labels"]["text"] == "Form fields: 1 of 1 without a label"
    assert by["names"]["text"] == "Links and buttons: 2 with no accessible name"
    assert by["lang"]["status"] == "warn"
    assert by["headings"]["text"] == "Headings: 1 level skipped"
    assert by["ids"]["text"] == "Ids: 1 duplicated"
    assert overall == "warn"


# ─── cards and alerts ──────────────────────────────────────────────────────
def test_cards_read_unavailable_until_a_guard_has_run():
    cards = guard_cards({})
    assert [c["key"] for c in cards] == ["dns", "email", "security", "seo", "a11y"]
    assert all(c["escalation"] == "unknown" and c["fact"] == "unavailable" for c in cards)


def test_cards_summarise_the_worst_and_say_what_it_is():
    g = {"dns": {"snapshot": dns_snapshot(ns=["ns1.x", "ns2.x"], a=["1.1.1.1"], mx=[], www_cname=[]), "registrar": "Cloudflare, Inc.", "last_drift": []},
         "email": {"overall": "warn", "checks": [{"key": "mx", "status": "ok", "text": "MX: aspmx.l.google.com"}, {"key": "dmarc", "status": "warn", "text": "DMARC: none"}]},
         "security": {"overall": "ok", "checks": [{"key": "hsts", "status": "ok", "text": "HSTS: set"}]}}
    by = {c["key"]: c for c in guard_cards(g)}
    assert by["dns"]["fact"] == "Steady" and by["dns"]["escalation"] == "ok" and by["dns"]["detail"] == "2 nameservers · Cloudflare, Inc."
    assert by["email"]["fact"] == "1 to fix" and by["email"]["detail"] == "DMARC: none"
    assert by["security"]["fact"] == "All clear"
    assert by["seo"]["fact"] == "unavailable"


def test_dns_that_moved_is_a_critical_card_and_an_alert():
    g = {"dns": {"snapshot": dns_snapshot(ns=["a.new.net"]), "last_drift": [["ns", ["ns1.old.com"], ["a.new.net"]]]}}
    card = guard_cards(g)[0]
    assert card["escalation"] == "critical" and card["fact"] == "Changed"
    alerts = guard_alerts({}, g, "example.com")
    assert alerts == [":rotating_light: *Nameservers changed* — example.com: ns1.old.com → a.new.net"]


def test_alerts_fire_only_when_a_guard_gets_worse():
    prev = {"email": {"overall": "ok", "checks": []}, "seo": {"overall": "warn", "checks": [{"key": "title", "status": "warn", "text": "Title: missing"}]}}
    cur = {"email": {"overall": "warn", "checks": [{"key": "dmarc", "status": "warn", "text": "DMARC: none"}]},
           "seo": {"overall": "warn", "checks": [{"key": "title", "status": "warn", "text": "Title: missing"}]}}
    alerts = guard_alerts(prev, cur, "example.com")
    assert alerts == [":warning: *Email authentication got worse* — DMARC: none · example.com"], "seo was already warn: no alarm"
    assert guard_alerts({}, cur, "example.com") == [], "a first run is a report, not an alarm"


# ─── the summary carries the guards ────────────────────────────────────────
def test_summarize_carries_the_five_guard_cards_unavailable_until_they_run():
    from sentinel import summarize_sentinel
    out = summarize_sentinel({"ssl_expiry": None, "domain_expiry": None}, [])
    keys = [c["key"] for c in out["cards"]]
    assert set(keys) >= {"ssl", "domain", "index", "uptime", "dns", "email", "security", "seo", "a11y"}
    for k in ("dns", "email", "security", "seo", "a11y"):
        card = next(c for c in out["cards"] if c["key"] == k)
        assert card["fact"] == "unavailable" and card["escalation"] == "unknown"
    assert out["all_clear"] is False


def test_a_critical_guard_sorts_first_and_makes_the_worst():
    from sentinel import summarize_sentinel
    guards = {"security": {"overall": "critical", "checks": [{"key": "https", "status": "critical", "text": "HTTP → HTTPS: the plain http:// page is served without a redirect"}]}}
    out = summarize_sentinel({"guards": guards}, [])
    assert out["cards"][0]["key"] == "security"
    assert out["worst"] == "critical"
