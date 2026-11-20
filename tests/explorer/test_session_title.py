from semantica.explorer.natural_reasoning import clean_session_title


def test_clean_session_title_keeps_the_first_line_without_quotes():
    reply = "<think>draft</think>\n“产能是否够接单。”\nextra"
    assert clean_session_title(reply) == "产能是否够接单"


def test_clean_session_title_limits_length():
    assert clean_session_title("产能" * 20) == ("产能" * 12)
