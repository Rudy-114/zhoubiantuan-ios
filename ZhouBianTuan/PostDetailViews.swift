import SwiftUI
import UIKit

struct PostDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var commentDraft = ""
    @State private var replyTargetCommentID: String?
    @State private var actionCommentID: String?
    @State private var isShareSheetPresented = false
    @State private var isAuthorProfilePresented = false
    @State private var selectedImageIndex = 0
    let postID: String

    var body: some View {
        if let post = store.post(id: postID) {
            let author = store.user(id: post.authorID)
            let imageCount = max(1, max(post.remoteImageURLs.count, post.uploadedImageData.isEmpty ? post.imageNames.count : post.uploadedImageData.count))
            let detailImageHeight = imageHeight(for: post, index: 0)
            VStack(spacing: 0) {
                DetailTopBar(post: post, author: author, isShareSheetPresented: $isShareSheetPresented)
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 0) {
                        TabView(selection: $selectedImageIndex) {
                            ForEach(0..<imageCount, id: \.self) { index in
                                PostDetailImagePage(
                                    post: post,
                                    index: index,
                                    canvasWidth: UIScreen.main.bounds.width,
                                    canvasHeight: detailImageHeight
                                )
                                .tag(index)
                            }
                        }
                        .frame(height: detailImageHeight)
                        .tabViewStyle(.page(indexDisplayMode: .automatic))

                        VStack(alignment: .leading, spacing: 18) {
                            VStack(alignment: .leading, spacing: 10) {
                                Text(post.title)
                                    .font(.system(size: 28, weight: .bold))
                                    .foregroundStyle(Theme.text)
                                    .fixedSize(horizontal: false, vertical: true)
                                ModerationInlineNotice(status: post.status, reason: post.moderationReason)
                                Text(post.description)
                                    .font(.system(size: 17, weight: .regular))
                                    .lineSpacing(6)
                                    .foregroundStyle(Theme.text.opacity(0.82))
                            }

                            TagCloud(tags: post.categoryTags + post.fandomTags)

                            GroupBuyInfoCard(post: post)
                            if post.groupType == .splitGoods {
                                PingguRoleAvailabilityCard(postID: post.id)
                            }
                            ContactCard(post: post)
                            CommentSection(postID: post.id, commentDraft: $commentDraft, replyTargetCommentID: $replyTargetCommentID, actionCommentID: $actionCommentID)
                        }
                        .padding(18)
                    }
                    .padding(.bottom, 20)
                }
                .scrollDismissesKeyboard(.interactively)
                .onTapGesture {
                    hideKeyboard()
                }
            }
            .background(Theme.background.ignoresSafeArea())
            .safeAreaInset(edge: .bottom) {
                DetailActionBar(post: post, commentDraft: $commentDraft, replyTargetCommentID: $replyTargetCommentID)
            }
            .overlay {
                if let actionComment = actionCommentID.flatMap(store.comment(id:)) {
                    CommentActionOverlay(
                        comment: actionComment,
                        onDismiss: {
                            withAnimation(.easeInOut(duration: 0.18)) {
                                actionCommentID = nil
                            }
                        },
                        onReply: {
                            replyTargetCommentID = actionComment.id
                            commentDraft = ""
                            withAnimation(.easeInOut(duration: 0.18)) {
                                actionCommentID = nil
                            }
                            store.showToast("正在回复 \(store.user(id: actionComment.authorID).nickname)")
                        },
                        onCopy: {
                            store.copyComment(actionComment)
                            withAnimation(.easeInOut(duration: 0.18)) {
                                actionCommentID = nil
                            }
                        },
                        onDelete: {
                            if replyTargetCommentID == actionComment.id {
                                replyTargetCommentID = nil
                            }
                            store.deleteComment(commentID: actionComment.id)
                            withAnimation(.easeInOut(duration: 0.18)) {
                                actionCommentID = nil
                            }
                        }
                    )
                    .transition(.opacity)
                }
            }
            .sheet(isPresented: $isShareSheetPresented) {
                ShareSheetView(post: post)
                    .presentationDetents([.height(440), .large])
                    .presentationDragIndicator(.hidden)
            }
            .onAppear {
                store.recordBrowse(postID: post.id)
            }
            .navigationBarBackButtonHidden(true)
            .navigationBarHidden(true)
            .toolbar(.hidden, for: .tabBar)
            .onChange(of: imageCount) {
                selectedImageIndex = min(selectedImageIndex, max(0, imageCount - 1))
            }
            .navigationDestination(isPresented: $isAuthorProfilePresented) {
                UserProfileView(userID: author.id)
            }
            .simultaneousGesture(
                DragGesture(minimumDistance: 30)
                    .onEnded { value in
                        handleDetailSwipe(value, authorID: author.id)
                    }
            )
        } else {
            ContentUnavailableView("内容不存在", systemImage: "exclamationmark.triangle", description: Text("这条团购可能已下架或被隐藏。"))
                .background(Theme.background)
        }
    }

    private func imageHeight(for post: GroupBuyPost, index: Int) -> CGFloat {
        let screenWidth = UIScreen.main.bounds.width
        let aspect = imageAspect(for: post, index: index)
        return screenWidth / max(0.28, aspect)
    }

    private func imageAspect(for post: GroupBuyPost, index: Int) -> CGFloat {
        if post.remoteImageURLs.indices.contains(index) {
            return CGFloat(max(0.28, post.imageAspect))
        }
        if post.uploadedImageData.indices.contains(index),
           let image = UIImage(data: post.uploadedImageData[index]),
           image.size.width > 0,
           image.size.height > 0 {
            return image.size.width / image.size.height
        }
        return CGFloat(max(0.28, post.imageAspect))
    }

    private func handleDetailSwipe(_ value: DragGesture.Value, authorID: String) {
        guard abs(value.translation.height) < 72 else { return }
        if value.translation.width > 92 {
            dismiss()
        } else if value.translation.width < -92 {
            hideKeyboard()
            withAnimation(AppMotion.page) {
                isAuthorProfilePresented = true
            }
        }
    }
}

struct PostDetailImagePage: View {
    let post: GroupBuyPost
    let index: Int
    let canvasWidth: CGFloat
    let canvasHeight: CGFloat

    var body: some View {
        ZStack {
            Theme.background
            PostImageView(post: post, index: index)
                .scaledToFit()
                .frame(width: canvasWidth, height: canvasHeight)
        }
        .frame(width: canvasWidth, height: canvasHeight)
        .clipped()
        .background(Theme.background)
    }
}

struct DetailTopBar: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    let post: GroupBuyPost
    let author: User
    @Binding var isShareSheetPresented: Bool

    var body: some View {
        HStack(spacing: 12) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 24, weight: .semibold))
                    .frame(width: 42, height: 42)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.text)

            NavigationLink(value: Route.userProfile(author.id)) {
                HStack(spacing: 10) {
                    AvatarView(user: author, size: 48)
                    Text(author.nickname)
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(Theme.text)
                }
            }
            .buttonStyle(.plain)

            Spacer()
            Button {
                store.toggleFollow(userID: author.id)
            } label: {
                Text(store.followedUserIDs.contains(author.id) ? "已关注" : "关注")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(store.followedUserIDs.contains(author.id) ? Theme.subtext : Theme.hotPink)
                    .padding(.horizontal, 22)
                    .padding(.vertical, 10)
                    .overlay {
                        Capsule().stroke(store.followedUserIDs.contains(author.id) ? Theme.hairline : Theme.hotPink, lineWidth: 1)
                    }
            }
            .buttonStyle(.plain)

            Button {
                if store.requireLogin(prompt: "登录后才能分享") {
                    isShareSheetPresented = true
                }
            } label: {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 24, weight: .semibold))
                    .frame(width: 42, height: 42)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.text)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Theme.background)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.hairline).frame(height: 0.5)
        }
    }
}

struct ShareSheetView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var isRecipientPickerPresented = false
    let post: GroupBuyPost

    var stationThreads: [MessageThread] {
        Array(store.messageThreads.prefix(3))
    }

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(Theme.hairline)
                .frame(width: 44, height: 5)
                .padding(.top, 10)

            HStack {
                Spacer()
                Text("分享至")
                    .font(.system(size: 24, weight: .black))
                    .foregroundStyle(Theme.text)
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundStyle(Theme.text)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 18)
            .padding(.top, 12)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 22) {
                    ForEach(stationThreads) { thread in
                        let friend = store.user(id: store.peerUserID(for: thread))
                        Button {
                            store.sharePostToThread(postID: post.id, threadID: thread.id)
                            dismiss()
                        } label: {
                            VStack(spacing: 8) {
                                AvatarView(user: friend, size: 66)
                                Text(friend.nickname)
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Theme.subtext)
                                    .lineLimit(1)
                                    .frame(width: 82)
                                Text("20分钟内在线")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(Theme.muted)
                                    .lineLimit(1)
                            }
                        }
                        .buttonStyle(.plain)
                    }

                    Button {
                        store.showToast("已打开邀请好友占位")
                    } label: {
                        VStack(spacing: 8) {
                            Image(systemName: "person.crop.circle.badge.plus")
                                .font(.system(size: 32, weight: .semibold))
                                .foregroundStyle(Theme.text)
                                .frame(width: 66, height: 66)
                                .background(Theme.panelRaised, in: Circle())
                            Text("邀请好友")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(Theme.subtext)
                                .frame(width: 82)
                            Text(" ")
                                .font(.system(size: 12))
                        }
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 24)
                .padding(.top, 10)
                .padding(.bottom, 18)
            }

            Divider().overlay(Theme.hairline)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 26) {
                    ShareOptionButton(title: "私信好友", icon: "paperplane.fill", color: Theme.hotPink) {
                        isRecipientPickerPresented = true
                    }
                    ShareOptionButton(title: "微信好友", icon: "bubble.left.and.bubble.right.fill", color: Color(red: 0.05, green: 0.76, blue: 0.32)) {
                        store.showToast("已唤起微信分享占位")
                    }
                    ShareOptionButton(title: "朋友圈", icon: "camera.aperture", color: Color(red: 0.35, green: 0.84, blue: 0.05)) {
                        store.showToast("已唤起朋友圈分享占位")
                    }
                    ShareOptionButton(title: "QQ 好友", icon: "person.crop.circle.fill", color: Color(red: 0.09, green: 0.68, blue: 0.9)) {
                        store.showToast("已唤起 QQ 分享占位")
                    }
                    ShareOptionButton(title: "QQ 空间", icon: "star.fill", color: Color(red: 1, green: 0.79, blue: 0.03)) {
                        store.showToast("已唤起 QQ 空间占位")
                    }
                    ShareOptionButton(title: "微博", icon: "eye.fill", color: Color(red: 0.93, green: 0.06, blue: 0.04)) {
                        store.showToast("已唤起微博分享占位")
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 20)
            }

            Divider().overlay(Theme.hairline)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 26) {
                    ShareUtilityButton(title: "问点点", icon: "bubble.left") {
                        store.showToast("已打开问答占位")
                    }
                    ShareUtilityButton(title: "复制链接", icon: "link") {
                        store.copyToPasteboard("zhoubiantuan://post/\(post.id)", label: "站内链接")
                    }
                    ShareUtilityButton(title: "生成分享图", icon: "photo") {
                        store.showToast("已生成分享图占位")
                    }
                    ShareUtilityButton(title: "引用发制品", icon: "quote.bubble") {
                        store.showToast("已带引用进入发布占位")
                    }
                    ShareUtilityButton(title: "建群分享", icon: "person.2") {
                        store.showToast("已打开建群分享占位")
                    }
                    ShareUtilityButton(title: "保存图片", icon: "square.and.arrow.down") {
                        store.showToast("已保存分享图占位")
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 20)
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .fullScreenCover(isPresented: $isRecipientPickerPresented) {
            ShareRecipientPickerView(primaryUserID: post.authorID) { user in
                store.sharePostToUser(postID: post.id, userID: user.id)
                dismiss()
            }
        }
    }
}

struct ShareRecipientSection: Identifiable {
    let title: String
    let users: [User]

    var id: String { title }
}

struct ShareRecipientPickerView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var query = ""
    let primaryUserID: String?
    let onSelect: (User) -> Void

    var sections: [ShareRecipientSection] {
        let following = store.followingUsers(for: store.currentUserID)
        let mutual = following.filter { user in
            store.followingUsers(for: user.id).contains { $0.id == store.currentUserID }
        }
        let recent = uniqueUsers(
            store.messageThreads
                .map { store.user(id: store.peerUserID(for: $0)) }
        )
        let allFollowed = uniqueUsers(following)
        var groups: [ShareRecipientSection] = []

        if let primaryUserID {
            let primary = uniqueUsers([store.user(id: primaryUserID)])
            groups.append(ShareRecipientSection(title: "作者", users: primary))
        }
        groups.append(ShareRecipientSection(title: "最近聊天", users: recent))
        groups.append(ShareRecipientSection(title: "互相关注", users: uniqueUsers(mutual)))
        groups.append(ShareRecipientSection(title: "全部关注", users: allFollowed))

        return groups
            .map { ShareRecipientSection(title: $0.title, users: filtered($0.users)) }
            .filter { !$0.users.isEmpty }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button {
                    dismiss()
                } label: {
                    Text("取消")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(Theme.text)
                        .frame(width: 72, alignment: .leading)
                }
                .buttonStyle(.plain)

                Spacer()
                Text("分享至")
                    .font(.system(size: 22, weight: .black))
                    .foregroundStyle(Theme.text)
                Spacer()
                Color.clear.frame(width: 72, height: 1)
            }
            .padding(.horizontal, 18)
            .padding(.top, 20)
            .padding(.bottom, 18)

            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 22, weight: .medium))
                    .foregroundStyle(Theme.muted)
                TextField("搜索", text: $query)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Theme.text)
                    .textInputAutocapitalization(.never)
            }
            .padding(.horizontal, 16)
            .frame(height: 52)
            .background(Theme.panel, in: Capsule())
            .padding(.horizontal, 18)
            .padding(.bottom, 22)

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(sections) { section in
                        Text(section.title)
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(Theme.muted)
                            .padding(.horizontal, 18)
                            .padding(.top, 18)
                            .padding(.bottom, 10)
                        ForEach(section.users) { user in
                            Button {
                                onSelect(user)
                                dismiss()
                            } label: {
                                ShareRecipientRow(user: user)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.bottom, 40)
            }
        }
        .background(Theme.background.ignoresSafeArea())
    }

    private func filtered(_ users: [User]) -> [User] {
        let trimmedQuery = query.trimmed
        guard !trimmedQuery.isEmpty else { return users }
        return users.filter {
            $0.nickname.localizedCaseInsensitiveContains(trimmedQuery) ||
            store.registrationID(for: $0.id).contains(trimmedQuery)
        }
    }

    private func uniqueUsers(_ users: [User]) -> [User] {
        var seen = Set<String>()
        return users.filter { user in
            guard user.id != store.currentUserID else { return false }
            return seen.insert(user.id).inserted
        }
    }
}

struct ShareRecipientRow: View {
    let user: User

    var body: some View {
        HStack(spacing: 16) {
            Circle()
                .stroke(Theme.subtext.opacity(0.5), lineWidth: 2)
                .frame(width: 32, height: 32)
            AvatarView(user: user, size: 58)
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(user.nickname)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text("20 分钟内在线")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Theme.hairline)
                .frame(height: 0.5)
                .padding(.leading, 126)
        }
    }
}

struct ProfileShareSheetView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var isRecipientPickerPresented = false
    let user: User

    var stationThreads: [MessageThread] {
        Array(store.messageThreads.prefix(3))
    }

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(Theme.hairline)
                .frame(width: 44, height: 5)
                .padding(.top, 10)

            HStack {
                Spacer()
                Text("分享至")
                    .font(.system(size: 24, weight: .black))
                    .foregroundStyle(Theme.text)
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundStyle(Theme.text)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 18)
            .padding(.top, 12)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 22) {
                    ForEach(stationThreads) { thread in
                        let friend = store.user(id: store.peerUserID(for: thread))
                        Button {
                            store.shareProfileToThread(userID: user.id, threadID: thread.id)
                            dismiss()
                        } label: {
                            VStack(spacing: 8) {
                                AvatarView(user: friend, size: 66)
                                Text(friend.nickname)
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Theme.subtext)
                                    .lineLimit(1)
                                    .frame(width: 82)
                                Text("20分钟内在线")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(Theme.muted)
                                    .lineLimit(1)
                            }
                        }
                        .buttonStyle(.plain)
                    }

                    Button {
                        store.showToast("已打开邀请好友占位")
                    } label: {
                        VStack(spacing: 8) {
                            Image(systemName: "person.crop.circle.badge.plus")
                                .font(.system(size: 32, weight: .semibold))
                                .foregroundStyle(Theme.text)
                                .frame(width: 66, height: 66)
                                .background(Theme.panelRaised, in: Circle())
                            Text("邀请好友")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(Theme.subtext)
                                .frame(width: 82)
                            Text(" ")
                                .font(.system(size: 12))
                        }
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 24)
                .padding(.top, 10)
                .padding(.bottom, 18)
            }

            Divider().overlay(Theme.hairline)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 26) {
                    ShareOptionButton(title: "私信好友", icon: "paperplane.fill", color: Theme.hotPink) {
                        isRecipientPickerPresented = true
                    }
                    ShareOptionButton(title: "微信好友", icon: "bubble.left.and.bubble.right.fill", color: Color(red: 0.05, green: 0.76, blue: 0.32)) {
                        store.showToast("已唤起微信分享占位")
                    }
                    ShareOptionButton(title: "朋友圈", icon: "camera.aperture", color: Color(red: 0.35, green: 0.84, blue: 0.05)) {
                        store.showToast("已唤起朋友圈分享占位")
                    }
                    ShareOptionButton(title: "QQ 好友", icon: "person.crop.circle.fill", color: Color(red: 0.09, green: 0.68, blue: 0.9)) {
                        store.showToast("已唤起 QQ 分享占位")
                    }
                    ShareOptionButton(title: "QQ 空间", icon: "star.fill", color: Color(red: 1, green: 0.79, blue: 0.03)) {
                        store.showToast("已唤起 QQ 空间占位")
                    }
                    ShareOptionButton(title: "微博", icon: "eye.fill", color: Color(red: 0.93, green: 0.06, blue: 0.04)) {
                        store.showToast("已唤起微博分享占位")
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 20)
            }

            Divider().overlay(Theme.hairline)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 26) {
                    ShareUtilityButton(title: "复制链接", icon: "link") {
                        store.copyToPasteboard("zhoubiantuan://profile/\(user.id)", label: "主页链接")
                    }
                    ShareUtilityButton(title: "生成分享图", icon: "photo") {
                        store.showToast("已生成主页分享图占位")
                    }
                    ShareUtilityButton(title: "保存图片", icon: "square.and.arrow.down") {
                        store.showToast("已保存主页分享图占位")
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 20)
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .fullScreenCover(isPresented: $isRecipientPickerPresented) {
            ShareRecipientPickerView(primaryUserID: user.id) { recipient in
                store.shareProfileToUser(profileUserID: user.id, recipientUserID: recipient.id)
                dismiss()
            }
        }
    }
}

struct ShareOptionButton: View {
    let title: String
    let icon: String
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 74, height: 74)
                    .background(color, in: Circle())
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.subtext)
                    .frame(width: 86)
                    .lineLimit(1)
            }
        }
        .buttonStyle(.plain)
    }
}

struct ShareUtilityButton: View {
    let title: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 27, weight: .semibold))
                    .foregroundStyle(Theme.text)
                    .frame(width: 74, height: 74)
                    .background(Theme.panelRaised, in: Circle())
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.subtext)
                    .frame(width: 88)
                    .lineLimit(1)
            }
        }
        .buttonStyle(.plain)
    }
}

struct GroupBuyInfoCard: View {
    @EnvironmentObject private var store: MockAppStore
    let post: GroupBuyPost

    var body: some View {
        let collection = store.collection(id: post.collectionID)
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("团购信息", systemImage: "bag.badge.plus")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Theme.text)
                Spacer()
                Text(post.groupType.rawValue)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(post.groupType.accent)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(post.groupType.accent.opacity(0.12), in: Capsule())
            }
            if let collection {
                InfoRow(title: "拼团合集", value: collection.name)
                InfoRow(title: "合集说明", value: collection.defaultNote)
            }
            InfoRow(title: "成团状态", value: post.isFormed ? "已成团" : "待成团")
            InfoRow(title: "商品价格", value: post.price)
            InfoRow(title: "定金比例", value: post.deposit)
            InfoRow(title: "截团时间", value: (collection?.deadline ?? post.deadline).fullDisplay)
            InfoRow(title: "成团条件", value: post.condition)
            InfoRow(title: "外部表单", value: post.externalLink.isEmpty ? "无，联系团长登记" : post.externalLink)
        }
        .padding(16)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8).stroke(Theme.hairline, lineWidth: 0.5)
        }
    }
}

struct PingguRoleAvailabilityCard: View {
    @EnvironmentObject private var store: MockAppStore
    @State private var isEditing = false
    @State private var newRoleName = ""
    @State private var newRoleQuantity = "1"
    @State private var newRolePriceAdjustment = ""
    let postID: String

    var body: some View {
        if let post = store.post(id: postID) {
            let isOwner = post.authorID == store.currentUserID
            let roles = isEditing ? post.unsoldRoles : store.availableRoles(for: postID)
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Label("未被购买角色", systemImage: "person.crop.rectangle.stack.fill")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(Theme.text)
                    Spacer()
                    if isOwner {
                        Button {
                            withAnimation(.spring(response: 0.3, dampingFraction: 0.86)) {
                                isEditing.toggle()
                            }
                        } label: {
                            Text(isEditing ? "完成" : "编辑")
                                .font(.system(size: 14, weight: .black))
                                .foregroundStyle(post.groupType.accent)
                        }
                        .buttonStyle(.plain)
                    }
                }

                if !post.pingguAveragePrice.isEmpty || !post.pingguNote.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        if !post.pingguAveragePrice.isEmpty {
                            Text(post.pingguAveragePrice)
                                .font(.system(size: 17, weight: .black))
                                .foregroundStyle(post.groupType.accent)
                        }
                        if !post.pingguNote.isEmpty {
                            Text(post.pingguNote)
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Theme.subtext)
                        }
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(post.groupType.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }

                if roles.isEmpty {
                    Text(isEditing ? "还没有录入角色，添加后会出现在拼谷搜索里。" : "当前没有可购买角色。")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 8)
                } else {
                    VStack(spacing: 8) {
                        ForEach(roles) { role in
                            if isEditing {
                                EditableRoleRow(postID: postID, role: role)
                            } else {
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(role.name)
                                            .font(.system(size: 16, weight: .bold))
                                            .foregroundStyle(Theme.text)
                                        if role.priceAdjustment != 0 {
                                            Text("角色调价 \(role.priceAdjustmentText)")
                                                .font(.system(size: 12, weight: .black))
                                                .foregroundStyle(post.groupType.accent)
                                        }
                                    }
                                    Spacer()
                                    Text("(\(role.quantity))")
                                        .font(.system(size: 16, weight: .black))
                                        .foregroundStyle(post.groupType.accent)
                                }
                                .padding(12)
                                .background(Theme.panelRaised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            }
                        }
                    }
                }

                if isOwner && isEditing {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("添加角色")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(Theme.subtext)
                        HStack(spacing: 8) {
                            TextField("角色名", text: $newRoleName)
                                .foregroundStyle(Theme.text)
                                .padding(12)
                                .background(Theme.panelRaised, in: RoundedRectangle(cornerRadius: 8))
                            TextField("数量", text: $newRoleQuantity)
                                .keyboardType(.numberPad)
                                .foregroundStyle(Theme.text)
                                .frame(width: 66)
                                .padding(12)
                                .background(Theme.panelRaised, in: RoundedRectangle(cornerRadius: 8))
                            TextField("调价", text: $newRolePriceAdjustment)
                                .keyboardType(.numbersAndPunctuation)
                                .foregroundStyle(Theme.text)
                                .frame(width: 76)
                                .padding(12)
                                .background(Theme.panelRaised, in: RoundedRectangle(cornerRadius: 8))
                            Button {
                                store.addUnsoldRole(postID: postID, name: newRoleName, quantity: Int(newRoleQuantity) ?? 1, priceAdjustment: parsePriceAdjustment(newRolePriceAdjustment))
                                newRoleName = ""
                                newRoleQuantity = "1"
                                newRolePriceAdjustment = ""
                            } label: {
                                Image(systemName: "plus")
                                    .font(.system(size: 17, weight: .black))
                                    .foregroundStyle(.white)
                                    .frame(width: 44, height: 44)
                                    .background(post.groupType.accent, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.top, 4)
                }

                if !isOwner {
                    Text("只有团长可维护角色余量。")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                }
            }
            .padding(16)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8).stroke(post.groupType.accent.opacity(0.28), lineWidth: 1)
            }
        }
    }
}

struct EditableRoleRow: View {
    @EnvironmentObject private var store: MockAppStore
    let postID: String
    let role: UnsoldRole

    var nameBinding: Binding<String> {
        Binding(
            get: { store.post(id: postID)?.unsoldRoles.first(where: { $0.id == role.id })?.name ?? role.name },
            set: { newValue in
                let quantity = store.post(id: postID)?.unsoldRoles.first(where: { $0.id == role.id })?.quantity ?? role.quantity
                let adjustment = store.post(id: postID)?.unsoldRoles.first(where: { $0.id == role.id })?.priceAdjustment ?? role.priceAdjustment
                store.updateUnsoldRole(postID: postID, roleID: role.id, name: newValue, quantity: quantity, priceAdjustment: adjustment)
            }
        )
    }

    var quantityBinding: Binding<Int> {
        Binding(
            get: { store.post(id: postID)?.unsoldRoles.first(where: { $0.id == role.id })?.quantity ?? role.quantity },
            set: { newValue in
                let name = store.post(id: postID)?.unsoldRoles.first(where: { $0.id == role.id })?.name ?? role.name
                let adjustment = store.post(id: postID)?.unsoldRoles.first(where: { $0.id == role.id })?.priceAdjustment ?? role.priceAdjustment
                store.updateUnsoldRole(postID: postID, roleID: role.id, name: name, quantity: newValue, priceAdjustment: adjustment)
            }
        )
    }

    var adjustmentBinding: Binding<String> {
        Binding(
            get: {
                let adjustment = store.post(id: postID)?.unsoldRoles.first(where: { $0.id == role.id })?.priceAdjustment ?? role.priceAdjustment
                return formatPlainAmount(adjustment)
            },
            set: { newValue in
                let current = store.post(id: postID)?.unsoldRoles.first(where: { $0.id == role.id }) ?? role
                store.updateUnsoldRole(
                    postID: postID,
                    roleID: role.id,
                    name: current.name,
                    quantity: current.quantity,
                    priceAdjustment: parsePriceAdjustment(newValue)
                )
            }
        )
    }

    var body: some View {
        HStack(spacing: 10) {
            TextField("角色名", text: nameBinding)
                .foregroundStyle(Theme.text)
                .padding(11)
                .background(Theme.panelRaised, in: RoundedRectangle(cornerRadius: 8))
            Stepper(value: quantityBinding, in: 0...99) {
                Text("\(quantityBinding.wrappedValue)")
                    .font(.system(size: 16, weight: .black))
                    .foregroundStyle(quantityBinding.wrappedValue > 0 ? Color(red: 0.25, green: 0.78, blue: 0.72) : Theme.muted)
            }
            .labelsHidden()
            .frame(width: 100)
            TextField("调价", text: adjustmentBinding)
                .keyboardType(.numbersAndPunctuation)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Theme.text)
                .frame(width: 72)
                .padding(11)
                .background(Theme.panelRaised, in: RoundedRectangle(cornerRadius: 8))
            Button {
                store.removeUnsoldRole(postID: postID, roleID: role.id)
            } label: {
                Image(systemName: "trash")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Theme.hotPink)
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
        }
    }
}

struct ContactCard: View {
    @EnvironmentObject private var store: MockAppStore
    @State private var chatThreadID: String?
    let post: GroupBuyPost

    var body: some View {
        let collection = store.collection(id: post.collectionID)
        let wechat = collection?.contactWechat ?? post.wechat
        let qq = collection?.contactQQ ?? post.qq
        let groupInfo = collection?.groupInfo ?? post.groupInfo
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("联系团长", systemImage: "person.crop.circle.badge.questionmark")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Theme.text)
                Spacer()
                Text(collection == nil ? "外部交易" : "合集共享")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.hotPink)
            }
            Text("站内仅展示信息和咨询入口，不承接支付、订单、退款、物流或售后。正式交易请在微信、QQ、群聊等外部平台完成。")
                .font(.system(size: 13))
                .lineSpacing(3)
                .foregroundStyle(Theme.subtext)

            VStack(spacing: 10) {
                HStack(spacing: 10) {
                    ContactButton(title: "复制微信", icon: "doc.on.doc.fill") {
                        store.copyToPasteboard(wechat, label: "微信")
                    }
                    ContactButton(title: "复制 QQ", icon: "number") {
                        store.copyToPasteboard(qq, label: "QQ")
                    }
                }
                HStack(spacing: 10) {
                    ContactButton(title: "加入群聊", icon: "person.3.fill") {
                        store.copyToPasteboard(groupInfo, label: "群聊信息")
                    }
                    ContactButton(title: "私信咨询", icon: "bubble.left.and.text.bubble.right.fill") {
                        chatThreadID = store.consultationThreadID(for: post.id)
                    }
                }
            }
        }
        .padding(16)
        .background(Theme.panelRaised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .background {
            NavigationLink(
                destination: Group {
                    if let chatThreadID {
                        ChatView(threadID: chatThreadID)
                    }
                },
                isActive: Binding(
                    get: { chatThreadID != nil },
                    set: { isActive in
                        if !isActive {
                            chatThreadID = nil
                        }
                    }
                )
            ) {
                EmptyView()
            }
            .hidden()
        }
    }
}

struct CommentSection: View {
    @EnvironmentObject private var store: MockAppStore
    let postID: String
    @Binding var commentDraft: String
    @Binding var replyTargetCommentID: String?
    @Binding var actionCommentID: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("评论区")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(Theme.text)
                Spacer()
                Text("不能作为正式交易场所")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.muted)
            }
            let comments = store.comments(for: postID)
            if comments.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "bubble.left")
                        .font(.system(size: 32))
                    Text("抢首评")
                        .font(.system(size: 17, weight: .bold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 36)
                .foregroundStyle(Theme.muted)
            } else {
                ForEach(comments) { comment in
                    CommentRow(comment: comment) {
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        withAnimation(.spring(response: 0.24, dampingFraction: 0.84)) {
                            actionCommentID = comment.id
                        }
                    }
                }
            }
        }
        .padding(.bottom, 80)
    }
}

struct CommentRow: View {
    @EnvironmentObject private var store: MockAppStore
    let comment: Comment
    let onLongPress: () -> Void

    var body: some View {
        let author = store.user(id: comment.authorID)
        HStack(alignment: .top, spacing: 10) {
            AvatarView(user: author, size: 34)
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(author.nickname)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.subtext)
                    Text(comment.createdAt.relativeText)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.muted)
                }
                if let replyToID = comment.replyToID {
                    let repliedComment = store.comment(id: replyToID).flatMap { $0.status == .active ? $0 : nil }
                    let repliedAuthor = repliedComment.map { store.user(id: $0.authorID).nickname } ?? "原评论"
                    Text("回复 \(repliedAuthor)：\(repliedComment?.body ?? "原评论已删除")")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.subtext)
                        .lineLimit(2)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.panelRaised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                Text(comment.body)
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.text.opacity(0.86))
                    .fixedSize(horizontal: false, vertical: true)
                ModerationInlineNotice(status: comment.status, reason: comment.moderationReason)
            }
            Spacer()
        }
        .padding(.vertical, 8)
        .contentShape(Rectangle())
        .onLongPressGesture(minimumDuration: 0.35) {
            onLongPress()
        }
    }
}

struct CommentActionOverlay: View {
    @EnvironmentObject private var store: MockAppStore
    let comment: Comment
    let onDismiss: () -> Void
    let onReply: () -> Void
    let onCopy: () -> Void
    let onDelete: () -> Void

    var body: some View {
        let author = store.user(id: comment.authorID)
        ZStack(alignment: .bottom) {
            Color.black.opacity(0.58)
                .ignoresSafeArea()
                .onTapGesture(perform: onDismiss)

            VStack(alignment: .leading, spacing: 16) {
                Capsule()
                    .fill(Color.white.opacity(0.2))
                    .frame(width: 52, height: 5)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 10)

                Text("\(author.nickname) · \(comment.createdAt.relativeText)")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.52))

                VStack(spacing: 0) {
                    CommentActionRow(title: "回复", systemImage: "bubble.left", action: onReply)
                    CommentActionDivider()
                    CommentActionRow(title: "复制", systemImage: "doc.on.doc", action: onCopy)
                }
                .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                if store.canDeleteComment(comment) {
                    VStack(spacing: 0) {
                        CommentActionRow(title: "删除", systemImage: "trash", isDestructive: true, action: onDelete)
                    }
                    .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }

                Button(action: onDismiss) {
                    Text("取消")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.9))
                        .frame(maxWidth: .infinity)
                        .frame(height: 62)
                        .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color(red: 0.12, green: 0.12, blue: 0.14)
                    .clipShape(TopRoundedRectangle(radius: 28))
                    .ignoresSafeArea(edges: .bottom)
            )
        }
        .zIndex(10)
    }
}

struct CommentActionRow: View {
    let title: String
    let systemImage: String
    var isDestructive = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 18) {
                Image(systemName: systemImage)
                    .font(.system(size: 26, weight: .medium))
                    .frame(width: 36)
                Text(title)
                    .font(.system(size: 24, weight: .semibold))
                Spacer(minLength: 0)
            }
            .foregroundStyle(isDestructive ? Theme.hotPink : Color.white.opacity(0.9))
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: 72)
            .padding(.horizontal, 18)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct CommentActionDivider: View {
    var body: some View {
        Rectangle()
            .fill(Color.white.opacity(0.08))
            .frame(height: 0.5)
            .padding(.leading, 72)
    }
}

struct TopRoundedRectangle: Shape {
    let radius: CGFloat

    func path(in rect: CGRect) -> Path {
        let path = UIBezierPath(
            roundedRect: rect,
            byRoundingCorners: [.topLeft, .topRight],
            cornerRadii: CGSize(width: radius, height: radius)
        )
        return Path(path.cgPath)
    }
}

struct DetailActionBar: View {
    @EnvironmentObject private var store: MockAppStore
    let post: GroupBuyPost
    @Binding var commentDraft: String
    @Binding var replyTargetCommentID: String?

    var body: some View {
        let livePost = store.post(id: post.id) ?? post
        let isLiked = store.likedPostIDs.contains(post.id)
        let isFavorite = store.favoritePostIDs.contains(post.id)
        let commentTitle = livePost.commentCount == 0 ? "评论" : livePost.commentCount.formattedCount
        let replyTarget = replyTargetCommentID.flatMap { store.comment(id: $0) }
        let replyAuthor = replyTarget.map { store.user(id: $0.authorID) }
        VStack(spacing: 8) {
            if let replyAuthor {
                HStack(spacing: 8) {
                    Image(systemName: "arrowshape.turn.up.left.fill")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.hotPink)
                    Text("回复 \(replyAuthor.nickname)")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    Button {
                        replyTargetCommentID = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(Theme.muted)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 14)
            }

            HStack(spacing: 12) {
                if store.isLoggedIn {
                    HStack(spacing: 8) {
                        Image(systemName: "pencil")
                            .foregroundStyle(Theme.muted)
                        TextField(replyAuthor == nil ? "发评论" : "回复 \(replyAuthor?.nickname ?? "")", text: $commentDraft)
                            .foregroundStyle(Theme.text)
                            .submitLabel(.send)
                            .onSubmit {
                                store.addComment(postID: post.id, body: commentDraft, replyToID: replyTargetCommentID)
                                commentDraft = ""
                                replyTargetCommentID = nil
                            }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 11)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.panelRaised, in: Capsule())
                } else {
                    Button {
                        store.requireLogin(prompt: "登录后才能评论")
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "pencil")
                                .foregroundStyle(Theme.muted)
                            Text("登录后评论")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(Theme.subtext)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 11)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.panelRaised, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }

                ActionIconButton(icon: isLiked ? "heart.fill" : "heart", title: livePost.likedCount.formattedCount, tint: isLiked ? Theme.hotPink : Theme.text) {
                    withAnimation(.spring(response: 0.22, dampingFraction: 0.72)) {
                        store.toggleLike(postID: post.id)
                    }
                }
                ActionIconButton(icon: isFavorite ? "star.fill" : "star", title: livePost.favoriteCount.formattedCount, tint: isFavorite ? Theme.hotPink : Theme.text) {
                    store.toggleFavorite(postID: post.id)
                }
                ActionIconButton(icon: "bubble.left", title: commentTitle, tint: Theme.text) {
                    guard store.requireLogin(prompt: "登录后才能评论") else { return }
                    if commentDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        store.showToast("输入内容后按回车发布评论")
                    } else {
                        store.addComment(postID: post.id, body: commentDraft, replyToID: replyTargetCommentID)
                        commentDraft = ""
                        replyTargetCommentID = nil
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(.ultraThinMaterial)
        .overlay(alignment: .top) {
            Rectangle().fill(Theme.hairline).frame(height: 0.5)
        }
    }
}
