#!/bin/sh
# Bundles the REAL src/main.jsx for a browser with stubbed charts/icons/parsers (they are not installable here).
cd "$(dirname "$0")/../.." || exit 1
NM=/home/claude/.npm-global/lib/node_modules
NODE_PATH=$NM $NM/tsx/node_modules/.bin/esbuild src/main.jsx --bundle --format=iife --platform=browser --jsx=automatic --loader:.jsx=jsx '--define:process.env.NODE_ENV="production"' '--define:__APP_VERSION__="\"0.6.3.0 TEST BUILD\""' --alias:lucide-react=./golden/appharness/stub-lucide.js --alias:recharts=./golden/appharness/stub-recharts.js --alias:papaparse=./golden/appharness/stub-papaparse.js --alias:xlsx=./golden/appharness/stub-xlsx.js --alias:jszip=./golden/appharness/stub-jszip.js --alias:pdfjs-dist/build/pdf.worker.min.mjs?url=./golden/appharness/stub-url.js --alias:pdfjs-dist=./golden/appharness/stub-pdfjs.js --outfile=golden/appharness/bundle.js --log-level=error
