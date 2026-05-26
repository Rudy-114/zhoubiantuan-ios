import SwiftUI

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
                        NavigationLink(destination: GeneralSettingsView()) {
                            SettingsRow(icon: "gearshape", title: "通用设置")
                        }
                        .buttonStyle(.plain)
                        Divider().overlay(Theme.hairline).padding(.leading, 58)
                        NavigationLink(destination: NotificationSettingsView()) {
                            SettingsRow(icon: "bell", title: "通知设置")
                        }
                        .buttonStyle(.plain)
                    }

                    SettingsGroup {
                        Button {
                            store.showToast("已打开切换账号占位")
                        } label: {
                            SettingsPlainActionRow(title: "切换账号")
                        }
                        .buttonStyle(.plain)
                        Divider().overlay(Theme.hairline).padding(.leading, 58)
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
                SettingsValueRow(title: "密码登录", value: store.isBackendEnabled ? "已启用" : "已设置")
                SettingsSeparator()
                SettingsValueRow(title: "邮箱验证码", value: store.isBackendEnabled ? "可用" : "本地模式不可用")
            }

            SettingsDetailGroup {
                SettingsValueRow(title: "Apple", value: "未绑定")
                SettingsSeparator()
                SettingsValueRow(title: "微信", value: "待配置")
                SettingsSeparator()
                SettingsValueRow(title: "删除账号", value: "待接入")
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
                SettingsToggleRow(title: "未关注回复前最多两条私信", subtitle: "开启后，对方未关注你时，对方回复之前只能连续发送两条消息", isOn: $store.limitsUnrepliedMessages)
                #if DEBUG
                SettingsSeparator()
                SettingsToggleRow(title: "阿里云后端测试", subtitle: "开启后使用 ECS + RDS + OSS 测试接口", isOn: $store.isBackendEnabled)
                    .onChange(of: store.isBackendEnabled) {
                        store.backendModeChanged()
                    }
                #endif
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
