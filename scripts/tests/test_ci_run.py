import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).parents[1] / "ci-run.py"


class CommandOutputTests(unittest.TestCase):
    def run_command(self, status):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        env = {**os.environ, "PYTHONIOENCODING": "cp1252", "GITHUB_ACTIONS": "true",
               "GITHUB_STEP_SUMMARY": str(root / "summary.md")}
        child = "import sys; sys.stdout.buffer.write(bytes.fromhex('e28692203c6465766963653e0a')); sys.exit(" + str(status) + ")"
        result = subprocess.run([sys.executable, str(SCRIPT), "--log", str(root / "command.log"),
                                 "--", sys.executable, "-c", child],
                                env=env, capture_output=True, timeout=15)
        return result, root

    def test_unicode_output_survives_a_windows_style_console_encoding(self):
        result, root = self.run_command(0)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("→ <device>", result.stdout.decode("utf-8"))
        self.assertIn("→ <device>", (root / "command.log").read_text(encoding="utf-8"))

    def test_failure_retains_exit_status_and_safe_unicode_diagnostics(self):
        result, root = self.run_command(3)
        self.assertEqual(result.returncode, 3, result.stderr)
        self.assertIn("::error title=Check failed::", result.stdout.decode("utf-8"))
        self.assertIn("→ &lt;device&gt;", (root / "summary.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
