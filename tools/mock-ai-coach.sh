#!/usr/bin/env sh
cat >/dev/null
cat <<'JSON'
{
  "provider": "mock-ai",
  "summary": "AI fixture summary grounded in the supplied evidence packet.",
  "priorities": [
    "Review first-death evidence before changing roles.",
    "Practice the highest-severity team habit first."
  ],
  "caveats": [
    "Fixture response for integration tests."
  ]
}
JSON
