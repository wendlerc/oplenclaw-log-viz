#!/bin/bash
# Run modification summaries then regenerate slim file.
# Use: npm run mods-then-slim  (or ./scripts/mods-then-slim.sh)
cd "$(dirname "$0")/.."
npm run summarize:mods && npm run slim
echo "Done. View at http://localhost:5173/md-edits-view.html"
