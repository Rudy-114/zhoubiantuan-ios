import SwiftUI

struct ReportButton: View {
    @EnvironmentObject private var store: MockAppStore
    @State private var isPresented = false
    let target: ReportTarget

    var body: some View {
        Button("举报\(target.label)", systemImage: "flag") {
            guard store.requireLogin(prompt: "登录后才能举报") else { return }
            isPresented = true
        }
        .font(.subheadline)
        .sheet(isPresented: $isPresented) { ReportForm(target: target) }
    }
}

struct ReportForm: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var reason = "虚假或诈骗信息"
    @State private var detail = ""
    @State private var isSubmitting = false
    let target: ReportTarget
    private let reasons = ["虚假或诈骗信息", "骚扰或不友善内容", "违规图片或文字", "信息过期或联系方式无效", "其他问题"]

    var body: some View {
        NavigationStack {
            Form {
                Picker("举报原因", selection: $reason) {
                    ForEach(reasons, id: \.self) { Text($0).tag($0) }
                }
                Section("补充说明（最多 2000 字）") {
                    TextEditor(text: $detail).frame(minHeight: 140)
                }
                if target.type == "message" {
                    Text("提交后，所选私信的文字和图片会提供给审核人员。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Button(isSubmitting ? "正在提交…" : "提交举报") {
                    let session = store.authSessionVersion
                    isSubmitting = true
                    Task { @MainActor in
                        guard store.isCurrentSession(session) else { return }
                        let saved = await store.submitReport(target: target, reason: reason, detail: detail)
                        guard store.isCurrentSession(session) else { return }
                        isSubmitting = false
                        if saved { dismiss() }
                    }
                }
                .disabled(isSubmitting || detail.count > 2000)
            }
            .disabled(isSubmitting)
            .navigationTitle("举报\(target.label)")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() }.disabled(isSubmitting) } }
            .interactiveDismissDisabled(isSubmitting)
            .onChange(of: store.authSessionVersion) { _, _ in dismiss() }
        }
    }
}

struct AdminReportView: View {
    var body: some View { ReportListView(admin: true) }
}

struct ReportListView: View {
    @EnvironmentObject private var store: MockAppStore
    let admin: Bool
    @State private var entries: [Report] = []
    @State private var status = "pending"
    @State private var cursor: String?
    @State private var hasMore = false
    @State private var requestID: UUID?
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if admin && !store.canModerate {
                ContentUnavailableView("需要管理员权限", systemImage: "lock")
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 16) {
                        if admin {
                            Picker("队列", selection: $status) {
                                Text("待处理").tag("pending")
                                Text("全部").tag("all")
                            }.pickerStyle(.segmented)
                        }
                        if let errorMessage {
                            Text(errorMessage).foregroundStyle(Theme.hotPink)
                            Button("重试") { Task { await load(reset: true) } }
                        }
                        if requestID != nil { ProgressView() }
                        if entries.isEmpty && requestID == nil && errorMessage == nil {
                            Text(admin ? "当前没有举报记录" : "你还没有提交过举报").foregroundStyle(Theme.subtext)
                        }
                        ForEach(entries) { report in
                            if admin {
                                AdminReportCard(report: report) { Task { await load(reset: true) } }
                            } else {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("\(report.target.label) · \(report.reason)").font(.headline)
                                    Text(report.status.rawValue).foregroundStyle(Theme.hotPink)
                                    if !report.detail.isEmpty { Text(report.detail).font(.subheadline) }
                                    if let result = report.adminResult { Text("处理说明：\(result)").font(.subheadline) }
                                }
                                .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                                .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
                            }
                        }
                        if hasMore { Button("加载更多") { Task { await load(reset: false) } }.disabled(requestID != nil) }
                    }
                    .padding(16)
                }
                .refreshable { await load(reset: true) }
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(admin ? "举报处理" : "我的举报")
        .navigationBarHidden(false)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: "\(store.authSessionVersion)-\(status)") { await load(reset: true) }
        .onChange(of: store.authSessionVersion) { _, _ in entries = []; cursor = nil; requestID = nil }
    }

    @MainActor private func load(reset: Bool) async {
        guard let token = store.backendToken, !admin || store.canModerate else { return }
        if !reset && requestID != nil { return }
        let session = store.authSessionVersion, id = UUID()
        requestID = id
        errorMessage = nil
        defer { if requestID == id { requestID = nil } }
        do {
            let page = try await store.backendClient.reportsPage(token: token, admin: admin, status: admin ? status : "all", cursor: reset ? nil : cursor)
            guard store.isCurrentSession(session), requestID == id else { return }
            let reports = page.reports.map { $0.localReport() }
            if reset { entries = reports } else {
                let known = Set(entries.map(\.id)); entries += reports.filter { !known.contains($0.id) }
            }
            cursor = page.nextCursor
            hasMore = page.hasMore
        } catch {
            guard store.isCurrentSession(session), requestID == id else { return }
            errorMessage = error.localizedDescription
        }
    }
}

struct AdminReportCard: View {
    @EnvironmentObject private var store: MockAppStore
    let report: Report
    var onHandled: () -> Void
    @State private var reason = ""
    @State private var isSaving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("\(report.target.label) · \(report.reason)").font(.headline)
            Text(report.status.rawValue).foregroundStyle(Theme.hotPink)
            if !report.detail.isEmpty { Text("举报说明：\(report.detail)") }
            Text("举报时内容").font(.caption).foregroundStyle(Theme.subtext)
            Text(report.snapshot?.text ?? "历史记录未保存内容快照")
            ForEach(report.snapshot?.imageURLs ?? [], id: \.self) { url in
                RemoteImageView(urlString: BackendAssetURLMapper.normalized(url))
                    .scaledToFit().frame(maxHeight: 280)
            }
            if report.currentSnapshot?.text != report.snapshot?.text {
                Text("当前内容").font(.caption).foregroundStyle(Theme.subtext)
                Text(report.currentSnapshot?.text ?? "内容已不存在")
            }
            if report.status == .pending {
                TextField("处理理由（必填）", text: $reason, axis: .vertical).textFieldStyle(.roundedBorder)
                HStack {
                    Button("不予处理") { decide("ignore") }
                    if report.currentSnapshot != nil {
                        Button(report.target.type == "user" ? "停用账号" : "下架内容", role: .destructive) {
                            decide(report.target.type == "user" ? "suspend" : "remove")
                        }
                    }
                }.buttonStyle(.bordered).disabled(reason.trimmed.isEmpty || reason.count > 1000 || isSaving)
                if isSaving { ProgressView() }
            } else if let result = report.adminResult { Text("处理说明：\(result)").font(.subheadline) }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
        .disabled(isSaving)
    }

    private func decide(_ action: String) {
        let session = store.authSessionVersion
        isSaving = true
        Task { @MainActor in
            guard store.isCurrentSession(session) else { return }
            let saved = await store.decideReport(report, action: action, reason: reason)
            guard store.isCurrentSession(session) else { return }
            isSaving = false
            if saved { onHandled() }
        }
    }
}
