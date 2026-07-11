import PhotosUI
import SwiftUI
import UIKit

struct SafetyReportSource: Identifiable, Equatable, Sendable {
    let type: SafetyTargetType
    let id: String
    let title: String
    let ownerUserID: String
    let collectionID: String?
    let peerUserID: String?
    let objectID: String

    init(
        type: SafetyTargetType,
        id objectID: String,
        title: String,
        ownerUserID: String,
        collectionID: String?,
        peerUserID: String?
    ) {
        self.type = type
        self.objectID = objectID
        self.id = "\(type.rawValue):\(objectID)"
        self.title = title
        self.ownerUserID = ownerUserID
        self.collectionID = collectionID
        self.peerUserID = peerUserID
    }

    var canOfferBlock: Bool {
        type == .user || type == .directMessage
    }

    var allowedReasons: [SafetyReasonCode] {
        switch type {
        case .directMessage:
            [.suspectedScam, .harassmentOrAbuse, .sexualOrIllegal, .spamOrAdvertising, .directMessageRisk, .other]
        case .comment:
            [.suspectedScam, .harassmentOrAbuse, .sexualOrIllegal, .spamOrAdvertising, .other]
        case .user:
            [.suspectedScam, .copyrightOrStolenMedia, .harassmentOrAbuse, .sexualOrIllegal, .spamOrAdvertising, .other]
        case .collection:
            [.suspectedScam, .falseOrExpiredGroupBuy, .invalidContact, .copyrightOrStolenMedia, .sexualOrIllegal, .spamOrAdvertising, .other]
        case .post:
            SafetyReasonCode.allCases.filter { $0 != .directMessageRisk }
        }
    }
}

struct SafetyReportFormValidation: Equatable {
    let reasonMessage: String?
    let fieldMessage: String?
    let detailMessage: String?
    let evidenceMessage: String?

    var isValid: Bool {
        reasonMessage == nil && fieldMessage == nil && detailMessage == nil && evidenceMessage == nil
    }
}

enum SafetyReportFormLogic {
    static let detailLimit = 1000
    static let maxEvidenceCount = 6

    private static let collectionFieldReasonsForPosts: Set<SafetyReasonCode> = [
        .suspectedScam,
        .falseOrExpiredGroupBuy,
        .copyrightOrStolenMedia,
        .sexualOrIllegal,
        .spamOrAdvertising,
        .other
    ]

    private static let collectionSharedFields: [SafetyReportedField] = [
        .collectionDescription,
        .collectionDeadline,
        .collectionDefaultNote
    ]

    private static let contactFields: [SafetyReportedField] = [
        .contactWechat,
        .contactQQ,
        .contactGroupNumber
    ]

    static let unsupportedReasonMessage = "这个对象不支持当前举报原因，请重新选择"
    static let unsupportedPostContactMessage = "该帖子没有可核查的合集联系方式，请改选其他原因或直接说明内容问题"

    static func codePointCount(in text: String) -> Int {
        text.unicodeScalars.count
    }

    static func allowedFields(for source: SafetyReportSource, reason: SafetyReasonCode) -> [SafetyReportedField] {
        switch source.type {
        case .comment, .user, .directMessage:
            return [.content]
        case .collection:
            if reason == .invalidContact {
                return contactFields
            }
            return collectionSharedFields
        case .post:
            guard let _ = source.collectionID else {
                return [.content]
            }
            if reason == .invalidContact {
                return contactFields
            }
            if collectionFieldReasonsForPosts.contains(reason) {
                return [.content] + collectionSharedFields
            }
            return [.content]
        }
    }

    static func normalizedField(
        currentField: SafetyReportedField,
        source: SafetyReportSource,
        reason: SafetyReasonCode
    ) -> SafetyReportedField {
        let allowed = allowedFields(for: source, reason: reason)
        return allowed.contains(currentField) ? currentField : (allowed.first ?? .content)
    }

    static func affectsCollection(
        source: SafetyReportSource,
        reason: SafetyReasonCode,
        reportedField: SafetyReportedField
    ) -> Bool {
        if source.type == .collection {
            return true
        }
        guard source.type == .post else {
            return false
        }
        let sharedFields = Set(collectionSharedFields + contactFields)
        return sharedFields.contains(reportedField) && allowedFields(for: source, reason: reason).contains(reportedField)
    }

    static func validation(
        source: SafetyReportSource,
        reason: SafetyReasonCode,
        reportedField: SafetyReportedField,
        detail: String,
        evidenceCount: Int
    ) -> SafetyReportFormValidation {
        guard source.allowedReasons.contains(reason) else {
            return SafetyReportFormValidation(
                reasonMessage: unsupportedReasonMessage,
                fieldMessage: nil,
                detailMessage: nil,
                evidenceMessage: nil
            )
        }

        let allowed = allowedFields(for: source, reason: reason)
        let trimmedDetail = detail.trimmed
        let detailCount = codePointCount(in: detail)
        var fieldMessage: String?
        var detailMessage: String?
        var evidenceMessage: String?

        if reason == .invalidContact, source.type == .post, source.collectionID == nil {
            fieldMessage = unsupportedPostContactMessage
        } else if !allowed.contains(reportedField) {
            fieldMessage = reason == .invalidContact ? "请选择具体的联系方式" : "请选择需要核查的字段"
        } else if reason == .invalidContact, !contactFields.contains(reportedField), source.collectionID != nil || source.type == .collection {
            fieldMessage = "请选择具体的联系方式"
        }

        if detailCount > detailLimit {
            detailMessage = "说明最多填写 \(detailLimit) 字"
        } else if reason == .invalidContact, trimmedDetail.isEmpty {
            detailMessage = "请说明联系方式为什么无效"
        } else if reason == .other, trimmedDetail.isEmpty {
            detailMessage = "请补充具体说明"
        }

        if evidenceCount > maxEvidenceCount {
            evidenceMessage = "最多上传 \(maxEvidenceCount) 张证据图片"
        }

        return SafetyReportFormValidation(
            reasonMessage: nil,
            fieldMessage: fieldMessage,
            detailMessage: detailMessage,
            evidenceMessage: evidenceMessage
        )
    }

    static func blockCandidateUserID(for source: SafetyReportSource, currentUserID: String) -> String? {
        guard source.canOfferBlock else {
            return nil
        }

        let normalizedCurrentUserID = currentUserID.trimmed
        let candidates = [
            source.peerUserID?.trimmed,
            source.ownerUserID.trimmed
        ]

        guard let candidate = candidates
            .compactMap({ $0 })
            .first(where: { !$0.isEmpty && $0 != normalizedCurrentUserID }),
              candidate != normalizedCurrentUserID
        else {
            return nil
        }

        return candidate
    }

    static func buildDraft(
        source: SafetyReportSource,
        reason: SafetyReasonCode,
        reportedField: SafetyReportedField,
        detail: String,
        objectKeys: [String],
        clientRequestID: String
    ) -> SafetyReportDraft? {
        let validation = validation(
            source: source,
            reason: reason,
            reportedField: reportedField,
            detail: detail,
            evidenceCount: objectKeys.count
        )
        guard validation.isValid else {
            return nil
        }

        return SafetyReportDraft(
            clientRequestID: clientRequestID,
            sourceType: source.type,
            sourceID: source.objectID,
            reasonCode: reason,
            reportedField: reportedField,
            detail: detail.trimmed,
            objectKeys: objectKeys
        )
    }
}

struct SafetyReportEvidenceItem: Identifiable, Equatable {
    let id: UUID
    let data: Data

    init(id: UUID = UUID(), data: Data) {
        self.id = id
        self.data = data
    }
}

struct SafetyReportEvidenceBuffer: Equatable {
    private(set) var items: [SafetyReportEvidenceItem]
    private(set) var statusMessage: String?
    private(set) var isLoading: Bool
    private var activeGeneration: Int

    init(
        items: [SafetyReportEvidenceItem] = [],
        statusMessage: String? = nil,
        isLoading: Bool = false,
        activeGeneration: Int = 0
    ) {
        self.items = items
        self.statusMessage = statusMessage
        self.isLoading = isLoading
        self.activeGeneration = activeGeneration
    }

    @discardableResult
    mutating func beginLoading() -> Int {
        activeGeneration &+= 1
        isLoading = true
        statusMessage = nil
        return activeGeneration
    }

    @discardableResult
    mutating func finishLoading(
        generation: Int,
        loadedData: [Data],
        selectedCount: Int,
        failedCount: Int
    ) -> Bool {
        guard generation == activeGeneration else {
            return false
        }

        let remainingCapacity = max(0, SafetyReportFormLogic.maxEvidenceCount - items.count)
        let appendedItems = loadedData
            .prefix(remainingCapacity)
            .map { SafetyReportEvidenceItem(data: $0) }
        items.append(contentsOf: appendedItems)
        isLoading = false

        if selectedCount > remainingCapacity {
            statusMessage = "最多上传 \(SafetyReportFormLogic.maxEvidenceCount) 张证据图片"
        } else if failedCount > 0 {
            statusMessage = "有 \(failedCount) 张图片处理失败，请重试或换一张"
        } else {
            statusMessage = nil
        }

        return true
    }

    mutating func cancelLoading() {
        isLoading = false
    }

    mutating func remove(_ itemID: UUID) {
        items.removeAll { $0.id == itemID }
        if items.count < SafetyReportFormLogic.maxEvidenceCount,
           statusMessage == "最多上传 \(SafetyReportFormLogic.maxEvidenceCount) 张证据图片" {
            statusMessage = nil
        }
    }
}

struct ReportSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @FocusState private var isDetailFocused: Bool

    let source: SafetyReportSource
    let onAccepted: () -> Void

    @State private var reason: SafetyReasonCode
    @State private var reportedField: SafetyReportedField
    @State private var detail = ""
    @State private var blockUser: Bool
    @State private var selectedPhotoItems: [PhotosPickerItem] = []
    @State private var evidenceBuffer = SafetyReportEvidenceBuffer()
    @State private var evidenceLoadTask: Task<Void, Never>?
    @State private var hasAttemptedSubmit = false
    @State private var hasConfirmedCollectionScope = false
    @State private var isCollectionConfirmationPresented = false
    @State private var isSubmitting = false
    @State private var submitTask: Task<Void, Never>?
    @State private var draftState: SafetyReportDraftState

    init(source: SafetyReportSource, onAccepted: @escaping () -> Void) {
        self.source = source
        self.onAccepted = onAccepted
        let initialReason = source.allowedReasons.first ?? .other
        _reason = State(initialValue: initialReason)
        _reportedField = State(initialValue: SafetyReportFormLogic.allowedFields(for: source, reason: initialReason).first ?? .content)
        _blockUser = State(initialValue: source.canOfferBlock)
        _draftState = State(initialValue: SafetyReportDraftState(sourceType: source.type, sourceID: source.objectID))
    }

    private var availableFields: [SafetyReportedField] {
        SafetyReportFormLogic.allowedFields(for: source, reason: reason)
    }

    private var validation: SafetyReportFormValidation {
        SafetyReportFormLogic.validation(
            source: source,
            reason: reason,
            reportedField: reportedField,
            detail: detail,
            evidenceCount: evidenceBuffer.items.count
        )
    }

    private var affectsCollection: Bool {
        SafetyReportFormLogic.affectsCollection(
            source: source,
            reason: reason,
            reportedField: reportedField
        )
    }

    private var detailPlaceholder: String {
        switch reason {
        case .invalidContact:
            return "请说明哪里失效，或为什么这个联系方式存在风险"
        case .other:
            return "请写清具体情况，方便后续核查"
        default:
            return "补充截图背景、时间线或需要重点核查的信息（选填）"
        }
    }

    private var fieldTitle: String {
        reason == .invalidContact ? "具体联系方式" : "具体字段"
    }

    private var blockCandidateUserID: String? {
        SafetyReportFormLogic.blockCandidateUserID(for: source, currentUserID: store.currentUserID)
    }

    private var showsBlockToggle: Bool {
        blockCandidateUserID != nil
    }

    private var isInteractionLocked: Bool {
        isSubmitting || store.isSubmittingSafetyReport
    }

    private var isSubmitDisabled: Bool {
        isInteractionLocked || evidenceBuffer.isLoading
    }

    private var alwaysVisibleFieldMessage: String? {
        if reason == .invalidContact, source.type == .post, source.collectionID == nil {
            return SafetyReportFormLogic.unsupportedPostContactMessage
        }
        return nil
    }

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 22) {
                    summarySection
                    reasonSection
                    detailSection
                    evidenceSection
                    if showsBlockToggle {
                        blockSection
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 18)
                .padding(.bottom, 28)
            }
            .background(Theme.background)
            .scrollDismissesKeyboard(.interactively)
            .disabled(isInteractionLocked)
            .simultaneousGesture(TapGesture().onEnded {
                isDetailFocused = false
                hideKeyboard()
            })
            .safeAreaInset(edge: .bottom) {
                actionBar
            }
            .navigationTitle("举报")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("取消") {
                        cancel()
                    }
                    .foregroundStyle(Theme.text)
                    .disabled(isInteractionLocked)
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("完成") {
                        isDetailFocused = false
                        hideKeyboard()
                    }
                    .disabled(isInteractionLocked)
                }
            }
        }
        .tint(Theme.hotPink)
        .interactiveDismissDisabled(isInteractionLocked)
        .confirmationDialog(
            "按合集信息问题处理并检查相关帖子？",
            isPresented: $isCollectionConfirmationPresented,
            titleVisibility: .visible
        ) {
            Button("按合集信息继续提交") {
                hasConfirmedCollectionScope = true
                startSubmission()
            }
            Button("返回修改", role: .cancel) {
                hasConfirmedCollectionScope = false
            }
        } message: {
            Text("我们会按合集信息问题处理，并检查相关帖子，不会直接把整个合集自动判定为违规。")
        }
        .onChange(of: reason) { _, newReason in
            hasConfirmedCollectionScope = false
            withAnimation(AppMotion.quick) {
                reportedField = SafetyReportFormLogic.normalizedField(
                    currentField: reportedField,
                    source: source,
                    reason: newReason
                )
            }
        }
        .onChange(of: reportedField) { _, _ in
            hasConfirmedCollectionScope = false
        }
        .onChange(of: selectedPhotoItems) { _, items in
            guard !items.isEmpty else { return }
            beginEvidenceLoading(with: items)
        }
        .onChange(of: blockCandidateUserID) { _, candidate in
            if candidate == nil {
                blockUser = false
            }
        }
        .onDisappear {
            evidenceLoadTask?.cancel()
            evidenceLoadTask = nil
            evidenceBuffer.cancelLoading()
            submitTask?.cancel()
            submitTask = nil
            isSubmitting = false
        }
    }

    private var summarySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionLabel("举报对象")
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 10) {
                    Text(source.type.displayName)
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(Theme.subtext)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Theme.panelRaised, in: Capsule())
                    Spacer(minLength: 0)
                }

                Text(source.title)
                    .font(.title3)
                    .fontWeight(.semibold)
                    .foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)

                if source.type == .post, source.collectionID != nil {
                    Text("可区分帖子内容与合集共享信息。")
                        .font(.caption)
                        .foregroundStyle(Theme.subtext)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(14)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(Theme.hairline, lineWidth: 1)
            }
        }
    }

    private var reasonSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionLabel("原因与字段")

            Menu {
                ForEach(source.allowedReasons, id: \.self) { choice in
                    Button(choice.displayName) {
                        withAnimation(AppMotion.quick) {
                            reason = choice
                        }
                    }
                }
            } label: {
                ReportMenuRow(
                    title: "举报原因",
                    value: reason.displayName,
                    errorMessage: hasAttemptedSubmit ? validation.reasonMessage : nil
                )
            }
            .buttonStyle(.plain)
            .accessibilityLabel("举报原因")
            .accessibilityValue(reason.displayName)
            .disabled(isInteractionLocked)

            Group {
                if availableFields.count > 1 {
                    Menu {
                        ForEach(availableFields, id: \.self) { choice in
                            Button(choice.displayName) {
                                withAnimation(AppMotion.quick) {
                                    reportedField = choice
                                }
                            }
                        }
                    } label: {
                        ReportMenuRow(
                            title: fieldTitle,
                            value: reportedField.displayName,
                            errorMessage: hasAttemptedSubmit ? validation.fieldMessage : nil
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(fieldTitle)
                    .accessibilityValue(reportedField.displayName)
                    .disabled(isInteractionLocked)
                } else {
                    ReportStaticRow(
                        title: fieldTitle,
                        value: availableFields.first?.displayName ?? reportedField.displayName,
                        message: alwaysVisibleFieldMessage ?? (hasAttemptedSubmit ? validation.fieldMessage : nil)
                    )
                }
            }
            .animation(AppMotion.quick, value: availableFields)
        }
    }

    private var detailSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionLabel("说明")
            ConstrainedFormTextEditor(
                title: "补充说明",
                placeholder: detailPlaceholder,
                text: $detail,
                limit: SafetyReportFormLogic.detailLimit,
                errorMessage: hasAttemptedSubmit ? validation.detailMessage : nil
            )
            .focused($isDetailFocused)
            .disabled(isInteractionLocked)
        }
    }

    private var evidenceSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                sectionLabel("证据")
                Spacer()
                Text("\(evidenceBuffer.items.count)/\(SafetyReportFormLogic.maxEvidenceCount)")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(Theme.subtext)
            }

            VStack(alignment: .leading, spacing: 12) {
                PhotosPicker(
                    selection: $selectedPhotoItems,
                    maxSelectionCount: max(1, SafetyReportFormLogic.maxEvidenceCount - evidenceBuffer.items.count),
                    matching: .images
                ) {
                    HStack(spacing: 12) {
                        Image(systemName: "photo.on.rectangle.angled")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(Theme.hotPink)
                            .frame(width: 28, height: 28)
                        Text(evidenceBuffer.items.isEmpty ? "添加图片证据" : "继续添加图片")
                            .font(.body)
                            .fontWeight(.semibold)
                            .foregroundStyle(Theme.text)
                            .multilineTextAlignment(.leading)
                            .lineLimit(2)
                            .layoutPriority(1)
                        Spacer()
                        Image(systemName: "plus")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Theme.subtext)
                    }
                    .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(Theme.hairline, lineWidth: 1)
                    }
                }
                .buttonStyle(.plain)
                .disabled(evidenceBuffer.items.count >= SafetyReportFormLogic.maxEvidenceCount || evidenceBuffer.isLoading || isInteractionLocked)
                .accessibilityLabel("添加图片证据")

                if !evidenceBuffer.items.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(evidenceBuffer.items) { item in
                                ZStack(alignment: .topTrailing) {
                                    UploadedImageView(data: item.data)
                                        .scaledToFill()
                                        .frame(width: 76, height: 76)
                                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                                        .overlay {
                                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                                .stroke(Theme.hairline, lineWidth: 1)
                                        }

                                    Button {
                                        removeEvidence(item)
                                    } label: {
                                        Image(systemName: "xmark")
                                            .font(.system(size: 10, weight: .black))
                                            .foregroundStyle(.white)
                                            .frame(width: 22, height: 22)
                                            .background(Color.black.opacity(0.76), in: Circle())
                                            .frame(width: 44, height: 44)
                                            .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                    .offset(x: 6, y: -6)
                                    .accessibilityLabel("删除第 \(evidenceIndex(for: item) + 1) 张证据图片")
                                    .disabled(isInteractionLocked)
                                }
                                .transition(.opacity.combined(with: .scale(scale: 0.96)))
                            }
                        }
                        .padding(.vertical, 2)
                    }
                    .animation(AppMotion.quick, value: evidenceBuffer.items)
                }

                if evidenceBuffer.isLoading {
                    HStack(spacing: 10) {
                        ProgressView()
                            .tint(Theme.hotPink)
                        Text("正在处理图片")
                            .font(.caption)
                            .foregroundStyle(Theme.subtext)
                    }
                }

                if let evidenceStatusMessage = evidenceBuffer.statusMessage {
                    Text(evidenceStatusMessage)
                        .font(.caption)
                        .foregroundStyle(Theme.hotPink)
                        .fixedSize(horizontal: false, vertical: true)
                } else if hasAttemptedSubmit, let evidenceMessage = validation.evidenceMessage {
                    Text(evidenceMessage)
                        .font(.caption)
                        .foregroundStyle(Theme.hotPink)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private var blockSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionLabel("附加操作")
            Toggle(isOn: $blockUser) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("同时拉黑")
                        .font(.body)
                        .fontWeight(.semibold)
                        .foregroundStyle(Theme.text)
                    Text("提交后不再接收对方新的互动。")
                        .font(.caption)
                        .foregroundStyle(Theme.subtext)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .tint(Theme.hotPink)
            .padding(14)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(Theme.hairline, lineWidth: 1)
            }
            .accessibilityLabel("同时拉黑")
            .disabled(isInteractionLocked)
        }
    }

    private var actionBar: some View {
        HStack(spacing: 12) {
            Button {
                cancel()
            } label: {
                Text("取消")
                    .font(.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(Theme.text)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 52)
                    .padding(.vertical, 14)
                    .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(Theme.hairline, lineWidth: 1)
                    }
            }
            .buttonStyle(.plain)
            .disabled(isInteractionLocked)

            Button {
                submitTapped()
            } label: {
                ZStack {
                    Text("提交举报")
                        .font(.body)
                        .fontWeight(.semibold)
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .opacity(isSubmitDisabled ? 0 : 1)

                    HStack(spacing: 8) {
                        ProgressView()
                            .tint(.white)
                        Text(isInteractionLocked ? "提交中" : "处理图片中")
                            .font(.body)
                            .fontWeight(.semibold)
                            .foregroundStyle(.white)
                            .lineLimit(2)
                    }
                    .opacity(isSubmitDisabled ? 1 : 0)
                }
                .frame(maxWidth: .infinity)
                .frame(minHeight: 52)
                .padding(.vertical, 14)
                .background(isSubmitDisabled ? Theme.hotPink.opacity(0.55) : Theme.hotPink, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(isSubmitDisabled)
            .accessibilityLabel("提交举报")
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 12)
        .background(Theme.background)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Theme.hairline)
                .frame(height: 1)
        }
    }

    private func sectionLabel(_ title: String) -> some View {
        Text(title)
            .font(.footnote)
            .fontWeight(.semibold)
            .foregroundStyle(Theme.subtext)
    }

    private func submitTapped() {
        hasAttemptedSubmit = true
        isDetailFocused = false
        hideKeyboard()

        guard validation.isValid else {
            return
        }
        guard !isSubmitDisabled else {
            return
        }
        if affectsCollection && !hasConfirmedCollectionScope {
            isCollectionConfirmationPresented = true
            return
        }
        startSubmission()
    }

    private func startSubmission() {
        guard !isSubmitDisabled, submitTask == nil else { return }
        isSubmitting = true
        let blockUserID = blockUser ? blockCandidateUserID : nil
        submitTask = Task {
            await performSubmission(blockUserID: blockUserID)
        }
    }

    private func performSubmission(blockUserID: String?) async {
        defer {
            Task { @MainActor in
                isSubmitting = false
                submitTask = nil
            }
        }

        guard !Task.isCancelled else { return }
        guard let draft = SafetyReportFormLogic.buildDraft(
            source: source,
            reason: reason,
            reportedField: reportedField,
            detail: detail,
            objectKeys: [],
            clientRequestID: draftState.clientRequestID
        ) else {
            await MainActor.run {
                hasAttemptedSubmit = true
            }
            return
        }

        let accepted = await store.submitSafetyReport(
            draft: draft,
            imageData: evidenceBuffer.items.map(\.data),
            blockUserID: blockUserID
        )

        guard !Task.isCancelled else { return }

        if accepted {
            await MainActor.run {
                draftState.markAccepted()
                onAccepted()
                dismiss()
            }
        } else {
            await MainActor.run {
                draftState.markFailed()
            }
        }
    }

    private func cancel() {
        isDetailFocused = false
        hideKeyboard()
        dismiss()
    }

    @MainActor
    private func beginEvidenceLoading(with items: [PhotosPickerItem]) {
        let generation = evidenceBuffer.beginLoading()
        let itemsSnapshot = items
        evidenceLoadTask?.cancel()
        evidenceLoadTask = Task {
            await loadEvidence(from: itemsSnapshot, generation: generation)
        }
    }

    private func loadEvidence(from items: [PhotosPickerItem], generation: Int) async {
        var loadedData: [Data] = []
        var failedCount = 0

        for item in items {
            guard !Task.isCancelled else { return }
            do {
                if let data = try await item.loadTransferable(type: Data.self) {
                    guard let image = UIImage(data: data),
                          let normalized = ImageDataNormalizer.jpegData(
                            from: image,
                            maxSide: 1600,
                            compressionQuality: 0.78
                          ) else {
                        failedCount += 1
                        continue
                    }
                    loadedData.append(normalized)
                } else {
                    failedCount += 1
                }
            } catch {
                failedCount += 1
            }
        }

        guard !Task.isCancelled else { return }

        await MainActor.run {
            var didFinish = false
            withAnimation(AppMotion.quick) {
                didFinish = evidenceBuffer.finishLoading(
                    generation: generation,
                    loadedData: loadedData,
                    selectedCount: items.count,
                    failedCount: failedCount
                )
            }
            guard didFinish else { return }
            selectedPhotoItems = []
            evidenceLoadTask = nil
        }
    }

    private func removeEvidence(_ item: SafetyReportEvidenceItem) {
        withAnimation(AppMotion.quick) {
            evidenceBuffer.remove(item.id)
        }
    }

    private func evidenceIndex(for item: SafetyReportEvidenceItem) -> Int {
        evidenceBuffer.items.firstIndex(where: { $0.id == item.id }) ?? 0
    }
}

private struct ReportMenuRow: View {
    let title: String
    let value: String
    var errorMessage: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 12) {
                Text(title)
                    .font(.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(Theme.text)
                Spacer(minLength: 8)
                Text(value)
                    .font(.body)
                    .foregroundStyle(Theme.text)
                    .multilineTextAlignment(.trailing)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .layoutPriority(1)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.subtext)
            }
            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(errorMessage != nil ? Theme.hotPink.opacity(0.7) : Theme.hairline, lineWidth: 1)
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(Theme.hotPink)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct ReportStaticRow: View {
    let title: String
    let value: String
    var message: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Text(title)
                    .font(.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(Theme.text)
                Spacer(minLength: 8)
                Text(value)
                    .font(.body)
                    .foregroundStyle(Theme.subtext)
                    .multilineTextAlignment(.trailing)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .layoutPriority(1)
            }
            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(message != nil ? Theme.hotPink.opacity(0.7) : Theme.hairline, lineWidth: 1)
            }

            if let message {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(Theme.hotPink)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private enum ReportPreviewSourceFactory {
    static let postContent = SafetyReportSource(
        type: .post,
        id: "post-preview-1",
        title: "收一套场贩拍立得",
        ownerUserID: "user-owner",
        collectionID: nil,
        peerUserID: nil
    )

    static let postSharedContact = SafetyReportSource(
        type: .post,
        id: "post-preview-2",
        title: "暑假合集补尾款通知",
        ownerUserID: "user-owner",
        collectionID: "collection-preview-1",
        peerUserID: nil
    )

    static let comment = SafetyReportSource(
        type: .comment,
        id: "comment-preview-1",
        title: "这条评论包含辱骂内容",
        ownerUserID: "comment-user",
        collectionID: "collection-preview-1",
        peerUserID: nil
    )

    static let user = SafetyReportSource(
        type: .user,
        id: "user-preview-1",
        title: "团长 Lily",
        ownerUserID: "user-preview-1",
        collectionID: nil,
        peerUserID: nil
    )

    static let directMessage = SafetyReportSource(
        type: .directMessage,
        id: "dm-preview-1",
        title: "来自 Lily 的私信",
        ownerUserID: "user-owner",
        collectionID: nil,
        peerUserID: "user-preview-1"
    )

    static let collection = SafetyReportSource(
        type: .collection,
        id: "collection-preview-1",
        title: "暑假日韩场贩合单",
        ownerUserID: "user-owner",
        collectionID: "collection-preview-1",
        peerUserID: nil
    )
}

private struct ReportPreviewScene: View {
    let source: SafetyReportSource

    var body: some View {
        ReportSheet(source: source) {}
            .environmentObject(MockAppStore.previewStore())
            .tint(Theme.hotPink)
    }
}

#Preview("帖子内容 Light") {
    ReportPreviewScene(source: ReportPreviewSourceFactory.postContent)
        .preferredColorScheme(.light)
}

#Preview("帖子共享信息 A11y") {
    ReportPreviewScene(source: ReportPreviewSourceFactory.postSharedContact)
        .preferredColorScheme(.light)
        .dynamicTypeSize(.accessibility3)
}

#Preview("评论 Dark") {
    ReportPreviewScene(source: ReportPreviewSourceFactory.comment)
        .preferredColorScheme(.dark)
}

#Preview("用户默认拉黑") {
    ReportPreviewScene(source: ReportPreviewSourceFactory.user)
        .preferredColorScheme(.light)
}

#Preview("私信 Dark") {
    ReportPreviewScene(source: ReportPreviewSourceFactory.directMessage)
        .preferredColorScheme(.dark)
}

#Preview("合集 Light") {
    ReportPreviewScene(source: ReportPreviewSourceFactory.collection)
        .preferredColorScheme(.light)
}
