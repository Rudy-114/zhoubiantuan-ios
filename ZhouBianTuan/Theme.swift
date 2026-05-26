import SwiftUI
import UIKit

enum Theme {
    static let background = Color(adaptiveUIColor(
        dark: UIColor(red: 0.055, green: 0.055, blue: 0.075, alpha: 1),
        light: UIColor.white
    ))
    static let panel = Color(adaptiveUIColor(
        dark: UIColor(red: 0.095, green: 0.095, blue: 0.12, alpha: 1),
        light: UIColor(red: 0.965, green: 0.965, blue: 0.975, alpha: 1)
    ))
    static let panelRaised = Color(adaptiveUIColor(
        dark: UIColor(red: 0.13, green: 0.13, blue: 0.16, alpha: 1),
        light: UIColor(red: 0.92, green: 0.92, blue: 0.94, alpha: 1)
    ))
    static let hairline = Color(adaptiveUIColor(
        dark: UIColor.white.withAlphaComponent(0.08),
        light: UIColor.black.withAlphaComponent(0.10)
    ))
    static let text = Color(adaptiveUIColor(
        dark: UIColor.white.withAlphaComponent(0.92),
        light: UIColor.black.withAlphaComponent(0.88)
    ))
    static let subtext = Color(adaptiveUIColor(
        dark: UIColor.white.withAlphaComponent(0.58),
        light: UIColor.black.withAlphaComponent(0.58)
    ))
    static let muted = Color(adaptiveUIColor(
        dark: UIColor.white.withAlphaComponent(0.36),
        light: UIColor.black.withAlphaComponent(0.36)
    ))
    static let floatingBadgeBackground = Color(adaptiveUIColor(
        dark: UIColor.black.withAlphaComponent(0.54),
        light: UIColor.white.withAlphaComponent(0.78)
    ))
    static let floatingBadgeText = Color(adaptiveUIColor(
        dark: UIColor.white.withAlphaComponent(0.92),
        light: UIColor.black.withAlphaComponent(0.78)
    ))
    static let hotPink = Color(red: 1, green: 0.12, blue: 0.27)
    static let softPink = Color(red: 1, green: 0.42, blue: 0.58)

    static let barBackgroundUIColor = adaptiveUIColor(
        dark: UIColor(red: 0.07, green: 0.07, blue: 0.09, alpha: 1),
        light: UIColor.white
    )
    static let primaryTextUIColor = adaptiveUIColor(
        dark: UIColor.white.withAlphaComponent(0.92),
        light: UIColor.black.withAlphaComponent(0.88)
    )

    private static func adaptiveUIColor(dark: UIColor, light: UIColor) -> UIColor {
        UIColor { traitCollection in
            traitCollection.userInterfaceStyle == .dark ? dark : light
        }
    }
}

enum AppMotion {
    static let page = Animation.spring(response: 0.32, dampingFraction: 0.88)
    static let quick = Animation.spring(response: 0.24, dampingFraction: 0.86)

    static var sideCoverTransition: AnyTransition {
        .asymmetric(
            insertion: .move(edge: .trailing).combined(with: .opacity),
            removal: .move(edge: .trailing).combined(with: .opacity)
        )
    }
}
