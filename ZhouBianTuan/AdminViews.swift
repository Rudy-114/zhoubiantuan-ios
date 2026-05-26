import SwiftUI

struct AdminReportView: View {
    @EnvironmentObject private var store: MockAppStore

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 18) {
                HeaderTitle(title: "管理后台", subtitle: "自由发布 + 后审治理，处理虚假、过期、诈骗和无效联系方式")
                HStack(spacing: 10) {
                    AdminMetric(title: "待处理", value: "\(store.reports.filter { $0.status == .pending }.count)")
                    AdminMetric(title: "被举报内容", value: "\(store.posts.filter { $0.reportCount > 0 }.count)")
                    AdminMetric(title: "已下架", value: "\(store.posts.filter { $0.status == .removed }.count)")
                }
                .padding(.horizontal, 16)

                VStack(spacing: 12) {
                    ForEach(store.reports) { report in
                        AdminReportCard(report: report)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 28)
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct AdminReportCard: View {
    @EnvironmentObject private var store: MockAppStore
    let report: Report

    var post: GroupBuyPost? {
        if case .post(let id) = report.target {
            return store.post(id: id)
        }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(report.reason)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Theme.text)
                Spacer()
                Text(report.status.rawValue)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(report.status == .pending ? Theme.hotPink : Theme.subtext)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background((report.status == .pending ? Theme.hotPink : Color.white).opacity(0.12), in: Capsule())
            }
            Text(report.detail)
                .font(.system(size: 14))
                .foregroundStyle(Theme.subtext)
            if let post {
                NavigationLink(value: Route.postDetail(post.id)) {
                    HStack(spacing: 10) {
                        PostImageView(post: post)
                            .scaledToFill()
                            .frame(width: 70, height: 70)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        VStack(alignment: .leading, spacing: 5) {
                            Text(post.title)
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(Theme.text)
                                .lineLimit(2)
                            Text("状态：\(post.status.rawValue) · 举报 \(post.reportCount)")
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.muted)
                        }
                        Spacer()
                    }
                }
                .buttonStyle(.plain)
            }
            if report.status == .pending {
                HStack(spacing: 8) {
                    AdminActionButton(title: "忽略") { store.handleReport(reportID: report.id, status: .ignored) }
                    AdminActionButton(title: "隐藏") { store.handleReport(reportID: report.id, status: .hidden) }
                    AdminActionButton(title: "下架") { store.handleReport(reportID: report.id, status: .removed) }
                    AdminActionButton(title: "警告") { store.handleReport(reportID: report.id, status: .warned) }
                }
            }
        }
        .padding(16)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
    }
}
