import SwiftUI

struct AdminModerationView: View {
    @EnvironmentObject private var store: MockAppStore

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 16) {
                HeaderTitle(title: "审核后台", subtitle: "发布前机审 + 人工复核，处理待审帖子、评论、头像、背景和资料")
                HStack(spacing: 10) {
                    AdminMetric(title: "待人工审核", value: "\(store.moderationReviews.count)")
                    AdminMetric(title: "待审内容", value: "\(store.posts.filter { $0.status == .review || $0.status == .pending }.count)")
                    AdminMetric(title: "已驳回", value: "\(store.posts.filter { $0.status == .rejected }.count)")
                }
                .padding(.horizontal, 16)

                LazyVStack(spacing: 12) {
                    if store.moderationReviews.isEmpty {
                        EmptyModerationState()
                    } else {
                        ForEach(store.moderationReviews) { review in
                            ModerationReviewCard(review: review)
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 28)
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .task {
            store.loadModerationReviews()
        }
        .refreshable {
            store.loadModerationReviews()
        }
    }
}

private struct EmptyModerationState: View {
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "checkmark.shield.fill")
                .font(.system(size: 34, weight: .bold))
                .foregroundStyle(Theme.hotPink)
            Text("暂无待审内容")
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(Theme.text)
            Text("阿里云判定为疑似、超时或失败的内容会出现在这里。")
                .font(.system(size: 13))
                .foregroundStyle(Theme.subtext)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 36)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

private struct ModerationReviewCard: View {
    @EnvironmentObject private var store: MockAppStore
    let review: ModerationReview

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(review.targetType.displayName)
                        .font(.system(size: 13, weight: .black))
                        .foregroundStyle(Theme.hotPink)
                    Text(review.reason.isEmpty ? "等待人工复核" : review.reason)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Theme.text)
                }
                Spacer()
                Text(review.status.displayName)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Color.orange)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Color.orange.opacity(0.14), in: Capsule())
            }

            HStack(spacing: 8) {
                Label(review.source.displayName, systemImage: review.source == .imageSignal ? "photo.fill" : "text.alignleft")
                Label(riskText, systemImage: "exclamationmark.shield.fill")
                Text(review.createdAt.relativeText)
            }
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Theme.subtext)

            if !review.textSnapshot.isEmpty {
                Text(review.textSnapshot)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.subtext)
                    .lineLimit(6)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.panelRaised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            }

            if !review.imageURLs.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(review.imageURLs, id: \.self) { url in
                            RemoteImagePreview(urlString: url)
                            .frame(width: 86, height: 86)
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                    }
                }
            }

            HStack(spacing: 8) {
                AdminActionButton(title: "通过") { store.handleModerationReview(review, decision: "approve") }
                AdminActionButton(title: "驳回") { store.handleModerationReview(review, decision: "reject") }
                AdminActionButton(title: "隐藏") { store.handleModerationReview(review, decision: "hide") }
                AdminActionButton(title: "下架") { store.handleModerationReview(review, decision: "remove") }
                AdminActionButton(title: "忽略") { store.handleModerationReview(review, decision: "ignore") }
            }
        }
        .padding(16)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private var riskText: String {
        switch review.riskLevel {
        case .none: "无风险"
        case .low: "低风险"
        case .medium: "中风险"
        case .high: "高风险"
        }
    }
}
