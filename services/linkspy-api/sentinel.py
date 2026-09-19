"""Disaster Sentinel: SSL / domain expiry, indexability, uptime.

The "nothing catastrophic without warning" tier. Two halves:
  • Pure logic (expiry-day math, escalation tiers, alert-ladder crossings,
    indexability verdict, downtime from pings, uptime %) — trivially testable.
  • Network probes (TLS handshake, RDAP, robots/noindex/sitemap, HEAD ping).

Honesty rules, hard: never fabricate an expiry date. Some TLDs hide domain
expiry over RDAP/WHOIS — that surfaces as "unavailable", not a guessed date.
An expiry we cannot read is `None`, and the UI says so.
"""
from datetime import datetime, timezone
from typing import NamedTuple


class SslProbe(NamedTuple):
    """What one TLS handshake told us. Every field defaults to None so a path
    that learned nothing cannot return the wrong number of values — the reason
    this is a type and not a tuple is that it already happened once: the
    success path kept returning three while the failure paths returned four,
    and run_sentinel_for_site would have raised for every VALID certificate,
    silently, because run_sentinel_all swallows per-site exceptions."""
    expiry: str = None
    issuer: str = None
    issued: str = None
    problem: str = None

# Alert ladder thresholds (days). Escalating copy at each; change-only.
LADDER = (30, 14, 3)

# A certificate short enough to be on an automated cycle. Let's Encrypt and
# Google Trust Services both issue 90 days; every certificate in the portfolio
# today is one of the two.
AUTOMATED_LIFETIME_DAYS = 100

# The rungs that still mean something for such a certificate. The 30-day rung
# is where these certs RENEW — ACME clients renew at a third of lifetime — so
# a warning there fires on every healthy cycle and means nothing. Worse, it is
# the only rung a healthy cert ever reaches: 14 and 3 are never crossed unless
# renewal has actually failed, which is why they are kept. At 10 days an ACME
# client has been retrying twice a day for twenty days; that is a real fault.
AUTOMATED_LADDER = (10, 3)

# A certificate that fails validation is the opposite of one we could not
# reach, and until now both read "unavailable" — so an expired certificate, the
# single disaster this tier exists to prevent, looked exactly like a network
# blip. OpenSSL's verify codes say which is which; the handshake that produced
# them proves a certificate was there to judge.
SSL_VERIFY_PROBLEMS = {
    10: "expired",              # certificate has expired
    12: "expired",              # CRL has expired
    18: "self-signed",          # self-signed certificate
    19: "untrusted root",       # self-signed certificate in chain
    20: "incomplete chain",     # unable to get local issuer certificate
    21: "incomplete chain",     # unable to verify the first certificate
    62: "hostname mismatch",    # not valid for the host we asked for
}

# What each means for a visitor, in the card's own voice.
SSL_PROBLEM_TEXT = {
    "expired": "the certificate has expired — browsers are refusing this site",
    "hostname mismatch": "the certificate is not valid for this hostname",
    "self-signed": "the certificate is self-signed — browsers refuse it",
    "untrusted root": "the chain ends in a root browsers do not trust",
    "incomplete chain": "the server does not send its intermediate certificate",
    "not trusted": "the certificate did not validate",
}


def _now(now=None):
    return now or datetime.now(timezone.utc)


def _dt(v):
    if not v:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def days_until(expiry, now=None):
    """Whole days until `expiry` (aware). None if expiry is unknown/unavailable.
    Uses calendar-day flooring so a cert expiring in 2h today reads as 0 days,
    not a misleading '1'."""
    d = _dt(expiry)
    if d is None:
        return None
    delta = d - _now(now)
    return int(delta.total_seconds() // 86400)


def cert_lifetime_days(issued, expiry):
    """Whole days the certificate was issued FOR. None when either end is
    unknown — and an unknown lifetime is never treated as automated, because
    suppressing a warning on a guess is how a manual renewal gets missed."""
    a, b = _dt(issued), _dt(expiry)
    if a is None or b is None:
        return None
    days = int((b - a).total_seconds() // 86400)
    return days if days > 0 else None


def is_automated(lifetime_days):
    """A certificate we KNOW renews itself. Unknown lifetime → False."""
    return lifetime_days is not None and lifetime_days <= AUTOMATED_LIFETIME_DAYS


def ladder_for(lifetime_days):
    return AUTOMATED_LADDER if is_automated(lifetime_days) else LADDER


def escalation(days, lifetime_days=None):
    """Visual/severity tier from days remaining. None → 'unknown' (honest).

    `lifetime_days` is how long the certificate was issued for, where we know
    it. A 90-day certificate at 30 days is mid-cycle, not expiring, so it stays
    green until the rungs that mean something."""
    if days is None:
        return "unknown"
    if is_automated(lifetime_days):
        # No "notice" tier: for a cert that renews itself there is nothing to
        # notice between issue and failure.
        if days <= AUTOMATED_LADDER[1]:
            return "critical"
        return "warn" if days <= AUTOMATED_LADDER[0] else "ok"
    if days <= 3:
        return "critical"
    if days <= 14:
        return "warn"
    if days <= 30:
        return "notice"
    return "ok"


def ladder_crossing(prev_days, days, lifetime_days=None):
    """The alert-ladder rung newly crossed downward since last check, or None.
    Change-only: fires once as the countdown passes each rung — 30/14/3 for a
    certificate renewed by hand, 10/3 for one that renews itself."""
    if days is None:
        return None
    # Report the smallest (most urgent) rung newly crossed downward.
    for t in sorted(ladder_for(lifetime_days)):
        if days <= t and (prev_days is None or prev_days > t):
            return t
    return None


def ssl_invalid_alert(prev_status, prev_guards, problem, host):
    """The Slack line for a certificate that WAS working and is now invalid,
    or None. Change-only, like the indexability alarm: the flip is the news,
    not the ongoing state. A site whose certificate was already invalid the
    first time we looked is a report, not an alarm — the same rule the guards
    use — because we cannot tell a new break from one that predates us."""
    if not problem:
        return None
    if (prev_guards or {}).get("ssl_problem"):
        return None                                   # already told them
    if (prev_status or {}).get("ssl_expiry") is None:
        return None                                   # never saw it working
    return (f":rotating_light: *SSL certificate is invalid* — "
            f"{SSL_PROBLEM_TEXT.get(problem, problem)} · {host}")


def indexability_verdict(robots_ok, meta_noindex, header_noindex, sitemap_ok):
    """Roll the trio into per-check + overall. A page kept OUT of the index
    (noindex, or robots blocking everything) is Critical; a missing/broken
    sitemap is a lesser notice (it doesn't deindex an existing page).

    Any arg may be None → 'unknown' for that check (couldn't determine)."""
    checks = []

    def add(key, label, ok, fail_sev, ok_text, fail_text):
        if ok is None:
            checks.append({"key": key, "label": label, "status": "unknown", "text": "Couldn't check"})
        elif ok:
            checks.append({"key": key, "label": label, "status": "ok", "text": ok_text})
        else:
            checks.append({"key": key, "label": label, "status": fail_sev, "text": fail_text})

    add("robots", "robots.txt", robots_ok, "critical",
        "robots.txt currently allows search engines", "robots.txt is blocking all crawlers")
    noindex = None if (meta_noindex is None and header_noindex is None) else bool(meta_noindex or header_noindex)
    add("noindex", "Index directive", (None if noindex is None else not noindex), "critical",
        "Homepage is indexable (no noindex)", "Homepage carries a noindex directive")
    add("sitemap", "Sitemap", sitemap_ok, "notice",
        "Sitemap returns 200 and parses", "Sitemap is missing or won't parse")

    order = {"critical": 0, "warn": 1, "notice": 2, "unknown": 3, "ok": 4}
    overall = min((c["status"] for c in checks), key=lambda s: order[s])
    return {"overall": overall, "checks": checks}


def downtime_state(pings):
    """`pings` newest-first list of bools (True=up). Down only after 2
    consecutive failures (a single blip is not an outage)."""
    if not pings or len(pings) < 2:
        return False
    return pings[0] is False and pings[1] is False


def uptime_pct(pings):
    """Rolling uptime % over the supplied ping window. None if no pings."""
    vals = [p for p in (pings or []) if p is not None]
    if not vals:
        return None
    up = sum(1 for p in vals if p)
    return round(up / len(vals) * 100, 2)


# ─── Network probes (best-effort; failures surface honestly as unknown) ──────
async def check_ssl(host, port=443, timeout=8):
    """An SslProbe: expiry, issuer, issued, problem — all None where unknown.

    `problem` separates the two opposite states that used to share the word
    "unavailable": a certificate we REACHED and judged invalid (expired,
    wrong host, self-signed, broken chain) versus a host we could not reach at
    all. Only OpenSSL's own verification failure counts as invalid — it is the
    one error that proves a certificate was presented. A timeout, a refused
    connection, a DNS failure or a bare handshake error stay unknown, because
    a flaky network must never be reported as a broken certificate."""
    import asyncio
    import ssl

    def _probe():
        import socket
        ctx = ssl.create_default_context()
        with socket.create_connection((host, port), timeout=timeout) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as ss:
                cert = ss.getpeercert()
        def _stamp(value):
            if not value:
                return None
            return datetime.strptime(value, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc).isoformat()
        exp = _stamp(cert.get("notAfter"))
        # notBefore comes from the same handshake: the lifetime it gives is
        # what tells an automated 90-day cert from a manual annual one.
        issued = _stamp(cert.get("notBefore"))
        issuer = ""
        for part in cert.get("issuer", ()):
            for k, v in part:
                if k == "organizationName":
                    issuer = v
        return SslProbe(exp, issuer or None, issued)

    try:
        return await asyncio.to_thread(_probe)
    except ssl.SSLCertVerificationError as e:
        # Deterministic: a certificate that fails validation fails it every
        # time, so there is nothing to retry and nothing ambiguous to report.
        return SslProbe(problem=SSL_VERIFY_PROBLEMS.get(getattr(e, "verify_code", None), "not trusted"))
    except Exception:
        return SslProbe()


async def check_domain_expiry(domain, client=None):
    """Domain expiry via RDAP. None when the TLD/registry hides it — shown as
    'unavailable', never faked."""
    import httpx
    own = client is None
    if own:
        client = httpx.AsyncClient(timeout=10, follow_redirects=True)
    # RDAP knows registrations, not hosts: for a site registered with its
    # www, `www.example.com` is a 404 there and the card read "unavailable"
    # for the life of the feature. Walk from the host down to the registrable
    # domain and take the first answer (sentinel_guards.registrable_candidates).
    from sentinel_guards import registrable_candidates, parse_rdap
    try:
        for cand in registrable_candidates(domain) or [domain]:
            try:
                r = await client.get(f"https://rdap.org/domain/{cand}")
            except Exception:
                continue
            if r.status_code != 200:
                continue
            expiry, _registrar = parse_rdap(r.json())
            return expiry
        return None
    except Exception:
        return None
    finally:
        if own:
            await client.aclose()


async def check_indexability(base_url, client=None):
    """(robots_ok, meta_noindex, header_noindex, sitemap_ok) — any may be None."""
    import re
    import httpx
    from urllib.parse import urljoin

    own = client is None
    if own:
        client = httpx.AsyncClient(timeout=12, follow_redirects=True,
                                   headers={"User-Agent": "LinkSpyBot/1.0"})
    robots_ok = meta_noindex = header_noindex = sitemap_ok = None
    try:
        # robots.txt — blocking-all = "User-agent: *" then "Disallow: /"
        try:
            rr = await client.get(urljoin(base_url, "/robots.txt"))
            if rr.status_code == 200:
                body = rr.text.lower()
                robots_ok = not re.search(r"user-agent:\s*\*\s*(?:#.*\n|\n)*\s*disallow:\s*/\s*$",
                                          body, re.MULTILINE)
            else:
                robots_ok = True  # no robots.txt = nothing blocked
        except Exception:
            robots_ok = None
        # homepage noindex — meta tag AND X-Robots-Tag header
        try:
            hr = await client.get(base_url)
            header_noindex = "noindex" in (hr.headers.get("x-robots-tag", "").lower())
            meta_noindex = bool(re.search(r'<meta[^>]+name=["\']robots["\'][^>]*content=["\'][^"\']*noindex',
                                          hr.text, re.IGNORECASE))
        except Exception:
            meta_noindex = header_noindex = None
        # sitemap
        try:
            sr = await client.get(urljoin(base_url, "/sitemap.xml"))
            sitemap_ok = sr.status_code == 200 and ("<urlset" in sr.text or "<sitemapindex" in sr.text)
        except Exception:
            sitemap_ok = None
        return robots_ok, meta_noindex, header_noindex, sitemap_ok
    finally:
        if own:
            await client.aclose()


async def ping(url, client=None, timeout=8):
    """True if the site answers a HEAD (or GET fallback) with < 500."""
    import httpx
    own = client is None
    if own:
        client = httpx.AsyncClient(timeout=timeout, follow_redirects=True)
    try:
        try:
            r = await client.head(url)
            if r.status_code >= 400:
                r = await client.get(url)
        except httpx.HTTPError:
            r = await client.get(url)
        return r.status_code < 500
    except Exception:
        return False
    finally:
        if own:
            await client.aclose()


def summarize_sentinel(status, pings, now=None):
    """Build the guard-cards payload from a stored status row + recent pings.
    Pure. `status` carries ssl_expiry/ssl_issuer/domain_expiry/robots_ok/
    meta_noindex/header_noindex/sitemap_ok/last_checked_at."""
    status = status or {}
    # How long this certificate was issued for, where a pass has recorded it
    # (sentinel_status.guards.ssl_cycle — migrations/026). Absent means we do
    # not know, and an unknown lifetime keeps the manual ladder.
    ssl_cycle = ((status.get("guards") or {}).get("ssl_cycle") or {})
    ssl_life = ssl_cycle.get("lifetime_days")
    ssl_problem = (status.get("guards") or {}).get("ssl_problem")
    ssl_days = days_until(status.get("ssl_expiry"), now)
    dom_days = days_until(status.get("domain_expiry"), now)
    idx = indexability_verdict(status.get("robots_ok"), status.get("meta_noindex"),
                               status.get("header_noindex"), status.get("sitemap_ok"))
    up_pct = uptime_pct(pings)
    down = downtime_state(pings)

    from sentinel_guards import guard_cards
    cards = [
        # An invalid certificate outranks any countdown: there is no number of
        # days left on a certificate browsers are already refusing.
        {"key": "ssl", "label": "SSL",
         "days": None if ssl_problem else ssl_days,
         "escalation": "critical" if ssl_problem else escalation(ssl_days, ssl_life),
         "fact": ("Expired" if ssl_problem == "expired" else "Invalid") if ssl_problem
                 else (f"{ssl_days} days" if ssl_days is not None else "unavailable"),
         # "Let's Encrypt · 89-day cycle" — a fact, not a promise that it will
         # renew. If it does not, the 10-day rung says so.
         "detail": SSL_PROBLEM_TEXT.get(ssl_problem, ssl_problem) if ssl_problem
                   else (" · ".join(x for x in (status.get("ssl_issuer"),
                                                f"{ssl_life}-day cycle" if ssl_life else None) if x) or None)},
        {"key": "domain", "label": "Domain", "days": dom_days, "escalation": escalation(dom_days),
         "fact": (f"{dom_days} days" if dom_days is not None else "unavailable"), "detail": None},
        {"key": "index", "label": "Search visibility", "days": None, "escalation": idx["overall"],
         "fact": ("Indexable" if idx["overall"] == "ok" else
                  "Unknown" if idx["overall"] == "unknown" else "At risk"),
         "checks": idx["checks"]},
        {"key": "uptime", "label": "Uptime", "days": None,
         "escalation": "critical" if down else ("ok" if up_pct is not None else "unknown"),
         "fact": (f"{up_pct}%" if up_pct is not None else "—"), "detail": "30-day"},
    ]
    # The five guards (sentinel_guards.py): DNS, email, security, SEO, a11y —
    # "unavailable" until their first pass, never a green card by default.
    cards.extend(guard_cards(status.get("guards")))
    # Proximity = prominence: the most urgent card sorts first.
    rank = {"critical": 0, "warn": 1, "notice": 2, "unknown": 3, "ok": 4}
    cards.sort(key=lambda c: rank.get(c["escalation"], 4))

    worst = min((c["escalation"] for c in cards), key=lambda s: rank.get(s, 4))
    return {
        "cards": cards,
        "worst": worst,
        "all_clear": worst in ("ok",),
        "last_checked": status.get("last_checked_at"),
        "uptime_pct": up_pct,
        "down": down,
    }


# ─── Orchestration (network + storage; injected notify keeps it testable) ────
# ─── What we observed vs what we successfully told them ─────────────────────
#
# D17. The pass used to write prev_ssl_days / prev_domain_days and THEN try to
# deliver the alert. A delivery that failed was never retried, because the next
# pass compared against the advanced number and found no crossing. Each rung of
# a 30/14/3 ladder therefore got exactly one unverified HTTP POST, and
# apexure.com's 27-day warning reached a human only because a forced pass
# collected alerts instead of sending them.
#
# Observing and telling are different facts. The columns keep the observation,
# so the cards are always current. `guards.notified` keeps what we have
# actually delivered, and it only moves when delivery is confirmed.

NOTIFIED = "notified"


def notified_baseline(prev, prev_guards) -> dict:
    """What we last successfully told them about this site.

    Falls back to the observed columns so the first pass after this ships does
    not re-announce everything the old code had already sent.
    """
    prev, prev_guards = prev or {}, prev_guards or {}
    told = prev_guards.get(NOTIFIED) or {}
    # The indexability fallback is the verdict the LAST pass would have
    # computed from the stored columns — the same comparison the old code made.
    # Without it the first pass after this ships re-announces every site whose
    # homepage is already critical, which is noise about a state nobody changed.
    prior_index = indexability_verdict(
        prev.get("robots_ok"), prev.get("meta_noindex"),
        prev.get("header_noindex"), prev.get("sitemap_ok"))["overall"]
    return {
        "ssl_days": told.get("ssl_days", prev.get("prev_ssl_days")),
        "domain_days": told.get("domain_days", prev.get("prev_domain_days")),
        "index_overall": told.get("index_overall", prior_index),
        "ssl_problem": told.get("ssl_problem", prev_guards.get("ssl_problem")),
        "guards": told.get("guards", prev_guards),
    }


def next_notified_state(told: dict, observed: dict, undelivered) -> dict:
    """What `guards.notified` should hold after this pass.

    Delivered: the observation becomes the new baseline. Undelivered: the OLD
    baseline is written back unchanged — written back, not left absent, which
    is the subtle half. `notified_baseline` falls back to the observed columns
    when nothing has been recorded, and those advance every pass, so leaving
    the key absent after a failure would let the baseline drift along behind
    the observation and lose the rung a second time. Pinning it makes the
    fallback a one-off for the first pass and nothing more.
    """
    if undelivered:
        return {k: told.get(k) for k in ("ssl_days", "domain_days", "index_overall",
                                         "ssl_problem", "guards")}
    return {k: observed.get(k) for k in ("ssl_days", "domain_days", "index_overall",
                                         "ssl_problem", "guards")}


async def deliver_alerts(notify, alerts, host="") -> list:
    """Send each alert; return the ones that were NOT confirmed delivered.

    A notifier confirms by returning something truthy. None, False and any
    exception all mean unconfirmed — silence is not evidence of delivery, and
    that assumption is most of D17.
    """
    undelivered = []
    for text in alerts:
        if not notify:
            undelivered.append(text)
            continue
        try:
            ok = await notify(text)
        except Exception as e:
            print(f"[Sentinel] ALERT NOT DELIVERED ({type(e).__name__}: {e}) — {host}: {text}")
            undelivered.append(text)
            continue
        if not ok:
            print(f"[Sentinel] ALERT NOT DELIVERED (notifier did not confirm) — {host}: {text}")
            undelivered.append(text)
    return undelivered


async def run_sentinel_for_site(site, notify=None, client=None):
    """One full sentinel pass for a site: SSL + domain + indexability. Updates
    stored status, fires change-only ladder alerts + indexability-critical."""
    from urllib.parse import urlparse
    from database import get_sentinel_status, upsert_sentinel_status

    url = site.get("url") or ""
    host = urlparse(url if "://" in url else "https://" + url).hostname
    if not host:
        return {"skipped": True}
    prev = await get_sentinel_status(site["id"]) or {}

    from sentinel_guards import run_guards, guard_alerts
    ssl_exp, issuer, ssl_issued, ssl_problem = await check_ssl(host)
    ssl_life = cert_lifetime_days(ssl_issued, ssl_exp)
    dom_exp = await check_domain_expiry(host, client=client)
    robots_ok, meta_ni, header_ni, sitemap_ok = await check_indexability(url, client=client)
    # The guards: DNS drift, email authentication, security posture, SEO and
    # accessibility essentials. Their failure must never cost the site its
    # SSL/domain/indexability row, so they are one try, stored beside it.
    prev_guards = prev.get("guards") or {}
    try:
        guards = await run_guards(url if "://" in url else "https://" + url, host, client, prev_guards=prev_guards)
    except Exception:
        guards = None
    if dom_exp is None and guards and guards.get("domain_expiry"):
        dom_exp = guards["domain_expiry"]
    # Recorded even when the guard probe failed: the card's ladder depends on
    # it, and it costs nothing — it came from the handshake we already made.
    if ssl_life is not None or ssl_problem is not None:
        guards = dict(guards or {})
        if ssl_life is not None:
            guards["ssl_cycle"] = {"issued": ssl_issued, "lifetime_days": ssl_life}
        # Carried whether or not it is set, so a certificate that was fixed
        # since the last pass stops being reported as broken.
        guards["ssl_problem"] = ssl_problem
    ssl_days, dom_days = days_until(ssl_exp), days_until(dom_exp)
    idx = indexability_verdict(robots_ok, meta_ni, header_ni, sitemap_ok)

    # ── Decide what to say, against what we last SAID — not against what we
    # last saw. The two diverge exactly when a delivery failed, which is the
    # case the old ordering could not survive.
    told = notified_baseline(prev, prev_guards)

    alerts = []
    for label, key, days, life in (("SSL certificate", "ssl_days", ssl_days, ssl_life),
                                   ("Domain registration", "domain_days", dom_days, None)):
        rung = ladder_crossing(told.get(key), days, life)
        if rung is not None:
            urgency = ":rotating_light:" if rung <= 3 else ":warning:"
            alerts.append(f"{urgency} *{label} expires in {days} days* — {host}")
    # Indexability critical, change-only (fire when it flips into a bad state).
    if idx["overall"] == "critical" and told.get("index_overall") != "critical":
        bad = next((c for c in idx["checks"] if c["status"] == "critical"), None)
        alerts.append(f":rotating_light: *Search visibility at risk* — {bad['text'] if bad else 'indexability'} · {host}")
    # A certificate that was working and is now invalid.
    invalid_alert = ssl_invalid_alert(
        {"prev_ssl_days": told.get("ssl_days")},
        {"ssl_problem": told.get("ssl_problem")}, ssl_problem, host)
    if invalid_alert:
        alerts.append(invalid_alert)
    if guards is not None:
        alerts.extend(guard_alerts(told.get("guards"), guards, host))

    # ── Tell them, and find out whether it landed.
    undelivered = await deliver_alerts(notify, alerts, host)

    # ── Record. The observation always lands, so the cards stay current.
    # `notified` advances only when every alert was confirmed: if one of two
    # failed, both are re-sent next pass. A duplicate alert is a nuisance; a
    # dropped one is a monitoring system that reliably tells you nothing.
    if undelivered:
        print(f"[Sentinel] {len(undelivered)} of {len(alerts)} alert(s) undelivered for "
              f"{host} — state NOT advanced, they will be retried next pass")
    next_notified = next_notified_state(
        told,
        {"ssl_days": ssl_days, "domain_days": dom_days,
         "index_overall": idx["overall"], "ssl_problem": ssl_problem,
         "guards": {k: v for k, v in (guards or {}).items() if k != NOTIFIED}},
        undelivered)

    stored_guards = dict(guards or {})
    stored_guards[NOTIFIED] = next_notified

    await upsert_sentinel_status(site["id"], {
        "ssl_expiry": ssl_exp, "ssl_issuer": issuer, "domain_expiry": dom_exp,
        "robots_ok": robots_ok, "meta_noindex": meta_ni, "header_noindex": header_ni,
        "sitemap_ok": sitemap_ok, "prev_ssl_days": ssl_days, "prev_domain_days": dom_days,
        "last_checked_at": _now().isoformat(),
        **({"guards": stored_guards} if stored_guards is not None else {}),
    })

    return {"ssl_days": ssl_days, "domain_days": dom_days, "index": idx["overall"],
            "alerts": len(alerts), "undelivered": len(undelivered)}


async def run_uptime_for_site(site, notify=None, client=None):
    """One HEAD ping; opens an incident after 2 consecutive fails, closes +
    notifies on recovery."""
    from database import add_uptime_ping, recent_pings, open_incident, close_incident
    from urllib.parse import urlparse

    url = site.get("url") or ""
    host = urlparse(url if "://" in url else "https://" + url).hostname or url
    up = await ping(url if "://" in url else "https://" + url, client=client)
    await add_uptime_ping(site["id"], up)
    pings = await recent_pings(site["id"], limit=3)
    if downtime_state(pings):
        await open_incident(site["id"])
        if notify:
            try:
                await notify(f":rotating_light: *Site down* — {host} failed two consecutive checks")
            except Exception:
                pass
    elif up:
        if await close_incident(site["id"]) and notify:
            try:
                await notify(f":white_check_mark: *Back up* — {host} recovered")
            except Exception:
                pass
    return up


async def run_sentinel_all(notify=None):
    """One pass over every site, reporting what it actually managed.

    It still refuses to let one site's failure end the sweep, but it no longer
    reports only the successes. A run that completed 5 of 8 and a run that
    completed 8 of 8 used to return the same shape of good news.
    """
    import httpx
    from database import all_sites_min
    sites = await all_sites_min()
    done = undelivered = 0
    failed = []
    async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:
        for s in sites:
            try:
                res = await run_sentinel_for_site(s, notify=notify, client=client) or {}
                done += 1
                undelivered += res.get("undelivered", 0)
            except Exception as e:
                failed.append({"url": s.get("url"), "error": f"{type(e).__name__}: {e}"[:200]})
                print(f"[Sentinel] site FAILED — {s.get('url')}: {type(e).__name__}: {e}")
    if failed or undelivered:
        print(f"[Sentinel] pass finished: {done}/{len(sites)} sites completed, "
              f"{len(failed)} failed, {undelivered} alert(s) undelivered")
    return {"checked": done, "given": len(sites), "failed": len(failed),
            "failures": failed, "undelivered": undelivered}


async def run_uptime_all(notify=None):
    import httpx
    from database import all_sites_min
    sites = await all_sites_min()
    n = 0
    async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
        for s in sites:
            try:
                await run_uptime_for_site(s, notify=notify, client=client)
                n += 1
            except Exception:
                pass
    return {"pinged": n}
