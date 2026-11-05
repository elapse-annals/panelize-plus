// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "PanelizeSearchMac",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "PanelizeSearchApp", targets: ["PanelizeSearchApp"]),
        .executable(name: "PanelizeSearchBridge", targets: ["PanelizeSearchBridge"])
    ],
    targets: [
        .target(name: "PanelizeSearchCore"),
        .executableTarget(
            name: "PanelizeSearchApp",
            dependencies: ["PanelizeSearchCore"]
        ),
        .executableTarget(
            name: "PanelizeSearchBridge",
            dependencies: ["PanelizeSearchCore"]
        ),
        .testTarget(
            name: "PanelizeSearchCoreTests",
            dependencies: ["PanelizeSearchCore"]
        ),
        .testTarget(
            name: "PanelizeSearchAppTests",
            dependencies: ["PanelizeSearchApp", "PanelizeSearchCore"]
        )
    ]
)
