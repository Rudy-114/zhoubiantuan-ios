import SwiftUI

struct ModerationStatusBadge: View {
    let status: ContentStatus
    var reason: String = ""

    var body: some View {
        if status != .active {
            HStack(spacing: 5) {
                Image(systemName: iconName)
                    .font(.system(size: 11, weight: .bold))
                Text(status.rawValue)
                    .font(.system(size: 11, weight: .bold))
                    .lineLimit(1)
            }
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(color.opacity(0.14), in: Capsule())
            .accessibilityLabel(reason.isEmpty ? status.rawValue : "\(status.rawValue)，\(reason)")
        }
    }

    private var color: Color {
        switch status {
        case .pending, .review:
            return Color.orange
        case .rejected, .removed:
            return Color.red
        case .hidden, .deleted:
            return Theme.muted
        case .active:
            return Theme.subtext
        }
    }

    private var iconName: String {
        switch status {
        case .pending, .review:
            return "clock.fill"
        case .rejected:
            return "xmark.circle.fill"
        case .hidden:
            return "eye.slash.fill"
        case .removed, .deleted:
            return "minus.circle.fill"
        case .active:
            return "checkmark.circle.fill"
        }
    }
}

struct ModerationInlineNotice: View {
    let status: ContentStatus
    var reason: String = ""

    var body: some View {
        if status != .active {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: status == .rejected ? "exclamationmark.triangle.fill" : "clock.fill")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(status == .rejected ? Color.red : Color.orange)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.text)
                    if !reason.isEmpty {
                        Text(reason)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.subtext)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer()
            }
            .padding(10)
            .background(Theme.panelRaised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
    }

    private var title: String {
        switch status {
        case .pending, .review:
            return "内容已提交审核，通过后将公开展示"
        case .rejected:
            return "内容未通过审核"
        case .hidden:
            return "内容已被隐藏"
        case .removed:
            return "内容已下架"
        case .deleted:
            return "内容已删除"
        case .active:
            return ""
        }
    }
}
