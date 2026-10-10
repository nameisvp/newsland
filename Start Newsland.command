#!/bin/zsh
cd "${0:A:h}"
if [ -x ".venv/bin/python" ]; then
  PYTHON=".venv/bin/python"
elif [ -n "$VIRTUAL_ENV" ] && [ -x "$VIRTUAL_ENV/bin/python" ]; then
  PYTHON="$VIRTUAL_ENV/bin/python"
else
  PYTHON="python3"
fi

if $PYTHON -c 'import urllib.request; urllib.request.urlopen("http://localhost:8765/api/briefing", timeout=1)' 2>/dev/null; then
  open http://localhost:8765
  exit 0
fi
$PYTHON server.py &
newsland_pid=$!
trap 'kill "$newsland_pid" 2>/dev/null' EXIT INT TERM
sleep 1
open http://localhost:8765
wait "$newsland_pid"
