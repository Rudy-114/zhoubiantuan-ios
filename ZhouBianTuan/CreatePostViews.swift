import SwiftUI
import UIKit
import Photos
import PhotosUI
import UniformTypeIdentifiers

private struct PostSubmissionIdentity: Equatable {
    let fields: [String]
    let images: [Data]
    let roles: [UnsoldRole]
}

struct CreatePostView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var title = ""
    @State private var selectedGroupType: GroupBuyType?
    @State private var selectedCollectionID = "none"
    @State private var uploadedImageData: [Data] = []
    @State private var selectedTags: Set<String> = []
    @State private var priceLowerBound = ""
    @State private var priceUpperBound = ""
    @State private var depositPercent = ""
    @State private var deadline = Calendar.current.date(byAdding: .day, value: 3, to: Date()) ?? Date()
    @State private var condition = ""
    @State private var wechat = ""
    @State private var qq = ""
    @State private var groupInfo = ""
    @State private var description = ""
    @State private var pingguAveragePrice = ""
    @State private var pingguNote = ""
    @State private var newRoleName = ""
    @State private var newRoleQuantity = "1"
    @State private var newRolePriceAdjustment = ""
    @State private var roleDrafts: [UnsoldRole] = []
    @State private var loadedRepublishPostID = ""
    @State private var isLoadingRepublishImages = false
    @State private var isCollectionPickerPresented = false
    @State private var isCreatingCollection = false
    @State private var isPhotoLibraryPresented = false
    @State private var isPublishing = false
    @State private var submissionID = "p-\(UUID().uuidString)"
    @State private var lastSubmission: PostSubmissionIdentity?
    @State private var publishTask: Task<Void, Never>?
    @State private var publishRequestID = UUID()
    @State private var draftOwnerID = ""
    let republishingPostID: String?

    init(republishingPostID: String? = nil) {
        self.republishingPostID = republishingPostID
    }

    let allTags = ["小卡", "吧唧", "立牌", "娃娃", "专辑", "饰品", "杂志", "演唱会周边", "自印团", "预售", "现货"]
    let noCollectionID = "none"

    var selectedCollection: GroupCollection? {
        selectedCollectionID == noCollectionID ? nil : store.collection(id: selectedCollectionID)
    }

    var usesCollection: Bool {
        selectedCollection != nil
    }

    var isRepublishing: Bool {
        republishingPostID != nil
    }

    var isSplitGoods: Bool {
        selectedGroupType == .splitGoods
    }

    var canPublish: Bool {
        selectedGroupType != nil &&
        !title.trimmed.isEmpty &&
        !uploadedImageData.isEmpty &&
        !priceLowerBound.trimmed.isEmpty &&
        !priceUpperBound.trimmed.isEmpty &&
        !condition.trimmed.isEmpty &&
        usesCollection &&
        !description.trimmed.isEmpty &&
        (!isSplitGoods || (!pingguAveragePrice.trimmed.isEmpty && !pingguNote.trimmed.isEmpty && !roleDrafts.filter(\.isAvailable).isEmpty))
    }

    var priceRangeText: String {
        let lower = priceLowerBound.trimmed
        let upper = priceUpperBound.trimmed
        if lower.isEmpty && upper.isEmpty { return "" }
        if upper.isEmpty || lower == upper { return "¥\(lower)" }
        return "¥\(lower)-¥\(upper)"
    }

    var depositText: String {
        let value = finalizedDepositPercent(depositPercent)
        return value.isEmpty ? "无定金" : "定金 \(value)%"
    }

    var body: some View {
        if store.isLoggedIn {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 20) {
                    HeaderTitle(title: isRepublishing ? "重新编辑团购帖" : "发布团购帖", subtitle: isRepublishing ? "提交后会创建新版本，并删除上一版未通过审核的帖子" : "每个帖子必须归入一个拼团合集")
                VStack(alignment: .leading, spacing: 14) {
                    RequiredLabel("拼团类型")
                    HStack(spacing: 10) {
                        ForEach(GroupBuyType.allCases) { type in
                            Button {
                                selectedGroupType = type
                            } label: {
                                VStack(alignment: .leading, spacing: 6) {
                                    Label(type.rawValue, systemImage: type.icon)
                                        .font(.system(size: 17, weight: .black))
                                    Text(type.feedDescription)
                                        .font(.system(size: 12, weight: .bold))
                                        .foregroundStyle(selectedGroupType == type ? .white.opacity(0.82) : Theme.muted)
                                }
                                .foregroundStyle(selectedGroupType == type ? .white : Theme.subtext)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(14)
                                .background(selectedGroupType == type ? type.accent : Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                .overlay {
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(selectedGroupType == type ? type.accent : Theme.hairline, lineWidth: 1)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.horizontal, 16)

                VStack(alignment: .leading, spacing: 10) {
                    RequiredLabel("拼团合集")
                    if store.collections(ownerID: store.currentUserID).isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Label("发布前必须先创建一个合集", systemImage: "rectangle.stack.badge.plus")
                                .font(.system(size: 16, weight: .black))
                                .foregroundStyle(Theme.text)
                            Text("合集会统一保存联系方式、截团时间和默认说明；帖子发布时只能选择已有合集。")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.subtext)
                            Button {
                                isCreatingCollection = true
                            } label: {
                                Label("创建合集", systemImage: "plus")
                                    .font(.system(size: 15, weight: .black))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 18)
                                    .padding(.vertical, 11)
                                    .background(Theme.hotPink, in: Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(14)
                        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    } else {
                        Button {
                            isCollectionPickerPresented = true
                        } label: {
                            CollectionPickerSummary(collection: selectedCollection)
                        }
                        .buttonStyle(.plain)
                    }

                    if let selectedCollection {
                        CollectionSharedInfoCard(collection: selectedCollection)
                    }
                }
                .padding(.horizontal, 16)

                VStack(alignment: .leading, spacing: 12) {
                    RequiredLabel("产品图片")
                    ImageUploadComposer(images: $uploadedImageData) {
                        isPhotoLibraryPresented = true
                    }
                    Text(uploadedImageData.isEmpty ? "点击加号从相册导入图片。" : "拖动图片调整顺序，第一张会作为信息流封面。")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.muted)
                    if isLoadingRepublishImages {
                        Label("正在载入旧帖图片", systemImage: "arrow.down.circle")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Theme.hotPink)
                    }
                }
                .padding(.horizontal, 16)

                VStack(spacing: 12) {
                    PrototypeTextField(title: "标题", placeholder: "例如：巡演限定小卡套组二开", text: $title, required: true)
                    TagEditor(tags: allTags, selection: $selectedTags)
                    VStack(alignment: .leading, spacing: 10) {
                        RequiredLabel("商品价格范围")
                        HStack(spacing: 10) {
                            PrototypeTextField(title: "下限", placeholder: "35", text: $priceLowerBound, required: true)
                                .keyboardType(.decimalPad)
                            PrototypeTextField(title: "上限", placeholder: "68", text: $priceUpperBound, required: true)
                                .keyboardType(.decimalPad)
                        }
                    }
                    PrototypeTextField(title: "定金比例", placeholder: "例如：30", text: $depositPercent, required: false)
                        .keyboardType(.decimalPad)
                        .onChange(of: depositPercent) {
                            let sanitized = sanitizeDepositPercentInput(depositPercent)
                            if sanitized != depositPercent {
                                depositPercent = sanitized
                            }
                        }
                    PrototypeTextField(title: "成团条件", placeholder: "满 60 套开团，未成团退定", text: $condition, required: true)
                    PrototypeTextEditor(title: "团购说明", placeholder: "写清商品内容、规格、余量、表单和周期", text: $description, required: true)
                }
                .padding(.horizontal, 16)

                if isSplitGoods {
                    VStack(alignment: .leading, spacing: 12) {
                        RequiredLabel("拼谷展示信息")
                        PrototypeTextField(title: "当前谷子均价", placeholder: "例如：均价35元/吧唧", text: $pingguAveragePrice, required: true)
                        PrototypeTextEditor(title: "团长自定义描述", placeholder: "例如：目前还缺主角团角色位", text: $pingguNote, required: true)
                        VStack(alignment: .leading, spacing: 10) {
                            RequiredLabel("未被购买角色")
                            if roleDrafts.isEmpty {
                                Text("添加后会用于详情页展示和搜索栏角色筛选。")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(Theme.muted)
                            } else {
                                ForEach(roleDrafts) { role in
                                    HStack {
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(role.name)
                                                .font(.system(size: 15, weight: .bold))
                                                .foregroundStyle(Theme.text)
                                            if role.priceAdjustment != 0 {
                                                Text("角色调价 \(role.priceAdjustmentText)")
                                                    .font(.system(size: 12, weight: .black))
                                                    .foregroundStyle(GroupBuyType.splitGoods.accent)
                                            }
                                        }
                                        Spacer()
                                        Text("(\(role.quantity))")
                                            .font(.system(size: 15, weight: .black))
                                            .foregroundStyle(GroupBuyType.splitGoods.accent)
                                        Button {
                                            roleDrafts.removeAll { $0.id == role.id }
                                        } label: {
                                            Image(systemName: "xmark.circle.fill")
                                                .foregroundStyle(Theme.muted)
                                        }
                                        .buttonStyle(.plain)
                                    }
                                    .padding(12)
                                    .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                }
                            }
                            HStack(spacing: 8) {
                                TextField("角色名，如 Bucky Barnes", text: $newRoleName)
                                    .foregroundStyle(Theme.text)
                                    .padding(12)
                                    .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
                                TextField("数量", text: $newRoleQuantity)
                                    .keyboardType(.numberPad)
                                    .foregroundStyle(Theme.text)
                                    .frame(width: 72)
                                    .padding(12)
                                    .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
                                TextField("调价", text: $newRolePriceAdjustment)
                                    .keyboardType(.numbersAndPunctuation)
                                    .foregroundStyle(Theme.text)
                                    .frame(width: 78)
                                    .padding(12)
                                    .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
                                Button {
                                    addRoleDraft()
                                } label: {
                                    Image(systemName: "plus")
                                        .font(.system(size: 18, weight: .black))
                                        .foregroundStyle(.white)
                                        .frame(width: 44, height: 44)
                                        .background(GroupBuyType.splitGoods.accent, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                }

                VStack(alignment: .leading, spacing: 10) {
                    ValidationRow(isValid: selectedGroupType != nil, text: "已选择拼团类型")
                    ValidationRow(isValid: usesCollection, text: "已选择拼团合集")
                    ValidationRow(isValid: !title.trimmed.isEmpty, text: "已填写标题")
                    ValidationRow(isValid: !uploadedImageData.isEmpty, text: "已上传产品图片")
                    ValidationRow(isValid: !priceLowerBound.trimmed.isEmpty && !priceUpperBound.trimmed.isEmpty, text: "已填写商品价格范围")
                    ValidationRow(isValid: !condition.trimmed.isEmpty, text: "已填写成团条件")
                    ValidationRow(isValid: !description.trimmed.isEmpty, text: "已填写团购说明")
                    if isSplitGoods {
                        ValidationRow(isValid: !pingguAveragePrice.trimmed.isEmpty && !pingguNote.trimmed.isEmpty, text: "已填写拼谷均价和描述")
                        ValidationRow(isValid: !roleDrafts.filter(\.isAvailable).isEmpty, text: "已录入可售角色和数量")
                    }
                }
                .padding(16)
                .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
                .padding(.horizontal, 16)

                Button {
                    if let selectedGroupType, let selectedCollection {
                        let identity = PostSubmissionIdentity(fields: [store.currentUserID, republishingPostID ?? "", title,
                            selectedGroupType.rawValue, selectedCollection.id, priceRangeText, depositText, condition, description,
                            isSplitGoods ? pingguAveragePrice : "", isSplitGoods ? pingguNote : "",
                            selectedCollection.contactWechat, selectedCollection.contactQQ, selectedCollection.contactGroupNumber,
                            selectedCollection.groupInfo, String(selectedCollection.deadline.timeIntervalSince1970)] + selectedTags.sorted(),
                            images: uploadedImageData, roles: isSplitGoods ? roleDrafts.filter(\.isAvailable) : [])
                        if lastSubmission != identity {
                            submissionID = "p-\(UUID().uuidString)"
                            lastSubmission = identity
                        }
                        let requestID = UUID()
                        let session = store.authSessionVersion
                        publishRequestID = requestID
                        isPublishing = true
                        publishTask = Task {
                            guard store.isCurrentSession(session), publishRequestID == requestID else { return }
                            let success = await store.createPost(title: title, groupType: selectedGroupType, collectionID: selectedCollection.id, imageNames: ["merch_photocards"], uploadedImageData: uploadedImageData, tags: selectedTags.sorted(), price: priceRangeText, deposit: depositText, deadline: deadline, condition: condition, wechat: wechat, qq: qq, groupInfo: groupInfo, description: description, pingguAveragePrice: pingguAveragePrice, pingguNote: pingguNote, unsoldRoles: roleDrafts, replacingPostID: republishingPostID, submissionID: submissionID)
                            guard publishRequestID == requestID else { return }
                            isPublishing = false
                            if success {
                                lastSubmission = nil
                                if isRepublishing { dismiss() } else { reset() }
                            }
                        }
                    }
                } label: {
                    Text(isPublishing ? "正在上传并提交审核…" : canPublish ? (isRepublishing ? "重新发布" : "发布到\(selectedGroupType?.moduleTitle ?? "首页")模块") : "补齐必填字段后发布")
                        .font(.system(size: 17, weight: .bold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 15)
                        .background(canPublish ? Theme.hotPink : Theme.panelRaised, in: Capsule())
                        .foregroundStyle(canPublish ? .white : Theme.muted)
                }
                .buttonStyle(.plain)
                .disabled(!canPublish || isPublishing)
                .padding(.horizontal, 16)
                .padding(.bottom, 28)
                }
                .disabled(isPublishing)
            }
            .onChange(of: store.authSessionVersion) { _, _ in
                publishTask?.cancel()
                publishRequestID = UUID()
                isPublishing = false
                lastSubmission = nil
                reset()
            }
            .onAppear {
                if draftOwnerID != store.currentUserID {
                    reset()
                    lastSubmission = nil
                    draftOwnerID = store.currentUserID
                }
            }
            .onDisappear {
                if !store.isLoggedIn || draftOwnerID != store.currentUserID {
                    publishTask?.cancel()
                    publishRequestID = UUID()
                    isPublishing = false
                    lastSubmission = nil
                    reset()
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.background.ignoresSafeArea())
            .navigationBarHidden(true)
            .task(id: republishingPostID) {
                await loadRepublishDraftIfNeeded()
            }
            .sheet(isPresented: $isCollectionPickerPresented) {
                CollectionPickerSheet(
                    collections: store.collections(ownerID: store.currentUserID),
                    selectedCollectionID: $selectedCollectionID
                )
                .presentationDetents([.height(390), .medium])
                .presentationDragIndicator(.hidden)
                .presentationBackground(Theme.background)
            }
            .sheet(isPresented: $isCreatingCollection) {
                CreateCollectionSheet(onCreated: { collectionID in
                    selectedCollectionID = collectionID
                })
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
            }
            .fullScreenCover(isPresented: $isPhotoLibraryPresented) {
                PhotoLibraryImportView(maxSelection: max(1, 16 - uploadedImageData.count)) { importedData in
                    uploadedImageData.append(contentsOf: importedData)
                    uploadedImageData = Array(uploadedImageData.prefix(16))
                }
            }
        } else {
            GuestAuthView()
        }
    }

    func reset() {
        title = ""
        selectedGroupType = nil
        selectedCollectionID = noCollectionID
        uploadedImageData = []
        selectedTags = []
        priceLowerBound = ""
        priceUpperBound = ""
        depositPercent = ""
        condition = ""
        wechat = ""
        qq = ""
        groupInfo = ""
        description = ""
        pingguAveragePrice = ""
        pingguNote = ""
        newRoleName = ""
        newRoleQuantity = "1"
        newRolePriceAdjustment = ""
        roleDrafts = []
    }

    @MainActor
    func loadRepublishDraftIfNeeded() async {
        guard let republishingPostID,
              loadedRepublishPostID != republishingPostID,
              let post = store.post(id: republishingPostID) else { return }
        loadedRepublishPostID = republishingPostID
        title = post.title
        selectedGroupType = post.groupType
        selectedCollectionID = post.collectionID ?? noCollectionID
        selectedTags = Set(post.categoryTags)
        let priceBounds = draftPriceBounds(from: post.price)
        priceLowerBound = priceBounds.lower
        priceUpperBound = priceBounds.upper
        depositPercent = draftDepositPercent(from: post.deposit)
        condition = post.condition
        description = post.description
        pingguAveragePrice = post.pingguAveragePrice
        pingguNote = post.pingguNote
        roleDrafts = post.unsoldRoles
        wechat = post.wechat
        qq = post.qq
        groupInfo = post.groupInfo
        deadline = post.deadline
        uploadedImageData = post.uploadedImageData
        if uploadedImageData.isEmpty && !post.remoteImageURLs.isEmpty {
            isLoadingRepublishImages = true
            uploadedImageData = await loadImageData(from: post.remoteImageURLs)
            isLoadingRepublishImages = false
        }
    }

    func loadImageData(from urlStrings: [String]) async -> [Data] {
        var loaded: [Data] = []
        for urlString in urlStrings.prefix(16) {
            guard let data = try? await RemoteAssetRequest.data(urlString: urlString, token: store.backendToken),
                  UIImage(data: data) != nil else { continue }
            loaded.append(data)
        }
        return loaded
    }

    func addRoleDraft() {
        let quantity = max(1, Int(newRoleQuantity) ?? 1)
        let trimmed = newRoleName.trimmed
        guard !trimmed.isEmpty else { return }
        roleDrafts.append(UnsoldRole(name: trimmed, quantity: quantity, priceAdjustment: parsePriceAdjustment(newRolePriceAdjustment)))
        newRoleName = ""
        newRoleQuantity = "1"
        newRolePriceAdjustment = ""
    }
}

struct ImageUploadComposer: View {
    @Binding var images: [Data]
    let onAdd: () -> Void
    @State private var draggingIndex: Int?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 14) {
                ForEach(Array(images.indices), id: \.self) { index in
                    UploadedImageTile(
                        data: images[index],
                        index: index,
                        isCover: index == 0,
                        images: $images,
                        draggingIndex: $draggingIndex
                    )
                }

                Button(action: onAdd) {
                    VStack(spacing: 12) {
                        Image(systemName: "plus")
                            .font(.system(size: 38, weight: .light))
                        Text(images.isEmpty ? "上传图片" : "继续添加")
                            .font(.system(size: 13, weight: .bold))
                    }
                    .foregroundStyle(Theme.subtext)
                    .frame(width: 132, height: 132)
                    .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Theme.hairline, lineWidth: 1)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("从相册上传产品图片")
            }
            .padding(.vertical, 2)
        }
    }
}

struct UploadedImageTile: View {
    let data: Data
    let index: Int
    let isCover: Bool
    @Binding var images: [Data]
    @Binding var draggingIndex: Int?

    var body: some View {
        ZStack(alignment: .topTrailing) {
            UploadedImageView(data: data)
                .scaledToFill()
                .frame(width: 132, height: 132)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(alignment: .topLeading) {
                    Text(isCover ? "封面" : "\(index + 1)")
                        .font(.system(size: 12, weight: .black))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .background((isCover ? Theme.hotPink : Color.black.opacity(0.58)), in: Capsule())
                        .padding(8)
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(isCover ? Theme.hotPink : Theme.hairline, lineWidth: isCover ? 2 : 1)
                }

            Button {
                guard images.indices.contains(index) else { return }
                images.remove(at: index)
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .black))
                    .foregroundStyle(.white)
                    .frame(width: 26, height: 26)
                    .background(Color.black.opacity(0.68), in: Circle())
                    .padding(7)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("删除第 \(index + 1) 张图片")
        }
        .opacity(draggingIndex == index ? 0.55 : 1)
        .onDrag {
            draggingIndex = index
            return NSItemProvider(object: "\(index)" as NSString)
        }
        .onDrop(of: [UTType.text], delegate: UploadedImageDropDelegate(targetIndex: index, images: $images, draggingIndex: $draggingIndex))
    }
}

struct UploadedImageDropDelegate: DropDelegate {
    let targetIndex: Int
    @Binding var images: [Data]
    @Binding var draggingIndex: Int?

    func dropEntered(info: DropInfo) {
        guard let fromIndex = draggingIndex,
              fromIndex != targetIndex,
              images.indices.contains(fromIndex),
              images.indices.contains(targetIndex) else { return }
        withAnimation(.spring(response: 0.24, dampingFraction: 0.82)) {
            let item = images.remove(at: fromIndex)
            images.insert(item, at: targetIndex)
            draggingIndex = targetIndex
        }
    }

    func performDrop(info: DropInfo) -> Bool {
        draggingIndex = nil
        return true
    }
}

struct PhotoAssetPreview: Identifiable {
    let id: String
    let asset: PHAsset
    var thumbnail: UIImage?
}

struct PhotoLibraryImportView: View {
    @Environment(\.dismiss) private var dismiss
    let maxSelection: Int
    let onImport: ([Data]) -> Void
    @State private var authorizationStatus = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    @State private var assets: [PhotoAssetPreview] = []
    @State private var selectedIDs: [String] = []
    @State private var isLoadingAssets = false
    @State private var isImporting = false
    @State private var importErrorMessage: String?

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 3)

    var body: some View {
        ZStack(alignment: .bottom) {
            Theme.background.ignoresSafeArea()
            VStack(spacing: 0) {
                photoPickerHeader
                photoPickerContent
            }

            if !selectedIDs.isEmpty {
                photoPickerBottomBar
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.26, dampingFraction: 0.86), value: selectedIDs)
        .onAppear(perform: requestPhotoAccess)
    }

    private var photoPickerHeader: some View {
        HStack {
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(Theme.text)
                    .frame(width: 52, height: 52)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("关闭相册选择")

            Spacer()

            HStack(spacing: 6) {
                Text("最近项目")
                    .font(.system(size: 28, weight: .bold))
                Image(systemName: "chevron.down")
                    .font(.system(size: 18, weight: .bold))
            }
            .foregroundStyle(Theme.text)

            Spacer()

            Color.clear
                .frame(width: 52, height: 52)
        }
        .padding(.horizontal, 18)
        .padding(.top, 10)
        .padding(.bottom, 22)
        .background(Theme.background)
    }

    @ViewBuilder
    private var photoPickerContent: some View {
        switch authorizationStatus {
        case .authorized, .limited:
            if isLoadingAssets && assets.isEmpty {
                VStack(spacing: 14) {
                    ProgressView()
                        .tint(Theme.hotPink)
                    Text("正在读取相册")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Theme.muted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if assets.isEmpty {
                VStack(spacing: 14) {
                    Image(systemName: "photo.on.rectangle.angled")
                        .font(.system(size: 44, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                    Text("相册里还没有可选图片")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(Theme.subtext)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView(showsIndicators: false) {
                    LazyVGrid(columns: columns, spacing: 2) {
                        ForEach(assets) { item in
                            PhotoLibraryGridCell(
                                item: item,
                                selectionIndex: selectionIndex(for: item.id),
                                isSelectionDisabled: selectedIDs.count >= maxSelection && selectionIndex(for: item.id) == nil
                            ) {
                                toggleSelection(item.id)
                            }
                        }
                    }
                    .padding(.bottom, selectedIDs.isEmpty ? 18 : 244)
                }
            }
        case .notDetermined:
            permissionPrompt(title: "允许访问相册", message: "发帖上传图片前，需要先允许周边团读取你的照片。", buttonTitle: "继续")
        default:
            permissionPrompt(title: "无法访问相册", message: "请在系统设置中允许周边团访问照片后再上传。", buttonTitle: "重新检查权限")
        }
    }

    private var photoPickerBottomBar: some View {
        VStack(alignment: .leading, spacing: 18) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(selectedIDs, id: \.self) { id in
                        if let item = assets.first(where: { $0.id == id }) {
                            ZStack(alignment: .topTrailing) {
                                PhotoLibraryThumbnailImage(image: item.thumbnail)
                                    .scaledToFill()
                                    .frame(width: 74, height: 74)
                                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                                Button {
                                    toggleSelection(id)
                                } label: {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 11, weight: .black))
                                        .foregroundStyle(.white)
                                        .frame(width: 24, height: 24)
                                        .background(Color.black.opacity(0.72), in: Circle())
                                }
                                .buttonStyle(.plain)
                                .offset(x: 6, y: -6)
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
            }

            HStack {
                Text("可选择\(maxSelection)张图片")
                    .font(.system(size: 22, weight: .black))
                    .foregroundStyle(Theme.text)
                Spacer()
                Button {
                    Task { await importSelectedAssets() }
                } label: {
                    HStack(spacing: 10) {
                        if isImporting {
                            ProgressView()
                                .tint(.white)
                        }
                        Text(isImporting ? "导入中" : "下一步")
                            .font(.system(size: 20, weight: .black))
                    }
                    .foregroundStyle(.white)
                    .frame(width: 170, height: 62)
                    .background(Theme.hotPink, in: Capsule())
                    .overlay(alignment: .topLeading) {
                        Text("\(selectedIDs.count)")
                            .font(.system(size: 17, weight: .black))
                            .foregroundStyle(.white)
                            .frame(width: 38, height: 38)
                            .background(Theme.hotPink, in: Circle())
                            .overlay {
                                Circle().stroke(.white, lineWidth: 3)
                            }
                            .offset(x: -196, y: -88)
                    }
                }
                .buttonStyle(.plain)
                .disabled(isImporting)
            }
            .padding(.horizontal, 26)

            if let importErrorMessage {
                Text(importErrorMessage)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.hotPink)
                    .padding(.horizontal, 26)
            }
        }
        .padding(.top, 20)
        .padding(.bottom, 34)
        .background(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .fill(Theme.panel)
                .ignoresSafeArea(edges: .bottom)
        )
    }

    private func permissionPrompt(title: String, message: String, buttonTitle: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "photo.badge.plus")
                .font(.system(size: 46, weight: .semibold))
                .foregroundStyle(Theme.hotPink)
            Text(title)
                .font(.system(size: 24, weight: .black))
                .foregroundStyle(Theme.text)
            Text(message)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 34)
            Button(buttonTitle) {
                requestPhotoAccess()
            }
            .font(.system(size: 17, weight: .black))
            .foregroundStyle(.white)
            .padding(.horizontal, 26)
            .padding(.vertical, 13)
            .background(Theme.hotPink, in: Capsule())
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func requestPhotoAccess() {
        let currentStatus = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        authorizationStatus = currentStatus
        switch currentStatus {
        case .authorized, .limited:
            loadAssets()
        case .notDetermined:
            PHPhotoLibrary.requestAuthorization(for: .readWrite) { newStatus in
                Task { @MainActor in
                    authorizationStatus = newStatus
                    if newStatus == .authorized || newStatus == .limited {
                        loadAssets()
                    }
                }
            }
        default:
            break
        }
    }

    private func loadAssets() {
        guard !isLoadingAssets else { return }
        isLoadingAssets = true
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        let result = PHAsset.fetchAssets(with: .image, options: options)
        var loaded: [PhotoAssetPreview] = []
        result.enumerateObjects { asset, _, _ in
            loaded.append(PhotoAssetPreview(id: asset.localIdentifier, asset: asset, thumbnail: nil))
        }
        assets = loaded
        isLoadingAssets = false
        loaded.forEach { requestThumbnail(for: $0.asset, id: $0.id) }
    }

    private func requestThumbnail(for asset: PHAsset, id: String) {
        let options = PHImageRequestOptions()
        options.deliveryMode = .opportunistic
        options.resizeMode = .fast
        options.isNetworkAccessAllowed = true
        PHImageManager.default().requestImage(
            for: asset,
            targetSize: CGSize(width: 320, height: 320),
            contentMode: .aspectFill,
            options: options
        ) { image, _ in
            guard let image else { return }
            Task { @MainActor in
                if let index = assets.firstIndex(where: { $0.id == id }) {
                    assets[index].thumbnail = image
                }
            }
        }
    }

    private func toggleSelection(_ id: String) {
        importErrorMessage = nil
        if let index = selectedIDs.firstIndex(of: id) {
            selectedIDs.remove(at: index)
        } else if selectedIDs.count < maxSelection {
            selectedIDs.append(id)
        }
    }

    private func selectionIndex(for id: String) -> Int? {
        selectedIDs.firstIndex(of: id).map { $0 + 1 }
    }

    @MainActor
    private func importSelectedAssets() async {
        guard !isImporting else { return }
        isImporting = true
        importErrorMessage = nil
        var imported: [Data] = []
        for id in selectedIDs {
            guard let asset = assets.first(where: { $0.id == id })?.asset,
                  let data = await imageData(for: asset) else { continue }
            imported.append(data)
        }
        guard !imported.isEmpty else {
            isImporting = false
            importErrorMessage = "图片读取失败，请稍后重试或换一张"
            return
        }
        onImport(imported)
        isImporting = false
        dismiss()
    }

    private func imageData(for asset: PHAsset) async -> Data? {
        await withCheckedContinuation { continuation in
            let manager = PHImageManager.default()
            let options = PHImageRequestOptions()
            options.deliveryMode = .highQualityFormat
            options.isNetworkAccessAllowed = true
            options.resizeMode = .fast

            let lock = NSLock()
            var didResume = false
            var requestID = PHInvalidImageRequestID

            func resume(_ data: Data?) {
                lock.lock()
                guard !didResume else {
                    lock.unlock()
                    return
                }
                didResume = true
                lock.unlock()
                continuation.resume(returning: data.map { ImageDataNormalizer.jpegData(from: $0, maxSide: 1800, compressionQuality: 0.8) })
            }

            requestID = manager.requestImageDataAndOrientation(for: asset, options: options) { data, _, _, info in
                if info?[PHImageCancelledKey] as? Bool == true || info?[PHImageErrorKey] != nil {
                    resume(nil)
                    return
                }
                resume(data)
            }

            DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 15) {
                lock.lock()
                let shouldCancel = !didResume
                lock.unlock()
                if shouldCancel {
                    manager.cancelImageRequest(requestID)
                    resume(nil)
                }
            }
        }
    }
}

struct CameraCaptureView: UIViewControllerRepresentable {
    @Environment(\.dismiss) private var dismiss
    let onCapture: (Data) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let controller = UIImagePickerController()
        controller.sourceType = .camera
        controller.mediaTypes = ["public.image"]
        controller.allowsEditing = false
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    final class Coordinator: NSObject, UINavigationControllerDelegate, UIImagePickerControllerDelegate {
        let parent: CameraCaptureView

        init(parent: CameraCaptureView) {
            self.parent = parent
        }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage,
               let data = ImageDataNormalizer.jpegData(from: image, maxSide: 1800, compressionQuality: 0.8) {
                parent.onCapture(data)
            }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}

struct PhotoLibraryGridCell: View {
    let item: PhotoAssetPreview
    let selectionIndex: Int?
    let isSelectionDisabled: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            GeometryReader { proxy in
                ZStack(alignment: .topTrailing) {
                    PhotoLibraryThumbnailImage(image: item.thumbnail)
                        .scaledToFill()
                        .frame(width: proxy.size.width, height: proxy.size.width)
                        .clipped()
                        .overlay {
                            if selectionIndex != nil {
                                Color.black.opacity(0.18)
                            } else if isSelectionDisabled {
                                Color.black.opacity(0.52)
                            }
                        }

                    selectionCircle
                        .padding(10)
                }
            }
            .aspectRatio(1, contentMode: .fit)
        }
        .buttonStyle(.plain)
        .disabled(isSelectionDisabled)
    }

    @ViewBuilder
    private var selectionCircle: some View {
        if let selectionIndex {
            Text("\(selectionIndex)")
                .font(.system(size: 15, weight: .black))
                .foregroundStyle(.white)
                .frame(width: 34, height: 34)
                .background(Theme.hotPink, in: Circle())
                .overlay {
                    Circle().stroke(.white, lineWidth: 2.5)
                }
        } else {
            Circle()
                .stroke(.white, lineWidth: 2.5)
                .frame(width: 34, height: 34)
                .background(Color.black.opacity(0.08), in: Circle())
        }
    }
}

struct PhotoLibraryThumbnailImage: View {
    let image: UIImage?

    var body: some View {
        if let image {
            Image(uiImage: image)
                .resizable()
        } else {
            Rectangle()
                .fill(Theme.panelRaised)
                .overlay {
                    ProgressView()
                        .tint(Theme.hotPink)
                }
        }
    }
}

struct CollectionPickerSummary: View {
    let collection: GroupCollection?

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(collection == nil ? Theme.panelRaised : Theme.hotPink.opacity(0.18))
                    .frame(width: 46, height: 46)
                Image(systemName: "rectangle.stack.fill")
                    .font(.system(size: 20, weight: .black))
                    .foregroundStyle(collection == nil ? Theme.subtext : Theme.hotPink)
            }

            VStack(alignment: .leading, spacing: 5) {
                Text(collection?.name ?? "请选择合集")
                    .font(.system(size: 18, weight: .black))
                    .foregroundStyle(collection == nil ? Theme.subtext : Theme.text)
                    .lineLimit(1)
                Text(collection == nil ? "每个帖子必须归入一个拼团合集" : "自动继承合集联系方式、截团时间和默认说明")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }

            Spacer()

            Image(systemName: "chevron.up.chevron.down")
                .font(.system(size: 16, weight: .black))
                .foregroundStyle(Theme.hotPink)
        }
        .padding(14)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(collection == nil ? Theme.hairline : Theme.hotPink.opacity(0.48), lineWidth: 1)
        }
        .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct CollectionPickerSheet: View {
    @EnvironmentObject private var store: MockAppStore
    @Environment(\.dismiss) private var dismiss
    @State private var isCreatingCollection = false
    let collections: [GroupCollection]
    @Binding var selectedCollectionID: String

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("选择拼团合集")
                        .font(.system(size: 24, weight: .black))
                        .foregroundStyle(Theme.text)
                    Text("发布前必须选择一个合集")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.subtext)
                }
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 17, weight: .black))
                        .foregroundStyle(Theme.text)
                        .frame(width: 38, height: 38)
                        .background(Theme.panelRaised, in: Circle())
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 18)
            .padding(.top, 18)
            .padding(.bottom, 14)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 10) {
                    ForEach(store.isBackendEnabled ? store.collections(ownerID: store.currentUserID).filter { $0.status == .active } : collections) { collection in
                        CollectionPickerOption(
                            title: collection.name,
                            subtitle: "\(collection.deadline.fullDisplay) 截团 · \(collection.isEnded ? "已结团" : "\(collection.postCount ?? collection.postIDs.count) 篇内容")",
                            icon: "rectangle.stack.fill",
                            isSelected: selectedCollectionID == collection.id,
                            isEnded: collection.isEnded
                        ) {
                            selectedCollectionID = collection.id
                            dismiss()
                        }
                    }

                    ContentPageFooter(query: .collections(store.currentUserID))
                    Button {
                        isCreatingCollection = true
                    } label: {
                        HStack(spacing: 14) {
                            Image(systemName: "plus")
                                .font(.system(size: 22, weight: .black))
                                .foregroundStyle(.white)
                                .frame(width: 56, height: 56)
                                .background(Theme.hotPink, in: RoundedRectangle(cornerRadius: 8, style: .continuous))

                            VStack(alignment: .leading, spacing: 4) {
                                Text("新建拼团合集")
                                    .font(.system(size: 19, weight: .black))
                                    .foregroundStyle(Theme.text)
                                Text("创建后自动选中，用于发布这篇帖子")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundStyle(Theme.subtext)
                                    .lineLimit(1)
                            }

                            Spacer()

                            Image(systemName: "chevron.right")
                                .font(.system(size: 16, weight: .black))
                                .foregroundStyle(Theme.hotPink)
                        }
                        .padding(14)
                        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .stroke(Theme.hotPink.opacity(0.42), lineWidth: 1)
                        }
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 24)
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .sheet(isPresented: $isCreatingCollection) {
            CreateCollectionSheet(onCreated: { collectionID in
                selectedCollectionID = collectionID
                dismiss()
            })
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
    }
}

struct CollectionPickerOption: View {
    let title: String
    let subtitle: String
    let icon: String
    let isSelected: Bool
    let isEnded: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 18, weight: .black))
                    .foregroundStyle(isSelected ? .white : Theme.hotPink)
                    .frame(width: 42, height: 42)
                    .background(isSelected ? Theme.hotPink : Theme.hotPink.opacity(0.14), in: RoundedRectangle(cornerRadius: 8, style: .continuous))

                VStack(alignment: .leading, spacing: 5) {
                    Text(title)
                        .font(.system(size: 18, weight: .black))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    Text(subtitle)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.subtext)
                        .lineLimit(1)
                }

                Spacer()

                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22, weight: .black))
                    .foregroundStyle(isSelected ? Theme.hotPink : Theme.muted)
            }
            .padding(14)
            .background(isSelected ? Theme.panelRaised : Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(isSelected ? Theme.hotPink.opacity(0.7) : Theme.hairline, lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .saturation(isEnded ? 0 : 1)
        .opacity(isEnded ? 0.56 : 1)
    }
}

private func draftPriceBounds(from value: String) -> (lower: String, upper: String) {
    let numbers = draftNumbers(from: value)
    guard let first = numbers.first else { return ("", "") }
    return (first, numbers.dropFirst().first ?? first)
}

private func draftDepositPercent(from value: String) -> String {
    guard !value.contains("无") else { return "" }
    return draftNumbers(from: value).first ?? ""
}

private func draftNumbers(from value: String) -> [String] {
    value.split { character in
        !(character.isNumber || character == ".")
    }
    .map(String.init)
    .filter { !$0.isEmpty }
}
