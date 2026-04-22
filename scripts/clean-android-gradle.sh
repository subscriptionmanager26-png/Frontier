#!/usr/bin/env bash
# Stop daemons and remove project-local Gradle caches (safe; they regenerate).
# Run from repo root: bash scripts/clean-android-gradle.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/android"
./gradlew --stop 2>/dev/null || true
cd "$ROOT"
rm -rf android/.gradle
rm -rf node_modules/@react-native/gradle-plugin/.gradle
rm -rf node_modules/expo-modules-core/expo-module-gradle-plugin/.gradle
rm -rf node_modules/expo-modules-autolinking/android/expo-gradle-plugin/.gradle
echo "Done. Ensure Android Studio is closed, then: cd android && ./gradlew assembleDebug --no-daemon"
