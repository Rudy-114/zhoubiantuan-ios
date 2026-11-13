// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ZhouBianTuanCore",
    platforms: [
        .macOS(.v13),
        .iOS(.v17)
    ],
    products: [
        .library(name: "ZhouBianTuanCore", targets: ["ZhouBianTuanCore"])
    ],
    targets: [
        .target(
            name: "ZhouBianTuanCore",
            path: "ZhouBianTuan",
            sources: ["RealtimePolicy.swift", "SafetyModels.swift"]
        ),
        .testTarget(
            name: "ZhouBianTuanCoreTests",
            dependencies: ["ZhouBianTuanCore"],
            path: "ZhouBianTuanCoreTests"
        )
    ]
)
