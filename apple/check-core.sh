#!/bin/sh
# Run the portable Foundation checks without requiring an Xcode installation.
set -eu
ledger_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ledger_cache="${TMPDIR:-/tmp}/simple-ledger-swift-cache"
ledger_checks="${TMPDIR:-/tmp}/simple-ledger-native-checks"
mkdir -p "$ledger_cache" "$ledger_checks" /private/tmp/simple-ledger-native-checks
cd "$ledger_root"
CLANG_MODULE_CACHE_PATH="$ledger_cache" SWIFT_MODULECACHE_PATH="$ledger_cache" \
  swiftc apple/Sources/LedgerCore/*.swift apple/Tests/StandaloneChecks.swift -o "$ledger_checks/core-checks"
"$ledger_checks/core-checks"
