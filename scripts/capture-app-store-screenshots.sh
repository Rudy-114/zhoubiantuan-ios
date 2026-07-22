#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
device_name="${ZBT_SCREENSHOT_DEVICE:-iPhone 17 Pro Max}"
bundle_id="com.panpanpan.zhoubiantuan"
derived_data="$project_root/output/app-store/DerivedData-screenshots"
fixture_dir="$project_root/output/app-store/screenshot-fixtures"
screenshot_dir="$project_root/output/app-store/screenshots"
upload_dir="$project_root/output/app-store/screenshots-upload"
app_path="$derived_data/Build/Products/Debug-iphonesimulator/ZhouBianTuan.app"

device_id="$(
    xcrun simctl list devices available \
        | awk -v name="$device_name" 'index($0, name " (") { value=$0 } END { print value }' \
        | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/'
)"
if [[ ! "$device_id" =~ ^[0-9A-F-]{36}$ ]]; then
    echo "No available simulator named '$device_name'" >&2
    exit 1
fi

mkdir -p "$screenshot_dir"
mkdir -p "$upload_dir"

xcodebuild \
    -project "$project_root/ZhouBianTuan.xcodeproj" \
    -scheme ZhouBianTuan \
    -configuration Debug \
    -destination "platform=iOS Simulator,id=$device_id" \
    -derivedDataPath "$derived_data" \
    CODE_SIGNING_ALLOWED=NO \
    build

xcrun simctl boot "$device_id" 2>/dev/null || true
xcrun simctl bootstatus "$device_id" -b
open -a Simulator --args -CurrentDeviceUDID "$device_id"

xcrun simctl install "$device_id" "$app_path"
data_container="$(xcrun simctl get_app_container "$device_id" "$bundle_id" data)"
asset_container="$data_container/Documents/AppStoreScreenshotAssets"
mkdir -p "$asset_container"
cp "$fixture_dir"/*.png "$asset_container"/

xcrun simctl ui "$device_id" appearance dark
xcrun simctl status_bar "$device_id" override \
    --time 9:41 \
    --operatorName "" \
    --wifiBars 3 \
    --cellularBars 4 \
    --batteryLevel 100 \
    --batteryState charged

screens=(home detail create profile safety)
filenames=(
    01-home-feed.png
    02-post-detail.png
    03-create-post.png
    04-profile.png
    05-report-safety.png
)

for index in "${!screens[@]}"; do
    screen="${screens[$index]}"
    destination="$screenshot_dir/${filenames[$index]}"
    SIMCTL_CHILD_ZBT_SCREENSHOT_MODE="$screen" \
        xcrun simctl launch --terminate-running-process "$device_id" "$bundle_id" >/dev/null
    sleep 2
    xcrun simctl io "$device_id" screenshot "$destination" >/dev/null
    sips \
        --setProperty format jpeg \
        --setProperty formatOptions 95 \
        "$destination" \
        --out "$upload_dir/${filenames[$index]%.png}.jpg" >/dev/null
    echo "$destination"
done

SIMCTL_CHILD_ZBT_SCREENSHOT_MODE=home \
    xcrun simctl launch --terminate-running-process "$device_id" "$bundle_id" >/dev/null

echo "Simulator: $device_name ($device_id)"
echo "Screenshots: $screenshot_dir"
echo "App Store upload files: $upload_dir"
