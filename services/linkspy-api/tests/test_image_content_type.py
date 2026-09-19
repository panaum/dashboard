"""An image URL that answers 200 with a web page — the soft 404 a link checker
cannot see, because the response itself is healthy."""
from resources import IMAGE, SCRIPT, STYLESHEET, ANCHOR, content_type_problem


def test_a_page_where_an_image_should_be_is_the_high_confidence_case():
    got = content_type_problem(IMAGE, 200, "text/html; charset=UTF-8")
    assert got is not None
    confidence, reason = got
    assert confidence == "high"
    assert "returns a web page, not an image" in reason
    assert "broken image" in reason, "the reason says what the visitor sees"


def test_a_real_image_is_never_a_finding():
    for ctype in ("image/jpeg", "image/png", "image/webp", "image/avif",
                  "image/svg+xml", "IMAGE/JPEG", "image/gif; charset=binary"):
        assert content_type_problem(IMAGE, 200, ctype) is None, ctype


def test_a_server_that_does_not_say_has_not_proved_anything():
    # A missing header, and the octet-stream a great many CDNs send for a
    # perfectly good image. Silence is not evidence.
    for ctype in (None, "", "   ", "application/octet-stream", "binary/octet-stream"):
        assert content_type_problem(IMAGE, 200, ctype) is None, repr(ctype)


def test_another_wrong_type_is_reported_quietly_and_names_itself():
    # An SVG served as text/xml does not render in an <img>, but the evidence
    # is weaker than a whole web page coming back.
    got = content_type_problem(IMAGE, 200, "text/xml")
    assert got[0] == "low" and "text/xml" in got[1]
    assert content_type_problem(IMAGE, 200, "application/pdf")[0] == "low"


def test_only_images_and_only_healthy_responses():
    # A 404 is already a broken image; this check is for the ones that answer.
    assert content_type_problem(IMAGE, 404, "text/html") is None
    assert content_type_problem(IMAGE, 500, "text/html") is None
    assert content_type_problem(IMAGE, None, "text/html") is None
    # Scripts and stylesheets have the same defect and are deliberately not
    # judged here: a script served as text/plain still executes in some
    # browsers, so the rule is not the same rule.
    for other in (SCRIPT, STYLESHEET, ANCHOR):
        assert content_type_problem(other, 200, "text/html") is None, other


def test_a_redirect_that_lands_on_a_page_still_counts():
    # follow_redirects means the status is the destination's, so a hotlink
    # guard that 302s to a notice page is caught by the type it ends on.
    assert content_type_problem(IMAGE, 200, "text/html")[0] == "high"
