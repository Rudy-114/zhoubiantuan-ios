import SwiftUI

struct MarketView: View {
    @EnvironmentObject private var store: MockAppStore

    var posts: [GroupBuyPost] {
        store.sortedFeedPosts(store.activePosts.filter { store.followedUserIDs.contains($0.authorID) })
    }

    var body: some View {
        Group {
            if store.isLoggedIn {
                VStack(spacing: 0) {
                    HStack {
                        Text("关注")
                            .font(.system(size: 28, weight: .black))
                            .foregroundStyle(Theme.text)
                        Spacer()
                        NavigationLink(value: Route.search) {
                            Image(systemName: "magnifyingglass")
                                .font(.system(size: 28, weight: .medium))
                                .foregroundStyle(Theme.text)
                                .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 10)
                    .padding(.bottom, 8)
                    .overlay(alignment: .bottom) {
                        Rectangle().fill(Theme.hairline).frame(height: 0.5)
                    }

                    ScrollView(showsIndicators: false) {
                        FollowingFeedView(posts: posts)
                            .padding(.top, 2)
                    }
                }
                .background(Theme.background.ignoresSafeArea())
            } else {
                GuestAuthView()
            }
        }
        .navigationBarHidden(true)
    }
}
