"""Sentinel guards: the five checks beside SSL / domain / indexability / uptime.

The Disaster Sentinel watches for "nothing catastrophic without warning". These
guards extend it to the things that go wrong quietly and cost a client money
without anyone noticing for weeks:

  • domain   — the registrable domain, so RDAP answers (it never answered for
               `www.example.com`), the registrar, and DNS drift: nameservers,
               A/AAAA, MX and the www alias, alerted on change. A nameserver
               that changes overnight is a migration nobody told us about, or
               a hijack.
  • email    — does the domain's mail authenticate? SPF, DMARC and its policy,
               MX presence, DKIM by common selectors. Every lead form on the
               site delivers by email; a domain with no DMARC lands in spam.
  • security — HSTS, CSP and the small headers; HTTP redirecting to HTTPS;
               active mixed content on the homepage. The SSL card says the
               certificate is fine; this says the page actually uses it.
  • seo      — the homepage is described: a title of sensible length, a meta
               description, a canonical on the same host, one H1, Open Graph
               for links shared into chat. Indexable is the sentinel's card;
               this is "worth indexing".
  • a11y     — the semantics a screen reader needs: alt text, labelled fields,
               links with names, a lang attribute, heading order, unique ids.

Same shape as the sentinel: pure verdict functions (tested without a network)
and thin probes (DNS over HTTPS through httpx — no resolver library; one GET
of the homepage, one of its http:// twin). Same honesty rules: what could not
be read is None and reads "unavailable"; a guard never claims a state it did
not observe. Escalation vocabulary is the sentinel's: ok / notice / warn /
critical / unknown. Only two things are critical here — a nameserver change
and a homepage that will not redirect to HTTPS — because those are the two a
visitor feels before the client does.
"""
import re
from urllib.parse import urlparse

# ─── Registrable domain ─────────────────────────────────────────────────────
# RDAP knows registrations, not hosts: `www.example.com` is a 404 there, and
# that is exactly what the domain card showed for every site registered with
# its www. The registrable name is the host minus its subdomains — the last
# two labels, or three where the registry sells under a second level. This
# list is the common ones, not the public suffix list; the probe walks the
# candidates and takes the first RDAP answers for, so an unlisted suffix
# still resolves — one lookup later.
MULTI_PART_SUFFIXES = {
    "co.uk", "org.uk", "me.uk", "ac.uk", "gov.uk", "ltd.uk", "plc.uk", "net.uk",
    "com.au", "net.au", "org.au", "edu.au", "gov.au", "id.au", "asn.au",
    "co.nz", "net.nz", "org.nz", "govt.nz", "ac.nz", "geek.nz", "maori.nz",
    "com.br", "net.br", "org.br", "gov.br", "co.za", "org.za", "net.za", "gov.za",
    "co.in", "net.in", "org.in", "firm.in", "gen.in", "ind.in", "ac.in",
    "co.jp", "ne.jp", "or.jp", "ac.jp", "go.jp", "com.sg", "net.sg", "org.sg", "edu.sg",
    "com.mx", "org.mx", "net.mx", "com.ar", "com.tr", "com.cn", "net.cn", "org.cn",
    "com.hk", "org.hk", "com.tw", "com.my", "com.ph", "co.id", "co.il", "org.il",
    "co.kr", "or.kr", "com.pl", "net.pl", "org.pl", "com.ua", "co.th", "or.th",
}


def registrable_candidates(host):
    """The names to ask RDAP about, most specific first, ending at the
    registrable domain. `www.shop.example.co.uk` → [www.shop.example.co.uk,
    shop.example.co.uk, example.co.uk]. A bare label or an IP gives []."""
    if not host:
        return []
    host = host.strip().lower().rstrip(".")
    if not host or re.fullmatch(r"[\d.]+|\[?[0-9a-f:]+\]?", host):
        return []
    labels = host.split(".")
    if len(labels) < 2 or any(not l for l in labels):
        return []
    base = 3 if len(labels) >= 3 and ".".join(labels[-2:]) in MULTI_PART_SUFFIXES else 2
    out = []
    for i in range(0, len(labels) - base + 1):
        out.append(".".join(labels[i:]))
    return out


def parse_rdap(data):
    """(expiry_iso|None, registrar|None) from an RDAP domain object. Expiry is
    the `expiration` event; registrar the entity with that role's vCard fn."""
    from sentinel import _dt
    expiry = None
    for ev in (data or {}).get("events", []) or []:
        if ev.get("eventAction") == "expiration":
            d = _dt(ev.get("eventDate"))
            expiry = d.isoformat() if d else None
    registrar = None
    for ent in (data or {}).get("entities", []) or []:
        if "registrar" in (ent.get("roles") or []):
            vcard = ent.get("vcardArray") or []
            for item in (vcard[1] if len(vcard) > 1 and isinstance(vcard[1], list) else []):
                if isinstance(item, list) and item and item[0] == "fn" and len(item) > 3:
                    registrar = str(item[3]).strip() or None
            break
    return expiry, registrar


# ─── DNS: snapshot and drift ────────────────────────────────────────────────
def _norm(values):
    return sorted({str(v).strip().lower().rstrip(".") for v in (values or []) if str(v).strip()})


def dns_snapshot(ns=None, a=None, mx=None, www_cname=None):
    """A comparable record of where the domain points. Each is a sorted,
    normalised list, or None when that lookup did not answer."""
    return {
        "ns": _norm(ns) if ns is not None else None,
        "a": _norm(a) if a is not None else None,
        "mx": _norm(mx) if mx is not None else None,
        "www": _norm(www_cname) if www_cname is not None else None,
    }


DRIFT_WORDS = {"ns": "Nameservers", "a": "The address (A/AAAA)", "mx": "Mail servers (MX)", "www": "The www alias"}


def dns_drift(prev, cur):
    """What changed between two snapshots: [(key, before, after)]. A lookup that
    did not answer on either side is not a change — an outage at the resolver
    must never read as a migration."""
    out = []
    for k in ("ns", "a", "mx", "www"):
        b, a = (prev or {}).get(k), (cur or {}).get(k)
        if b is None or a is None:
            continue
        if b != a:
            out.append((k, b, a))
    return out


# ─── Email authentication ───────────────────────────────────────────────────
DKIM_SELECTORS = ("google", "default", "selector1", "selector2", "k1", "dkim", "mail", "s1", "s2", "smtp", "mandrill", "mailchimp", "sendgrid", "zoho")


def spf_verdict(txt_records):
    """('ok'|'warn'|'critical'|'unknown', text). One v=spf1 record ending -all
    or ~all is ok; +all or ?all is as good as none; two records break SPF."""
    if txt_records is None:
        return "unknown", "SPF: unavailable"
    spf = [t for t in txt_records if t.strip().lower().startswith("v=spf1")]
    if not spf:
        return "warn", "SPF: none"
    if len(spf) > 1:
        return "critical", f"SPF: {len(spf)} records — receivers reject that"
    rec = spf[0].strip().lower()
    if rec.endswith("-all"):
        return "ok", "SPF: -all"
    if rec.endswith("~all"):
        return "ok", "SPF: ~all"
    if rec.endswith("+all") or rec.endswith("?all"):
        return "warn", "SPF: allows anyone (" + rec[-4:] + ")"
    return "notice", "SPF: no all mechanism"


def dmarc_verdict(txt_records):
    """('ok'|'notice'|'warn'|'unknown', text) from the _dmarc TXT records."""
    if txt_records is None:
        return "unknown", "DMARC: unavailable"
    recs = [t for t in txt_records if t.strip().lower().startswith("v=dmarc1")]
    if not recs:
        return "warn", "DMARC: none"
    m = re.search(r"\bp\s*=\s*(none|quarantine|reject)\b", recs[0], re.I)
    policy = (m.group(1).lower() if m else "none")
    if policy == "none":
        return "notice", "DMARC: p=none (monitoring only)"
    return "ok", f"DMARC: p={policy}"


def email_verdict(mx, spf_txt, dmarc_txt, dkim_selector):
    """The email card. `mx` is a list (empty = no mail at this domain, which is
    fine and says so), `dkim_selector` the first common selector that answered,
    or None. Worst of the parts wins; unknown never outranks a real finding."""
    checks = []
    if mx is None:
        checks.append({"key": "mx", "status": "unknown", "text": "MX: unavailable"})
    elif not mx:
        checks.append({"key": "mx", "status": "notice", "text": "MX: none — this domain does not receive mail"})
    else:
        checks.append({"key": "mx", "status": "ok", "text": f"MX: {mx[0].split(' ')[-1]}" + (f" +{len(mx) - 1}" if len(mx) > 1 else "")})
    s, st = spf_verdict(spf_txt); checks.append({"key": "spf", "status": s, "text": st})
    d, dt = dmarc_verdict(dmarc_txt); checks.append({"key": "dmarc", "status": d, "text": dt})
    checks.append({"key": "dkim", "status": "ok" if dkim_selector else "unknown",
                   "text": f"DKIM: selector {dkim_selector}" if dkim_selector else "DKIM: no common selector found"})
    overall = _worst([c["status"] for c in checks if c["status"] != "unknown"] or ["unknown"])
    if mx is not None and not mx and overall in ("warn", "notice"):
        # A domain that receives no mail is not penalised for not sending any.
        overall = "notice"
    return overall, checks


RANK = {"critical": 0, "warn": 1, "notice": 2, "unknown": 3, "ok": 4}


def _worst(statuses):
    return min(statuses, key=lambda s: RANK.get(s, 3)) if statuses else "unknown"


# ─── Security posture ───────────────────────────────────────────────────────
ACTIVE_MIXED = re.compile(r'<(?:script|link|iframe|object|embed)\b[^>]*\b(?:src|href)\s*=\s*["\']http://', re.I)
PASSIVE_MIXED = re.compile(r'<(?:img|video|audio|source)\b[^>]*\bsrc\s*=\s*["\']http://', re.I)


def security_verdict(headers, html, http_probe):
    """The security card from the HTTPS response headers, its HTML, and what
    plain http:// did (`http_probe`: {'status': int, 'location': str|None} or
    None when it could not be reached). Header names are matched
    case-insensitively."""
    h = {str(k).lower(): str(v) for k, v in (headers or {}).items()}
    checks = []
    # 1 · does http:// send visitors to https://?
    if http_probe is None:
        checks.append({"key": "https", "status": "unknown", "text": "HTTP → HTTPS: unavailable"})
    else:
        st, loc = http_probe.get("status"), (http_probe.get("location") or "")
        if st in (301, 302, 303, 307, 308) and loc.lower().startswith("https://"):
            checks.append({"key": "https", "status": "ok", "text": "HTTP → HTTPS: redirects"})
        elif st is not None and st < 400:
            checks.append({"key": "https", "status": "critical", "text": "HTTP → HTTPS: the plain http:// page is served without a redirect"})
        else:
            checks.append({"key": "https", "status": "notice", "text": f"HTTP → HTTPS: http:// answers {st}"})
    # 2 · the headers a browser honours
    hsts = h.get("strict-transport-security")
    checks.append({"key": "hsts", "status": "ok" if hsts and re.search(r"max-age=(\d+)", hsts) and int(re.search(r"max-age=(\d+)", hsts).group(1)) >= 15552000 else ("notice" if hsts else "warn"),
                   "text": "HSTS: set" if hsts and "max-age" in hsts and int(re.search(r"max-age=(\d+)", hsts).group(1)) >= 15552000 else ("HSTS: set, but max-age under 180 days" if hsts else "HSTS: missing")})
    csp = h.get("content-security-policy")
    checks.append({"key": "csp", "status": "ok" if csp else "warn", "text": "CSP: set" if csp else "CSP: missing"})
    xcto = (h.get("x-content-type-options") or "").lower()
    checks.append({"key": "xcto", "status": "ok" if "nosniff" in xcto else "notice", "text": "X-Content-Type-Options: nosniff" if "nosniff" in xcto else "X-Content-Type-Options: missing"})
    framing = bool(h.get("x-frame-options")) or ("frame-ancestors" in (csp or "").lower())
    checks.append({"key": "frame", "status": "ok" if framing else "notice", "text": "Clickjacking: frame-ancestors/X-Frame-Options set" if framing else "Clickjacking: no frame-ancestors or X-Frame-Options"})
    checks.append({"key": "referrer", "status": "ok" if h.get("referrer-policy") else "notice", "text": "Referrer-Policy: set" if h.get("referrer-policy") else "Referrer-Policy: missing"})
    # 3 · mixed content on the page itself
    if html is None:
        checks.append({"key": "mixed", "status": "unknown", "text": "Mixed content: unavailable"})
    else:
        active = len(ACTIVE_MIXED.findall(html)); passive = len(PASSIVE_MIXED.findall(html))
        if active:
            checks.append({"key": "mixed", "status": "critical", "text": f"Mixed content: {active} script/stylesheet/frame loaded over http:// — browsers block these"})
        elif passive:
            checks.append({"key": "mixed", "status": "warn", "text": f"Mixed content: {passive} image/media loaded over http://"})
        else:
            checks.append({"key": "mixed", "status": "ok", "text": "Mixed content: none"})
    overall = _worst([c["status"] for c in checks if c["status"] != "unknown"] or ["unknown"])
    return overall, checks


# ─── SEO essentials (the homepage) ──────────────────────────────────────────
def _soup(html):
    from bs4 import BeautifulSoup
    try:
        return BeautifulSoup(html or "", "lxml")
    except Exception:
        return BeautifulSoup(html or "", "html.parser")


def seo_verdict(html, url):
    """The homepage, described. Never critical: these are quality, not
    disasters, and the sentinel's own index card already covers noindex."""
    if html is None:
        return "unknown", [{"key": "page", "status": "unknown", "text": "Homepage: unavailable"}]
    s = _soup(html)
    checks = []
    title = (s.title.string or "").strip() if s.title and s.title.string else ""
    n = len(title)
    checks.append({"key": "title", "status": "warn" if not title else ("notice" if n < 10 or n > 70 else "ok"),
                   "text": "Title: missing" if not title else (f"Title: {n} characters" + (" — long" if n > 70 else " — short" if n < 10 else ""))})
    md = s.find("meta", attrs={"name": re.compile(r"^description$", re.I)})
    desc = (md.get("content") or "").strip() if md else ""
    n = len(desc)
    checks.append({"key": "description", "status": "warn" if not desc else ("notice" if n < 50 or n > 160 else "ok"),
                   "text": "Meta description: missing" if not desc else (f"Meta description: {n} characters" + (" — long" if n > 160 else " — short" if n < 50 else ""))})
    can = s.find("link", attrs={"rel": lambda v: v and "canonical" in [x.lower() for x in (v if isinstance(v, list) else [v])]})
    href = (can.get("href") or "").strip() if can else ""
    if not href:
        checks.append({"key": "canonical", "status": "notice", "text": "Canonical: missing"})
    else:
        same = (urlparse(href).hostname or "").lower().lstrip("www.") == (urlparse(url).hostname or "").lower().lstrip("www.")
        checks.append({"key": "canonical", "status": "ok" if same else "warn", "text": "Canonical: set" if same else f"Canonical: points at {urlparse(href).hostname}"})
    h1s = s.find_all("h1")
    checks.append({"key": "h1", "status": "ok" if len(h1s) == 1 else "notice", "text": "H1: one" if len(h1s) == 1 else ("H1: none" if not h1s else f"H1: {len(h1s)}")})
    og = {p.get("property", "").lower(): (p.get("content") or "").strip() for p in s.find_all("meta", attrs={"property": True})}
    missing = [k for k in ("og:title", "og:description", "og:image") if not og.get(k)]
    checks.append({"key": "og", "status": "ok" if not missing else "notice", "text": "Open Graph: complete" if not missing else "Open Graph: missing " + ", ".join(k.split(":")[1] for k in missing)})
    lang = (s.html.get("lang") or "").strip() if s.html else ""
    checks.append({"key": "lang", "status": "ok" if lang else "notice", "text": f"Language: {lang}" if lang else "Language: no lang attribute"})
    overall = _worst([c["status"] for c in checks])
    return overall, checks


# ─── Accessibility essentials (the homepage) ────────────────────────────────
def _decorative(img):
    if (img.get("role") or "").lower() in ("presentation", "none"):
        return True
    if (img.get("aria-hidden") or "").lower() == "true":
        return True
    try:
        if int(img.get("width") or 0) <= 1 and int(img.get("height") or 0) <= 1 and img.get("width"):
            return True
    except ValueError:
        pass
    return False


def _accessible_name(el):
    if (el.get("aria-label") or "").strip():
        return True
    if el.get("aria-labelledby"):
        return True
    if el.get_text(" ", strip=True):
        return True
    if el.find("img", alt=lambda v: v and v.strip()):
        return True
    if (el.get("title") or "").strip():
        return True
    return False


def a11y_verdict(html):
    """The semantics a screen reader needs, from the homepage. Warn at most —
    a fault here is real and fixable, not a disaster."""
    if html is None:
        return "unknown", [{"key": "page", "status": "unknown", "text": "Homepage: unavailable"}]
    s = _soup(html)
    checks = []
    imgs = [i for i in s.find_all("img") if not _decorative(i)]
    noalt = [i for i in imgs if i.get("alt") is None]
    checks.append({"key": "alt", "status": "ok" if not noalt else "warn", "text": "Images: all have alt text" if not noalt else f"Images: {len(noalt)} of {len(imgs)} without alt"})
    fields = [f for f in s.find_all(["input", "select", "textarea"]) if (f.get("type") or "").lower() not in ("hidden", "submit", "button", "image", "reset")]
    labelled_ids = {l.get("for") for l in s.find_all("label") if l.get("for")}
    unlabelled = [f for f in fields if not ((f.get("id") and f.get("id") in labelled_ids) or f.find_parent("label") or f.get("aria-label") or f.get("aria-labelledby") or f.get("title"))]
    checks.append({"key": "labels", "status": "ok" if not unlabelled else "warn", "text": "Form fields: all labelled" if not unlabelled else f"Form fields: {len(unlabelled)} of {len(fields)} without a label"})
    nameless = [a for a in s.find_all(["a", "button"]) if not _accessible_name(a)]
    checks.append({"key": "names", "status": "ok" if not nameless else "warn", "text": "Links and buttons: all named" if not nameless else f"Links and buttons: {len(nameless)} with no accessible name"})
    lang = (s.html.get("lang") or "").strip() if s.html else ""
    checks.append({"key": "lang", "status": "ok" if lang else "warn", "text": f"Language: {lang}" if lang else "Language: no lang attribute — screen readers guess the voice"})
    levels = [int(h.name[1]) for h in s.find_all(re.compile(r"^h[1-6]$"))]
    skips = sum(1 for a, b in zip(levels, levels[1:]) if b > a + 1)
    checks.append({"key": "headings", "status": "ok" if not skips else "notice", "text": "Headings: in order" if not skips else f"Headings: {skips} level{'s' if skips != 1 else ''} skipped"})
    ids = [e.get("id") for e in s.find_all(id=True)]
    dupes = {i for i in ids if ids.count(i) > 1}
    checks.append({"key": "ids", "status": "ok" if not dupes else "notice", "text": "Ids: unique" if not dupes else f"Ids: {len(dupes)} duplicated"})
    overall = _worst([c["status"] for c in checks])
    return overall, checks


# ─── Cards and alerts ───────────────────────────────────────────────────────
def guard_cards(guards):
    """The five cards from the stored guards blob (see run_guards). A guard
    that has never run reads "unavailable" — never a green card by default."""
    g = guards or {}
    def card(key, label, fact, overall, checks, detail=None):
        return {"key": key, "label": label, "days": None, "escalation": overall, "fact": fact,
                "detail": detail, "checks": checks or []}
    out = []
    dom = g.get("dns") or {}
    if dom.get("snapshot"):
        ns = dom["snapshot"].get("ns") or []
        drift = dom.get("last_drift") or []
        out.append(card("dns", "DNS", "Changed" if drift else ("Steady" if ns is not None else "unavailable"),
                        "critical" if drift else ("ok" if ns else "unknown"),
                        [{"key": k, "status": "critical" if drift else "ok", "text": f"{DRIFT_WORDS[k]}: {', '.join(v) if v else 'none'}"}
                         for k, v in (dom["snapshot"] or {}).items() if v is not None],
                        detail=(f"{len(ns)} nameserver{'s' if len(ns) != 1 else ''}" + (f" · {dom['registrar']}" if dom.get("registrar") else "")) if ns else None))
    else:
        out.append(card("dns", "DNS", "unavailable", "unknown", []))
    for key, label in (("email", "Email"), ("security", "Security"), ("seo", "SEO"), ("a11y", "Accessibility")):
        r = g.get(key) or {}
        if not r.get("checks"):
            out.append(card(key, label, "unavailable", "unknown", []))
            continue
        checks = r["checks"]; overall = r.get("overall", "unknown")
        bad = [c for c in checks if c["status"] in ("critical", "warn")]
        notices = [c for c in checks if c["status"] == "notice"]
        fact = ("All clear" if overall == "ok" else
                f"{len(bad)} to fix" if bad else f"{len(notices)} to look at" if notices else "unavailable")
        detail = " · ".join(c["text"] for c in (bad or notices)[:2]) or " · ".join(c["text"] for c in checks[:2])
        out.append(card(key, label, fact, overall, checks, detail=detail))
    return out


def guard_alerts(prev, cur, host):
    """Change-only alerts, in the sentinel's Slack voice: a guard that got
    worse, and DNS that moved. Nothing for a guard that was already bad, and
    nothing for a first run — a fault that was always there is a report, not
    an alarm."""
    prev, cur = prev or {}, cur or {}
    alerts = []
    for k, before, after in (cur.get("dns") or {}).get("last_drift") or []:
        alerts.append(f":rotating_light: *{DRIFT_WORDS[k]} changed* — {host}: {', '.join(before) or 'none'} → {', '.join(after) or 'none'}")
    if not prev:
        return alerts
    for key, label in (("email", "Email authentication"), ("security", "Security posture"), ("seo", "SEO essentials"), ("a11y", "Accessibility")):
        b = (prev.get(key) or {}).get("overall"); a = (cur.get(key) or {}).get("overall")
        if a in ("critical", "warn") and b not in (None, "unknown") and RANK.get(a, 3) < RANK.get(b, 3):
            worst = next((c["text"] for c in (cur.get(key) or {}).get("checks", []) if c["status"] == a), a)
            alerts.append(f"{':rotating_light:' if a == 'critical' else ':warning:'} *{label} got worse* — {worst} · {host}")
    return alerts


# ─── Probes ─────────────────────────────────────────────────────────────────
DOH = "https://cloudflare-dns.com/dns-query"
DOH_FALLBACK = "https://dns.google/resolve"
RR = {"A": 1, "AAAA": 28, "CNAME": 5, "MX": 15, "TXT": 16, "NS": 2}


async def doh(client, name, rtype):
    """One DNS question over HTTPS. A list of answer strings; [] for NXDOMAIN
    or no records; None when neither resolver answered — never mistaken for
    "no records"."""
    for base in (DOH, DOH_FALLBACK):
        try:
            r = await client.get(base, params={"name": name, "type": rtype}, headers={"accept": "application/dns-json"}, timeout=8)
            if r.status_code != 200:
                continue
            data = r.json()
            if data.get("Status") not in (0, 3):      # 3 = NXDOMAIN: an answer, an empty one
                continue
            want = RR.get(rtype)
            out = []
            for ans in data.get("Answer") or []:
                if ans.get("type") == want:
                    v = str(ans.get("data", ""))
                    if rtype == "TXT":
                        v = "".join(re.findall(r'"((?:[^"\\]|\\.)*)"', v)) or v.strip('"')
                    out.append(v.strip())
            return out
        except Exception:
            continue
    return None


async def probe_domain(client, host):
    """(registrable_domain, expiry_iso|None, registrar|None): the first name
    RDAP answers for, walking from the host down to its registrable domain."""
    for cand in registrable_candidates(host):
        try:
            r = await client.get(f"https://rdap.org/domain/{cand}", timeout=10)
        except Exception:
            continue
        if r.status_code == 200:
            try:
                exp, reg = parse_rdap(r.json())
            except Exception:
                exp, reg = None, None
            return cand, exp, reg
    cands = registrable_candidates(host)
    return (cands[-1] if cands else host), None, None


async def probe_dns(client, domain, host):
    ns = await doh(client, domain, "NS")
    a4 = await doh(client, host, "A")
    a6 = await doh(client, host, "AAAA")
    a = None if a4 is None and a6 is None else (a4 or []) + (a6 or [])
    mx = await doh(client, domain, "MX")
    www = await doh(client, "www." + domain, "CNAME")
    return dns_snapshot(ns=ns, a=a, mx=mx, www_cname=www)


async def probe_email(client, domain):
    mx = await doh(client, domain, "MX")
    spf = await doh(client, domain, "TXT")
    dmarc = await doh(client, "_dmarc." + domain, "TXT")
    dkim = None
    for sel in DKIM_SELECTORS:
        got = await doh(client, f"{sel}._domainkey.{domain}", "TXT")
        if got and any("v=dkim1" in t.lower() or "k=rsa" in t.lower() or "p=" in t.lower() for t in got):
            dkim = sel
            break
    mx_sorted = None if mx is None else sorted(mx, key=lambda m: int(m.split(" ")[0]) if m.split(" ")[0].isdigit() else 99)
    overall, checks = email_verdict(mx_sorted, spf, dmarc, dkim)
    return {"overall": overall, "checks": checks}


async def probe_security(client, url, html=None, headers=None):
    """Headers and HTML of the HTTPS homepage (fetched here unless the caller
    already has them), and what plain http:// does, without following it."""
    import httpx
    if headers is None or html is None:
        try:
            r = await client.get(url, timeout=12)
            headers, html = dict(r.headers), r.text
        except Exception:
            headers, html = headers or {}, html
    http_probe = None
    host = urlparse(url).hostname
    if host:
        try:
            async with httpx.AsyncClient(timeout=8, follow_redirects=False, headers={"User-Agent": "LinkSpyBot/1.0"}) as bare:
                r = await bare.get(f"http://{host}/")
                http_probe = {"status": r.status_code, "location": r.headers.get("location")}
        except Exception:
            http_probe = None
    overall, checks = security_verdict(headers, html, http_probe)
    return {"overall": overall, "checks": checks}


async def run_guards(site_url, host, client, prev_guards=None, html=None, headers=None):
    """Every guard for one site. Returns the blob that is stored on the
    sentinel row: per guard an overall + checks, and for DNS the snapshot, the
    registrar, the registrable domain and any drift since the last snapshot."""
    prev = prev_guards or {}
    domain, expiry, registrar = await probe_domain(client, host)
    snap = await probe_dns(client, domain, host)
    drift = dns_drift((prev.get("dns") or {}).get("snapshot"), snap)
    out = {
        "domain": domain,
        "domain_expiry": expiry,
        "dns": {"snapshot": snap, "registrar": registrar,
                "last_drift": [[k, b, a] for k, b, a in drift]},
        "email": await probe_email(client, domain),
        "security": await probe_security(client, site_url, html=html, headers=headers),
    }
    page = html
    if page is None:
        try:
            r = await client.get(site_url, timeout=12)
            page = r.text
        except Exception:
            page = None
    so, sc = seo_verdict(page, site_url); out["seo"] = {"overall": so, "checks": sc}
    ao, ac = a11y_verdict(page); out["a11y"] = {"overall": ao, "checks": ac}
    return out
