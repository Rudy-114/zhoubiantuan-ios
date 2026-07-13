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
                        .buttonStyle(.plain)
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
                        .buttonStyle(.plain)
                        Divider().overlay(Theme.hairline).padding(.leading, 58)
                        NavigationLink(destination: NotificationSettingsView()) {
                            SettingsRow(icon: "bell", title: "通知设置")
                        }
                        .buttonStyle(.plain)
                        Divider().overlay(Theme.hairline).padding(.leading, 58)
                        NavigationLink(destination: HelpFeedbackView()) {
                            SettingsRow(icon: "questionmark.circle", title: "帮助与反馈")
                        }
                        .buttonStyle(.plain)
                    }

                    SettingsGroup {
                        Button {
                            store.logOut()
                            dismiss()
                        } label: {
                            SettingsPlainActionRow(title: "退出登录")
                        }
                        .buttonStyle(.plain)
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
        .navigationBarBackButtonHidden(true)
        .navigationBarHidden(true)
        .toolbar(.hidden, for: .tabBar)
    }
}

struct AccountSecuritySettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore

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
                NavigationLink(destination: BlockedUsersView()) {
                    SettingsValueRow(title: "已拉黑用户", value: "")
                }
                .buttonStyle(.plain)
                SettingsSeparator()
                NavigationLink(destination: AccountDeletionView()) {
                    SettingsValueRow(title: "删除账号", value: "")
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct GeneralSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var browsingHistoryEnabled = true

    var body: some View {
        SettingsDetailScaffold(title: "通用设置", dismiss: dismiss) {
            Text("显示")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)

            SettingsDetailGroup {
                SettingsToggleRow(title: "深色模式", isOn: $store.isDarkModeEnabled)
            }

            Text("功能")
                .font(.system(size: 18, weight: .bold))
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
                SettingsSeparator()
                SettingsToggleRow(title: "未关注前最多两条私信", subtitle: "开启后，对方关注你之前，你最多只能发送两条消息", isOn: $store.limitsUnrepliedMessages)
            }
        }
    }
}

struct NotificationSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var receiveMessages = false
    @State private var likesAndFavorites = true
    @State private var newFollowers = true
    @State private var shares = true
    @State private var privateMessageMode = "接收"

    var body: some View {
        SettingsDetailScaffold(title: "通知设置", dismiss: dismiss) {
            SettingsDetailGroup {
                SettingsToggleRow(title: "接收消息通知", isOn: $receiveMessages)
            }

            Text("互动通知")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)

            SettingsDetailGroup {
                SettingsToggleRow(title: "赞和收藏", isOn: $likesAndFavorites)
                SettingsSeparator()
                SettingsToggleRow(title: "新增关注", isOn: $newFollowers)
                SettingsSeparator()
                SettingsToggleRow(title: "分享", isOn: $shares)
            }

            Text("私信通知")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)

            SettingsDetailGroup {
                Button {
                    privateMessageMode = privateMessageMode == "接收" ? "不接收" : "接收"
                } label: {
                    SettingsValueRow(title: "私信", value: privateMessageMode)
                }
                .buttonStyle(.plain)
            }
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
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
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
                    .font(.system(size: 22, weight: .regular))
                    .foregroundStyle(Theme.text.opacity(0.92))
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 12)
            Text(value)
                .font(.system(size: 22, weight: .regular))
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
                    .font(.system(size: 22, weight: .regular))
                    .foregroundStyle(Theme.text.opacity(0.92))
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 12)
            Toggle("", isOn: $isOn)
                .labelsHidden()
                .tint(Theme.hotPink)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: subtitle == nil ? 72 : 96)
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
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
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
                .font(.system(size: 20, weight: .regular))
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
            .font(.system(size: 20, weight: .regular))
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
            .buttonStyle(.plain)

            Spacer()
            Text(title)
                .font(.system(size: 22, weight: .black))
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
                            .font(.system(size: 16, weight: .black))
                    }
                    .foregroundStyle(Theme.text)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 9)
                    .overlay {
                        Capsule().stroke(Theme.subtext, lineWidth: 1)
                    }
                }
                .buttonStyle(.plain)
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
                .buttonStyle(.plain)
                SettingsSeparator()
                Button {
                    UIPasteboard.general.string = SupportContact.email
                    store.showToast("已复制客服邮箱")
                } label: {
                    SettingsValueRow(title: "复制客服邮箱", value: "复制")
                }
                .buttonStyle(.plain)
            }

            Text("如需帮助、举报申诉或反馈问题，请通过以上邮箱联系我们，我们会尽快回复。")
                .font(.system(size: 14))
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
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.top, 48)
            } else {
                SettingsDetailGroup {
                    ForEach(Array(blockedUsers.enumerated()), id: \.element.id) { index, user in
                        if index > 0 { SettingsSeparator() }
                        HStack(spacing: 12) {
                            Text(user.nickname)
                                .font(.system(size: 18))
                                .foregroundStyle(Theme.text)
                                .lineLimit(1)
                            Spacer(minLength: 12)
                            Button {
                                pendingUnblockUser = user
                            } label: {
                                Text("解除")
                                    .font(.system(size: 15, weight: .bold))
                                    .foregroundStyle(Theme.hotPink)
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 7)
                                    .overlay { Capsule().stroke(Theme.hotPink, lineWidth: 1) }
                            }
                            .buttonStyle(.plain)
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
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var showsConfirm = false
    @State private var isDeleting = false

    var body: some View {
        SettingsDetailScaffold(title: "删除账号", dismiss: dismiss) {
            VStack(alignment: .leading, spacing: 12) {
                Text("删除账号后将会：")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(Theme.text)
                bullet("退出并注销当前账号，登录凭证立即失效")
                bullet("隐藏你发布的拼团帖子、合集和评论")
                bullet("清除你的昵称、头像、简介等个人资料")
                bullet("释放你的注册邮箱，之后可重新注册")
                Text("此操作不可恢复，请谨慎操作。")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.hotPink)
                    .padding(.top, 4)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 16, style: .continuous))

            Button {
                showsConfirm = true
            } label: {
                Text(isDeleting ? "正在删除…" : "删除账号")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 15)
                    .background(Color.red.opacity(isDeleting ? 0.5 : 1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(isDeleting)
        }
        .alert("确认删除账号？", isPresented: $showsConfirm) {
            Button("取消", role: .cancel) {}
            Button("删除", role: .destructive) {
                Task {
                    isDeleting = true
                    let ok = await store.deleteAccount()
                    isDeleting = false
                    if ok { dismiss() }
                }
            }
        } message: {
            Text("删除后将无法恢复，确定要继续吗？")
        }
    }

    private func bullet(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text("•").foregroundStyle(Theme.muted)
            Text(text)
                .font(.system(size: 15))
                .foregroundStyle(Theme.subtext)
        }
    }
}
