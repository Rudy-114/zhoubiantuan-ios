# 中国大陆 App 备案资源

## Knowledge

- [阿里云：填写 App 信息](https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/fill-in-app-information)
  说明个人、单位备案时需要填写的主体和 App 信息。用于准备周边团备案表单。
- [阿里云：备案服务器检查](https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/icp-filing-server-access-information-check)
  说明通过阿里云备案时，中国内地云资源、实例类型、购买时长和公网带宽等要求。用于判断生产实例是否可备案。
- [阿里云：域名准备与检查](https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/prepare-and-check-the-domain-name)
  说明域名实名认证、注册商和备案主体一致性要求。用于核对 `zhoubiantuanmail.top`。
- [阿里云：上海市备案规则](https://help.aliyun.com/zh/icp-filing/icp-filing-regulations-for-shanghai)
  展示年龄限制具有地域差异：上海个人申请原则上须满 18 周岁，16 至 18 周岁确有需要时由监护人代办并提供监护关系证明。用于理解“监护人代办”与“借用信息”的区别；其他省份应查询对应规则。
- [工信部：关于开展移动互联网应用程序备案工作的通知](https://www.miit.gov.cn/jgsj/xgj/hlwgl/art/2023/art_564bf0759d7e41d5b4aa8ce4996b9e84.html)
  App 备案制度的主管部门说明。用于理解为什么 App 主办者需通过接入服务商提交备案。
- [Apple：Availability in China mainland](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/)
  说明 App Store Connect 对中国大陆 App 备案号和元数据一致性的要求。用于备案通过后的上架操作。
- [工信部：中华人民共和国网络安全法（2025 年修正）](https://sdca.miit.gov.cn/zwgk/fgbz/art/2026/art_4815dd4ec11d454783b83a91502a3cc7.html)
  说明信息发布、即时通讯实名要求，违法信息发现后的停止传输、处置、留存和报告义务，以及警告、罚款、关停、拘留等不同责任层级。用于设计周边团的上线安全底线。
- [最高法、最高检：办理非法利用信息网络、帮助信息网络犯罪活动案件的司法解释](https://www.court.gov.cn/zixun/xiangqing/193711.html)
  说明网络服务提供者、监管责令改正、违法信息大量传播和“明知”等刑事判断标准。用于区分普通用户偶发违法和平台故意纵容、拒不整改。
- [最高人民法院：中华人民共和国民法典](https://www.court.gov.cn/zixun/xiangqing/233181.html)
  第一千一百九十五条至第一千一百九十七条规定网络服务提供者接到有效通知或知道、应当知道侵权后采取必要措施的义务。用于理解平台可能承担的民事连带责任。
- [市场监管总局：中华人民共和国电子商务法](https://www.samr.gov.cn/zfjcj/tzgg/art/2023/art_d337c3291e8b40459ca03dea54395856.html)
  说明平台违法商品/服务处置、报告、消费者和知识产权保护义务及行政处罚。周边团是否被认定为电子商务平台需结合实际功能和监管意见判断。

## Wisdom (Communities)

- 阿里云备案初审专员
  最终服务分类、当地管局材料差异和实例资格应以备案订单中的人工初审意见为准。

## Gaps

- 当前无法从公开信息看到域名持有者的真实姓名或证件号码；必须登录 Rudy 的阿里云域名控制台核对。
- 当前无法从公网确认 ECS 的付费方式、剩余时长和控制台“可备案”状态；必须登录阿里云 ICP 备案系统核对。
- 尚不知道备案主体所在省份和申请人的年龄区间，不能把上海的未成年人规则直接套用到其他地区。
- 周边团当前使用邮箱验证码，但中国大陆信息发布和即时通讯服务的真实身份核验方案尚未完成专项法律与产品确认。
