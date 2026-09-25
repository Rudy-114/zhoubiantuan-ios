import CryptoKit
import SwiftUI
import UIKit

// Authenticated assets bypass persistent caches so revocation and account changes take effect.
// A bounded, session-scoped memory cache keeps navigation responsive without persisting
// private images on disk or allowing one account to see another account's cached data.
actor RemoteAssetCache {
    static let shared = RemoteAssetCache()

    private struct Entry {
        let data: Data
        let access: UInt64
    }

    private let maxEntries = 80
    private let maxBytes = 30 * 1024 * 1024
    private var entries: [String: Entry] = [:]
    private var inFlight: [String: Task<Data, Error>] = [:]
    private var accessCounter: UInt64 = 0
    private var totalBytes = 0
    private var generation: UInt64 = 0

    func cachedData(for key: String) -> Data? {
        guard let entry = entries[key] else { return nil }
        accessCounter &+= 1
        entries[key] = Entry(data: entry.data, access: accessCounter)
        return entry.data
    }

    func data(for key: String, load: @escaping @Sendable () async throws -> Data) async throws -> Data {
        if let cached = cachedData(for: key) { return cached }
        if let pending = inFlight[key] { return try await pending.value }

        let requestGeneration = generation
        let pending = Task<Data, Error> { try await load() }
        inFlight[key] = pending
        do {
            let data = try await pending.value
            if generation == requestGeneration {
                insert(data, for: key)
                inFlight[key] = nil
            }
            return data
        } catch {
            if generation == requestGeneration { inFlight[key] = nil }
            throw error
        }
    }

    func removeAll() {
        generation &+= 1
        inFlight.values.forEach { $0.cancel() }
        inFlight.removeAll()
        entries.removeAll()
        totalBytes = 0
    }

    private func insert(_ data: Data, for key: String) {
        guard !data.isEmpty, data.count <= maxBytes else { return }
        if let old = entries.removeValue(forKey: key) { totalBytes -= old.data.count }
        accessCounter &+= 1
        entries[key] = Entry(data: data, access: accessCounter)
        totalBytes += data.count

        while entries.count > maxEntries || totalBytes > maxBytes {
            guard let leastRecentlyUsed = entries.min(by: { $0.value.access < $1.value.access })?.key,
                  let removed = entries.removeValue(forKey: leastRecentlyUsed) else { break }
            totalBytes -= removed.data.count
        }
    }
}

enum RemoteAssetRequest {
    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 30
        configuration.urlCache = nil
        return URLSession(configuration: configuration, delegate: NoAssetRedirects(), delegateQueue: nil)
    }()
    private static let removeLegacyCache: Void = {
        Task.detached(priority: .utility) {
            guard let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return }
            try? FileManager.default.removeItem(at: base.appendingPathComponent("RemoteImageCache", isDirectory: true))
        }
    }()

    static func cachedData(urlString: String, cacheScope: String) async -> Data? {
        guard let url = try? normalizedURL(urlString) else { return nil }
        return await RemoteAssetCache.shared.cachedData(for: cacheKey(url: url, scope: cacheScope))
    }

    static func data(urlString: String, token: String?, cacheScope: String) async throws -> Data {
        _ = removeLegacyCache
        let url = try normalizedURL(urlString)
        let key = cacheKey(url: url, scope: cacheScope)
        return try await RemoteAssetCache.shared.data(for: key) {
            try await fetch(url: url, token: token)
        }
    }

    private static func normalizedURL(_ urlString: String) throws -> URL {
        guard var url = URL(string: urlString),
              let api = URL(string: AliyunBackendClient.currentBaseURLString) else { throw URLError(.badURL) }
        // Cached records from older app versions must also use the visibility gateway.
        if url.host == "img.zhoubiantuanmail.top" {
            url = api.appendingPathComponent("assets").appendingPathComponent(url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
        }
        return url
    }

    private static func cacheKey(url: URL, scope: String) -> String {
        "\(scope)|\(url.absoluteString)"
    }

    private static func fetch(url: URL, token: String?) async throws -> Data {
        guard let api = URL(string: AliyunBackendClient.currentBaseURLString) else { throw URLError(.badURL) }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData)
        if url.scheme == api.scheme && url.host == api.host && url.port == api.port &&
            url.path.hasPrefix(api.path + "/assets/") && token != nil {
            request.setValue("Bearer \(token!)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              http.mimeType?.hasPrefix("image/") == true else { throw URLError(.badServerResponse) }
        try Task.checkCancellation()
        return data
    }
}

private final class NoAssetRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

@MainActor
final class RemoteImageLoader: ObservableObject {
    enum State { case idle, loading, loaded(UIImage), failed }
    @Published private(set) var state: State = .idle
    private var generation = UUID()

    func load(urlString: String, token: String?, cacheScope: String) async {
        let requestGeneration = UUID()
        generation = requestGeneration
        let previousImage: UIImage? = if case .loaded(let image) = state { image } else { nil }
        do {
            if let cached = await RemoteAssetRequest.cachedData(urlString: urlString, cacheScope: cacheScope) {
                guard !Task.isCancelled, generation == requestGeneration else { return }
                guard let image = UIImage(data: cached) else { state = .failed; return }
                state = .loaded(image)
                return
            }
            if previousImage == nil { state = .loading }
            let data = try await RemoteAssetRequest.data(urlString: urlString, token: token, cacheScope: cacheScope)
            guard !Task.isCancelled, generation == requestGeneration else { return }
            guard let image = UIImage(data: data) else { state = .failed; return }
            state = .loaded(image)
        } catch {
            guard !Task.isCancelled, generation == requestGeneration else { return }
            if let previousImage { state = .loaded(previousImage) } else { state = .failed }
        }
    }
}

struct BundleImage: View {
    let name: String

    var body: some View {
        if let image = UIImage(named: name) ?? Bundle.main.url(forResource: name, withExtension: "png").flatMap({ UIImage(contentsOfFile: $0.path) }) {
            Image(uiImage: image)
                .resizable()
        } else {
            Rectangle()
                .fill(Theme.panelRaised)
                .overlay {
                    Image(systemName: "photo")
                        .font(.system(size: 26, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                }
        }
    }
}

struct UploadedImageView: View {
    let data: Data

    var body: some View {
        if let image = UIImage(data: data) {
            Image(uiImage: image)
                .resizable()
        } else {
            Rectangle()
                .fill(Theme.panelRaised)
                .overlay {
                    Image(systemName: "photo")
                        .font(.system(size: 26, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                }
        }
    }
}

struct RemoteImageView: View {
    @EnvironmentObject private var store: MockAppStore
    @State private var retryCount = 0
    let urlString: String
    @StateObject private var loader = RemoteImageLoader()

    var body: some View {
        Group {
            switch loader.state {
            case .loaded(let image):
                Image(uiImage: image).resizable()
            case .idle, .loading:
                imagePlaceholder.overlay { ProgressView().tint(Theme.muted) }
            case .failed:
                imagePlaceholder.overlay {
                    Button { retryCount += 1 } label: {
                        Label("重新加载", systemImage: "arrow.clockwise").font(.caption)
                    }.buttonStyle(.bordered).tint(Theme.muted)
                }
            }
        }
        .task(id: urlString + store.authSessionVersion.uuidString + String(retryCount)) {
            await loader.load(urlString: urlString, token: store.backendToken, cacheScope: store.authSessionVersion.uuidString)
        }
    }

    private var imagePlaceholder: some View {
        Rectangle()
            .fill(Theme.panelRaised)
            .overlay {
                Image(systemName: "photo")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(Theme.muted)
            }
    }
}

struct RemoteImagePreview: View {
    @EnvironmentObject private var store: MockAppStore
    @State private var retryCount = 0
    let urlString: String
    var blurRadius: CGFloat = 0
    @StateObject private var loader = RemoteImageLoader()

    var body: some View {
        Group {
            switch loader.state {
            case .loaded(let image):
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .blur(radius: blurRadius)
            case .idle, .loading:
                imagePlaceholder.overlay { ProgressView().tint(Theme.muted) }
            case .failed:
                imagePlaceholder.overlay {
                    Button { retryCount += 1 } label: {
                        Label("重新加载", systemImage: "arrow.clockwise").font(.caption)
                    }.buttonStyle(.bordered).tint(Theme.muted)
                }
            }
        }
        .task(id: urlString + store.authSessionVersion.uuidString + String(retryCount)) {
            await loader.load(urlString: urlString, token: store.backendToken, cacheScope: store.authSessionVersion.uuidString)
        }
    }

    private var imagePlaceholder: some View {
        Rectangle()
            .fill(Theme.panelRaised)
            .overlay {
                Image(systemName: "photo")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(Theme.muted)
            }
    }
}

struct PostImageView: View {
    let post: GroupBuyPost
    var index = 0
    var preferPreview = false

    var body: some View {
        if preferPreview, post.previewRemoteImageURLs.indices.contains(index), !post.previewRemoteImageURLs[index].isEmpty {
            RemoteImagePreview(urlString: post.previewRemoteImageURLs[index], blurRadius: 0.7)
        } else if post.remoteImageURLs.indices.contains(index) {
            RemoteImageView(urlString: post.remoteImageURLs[index])
        } else if post.uploadedImageData.indices.contains(index) {
            UploadedImageView(data: post.uploadedImageData[index])
        } else {
            let fallbackIndex = max(0, index - post.uploadedImageData.count)
            let imageName = post.imageNames.indices.contains(fallbackIndex) ? post.imageNames[fallbackIndex] : "merch_photocards"
            BundleImage(name: imageName)
        }
    }
}

struct UserBackgroundImage: View {
    let user: User

    var body: some View {
        if !user.backgroundURL.isEmpty {
            RemoteImageView(urlString: user.backgroundURL)
        } else if let imageData = user.backgroundImageData,
           let image = UIImage(data: imageData) {
            Image(uiImage: image)
                .resizable()
        } else {
            BundleImage(name: user.backgroundImageName)
        }
    }
}

struct HeaderTitle: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 30, weight: .black))
                .foregroundStyle(Theme.text)
            Text(subtitle)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Theme.subtext)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.top, 18)
    }
}

struct AvatarView: View {
    let user: User
    let size: CGFloat

    var body: some View {
        Group {
            if !user.avatarURL.isEmpty {
                RemoteImageView(urlString: user.avatarURL)
                    .scaledToFill()
            } else if let imageData = user.avatarImageData,
               let image = UIImage(data: imageData) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Text(user.avatarSymbol)
                    .font(.system(size: size * 0.42, weight: .black))
                    .foregroundStyle(.white)
                    .frame(width: size, height: size)
                    .background(user.avatarTint.gradient, in: Circle())
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay {
            Circle().stroke(Color.white.opacity(0.16), lineWidth: 1)
        }
    }
}

struct SelectChip: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(isSelected ? .white : Theme.subtext)
                .padding(.horizontal, 13)
                .padding(.vertical, 8)
                .background(isSelected ? Theme.accentFill : Theme.panelRaised, in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

struct TagCloud: View {
    let tags: [String]

    var body: some View {
        FlowWrapStatic(items: tags) { tag in
            NavigationLink(value: Route.tag(tag)) {
                Text("#\(tag)")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color(red: 0.78, green: 0.86, blue: 1))
            }
            .buttonStyle(.plain)
        }
    }
}

struct FlowWrap: View {
    let items: [String]
    let selected: String
    let onSelect: (String) -> Void

    var body: some View {
        FlowWrapStatic(items: items) { item in
            SelectChip(title: item, isSelected: item == selected) {
                onSelect(item)
            }
        }
    }
}

struct FlowWrapStatic<Content: View>: View {
    let items: [String]
    let content: (String) -> Content

    var body: some View {
        let columns = [GridItem(.adaptive(minimum: 84), spacing: 8, alignment: .leading)]
        LazyVGrid(columns: columns, alignment: .leading, spacing: 8) {
            ForEach(items, id: \.self) { item in
                content(item)
            }
        }
    }
}

struct InfoRow: View {
    let title: String
    let value: String

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Text(title)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Theme.subtext)
                .frame(width: 84, alignment: .leading)
            Text(value)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.text.opacity(0.88))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
    }
}

struct ContactButton: View {
    let title: String
    let icon: String
    var isEnabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(isEnabled ? .white : Theme.muted)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(isEnabled ? Theme.accentFill : Theme.panelRaised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
    }
}

struct ActionIconButton: View {
    let icon: String
    let title: String
    let tint: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Image(systemName: icon)
                    .font(.system(size: 24, weight: .semibold))
                Text(title)
                    .font(.system(size: 12, weight: .bold))
            }
            .foregroundStyle(tint)
            .frame(width: 46)
        }
        .buttonStyle(.plain)
    }
}

struct RequiredLabel: View {
    let title: String

    init(_ title: String) {
        self.title = title
    }

    var body: some View {
        HStack(spacing: 4) {
            Text(title)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Theme.text)
            Text("*")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Theme.accent)
        }
    }
}

struct PrototypeTextField: View {
    let title: String
    let placeholder: String
    @Binding var text: String
    let required: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                Text(title)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.subtext)
                if required {
                    Text("*")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.accent)
                }
            }
            TextField(placeholder, text: $text)
                .foregroundStyle(Theme.text)
                .padding(13)
                .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
                .overlay {
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(required && text.trimmed.isEmpty ? Theme.accent.opacity(0.45) : Theme.hairline, lineWidth: 1)
                }
        }
    }
}

struct PrototypeTextEditor: View {
    let title: String
    let placeholder: String
    @Binding var text: String
    let required: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                Text(title)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.subtext)
                if required {
                    Text("*")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.accent)
                }
            }
            ZStack(alignment: .topLeading) {
                if text.isEmpty {
                    Text(placeholder)
                        .foregroundStyle(Theme.muted)
                        .padding(.horizontal, 17)
                        .padding(.vertical, 16)
                }
                TextEditor(text: $text)
                    .frame(minHeight: 96)
                    .foregroundStyle(Theme.text)
                    .scrollContentBackground(.hidden)
                    .padding(8)
            }
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .stroke(required && text.trimmed.isEmpty ? Theme.accent.opacity(0.45) : Theme.hairline, lineWidth: 1)
            }
        }
    }
}

struct ConstrainedFormTextEditor: View {
    let title: String
    let placeholder: String
    @Binding var text: String
    let limit: Int
    var errorMessage: String? = nil
    var minHeight: CGFloat = 132

    private var characterCount: Int {
        SafetyReportFormLogic.codePointCount(in: text)
    }

    private var isOverLimit: Bool {
        characterCount > limit
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(title)
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundStyle(Theme.text)
                Spacer()
                Text("\(characterCount)/\(limit)")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(isOverLimit ? Theme.danger : Theme.subtext)
                    .accessibilityLabel("当前输入 \(characterCount) 个字，上限 \(limit) 个字")
            }

            ZStack(alignment: .topLeading) {
                if text.isEmpty {
                    Text(placeholder)
                        .font(.body)
                        .foregroundStyle(Theme.muted)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 14)
                }
                TextEditor(text: $text)
                    .font(.body)
                    .foregroundStyle(Theme.text)
                    .frame(minHeight: minHeight)
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
            }
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(errorMessage != nil || isOverLimit ? Theme.danger.opacity(0.7) : Theme.hairline, lineWidth: 1)
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(Theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

struct TagEditor: View {
    let tags: [String]
    @Binding var selection: Set<String>
    @State private var customTag = ""

    var visibleTags: [String] {
        let customSelected = selection
            .filter { !tags.contains($0) }
            .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
        return tags + customSelected
    }

    var normalizedCustomTag: String {
        customTag.trimmed.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("品类 / 圈层标签")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Theme.text)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 78), spacing: 8)], alignment: .leading, spacing: 8) {
                ForEach(visibleTags, id: \.self) { tag in
                    Button {
                        if selection.contains(tag) {
                            selection.remove(tag)
                        } else {
                            selection.insert(tag)
                        }
                    } label: {
                        Text(tag)
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(selection.contains(tag) ? .white : Theme.subtext)
                            .padding(.horizontal, 11)
                            .padding(.vertical, 8)
                            .background(selection.contains(tag) ? Theme.accentFill : Theme.panel, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            HStack(spacing: 8) {
                TextField("自定义标签", text: $customTag)
                    .foregroundStyle(Theme.text)
                    .padding(12)
                    .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
                    .overlay {
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Theme.hairline, lineWidth: 1)
                    }
                Button {
                    addCustomTag()
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 18, weight: .black))
                        .foregroundStyle(normalizedCustomTag.isEmpty ? Theme.muted : .white)
                        .frame(width: 44, height: 44)
                        .background(normalizedCustomTag.isEmpty ? Theme.panelRaised : Theme.accentFill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(normalizedCustomTag.isEmpty)
            }
        }
    }

    private func addCustomTag() {
        let tag = normalizedCustomTag
        guard !tag.isEmpty else { return }
        selection.insert(tag)
        customTag = ""
    }
}

struct ValidationRow: View {
    let isValid: Bool
    let text: String

    var body: some View {
        Label(text, systemImage: isValid ? "checkmark.circle.fill" : "xmark.circle")
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(isValid ? Color.green.opacity(0.9) : Theme.muted)
    }
}

struct ReminderMiniCard: View {
    let post: GroupBuyPost
    let reminder: Reminder

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: reminder.isUpcoming ? "bell.badge.fill" : "bell.fill")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(Theme.accent)
                .frame(width: 44, height: 44)
                .background(Theme.accent.opacity(0.14), in: Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text(reminder.isUpcoming ? "你收藏的团购即将截团" : "已收藏，留意截团时间")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Theme.text)
                Text("《\(post.title)》\(post.deadline.shortDeadlineText)")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.subtext)
                    .lineLimit(2)
            }
            Spacer()
        }
        .padding(14)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
    }
}

struct ReminderLargeCard: View {
    let post: GroupBuyPost
    let reminder: Reminder

    var body: some View {
        HStack(spacing: 12) {
            PostImageView(post: post)
                .scaledToFill()
                .frame(width: 80, height: 80)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 7) {
                Text(post.title)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)
                Text("截团：\(post.deadline.fullDisplay)")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.subtext)
                Text(reminder.isUpcoming ? "即将截团" : "请留意截团时间")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(reminder.isUpcoming ? Color.green : Theme.accent)
            }
            Spacer()
        }
        .padding(14)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
    }
}

struct ProfileLinkRow: View {
    let title: String
    let subtitle: String
    let icon: String
    let route: Route

    var body: some View {
        NavigationLink(value: route) {
            ProfileRowContent(title: title, subtitle: subtitle, icon: icon, accessory: "chevron.right")
        }
        .buttonStyle(.plain)
    }
}

struct ProfileStaticRow: View {
    let title: String
    let subtitle: String
    let icon: String

    var body: some View {
        ProfileRowContent(title: title, subtitle: subtitle, icon: icon, accessory: "chevron.right")
    }
}

struct ProfileRowContent: View {
    let title: String
    let subtitle: String
    let icon: String
    let accessory: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.accent)
                .frame(width: 42, height: 42)
                .background(Theme.accent.opacity(0.13), in: Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Theme.text)
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.subtext)
            }
            Spacer()
            Image(systemName: accessory)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Theme.muted)
        }
        .padding(14)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
    }
}

struct StatItem: View {
    let value: String
    let title: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.text)
            Text(title)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.subtext)
        }
    }
}

struct AdminMetric: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(value)
                .font(.system(size: 24, weight: .black))
                .foregroundStyle(Theme.text)
            Text(title)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Theme.subtext)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
    }
}

struct AdminActionButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(title == "下架" ? .white : Theme.text)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 9)
                .background(title == "下架" ? Theme.danger : Theme.panelRaised, in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

struct ToastHost: View {
    @EnvironmentObject private var store: MockAppStore

    var body: some View {
        if let message = store.toastMessage {
            Text(message)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .background(.black.opacity(0.82), in: Capsule())
                .padding(.top, 10)
                .transition(.move(edge: .top).combined(with: .opacity))
                .animation(.spring(response: 0.28, dampingFraction: 0.86), value: message)
        }
    }
}
