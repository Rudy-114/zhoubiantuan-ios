import { badRequest } from "./validators.js";

// Reject oversized input rather than silently publishing an unreviewed suffix.
export function validateContent(req, _res, next) {
  try {
    let total = 0;
    function visit(value, depth = 0) {
      if (depth > 5) throw badRequest("内容结构过于复杂");
      if (typeof value === "string") {
        const length = Array.from(value).length;
        if (length > 6000) throw badRequest("单个文本字段不能超过 6000 字");
        total += length;
      } else if (Array.isArray(value)) {
        if (value.length > 64) throw badRequest("列表项目过多");
        value.forEach(item => visit(item, depth + 1));
      } else if (value && typeof value === "object") {
        if (Object.keys(value).length > 64) throw badRequest("字段过多");
        Object.values(value).forEach(item => visit(item, depth + 1));
      }
    }
    visit(req.body);
    if (total > 16000) throw badRequest("提交内容总长度不能超过 16000 字");
    for (const key of ["imageObjectKeys", "previewImageObjectKeys", "imageNames"]) {
      if (req.body?.[key]?.length > 16) throw badRequest("最多上传 16 张图片");
    }
    next();
  } catch (error) { next(error); }
}
