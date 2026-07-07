import SwiftUI
import Photos
import UIKit
import UniformTypeIdentifiers

struct MessagesView: View {
    @EnvironmentObject private var store: MockAppStore

    var body: some View {
        Group {
            if store.isLoggedIn {
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 18) {
                        HeaderTitle(title: "消息", subtitle: "站内咨询、截团提醒和治理通知")
                        VStack(spacing: 10) {
                            ForEach(store.currentUserReminders.prefix(3)) { reminder in
                                if let post = store.post(id: reminder.postID) {
                                    NavigationLink(value: Route.postDetail(post.id)) {
                                        ReminderMiniCard(post: post, reminder: reminder)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            if store.currentUserReminders.isEmpty {
                                MessagesEmptyPanel(title: "暂无截团提醒", icon: "bell")
                            }
                        }
                        .padding(.horizontal, 16)

                        Text("私信咨询")
                            .font(.system(size: 20, weight: .bold))
                            .foregroundStyle(Theme.text)
                            .padding(.horizontal, 16)

                        VStack(spacing: 0) {
                            if store.messageThreads.isEmpty {
                                MessagesEmptyPanel(title: "暂无私信", icon: "bubble.left.and.bubble.right")
                            } else {
                                ForEach(store.messageThreads) { thread in
                                    NavigationLink(value: Route.chat(thread.id)) {
                                        ThreadRow(thread: thread)
                                    }
                                    .buttonStyle(.plain)
                                    Divider().overlay(Theme.hairline).padding(.leading, 74)
                                }
                            }
                        }
                        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
                        .padding(.horizontal, 16)
                    }
                    .padding(.bottom, 28)
                }
                .background(Theme.background.ignoresSafeArea())
                .onAppear {
                    store.ensureMutualFriendThreads()
                }
            } else {
                GuestAuthView()
            }
        }
        .navigationBarHidden(true)
    }
}

struct MessagesEmptyPanel: View {
    let title: String
    let icon: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Theme.muted)
                .frame(width: 38, height: 38)
                .background(Theme.panelRaised, in: Circle())
            Text(title)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Theme.subtext)
            Spacer()
        }
        .padding(14)
        .frame(maxWidth: .infinity)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Theme.hairline, lineWidth: 1)
        }
    }
}

struct ThreadRow: View {
    @EnvironmentObject private var store: MockAppStore
    let thread: MessageThread

    var body: some View {
        let user = store.user(id: store.peerUserID(for: thread))
        let post = thread.relatedPostID.flatMap(store.post)
        let lastVisibleMessage = thread.messages.last { !$0.isRevoked && !$0.isDeletedForMe }
        HStack(spacing: 12) {
            AvatarView(user: user, size: 46)
            VStack(alignment: .leading, spacing: 5) {
                Text(user.nickname)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(post?.title ?? "好友私聊")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.softPink)
                    .lineLimit(1)
                Text(lastVisibleMessage.map(previewText) ?? "互相关注，开始聊天")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.subtext)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            if thread.unreadCount > 0 {
                Text("\(thread.unreadCount)")
                    .font(.system(size: 12, weight: .black))
                    .foregroundStyle(.white)
                    .monospacedDigit()
                    .padding(.horizontal, 8)
                    .frame(minWidth: 24, minHeight: 24)
                    .background(Theme.hotPink, in: Capsule())
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private func previewText(_ message: DirectMessage) -> String {
        if message.imageData != nil || !message.remoteImageURL.isEmpty || message.body == "[图片]" {
            return "[图片]"
        }
        return message.body
    }
}

struct ChatView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var draft = ""
    @State private var isAttachmentPanelOpen = false
    @State private var isMessageFieldFocused = false
    @State private var prefersEmojiKeyboard = false
    @State private var isPhotoLibraryPresented = false
    @State private var isCameraPresented = false
    let threadID: String

    var body: some View {
        if let thread = store.messageThread(id: threadID) {
            let peer = store.user(id: store.peerUserID(for: thread))
            let visibleMessages = thread.messages.filter { !$0.isRevoked && !$0.isDeletedForMe }
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 28, weight: .medium))
                            .foregroundStyle(Theme.text)
                            .frame(width: 42, height: 48)
                    }
                    .buttonStyle(.plain)
                    NavigationLink(value: Route.userProfile(peer.id)) {
                        HStack(spacing: 10) {
                            AvatarView(user: peer, size: 44)
                            Text(peer.nickname)
                                .font(.system(size: 23, weight: .bold))
                                .foregroundStyle(Theme.text)
                        }
                    }
                    .buttonStyle(.plain)
                    Spacer()
                }
                .padding(.horizontal, 12)
                .padding(.top, 10)
                .padding(.bottom, 12)
                .background(Theme.background)

                ScrollViewReader { proxy in
                    ScrollView(showsIndicators: false) {
                        VStack(spacing: 18) {
                            ForEach(Array(visibleMessages.enumerated()), id: \.element.id) { index, message in
                                if showsTimeSeparator(at: index, in: visibleMessages) {
                                    Text(ChatTimeSeparator.label(for: message.createdAt))
                                        .font(.system(size: 18, weight: .semibold))
                                        .foregroundStyle(Theme.muted)
                                        .padding(.top, index == 0 ? 18 : 10)
                                }
                                ChatBubble(threadID: thread.id, message: message)
                                    .id(message.id)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 12)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .onChange(of: visibleMessages.count) {
                        if let last = visibleMessages.last {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                    .onTapGesture {
                        closeInputSurfaces()
                    }
                }

                VStack(spacing: 0) {
                    HStack(spacing: 12) {
                        EmojiMessageTextField(
                            text: $draft,
                            isFocused: $isMessageFieldFocused,
                            prefersEmojiKeyboard: $prefersEmojiKeyboard,
                            placeholder: "发消息...",
                            onTap: activateNormalKeyboard,
                            onSubmit: send
                        )
                        .frame(height: 52)
                        .padding(.horizontal, 16)
                        .background(Theme.panelRaised, in: Capsule())

                        Button {
                            isAttachmentPanelOpen = false
                            prefersEmojiKeyboard = true
                            isMessageFieldFocused = true
                        } label: {
                            Image(systemName: "face.smiling")
                                .font(.system(size: 29, weight: .medium))
                                .foregroundStyle(Theme.text)
                                .frame(width: 42, height: 42)
                        }
                        .buttonStyle(.plain)

                        Button {
                            if draft.trimmed.isEmpty {
                                toggleAttachmentPanel()
                            } else {
                                send()
                            }
                        } label: {
                            Image(systemName: draft.trimmed.isEmpty ? "plus.circle" : "paperplane.fill")
                                .font(.system(size: 31, weight: .medium))
                                .foregroundStyle(draft.trimmed.isEmpty ? Theme.text : Theme.hotPink)
                                .frame(width: 42, height: 42)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 10)
                    .padding(.bottom, 14)

                    if isAttachmentPanelOpen {
                        ChatAttachmentPanel { option in
                            openAttachmentPicker(option)
                        }
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
                .background(Theme.background)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationBarBackButtonHidden(true)
            .navigationBarHidden(true)
            .toolbar(.hidden, for: .tabBar)
            .onAppear {
                store.markThreadRead(threadID: threadID)
            }
            .fullScreenCover(isPresented: $isPhotoLibraryPresented) {
                PhotoLibraryImportView(maxSelection: 9) { importedData in
                    for data in importedData {
                        _ = store.sendImageMessage(threadID: threadID, imageData: data)
                    }
                }
            }
            .sheet(isPresented: $isCameraPresented) {
                CameraCaptureView { data in
                    _ = store.sendImageMessage(threadID: threadID, imageData: data)
                }
                .ignoresSafeArea()
            }
            .simultaneousGesture(
                DragGesture(minimumDistance: 30)
                    .onEnded(handleExitSwipe)
            )
        } else {
            ContentUnavailableView("会话不存在", systemImage: "bubble.left")
        }
    }

    private func send() {
        if store.sendMessage(threadID: threadID, body: draft) {
            draft = ""
            isAttachmentPanelOpen = false
        }
    }

    private func activateNormalKeyboard() {
        isAttachmentPanelOpen = false
        prefersEmojiKeyboard = false
        isMessageFieldFocused = true
    }

    private func toggleAttachmentPanel() {
        prefersEmojiKeyboard = false
        isMessageFieldFocused = false
        hideKeyboard()
        DispatchQueue.main.async {
            hideKeyboard()
            withAnimation(.spring(response: 0.24, dampingFraction: 0.84)) {
                isAttachmentPanelOpen.toggle()
            }
        }
    }

    private func openAttachmentPicker(_ option: String) {
        prefersEmojiKeyboard = false
        isMessageFieldFocused = false
        withAnimation(AppMotion.quick) {
            isAttachmentPanelOpen = false
        }
        hideKeyboard()
        DispatchQueue.main.async {
            hideKeyboard()
            if option == "拍照" {
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    isCameraPresented = true
                } else {
                    store.showToast("当前设备不可用相机")
                }
            } else {
                isPhotoLibraryPresented = true
            }
        }
    }

    private func showsTimeSeparator(at index: Int, in messages: [DirectMessage]) -> Bool {
        guard index > 0 else { return true }
        return messages[index].createdAt.timeIntervalSince(messages[index - 1].createdAt) > 5 * 60
    }

    private func closeInputSurfaces() {
        hideKeyboard()
        isMessageFieldFocused = false
        prefersEmojiKeyboard = false
        withAnimation(AppMotion.quick) {
            isAttachmentPanelOpen = false
        }
    }

    private func handleExitSwipe(_ value: DragGesture.Value) {
        guard value.translation.width > 86,
              abs(value.translation.height) < 72 else { return }
        closeInputSurfaces()
        dismiss()
    }
}

enum ChatTimeSeparator {
    static func label(for date: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) {
            return timeFormatter.string(from: date)
        }
        if calendar.isDate(date, equalTo: Date(), toGranularity: .year) {
            return sameYearFormatter.string(from: date)
        }
        return fullFormatter.string(from: date)
    }

    private static let timeFormatter = makeFormatter("HH:mm")
    private static let sameYearFormatter = makeFormatter("MM-dd HH:mm")
    private static let fullFormatter = makeFormatter("yyyy-MM-dd HH:mm")

    private static func makeFormatter(_ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = format
        return formatter
    }
}

final class EmojiUITextField: UITextField {
    var prefersEmojiKeyboard = false

    override var textInputMode: UITextInputMode? {
        if prefersEmojiKeyboard,
           let emojiMode = UITextInputMode.activeInputModes.first(where: { $0.primaryLanguage == "emoji" }) {
            return emojiMode
        }
        return super.textInputMode
    }
}

struct EmojiMessageTextField: UIViewRepresentable {
    @Binding var text: String
    @Binding var isFocused: Bool
    @Binding var prefersEmojiKeyboard: Bool
    let placeholder: String
    let onTap: () -> Void
    let onSubmit: () -> Void

    func makeUIView(context: Context) -> EmojiUITextField {
        let textField = EmojiUITextField()
        textField.delegate = context.coordinator
        textField.borderStyle = .none
        textField.backgroundColor = .clear
        textField.textColor = Theme.primaryTextUIColor
        textField.tintColor = UIColor(red: 1, green: 0.12, blue: 0.27, alpha: 1)
        textField.font = UIFont.systemFont(ofSize: 19, weight: .semibold)
        textField.returnKeyType = .send
        textField.attributedPlaceholder = NSAttributedString(
            string: placeholder,
            attributes: [.foregroundColor: UIColor.secondaryLabel]
        )
        textField.addTarget(context.coordinator, action: #selector(Coordinator.textDidChange(_:)), for: .editingChanged)
        let tapRecognizer = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.textFieldTapped(_:)))
        tapRecognizer.cancelsTouchesInView = false
        textField.addGestureRecognizer(tapRecognizer)
        return textField
    }

    func updateUIView(_ uiView: EmojiUITextField, context: Context) {
        context.coordinator.parent = self
        if uiView.text != text {
            uiView.text = text
        }
        let shouldReloadInputViews = uiView.prefersEmojiKeyboard != prefersEmojiKeyboard
        uiView.prefersEmojiKeyboard = prefersEmojiKeyboard
        if isFocused && !uiView.isFirstResponder {
            uiView.becomeFirstResponder()
        } else if !isFocused && uiView.isFirstResponder {
            uiView.resignFirstResponder()
        }
        if shouldReloadInputViews && uiView.isFirstResponder {
            uiView.reloadInputViews()
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var parent: EmojiMessageTextField

        init(_ parent: EmojiMessageTextField) {
            self.parent = parent
        }

        @objc func textDidChange(_ textField: UITextField) {
            parent.text = textField.text ?? ""
        }

        @objc func textFieldTapped(_ recognizer: UITapGestureRecognizer) {
            parent.onTap()
            guard let textField = recognizer.view as? EmojiUITextField else { return }
            textField.prefersEmojiKeyboard = false
            if textField.isFirstResponder {
                textField.reloadInputViews()
            } else {
                textField.becomeFirstResponder()
            }
        }

        func textFieldShouldReturn(_ textField: UITextField) -> Bool {
            parent.onSubmit()
            return false
        }

        func textFieldDidBeginEditing(_ textField: UITextField) {
            parent.isFocused = true
        }

        func textFieldDidEndEditing(_ textField: UITextField) {
            parent.isFocused = false
        }
    }
}

struct ChatAttachmentPanel: View {
    let onSelect: (String) -> Void

    var body: some View {
        HStack(spacing: 28) {
            ChatAttachmentOption(title: "拍照", icon: "camera.fill") {
                onSelect("拍照")
            }
            ChatAttachmentOption(title: "相册", icon: "photo.on.rectangle") {
                onSelect("相册")
            }
            Spacer()
        }
        .padding(.horizontal, 28)
        .padding(.top, 26)
        .padding(.bottom, 34)
        .background(Theme.panel)
    }
}

struct ChatAttachmentOption: View {
    let title: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 31, weight: .semibold))
                    .foregroundStyle(Theme.text)
                    .frame(width: 82, height: 82)
                    .background(Theme.panelRaised, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                Text(title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Theme.subtext)
            }
        }
        .buttonStyle(.plain)
    }
}

struct ChatBubble: View {
    @EnvironmentObject private var store: MockAppStore
    @State private var previewImage: ChatImagePreviewItem?
    @State private var isLoadingPreview = false
    let threadID: String
    let message: DirectMessage

    var isMine: Bool { message.senderID == store.currentUserID }

    var body: some View {
        content
            .contextMenu {
                Button("删除") {
                    store.deleteMessage(threadID: threadID, messageID: message.id)
                }
                if store.canRevokeMessage(message) {
                    Button("撤回", role: .destructive) {
                        store.revokeMessage(threadID: threadID, messageID: message.id)
                    }
                }
            }
            .fullScreenCover(item: $previewImage) { item in
                ChatImagePreviewView(image: item.image)
                    .environmentObject(store)
            }
    }

    @ViewBuilder
    private var content: some View {
        if let sharedPostID = message.sharedPostID,
           let post = store.post(id: sharedPostID) {
            HStack(alignment: .top, spacing: 10) {
                if isMine { Spacer(minLength: 34) }
                if !isMine {
                    avatar(for: store.user(id: message.senderID), size: 36)
                }
                NavigationLink(value: Route.postDetail(post.id)) {
                    SharedPostMessageCard(post: post)
                }
                .buttonStyle(.plain)
                if isMine {
                    avatar(for: store.currentUser, size: 36)
                } else {
                    Spacer(minLength: 34)
                }
            }
        } else if let sharedProfileUserID = message.sharedProfileUserID,
                  let user = store.users.first(where: { $0.id == sharedProfileUserID }) {
            HStack(alignment: .top, spacing: 10) {
                if isMine { Spacer(minLength: 34) }
                if !isMine {
                    avatar(for: store.user(id: message.senderID), size: 36)
                }
                NavigationLink(value: Route.userProfile(user.id)) {
                    SharedProfileMessageCard(user: user)
                }
                .buttonStyle(.plain)
                if isMine {
                    avatar(for: store.currentUser, size: 36)
                } else {
                    Spacer(minLength: 34)
                }
            }
        } else if message.imageData != nil || !message.remoteImageURL.isEmpty {
            HStack(alignment: .bottom, spacing: 8) {
                if isMine { Spacer(minLength: 48) }
                if !isMine {
                    avatar(for: store.user(id: message.senderID), size: 34)
                }
                failureDecorated(messageImage)
                if isMine {
                    avatar(for: store.currentUser, size: 34)
                } else {
                    Spacer(minLength: 48)
                }
            }
        } else {
            HStack(alignment: .bottom, spacing: 8) {
                if isMine { Spacer(minLength: 48) }
                if !isMine {
                    avatar(for: store.user(id: message.senderID), size: 34)
                }
                failureDecorated(
                    Text(message.body)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 15)
                        .padding(.vertical, 11)
                        .background(isMine ? Theme.hotPink : Theme.panelRaised, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                )
                if isMine {
                    avatar(for: store.currentUser, size: 34)
                } else {
                    Spacer(minLength: 48)
                }
            }
        }
    }

    private var failureReasonText: String? {
        guard isMine else { return nil }
        switch message.deliveryStatus {
        case .failedBlockedByPeer: return "你已被对方拉黑，无法发送消息"
        case .failedBlockedPeer: return "你已拉黑对方，解除拉黑后才能发送"
        case .failedNetwork: return "发送失败，请稍后重试"
        case .sent: return nil
        }
    }

    @ViewBuilder
    private func failureDecorated<Bubble: View>(_ bubble: Bubble) -> some View {
        if let failureReasonText {
            VStack(alignment: .trailing, spacing: 5) {
                HStack(spacing: 8) {
                    Button {
                        store.retryFailedMessage(threadID: threadID, messageID: message.id)
                    } label: {
                        Image(systemName: "exclamationmark.circle.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(.red)
                    }
                    .buttonStyle(.plain)
                    bubble
                }
                Text(failureReasonText)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.red.opacity(0.85))
            }
        } else {
            bubble
        }
    }

    private var messageImage: some View {
        Button {
            openImagePreview()
        } label: {
            messageImageContent
                .overlay {
                    if isLoadingPreview {
                        ProgressView()
                            .tint(.white)
                            .frame(width: 42, height: 42)
                            .background(.black.opacity(0.34), in: Circle())
                    }
                }
        }
        .buttonStyle(.plain)
        .disabled(isLoadingPreview)
        .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    @ViewBuilder
    private var messageImageContent: some View {
        if let imageData = message.imageData {
            UploadedImageView(data: imageData)
                .scaledToFill()
                .frame(width: 184, height: 184)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Theme.hairline, lineWidth: 0.5)
                }
        } else if !message.remoteImageURL.isEmpty {
            RemoteImageView(urlString: message.remoteImageURL)
                .scaledToFill()
            .frame(width: 184, height: 184)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(Theme.hairline, lineWidth: 0.5)
            }
        }
    }

    private func avatar(for user: User, size: CGFloat) -> some View {
        NavigationLink(value: Route.userProfile(user.id)) {
            AvatarView(user: user, size: size)
        }
        .buttonStyle(.plain)
    }

    private func openImagePreview() {
        if let image = localPreviewImage() {
            previewImage = ChatImagePreviewItem(image: image)
            return
        }
        guard !message.remoteImageURL.isEmpty,
              let url = URL(string: message.remoteImageURL),
              !isLoadingPreview else {
            return
        }
        isLoadingPreview = true
        Task {
            do {
                let (data, response) = try await URLSession.shared.data(from: url)
                guard
                    let http = response as? HTTPURLResponse,
                    (200..<300).contains(http.statusCode),
                    let image = UIImage(data: data)
                else {
                    throw URLError(.badServerResponse)
                }
                await MainActor.run {
                    previewImage = ChatImagePreviewItem(image: image)
                    isLoadingPreview = false
                }
            } catch {
                await MainActor.run {
                    isLoadingPreview = false
                    store.showToast("图片加载失败")
                }
            }
        }
    }

    private func localPreviewImage() -> UIImage? {
        guard let imageData = message.imageData else { return nil }
        return UIImage(data: imageData)
    }
}

private struct ChatImagePreviewItem: Identifiable {
    let id = UUID()
    let image: UIImage
}

private struct ChatImagePreviewView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var isSavingImage = false
    @State private var hasSavedImage = false
    @State private var showsSaveConfirmation = false
    let image: UIImage

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(.horizontal, 10)

            VStack {
                HStack {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                            .background(.white.opacity(0.14), in: Circle())
                    }
                    .buttonStyle(.plain)

                    Spacer()

                    Button {
                        saveImage()
                    } label: {
                        Label(saveButtonTitle, systemImage: saveButtonIcon)
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 16)
                            .frame(height: 44)
                            .background(.white.opacity(0.14), in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(isSavingImage || hasSavedImage)
                    .opacity(hasSavedImage ? 0.68 : 1)
                }
                .padding(.horizontal, 18)
                .padding(.top, 14)

                Spacer()
            }

            if showsSaveConfirmation {
                Text("已保存至系统相册")
                    .font(.system(size: 17, weight: .black))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 24)
                    .frame(height: 52)
                    .background(.black.opacity(0.72), in: Capsule())
                    .overlay {
                        Capsule()
                            .stroke(.white.opacity(0.14), lineWidth: 0.5)
                    }
                    .transition(.scale(scale: 0.94).combined(with: .opacity))
            }
        }
    }

    private var saveButtonTitle: String {
        if isSavingImage {
            return "保存中"
        }
        if hasSavedImage {
            return "已保存"
        }
        return "保存"
    }

    private var saveButtonIcon: String {
        if hasSavedImage {
            return "checkmark.circle.fill"
        }
        return "square.and.arrow.down"
    }

    private func saveImage() {
        guard !isSavingImage, !hasSavedImage else { return }
        isSavingImage = true
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                Task { @MainActor in
                    isSavingImage = false
                    store.showToast("请允许访问相册后保存图片")
                }
                return
            }
            PHPhotoLibrary.shared().performChanges {
                PHAssetChangeRequest.creationRequestForAsset(from: image)
            } completionHandler: { success, _ in
                Task { @MainActor in
                    isSavingImage = false
                    if success {
                        hasSavedImage = true
                        showSaveConfirmation()
                    } else {
                        store.showToast("保存失败")
                    }
                }
            }
        }
    }

    private func showSaveConfirmation() {
        withAnimation(.easeOut(duration: 0.16)) {
            showsSaveConfirmation = true
        }
        Task {
            try? await Task.sleep(nanoseconds: 1_450_000_000)
            await MainActor.run {
                withAnimation(.easeIn(duration: 0.18)) {
                    showsSaveConfirmation = false
                }
            }
        }
    }
}

struct SharedPostMessageCard: View {
    @EnvironmentObject private var store: MockAppStore
    let post: GroupBuyPost

    var body: some View {
        let author = store.user(id: post.authorID)
        VStack(alignment: .leading, spacing: 0) {
            PostImageView(post: post)
                .scaledToFill()
                .frame(width: 250, height: 250)
                .clipped()
                .overlay(alignment: .topTrailing) {
                    Image(systemName: "play.fill")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 46, height: 46)
                        .background(.black.opacity(0.28), in: Circle())
                        .padding(12)
                }
            VStack(alignment: .leading, spacing: 12) {
                Text(post.title)
                    .font(.system(size: 24, weight: .black))
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 8) {
                    AvatarView(user: author, size: 28)
                    Text(author.nickname)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Theme.subtext)
                        .lineLimit(1)
                }
            }
            .padding(16)
            .frame(width: 250, alignment: .leading)
            .background(Theme.panel)
        }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .stroke(Theme.hairline, lineWidth: 0.5)
        }
    }
}

struct SharedProfileMessageCard: View {
    @EnvironmentObject private var store: MockAppStore
    let user: User

    var body: some View {
        let noteCount = store.posts.filter { $0.authorID == user.id && $0.status == .active }.count
        VStack(spacing: 0) {
            UserBackgroundImage(user: user)
                .scaledToFill()
                .frame(width: 280, height: 126)
                .clipped()
                .overlay(.black.opacity(0.16))

            VStack(spacing: 10) {
                AvatarView(user: user, size: 72)
                    .background(Theme.panel, in: Circle())
                    .padding(.top, -42)

                Text(user.nickname)
                    .font(.system(size: 24, weight: .black))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)

                Text("制品 · \(noteCount)  |  粉丝 · \(store.followerUsers(for: user.id).count)")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Theme.subtext)

                Text(user.bio == "点击这里，填写简介" ? "这个人还没有填写简介" : user.bio)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.subtext)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity)

                Text("去看看")
                    .font(.system(size: 17, weight: .black))
                    .foregroundStyle(Theme.hotPink)
                    .padding(.horizontal, 26)
                    .padding(.vertical, 9)
                    .overlay {
                        Capsule().stroke(Theme.hotPink, lineWidth: 1)
                    }
                    .padding(.top, 4)
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 18)
            .frame(width: 280)
            .background(Theme.panel)
        }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .stroke(Theme.hairline, lineWidth: 0.5)
        }
    }
}
