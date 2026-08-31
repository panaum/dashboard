"""summarize_incidents — the pure shaping behind /api/qa-bridge/site-incidents.

Claims: rows are whitelisted to the two window fields (internal ids never
cross the bridge); an incident without restored_at counts as open; junk rows
are ignored; an empty history is a valid, empty answer.
"""
from qa_bridge import summarize_incidents, INCIDENT_FIELDS


def test_empty_history_is_a_valid_answer():
    assert summarize_incidents([]) == {"incidents": [], "open": 0}
    assert summarize_incidents(None) == {"incidents": [], "open": 0}


def test_rows_are_whitelisted_to_the_window_fields():
    out = summarize_incidents([{"id": 7, "site_id": "s", "down_at": "d", "restored_at": "r"}])
    assert out["incidents"] == [{"down_at": "d", "restored_at": "r"}]
    assert set(out["incidents"][0]) <= set(INCIDENT_FIELDS)


def test_missing_restored_at_counts_as_open():
    out = summarize_incidents([
        {"down_at": "d1", "restored_at": None},
        {"down_at": "d2", "restored_at": "r2"},
        {"down_at": "d3"},
    ])
    assert out["open"] == 2
    assert len(out["incidents"]) == 3


def test_non_dict_rows_are_ignored():
    out = summarize_incidents(["junk", None, {"down_at": "d", "restored_at": "r"}])
    assert len(out["incidents"]) == 1 and out["open"] == 0
