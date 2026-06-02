import SwiftUI
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
                            VStack(alignment: .leading, spacing: 3) {
                                Text(peer.nickname)
                                    .font(.system(size: 23, weight: .bold))
                                    .foregroundStyle(Theme.text)
                                Text("20分钟内在线")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(Theme.subtext)
                            }
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
                            Text("05-03 23:26")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundStyle(Theme.muted)
                                .padding(.top, 18)

                            ForEach(Array(visibleMessages.enumerated()), id: \.element.id) { index, message in
                                if index == 2 {
                                    Text("05-04 15:36")
                                        .font(.system(size: 18, weight: .semibold))
                                        .foregroundStyle(Theme.muted)
                                        .padding(.top, 10)
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
                messageImage
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
                Text(message.body)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 15)
                    .padding(.vertical, 11)
                    .background(isMine ? Theme.hotPink : Theme.panelRaised, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                if isMine {
                    avatar(for: store.currentUser, size: 34)
                } else {
                    Spacer(minLength: 48)
                }
            }
        }
    }

    @ViewBuilder
    private var messageImage: some View {
        if let imageData = message.imageData {
            UploadedImageView(data: imageData)
                .scaledToFill()
                .frame(width: 184, height: 184)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Theme.hairline, lineWidth: 0.5)
                }
        } else if let url = URL(string: message.remoteImageURL) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFill()
                case .failure:
                    Image(systemName: "photo")
                        .font(.system(size: 34, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Theme.panelRaised)
                case .empty:
                    ProgressView()
                        .tint(Theme.hotPink)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Theme.panelRaised)
                @unknown default:
                    EmptyView()
                }
            }
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
