import CryptoKit
import ImageIO
import SwiftUI
import UIKit

/// Gives every primary app action the same immediate pressed-state feedback.
///
/// `Button` still owns activation and cancellation: pressing down changes the
/// visual state right away, releasing inside fires the action, and dragging
/// outside cancels it. Keeping that behaviour in a ButtonStyle avoids adding
/// competing drag gestures to individual controls.
struct PressFeedbackButtonStyle: ButtonStyle {
    var pressedScale: CGFloat = 0.97
    var pressedOpacity: CGFloat = 0.82

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(Rectangle())
            .scaleEffect(configuration.isPressed ? pressedScale : 1)
            .opacity(configuration.isPressed ? pressedOpacity : 1)
            .animation(.easeOut(duration: 0.08), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == PressFeedbackButtonStyle {
    static var pressFeedback: PressFeedbackButtonStyle { PressFeedbackButtonStyle() }
}

/// Enables the system edge-swipe back gesture on screens that hide the
/// navigation bar. UIKit drives the transition, so the real previous page is
/// shown underneath and `NavigationStack(path:)` is updated automatically.
struct InteractiveBackSwipeModifier: ViewModifier {
    func body(content: Content) -> some View {
        content.background {
            InteractivePopGestureEnabler()
                .frame(width: 0, height: 0)
                .allowsHitTesting(false)
        }
    }
}

/// Hidden navigation bars disable the default pop-gesture delegate. This
/// delegate re-enables it but refuses to begin on the root page: starting an
/// interactive pop with a single view controller freezes UIKit's navigation.
final class PopGestureDelegate: NSObject, UIGestureRecognizerDelegate {
    weak var navigationController: UINavigationController?

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        (navigationController?.viewControllers.count ?? 0) > 1
    }
}

private struct InteractivePopGestureEnabler: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> Controller { Controller() }
    func updateUIViewController(_ controller: Controller, context: Context) {}

    final class Controller: UIViewController {
        private static var delegateKey: UInt8 = 0

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            guard let navigationController,
                  let recognizer = navigationController.interactivePopGestureRecognizer else { return }
            // The recognizer only holds its delegate weakly. Retain one delegate
            // per navigation controller so it outlives individual pages; if it
            // were released after a pop, the root page would lose the depth guard.
            let delegate: PopGestureDelegate
            if let existing = objc_getAssociatedObject(navigationController, &Self.delegateKey) as? PopGestureDelegate {
                delegate = existing
            } else {
                delegate = PopGestureDelegate()
                delegate.navigationController = navigationController
                objc_setAssociatedObject(navigationController, &Self.delegateKey, delegate, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
            }
            recognizer.delegate = delegate
            recognizer.isEnabled = true
        }
    }
}

extension View {
    /// `onComplete` is kept for source compatibility and ignored: the system
    /// pop updates the navigation path by itself.
    func interactiveBackSwipe(onComplete: (() -> Void)? = nil) -> some View {
        modifier(InteractiveBackSwipeModifier())
    }
}

// Authenticated assets bypass persistent caches so revocation and account changes take effect.
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

    private static let coordinator = RemoteAssetRequestCoordinator()

    static func canonicalURLString(_ value: String) -> String {
        guard let incoming = URL(string: value),
              incoming.host == "img.zhoubiantuanmail.top",
              let api = URL(string: AliyunBackendClient.currentBaseURLString) else { return value }
        return api.appendingPathComponent("assets").appendingPathComponent(incoming.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))).absoluteString
    }

    static func data(urlString: String, token: String?, accountID: String? = nil) async throws -> Data {
        _ = removeLegacyCache
        guard let canonical = URL(string: Self.canonicalURLString(urlString)),
              let api = URL(string: AliyunBackendClient.currentBaseURLString) else { throw URLError(.badURL) }
        let url = canonical
        // Cached records from older app versions must also use the visibility gateway.
        let cacheAccount = accountID ?? "public"
        if let cached = await RemoteImageCache.shared.data(for: url.absoluteString, accountID: cacheAccount) {
            return cached
        }
        let requestKey = url.absoluteString + "\n" + cacheAccount
        let data = try await coordinator.run(key: requestKey) {
            var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData)
            if url.scheme == api.scheme && url.host == api.host && url.port == api.port &&
                url.path.hasPrefix(api.path + "/assets/") && token != nil {
                request.setValue("Bearer \(token!)", forHTTPHeaderField: "Authorization")
            }
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                  http.mimeType?.hasPrefix("image/") == true else { throw URLError(.badServerResponse) }
            return data
        }
        try Task.checkCancellation()
        await RemoteImageCache.shared.insert(data, for: url.absoluteString, accountID: cacheAccount)
        return data
    }
}

private actor RemoteAssetRequestCoordinator {
    private var tasks: [String: Task<Data, Error>] = [:]

    func run(key: String, operation: @escaping @Sendable () async throws -> Data) async throws -> Data {
        if let existing = tasks[key] {
            return try await existing.value
        }
        let task = Task { try await operation() }
        tasks[key] = task
        defer { tasks[key] = nil }
        return try await task.value
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

    func load(urlString: String, token: String?, accountID: String? = nil, maxPixelSize: Int = ImagePipeline.Tier.detail) async {
        let requestGeneration = UUID()
        generation = requestGeneration
        let account = accountID ?? "public"
        // A memory hit is shown immediately, without the loading state or a fade.
        if let cached = ImagePipeline.cachedImage(url: urlString, accountID: account, maxPixel: maxPixelSize) {
            state = .loaded(cached)
            return
        }
        state = .loading
        do {
            let image = try await ImagePipeline.image(url: urlString, token: token, accountID: account,
                                                      maxPixel: maxPixelSize, scale: UIScreen.main.scale)
            guard !Task.isCancelled, generation == requestGeneration else { return }
            withAnimation(.easeOut(duration: 0.18)) { state = .loaded(image) }
        } catch {
            guard !Task.isCancelled, generation == requestGeneration else { return }
            state = .failed
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
    /// Decode size in pixels; see `ImagePipeline.Tier`.
    var maxPixelSize: Int = ImagePipeline.Tier.detail
    /// Large single images (post detail) keep a spinner; lists stay quiet.
    var showsProgress = false
    var fillsFrame = false
    @StateObject private var loader = RemoteImageLoader()

    /// Prefers the memory cache on the first frame, before `.task` has run, so
    /// cards scrolled back into view never flash a placeholder.
    private var displayState: RemoteImageLoader.State {
        switch loader.state {
        case .loaded, .failed: return loader.state
        case .idle, .loading:
            if let cached = ImagePipeline.cachedImage(url: urlString, accountID: store.currentUserID, maxPixel: maxPixelSize) {
                return .loaded(cached)
            }
            return loader.state
        }
    }

    var body: some View {
        Group {
            switch displayState {
            case .loaded(let image):
                if fillsFrame {
                    Image(uiImage: image).resizable().scaledToFill().transition(.opacity)
                } else {
                    Image(uiImage: image).resizable().transition(.opacity)
                }
            case .idle, .loading:
                Rectangle()
                    .fill(Theme.panelRaised)
                    .overlay {
                        if showsProgress { ProgressView().tint(Theme.muted) }
                    }
            case .failed:
                RemoteImageFailureView { retryCount += 1 }
            }
        }
        .task(id: urlString + store.authSessionVersion.uuidString + String(retryCount) + String(maxPixelSize)) {
            await loader.load(urlString: urlString, token: store.backendToken, accountID: store.currentUserID,
                              maxPixelSize: maxPixelSize)
        }
    }
}

/// Aspect-filling variant used by cards and thumbnails.
struct RemoteImagePreview: View {
    let urlString: String
    var maxPixelSize: Int = ImagePipeline.Tier.card

    var body: some View {
        RemoteImageView(urlString: urlString, maxPixelSize: maxPixelSize, fillsFrame: true)
    }
}

private struct RemoteImageFailureView: View {
    let retry: () -> Void

    var body: some View {
        Rectangle()
            .fill(Theme.panelRaised)
            .overlay {
                GeometryReader { proxy in
                    Button(action: retry) {
                        if proxy.size.width < 80 {
                            Image(systemName: "arrow.clockwise")
                                .font(.caption)
                                .frame(width: 44, height: 44)
                        } else {
                            Label("重新加载", systemImage: "arrow.clockwise").font(.caption)
                        }
                    }
                    .buttonStyle(.bordered)
                    .tint(Theme.muted)
                    .accessibilityLabel("重新加载图片")
                    .frame(width: proxy.size.width, height: proxy.size.height)
                }
            }
    }
}

struct PostImageView: View {
    let post: GroupBuyPost
    var index = 0
    var preferPreview = false
    /// nil: card tier for previews, detail tier for originals.
    var maxPixelSize: Int? = nil
    var showsProgress = false

    var body: some View {
        if preferPreview, post.previewRemoteImageURLs.indices.contains(index), !post.previewRemoteImageURLs[index].isEmpty {
            RemoteImagePreview(urlString: post.previewRemoteImageURLs[index], maxPixelSize: maxPixelSize ?? ImagePipeline.Tier.card)
        } else if post.remoteImageURLs.indices.contains(index) {
            RemoteImageView(urlString: post.remoteImageURLs[index], maxPixelSize: maxPixelSize ?? ImagePipeline.Tier.detail,
                            showsProgress: showsProgress)
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
            RemoteImageView(urlString: user.backgroundURL, maxPixelSize: ImagePipeline.Tier.background)
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
                RemoteImageView(urlString: user.avatarURL, maxPixelSize: size > 96 ? ImagePipeline.Tier.card : ImagePipeline.Tier.avatar)
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
                .background(isSelected ? Theme.hotPink : Theme.panelRaised, in: Capsule())
        }
        .buttonStyle(.pressFeedback)
    }
}

struct TagCloud: View {
    let tags: [String]

    var body: some View {
        FlowWrapStatic(items: tags) { tag in
            NavigationLink(value: Route.tag(tag)) {
                Text("#\(tag)")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.link)
            }
            .buttonStyle(.pressFeedback)
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
                .background(isEnabled ? Theme.hotPink : Theme.panelRaised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.pressFeedback)
        .disabled(!isEnabled)
    }
}

/// F13: a one-shot result haptic (success / error) raised from an async flow.
/// Each event is distinct, so two failures in a row both play.
struct HapticEvent: Equatable {
    let id = UUID()
    let feedback: SensoryFeedback

    static var success: HapticEvent { HapticEvent(feedback: .success) }
    static var error: HapticEvent { HapticEvent(feedback: .error) }

    static func == (lhs: HapticEvent, rhs: HapticEvent) -> Bool { lhs.id == rhs.id }
}

extension View {
    func hapticEvent(_ event: HapticEvent?) -> some View {
        sensoryFeedback(trigger: event) { _, newValue in newValue?.feedback }
    }
}

struct ActionIconButton: View {
    let icon: String
    let title: String
    let tint: Color
    /// Played on the user's tap only (not when sync or a rollback changes the icon).
    var feedback: SensoryFeedback? = nil
    let action: () -> Void
    @State private var tapCount = 0

    var body: some View {
        Button {
            tapCount += 1
            action()
        } label: {
            VStack(spacing: 2) {
                Image(systemName: icon)
                    .font(.system(size: 24, weight: .semibold))
                Text(title)
                    .font(.system(size: 12, weight: .bold))
            }
            .foregroundStyle(tint)
            .frame(width: 46)
        }
        .buttonStyle(.pressFeedback)
        .sensoryFeedback(trigger: tapCount) { _, _ in feedback }
        .accessibilityLabel(accessibilityTitle)
        .accessibilityValue(title)
        .accessibilityAddTraits(icon.contains("fill") ? .isSelected : [])
    }

    private var accessibilityTitle: String {
        if icon.hasPrefix("heart") { return icon.contains("fill") ? "取消点赞" : "点赞" }
        if icon.hasPrefix("star") { return icon.contains("fill") ? "取消收藏" : "收藏" }
        if icon.hasPrefix("bubble") { return "评论" }
        return title
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
                .foregroundStyle(Theme.hotPink)
        }
    }
}

/// Character limits mirror the server (backend/src/validators.js), which counts
/// Unicode scalars (`Array.from` in JavaScript), not grapheme clusters.
enum InputLimit {
    static let nickname = 20
    static let bio = 200
    static let postTitle = 60
    static let postDescription = 3000
    static let comment = 500
    static let collectionName = 30
    static let contact = 40
    static let groupInfo = 500
    static let pingguNote = 100
    static let shortField = 40

    static func count(_ text: String) -> Int { text.unicodeScalars.count }

    static func clamp(_ text: String, to limit: Int) -> String {
        guard count(text) > limit else { return text }
        var scalars = String.UnicodeScalarView()
        scalars.append(contentsOf: text.unicodeScalars.prefix(limit))
        return String(scalars)
    }
}

extension View {
    /// Drops input beyond `limit` characters. `nil` leaves the field unlimited.
    func characterLimit(_ limit: Int?, text: Binding<String>) -> some View {
        onChange(of: text.wrappedValue) { _, newValue in
            guard let limit else { return }
            let clamped = InputLimit.clamp(newValue, to: limit)
            if clamped != newValue { text.wrappedValue = clamped }
        }
    }
}

struct CharacterCountLabel: View {
    let text: String
    let limit: Int

    var body: some View {
        let count = InputLimit.count(text)
        Text("\(count)/\(limit)")
            .font(.caption2.monospacedDigit())
            .foregroundStyle(count >= limit ? Theme.hotPink : Theme.muted)
            .accessibilityLabel("已输入 \(count) 字，上限 \(limit) 字")
    }
}

struct PrototypeTextField: View {
    let title: String
    let placeholder: String
    @Binding var text: String
    let required: Bool
    /// Server-side character limit; input beyond it is dropped and a counter shown.
    var limit: Int? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                Text(title)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.subtext)
                if required {
                    Text("*")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.hotPink)
                }
                if let limit {
                    Spacer(minLength: 0)
                    CharacterCountLabel(text: text, limit: limit)
                }
            }
            TextField(placeholder, text: $text)
                .characterLimit(limit, text: $text)
                .foregroundStyle(Theme.text)
                .padding(13)
                .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
                .overlay {
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(required && text.trimmed.isEmpty ? Theme.hotPink.opacity(0.45) : Theme.hairline, lineWidth: 1)
                }
        }
    }
}

struct PrototypeTextEditor: View {
    let title: String
    let placeholder: String
    @Binding var text: String
    let required: Bool
    var limit: Int? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                Text(title)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.subtext)
                if required {
                    Text("*")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.hotPink)
                }
                if let limit {
                    Spacer(minLength: 0)
                    CharacterCountLabel(text: text, limit: limit)
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
                    .characterLimit(limit, text: $text)
                    .frame(minHeight: 96)
                    .foregroundStyle(Theme.text)
                    .scrollContentBackground(.hidden)
                    .padding(8)
            }
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .stroke(required && text.trimmed.isEmpty ? Theme.hotPink.opacity(0.45) : Theme.hairline, lineWidth: 1)
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
                            .background(selection.contains(tag) ? Theme.hotPink : Theme.panel, in: Capsule())
                    }
                    .buttonStyle(.pressFeedback)
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
                        .background(normalizedCustomTag.isEmpty ? Theme.panelRaised : Theme.hotPink, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(.pressFeedback)
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
                .foregroundStyle(Theme.hotPink)
                .frame(width: 44, height: 44)
                .background(Theme.hotPink.opacity(0.14), in: Circle())
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
            PostImageView(post: post, maxPixelSize: ImagePipeline.Tier.avatar)
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
                    .foregroundStyle(reminder.isUpcoming ? Color.green : Theme.hotPink)
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
        .buttonStyle(.pressFeedback)
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
                .foregroundStyle(Theme.hotPink)
                .frame(width: 42, height: 42)
                .background(Theme.hotPink.opacity(0.13), in: Circle())
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
                .background(title == "下架" ? Theme.hotPink : Theme.panelRaised, in: Capsule())
        }
        .buttonStyle(.pressFeedback)
    }
}

struct ToastHost: View {
    @EnvironmentObject private var store: MockAppStore

    var body: some View {
        // The animation sits on the container so both insertion and removal animate.
        ZStack {
            if let toast = store.toast {
                HStack(spacing: 10) {
                    if toast.style == .error {
                        Image(systemName: "exclamationmark.circle.fill")
                            .foregroundStyle(Theme.hotPink)
                            .accessibilityHidden(true)
                    }
                    Text(toast.message)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                    if let action = toast.action {
                        Button(action.title) { store.performToastAction() }
                            .font(.system(size: 14, weight: .black))
                            .foregroundStyle(Theme.hotPink)
                            .padding(.leading, 2)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .background(.black.opacity(0.82), in: Capsule())
                .padding(.horizontal, 16)
                .padding(.top, 10)
                .id(toast.id)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.28, dampingFraction: 0.86), value: store.toast?.id)
    }
}
