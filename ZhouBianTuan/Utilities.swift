import Foundation
import UIKit

enum ImageDataNormalizer {
    static func jpegData(from data: Data, maxSide: CGFloat = 1800, compressionQuality: CGFloat = 0.8) -> Data {
        guard let image = UIImage(data: data) else { return data }
        return jpegData(from: image, maxSide: maxSide, compressionQuality: compressionQuality) ?? data
    }
    static func jpegData(from image: UIImage, maxSide: CGFloat = 1800, compressionQuality: CGFloat = 0.8) -> Data? {
        let sourceSize = image.size
        guard sourceSize.width > 0, sourceSize.height > 0 else {
            return image.jpegData(compressionQuality: compressionQuality)
        }

        let longestSide = max(sourceSize.width, sourceSize.height)
        let scale = min(1, maxSide / max(longestSide, 1))
        let targetSize = CGSize(width: sourceSize.width * scale, height: sourceSize.height * scale)

        guard scale < 1 || image.imageOrientation != .up else {
            return image.jpegData(compressionQuality: compressionQuality)
        }

        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: targetSize, format: format)
        let renderedImage = renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: targetSize))
        }
        return renderedImage.jpegData(compressionQuality: compressionQuality)
    }
}

func hideKeyboard() {
    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap(\.windows)
        .forEach { $0.endEditing(true) }
}

func parsePriceAdjustment(_ value: String) -> Double {
    let cleaned = value
        .replacingOccurrences(of: "¥", with: "")
        .replacingOccurrences(of: "元", with: "")
        .trimmed
    return Double(cleaned) ?? 0
}

func formatPlainAmount(_ value: Double) -> String {
    guard value != 0 else { return "" }
    return value.rounded() == value ? String(Int(value)) : String(format: "%.2f", value)
}

enum SearchMatcher {
    static func normalized(_ value: String) -> String {
        value
            .folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: .current)
            .lowercased()
            .filter { !$0.isWhitespace && !$0.isNewline }
    }

    static func matchingCharacterCount(query: String, in candidate: String) -> Int {
        let queryText = normalized(query)
        let candidateText = normalized(candidate)
        guard !queryText.isEmpty, !candidateText.isEmpty else { return 0 }

        var remaining: [Character: Int] = [:]
        for character in candidateText {
            remaining[character, default: 0] += 1
        }

        var count = 0
        for character in queryText {
            if let value = remaining[character], value > 0 {
                remaining[character] = value - 1
                count += 1
            }
        }
        return count
    }

    static func score(query: String, candidate: String) -> Int {
        let queryText = normalized(query)
        let candidateText = normalized(candidate)
        guard !queryText.isEmpty, !candidateText.isEmpty else { return 0 }
        let overlap = matchingCharacterCount(query: query, in: candidate)
        let containsBoost = candidateText.contains(queryText) || queryText.contains(candidateText) ? 1_000 : 0
        let prefixBoost = candidateText.hasPrefix(queryText) ? 500 : 0
        return containsBoost + prefixBoost + overlap
    }

    static func matches(query: String, candidate: String) -> Bool {
        let queryText = normalized(query)
        guard !queryText.isEmpty else { return false }
        let candidateText = normalized(candidate)
        guard !candidateText.isEmpty else { return false }
        if candidateText.contains(queryText) || queryText.contains(candidateText) {
            return true
        }
        return matchingCharacterCount(query: query, in: candidate) >= min(2, queryText.count)
    }
}

func sanitizeDepositPercentInput(_ value: String) -> String {
    var result = ""
    var hasDecimalPoint = false
    var decimalDigits = 0

    for scalar in value.unicodeScalars {
        if scalar.value >= 48 && scalar.value <= 57 {
            if hasDecimalPoint {
                guard decimalDigits < 1 else { continue }
                decimalDigits += 1
            }
            result.unicodeScalars.append(scalar)
        } else if scalar == "." && !hasDecimalPoint {
            hasDecimalPoint = true
            if result.isEmpty {
                result = "0"
            }
            result.append(".")
        }
    }

    return result
}

func finalizedDepositPercent(_ value: String) -> String {
    let sanitized = sanitizeDepositPercentInput(value)
    return sanitized.hasSuffix(".") ? String(sanitized.dropLast()) : sanitized
}

extension String {
    var trimmed: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

extension Int {
    var formattedCount: String {
        if self >= 10_000 {
            let value = Double(self) / 10_000
            return String(format: "%.1fw", value)
        }
        return "\(self)"
    }
}

extension Date {
    var shortDeadlineText: String {
        let interval = timeIntervalSinceNow
        if interval <= 0 { return "已截团" }
        let hours = Int(interval / 3600)
        if hours < 24 {
            return hours <= 6 ? "\(max(hours, 1))小时后截团" : "今晚截团"
        }
        let days = Int(ceil(interval / 86400))
        return "\(days)天后截团"
    }

    var fullDisplay: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "M月d日 HH:mm"
        return formatter.string(from: self)
    }

    var shortDateOnlyText: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "yyyy年M月d日"
        return formatter.string(from: self)
    }

    var relativeText: String {
        let interval = abs(timeIntervalSinceNow)
        if interval < 60 { return "刚刚" }
        if interval < 3600 { return "\(Int(interval / 60))分钟前" }
        if interval < 86400 { return "\(Int(interval / 3600))小时前" }
        return "\(Int(interval / 86400))天前"
    }
}
