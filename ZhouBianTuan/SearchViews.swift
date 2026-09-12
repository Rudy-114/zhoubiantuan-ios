import SwiftUI

struct SearchView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var query = ""
    @State private var committedQuery = ""
    @State private var selectedTab = "全部"
    @State private var selectedFilter = "综合"
    @State private var isManagingHistory = false

    let tabs = ["全部", "拼谷角色", "团长", "商品"]
    let filters = ["综合", "拼谷有货", "跟团", "最新"]

    var activeQuery: String {
        committedQuery.trimmed
    }

    var typedQuery: String {
        query.trimmed
    }

    var isShowingResults: Bool {
        !activeQuery.isEmpty && activeQuery == typedQuery
    }

    var searchContentKey: String {
        if typedQuery.isEmpty {
            return "initial"
        }
        if isShowingResults {
            return "results-\(activeQuery)"
        }
        return "suggestions-\(typedQuery)"
    }

    var suggestions: [String] {
        let keyword = typedQuery
        guard !keyword.isEmpty else { return [] }
        var pool: [String] = [
            "\(keyword) 拼谷",
            "\(keyword) 跟团",
            "\(keyword) 吧唧",
            "\(keyword) 角色余量",
            "\(keyword) 自印团",
            "Bucky Barnes 拼谷",
            "Steve Rogers 角色位",
            "Tony Stark 余量",
            "Loki 挂件",
            "冬兵生日团",
            "巡演小卡",
            "吧唧拼谷",
            "亚克力立牌",
            "自印团补款"
        ]

        for post in store.activePosts {
            pool.append(post.title)
            pool.append(contentsOf: post.categoryTags)
            pool.append(contentsOf: post.fandomTags)
            pool.append(contentsOf: post.unsoldRoles.map(\.name))
        }
        for user in store.users where user.id != store.currentUserID && store.canShowContent(from: user.id) {
            pool.append(user.nickname)
            pool.append(user.redBookID)
            pool.append(user.region)
        }

        let filtered = pool
            .map { $0.trimmed }
            .filter { !$0.isEmpty }
            .filter { SearchMatcher.matches(query: keyword, candidate: $0) }
            .sorted {
                let lhsScore = SearchMatcher.score(query: keyword, candidate: $0)
                let rhsScore = SearchMatcher.score(query: keyword, candidate: $1)
                if lhsScore != rhsScore { return lhsScore > rhsScore }
                return $0.count < $1.count
            }

        let unique = Array(NSOrderedSet(array: filtered)) as? [String] ?? filtered
        return Array((unique.isEmpty ? pool.filter { SearchMatcher.matches(query: String(keyword.prefix(1)), candidate: $0) } : unique).prefix(9))
    }

    var searchPageQuery: ContentQuery {
        if selectedTab == "团长" { return .init(path: "/users", parameters: ["q": activeQuery]) }
        var parameters = ["q": activeQuery]
        if selectedTab == "拼谷角色" { parameters["roles"] = "true" }
        if selectedFilter == "拼谷有货" { parameters["inStock"] = "true" }
        if selectedFilter == "跟团" { parameters["groupType"] = "followGroup" }
        return .init(parameters: parameters)
    }

    var results: [GroupBuyPost] {
        if store.isBackendEnabled { return store.pagePosts(searchPageQuery) }
        let keyword = activeQuery
        var result = store.activePosts
        if !keyword.isEmpty {
            let roleMatches = store.splitGoodsPosts(matchingRole: keyword)
            if selectedTab == "拼谷角色" || selectedFilter == "拼谷有货" || !roleMatches.isEmpty {
                result = roleMatches
            } else {
                result = result
                    .filter { post in
                        SearchMatcher.matches(query: keyword, candidate: post.searchableText)
                    }
                    .sorted { lhs, rhs in
                        let lhsScore = SearchMatcher.score(query: keyword, candidate: lhs.searchableText)
                        let rhsScore = SearchMatcher.score(query: keyword, candidate: rhs.searchableText)
                        if lhsScore != rhsScore { return lhsScore > rhsScore }
                        return lhs.createdAt > rhs.createdAt
                    }
            }
        }
        if selectedFilter == "拼谷有货" {
            result = result.filter { $0.groupType == .splitGoods && !$0.unsoldRoles.filter(\.isAvailable).isEmpty }
        }
        if selectedFilter == "跟团" {
            result = result.filter { $0.groupType == .followGroup }
        }
        switch selectedFilter {
        case "最新":
            return store.sortedFeedPosts(result)
        default:
            return result.sorted { lhs, rhs in
                if lhs.isEnded != rhs.isEnded {
                    return !lhs.isEnded
                }
                return lhs.likedCount > rhs.likedCount
            }
        }
    }

    var leaderResults: [User] {
        if store.isBackendEnabled { return store.pageUsers(searchPageQuery) }
        return store.groupLeaderUsers(matching: activeQuery)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 28, weight: .medium))
                        .foregroundStyle(Theme.text)
                        .frame(width: 42, height: 50)
                }
                .buttonStyle(.plain)

                HStack(spacing: 10) {
                    TextField("搜索角色名 / 团长名", text: $query)
                        .font(.system(size: 20, weight: .semibold))
                        .submitLabel(.search)
                        .textInputAutocapitalization(.never)
                        .foregroundStyle(Theme.text)
                        .onSubmit {
                            submitSearch()
                        }

                    if !query.trimmed.isEmpty {
                        Button {
                            query = ""
                            committedQuery = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 20, weight: .bold))
                                .foregroundStyle(Theme.muted)
                        }
                        .buttonStyle(.plain)
                    }

                    Rectangle()
                        .fill(Theme.hairline)
                        .frame(width: 1, height: 24)

                    Button(action: submitSearch) {
                        Text("搜索")
                            .font(.system(size: 20, weight: .black))
                            .foregroundStyle(Theme.text)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 18)
                .frame(height: 62)
                .background(Theme.panelRaised, in: Capsule())
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, typedQuery.isEmpty ? 20 : 10)

            Group {
                if typedQuery.isEmpty {
                    SearchInitialContent(history: $store.searchHistory, isManaging: $isManagingHistory) { term in
                        commitSearch(term)
                    }
                    .transition(AppMotion.sideCoverTransition)
                } else if !isShowingResults {
                    SearchSuggestionsContent(query: typedQuery, suggestions: suggestions) { suggestion in
                        commitSearch(suggestion)
                    }
                    .transition(AppMotion.sideCoverTransition)
                } else {
                    SearchResultsContent(
                        query: activeQuery,
                        tabs: tabs,
                        selectedTab: $selectedTab,
                        filters: filters,
                        selectedFilter: $selectedFilter,
                        results: results,
                        users: leaderResults,
                        pagingQuery: store.isBackendEnabled ? searchPageQuery : nil
                    )
                    .transition(AppMotion.sideCoverTransition)
                }
            }
            .id(searchContentKey)
        }
        .navigationBarBackButtonHidden(true)
        .navigationBarHidden(true)
        .background(Theme.background.ignoresSafeArea())
        .toolbar(.hidden, for: .tabBar)
        .contentShape(Rectangle())
        .onTapGesture {
            hideKeyboard()
        }
        .simultaneousGesture(
            DragGesture(minimumDistance: 28)
                .onEnded(handleBackSwipe)
        )
    }

    private func submitSearch() {
        commitSearch(query.trimmed.isEmpty ? "Bucky" : query.trimmed)
    }

    private func commitSearch(_ term: String) {
        let trimmed = term.trimmed
        guard !trimmed.isEmpty else { return }
        hideKeyboard()
        withAnimation(AppMotion.page) {
            committedQuery = trimmed
            query = trimmed
            selectedTab = "全部"
            selectedFilter = "综合"
            store.recordSearchHistory(trimmed)
            isManagingHistory = false
        }
    }

    private func handleBackSwipe(_ value: DragGesture.Value) {
        guard value.startLocation.x < 56,
              value.translation.width > 86,
              abs(value.translation.height) < 72 else { return }
        if isShowingResults {
            withAnimation(AppMotion.page) {
                committedQuery = ""
                query = ""
                selectedTab = "全部"
                selectedFilter = "综合"
            }
            return
        }
        dismiss()
    }
}

struct SearchSuggestionsContent: View {
    let query: String
    let suggestions: [String]
    let onSelect: (String) -> Void

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                ForEach(suggestions, id: \.self) { suggestion in
                    Button {
                        onSelect(suggestion)
                    } label: {
                        HStack(spacing: 14) {
                            Image(systemName: "magnifyingglass")
                                .font(.system(size: 22, weight: .medium))
                                .foregroundStyle(Theme.muted)
                                .frame(width: 28)
                            HighlightedSuggestionText(text: suggestion, query: query)
                            Spacer()
                            Image(systemName: "arrow.up.left")
                                .font(.system(size: 22, weight: .medium))
                                .foregroundStyle(Theme.muted)
                        }
                        .padding(.horizontal, 18)
                        .padding(.vertical, 17)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    Divider()
                        .overlay(Theme.hairline)
                        .padding(.leading, 60)
                }
            }
            .padding(.top, 16)
        }
        .scrollDismissesKeyboard(.interactively)
    }
}

struct HighlightedSuggestionText: View {
    let text: String
    let query: String

    var body: some View {
        Text(attributedText)
            .font(.system(size: 20, weight: .semibold))
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var attributedText: AttributedString {
        var value = AttributedString(text)
        value.foregroundColor = Theme.text.opacity(0.88)
        let trimmed = query.trimmed
        if !trimmed.isEmpty,
           let range = value.range(of: trimmed, options: [.caseInsensitive, .diacriticInsensitive]) {
            value[range].foregroundColor = Theme.accent
        }
        return value
    }
}

struct SearchInitialContent: View {
    @Binding var history: [String]
    @Binding var isManaging: Bool
    let onSelect: (String) -> Void

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 22) {
                HStack {
                    Text("历史记录")
                        .font(.system(size: 24, weight: .black))
                        .foregroundStyle(Theme.text)
                    Spacer()
                    if isManaging {
                        Button {
                            withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                                history.removeAll()
                                isManaging = false
                            }
                        } label: {
                            Text("全部删除")
                                .font(.system(size: 20, weight: .semibold))
                                .foregroundStyle(history.isEmpty ? Theme.muted : Theme.subtext)
                        }
                        .disabled(history.isEmpty)
                        .buttonStyle(.plain)

                        Rectangle()
                            .fill(Theme.hairline)
                            .frame(width: 1, height: 22)
                            .padding(.horizontal, 8)

                        Button {
                            withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                                isManaging = false
                            }
                        } label: {
                            Text("完成")
                                .font(.system(size: 20, weight: .semibold))
                                .foregroundStyle(Theme.subtext)
                        }
                        .buttonStyle(.plain)
                    } else {
                        Button {
                            withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                                isManaging = true
                            }
                        } label: {
                            Image(systemName: "trash")
                                .font(.system(size: 22, weight: .semibold))
                                .foregroundStyle(Theme.muted)
                                .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)

                if history.isEmpty {
                    Text("暂无搜索历史")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                        .padding(.horizontal, 16)
                        .padding(.top, 10)
                } else {
                    SearchHistoryWrap(items: history) { item in
                        SearchHistoryChip(title: item, isManaging: isManaging) {
                            onSelect(item)
                        } deleteAction: {
                            withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                                history.removeAll { $0 == item }
                                if history.isEmpty {
                                    isManaging = false
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                }
            }
            .padding(.bottom, 36)
        }
        .scrollDismissesKeyboard(.interactively)
    }
}

struct SearchHistoryChip: View {
    let title: String
    let isManaging: Bool
    let selectAction: () -> Void
    let deleteAction: () -> Void

    private var displayTitle: String {
        title.count > 10 ? "\(title.prefix(10))..." : title
    }

    var body: some View {
        Button {
            if isManaging {
                deleteAction()
            } else {
                selectAction()
            }
        } label: {
            HStack(spacing: 8) {
                Text(displayTitle)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Theme.text.opacity(0.86))
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
                if isManaging {
                    Image(systemName: "xmark")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .background(Theme.panel, in: Capsule())
            .overlay {
                Capsule().stroke(Theme.hairline, lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
    }
}

struct SearchHistoryWrap<Content: View>: View {
    let items: [String]
    let content: (String) -> Content

    var body: some View {
        SearchWrappingLayout(horizontalSpacing: 10, verticalSpacing: 12) {
            ForEach(items, id: \.self) { item in
                content(item)
            }
        }
    }
}

private struct SearchWrappingLayout: Layout {
    let horizontalSpacing: CGFloat
    let verticalSpacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let availableWidth = proposal.width ?? .infinity
        let result = arrangedSubviews(subviews, availableWidth: availableWidth)
        return CGSize(width: proposal.width ?? result.size.width, height: result.size.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrangedSubviews(subviews, availableWidth: bounds.width)
        for index in subviews.indices {
            subviews[index].place(
                at: CGPoint(
                    x: bounds.minX + result.positions[index].x,
                    y: bounds.minY + result.positions[index].y
                ),
                proposal: .unspecified
            )
        }
    }

    private func arrangedSubviews(_ subviews: Subviews, availableWidth: CGFloat) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = availableWidth.isFinite ? availableWidth : .greatestFiniteMagnitude
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var usedWidth: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > maxWidth {
                y += rowHeight + verticalSpacing
                x = 0
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            x += size.width + horizontalSpacing
            rowHeight = max(rowHeight, size.height)
            usedWidth = max(usedWidth, x - horizontalSpacing)
        }

        return (CGSize(width: usedWidth, height: y + rowHeight), positions)
    }
}

struct SearchResultsContent: View {
    @Namespace private var tabIndicator
    let query: String
    let tabs: [String]
    @Binding var selectedTab: String
    let filters: [String]
    @Binding var selectedFilter: String
    let results: [GroupBuyPost]
    let users: [User]
    var pagingQuery: ContentQuery? = nil

    private var resultContentID: String {
        "\(query)-\(selectedTab)-\(selectedFilter)"
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 30) {
                    ForEach(tabs, id: \.self) { tab in
                        Button {
                            withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                                selectedTab = tab
                            }
                        } label: {
                            VStack(spacing: 8) {
                                HStack(spacing: 6) {
                                    if tab == "问一问" {
                                        Image(systemName: "sparkle")
                                            .font(.system(size: 22, weight: .bold))
                                            .foregroundStyle(Color(red: 0.38, green: 0.62, blue: 1))
                                    }
                                    Text(tab)
                                        .font(.system(size: 22, weight: selectedTab == tab ? .black : .semibold))
                                        .foregroundStyle(selectedTab == tab ? Theme.text : Theme.subtext)
                                }
                                ZStack {
                                    if selectedTab == tab {
                                        Capsule()
                                            .fill(Theme.accent)
                                            .matchedGeometryEffect(id: "search-tab-indicator", in: tabIndicator)
                                            .frame(width: 52, height: 4)
                                    } else {
                                        Color.clear.frame(width: 52, height: 4)
                                    }
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 10)
            }

            Rectangle().fill(Theme.hairline).frame(height: 0.5)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 14) {
                    if selectedTab != "团长" {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 10) {
                                ForEach(filters, id: \.self) { filter in
                                    Button {
                                        withAnimation(.spring(response: 0.26, dampingFraction: 0.86)) {
                                            selectedFilter = filter
                                        }
                                    } label: {
                                        HStack(spacing: 6) {
                                            if filter == "拼谷有货" {
                                                Image(systemName: "bag")
                                                    .font(.system(size: 16, weight: .bold))
                                            }
                                            Text(filter)
                                                .font(.system(size: 18, weight: .bold))
                                        }
                                        .foregroundStyle(selectedFilter == filter ? Theme.text : Theme.subtext)
                                        .padding(.horizontal, 16)
                                        .padding(.vertical, 12)
                                        .background(selectedFilter == filter ? Theme.panelRaised : Theme.panel, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.horizontal, 16)
                            .padding(.top, 14)
                        }
                    }

                    Group {
                        if selectedTab == "团长" {
                            if users.isEmpty {
                                SearchEmptyState(icon: "person.crop.circle", text: "没有找到和“\(query)”相关的团长")
                            } else {
                                VStack(spacing: 0) {
                                    ForEach(users) { user in
                                        SearchLeaderRow(userID: user.id)
                                        Divider()
                                            .overlay(Theme.hairline)
                                            .padding(.leading, 96)
                                    }
                                }
                                .padding(.horizontal, 16)
                                .padding(.top, 8)
                            }
                        } else if results.isEmpty {
                            SearchEmptyState(icon: "magnifyingglass", text: "没有找到和“\(query)”相关的内容")
                        } else {
                            WaterfallGrid(posts: results)
                                .padding(.horizontal, 12)
                                .padding(.bottom, 28)
                        }
                    }
                    .id(resultContentID)
                    .transition(AppMotion.sideCoverTransition)
                    .animation(AppMotion.quick, value: resultContentID)
                    if let pagingQuery { ContentPageFooter(query: pagingQuery) }
                }
            }
        }
    }
}

struct SearchEmptyState: View {
    let icon: String
    let text: String

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 42, weight: .light))
            Text(text)
                .font(.system(size: 17, weight: .bold))
                .multilineTextAlignment(.center)
        }
        .foregroundStyle(Theme.muted)
        .frame(maxWidth: .infinity)
        .padding(.top, 80)
    }
}

struct SearchLeaderRow: View {
    @EnvironmentObject private var store: MockAppStore
    let userID: String

    private var user: User {
        store.user(id: userID)
    }

    private var isFollowing: Bool {
        store.followedUserIDs.contains(userID)
    }

    private var isMutual: Bool {
        isFollowing && store.followerUsers(for: userID).contains { $0.id == store.currentUserID }
    }

    private var followTitle: String {
        if isMutual { return "互相关注" }
        return isFollowing ? "已关注" : "关注"
    }

    var body: some View {
        HStack(spacing: 14) {
            NavigationLink(value: Route.userProfile(userID)) {
                HStack(spacing: 14) {
                    AvatarView(user: user, size: 58)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(user.nickname)
                            .font(.system(size: 21, weight: .bold))
                            .foregroundStyle(Theme.text)
                            .lineLimit(1)
                        Text("粉丝 \(user.followersCount.formattedCount)")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Theme.subtext)
                        Text("小红书号：\(user.redBookID.isEmpty ? store.registrationID(for: user.id) : user.redBookID)")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(Theme.subtext)
                            .lineLimit(1)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Spacer(minLength: 10)

            Button {
                withAnimation(.spring(response: 0.24, dampingFraction: 0.84)) {
                    store.toggleFollow(userID: userID)
                }
            } label: {
                Text(followTitle)
                    .font(.system(size: 16, weight: .black))
                    .foregroundStyle(isFollowing ? Theme.text : Theme.accent)
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
                    .frame(minWidth: 78)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .overlay {
                        Capsule()
                            .stroke(isFollowing ? Theme.hairline : Theme.accent, lineWidth: 1.5)
                    }
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 16)
    }
}
