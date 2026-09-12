import SwiftUI

struct GuestAuthView: View {
    @EnvironmentObject private var store: MockAppStore
    @State private var hasAcceptedTerms = false
    @State private var isRegisterPresented = false
    let onClose: (() -> Void)?

    init(onClose: (() -> Void)? = nil) {
        self.onClose = onClose
    }

    var body: some View {
        ZStack {
            Color(red: 0.015, green: 0.016, blue: 0.022)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                HStack {
                    if let onClose {
                        Button(action: onClose) {
                            Image(systemName: "xmark")
                                .font(.system(size: 20, weight: .bold))
                                .foregroundStyle(Color.white.opacity(0.72))
                                .frame(width: 44, height: 44)
                                .background(Color.white.opacity(0.08), in: Circle())
                        }
                        .buttonStyle(.plain)
                    }
                    Spacer()
                }
                .padding(.horizontal, 22)
                .padding(.top, 34)
                .frame(height: 78)

                Spacer(minLength: 80)

                GuestBrandLogo()

                Spacer()

                VStack(spacing: 28) {
                    VStack(spacing: 18) {
                        Button {
                            isRegisterPresented = true
                        } label: {
                            Label("邮箱注册 / 登录", systemImage: "envelope.fill")
                                .font(.system(size: 22, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .frame(height: 62)
                                .padding(.horizontal, 20)
                                .background(Theme.accentFill, in: Capsule())
                        }
                        .buttonStyle(.plain)

                        Text("支持邮箱注册、密码登录和验证码登录。")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Color(red: 0.76, green: 0.82, blue: 0.91))
                            .frame(maxWidth: .infinity, alignment: .leading)

                        #if DEBUG
                        VStack(alignment: .leading, spacing: 12) {
                            Text("开发调试入口")
                                .font(.system(size: 13, weight: .black))
                                .foregroundStyle(Color.white.opacity(0.46))

                            HStack(spacing: 12) {
                                Button {
                                    logIn(provider: "微信")
                                } label: {
                                    Label("微信", systemImage: "bubble.left.and.bubble.right.fill")
                                        .font(.system(size: 16, weight: .black))
                                        .foregroundStyle(.white)
                                        .frame(maxWidth: .infinity)
                                        .frame(height: 48)
                                        .background(Color(red: 0.03, green: 0.78, blue: 0.36).opacity(0.82), in: Capsule())
                                }
                                .buttonStyle(.plain)

                                Button {
                                    logIn(provider: "Apple")
                                } label: {
                                    Label("Apple", systemImage: "apple.logo")
                                        .font(.system(size: 16, weight: .black))
                                        .foregroundStyle(.white)
                                        .frame(maxWidth: .infinity)
                                        .frame(height: 48)
                                        .overlay {
                                            Capsule().stroke(Color.white.opacity(0.28), lineWidth: 1)
                                        }
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        #endif
                    }

                    LegalAgreementRow(
                        isAccepted: $hasAcceptedTerms,
                        documents: [.userAgreement, .privacyPolicy, .minorsPolicy],
                        textColor: Color(red: 0.76, green: 0.82, blue: 0.91),
                        fontSize: 16,
                        iconSize: 20
                    )
                }
                .padding(.horizontal, 34)
                .padding(.bottom, 34)
            }
        }
        .navigationBarHidden(true)
        .preferredColorScheme(.dark)
        .fullScreenCover(isPresented: $isRegisterPresented) {
            AccountAuthView()
                .environmentObject(store)
                .preferredColorScheme(.dark)
        }
    }

    private func logIn(provider: String) {
        guard hasAcceptedTerms else {
            store.showToast("请先勾选并同意协议")
            return
        }
        store.logInDemoAccount(provider: provider)
    }
}

struct GuestBrandLogo: View {
    private var logoGradient: LinearGradient {
        LinearGradient(
            colors: [
                .white,
                Theme.accentHighlight,
                Theme.accent
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(
                    logoGradient,
                    style: StrokeStyle(lineWidth: 8, lineCap: .round, lineJoin: .round)
                )
                .frame(width: 78, height: 78)

            Text("才")
                .font(.system(size: 58, weight: .black, design: .rounded))
                .foregroundStyle(logoGradient)
                .offset(x: -1, y: 2)
        }
        .frame(width: 92, height: 92)
            .shadow(color: Theme.accent.opacity(0.26), radius: 14, x: 0, y: 6)
            .accessibilityLabel("团")
    }
}

enum AccountAuthMode: String, CaseIterable, Identifiable {
    case register = "注册"
    case passwordLogin = "密码登录"
    case codeLogin = "验证码登录"

    var id: String { rawValue }

    static func available(isBackendEnabled: Bool) -> [AccountAuthMode] {
        Self.allCases
    }
}

private enum AuthErrorField: Hashable {
    case nickname
    case email
    case code
    case password
    case confirmPassword
    case agreement
    case general
}

private struct AuthFieldError {
    let field: AuthErrorField
    let message: String
}

struct AccountAuthView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var mode: AccountAuthMode = .register
    @State private var nickname = ""
    @State private var email = ""
    @State private var code = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var hasAcceptedTerms = false
    @State private var isSendingCode = false
    @State private var codeResendSecondsRemaining = 0
    @State private var formError: AuthFieldError?

    var canSubmit: Bool {
        switch mode {
        case .register:
            !nickname.trimmed.isEmpty &&
            email.trimmed.contains("@") &&
            password.trimmed.count >= 8 &&
            password == confirmPassword &&
            code.trimmed.count == 6 &&
            hasAcceptedTerms
        case .passwordLogin:
            email.trimmed.contains("@") &&
            !password.trimmed.isEmpty &&
            hasAcceptedTerms
        case .codeLogin:
            email.trimmed.contains("@") &&
            code.trimmed.count == 6 &&
            hasAcceptedTerms
        }
    }

    var shouldShowCodeField: Bool {
        mode == .register || mode == .codeLogin
    }

    var canRequestCode: Bool {
        !isSendingCode && codeResendSecondsRemaining == 0
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 28, weight: .medium))
                        .foregroundStyle(.white)
                        .frame(width: 48, height: 48)
                }
                .buttonStyle(.plain)

                Spacer()

                Text(mode == .register ? "注册账号" : "账号登录")
                    .font(.system(size: 22, weight: .black))
                    .foregroundStyle(.white)

                Spacer()

                Color.clear.frame(width: 48, height: 48)
            }
            .padding(.horizontal, 12)
            .padding(.top, 10)

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 26) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(titleText)
                            .font(.system(size: 34, weight: .black))
                            .foregroundStyle(.white)
                        Text(subtitleText)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Color.white.opacity(0.56))
                    }
                    .padding(.top, 18)

                    HStack(spacing: 8) {
                        ForEach(AccountAuthMode.available(isBackendEnabled: store.isBackendEnabled)) { item in
                            Button {
                                mode = item
                            } label: {
                                Text(item.rawValue)
                                    .font(.system(size: store.isBackendEnabled ? 14 : 16, weight: .black))
                                    .foregroundStyle(mode == item ? .white : Color.white.opacity(0.52))
                                    .frame(maxWidth: .infinity)
                                    .frame(height: 44)
                                    .background(mode == item ? Theme.accentFill : Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    VStack(spacing: 14) {
                        if mode == .register {
                            AuthTextField(title: "昵称", placeholder: "设置你的昵称", text: $nickname, error: errorMessage(for: .nickname))
                        }
                        AuthTextField(
                            title: "邮箱",
                            placeholder: "输入邮箱",
                            text: $email,
                            keyboardType: .emailAddress,
                            textContentType: .emailAddress,
                            error: errorMessage(for: .email)
                        )
                        if shouldShowCodeField {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(alignment: .bottom, spacing: 10) {
                                    AuthTextField(title: "验证码", placeholder: "6 位数字", text: $code, keyboardType: .numberPad, textContentType: .oneTimeCode)
                                    Button {
                                        Task { await requestCode() }
                                    } label: {
                                        Text(codeButtonTitle)
                                            .font(.system(size: 14, weight: .black))
                                            .foregroundStyle(.white)
                                            .frame(width: 104, height: 52)
                                            .background(canRequestCode ? Theme.accentFill : Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                    }
                                    .buttonStyle(.plain)
                                    .disabled(!canRequestCode)
                                }
                                if let error = errorMessage(for: .code) {
                                    AuthFieldErrorText(error)
                                }
                            }
                        }
                        if mode != .codeLogin {
                            AuthSecureField(title: "密码", placeholder: mode == .register ? "至少 8 位" : "输入密码", text: $password, error: errorMessage(for: .password))
                        }
                        if mode == .register {
                            AuthSecureField(title: "确认密码", placeholder: "再次输入密码", text: $confirmPassword, error: errorMessage(for: .confirmPassword))
                        }
                    }

                    Button {
                        Task {
                            await submit()
                        }
                    } label: {
                        Text(submitText)
                            .font(.system(size: 18, weight: .black))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 54)
                            .background(Theme.accentFill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    if let error = errorMessage(for: .general) {
                        AuthFieldErrorText(error)
                            .padding(.top, -18)
                    }

                    LegalAgreementRow(
                        isAccepted: $hasAcceptedTerms,
                        documents: [.userAgreement, .privacyPolicy, .minorsPolicy],
                        textColor: Color(red: 0.76, green: 0.82, blue: 0.91)
                    )
                    if let error = errorMessage(for: .agreement) {
                        AuthFieldErrorText(error)
                            .padding(.top, -18)
                    }
                }
                .padding(.horizontal, 22)
                .padding(.bottom, 28)
            }
        }
        .background(Color(red: 0.015, green: 0.016, blue: 0.022).ignoresSafeArea())
        .onChange(of: mode) {
            clearAuthError()
        }
        .onChange(of: nickname) {
            clearAuthError(for: .nickname)
        }
        .onChange(of: email) {
            clearAuthError(for: .email)
        }
        .onChange(of: code) {
            clearAuthError(for: .code)
        }
        .onChange(of: password) {
            clearAuthError(for: .password)
            clearAuthError(for: .confirmPassword)
        }
        .onChange(of: confirmPassword) {
            clearAuthError(for: .confirmPassword)
        }
        .onChange(of: hasAcceptedTerms) {
            clearAuthError(for: .agreement)
        }
    }

    private var codeButtonTitle: String {
        if isSendingCode {
            return "发送中"
        }
        if codeResendSecondsRemaining > 0 {
            return "\(codeResendSecondsRemaining)s后重发"
        }
        return "发送验证码"
    }

    private var titleText: String {
        switch mode {
        case .register: return "邮箱注册"
        case .passwordLogin: return "密码登录"
        case .codeLogin: return "验证码登录"
        }
    }

    private var subtitleText: String {
        switch mode {
        case .register:
            return "先获取验证码，设置密码后即可创建账号。"
        case .passwordLogin:
            return "输入已注册邮箱和密码继续。"
        case .codeLogin:
            return "获取邮箱验证码后无需密码即可登录。"
        }
    }

    private var submitText: String {
        switch mode {
        case .register: return "验证并注册"
        case .passwordLogin: return "登录"
        case .codeLogin: return "验证码登录"
        }
    }

    private func requestCode() async {
        clearAuthError()
        guard validateEmailForCodeRequest() else { return }
        isSendingCode = true
        let purpose = mode == .register ? "register" : "login"
        let didSend = await store.requestEmailCode(email: email, purpose: purpose)
        isSendingCode = false
        if didSend {
            startCodeCooldown()
        } else {
            applyRemoteAuthError(defaultField: .email)
        }
    }

    private func startCodeCooldown() {
        codeResendSecondsRemaining = 60
        Task {
            while codeResendSecondsRemaining > 0 {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                await MainActor.run {
                    if codeResendSecondsRemaining > 0 {
                        codeResendSecondsRemaining -= 1
                    }
                }
            }
        }
    }

    private func submit() async {
        clearAuthError()
        guard validateForSubmit() else { return }
        switch mode {
        case .register:
            if await store.registerAccount(nickname: nickname, email: email, password: password, code: code) {
                dismiss()
            } else {
                applyRemoteAuthError(defaultField: .general)
            }
        case .passwordLogin:
            if await store.loginWithEmail(email: email, password: password) {
                dismiss()
            } else {
                applyRemoteAuthError(defaultField: .password)
            }
        case .codeLogin:
            if await store.loginWithEmailCode(email: email, code: code) {
                dismiss()
            } else {
                applyRemoteAuthError(defaultField: .code)
            }
        }
    }

    private func validateEmailForCodeRequest() -> Bool {
        guard isValidEmail(email.trimmed) else {
            setAuthError(.email, "请填写有效邮箱")
            return false
        }
        return true
    }

    private func validateForSubmit() -> Bool {
        switch mode {
        case .register:
            guard !nickname.trimmed.isEmpty else {
                setAuthError(.nickname, "请填写昵称")
                return false
            }
            guard isValidEmail(email.trimmed) else {
                setAuthError(.email, "请填写有效邮箱")
                return false
            }
            guard code.trimmed.count == 6 else {
                setAuthError(.code, "请填写 6 位验证码")
                return false
            }
            guard password.trimmed.count >= 8 else {
                setAuthError(.password, "密码至少 8 位")
                return false
            }
            guard password == confirmPassword else {
                setAuthError(.confirmPassword, "两次输入的密码不一致")
                return false
            }
            guard hasAcceptedTerms else {
                setAuthError(.agreement, "请先勾选并同意协议")
                return false
            }
        case .passwordLogin:
            guard isValidEmail(email.trimmed) else {
                setAuthError(.email, "请填写有效邮箱")
                return false
            }
            guard !password.trimmed.isEmpty else {
                setAuthError(.password, "请输入密码")
                return false
            }
            guard hasAcceptedTerms else {
                setAuthError(.agreement, "请先勾选并同意协议")
                return false
            }
        case .codeLogin:
            guard isValidEmail(email.trimmed) else {
                setAuthError(.email, "请填写有效邮箱")
                return false
            }
            guard code.trimmed.count == 6 else {
                setAuthError(.code, "请填写 6 位验证码")
                return false
            }
            guard hasAcceptedTerms else {
                setAuthError(.agreement, "请先勾选并同意协议")
                return false
            }
        }
        return true
    }

    private func isValidEmail(_ value: String) -> Bool {
        value.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil
    }

    private func setAuthError(_ field: AuthErrorField, _ message: String, showsToast: Bool = true) {
        formError = AuthFieldError(field: field, message: message)
        if showsToast {
            store.showToast(message)
        }
    }

    private func applyRemoteAuthError(defaultField: AuthErrorField) {
        let message = normalizedRemoteAuthError(store.toastMessage ?? "操作失败，请稍后重试")
        setAuthError(remoteField(for: message, defaultField: defaultField), message, showsToast: false)
    }

    private func normalizedRemoteAuthError(_ message: String) -> String {
        if message.contains("该邮箱已注册") || message.contains("本邮箱已经注册过") {
            return "该邮箱已注册"
        }
        if message.contains("验证码无效") || message.contains("验证码错误") || message.contains("邮箱或验证码不正确") {
            return "验证码不正确或已过期"
        }
        if message.contains("邮箱或密码不正确") {
            return "密码和邮箱不匹配"
        }
        return message
    }

    private func remoteField(for message: String, defaultField: AuthErrorField) -> AuthErrorField {
        if message.contains("邮箱") && (message.contains("注册") || message.contains("有效")) {
            return .email
        }
        if message.contains("验证码") {
            return .code
        }
        if message.contains("密码") {
            return .password
        }
        return defaultField
    }

    private func errorMessage(for field: AuthErrorField) -> String? {
        guard formError?.field == field else { return nil }
        return formError?.message
    }

    private func clearAuthError(for field: AuthErrorField) {
        if formError?.field == field {
            formError = nil
        }
    }

    private func clearAuthError() {
        formError = nil
    }
}

struct AuthTextField: View {
    let title: String
    let placeholder: String
    @Binding var text: String
    var keyboardType: UIKeyboardType = .default
    var textContentType: UITextContentType? = nil
    var error: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Color.white.opacity(0.56))
            TextField(placeholder, text: $text)
                .keyboardType(keyboardType)
                .textContentType(textContentType)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(.white)
                .tint(Theme.accent)
                .padding(.horizontal, 14)
                .frame(height: 52)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(error == nil ? Color.white.opacity(0.10) : Theme.danger.opacity(0.84), lineWidth: 1)
                }
            if let error {
                AuthFieldErrorText(error)
            }
        }
    }
}

struct AuthSecureField: View {
    let title: String
    let placeholder: String
    @Binding var text: String
    var error: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Color.white.opacity(0.56))
            SecureTextField(placeholder: placeholder, text: $text)
                .padding(.horizontal, 14)
                .frame(height: 52)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(error == nil ? Color.white.opacity(0.10) : Theme.danger.opacity(0.84), lineWidth: 1)
                }
            if let error {
                AuthFieldErrorText(error)
            }
        }
    }
}

private struct AuthFieldErrorText: View {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var body: some View {
        Text(message)
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(Theme.danger)
            .fixedSize(horizontal: false, vertical: true)
    }
}

struct SecureTextField: UIViewRepresentable {
    let placeholder: String
    @Binding var text: String

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text)
    }

    func makeUIView(context: Context) -> UITextField {
        let textField = UITextField()
        textField.isSecureTextEntry = true
        textField.borderStyle = .none
        textField.backgroundColor = .clear
        textField.textColor = .white
        textField.tintColor = Theme.accentUIColor
        textField.font = .systemFont(ofSize: 17, weight: .semibold)
        textField.attributedPlaceholder = NSAttributedString(
            string: placeholder,
            attributes: [.foregroundColor: UIColor.white.withAlphaComponent(0.34)]
        )
        textField.autocapitalizationType = .none
        textField.autocorrectionType = .no
        textField.spellCheckingType = .no
        textField.smartDashesType = .no
        textField.smartQuotesType = .no
        textField.smartInsertDeleteType = .no
        textField.textContentType = .oneTimeCode
        textField.passwordRules = nil
        textField.addTarget(context.coordinator, action: #selector(Coordinator.textDidChange(_:)), for: .editingChanged)
        return textField
    }

    func updateUIView(_ uiView: UITextField, context: Context) {
        if uiView.text != text {
            uiView.text = text
        }
    }

    final class Coordinator: NSObject {
        @Binding private var text: String

        init(text: Binding<String>) {
            _text = text
        }

        @objc func textDidChange(_ sender: UITextField) {
            text = sender.text ?? ""
        }
    }
}
