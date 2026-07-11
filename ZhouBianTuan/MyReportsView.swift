import PhotosUI
import SwiftUI
import UIKit

enum MyReportsNavigationEntry {
    static let route = Route.myReports
    static let title = "我的举报"
    static let systemImage = "checkmark.shield"
}

enum MyReportsPresentation {
    static let emptyText = "还没有提交过举报"
    static let supplementActionText = "补充证据"

    static func statusText(for status: SafetyReportStatus) -> String {
        status.displayName
    }

    static func updatedText(for value: String) -> String {
        guard let date = BackendDateParser.strictDate(from: value) else { return value }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    static func canSupplementEvidence(status: SafetyReportStatus) -> Bool {
        switch status {
        case .received, .reviewing:
            true
        case .handled, .noViolation:
            false
        }
    }
}

struct MyReportsView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var supplementSummary: SafetyReportSummary?

    private var summaries: [SafetyReportSummary] {
        store.safetyReports.map(SafetyReportSummary.init(report:))
    }

    var body: some View {
        VStack(spacing: 0) {
            SimpleTopBar(title: MyReportsNavigationEntry.title, trailing: nil) {
                dismiss()
            }

            List {
                if let errorMessage = store.myReportsErrorMessage {
                    MyReportsErrorRow(message: errorMessage) {
                        Task { await store.refreshMyReports() }
                    }
                }

                if !store.hasFinishedMyReportsLoad && summaries.isEmpty {
                    MyReportsLoadingRow()
                } else if summaries.isEmpty && store.myReportsErrorMessage == nil {
                    MyReportsEmptyRow()
                } else {
                    ForEach(summaries) { summary in
                        if MyReportsPresentation.canSupplementEvidence(status: summary.status) {
                            Button {
                                supplementSummary = summary
                            } label: {
                                MyReportRow(summary: summary, offersSupplement: true)
                            }
                            .buttonStyle(.plain)
                            .listRowBackground(Theme.background)
                        } else {
                            MyReportRow(summary: summary, offersSupplement: false)
                        }
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .refreshable {
                await store.refreshMyReports()
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .navigationBarHidden(true)
        .toolbar(.hidden, for: .tabBar)
        .task {
            await store.refreshMyReports()
        }
        .sheet(item: $supplementSummary) { summary in
            MyReportSupplementSheet(summary: summary)
        }
    }
}

enum MyReportRowLayoutPolicy {
    static let minimumHeight: CGFloat = 96

    static func usesStackedFooter(for dynamicTypeSize: DynamicTypeSize) -> Bool {
        dynamicTypeSize.isAccessibilitySize
    }
}

enum MyReportsAuxiliaryLayoutPolicy {
    static func usesStackedLayout(for dynamicTypeSize: DynamicTypeSize) -> Bool {
        dynamicTypeSize.isAccessibilitySize
    }
}

private struct MyReportRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let summary: SafetyReportSummary
    let offersSupplement: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(summary.reasonCode.displayName)
                .font(.headline)
                .fontWeight(.semibold)
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) {
                    Label(summary.targetType.displayName, systemImage: "scope")
                    Text(MyReportsPresentation.statusText(for: summary.status))
                    Spacer(minLength: 8)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Label(summary.targetType.displayName, systemImage: "scope")
                    Text(MyReportsPresentation.statusText(for: summary.status))
                }
            }
            .font(.subheadline)
            .fontWeight(.semibold)
            .foregroundStyle(Theme.subtext)
            .fixedSize(horizontal: false, vertical: true)

            if MyReportRowLayoutPolicy.usesStackedFooter(for: dynamicTypeSize) {
                stackedFooter
            } else {
                ViewThatFits(in: .horizontal) {
                    horizontalFooter
                    stackedFooter
                }
            }
        }
        .frame(
            maxWidth: .infinity,
            minHeight: MyReportRowLayoutPolicy.minimumHeight,
            alignment: .leading
        )
        .padding(.vertical, 8)
        .listRowBackground(Theme.background)
    }

    private var horizontalFooter: some View {
        HStack(spacing: 10) {
            updatedLabel
                .lineLimit(1)
            Spacer(minLength: 8)
            if offersSupplement {
                supplementLabel
                    .lineLimit(1)
            }
        }
    }

    private var stackedFooter: some View {
        VStack(alignment: .leading, spacing: 6) {
            updatedLabel
                .fixedSize(horizontal: false, vertical: true)
            if offersSupplement {
                supplementLabel
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var updatedLabel: some View {
        Text("更新于 \(MyReportsPresentation.updatedText(for: summary.updatedAt))")
            .font(.footnote)
            .fontWeight(.medium)
            .foregroundStyle(Theme.muted)
    }

    private var supplementLabel: some View {
        Label(MyReportsPresentation.supplementActionText, systemImage: "plus.circle")
            .font(.subheadline)
            .fontWeight(.semibold)
            .foregroundStyle(Theme.hotPink)
    }
}

private struct MyReportSupplementSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @EnvironmentObject private var store: MockAppStore
    @FocusState private var isDetailFocused: Bool
    let summary: SafetyReportSummary

    @State private var detail = ""
    @State private var selectedPhotoItems: [PhotosPickerItem] = []
    @State private var evidenceBuffer = SafetyReportEvidenceBuffer()
    @State private var evidenceLoadTask: Task<Void, Never>?
    @State private var submitTask: Task<Void, Never>?
    @State private var draftState = SafetyEvidenceSupplementDraftState()
    @State private var hasAttemptedSubmit = false
    @State private var isSubmitting = false

    private var isDetailOverLimit: Bool {
        SafetyReportFormLogic.codePointCount(in: detail) > SafetyReportFormLogic.detailLimit
    }

    private var hasSupplementContent: Bool {
        !detail.trimmed.isEmpty || !evidenceBuffer.items.isEmpty
    }

    private var isSubmitDisabled: Bool {
        isBusy || isDetailOverLimit
    }

    private var isBusy: Bool {
        isSubmitting || store.isSubmittingMyReportsSupplement || evidenceBuffer.isLoading
    }

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 22) {
                    safeSummary

                    ConstrainedFormTextEditor(
                        title: "新说明",
                        placeholder: "说明新的时间线、背景或需要重点核查的信息",
                        text: $detail,
                        limit: SafetyReportFormLogic.detailLimit,
                        errorMessage: detailErrorMessage
                    )
                    .focused($isDetailFocused)
                    .disabled(draftState.hasStarted)

                    evidenceSection

                    if let errorMessage = store.myReportsSupplementErrorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .fontWeight(.medium)
                            .foregroundStyle(Theme.hotPink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 18)
                .padding(.bottom, 28)
            }
            .background(Theme.background)
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom) {
                submitBar
            }
            .navigationTitle(MyReportsPresentation.supplementActionText)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("取消") {
                        cancel()
                    }
                    .foregroundStyle(Theme.text)
                    .disabled(isSubmitting)
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("完成") {
                        isDetailFocused = false
                        hideKeyboard()
                    }
                }
            }
        }
        .tint(Theme.hotPink)
        .interactiveDismissDisabled(isSubmitting)
        .onAppear {
            store.clearMyReportsSupplementError()
        }
        .onChange(of: selectedPhotoItems) { _, items in
            guard !items.isEmpty else { return }
            beginEvidenceLoading(with: items)
        }
        .onDisappear {
            evidenceLoadTask?.cancel()
            evidenceLoadTask = nil
            evidenceBuffer.cancelLoading()
            submitTask?.cancel()
            submitTask = nil
            isSubmitting = false
            store.discardSafetyReportEvidenceAttempt(
                clientRequestID: draftState.clientRequestID
            )
        }
    }

    private var detailErrorMessage: String? {
        if isDetailOverLimit {
            return "补充说明最多填写 \(SafetyReportFormLogic.detailLimit) 字"
        }
        if hasAttemptedSubmit && !hasSupplementContent {
            return "请填写补充说明或上传证据"
        }
        return nil
    }

    private var safeSummary: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(summary.reasonCode.displayName)
                .font(.headline)
                .fontWeight(.semibold)
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)

            Group {
                if MyReportsAuxiliaryLayoutPolicy.usesStackedLayout(for: dynamicTypeSize) {
                    stackedSummaryMetadata
                } else {
                    ViewThatFits(in: .horizontal) {
                        horizontalSummaryMetadata
                        stackedSummaryMetadata
                    }
                }
            }
            .font(.subheadline)
            .fontWeight(.semibold)
            .foregroundStyle(Theme.subtext)
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
    }

    private var horizontalSummaryMetadata: some View {
        HStack(spacing: 10) {
            Label(summary.targetType.displayName, systemImage: "scope")
            Text(MyReportsPresentation.statusText(for: summary.status))
        }
    }

    private var stackedSummaryMetadata: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(summary.targetType.displayName, systemImage: "scope")
            Text(MyReportsPresentation.statusText(for: summary.status))
        }
    }

    private var evidenceSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("图片证据")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundStyle(Theme.text)
                Spacer()
                Text("\(evidenceBuffer.items.count)/\(SafetyReportFormLogic.maxEvidenceCount)")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(Theme.subtext)
            }

            PhotosPicker(
                selection: $selectedPhotoItems,
                maxSelectionCount: max(
                    1,
                    SafetyReportFormLogic.maxEvidenceCount - evidenceBuffer.items.count
                ),
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
            .disabled(
                evidenceBuffer.items.count >= SafetyReportFormLogic.maxEvidenceCount ||
                evidenceBuffer.isLoading ||
                draftState.hasStarted
            )

            if !evidenceBuffer.items.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(evidenceBuffer.items) { item in
                            evidenceThumbnail(item)
                        }
                    }
                    .padding(.vertical, 2)
                }
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

            if let statusMessage = evidenceBuffer.statusMessage {
                Text(statusMessage)
                    .font(.caption)
                    .foregroundStyle(Theme.hotPink)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func evidenceThumbnail(_ item: SafetyReportEvidenceItem) -> some View {
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
                withAnimation(AppMotion.quick) {
                    evidenceBuffer.remove(item.id)
                }
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
            .accessibilityLabel("删除证据图片")
            .disabled(draftState.hasStarted)
        }
    }

    private var submitBar: some View {
        Button {
            submit()
        } label: {
            ZStack {
                Text("提交补证")
                    .font(.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(.white)
                    .opacity(isBusy ? 0 : 1)

                HStack(spacing: 8) {
                    ProgressView()
                        .tint(.white)
                    Text(isSubmitting ? "提交中" : "处理图片中")
                        .font(.body)
                        .fontWeight(.semibold)
                        .foregroundStyle(.white)
                }
                .opacity(isBusy ? 1 : 0)
            }
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(
                isSubmitDisabled ? Theme.hotPink.opacity(0.55) : Theme.hotPink,
                in: RoundedRectangle(cornerRadius: 8, style: .continuous)
            )
        }
        .buttonStyle(.plain)
        .disabled(isSubmitDisabled)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Theme.background)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Theme.hairline)
                .frame(height: 1)
        }
    }

    private func submit() {
        hasAttemptedSubmit = true
        isDetailFocused = false
        hideKeyboard()
        guard hasSupplementContent, !isSubmitDisabled, submitTask == nil else { return }

        draftState.markAttemptStarted()
        isSubmitting = true
        submitTask = Task {
            let accepted = await store.appendSafetyReportEvidence(
                reportID: summary.id,
                clientRequestID: draftState.clientRequestID,
                detail: detail,
                imageData: evidenceBuffer.items.map(\.data)
            )
            guard !Task.isCancelled else { return }
            isSubmitting = false
            submitTask = nil
            if accepted {
                draftState.markAccepted()
                dismiss()
            } else {
                draftState.markFailed()
            }
        }
    }

    private func cancel() {
        isDetailFocused = false
        hideKeyboard()
        evidenceLoadTask?.cancel()
        evidenceLoadTask = nil
        evidenceBuffer.cancelLoading()
        store.discardSafetyReportEvidenceAttempt(
            clientRequestID: draftState.clientRequestID
        )
        dismiss()
    }

    private func beginEvidenceLoading(with items: [PhotosPickerItem]) {
        let generation = evidenceBuffer.beginLoading()
        evidenceLoadTask?.cancel()
        evidenceLoadTask = Task {
            await SafetyReportEvidenceBatchLoader.load(
                items: items,
                load: { item in
                    guard let data = try await item.loadTransferable(type: Data.self),
                          let image = UIImage(data: data),
                          let normalized = ImageDataNormalizer.jpegData(
                            from: image,
                            maxSide: 1600,
                            compressionQuality: 0.78
                          ) else {
                        return nil
                    }
                    return normalized
                },
                didLoad: { data in
                    evidenceBuffer.commitLoadedData(data, generation: generation)
                },
                didFinish: { selectedCount, failedCount in
                    guard evidenceBuffer.finishIncrementalLoading(
                        generation: generation,
                        selectedCount: selectedCount,
                        failedCount: failedCount
                    ) else { return }
                    selectedPhotoItems = []
                    evidenceLoadTask = nil
                }
            )
        }
    }
}

private struct MyReportsLoadingRow: View {
    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
                .tint(Theme.hotPink)
            Text("正在加载举报记录")
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundStyle(Theme.subtext)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, minHeight: 240)
        .listRowBackground(Theme.background)
        .listRowSeparator(.hidden)
    }
}

private struct MyReportsEmptyRow: View {
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "checkmark.shield")
                .font(.system(size: 34, weight: .medium))
                .foregroundStyle(Theme.muted)
            Text(MyReportsPresentation.emptyText)
                .font(.headline)
                .fontWeight(.semibold)
                .foregroundStyle(Theme.subtext)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, minHeight: 280)
        .listRowBackground(Theme.background)
        .listRowSeparator(.hidden)
    }
}

private struct MyReportsErrorRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let message: String
    let retry: () -> Void

    var body: some View {
        Group {
            if MyReportsAuxiliaryLayoutPolicy.usesStackedLayout(for: dynamicTypeSize) {
                stackedContent
            } else {
                ViewThatFits(in: .horizontal) {
                    horizontalContent
                    stackedContent
                }
            }
        }
        .frame(minHeight: 52)
        .listRowBackground(Theme.panel)
    }

    private var horizontalContent: some View {
        HStack(alignment: .center, spacing: 12) {
            errorText
            Spacer(minLength: 8)
            retryButton
        }
    }

    private var stackedContent: some View {
        VStack(alignment: .leading, spacing: 10) {
            errorText
            retryButton
        }
    }

    private var errorText: some View {
        Text(message)
            .font(.subheadline)
            .fontWeight(.medium)
            .foregroundStyle(Theme.subtext)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var retryButton: some View {
        Button(action: retry) {
            Label("重试", systemImage: "arrow.clockwise")
                .font(.subheadline)
                .fontWeight(.semibold)
                .foregroundStyle(Theme.hotPink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .buttonStyle(.plain)
    }
}
