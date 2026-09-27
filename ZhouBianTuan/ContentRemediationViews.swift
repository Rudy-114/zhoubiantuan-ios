import SwiftUI

enum ContentRemediationBucket: String, CaseIterable, Identifiable {
    case waitingCorrection
    case rechecking
    case manualReview
    case appeal
    case completed

    var id: String { rawValue }

    var title: String {
        switch self {
        case .waitingCorrection: "待整改"
        case .rechecking: "复审中"
        case .manualReview: "人工处理中"
        case .appeal: "可申诉"
        case .completed: "已完成"
        }
    }

    var subtitle: String {
        switch self {
        case .waitingCorrection: "修改受影响内容后提交复审"
        case .rechecking: "候选版本审核完成前，原内容保持当前状态"
        case .manualReview: "需要人工处理，不会由自动审核直接恢复"
        case .appeal: "仅对当前可申诉的最终处理提交一次说明"
        case .completed: "处理已经结束，可查看当前内容状态"
        }
    }
}

enum ContentRemediationCommand: Equatable {
    case correct
    case correctAgain
    case appeal

    var title: String {
        switch self {
        case .correct: "开始整改"
        case .correctAgain: "再次整改"
        case .appeal: "提交申诉"
        }
    }
}

enum ContentRemediationPresentation {
    static let appealDetailLimit = 1_000
    static let appealImageLimit = 6

    static func bucket(for action: SafetyContentAction) -> ContentRemediationBucket {
        if action.canAppeal { return .appeal }
        if ["manual_review", "appealed", "monitoring"].contains(action.status) {
            return .manualReview
        }
        if action.status == "awaiting_correction" { return .waitingCorrection }
        if action.status == "rechecking" || action.revisionStatus == "pending" || action.revisionStatus == "approved" {
            return .rechecking
        }
        return .completed
    }

    static func primaryCommand(for action: SafetyContentAction) -> ContentRemediationCommand? {
        if action.canAppeal { return .appeal }
        guard action.canSubmitRevision else { return nil }
        return action.revisionStatus == "rejected" ? .correctAgain : .correct
    }

    static func statusTitle(for action: SafetyContentAction) -> String {
        if action.canAppeal { return "可申诉" }
        if ["manual_review", "appealed", "monitoring"].contains(action.status) {
            return "人工处理中"
        }
        if action.canSubmitRevision && action.revisionStatus == "rejected" {
            return "上次整改未通过"
        }
        if action.status == "rechecking" || action.revisionStatus == "pending" || action.revisionStatus == "approved" {
            return "复审中"
        }
        switch action.status {
        case "awaiting_correction": return "待整改"
        case "resolved_restored": return "已恢复"
        case "resolved_actioned": return "处理已生效"
        case "resolved_no_action": return "无需处理"
        default: return "处理中"
        }
    }
}

struct SafetyContentActionInlineError: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.circle.fill")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(.red)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel("提交失败：\(message)")
    }
}

struct ContentRemediationView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var appealAction: SafetyContentAction?
    let visibleBuckets: [ContentRemediationBucket]

    init(visibleBuckets: [ContentRemediationBucket] = ContentRemediationBucket.allCases) {
        self.visibleBuckets = visibleBuckets
    }

    var body: some View {
        VStack(spacing: 0) {
            SimpleTopBar(title: "内容处理", trailing: nil) { dismiss() }

            PullToRefreshScrollView {
                LazyVStack(alignment: .leading, spacing: 28) {
                    if store.isLoadingSafetyContentActions && store.safetyContentActions.isEmpty {
                        ProgressView("正在读取内容状态")
                            .tint(Theme.accent)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 64)
                    } else if store.safetyContentActions.isEmpty {
                        emptyState
                    } else {
                        ForEach(visibleBuckets) { bucket in
                            let actions = store.safetyContentActions.filter {
                                ContentRemediationPresentation.bucket(for: $0) == bucket
                            }
                            if !actions.isEmpty {
                                remediationSection(bucket: bucket, actions: actions)
                            }
                        }
                    }

                    if let error = store.safetyContentActionErrorMessage {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(error)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.subtext)
                            Button("重新载入") {
                                Task { await store.refreshSafetyContentActions() }
                            }
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Theme.accent)
                        }
                        .padding(.horizontal, 16)
                    }
                }
                .padding(.vertical, 24)
            } action: {
                await store.refreshSafetyContentActions()
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .navigationBarHidden(true)
        .toolbar(.hidden, for: .tabBar)
        .task {
            if store.safetyContentActions.isEmpty {
                await store.refreshSafetyContentActions()
            }
        }
        .sheet(item: $appealAction) { action in
            SafetyAppealSheet(action: action)
                .environmentObject(store)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "checkmark.shield")
                .font(.system(size: 34, weight: .medium))
                .foregroundStyle(Theme.accent)
            Text("暂无待处理内容")
                .font(.system(size: 19, weight: .bold))
                .foregroundStyle(Theme.text)
            Text("需要整改、复审或申诉的内容会显示在这里。")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 28)
        .padding(.top, 56)
    }

    @ViewBuilder
    private func remediationSection(
        bucket: ContentRemediationBucket,
        actions: [SafetyContentAction]
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text(bucket.title)
                    .font(.system(size: 20, weight: .black))
                    .foregroundStyle(Theme.text)
                Text(bucket.subtitle)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 10)

            ForEach(Array(actions.enumerated()), id: \.element.id) { index, action in
                ContentRemediationRow(
                    action: action,
                    objectTitle: objectTitle(for: action),
                    command: ContentRemediationPresentation.primaryCommand(for: action),
                    onAppeal: { appealAction = action }
                )
                if index < actions.count - 1 {
                    Divider()
                        .overlay(Theme.hairline)
                        .padding(.leading, 16)
                }
            }
        }
        .background(Theme.panel)
    }

    private func objectTitle(for action: SafetyContentAction) -> String {
        if let targetTitle = action.targetTitle?.trimmed, !targetTitle.isEmpty {
            return targetTitle
        }
        switch action.targetType {
        case .post:
            return store.post(id: action.targetID)?.title ?? "团购帖 \(action.targetID)"
        case .collection:
            return store.collection(id: action.targetID)?.name ?? "拼团合集 \(action.targetID)"
        default:
            return "\(action.targetType.displayName) \(action.targetID)"
        }
    }
}

private struct ContentRemediationRow: View {
    let action: SafetyContentAction
    let objectTitle: String
    let command: ContentRemediationCommand?
    let onAppeal: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(objectTitle)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Theme.text)
                        .lineLimit(2)
                    Text(action.targetType.displayName)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Theme.muted)
                }
                Spacer(minLength: 8)
                Text(ContentRemediationPresentation.statusTitle(for: action))
                    .font(.system(size: 12, weight: .black))
                    .foregroundStyle(action.canSubmitRevision || action.canAppeal ? Theme.accent : Theme.subtext)
            }

            Label(action.affectedFields.map(\.displayName).joined(separator: "、"), systemImage: "slider.horizontal.3")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.subtext)

            if !action.currentRestriction.trimmed.isEmpty {
                Label(action.currentRestriction, systemImage: "eye.slash")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.subtext)
            }

            if let dueAt = BackendDateParser.strictDate(from: action.correctionDueAt) {
                Label("请在 \(dueAt.fullDisplay) 前提交", systemImage: "clock")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.accent)
            }

            if action.revisionStatus == "rejected" {
                Text(action.reason)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.subtext)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let command {
                commandView(command)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 15)
    }

    @ViewBuilder
    private func commandView(_ command: ContentRemediationCommand) -> some View {
        switch command {
        case .appeal:
            Button(action: onAppeal) { commandLabel(command.title) }
                .buttonStyle(.plain)
        case .correct, .correctAgain:
            if action.targetType == .post {
                NavigationLink(destination: SafetyPostCorrectionView(action: action)) {
                    commandLabel(command.title)
                }
                .buttonStyle(.plain)
            } else if action.targetType == .collection {
                NavigationLink(destination: SafetyCollectionCorrectionView(action: action)) {
                    commandLabel(command.title)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func commandLabel(_ title: String) -> some View {
        HStack(spacing: 6) {
            Text(title)
            Image(systemName: "arrow.right")
        }
        .font(.system(size: 14, weight: .black))
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Theme.accentFill, in: Capsule())
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

struct SafetyPostCorrectionView: View {
    let action: SafetyContentAction

    var body: some View {
        CreatePostView(
            revisionCaseID: action.caseID,
            editingOriginalPostID: action.targetID
        )
    }
}

struct SafetyCollectionCorrectionView: View {
    @EnvironmentObject private var store: MockAppStore
    let action: SafetyContentAction

    var body: some View {
        if let collection = store.collection(id: action.targetID) {
            CreateCollectionSheet(
                editingCollection: collection,
                revisionCaseID: action.caseID
            )
        } else {
            ContentUnavailableView(
                "找不到原合集",
                systemImage: "rectangle.stack.badge.exclamationmark",
                description: Text("请返回刷新后重试。")
            )
        }
    }
}

struct SafetyAppealSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    let action: SafetyContentAction
    @State private var detail = ""
    @State private var images: [Data] = []
    @State private var isPhotoLibraryPresented = false
    @State private var submissionErrorMessage: String?

    private var detailCount: Int {
        SafetyReportFormLogic.codePointCount(in: detail)
    }

    private var canSubmit: Bool {
        !detail.trimmed.isEmpty
            && detailCount <= ContentRemediationPresentation.appealDetailLimit
            && images.count <= ContentRemediationPresentation.appealImageLimit
            && !store.isSubmittingSafetyContentAction
    }

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("提交申诉")
                            .font(.system(size: 26, weight: .black))
                            .foregroundStyle(Theme.text)
                        Text("说明你认为需要重新核对的事实。申诉将进入人工处理。")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.subtext)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        PrototypeTextEditor(
                            title: "申诉说明",
                            placeholder: "请写明需要重新核对的具体事实",
                            text: $detail,
                            required: true
                        )
                        Text("\(detailCount)/\(ContentRemediationPresentation.appealDetailLimit)")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(detailCount > ContentRemediationPresentation.appealDetailLimit ? .red : Theme.muted)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Text("补充图片（可选）")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Theme.text)
                        ImageUploadComposer(images: $images) {
                            isPhotoLibraryPresented = true
                        }
                        Text("最多 6 张，仅用于本次人工核对。")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.muted)
                    }

                    Button {
                        Task {
                            submissionErrorMessage = nil
                            let succeeded = await store.submitAppeal(
                                caseID: action.caseID,
                                detail: detail,
                                imageData: images
                            )
                            if succeeded {
                                dismiss()
                            } else {
                                submissionErrorMessage = store.safetyContentActionErrorMessage
                                    ?? "申诉提交失败，请重试"
                            }
                        }
                    } label: {
                        HStack(spacing: 8) {
                            if store.isSubmittingSafetyContentAction {
                                ProgressView().tint(.white)
                            }
                            Text(store.isSubmittingSafetyContentAction ? "正在提交" : "提交人工申诉")
                        }
                        .font(.system(size: 16, weight: .bold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(canSubmit ? Theme.accentFill : Theme.panelRaised, in: Capsule())
                        .foregroundStyle(canSubmit ? .white : Theme.muted)
                    }
                    .buttonStyle(.plain)
                    .disabled(!canSubmit)

                    if let submissionErrorMessage {
                        SafetyContentActionInlineError(message: submissionErrorMessage)
                    }
                }
                .padding(16)
                .padding(.bottom, 24)
            }
            .background(Theme.background.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("关闭") { dismiss() }
                }
            }
            .fullScreenCover(isPresented: $isPhotoLibraryPresented) {
                PhotoLibraryImportView(
                    maxSelection: max(1, ContentRemediationPresentation.appealImageLimit - images.count)
                ) { importedData in
                    images.append(contentsOf: importedData)
                    images = Array(images.prefix(ContentRemediationPresentation.appealImageLimit))
                }
            }
        }
    }
}
