"""Keep Team and model-group records available through the Python SDK."""
import json
import sys
from pathlib import Path

from deepseek_harness import DeepSeekHarness


def test_collaboration_records_preserve_candidates_and_attributed_replies(tmp_path: Path) -> None:
    directory = Path(__file__).parent
    expected = json.loads((directory / "expected" / "collaboration-projection.json").read_text())
    types = {event["type"] for event in expected["events"]}
    with DeepSeekHarness(
        _launch_args=(sys.executable, str(directory / "fixtures" / "collaboration_runtime.py")),
        cwd=str(tmp_path),
        env={"MAIN_RESPONSE": expected["finalResponse"], "COLLABORATION_EVENTS": json.dumps(expected["events"])},
    ) as harness:
        result = harness.run("Report the collaborative result.", session_id="sdk-collaboration")
    assert {
        "finalResponse": result.final_response,
        "events": [event for event in result.events if event["type"] in types],
    } == expected
    notifications = [item for item in result.notifications
                     if item.method == "session.event" and item.payload["event"]["type"] in types]
    assert [item.payload["event"] for item in notifications] == expected["events"]
    assert all(item.payload["sessionId"] == result.session_id for item in notifications)
