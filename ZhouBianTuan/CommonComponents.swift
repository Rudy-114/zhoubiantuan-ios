import CryptoKit
import ImageIO
import SwiftUI
import UIKit

private struct PopNavigationRouteActionKey: EnvironmentKey {
    static let defaultValue: (() -> Void)? = nil
}

private struct PopNavigationRouteEnabledKey: EnvironmentKey {
    static let defaultValue = true
}

private struct NavigationBackdropKey: EnvironmentKey {
    static let defaultValue: AnyView? = nil
}

extension EnvironmentValues {
    var popNavigationRoute: (() -> Void)? {
        get { self[PopNavigationRouteActionKey.self] }
        set { self[PopNavigationRouteActionKey.self] = newValue }
    }

    var popNavigationRouteEnabled: Bool {
        get { self[PopNavigationRouteEnabledKey.self] }
        set { self[PopNavigationRouteEnabledKey.self] = newValue }
    }

    var navigationBackdrop: AnyView? {
        get { self[NavigationBackdropKey.self] }
        set { self[NavigationBackdropKey.self] = newValue }
    }
}

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

/// An edge-only, interactive back gesture for screens that hide the system
/// navigation bar.  The screen follows the finger from the initial grab
/// point, resists the last part of the travel, and either settles back or
/// completes the pop based on the release position and projected travel.
struct InteractiveBackSwipeModifier: ViewModifier {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.popNavigationRoute) private var popNavigationRoute
    @Environment(\.popNavigationRouteEnabled) private var popNavigationRouteEnabled
    @Environment(\.navigationBackdrop) private var navigationBackdrop
    @State private var offset: CGFloat = 0
    @State private var isTracking = false
    @State private var isCompleting = false
    private let backdrop: AnyView?
    private let onComplete: (() -> Void)?

    private let edgeWidth: CGFloat = 32
    private let completionDistance: CGFloat = 112

    init<Backdrop: View>(onComplete: (() -> Void)? = nil, @ViewBuilder backdrop: () -> Backdrop) {
        self.backdrop = AnyView(backdrop())
        self.onComplete = onComplete
    }

    init(onComplete: (() -> Void)? = nil) {
        self.backdrop = nil
        self.onComplete = onComplete
    }

    func body(content: Content) -> some View {
        let width = max(UIScreen.main.bounds.width, 1)
        ZStack(alignment: .leading) {
            // A root view can be supplied as the backdrop for its child route.
            // Clear the inherited backdrop while rendering that root view so a
            // root that also uses this modifier cannot recursively render itself.
            (backdrop ?? navigationBackdrop ?? AnyView(Theme.background.ignoresSafeArea()))
                .environment(\.navigationBackdrop, nil)
                .environment(\.popNavigationRouteEnabled, false)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .allowsHitTesting(false)

            content
                .offset(x: offset)
                .overlay(alignment: .leading) {
                    Color.black
                        .opacity(Double(min(0.18, 0.18 * offset / width)))
                        .allowsHitTesting(false)
                }
                .contentShape(Rectangle())
                .simultaneousGesture(
                    DragGesture(minimumDistance: 8, coordinateSpace: .local)
                        .onChanged { value in
                            guard !isCompleting, value.startLocation.x <= edgeWidth else { return }
                            let horizontal = value.translation.width
                            let vertical = value.translation.height
                            if !isTracking {
                                guard horizontal > 0, abs(horizontal) > abs(vertical) * 1.15 else { return }
                                isTracking = true
                            }
                            guard isTracking else { return }
                            offset = rubberBand(max(0, horizontal), width: width)
                        }
                        .onEnded { value in
                            guard isTracking, !isCompleting else { return }
                            isTracking = false
                            let projected = max(value.translation.width, value.predictedEndTranslation.width)
                            let shouldComplete = value.translation.width >= completionDistance
                                || projected >= width * 0.34
                            if shouldComplete {
                                isCompleting = true
                                withAnimation(.easeOut(duration: 0.2), completionCriteria: .removed) {
                                    offset = width
                                } completion: {
                                    // The drag has already animated the screen offscreen.
                                    // Pop only after it finishes, without a second transition.
                                    var transaction = Transaction(animation: nil)
                                    transaction.disablesAnimations = true
                                    withTransaction(transaction) {
                                        if let onComplete {
                                            onComplete()
                                        } else if popNavigationRouteEnabled, let popNavigationRoute {
                                            popNavigationRoute()
                                        } else {
                                            dismiss()
                                        }
                                    }
                                }
                            } else {
                                withAnimation(.interactiveSpring(response: 0.28, dampingFraction: 0.86)) {
                                    offset = 0
                                }
                            }
                        }
                )
                .background {
                    NavigationInteractivePopDisabler()
                        .frame(width: 0, height: 0)
                        .allowsHitTesting(false)
                }
        }
    }

    private func rubberBand(_ distance: CGFloat, width: CGFloat) -> CGFloat {
        let resistanceStart = width * 0.68
        guard distance > resistanceStart else { return distance }
        return resistanceStart + (distance - resistanceStart) * 0.18
    }
}

/// SwiftUI's NavigationStack can keep its UIKit edge-pop recognizer enabled
/// even when the navigation bar is hidden.  Disable that recognizer on screens
/// with the custom gesture so a completed drag cannot start a second pop.
private struct NavigationInteractivePopDisabler: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> Controller {
        Controller()
    }

    func updateUIViewController(_ controller: Controller, context: Context) {
        controller.disableInteractivePop()
    }

    final class Controller: UIViewController {
        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            disableInteractivePop()
        }

        override func viewWillDisappear(_ animated: Bool) {
            super.viewWillDisappear(animated)
            navigationController?.interactivePopGestureRecognizer?.isEnabled = true
        }

        func disableInteractivePop() {
            navigationController?.interactivePopGestureRecognizer?.isEnabled = false
        }
    }
}

extension View {
    func interactiveBackSwipe(onComplete: (() -> Void)? = nil) -> some View {
        modifier(InteractiveBackSwipeModifier(onComplete: onComplete))
    }

    func interactiveBackSwipe<Backdrop: View>(onComplete: (() -> Void)? = nil, @ViewBuilder backdrop: @escaping () -> Backdrop) -> some View {
        modifier(InteractiveBackSwipeModifier(onComplete: onComplete, backdrop: backdrop))
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

    func load(urlString: String, token: String?, accountID: String? = nil) async {
        let requestGeneration = UUID()
        generation = requestGeneration
        state = .loading
        do {
            let data = try await RemoteAssetRequest.data(urlString: urlString, token: token, accountID: accountID)
            guard !Task.isCancelled, generation == requestGeneration else { return }
            guard let image = Self.downsampledImage(from: data) else { state = .failed; return }
            state = .loaded(image)
        } catch {
            guard !Task.isCancelled, generation == requestGeneration else { return }
            state = .failed
        }
    }

    private static func downsampledImage(from data: Data, maxPixelSize: Int = 1600) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize
        ]
        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: cgImage, scale: UIScreen.main.scale, orientation: .up)
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
            await loader.load(urlString: urlString, token: store.backendToken, accountID: store.currentUserID)
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
            await loader.load(urlString: urlString, token: store.backendToken, accountID: store.currentUserID)
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
                    .foregroundStyle(Color(red: 0.78, green: 0.86, blue: 1))
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
        .buttonStyle(.pressFeedback)
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
                        .foregroundStyle(Theme.hotPink)
                }
            }
            TextField(placeholder, text: $text)
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
