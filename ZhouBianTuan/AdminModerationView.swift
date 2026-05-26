import SwiftUI

struct AdminModerationView: View {
    var reviews: [ModerationReview]

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                ForEach(reviews) { review in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(review.targetType.rawValue)
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(Theme.hotPink)
                            Spacer()
                            Text(review.status.rawValue)
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(Theme.subtext)
                        }
                        Text(review.reason)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Theme.text)
                        if !review.textSnapshot.isEmpty {
                            Text(review.textSnapshot)
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.subtext)
                                .lineLimit(3)
                        }
                    }
                    .padding(14)
                    .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
            }
            .padding(16)
        }
        .background(Theme.background.ignoresSafeArea())
    }
}
