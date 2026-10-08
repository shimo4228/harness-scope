#!/usr/bin/env bash
# Scaffold: the run's workspace selects the bundled writing profile.
mkdir -p .claude && printf '{"profile":"writing"}\n' > .claude/harness-scope.json
