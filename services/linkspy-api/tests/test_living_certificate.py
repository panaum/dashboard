"""Living Certificate — the client_timeline read endpoint.

Invariants under test: flag-gated (off ⇒ indistinguishable from absent),
service-key authed, SELECT-only against an append-only ledger, and touching no
existing endpoint or tester-owned table (T4 / T8).
"""
import inspect
import re


def _code_only(obj):
    """Source with docstrings and comments removed, ORIGINAL SPACING INTACT —
    these functions explain themselves in prose that names the very things the
    code must not do, so assertions have to read code and not commentary.

    Spacing must survive: `.insert(` is the token we search for, and a
    normalising tokeniser would turn it into `. insert (`.
    """
    src = inspect.getsource(obj)
    src = re.sub(r'"""[\s\S]*?"""', "", src)   # docstrings
    src = re.sub(r"'''[\s\S]*?'''", "", src)
    src = re.sub(r"(?m)^[ \t]*#.*$", "", src)  # whole-line comments
    src = re.sub(r"(?m)[ \t]+#.*$", "", src)   # trailing comments
    return src


# ── the flag gate ───────────────────────────────────────────────────────────
def test_flag_is_checked_before_auth_and_before_any_read():
    import main
    src = inspect.getsource(main.registry_bridge_timeline)
    gate = src.index('os.getenv("LIVING_CERTIFICATE")')
    assert gate < src.index("await _qa_authenticate("), "flag precedes auth"
    assert gate < src.index("await timeline_for_deliverable("), "flag precedes the DB"
    assert "status_code=404" in src[gate:gate + 200], \
        "off ⇒ indistinguishable from the route not existing"


def test_only_the_literal_one_enables_it():
    import main
    code = _code_only(main.registry_bridge_timeline)
    assert 'os.getenv("LIVING_CERTIFICATE") != "1"' in code, "half-on is not a state"


# ── T4: read-only against an append-only ledger ─────────────────────────────
def test_endpoint_never_writes():
    import main
    code = _code_only(main.registry_bridge_timeline)
    for forbidden in ("insert", "upsert", ".update(", ".delete(", "timeline_add",
                      "enqueue(", "create_client"):
        assert forbidden not in code, f"the timeline read must not write — found {forbidden!r}"


def test_helper_is_select_only():
    import database
    code = _code_only(database._timeline_for_deliverable_sync)
    assert ".select(" in code
    for forbidden in ("insert", "upsert", ".update(", ".delete(", ".rpc("):
        assert forbidden not in code, f"append-only ledger must never be mutated — found {forbidden!r}"


def test_touches_no_tester_owned_table():
    import main, database
    for obj in (main.registry_bridge_timeline, database._timeline_for_deliverable_sync):
        code = _code_only(obj)
        # Table names only — bare "certificate" would match this feature's own
        # `living_certificate_disabled`, which is not a table.
        for table in ("QACheckItem", "qa_check", "ChecklistTemplateItem",
                      "QACertificate", "qa_certificates", "qa_prefills"):
            assert table not in code, f"{obj.__name__} must not reference {table!r} (T4)"


def test_reads_exactly_one_table():
    import database
    code = _code_only(database._timeline_for_deliverable_sync)
    assert code.count('table(') == 1 and '"client_timeline"' in code


# ── shape ───────────────────────────────────────────────────────────────────
def test_missing_deliverable_id_returns_empty_without_querying():
    import asyncio, database
    # Guard clause short-circuits before _get_client() is ever reached, so this
    # is safe with no database configured.
    assert asyncio.get_event_loop_policy().new_event_loop().run_until_complete(
        database.timeline_for_deliverable(None)) == []


def test_limit_is_clamped_not_rejected():
    import main
    code = _code_only(main.registry_bridge_timeline)
    assert "max(1, min(int(limit or 100), _TIMELINE_MAX_LIMIT))" in code, \
        "a client-facing render path must not 400 on a bad limit"
    assert main._TIMELINE_MAX_LIMIT == 200


def test_response_reports_truncation_rather_than_hiding_it():
    import main
    code = _code_only(main.registry_bridge_timeline)
    assert '"truncated"' in code and '"limit"' in code, \
        "a cap that lies about coverage is worse than no cap"


def test_empty_history_is_a_valid_answer_not_a_404():
    import main
    code = _code_only(main.registry_bridge_timeline)
    # The only 404 in the function is the flag gate.
    assert code.count("status_code=404") == 1


def test_storage_fault_is_503_not_500():
    import main
    code = _code_only(main.registry_bridge_timeline)
    assert '"living_certificate_unavailable"' in code and "status_code=503" in code


# ── T8: no existing endpoint's response shape changed ───────────────────────
def test_existing_endpoints_are_untouched_by_this_feature():
    import main
    for fn in (main.qa_bridge_status, main.registry_bridge_client_presence,
               main.qa_bridge_presence, main.qa_bridge_presence_sites):
        code = _code_only(fn)
        assert "LIVING_CERTIFICATE" not in code, \
            f"{fn.__name__} must not learn about this feature (T8)"
        assert "timeline_for_deliverable" not in code


def test_the_ledger_writer_is_unchanged():
    """timeline_add is the spine's; this feature only reads beside it."""
    import database
    code = _code_only(database._timeline_add_sync)
    assert '.insert(' in code, "the writer still writes — untouched"
    assert "LIVING_CERTIFICATE" not in code
