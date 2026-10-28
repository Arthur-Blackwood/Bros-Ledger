# Native migration core — work in progress

This folder contains the first part of the planned iOS/macOS app: a Foundation-only model, versioned web backup and CSV reader/writer, and calendar-based repeat generation. It is **not an installable app yet**. No iCloud synchronization is implemented or verified in this folder. Continue using the existing website for real records.

The checks use the same fictional fixtures and stable legacy CSV IDs as the web application. They verify old and v2 CSV, complete JSON backups, repeat progress, deleted entries, month-end and leap-day scheduling, exact amounts, and deterministic generated IDs across independent devices.

Run from the repository root:

```sh
./apple/check-core.sh
node scripts/check-native-compatibility.mjs
```

The second command requires the web dependencies from `npm install` and checks that the website can read both native output formats. `swift test --package-path apple` adds XCTest coverage when the full Xcode test framework is installed. The command-line tools on this machine do not include XCTest or the SwiftData compiler plugin, and there is no iOS SDK or Xcode signing environment. A future app must still implement and verify its interface, protected local storage, CloudKit setup, import and conflict handling, and real iPhone/Mac synchronization before being used with personal records.

A prior experimental SwiftData store is preserved separately under `work/native-unverified/` and in the original upgrade draft archive. It has not been validated and must not be treated as production code.
