#!/usr/bin/env bash
# Scaffold: a selector that is not JSON. harness-scope must pass everything through and say so.
mkdir -p .claude && printf '{"profile": ' > .claude/harness-scope.json
