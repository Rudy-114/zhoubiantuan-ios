import SwiftUI
import UIKit

enum SupportContact {
    static let email = "support@zhoubiantuanmail.top"
}

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore

    var body: some View {
        VStack(spacing: 0) {
            SimpleTopBar(title: "设置", trailing: nil) {
                dismiss()
            }

            ScrollView(showsIndicators: false) {
                VStack(spacing: 22) {
                    SettingsGroup {
                        NavigationLink(destination: AccountSecuritySettingsView()) {
                            SettingsRow(icon: "person.crop.circle", title: "账号与安全")
                        }
                        .buttonStyle(.pressFeedback)
                        Divider().overlay(Theme.hairline).padding(.leading, 58)
                        NavigationLink(value: MyReportsNavigationEntry.route) {
                            SettingsRow(
                                icon: MyReportsNavigationEntry.systemImage,
                                title: MyReportsNavigationEntry.title
                            )
                        }
                        .buttonStyle(.plain)
                        Divider().overlay(Theme.hairline).padding(.leading, 58)
                        NavigationLink(value: Route.contentRemediation) {
                            SettingsRow(icon: "checkmark.shield", title: "内容处理")
                        }
                        .buttonStyle(.plain)
                        Divider().overlay(Theme.hairline).padding(.leading, 58)
                        NavigationLink(destination: GeneralSettingsView()) {
                            SettingsRow(icon: "gearshape", title: "通用设置")
                        }
                        .buttonStyle(.pressFeedback)
                        Divider().overlay(Theme.hairline).padding(.leading, 58)
                        NavigationLink(destination: NotificationSettingsView()) {
                            SettingsRow(icon: "bell", title: "通知说明")
                        }
                        .buttonStyle(.pressFeedback)
                        Divider().overlay(Theme.hairline).padding(.leading, 58)
                        NavigationLink(destination: MyReportsView()) {
                            SettingsRow(icon: "flag", title: "我的举报")
                        }
                        .buttonStyle(.pressFeedback)
                        NavigationLink(destination: HelpFeedbackView()) {
                            SettingsRow(icon: "questionmark.circle", title: "帮助与反馈")
                        }
                        .buttonStyle(.pressFeedback)
                    }

                    SettingsGroup {
                        Button {
                            store.logOut()
                            dismiss()
                        } label: {
                            SettingsPlainActionRow(title: "退出登录")
                        }
                        .buttonStyle(.pressFeedback)
                    }

                    SettingsLegalLinks()
                    .padding(.top, 14)
                    .padding(.bottom, 60)
                }
                .padding(.horizontal, 16)
                .padding(.top, 30)
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .interactiveBackSwipe()
        .navigationBarBackButtonHidden(true)
        .navigationBarHidden(true)
        .toolbar(.hidden, for: .tabBar)
    }
}

struct AccountSecuritySettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var showsLogoutAllConfirm = false
    @State private var isLoggingOutAll = false
    @State private var logoutAllError: String?

    var body: some View {
        SettingsDetailScaffold(title: "账号与安全", dismiss: dismiss) {
            SettingsDetailGroup {
                SettingsValueRow(title: "邮箱", value: store.currentUser.email.isEmpty ? "未绑定" : "已绑定")
                SettingsSeparator()
                SettingsValueRow(title: "密码登录", value: "已启用")
                SettingsSeparator()
                SettingsValueRow(title: "邮箱验证码", value: "可用")
            }

            SettingsDetailGroup {
                NavigationLink(destination: ChangePasswordView()) {
                    SettingsValueRow(title: "修改密码", value: "")
                }
                .buttonStyle(.pressFeedback)
                SettingsSeparator()
                Button {
                    showsLogoutAllConfirm = true
                } label: {
                    SettingsValueRow(title: "退出所有设备", value: isLoggingOutAll ? "正在退出…" : "")
                }
                .buttonStyle(.pressFeedback)
                .disabled(isLoggingOutAll)
            }
            if let logoutAllError {
                SettingsInlineError(message: logoutAllError)
            }

            SettingsDetailGroup {
                NavigationLink(destination: BlockedUsersView()) {
                    SettingsValueRow(title: "已拉黑用户", value: "")
                }
                .buttonStyle(.pressFeedback)
                SettingsSeparator()
                NavigationLink(destination: AccountDeletionView()) {
                    SettingsValueRow(title: "删除账号", value: "")
                }
                .buttonStyle(.pressFeedback)
            }
        }
        .alert("退出所有设备？", isPresented: $showsLogoutAllConfirm) {
            Button("取消", role: .cancel) {}
            Button("全部退出", role: .destructive) {
                Task {
                    guard !isLoggingOutAll else { return }
                    isLoggingOutAll = true
                    logoutAllError = await store.logOutAllDevices()
                    isLoggingOutAll = false
                }
            }
        } message: {
            Text("所有设备（包括本机）的登录状态都会失效，需要重新登录。")
        }
    }
}

struct ChangePasswordView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private var validationMessage: String? {
        if newPassword.isEmpty { return nil }
        if newPassword.count < 8 { return "新密码至少 8 位" }
        if !confirmPassword.isEmpty && confirmPassword != newPassword { return "两次输入的新密码不一致" }
        return nil
    }

    private var canSubmit: Bool {
        !isSubmitting && !currentPassword.isEmpty && newPassword.count >= 8 && newPassword == confirmPassword
    }

    var body: some View {
        SettingsDetailScaffold(title: "修改密码", dismiss: dismiss) {
            VStack(spacing: 14) {
                SettingsSecureField(title: "当前密码", text: $currentPassword, contentType: .password)
                SettingsSecureField(title: "新密码", text: $newPassword, contentType: .newPassword)
                SettingsSecureField(title: "确认新密码", text: $confirmPassword, contentType: .newPassword)
            }
            if let message = errorMessage ?? validationMessage {
                SettingsInlineError(message: message)
            }
            Text("修改后，其他设备上的登录会失效；本机保持登录。忘记当前密码可退出登录后使用「忘记密码」。")
                .font(.footnote)
                .foregroundStyle(Theme.subtext)
                .frame(maxWidth: .infinity, alignment: .leading)
            SettingsPrimaryButton(title: isSubmitting ? "正在提交…" : "确认修改", isEnabled: canSubmit) {
                Task {
                    guard canSubmit else { return }
                    isSubmitting = true
                    errorMessage = nil
                    let error = await store.changePassword(currentPassword: currentPassword, newPassword: newPassword)
                    isSubmitting = false
                    if let error { errorMessage = error } else { dismiss() }
                }
            }
        }
        .onChange(of: currentPassword) { errorMessage = nil }
        .onChange(of: newPassword) { errorMessage = nil }
    }
}

struct SettingsSecureField: View {
    let title: String
    @Binding var text: String
    var contentType: UITextContentType = .password

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(AppFont.caption.weight(.bold))
                .foregroundStyle(Theme.subtext)
            SecureField(title, text: $text)
                .textContentType(contentType)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .foregroundStyle(Theme.text)
                .padding(13)
                .background(Theme.panel, in: RoundedRectangle(cornerRadius: Radius.control))
                .overlay { RoundedRectangle(cornerRadius: Radius.control).stroke(Theme.hairline, lineWidth: 1) }
        }
    }
}

struct SettingsInlineError: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.circle.fill")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Theme.accent)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
    }
}

struct SettingsPrimaryButton: View {
    let title: String
    var isEnabled = true
    var tint: Color = Theme.accent
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(AppFont.headline.weight(.bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 15)
                .background(tint.opacity(isEnabled ? 1 : 0.5), in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        }
        .buttonStyle(.pressFeedback)
        .disabled(!isEnabled)
    }
}

struct GeneralSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var browsingHistoryEnabled = true

    var body: some View {
        SettingsDetailScaffold(title: "通用设置", dismiss: dismiss) {
            Text("显示")
                .font(AppFont.headline.weight(.bold))
                .foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)

            SettingsDetailGroup {
                SettingsAppearanceRow(mode: $store.appearanceMode)
            }

            Text("功能")
                .font(AppFont.headline.weight(.bold))
                .foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)

            SettingsDetailGroup {
                SettingsToggleRow(title: "浏览记录", subtitle: "关闭后，不再记录并删除历史浏览记录", isOn: $browsingHistoryEnabled)
                    .onChange(of: browsingHistoryEnabled) {
                        if !browsingHistoryEnabled {
                            store.removeBrowsingHistory(postIDs: Set(store.browsingHistoryIDs))
                        }
                    }
            }
        }
    }
}

struct NotificationSettingsView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        SettingsDetailScaffold(title: "通知说明", dismiss: dismiss) {
            SettingsDetailGroup {
                SettingsValueRow(title: "系统推送", value: "暂未提供")
            }
            Text("私信和互动在打开 App 后更新。收藏的截团日期可在 App 内查看，目前不会在截团前发送系统通知。")
                .font(AppFont.callout.weight(.regular))
                .foregroundStyle(Theme.subtext)
                .padding(.horizontal, 14)
        }
    }
}

struct SettingsDetailScaffold<Content: View>: View {
    let title: String
    let dismiss: DismissAction
    let content: Content

    init(title: String, dismiss: DismissAction, @ViewBuilder content: () -> Content) {
        self.title = title
        self.dismiss = dismiss
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            SimpleTopBar(title: title, trailing: nil) {
                dismiss()
            }

            ScrollView(showsIndicators: false) {
                VStack(spacing: 24) {
                    content
                }
                .padding(.horizontal, 16)
                .padding(.top, 30)
                .padding(.bottom, 60)
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .interactiveBackSwipe()
        .navigationBarBackButtonHidden(true)
        .navigationBarHidden(true)
        .toolbar(.hidden, for: .tabBar)
    }
}

struct SettingsDetailGroup<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            content
        }
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
    }
}

struct SettingsValueRow: View {
    let title: String
    let value: String
    var subtitle: String? = nil

    var body: some View {
        HStack(alignment: subtitle == nil ? .center : .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(AppFont.title.weight(.regular))
                    .foregroundStyle(Theme.text.opacity(0.92))
                if let subtitle {
                    Text(subtitle)
                        .font(AppFont.callout.weight(.semibold))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 12)
            Text(value)
                .font(AppFont.title.weight(.regular))
                .foregroundStyle(Theme.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
            Image(systemName: "chevron.right")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: subtitle == nil ? 72 : 90)
        .contentShape(Rectangle())
    }
}

struct SettingsToggleRow: View {
    let title: String
    var subtitle: String? = nil
    @Binding var isOn: Bool

    var body: some View {
        HStack(alignment: subtitle == nil ? .center : .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(AppFont.title.weight(.regular))
                    .foregroundStyle(Theme.text.opacity(0.92))
                if let subtitle {
                    Text(subtitle)
                        .font(AppFont.callout.weight(.semibold))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 12)
            Toggle("", isOn: $isOn)
                .labelsHidden()
                .tint(Theme.accent)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: subtitle == nil ? 72 : 96)
    }
}

struct SettingsAppearanceRow: View {
    @Binding var mode: AppearanceMode

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("外观")
                .font(AppFont.title.weight(.regular))
                .foregroundStyle(Theme.text.opacity(0.92))
            Picker("外观", selection: $mode) {
                ForEach(AppearanceMode.allCases) { item in
                    Text(item.title).tag(item)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 16)
        .frame(minHeight: 96)
    }
}

struct SettingsSeparator: View {
    var body: some View {
        Divider()
            .overlay(Theme.hairline)
            .padding(.leading, 16)
    }
}

struct SettingsGroup<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            content
        }
        .padding(.vertical, 4)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
    }
}

struct SettingsRow: View {
    let icon: String
    let title: String

    var body: some View {
        HStack(spacing: 18) {
            Image(systemName: icon)
                .font(.system(size: 24, weight: .medium))
                .foregroundStyle(Theme.text.opacity(0.88))
                .frame(width: 40, height: 56)
            Text(title)
                .font(AppFont.title.weight(.regular))
                .foregroundStyle(Theme.text.opacity(0.9))
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }
}

struct SettingsPlainActionRow: View {
    let title: String

    var body: some View {
        Text(title)
            .font(AppFont.title.weight(.regular))
            .foregroundStyle(Theme.text.opacity(0.92))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 20)
    }
}

struct SimpleTopBar: View {
    let title: String
    let trailing: String?
    var trailingIcon: String? = nil
    let backAction: () -> Void
    var trailingAction: (() -> Void)? = nil

    var body: some View {
        HStack {
            Button(action: backAction) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 27, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .frame(width: 44, height: 50)
            }
            .buttonStyle(.pressFeedback)

            Spacer()
            Text(title)
                .font(AppFont.title)
                .foregroundStyle(Theme.text)
            Spacer()

            if let trailing, let trailingAction {
                Button(action: trailingAction) {
                    HStack(spacing: 6) {
                        if let trailingIcon {
                            Image(systemName: trailingIcon)
                                .font(.system(size: 16, weight: .bold))
                        }
                        Text(trailing)
                            .font(AppFont.callout.weight(.bold))
                    }
                    .foregroundStyle(Theme.text)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 9)
                    .overlay {
                        Capsule().stroke(Theme.subtext, lineWidth: 1)
                    }
                }
                .buttonStyle(.pressFeedback)
            } else {
                Color.clear.frame(width: 78, height: 44)
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, 8)
    }
}

struct HelpFeedbackView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var store: MockAppStore

    var body: some View {
        SettingsDetailScaffold(title: "帮助与反馈", dismiss: dismiss) {
            SettingsDetailGroup {
                Button {
                    if let url = URL(string: "mailto:\(SupportContact.email)") {
                        openURL(url)
                    }
                } label: {
                    SettingsValueRow(title: "联系客服", value: SupportContact.email)
                }
                .buttonStyle(.pressFeedback)
                SettingsSeparator()
                Button {
                    UIPasteboard.general.string = SupportContact.email
                    store.showToast("已复制客服邮箱")
                } label: {
                    SettingsValueRow(title: "复制客服邮箱", value: "复制")
                }
                .buttonStyle(.pressFeedback)
            }

            Text("如需帮助、举报申诉或反馈问题，请通过以上邮箱联系我们，我们会尽快回复。")
                .font(AppFont.callout.weight(.regular))
                .foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
        }
    }
}

struct BlockedUsersView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var pendingUnblockUser: User?

    private var blockedUsers: [User] {
        store.users.filter { store.blockedUserIDs.contains($0.id) }
    }

    var body: some View {
        SettingsDetailScaffold(title: "已拉黑用户", dismiss: dismiss) {
            if blockedUsers.isEmpty {
                Text("你还没有拉黑任何用户。")
                    .font(AppFont.callout.weight(.regular))
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.top, 48)
            } else {
                SettingsDetailGroup {
                    ForEach(Array(blockedUsers.enumerated()), id: \.element.id) { index, user in
                        if index > 0 { SettingsSeparator() }
                        HStack(spacing: 12) {
                            Text(user.nickname)
                                .font(AppFont.body)
                                .foregroundStyle(Theme.text)
                                .lineLimit(1)
                            Spacer(minLength: 12)
                            Button {
                                pendingUnblockUser = user
                            } label: {
                                Text("解除")
                                    .font(AppFont.callout.weight(.bold))
                                    .foregroundStyle(Theme.accent)
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 7)
                                    .overlay { Capsule().stroke(Theme.accent, lineWidth: 1) }
                            }
                            .buttonStyle(.pressFeedback)
                        }
                        .padding(.horizontal, 16)
                        .frame(minHeight: 64)
                    }
                }
            }
        }
        .task { await store.loadBlockedUsers() }
        .alert(
            "确认解除拉黑该用户？",
            isPresented: Binding(
                get: { pendingUnblockUser != nil },
                set: { isPresented in
                    if !isPresented {
                        pendingUnblockUser = nil
                    }
                }
            ),
            presenting: pendingUnblockUser
        ) { user in
            Button("取消", role: .cancel) {
                pendingUnblockUser = nil
            }
            Button("确认") {
                let userID = user.id
                pendingUnblockUser = nil
                Task { await store.unblockUser(userID) }
            }
        } message: { user in
            Text("解除拉黑 \(user.nickname) 后，你会重新看到对方的内容，对方也可以再次私信你。")
        }
    }
}

struct AccountDeletionView: View {
    enum VerificationMethod: String, CaseIterable, Identifiable {
        case password = "账号密码"
        case code = "邮箱验证码"
        var id: String { rawValue }
    }

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var showsConfirm = false
    @State private var isDeleting = false
    @State private var showsVerification = false
    @State private var method: VerificationMethod = .password
    @State private var password = ""
    @State private var code = ""
    @State private var isSendingCode = false
    @State private var codeSent = false
    @State private var errorMessage: String?

    private var canDelete: Bool {
        guard !isDeleting else { return false }
        switch method {
        case .password: return !password.isEmpty
        case .code: return code.trimmed.count == 6
        }
    }

    var body: some View {
        SettingsDetailScaffold(title: "删除账号", dismiss: dismiss) {
            VStack(alignment: .leading, spacing: 12) {
                Text("删除账号后将会：")
                    .font(AppFont.headline.weight(.bold))
                    .foregroundStyle(Theme.text)
                bullet("退出并注销当前账号，登录凭证立即失效")
                bullet("隐藏你发布的拼团帖子、合集和评论")
                bullet("清除你的昵称、头像、简介等个人资料")
                bullet("释放你的注册邮箱，之后可重新注册")
                Text("此操作不可恢复，请谨慎操作。")
                    .font(AppFont.callout.weight(.semibold))
                    .foregroundStyle(Theme.accent)
                    .padding(.top, 4)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))

            if showsVerification {
                verificationSection
            } else {
                SettingsPrimaryButton(title: "删除账号", tint: .red) {
                    showsConfirm = true
                }
            }
        }
        .alert("确认删除账号？", isPresented: $showsConfirm) {
            Button("取消", role: .cancel) {}
            Button("继续", role: .destructive) {
                withAnimation(.easeOut(duration: 0.2)) { showsVerification = true }
            }
        } message: {
            Text("删除后将无法恢复。下一步需要验证你的身份。")
        }
        .onChange(of: method) { errorMessage = nil }
    }

    @ViewBuilder
    private var verificationSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("验证身份")
                .font(AppFont.headline.weight(.bold))
                .foregroundStyle(Theme.text)
            Picker("验证方式", selection: $method) {
                ForEach(VerificationMethod.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            switch method {
            case .password:
                SettingsSecureField(title: "账号密码", text: $password)
                Text("通过验证码注册、未设置密码的账号请选择邮箱验证码。")
                    .font(.footnote)
                    .foregroundStyle(Theme.subtext)
            case .code:
                HStack(alignment: .bottom, spacing: 10) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("验证码")
                            .font(AppFont.caption.weight(.bold))
                            .foregroundStyle(Theme.subtext)
                        TextField("6 位数字", text: $code)
                            .keyboardType(.numberPad)
                            .textContentType(.oneTimeCode)
                            .characterLimit(6, text: $code)
                            .foregroundStyle(Theme.text)
                            .padding(13)
                            .background(Theme.panel, in: RoundedRectangle(cornerRadius: Radius.control))
                    }
                    Button {
                        Task {
                            guard !isSendingCode else { return }
                            isSendingCode = true
                            errorMessage = await store.requestAccountDeletionCode()
                            codeSent = errorMessage == nil
                            isSendingCode = false
                        }
                    } label: {
                        Text(isSendingCode ? "发送中" : (codeSent ? "重新发送" : "发送验证码"))
                            .font(AppFont.callout.weight(.bold))
                            .foregroundStyle(.white)
                            .frame(width: 104, height: 48)
                            .background(Theme.accentFill.opacity(isSendingCode ? 0.5 : 1), in: RoundedRectangle(cornerRadius: Radius.control))
                    }
                    .buttonStyle(.pressFeedback)
                    .disabled(isSendingCode)
                }
                if codeSent {
                    Text("验证码已发送到当前账号邮箱。")
                        .font(.footnote)
                        .foregroundStyle(Theme.subtext)
                }
            }
            if let errorMessage {
                SettingsInlineError(message: errorMessage)
            }
            SettingsPrimaryButton(title: isDeleting ? "正在删除…" : "确认删除账号", isEnabled: canDelete, tint: .red) {
                Task {
                    guard canDelete else { return }
                    isDeleting = true
                    errorMessage = nil
                    let error = await store.deleteAccount(password: method == .password ? password : nil,
                                                          code: method == .code ? code.trimmed : nil)
                    isDeleting = false
                    if let error { errorMessage = error } else { dismiss() }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Theme.panel.opacity(0.6), in: RoundedRectangle(cornerRadius: Radius.sheet, style: .continuous))
    }

    private func bullet(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text("•").foregroundStyle(Theme.muted)
            Text(text)
                .font(AppFont.callout.weight(.regular))
                .foregroundStyle(Theme.subtext)
        }
    }
}
