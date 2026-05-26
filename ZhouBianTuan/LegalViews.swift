import SwiftUI

struct LegalDocumentSheet: View {
    let document: LegalDocument

    var body: some View {
        NavigationStack {
            LegalDocumentView(document: document)
        }
        .preferredColorScheme(.dark)
    }
}

struct LegalDocumentView: View {
    @Environment(\.dismiss) private var dismiss
    let document: LegalDocument

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 20) {
                Text("Beta 版本说明")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.hotPink)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Theme.hotPink.opacity(0.12), in: Capsule())

                Text("本页面用于内测阶段向用户说明周边团的服务规则和个人信息处理方式。正式公开发布前，页面内容会与 App Store Connect 隐私标签和公开隐私政策 URL 保持一致。")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.subtext)
                    .lineSpacing(6)

                ForEach(document.sections) { section in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(section.title)
                            .font(.system(size: 19, weight: .black))
                            .foregroundStyle(Theme.text)
                        Text(section.body)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(Theme.subtext)
                            .lineSpacing(7)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                    .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 24)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(document.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("完成") { dismiss() }
                    .foregroundStyle(Theme.hotPink)
            }
        }
    }
}

struct LegalAgreementRow: View {
    @Binding var isAccepted: Bool
    let documents: [LegalDocument]
    var textColor: Color
    var linkColor: Color = Theme.hotPink
    var fontSize: CGFloat = 14
    var iconSize: CGFloat = 18

    @State private var selectedDocument: LegalDocument?

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Button {
                isAccepted.toggle()
            } label: {
                Image(systemName: isAccepted ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: iconSize, weight: .semibold))
                    .foregroundStyle(isAccepted ? Theme.hotPink : Color.white.opacity(0.36))
                    .padding(.top, 1)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isAccepted ? "取消同意协议" : "同意协议")

            VStack(alignment: .leading, spacing: 7) {
                Text("我已阅读并同意")
                    .font(.system(size: fontSize, weight: .semibold))
                    .foregroundStyle(textColor)

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 116), alignment: .leading)], alignment: .leading, spacing: 7) {
                    ForEach(documents) { document in
                        Button {
                            selectedDocument = document
                        } label: {
                            Text("《\(document.shortTitle)》")
                                .font(.system(size: fontSize, weight: .bold))
                                .foregroundStyle(linkColor)
                                .underline()
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .sheet(item: $selectedDocument) { document in
            LegalDocumentSheet(document: document)
        }
    }
}

struct SettingsLegalLinks: View {
    @State private var selectedDocument: LegalDocument?

    private let rows: [[LegalDocument]] = [
        [.personalInfoList, .thirdPartySharingList],
        [.userAgreement, .privacyPolicy],
        [.minorsPolicy]
    ]

    var body: some View {
        VStack(spacing: 10) {
            ForEach(rows.indices, id: \.self) { index in
                HStack(spacing: 12) {
                    ForEach(rows[index]) { document in
                        Button {
                            selectedDocument = document
                        } label: {
                            Text("《\(document.shortTitle)》")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Theme.subtext)
                                .underline()
                                .lineLimit(1)
                                .minimumScaleFactor(0.82)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .multilineTextAlignment(.center)
        .sheet(item: $selectedDocument) { document in
            LegalDocumentSheet(document: document)
        }
    }
}
