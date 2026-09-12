import SwiftUI
import UIKit
import PhotosUI

struct ProfileView: View {
    @EnvironmentObject private var store: MockAppStore
    @State private var isMenuOpen = false
    @State private var selectedTab = "制品"
    @State private var isBioEditorPresented = false
    @State private var isShareSheetPresented = false
    @State private var bioDraft = ""

    let profileTabs = ["制品", "拼团合集", "收藏", "赞过"]

    var body: some View {
        Group {
            if store.isLoggedIn {
                profileContent
            } else {
                GuestAuthView()
            }
        }
        .navigationBarHidden(true)
    }

    @ViewBuilder private var profileContent: some View {
        let user = store.currentUser
        GeometryReader { rootProxy in
            let contentWidth = rootProxy.size.width
            let headerHeight: CGFloat = 342
            let windowTopInset = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .first { $0.isKeyWindow }?
                .safeAreaInsets.top ?? 0
            let topInset = max(rootProxy.safeAreaInsets.top, windowTopInset)

            ZStack(alignment: .leading) {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 0) {
                        ZStack(alignment: .top) {
                            GeometryReader { headerProxy in
                                let pullDistance = max(headerProxy.frame(in: .named("profile-scroll")).minY, 0)

                                UserBackgroundImage(user: user)
                                    .scaledToFill()
                                    .frame(width: contentWidth, height: headerHeight + topInset + pullDistance)
                                    .clipped()
                                    .overlay(.black.opacity(0.52))
                                    .overlay(
                                        LinearGradient(colors: [.black.opacity(0.08), Theme.background.opacity(0.92)], startPoint: .top, endPoint: .bottom)
                                    )
                                    .offset(y: -topInset - pullDistance)
                                    .ignoresSafeArea(.container, edges: .top)
                            }
                            .frame(width: contentWidth, height: headerHeight)

                            VStack(alignment: .leading, spacing: 18) {
                                HStack {
                                    Button {
                                        withAnimation(.spring(response: 0.34, dampingFraction: 0.86)) {
                                            isMenuOpen = true
                                        }
                                    } label: {
                                        Image(systemName: "line.3.horizontal")
                                            .font(.system(size: 30, weight: .medium))
                                            .frame(width: 48, height: 48)
                                            .background(.black.opacity(0.28), in: Circle())
                                            .overlay {
                                                Circle().stroke(.white.opacity(0.18), lineWidth: 1)
                                            }
                                            .shadow(color: .black.opacity(0.32), radius: 8, x: 0, y: 3)
                                    }
                                    .buttonStyle(.plain)
                                    .foregroundStyle(.white)

                                    Spacer()

                                    NavigationLink(value: Route.editProfile) {
                                        Label("编辑主页", systemImage: "pencil")
                                            .font(.system(size: 16, weight: .bold))
                                            .foregroundStyle(.white)
                                            .padding(.horizontal, 15)
                                            .padding(.vertical, 9)
                                            .background(.black.opacity(0.32), in: Capsule())
                                            .overlay {
                                                Capsule().stroke(.white.opacity(0.18), lineWidth: 1)
                                            }
                                            .shadow(color: .black.opacity(0.28), radius: 8, x: 0, y: 3)
                                    }
                                    .buttonStyle(.plain)

                                    Button {
                                        isShareSheetPresented = true
                                    } label: {
                                        Image(systemName: "square.and.arrow.up")
                                            .font(.system(size: 27, weight: .semibold))
                                            .frame(width: 44, height: 44)
                                            .background(.black.opacity(0.28), in: Circle())
                                            .overlay {
                                                Circle().stroke(.white.opacity(0.18), lineWidth: 1)
                                            }
                                            .shadow(color: .black.opacity(0.32), radius: 8, x: 0, y: 3)
                                    }
                                    .buttonStyle(.plain)
                                    .foregroundStyle(.white)
                                }

                                Color.clear
                                    .frame(height: 8)

                                HStack(alignment: .center, spacing: 18) {
                                    AvatarView(user: user, size: 118)
                                        .background(.white, in: Circle())
                                    VStack(alignment: .leading, spacing: 8) {
                                        Text(user.nickname)
                                            .font(.system(size: 28, weight: .black))
                                            .foregroundStyle(Theme.text)
                                        Text("ID：\(store.registrationID(for: user.id))")
                                            .font(.system(size: 16, weight: .semibold))
                                            .foregroundStyle(Theme.subtext)
                                    }
                                }

                                HStack(spacing: 26) {
                                    NavigationLink(value: Route.userRelations(user.id, .following)) {
                                        StatInline(value: "\(store.followingUsers(for: user.id).count)", title: "关注")
                                    }
                                    .buttonStyle(.plain)
                                    NavigationLink(value: Route.userRelations(user.id, .followers)) {
                                        StatInline(value: "\(store.followerUsers(for: user.id).count)", title: "粉丝")
                                    }
                                    .buttonStyle(.plain)
                                    StatInline(value: "\(store.likedPostIDs.count + store.favoritePostIDs.count)", title: "获赞与收藏")
                                }

                                Button {
                                    bioDraft = user.bio == "点击这里，填写简介" ? "" : user.bio
                                    isBioEditorPresented = true
                                } label: {
                                    Text(user.bio)
                                        .font(.system(size: 18, weight: .semibold))
                                        .foregroundStyle(Theme.text.opacity(0.86))
                                        .lineLimit(2)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .buttonStyle(.plain)
                            }
                            .padding(.horizontal, 16)
                            .padding(.top, 12)
                            .frame(width: contentWidth, height: headerHeight, alignment: .top)
                        }
                        .frame(width: contentWidth, height: headerHeight)

                        VStack(spacing: 0) {
                            HStack(spacing: 0) {
                                ForEach(profileTabs, id: \.self) { tab in
                                    Button {
                                        selectedTab = tab
                                    } label: {
                                        VStack(spacing: 8) {
                                            HStack(spacing: 6) {
                                                Text(tab)
                                                    .font(.system(size: tab == "拼团合集" ? 15 : 17, weight: selectedTab == tab ? .black : .semibold))
                                                    .lineLimit(1)
                                                    .minimumScaleFactor(0.76)
                                            }
                                            .foregroundStyle(selectedTab == tab ? Theme.text : Theme.subtext)
                                            Capsule()
                                                .fill(selectedTab == tab ? Theme.hotPink : Color.clear)
                                                .frame(width: 48, height: 4)
                                        }
                                        .frame(maxWidth: .infinity)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.top, 20)
                            .padding(.bottom, 12)
                            .background(Theme.panel)

                            Group {
                                if selectedTab == "制品" {
                                    ProfileNotesPanel(userID: user.id, canManage: true)
                                } else if selectedTab == "拼团合集" {
                                    ProfileCollectionsPanel(ownerID: user.id, canManage: true)
                                } else if selectedTab == "收藏" {
                                    ProfileFavoritePostsPanel(userID: user.id)
                                } else if selectedTab == "赞过" {
                                    ProfileLikedPostsPanel(userID: user.id)
                                } else {
                                    ProfileEmptyNotesView()
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .frame(minHeight: 430, alignment: .top)
                        }
                        .background(Theme.background)
                        .clipShape(UnevenRoundedRectangle(topLeadingRadius: 18, topTrailingRadius: 18, style: .continuous))
                        .offset(y: -2)
                        .frame(width: contentWidth)
                    }
                    .padding(.bottom, 88)
                    .frame(width: contentWidth)
                }
                .coordinateSpace(name: "profile-scroll")
                .background(Theme.background.ignoresSafeArea())

                if isMenuOpen {
                    Color.black.opacity(0.46)
                        .ignoresSafeArea()
                        .onTapGesture {
                            withAnimation(.spring(response: 0.34, dampingFraction: 0.86)) {
                                isMenuOpen = false
                            }
                        }

                    ProfileSideMenu(isMenuOpen: $isMenuOpen)
                        .transition(.move(edge: .leading))
                }
            }
        }
        .navigationBarHidden(true)
        .sheet(isPresented: $isShareSheetPresented) {
            ProfileShareSheetView(user: user)
                .presentationDetents([.height(440), .large])
                .presentationDragIndicator(.hidden)
        }
        .fullScreenCover(isPresented: $isBioEditorPresented) {
            ProfileBioEditorView(bio: $bioDraft) {
                store.updateCurrentBio(bioDraft)
                isBioEditorPresented = false
            }
        }
    }
}

struct ProfileBioEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var bio: String
    let onSave: () -> Void
    private let maxLength = 160
    private var canSave: Bool { !bio.trimmed.isEmpty }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button("取消") {
                    dismiss()
                }
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(Theme.subtext)
                .frame(width: 86, height: 48, alignment: .leading)

                Spacer()

                Text("编辑简介")
                    .font(.system(size: 21, weight: .bold))
                    .foregroundStyle(Theme.text)

                Spacer()

                Button("保存") {
                    onSave()
                    dismiss()
                }
                .font(.system(size: 20, weight: canSave ? .bold : .medium))
                .foregroundStyle(canSave ? Theme.hotPink : Color(red: 0.45, green: 0.08, blue: 0.13))
                .frame(width: 86, height: 48, alignment: .trailing)
                .animation(.easeInOut(duration: 0.16), value: canSave)
            }
            .padding(.horizontal, 18)
            .padding(.top, 0)
            .padding(.bottom, 14)

            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Theme.panel)

                TextEditor(text: $bio)
                    .font(.system(size: 22, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .tint(Theme.hotPink)
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, 14)
                    .padding(.top, 10)
                    .padding(.bottom, 46)

                if bio.trimmed.isEmpty {
                    Text("填写简介")
                        .font(.system(size: 22, weight: .medium))
                        .foregroundStyle(Theme.subtext)
                        .padding(.leading, 14)
                        .padding(.top, 18)
                        .allowsHitTesting(false)
                }

                Text("\(bio.count)/\(maxLength)")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(Theme.subtext)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                    .padding(.trailing, 14)
                    .padding(.bottom, 22)
            }
            .frame(height: 160)
            .padding(.horizontal, 18)

            Spacer()
        }
        .background(Theme.background.ignoresSafeArea())
        .onChange(of: bio) { _, newValue in
            if newValue.count > maxLength {
                bio = String(newValue.prefix(maxLength))
            }
        }
    }
}

struct StatInline: View {
    let value: String
    let title: String

    var body: some View {
        HStack(spacing: 6) {
            Text(value)
                .font(.system(size: 24, weight: .black))
                .foregroundStyle(Theme.text)
            Text(title)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.text.opacity(0.86))
        }
    }
}

struct UserRelationListView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    let userID: String
    let kind: UserRelationKind

    var relatedUsers: [User] {
        store.relationUsers(for: userID, kind: kind)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 26, weight: .medium))
                        .foregroundStyle(Theme.text)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)

                VStack(alignment: .leading, spacing: 2) {
                    Text(kind.title)
                        .font(.system(size: 25, weight: .black))
                        .foregroundStyle(Theme.text)
                    Text("\(relatedUsers.count) 位用户")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.subtext)
                }
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.top, 10)
            .padding(.bottom, 12)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Theme.hairline).frame(height: 0.5)
            }

            if relatedUsers.isEmpty {
                VStack(spacing: 16) {
                    Spacer()
                    Image(systemName: kind == .following ? "person.crop.circle.badge.plus" : "person.2")
                        .font(.system(size: 52, weight: .light))
                        .foregroundStyle(Theme.muted)
                    Text(kind.emptyText)
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(Theme.subtext)
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            } else {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 10) {
                        ForEach(relatedUsers) { user in
                            UserRelationRow(user: user)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 14)
                    .padding(.bottom, 28)
                }
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .navigationBarHidden(true)
        .toolbar(.hidden, for: .tabBar)
        .simultaneousGesture(
            DragGesture(minimumDistance: 30)
                .onEnded { value in
                    guard value.translation.width > 86,
                          abs(value.translation.height) < 72 else { return }
                    dismiss()
                }
        )
    }
}

struct UserRelationRow: View {
    @EnvironmentObject private var store: MockAppStore
    let user: User

    var body: some View {
        HStack(spacing: 12) {
            NavigationLink(value: Route.userProfile(user.id)) {
                HStack(spacing: 12) {
                    AvatarView(user: user, size: 52)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(user.nickname)
                            .font(.system(size: 17, weight: .black))
                            .foregroundStyle(Theme.text)
                            .lineLimit(1)
                        Text("ID：\(store.registrationID(for: user.id))")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Theme.hotPink.opacity(0.88))
                        Text(user.bio)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.subtext)
                            .lineLimit(1)
                    }
                }
            }
            .buttonStyle(.plain)

            Spacer(minLength: 8)

            if user.id != store.currentUserID {
                Button {
                    store.toggleFollow(userID: user.id)
                } label: {
                    Text(store.followedUserIDs.contains(user.id) ? "已关注" : "关注")
                        .font(.system(size: 14, weight: .black))
                        .foregroundStyle(store.followedUserIDs.contains(user.id) ? Theme.subtext : .white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(store.followedUserIDs.contains(user.id) ? Theme.panelRaised : Theme.hotPink, in: Capsule())
                }
                .buttonStyle(.plain)
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

struct ProfileEmptyNotesView: View {
    @EnvironmentObject private var store: MockAppStore
    var message = "你还没有发布过制品"
    var showsPublishButton = true

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "photo.on.rectangle.angled")
                .font(.system(size: 70, weight: .light))
                .foregroundStyle(Theme.muted)
            Text(message)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(Theme.text.opacity(0.86))
            if showsPublishButton {
                Button {
                    store.showToast("请点击底部 + 去发布")
                } label: {
                    Text("去发布")
                        .font(.system(size: 20, weight: .black))
                        .foregroundStyle(Theme.text)
                        .padding(.horizontal, 32)
                        .padding(.vertical, 12)
                        .overlay {
                            Capsule().stroke(Theme.subtext, lineWidth: 1)
                        }
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
    }
}

struct ProfileNotesPanel: View {
    @EnvironmentObject private var store: MockAppStore
    @State private var isManaging = false
    let userID: String
    var canManage = false

    var posts: [GroupBuyPost] {
        store.profilePosts(userID: userID)
    }

    var attentionPosts: [GroupBuyPost] {
        canManage ? store.profileAttentionPosts(userID: userID) : []
    }

    var attentionSectionTitle: String {
        attentionPosts.contains { !$0.status.canRepublish } ? "审核处理" : "未通过审核"
    }

    var body: some View {
        if posts.isEmpty && attentionPosts.isEmpty {
            ProfileEmptyNotesView()
        } else {
            VStack(spacing: 12) {
                if canManage && !posts.isEmpty {
                    HStack {
                        Text("我的帖子")
                            .font(.system(size: 18, weight: .black))
                            .foregroundStyle(Theme.text)
                        Spacer()
                        Button {
                            withAnimation(.spring(response: 0.24, dampingFraction: 0.86)) {
                                isManaging.toggle()
                            }
                        } label: {
                            Text(isManaging ? "完成" : "管理")
                                .font(.system(size: 14, weight: .black))
                                .foregroundStyle(isManaging ? Theme.text : Theme.hotPink)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(Theme.panelRaised, in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 14)
                }

                if !posts.isEmpty && isManaging {
                    VStack(spacing: 10) {
                        ForEach(posts) { post in
                            ProfilePostManageRow(post: post)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 28)
                } else if !posts.isEmpty {
                    WaterfallGrid(posts: posts)
                        .padding(.horizontal, 12)
                        .padding(.top, canManage ? 0 : 14)
                        .padding(.bottom, 28)
                }

                if !attentionPosts.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text(attentionSectionTitle)
                                .font(.system(size: 18, weight: .black))
                                .foregroundStyle(Theme.text)
                            Spacer()
                            Text("\(attentionPosts.count)")
                                .font(.system(size: 13, weight: .black))
                                .foregroundStyle(Theme.hotPink)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(Theme.hotPink.opacity(0.13), in: Capsule())
                        }
                        ForEach(attentionPosts) { post in
                            ProfileAttentionPostRow(post: post)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, posts.isEmpty ? 14 : 0)
                    .padding(.bottom, 28)
                }
            }
        }
    }
}

struct ProfileAttentionPostRow: View {
    @EnvironmentObject private var store: MockAppStore
    let post: GroupBuyPost

    var subtitle: String {
        if post.moderationReason.trimmed.isEmpty {
            return post.status == .review || post.status == .pending ? "正在等待审核结果" : "可以重新编辑后再发布"
        }
        return post.moderationReason
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                PostImageView(post: post)
                    .scaledToFill()
                    .frame(width: 62, height: 62)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .saturation(0.65)

                VStack(alignment: .leading, spacing: 6) {
                    Text(post.title)
                        .font(.system(size: 16, weight: .black))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    Text(subtitle)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.subtext)
                        .lineLimit(2)
                    Text(post.status.rawValue)
                        .font(.system(size: 12, weight: .black))
                        .foregroundStyle(post.status.canRepublish ? Theme.hotPink : Theme.muted)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .background((post.status.canRepublish ? Theme.hotPink.opacity(0.13) : Theme.panelRaised), in: Capsule())
                }

                Spacer()
            }

            HStack(spacing: 10) {
                if post.status.canRepublish {
                    NavigationLink(value: Route.editRejectedPost(post.id)) {
                        Label("重新编辑", systemImage: "pencil")
                            .font(.system(size: 14, weight: .black))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(Theme.hotPink, in: Capsule())
                    }
                    .buttonStyle(.plain)
                } else {
                    Label("等待审核", systemImage: "clock")
                        .font(.system(size: 14, weight: .black))
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(Theme.panelRaised, in: Capsule())
                }

                Button {
                    store.deleteOwnPost(postID: post.id)
                } label: {
                    Image(systemName: "trash")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Theme.hotPink)
                        .frame(width: 44, height: 40)
                        .background(Theme.hotPink.opacity(0.12), in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(12)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Theme.hairline, lineWidth: 1)
        }
    }
}

struct ProfilePostManageRow: View {
    @EnvironmentObject private var store: MockAppStore
    let post: GroupBuyPost

    var body: some View {
        HStack(spacing: 12) {
            PostImageView(post: post)
                .scaledToFill()
                .frame(width: 58, height: 58)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .saturation(post.isEnded ? 0 : 1)
                .opacity(post.isEnded ? 0.58 : 1)

            VStack(alignment: .leading, spacing: 6) {
                Text(post.title)
                    .font(.system(size: 15, weight: .black))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(post.isEnded ? "已结团 · 可保留记录或删除" : "\(post.groupType.rawValue) · \(post.deadline.shortDeadlineText)")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(post.isEnded ? Theme.muted : post.groupType.accent)
                    .lineLimit(1)
            }

            Spacer()

            Button {
                store.deleteOwnPost(postID: post.id)
            } label: {
                Image(systemName: "trash")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(Theme.hotPink)
                    .frame(width: 42, height: 42)
                    .background(Theme.hotPink.opacity(0.12), in: Circle())
            }
            .buttonStyle(.plain)
        }
        .padding(12)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Theme.hairline, lineWidth: 1)
        }
        .saturation(post.isEnded ? 0 : 1)
        .opacity(post.isEnded ? 0.72 : 1)
    }
}

struct ProfileLikedPostsPanel: View {
    @EnvironmentObject private var store: MockAppStore
    let userID: String

    var posts: [GroupBuyPost] {
        guard userID == store.currentUserID else { return [] }
        return store.sortedFeedPosts(store.activePosts.filter { store.likedPostIDs.contains($0.id) })
    }

    var body: some View {
        if posts.isEmpty {
            ProfileEmptyState(text: "你还没有赞过", icon: "heart")
        } else {
            WaterfallGrid(posts: posts)
                .padding(.horizontal, 12)
                .padding(.top, 14)
                .padding(.bottom, 28)
        }
    }
}

struct ProfileFavoritePostsPanel: View {
    @EnvironmentObject private var store: MockAppStore
    let userID: String

    var posts: [GroupBuyPost] {
        guard userID == store.currentUserID else { return [] }
        return store.sortedFeedPosts(store.activePosts.filter { store.favoritePostIDs.contains($0.id) })
    }

    var body: some View {
        if posts.isEmpty {
            ProfileEmptyState(text: "你还没有收藏过", icon: "star")
        } else {
            WaterfallGrid(posts: posts)
                .padding(.horizontal, 12)
                .padding(.top, 14)
                .padding(.bottom, 28)
        }
    }
}

struct ProfileEmptyState: View {
    let text: String
    let icon: String

    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: icon)
                .font(.system(size: 46, weight: .light))
                .foregroundStyle(Theme.muted)
            Text(text)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.subtext)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }
}

struct ProfileCollectionsPanel: View {
    @EnvironmentObject private var store: MockAppStore
    @State private var isCreatingCollection = false
    @State private var isManaging = false
    @State private var isDeletingCollections = false
    @State private var selectedCollectionIDs: Set<String> = []
    let ownerID: String
    let canManage: Bool

    var body: some View {
        let collections = store.collections(ownerID: ownerID)
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("拼团合集")
                        .font(.system(size: 20, weight: .black))
                        .foregroundStyle(Theme.text)
                    Text("同一拼团的宣传、进度和余量更新放在一起")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.subtext)
                }
                Spacer()
                if canManage {
                    HStack(spacing: 10) {
                        if !collections.isEmpty {
                            Button {
                                withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                                    isManaging.toggle()
                                    selectedCollectionIDs.removeAll()
                                }
                            } label: {
                                Text(isManaging ? "完成" : "管理")
                                    .font(.system(size: 13, weight: .black))
                                    .foregroundStyle(isManaging ? .white : Theme.text)
                                    .padding(.horizontal, 13)
                                    .frame(height: 36)
                                    .background(isManaging ? Theme.hotPink : Theme.panelRaised, in: Capsule())
                            }
                            .buttonStyle(.plain)
                        }

                        if !isManaging {
                            Button {
                                isCreatingCollection = true
                            } label: {
                                Image(systemName: "plus")
                                    .font(.system(size: 18, weight: .black))
                                    .foregroundStyle(.white)
                                    .frame(width: 38, height: 38)
                                    .background(Theme.hotPink, in: Circle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            if collections.isEmpty {
                Text(canManage ? "还没有合集，点右上角创建第一个拼团合集。" : "这个团长还没有公开拼团合集。")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                    .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            } else {
                VStack(spacing: 10) {
                    ForEach(collections) { collection in
                        CollectionCard(
                            collection: collection,
                            isManaging: canManage && isManaging,
                            isSelected: selectedCollectionIDs.contains(collection.id)
                        ) {
                            toggleCollectionSelection(collection.id)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .sheet(isPresented: $isCreatingCollection) {
            CreateCollectionSheet()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .safeAreaInset(edge: .bottom) {
            if canManage && isManaging {
                Button {
                    let ids = selectedCollectionIDs
                    let session = store.authSessionVersion
                    isDeletingCollections = true
                    Task { @MainActor in
                        guard store.isCurrentSession(session) else { return }
                        let deleted = await store.deleteCollections(ids: ids)
                        guard store.isCurrentSession(session) else { return }
                        isDeletingCollections = false
                        if deleted { selectedCollectionIDs.removeAll(); isManaging = false }
                    }
                } label: {
                    Text(selectedCollectionIDs.isEmpty ? "选择要删除的合集" : "删除 \(selectedCollectionIDs.count) 个合集")
                        .font(.system(size: 16, weight: .black))
                        .foregroundStyle(selectedCollectionIDs.isEmpty ? Theme.muted : .white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(selectedCollectionIDs.isEmpty ? Theme.panelRaised : Theme.hotPink, in: Capsule())
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        .padding(.bottom, 8)
                }
                .disabled(selectedCollectionIDs.isEmpty || isDeletingCollections)
                .buttonStyle(.plain)
                .background(.ultraThinMaterial)
            }
        }
    }

    private func toggleCollectionSelection(_ id: String) {
        if selectedCollectionIDs.contains(id) {
            selectedCollectionIDs.remove(id)
        } else {
            selectedCollectionIDs.insert(id)
        }
    }
}

struct CollectionCard: View {
    @EnvironmentObject private var store: MockAppStore
    let collection: GroupCollection
    var isManaging = false
    var isSelected = false
    var onToggle: (() -> Void)? = nil

    var body: some View {
        let visibleCount = collection.postIDs.compactMap(store.post).filter { $0.status == .active }.count
        let isEnded = collection.isEnded
        Group {
            if isManaging {
                Button {
                    onToggle?()
                } label: {
                    content(visibleCount: visibleCount, isEnded: isEnded)
                }
            } else {
                NavigationLink(value: Route.collectionDetail(collection.id)) {
                    content(visibleCount: visibleCount, isEnded: isEnded)
                }
            }
        }
        .buttonStyle(.plain)
        .saturation(isEnded ? 0 : 1)
        .opacity(isEnded ? 0.58 : 1)
    }

    private func content(visibleCount: Int, isEnded: Bool) -> some View {
        ZStack(alignment: .topTrailing) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label(collection.name, systemImage: "rectangle.stack.fill")
                        .font(.system(size: 17, weight: .black))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    Spacer()
                    Text(isEnded ? "已结团" : "\(visibleCount)帖")
                        .font(.system(size: 12, weight: .black))
                        .foregroundStyle(isEnded ? Theme.muted : Theme.hotPink)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .background((isEnded ? Theme.panelRaised : Theme.hotPink.opacity(0.13)), in: Capsule())
                }
                Text(collection.defaultNote)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.subtext)
                    .lineLimit(2)
                HStack {
                    Label(collection.deadline.shortDeadlineText, systemImage: "clock.fill")
                    Spacer()
                    Image(systemName: "chevron.right")
                }
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Theme.muted)
            }
            .padding(14)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Theme.hairline, lineWidth: 1)
            }

            if isManaging {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(isSelected ? Theme.hotPink : Theme.muted)
                    .padding(12)
            }
        }
    }
}

struct CreateCollectionSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    let editingCollection: GroupCollection?
    var onCreated: ((String) -> Void)? = nil
    @State private var isSaving = false
    @State private var saveFailed = false
    @State private var submissionID = "col-\(UUID().uuidString)"
    @State private var revision = 1
    @State private var name = ""
    @State private var wechat = ""
    @State private var qq = ""
    @State private var groupNumber = ""
    @State private var groupInfo = ""
    @State private var deadline = Calendar.current.date(byAdding: .day, value: 7, to: Date()) ?? Date()
    @State private var note = ""

    init(editingCollection: GroupCollection? = nil, onCreated: ((String) -> Void)? = nil) {
        self.editingCollection = editingCollection
        _revision = State(initialValue: editingCollection?.revision ?? 1)
        self.onCreated = onCreated
        _name = State(initialValue: editingCollection?.name ?? "")
        _wechat = State(initialValue: editingCollection?.contactWechat ?? "")
        _qq = State(initialValue: editingCollection?.contactQQ ?? "")
        _groupNumber = State(initialValue: editingCollection?.contactGroupNumber ?? "")
        _groupInfo = State(initialValue: editingCollection?.groupInfo ?? "")
        _deadline = State(initialValue: editingCollection?.deadline ?? Calendar.current.date(byAdding: .day, value: 7, to: Date()) ?? Date())
        _note = State(initialValue: editingCollection?.defaultNote ?? "")
    }

    var isEditing: Bool {
        editingCollection != nil
    }

    var canCreate: Bool {
        !name.trimmed.isEmpty && (!wechat.trimmed.isEmpty || !qq.trimmed.isEmpty || !groupNumber.trimmed.isEmpty) && !note.trimmed.isEmpty
    }

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 14) {
                    HeaderTitle(title: isEditing ? "编辑拼团信息" : "创建拼团合集", subtitle: "合集内帖子会自动共享联系方式、截团时间、拼团名称和默认说明")
                    PrototypeTextField(title: "合集名称", placeholder: "例如：2026冬兵生日团", text: $name, required: true)
                    HStack(spacing: 10) {
                        PrototypeTextField(title: "微信", placeholder: "微信号", text: $wechat, required: qq.trimmed.isEmpty && groupNumber.trimmed.isEmpty)
                        PrototypeTextField(title: "QQ", placeholder: "QQ 号", text: $qq, required: wechat.trimmed.isEmpty && groupNumber.trimmed.isEmpty)
                    }
                    PrototypeTextField(title: "QQ群号", placeholder: "至少填微信、QQ、QQ群号之一", text: $groupNumber, required: wechat.trimmed.isEmpty && qq.trimmed.isEmpty)
                    PrototypeTextField(title: "拉群说明", placeholder: "例如：复制群号后备注昵称 / 拍下后私信拉群", text: $groupInfo, required: false)
                    DatePicker("截团时间", selection: $deadline, displayedComponents: [.date, .hourAndMinute])
                        .datePickerStyle(.compact)
                        .foregroundStyle(Theme.text)
                        .padding(14)
                        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
                    PrototypeTextEditor(title: "默认说明", placeholder: "合集内所有帖子共用的说明", text: $note, required: true)
                    Button {
                        let session = store.authSessionVersion
                        isSaving = true
                        Task { @MainActor in
                            guard store.isCurrentSession(session) else { return }
                            let saved: Bool
                            if let editingCollection {
                                saved = await store.updateCollection(id: editingCollection.id, revision: revision, name: name, wechat: wechat, qq: qq, groupNumber: groupNumber, groupInfo: groupInfo, deadline: deadline, defaultNote: note)
                            } else if let collectionID = await store.createCollection(name: name, wechat: wechat, qq: qq, groupNumber: groupNumber, groupInfo: groupInfo, deadline: deadline, defaultNote: note, submissionID: submissionID) {
                                guard store.isCurrentSession(session) else { return }
                                onCreated?(collectionID)
                                saved = true
                            } else { saved = false }
                            guard store.isCurrentSession(session) else { return }
                            isSaving = false
                            saveFailed = !saved
                            if saved { dismiss() }
                        }
                    } label: {
                        Text(isSaving ? "正在保存…" : (canCreate ? (isEditing ? "保存修改" : "创建合集") : "补齐必填字段"))
                            .font(.system(size: 17, weight: .bold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 15)
                            .background(canCreate ? Theme.hotPink : Theme.panelRaised, in: Capsule())
                            .foregroundStyle(canCreate ? .white : Theme.muted)
                    }
                    .buttonStyle(.plain)
                    .disabled(!canCreate)
                    .padding(.top, 8)
                    if saveFailed, let editingCollection {
                        Button("重新加载最新合集信息") {
                            guard let latest = store.collection(id: editingCollection.id) else { return }
                            name = latest.name; wechat = latest.contactWechat; qq = latest.contactQQ
                            groupNumber = latest.contactGroupNumber; groupInfo = latest.groupInfo
                            deadline = latest.deadline; note = latest.defaultNote; revision = latest.revision
                            saveFailed = false
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 28)
            }
            .disabled(isSaving)
            .interactiveDismissDisabled(isSaving)
            .onChange(of: store.authSessionVersion) { _, _ in dismiss() }
            .background(Theme.background.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("关闭") { dismiss() }
                }
            }
        }
    }
}

struct CollectionDetailView: View {
    @EnvironmentObject private var store: MockAppStore
    @State private var isEditingCollection = false
    let collectionID: String

    var body: some View {
        if let collection = store.collection(id: collectionID) {
            let posts = store.posts(in: collection.id)
            let canManage = collection.ownerID == store.currentUserID
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    HeaderTitle(title: collection.name, subtitle: "合集共享信息会自动继承到新发布帖子")
                    if canManage {
                        Button {
                            isEditingCollection = true
                        } label: {
                            Label("编辑拼团信息", systemImage: "pencil")
                                .font(.system(size: 15, weight: .black))
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                                .background(Theme.hotPink, in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .padding(.horizontal, 16)
                    }
                    CollectionSharedInfoCard(collection: collection)
                        .padding(.horizontal, 16)
                    if canManage {
                        CollectionPostManager(collection: collection)
                            .padding(.horizontal, 16)
                    }
                    Text("合集内帖子")
                        .font(.system(size: 20, weight: .black))
                        .foregroundStyle(Theme.text)
                        .padding(.horizontal, 16)
                    if posts.isEmpty {
                        Text("还没有帖子加入这个合集。")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Theme.muted)
                            .padding(16)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
                            .padding(.horizontal, 16)
                    } else {
                        WaterfallGrid(posts: posts)
                            .padding(.horizontal, 12)
                    }
                }
                .padding(.bottom, 28)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(collection.name)
            .navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $isEditingCollection) {
                CreateCollectionSheet(editingCollection: collection)
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
        } else {
            ContentUnavailableView("合集不存在", systemImage: "rectangle.stack.badge.minus")
                .background(Theme.background)
        }
    }
}

struct CollectionPostManager: View {
    @EnvironmentObject private var store: MockAppStore
    @State private var isSaving = false
    let collection: GroupCollection

    var manageablePosts: [GroupBuyPost] {
        store.profilePosts(userID: collection.ownerID)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("切换帖子所属合集")
                .font(.system(size: 16, weight: .black))
                .foregroundStyle(Theme.text)
            ForEach(manageablePosts) { post in
                let isIncluded = collection.postIDs.contains(post.id)
                HStack(spacing: 10) {
                    PostImageView(post: post)
                        .scaledToFill()
                        .frame(width: 52, height: 52)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    VStack(alignment: .leading, spacing: 5) {
                        Text(post.title)
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Theme.text)
                            .lineLimit(1)
                        Text(post.groupType.rawValue)
                            .font(.system(size: 12, weight: .black))
                            .foregroundStyle(post.groupType.accent)
                    }
                    Spacer()
                    if isIncluded {
                        Text("当前合集")
                            .font(.system(size: 13, weight: .black))
                            .foregroundStyle(Theme.subtext)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(Theme.panelRaised, in: Capsule())
                    } else {
                        Button {
                            let session = store.authSessionVersion
                            isSaving = true
                            Task { @MainActor in
                                guard store.isCurrentSession(session) else { return }
                                _ = await store.addPost(post.id, to: collection.id)
                                guard store.isCurrentSession(session) else { return }
                                isSaving = false
                            }
                        } label: {
                            Text("移入")
                                .font(.system(size: 13, weight: .black))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(Theme.hotPink, in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .disabled(isSaving)
        .onChange(of: store.authSessionVersion) { _, _ in isSaving = false }
        .padding(14)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct CollectionSharedInfoCard: View {
    let collection: GroupCollection

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("合集共享信息", systemImage: "link.circle.fill")
                .font(.system(size: 17, weight: .black))
                .foregroundStyle(Theme.text)
            InfoRow(title: "拼团名称", value: collection.name)
            InfoRow(title: "截团时间", value: collection.deadline.fullDisplay)
            InfoRow(title: "微信 / QQ", value: "\(collection.contactWechat.isEmpty ? "未填" : collection.contactWechat) · \(collection.contactQQ.isEmpty ? "未填" : collection.contactQQ)")
            InfoRow(title: "QQ群号", value: collection.contactGroupNumber.isEmpty ? "未填写" : collection.contactGroupNumber)
            InfoRow(title: "拉群说明", value: collection.groupInfo.isEmpty ? "未填写" : collection.groupInfo)
            InfoRow(title: "默认说明", value: collection.defaultNote)
        }
        .padding(14)
        .background(Theme.panelRaised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8)
                .stroke(Theme.hairline, lineWidth: 1)
        }
    }
}

struct DraftsView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            SimpleTopBar(title: "我的草稿", trailing: nil) {
                dismiss()
            }
            VStack(spacing: 16) {
                Image(systemName: "tray")
                    .font(.system(size: 48, weight: .light))
                    .foregroundStyle(Theme.muted)
                Text("暂无草稿")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(Theme.text)
                Text("未发布的团购帖会保存在这里")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.subtext)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .navigationBarHidden(true)
        .toolbar(.hidden, for: .tabBar)
    }
}

struct BrowsingHistoryView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var isManaging = false
    @State private var selectedIDs: Set<String> = []

    var posts: [GroupBuyPost] {
        store.browsingHistoryPosts()
    }

    var body: some View {
        VStack(spacing: 0) {
            SimpleTopBar(title: "浏览记录", trailing: isManaging ? "完成" : "管理", trailingIcon: isManaging ? "checkmark" : "line.3.horizontal") {
                dismiss()
            } trailingAction: {
                withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                    isManaging.toggle()
                    if !isManaging {
                        selectedIDs.removeAll()
                    }
                }
            }

            HStack {
                Spacer()
                VStack(spacing: 7) {
                    Text("制品")
                        .font(.system(size: 22, weight: .black))
                        .foregroundStyle(Theme.text)
                    Capsule()
                        .fill(Theme.hotPink)
                        .frame(width: 48, height: 4)
                }
                Spacer()
            }
            .padding(.top, 14)
            .padding(.bottom, 26)

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 14) {
                    Text("昨天")
                        .font(.system(size: 24, weight: .black))
                        .foregroundStyle(Theme.text)
                        .padding(.horizontal, 16)
                    if posts.isEmpty {
                        Text("还没有最近浏览记录")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Theme.muted)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 80)
                    } else {
                        HistoryWaterfallGrid(posts: posts, isManaging: isManaging, selectedIDs: $selectedIDs)
                            .padding(.horizontal, 12)
                    }
                }
                .padding(.bottom, isManaging ? 96 : 30)
            }
        }
        .safeAreaInset(edge: .bottom) {
            if isManaging {
                Button {
                    store.removeBrowsingHistory(postIDs: selectedIDs)
                    selectedIDs.removeAll()
                    if posts.isEmpty {
                        isManaging = false
                    }
                } label: {
                    Text(selectedIDs.isEmpty ? "选择要删除的记录" : "删除 \(selectedIDs.count) 条记录")
                        .font(.system(size: 16, weight: .black))
                        .foregroundStyle(selectedIDs.isEmpty ? Theme.muted : .white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(selectedIDs.isEmpty ? Theme.panelRaised : Theme.hotPink, in: Capsule())
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        .padding(.bottom, 8)
                }
                .disabled(selectedIDs.isEmpty)
                .buttonStyle(.plain)
                .background(.ultraThinMaterial)
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .navigationBarHidden(true)
        .toolbar(.hidden, for: .tabBar)
    }
}

struct HistoryWaterfallGrid: View {
    let posts: [GroupBuyPost]
    let isManaging: Bool
    @Binding var selectedIDs: Set<String>

    private var columnWidth: CGFloat {
        FeedCardMetrics.columnWidth(screenWidth: UIScreen.main.bounds.width)
    }

    private var leftPosts: [GroupBuyPost] {
        posts.enumerated().filter { $0.offset.isMultiple(of: 2) }.map(\.element)
    }

    private var rightPosts: [GroupBuyPost] {
        posts.enumerated().filter { !$0.offset.isMultiple(of: 2) }.map(\.element)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            LazyVStack(spacing: 14) {
                ForEach(leftPosts) { post in
                    HistoryCard(post: post, cardWidth: columnWidth, isManaging: isManaging, isSelected: selectedIDs.contains(post.id)) {
                        toggle(post.id)
                    }
                }
            }
            LazyVStack(spacing: 14) {
                ForEach(rightPosts) { post in
                    HistoryCard(post: post, cardWidth: columnWidth, isManaging: isManaging, isSelected: selectedIDs.contains(post.id)) {
                        toggle(post.id)
                    }
                }
            }
        }
    }

    private func toggle(_ id: String) {
        if selectedIDs.contains(id) {
            selectedIDs.remove(id)
        } else {
            selectedIDs.insert(id)
        }
    }
}

struct HistoryCard: View {
    @EnvironmentObject private var store: MockAppStore
    let post: GroupBuyPost
    let cardWidth: CGFloat
    let isManaging: Bool
    let isSelected: Bool
    let toggleSelection: () -> Void

    var author: User {
        store.user(id: post.authorID)
    }

    var body: some View {
        Group {
            if isManaging {
                Button(action: toggleSelection) {
                    cardBody
                }
                .buttonStyle(.plain)
            } else {
                NavigationLink(value: Route.postDetail(post.id)) {
                    cardBody
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var cardBody: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topTrailing) {
                PostImageView(post: post)
                    .scaledToFill()
                    .frame(width: cardWidth, height: FeedCardMetrics.imageHeight(for: cardWidth))
                    .clipped()
                if isManaging {
                    Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 25, weight: .bold))
                        .foregroundStyle(isSelected ? Theme.hotPink : .white)
                        .shadow(radius: 4)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                        .padding(8)
                }
            }
            .frame(width: cardWidth, height: FeedCardMetrics.imageHeight(for: cardWidth))

            VStack(alignment: .leading, spacing: 10) {
                Text(post.title)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 7) {
                    AvatarView(user: author, size: 24)
                    Text(author.nickname)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.subtext)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Image(systemName: "heart")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                    Text(post.favoriteCount.formattedCount)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.subtext)
                }
            }
            .padding(10)
        }
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 3, style: .continuous))
        .frame(width: cardWidth)
    }
}

struct ProfileSideMenu: View {
    @EnvironmentObject private var store: MockAppStore
    @Binding var isMenuOpen: Bool

    var body: some View {
        VStack(spacing: 18) {
            VStack(spacing: 6) {
                NavigationLink(value: Route.drafts) {
                    DrawerRowContent(icon: "tray", title: "我的草稿")
                }
                .simultaneousGesture(TapGesture().onEnded(closeMenuAfterNavigation))
                .buttonStyle(.plain)

                NavigationLink(value: Route.browsingHistory) {
                    DrawerRowContent(icon: "clock.arrow.circlepath", title: "浏览记录")
                }
                .simultaneousGesture(TapGesture().onEnded(closeMenuAfterNavigation))
                .buttonStyle(.plain)

                NavigationLink(value: Route.settings) {
                    DrawerRowContent(icon: "gearshape", title: "设置")
                }
                .simultaneousGesture(TapGesture().onEnded(closeMenuAfterNavigation))
                .buttonStyle(.plain)
            }
            .padding(.vertical, 12)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

            VStack(spacing: 6) {
                Button {
                    store.logOut()
                    closeMenu()
                } label: {
                    DrawerRowContent(icon: "rectangle.portrait.and.arrow.right", title: "退出登录")
                }
                .buttonStyle(.plain)
            }
            .padding(.vertical, 12)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

            Spacer()
        }
        .padding(.horizontal, 18)
        .padding(.top, 112)
        .frame(width: 330)
        .frame(maxHeight: .infinity)
        .background(Theme.background.ignoresSafeArea())
    }

    private func closeMenu() {
        withAnimation(.spring(response: 0.34, dampingFraction: 0.86)) {
            isMenuOpen = false
        }
    }

    private func closeMenuAfterNavigation() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
            closeMenu()
        }
    }
}

struct DrawerRow: View {
    let icon: String
    let title: String
    var badge: String? = nil

    var body: some View {
        DrawerRowContent(icon: icon, title: title, badge: badge)
    }
}

struct DrawerRowContent: View {
    let icon: String
    let title: String
    var badge: String? = nil

    var body: some View {
        HStack(spacing: 18) {
            Image(systemName: icon)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(Theme.text)
                .frame(width: 40, height: 40)
            Text(title)
                .font(.system(size: 19, weight: .bold))
                .foregroundStyle(Theme.text)
            Spacer()
            if let badge {
                Text(badge)
                    .font(.system(size: 13, weight: .black))
                    .foregroundStyle(.white)
                    .frame(width: 28, height: 28)
                    .background(Theme.hotPink, in: Circle())
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 7)
    }
}

struct DrawerBottomButton: View {
    let icon: String
    let title: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 25, weight: .semibold))
                .foregroundStyle(Theme.subtext)
                .frame(width: 62, height: 62)
                .background(Theme.panelRaised, in: Circle())
            Text(title)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(Theme.muted)
        }
    }
}

struct EditProfileView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var didLoad = false
    @State private var nickname = ""
    @State private var redBookID = ""
    @State private var bio = ""
    @State private var gender = ""
    @State private var birthday = ""
    @State private var region = ""
    @State private var avatarSymbol = ""
    @State private var avatarTint: ColorToken = .amber
    @State private var backgroundImageName = "merch_magazine"
    @State private var avatarImageData: Data?
    @State private var backgroundImageData: Data?
    @State private var avatarPickerItem: PhotosPickerItem?
    @State private var backgroundPickerItem: PhotosPickerItem?

    let tintChoices: [ColorToken] = [.amber, .rose, .violet, .teal, .blue]

    var body: some View {
        let currentUser = store.currentUser
        let canEditNickname = store.canChangeNickname(for: currentUser) || nickname.trimmed == currentUser.nickname
        let previewUser = User(
            id: store.currentUserID,
            nickname: nickname.isEmpty ? currentUser.nickname : nickname,
            bio: bio.isEmpty ? currentUser.bio : bio,
            followingCount: currentUser.followingCount,
            followersCount: currentUser.followersCount,
            postCount: currentUser.postCount,
            isRestricted: false,
            canShowContact: true,
            avatarSymbol: avatarSymbol.isEmpty ? currentUser.avatarSymbol : avatarSymbol,
            avatarTint: avatarTint,
            redBookID: redBookID,
            gender: gender,
            birthday: birthday,
            region: region,
            backgroundImageName: backgroundImageName,
            avatarImageData: avatarImageData,
            backgroundImageData: backgroundImageData,
            avatarURL: currentUser.avatarURL,
            backgroundURL: currentUser.backgroundURL,
            lastNicknameChangedAt: currentUser.lastNicknameChangedAt
        )

        VStack(spacing: 0) {
            HStack {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 28, weight: .medium))
                        .foregroundStyle(Color.black.opacity(0.82))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                Spacer()
                Text("编辑资料")
                    .font(.system(size: 24, weight: .black))
                    .foregroundStyle(Color.black.opacity(0.82))
                Spacer()
                Button("预览") {
                    store.showToast("下方已实时预览")
                }
                .font(.system(size: 19, weight: .black))
                .foregroundStyle(Color.black.opacity(0.82))
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 28)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 28) {
                    VStack(spacing: 14) {
                        PhotosPicker(selection: $avatarPickerItem, matching: .images) {
                            ZStack(alignment: .bottomTrailing) {
                                AvatarView(user: previewUser, size: 126)
                                    .background(.white, in: Circle())
                                Image(systemName: "camera.fill")
                                    .font(.system(size: 20, weight: .bold))
                                    .foregroundStyle(.white)
                                    .frame(width: 38, height: 38)
                                    .background(Color.black.opacity(0.72), in: Circle())
                                    .overlay {
                                        Circle().stroke(.white, lineWidth: 3)
                                    }
                            }
                        }
                        .buttonStyle(.plain)

                        HStack(spacing: 10) {
                            TextField("头像字", text: $avatarSymbol)
                                .font(.system(size: 18, weight: .bold))
                                .foregroundStyle(Color.black.opacity(0.82))
                                .multilineTextAlignment(.center)
                                .frame(width: 86)
                                .padding(.vertical, 9)
                                .background(.white, in: Capsule())
                            ForEach(tintChoices, id: \.self) { tint in
                                Button {
                                    avatarTint = tint
                                } label: {
                                    Circle()
                                        .fill(tint.gradient)
                                        .frame(width: 30, height: 30)
                                        .overlay {
                                            Circle().stroke(avatarTint == tint ? Color.black.opacity(0.82) : Color.clear, lineWidth: 2)
                                        }
                                }
                                .buttonStyle(.plain)
                            }
                        }

                        Text("点击头像可从相册上传")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Color.black.opacity(0.42))
                    }

                    VStack(spacing: 0) {
                        ProfileEditField(title: "名字", placeholder: "填写名字", text: $nickname, textColor: .primary, isEditable: canEditNickname)
                        Text(nicknameHint)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Color.black.opacity(0.42))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16)
                            .padding(.bottom, 14)
                        ProfileReadOnlyInfoRow(title: "ID", value: store.registrationID(for: currentUser.id))
                        PhotosPicker(selection: $backgroundPickerItem, matching: .images) {
                            HStack(spacing: 18) {
                                Text("背景图")
                                    .font(.system(size: 21, weight: .semibold))
                                    .foregroundStyle(Color.black.opacity(0.45))
                                    .frame(width: 112, alignment: .leading)

                                ProfileBackgroundPreview(imageData: backgroundImageData, fallbackName: backgroundImageName)

                                Text("从相册选择")
                                    .font(.system(size: 18, weight: .semibold))
                                    .foregroundStyle(Color.black.opacity(0.72))

                                Spacer()

                                Image(systemName: "chevron.right")
                                    .font(.system(size: 19, weight: .bold))
                                    .foregroundStyle(Color.black.opacity(0.18))
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 18)
                        }
                        .buttonStyle(.plain)

                        if backgroundImageData != nil {
                            Button {
                                backgroundImageData = nil
                            } label: {
                                HStack {
                                    Text("恢复默认背景图")
                                        .font(.system(size: 16, weight: .bold))
                                        .foregroundStyle(Theme.hotPink)
                                    Spacer()
                                }
                                .padding(.horizontal, 146)
                                .padding(.bottom, 16)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .background(.white, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .padding(.horizontal, 16)

                    VStack(spacing: 0) {
                        ProfileEditField(title: "简介", placeholder: "介绍一下自己", text: $bio, textColor: Color.black.opacity(0.42))
                    }
                    .background(.white, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .padding(.horizontal, 16)

                    VStack(spacing: 0) {
                        ProfileEditField(title: "性别", placeholder: "编辑性别", text: $gender, textColor: Color.black.opacity(0.42))
                        ProfileEditField(title: "生日", placeholder: "选择生日", text: $birthday, textColor: Color.black.opacity(0.42))
                        ProfileEditField(title: "地区", placeholder: "选择所在的地区", text: $region, textColor: Color.black.opacity(0.42))
                    }
                    .background(.white, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .padding(.horizontal, 16)

                    Button {
                        saveProfile(shouldDismiss: true)
                    } label: {
                        Text("保存资料")
                            .font(.system(size: 20, weight: .black))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(Theme.hotPink, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 30)
                }
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(Color(red: 0.95, green: 0.95, blue: 0.95).ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .navigationBarHidden(true)
        .toolbar(.hidden, for: .tabBar)
        .onAppear(perform: loadProfile)
        .onChange(of: avatarPickerItem) { _, item in
            loadImage(from: item, maxSide: 512, compressionQuality: 0.72) { data in
                avatarImageData = data
            }
        }
        .onChange(of: backgroundPickerItem) { _, item in
            loadImage(from: item, maxSide: 1200, compressionQuality: 0.72) { data in
                backgroundImageData = data
            }
        }
    }

    private var nicknameHint: String {
        let user = store.currentUser
        guard let nextDate = store.nextNicknameChangeDate(for: user),
              !store.canChangeNickname(for: user) else {
            return "名字四个月只能修改一次"
        }
        return "名字四个月只能修改一次，下次可在 \(nextDate.shortDateOnlyText) 修改"
    }

    private func loadProfile() {
        guard !didLoad else { return }
        let user = store.currentUser
        nickname = user.nickname
        redBookID = user.redBookID
        bio = user.bio
        gender = user.gender
        birthday = user.birthday
        region = user.region
        avatarSymbol = user.avatarSymbol
        avatarTint = user.avatarTint
        backgroundImageName = user.backgroundImageName
        avatarImageData = user.avatarImageData
        backgroundImageData = user.backgroundImageData
        didLoad = true
    }

    private func saveProfile(shouldDismiss: Bool) {
        store.updateCurrentProfile(
            nickname: nickname,
            redBookID: redBookID,
            bio: bio,
            gender: gender,
            birthday: birthday,
            region: region,
            avatarSymbol: avatarSymbol,
            avatarTint: avatarTint,
            backgroundImageName: backgroundImageName,
            avatarImageData: avatarImageData,
            backgroundImageData: backgroundImageData
        )
        if shouldDismiss {
            dismiss()
        }
    }

    private func loadImage(from item: PhotosPickerItem?, maxSide: CGFloat, compressionQuality: CGFloat, assign: @escaping (Data?) -> Void) {
        guard let item else { return }
        Task {
            if let data = try? await item.loadTransferable(type: Data.self) {
                let normalizedData = ImageDataNormalizer.jpegData(from: data, maxSide: maxSide, compressionQuality: compressionQuality)
                await MainActor.run {
                    assign(normalizedData)
                }
            }
        }
    }
}

struct ProfileBackgroundPreview: View {
    let imageData: Data?
    let fallbackName: String

    var body: some View {
        Group {
            if let imageData,
               let image = UIImage(data: imageData) {
                Image(uiImage: image)
                    .resizable()
            } else {
                BundleImage(name: fallbackName)
            }
        }
        .scaledToFill()
        .frame(width: 78, height: 54)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.black.opacity(0.08), lineWidth: 1)
        }
    }
}

struct ProfileEditField: View {
    let title: String
    let placeholder: String
    @Binding var text: String
    let textColor: Color
    var isEditable = true

    var body: some View {
        HStack(spacing: 18) {
            Text(title)
                .font(.system(size: 21, weight: .semibold))
                .foregroundStyle(Color.black.opacity(0.45))
                .frame(width: 112, alignment: .leading)
            TextField(placeholder, text: $text)
                .font(.system(size: 21, weight: .semibold))
                .foregroundStyle(text.isEmpty ? Color.black.opacity(0.32) : Color.black.opacity(0.82))
                .tint(Theme.hotPink)
                .disabled(!isEditable)
                .opacity(isEditable ? 1 : 0.52)
            Image(systemName: "chevron.right")
                .font(.system(size: 19, weight: .bold))
                .foregroundStyle(Color.black.opacity(0.18))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 20)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Color.black.opacity(0.08))
                .frame(height: 0.5)
                .padding(.leading, 146)
        }
    }
}

struct ProfileReadOnlyInfoRow: View {
    let title: String
    let value: String

    var body: some View {
        HStack(spacing: 18) {
            Text(title)
                .font(.system(size: 21, weight: .semibold))
                .foregroundStyle(Color.black.opacity(0.45))
                .frame(width: 112, alignment: .leading)
            Text(value)
                .font(.system(size: 21, weight: .semibold))
                .foregroundStyle(Color.black.opacity(0.82))
            Spacer()
            Image(systemName: "lock.fill")
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(Color.black.opacity(0.22))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 20)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Color.black.opacity(0.08))
                .frame(height: 0.5)
                .padding(.leading, 146)
        }
    }
}

struct FavoritesView: View {
    @EnvironmentObject private var store: MockAppStore

    var favoritePosts: [GroupBuyPost] {
        store.sortedFeedPosts(store.activePosts.filter { store.favoritePostIDs.contains($0.id) })
    }

    var body: some View {
        ScrollView {
            WaterfallGrid(posts: favoritePosts)
                .padding(12)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("我的收藏")
    }
}

struct ReminderCenterView: View {
    @EnvironmentObject private var store: MockAppStore

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                ForEach(store.currentUserReminders) { reminder in
                    if let post = store.post(id: reminder.postID) {
                        NavigationLink(value: Route.postDetail(post.id)) {
                            ReminderLargeCard(post: post, reminder: reminder)
                        }
                        .buttonStyle(.plain)
                    }
                }
                if store.currentUserReminders.isEmpty {
                    ProfileEmptyState(text: "暂无截团提醒", icon: "bell")
                        .frame(height: 360)
                }
            }
            .padding(16)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("截团提醒")
    }
}

struct TagContentView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var sort = "最热"
    let tag: String

    var posts: [GroupBuyPost] {
        let tagged = store.posts(tagged: tag)
        switch sort {
        case "最新":
            return store.sortedFeedPosts(tagged)
        default:
            return tagged.sorted { lhs, rhs in
                if lhs.isEnded != rhs.isEnded {
                    return !lhs.isEnded
                }
                return lhs.likedCount > rhs.likedCount
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    HStack(spacing: 8) {
                        Button {
                            dismiss()
                        } label: {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 27, weight: .medium))
                                .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Theme.text)

                        Text("# \(tag)")
                            .font(.system(size: 23, weight: .black))
                            .foregroundStyle(Theme.text)
                            .lineLimit(1)

                        Spacer()

                        NavigationLink(value: Route.search) {
                            Image(systemName: "magnifyingglass")
                                .font(.system(size: 27, weight: .medium))
                                .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Theme.text)

                        EmptyView()
                    }
                    .padding(.horizontal, 12)
                    .padding(.top, 12)
                    .padding(.bottom, 8)
                    .background(Theme.background)

                    HStack(spacing: 38) {
                        ForEach(["最热", "最新"], id: \.self) { item in
                            Button {
                                sort = item
                            } label: {
                                VStack(spacing: 8) {
                                    Text(item)
                                        .font(.system(size: 22, weight: sort == item ? .black : .semibold))
                                        .foregroundStyle(sort == item ? Theme.text : Theme.subtext)
                                    Capsule()
                                        .fill(sort == item ? Theme.hotPink : Color.clear)
                                        .frame(width: 42, height: 4)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                        Spacer()
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 18)
                    .padding(.bottom, 14)

                    WaterfallGrid(posts: posts.isEmpty ? store.sortedFeedPosts(store.activePosts) : posts)
                        .padding(.horizontal, 12)
                        .padding(.bottom, 28)
                }
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .navigationBarHidden(true)
        .toolbar(.hidden, for: .tabBar)
    }
}

struct UserProfileView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var selectedTab = "制品"
    @State private var pendingBlockConfirmation: BlockConfirmation?
    let userID: String

    private let tabs = ["制品", "拼团合集"]

    var userPosts: [GroupBuyPost] {
        store.profilePosts(userID: userID)
    }

    var body: some View {
        let user = store.user(id: userID)
        GeometryReader { proxy in
            let width = proxy.size.width
            let headerHeight: CGFloat = 486
            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    ZStack(alignment: .top) {
                        UserBackgroundImage(user: user)
                            .scaledToFill()
                            .frame(width: width, height: headerHeight)
                            .clipped()
                            .overlay(.black.opacity(0.52))
                            .overlay(
                                LinearGradient(
                                    colors: [.black.opacity(0.04), .black.opacity(0.28), Theme.background.opacity(0.82)],
                                    startPoint: .top,
                                    endPoint: .bottom
                                )
                            )

                        VStack(alignment: .leading, spacing: 20) {
                            HStack {
                                Button {
                                    dismiss()
                                } label: {
                                    Image(systemName: "chevron.left")
                                        .font(.system(size: 31, weight: .medium))
                                        .foregroundStyle(.white)
                                        .frame(width: 48, height: 48)
                                        .background(.black.opacity(0.22), in: Circle())
                                }
                                .buttonStyle(.plain)

                                Spacer()
                            }

                            Spacer(minLength: 20)

                            HStack(alignment: .center, spacing: 18) {
                                AvatarView(user: user, size: 108)
                                    .background(.white.opacity(0.92), in: Circle())
                                    .overlay {
                                        Circle().stroke(.white.opacity(0.72), lineWidth: 1)
                                    }
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(user.nickname)
                                        .font(.system(size: 31, weight: .black))
                                        .foregroundStyle(.white)
                                        .lineLimit(1)
                                    HStack(spacing: 8) {
                                        Text("小红书号：\(store.registrationID(for: user.id))")
                                        Image(systemName: "doc.on.doc")
                                    }
                                    .font(.system(size: 17, weight: .bold))
                                    .foregroundStyle(.white.opacity(0.68))
                                }
                            }

                            HStack(spacing: 26) {
                                NavigationLink(value: Route.userRelations(user.id, .following)) {
                                    StatInline(value: "\(store.followingUsers(for: user.id).count)", title: "关注")
                                }
                                .buttonStyle(.plain)
                                NavigationLink(value: Route.userRelations(user.id, .followers)) {
                                    StatInline(value: "\(store.followerUsers(for: user.id).count)", title: "粉丝")
                                }
                                .buttonStyle(.plain)
                                StatInline(value: "\(userPosts.reduce(0) { $0 + $1.likedCount + $1.favoriteCount })", title: "获赞与收藏")
                            }

                            Text(user.bio == "点击这里，填写简介" ? "这个人还没有填写简介" : user.bio)
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundStyle(.white.opacity(0.9))
                                .lineSpacing(6)
                                .lineLimit(4)

                            HStack(spacing: 12) {
                                Button {
                                    store.toggleFollow(userID: user.id)
                                } label: {
                                    Text(user.id == store.currentUserID ? "自己的主页" : (store.followedUserIDs.contains(user.id) ? "已关注" : "关注"))
                                        .font(.system(size: 20, weight: .black))
                                        .foregroundStyle(.white)
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 15)
                                        .background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                }
                                .buttonStyle(.plain)
                                .disabled(user.id == store.currentUserID || store.isBlocked(user.id))

                                if let threadID = store.directMessageThreadRouteID(for: user.id) {
                                    NavigationLink(value: Route.chat(threadID)) {
                                        Text("发私信")
                                            .font(.system(size: 20, weight: .black))
                                            .foregroundStyle(.white)
                                            .frame(maxWidth: .infinity)
                                            .padding(.vertical, 15)
                                            .background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                    }
                                    .buttonStyle(.plain)
                                    .simultaneousGesture(
                                        TapGesture().onEnded {
                                            _ = store.directMessageThreadID(for: user.id)
                                        }
                                    )
                                } else {
                                    Button {
                                        _ = store.directMessageThreadID(for: user.id)
                                    } label: {
                                        Text("发私信")
                                            .font(.system(size: 20, weight: .black))
                                            .foregroundStyle(.white)
                                            .frame(maxWidth: .infinity)
                                            .padding(.vertical, 15)
                                            .background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                    }
                                    .buttonStyle(.plain)
                                    .disabled(user.id == store.currentUserID)
                                }
                            }

                            if user.id != store.currentUserID {
                                Button {
                                    pendingBlockConfirmation = BlockConfirmation(
                                        userID: user.id,
                                        nickname: user.nickname,
                                        isUnblock: store.isBlocked(user.id)
                                    )
                                } label: {
                                    Text(store.isBlocked(user.id) ? "已拉黑 · 点击解除" : "拉黑该用户")
                                        .font(.system(size: 15, weight: .bold))
                                        .foregroundStyle(.white.opacity(0.9))
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 12)
                                        .background(.white.opacity(0.10), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                }
                                .buttonStyle(.plain)
                                .padding(.top, 10)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 12)
                        .padding(.bottom, 24)
                        .frame(width: width, height: headerHeight, alignment: .top)
                    }

                    VStack(spacing: 0) {
                        HStack(spacing: 0) {
                            ForEach(tabs, id: \.self) { tab in
                                Button {
                                    withAnimation(AppMotion.quick) {
                                        selectedTab = tab
                                    }
                                } label: {
                                    VStack(spacing: 8) {
                                        Text(tab)
                                            .font(.system(size: 22, weight: selectedTab == tab ? .black : .bold))
                                            .foregroundStyle(selectedTab == tab ? Theme.text : Theme.subtext)
                                        Capsule()
                                            .fill(selectedTab == tab ? Theme.hotPink : Color.clear)
                                            .frame(width: 48, height: 4)
                                    }
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 18)
                                }
                                .buttonStyle(.plain)
                            }
                        }

                        if selectedTab == "拼团合集" {
                            ProfileCollectionsPanel(ownerID: userID, canManage: userID == store.currentUserID)
                                .padding(.bottom, 24)
                        } else if userPosts.isEmpty {
                            ProfileEmptyNotesView(
                                message: profileEmptyMessage(for: user),
                                showsPublishButton: user.id == store.currentUserID
                            )
                                .frame(minHeight: 360)
                        } else {
                            WaterfallGrid(posts: userPosts)
                                .padding(.horizontal, 12)
                                .padding(.bottom, 28)
                        }
                    }
                    .background(Theme.background)
                    .clipShape(UnevenRoundedRectangle(topLeadingRadius: 18, topTrailingRadius: 18, style: .continuous))
                    .offset(y: -10)
                }
                .padding(.bottom, 18)
            }
            .background(Theme.background.ignoresSafeArea())
        }
        .navigationBarBackButtonHidden(true)
        .navigationBarHidden(true)
        .toolbar(.hidden, for: .tabBar)
        .alert(
            Text(pendingBlockConfirmation?.isUnblock == true ? "确认解除拉黑该用户？" : "确认拉黑该用户？"),
            isPresented: Binding(
                get: { pendingBlockConfirmation != nil },
                set: { isPresented in
                    if !isPresented {
                        pendingBlockConfirmation = nil
                    }
                }
            ),
            presenting: pendingBlockConfirmation
        ) { confirmation in
            Button("取消", role: .cancel) {
                pendingBlockConfirmation = nil
            }
            Button("确认", role: confirmation.isUnblock ? nil : ButtonRole.destructive) {
                let userID = confirmation.userID
                pendingBlockConfirmation = nil
                Task {
                    if confirmation.isUnblock {
                        await store.unblockUser(userID)
                    } else {
                        await store.blockUser(userID)
                    }
                }
            }
        } message: { confirmation in
            Text(confirmation.isUnblock
                ? "解除拉黑 \(confirmation.nickname) 后，你会重新看到对方的内容，对方也可以再次私信你。"
                : "拉黑 \(confirmation.nickname) 后，对方将无法私信你，你也会隐藏来自对方的内容。")
        }
        .simultaneousGesture(
            DragGesture(minimumDistance: 30)
                .onEnded { value in
                    guard value.translation.width > 86,
                          abs(value.translation.height) < 72 else { return }
                    dismiss()
                }
        )
    }

    private func profileEmptyMessage(for user: User) -> String {
        if user.id == store.currentUserID { return "你还没有发布过制品" }
        return store.isBlocked(user.id) ? "对方还没发过任何帖子" : "他还没有发布过任何作品"
    }
}

private struct BlockConfirmation: Identifiable {
    let userID: String
    let nickname: String
    let isUnblock: Bool

    var id: String { userID }
}
