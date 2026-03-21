# 国际化与本地化规范 (i18n and Localization)

本页基于 W3C 国际化文档、CSS Logical Properties 与 ECMA-402。重点不是“翻译文本”，而是确保方向、排版、日期数值格式和输入输出行为都随语言环境稳定变化。

## 1. 方向与镜像 (Direction and Mirroring)

在从左到右 (LTR) 切换到从右到左 (RTL) 时，应优先依赖文档方向和逻辑属性，而不是写大量特殊分支。

| 类别 | 处理方式 | 说明 |
| :--- | :--- | :--- |
| **页面和主要容器** | 根据语言设置 `dir` | 让浏览器负责基础方向。 |
| **导航、侧边栏、返回箭头** | 通常随布局镜像 | 这些元素表达的是界面流向。 |
| **数字、代码、文件路径** | 通常保持原始书写方向 | 不应因为布局镜像而破坏内容本身。 |
| **品牌和 Logo** | 默认不镜像 | 除非品牌规范明确要求。 |

## 2. 双向文本支持 (Bidi Support)

### 2.1 `dir="auto"` 与 `bdi`

- **动态用户内容**: 对 Thread 标题、消息预览、用户名等混合语言内容，优先使用 `dir="auto"`。
- **内联混排**: 当句子里嵌入用户输入、变量值或他语文本时，优先考虑 `bdi` 或等效隔离策略，避免标点和短文本方向紊乱。

### 2.2 逻辑方向属性

代码层面优先使用逻辑属性而不是物理方向属性:

- 使用 `margin-inline-start` 代替 `margin-left`
- 使用 `padding-inline-end` 代替 `padding-right`
- 使用 `inset-inline-start` 代替 `left`
- 使用 `border-start-end-radius` 处理方向敏感圆角

## 3. 文本扩张与布局适配 (Text Expansion and Layout)

不同语言的字数、词长和断行方式差异很大，因此:

- **避免固定宽度**: 尤其是按钮、标签、筛选器和导航项。
- **优先让容器伸缩**: 使用 Grid、Flex 与 `minmax()` / 百分比宽度，而不是静态像素。
- **截断是最后手段**: 如果必须截断，多行文本可用 line clamp；单行文本除了省略号，还应提供键盘和触屏可访问的完整查看方式，而不只是在 hover 时显示 tooltip。

## 4. 日期、货币与单位

- **后端传输**: 日期时间使用 ISO 8601 这类机器可交换格式。
- **前端呈现**: 使用 `Intl.DateTimeFormat`、`Intl.NumberFormat` 等本地化 API，而不是手写格式拼接。
- **货币与单位**: 金额、百分比、距离、温度等按地区与账户设置呈现；不要假设所有用户都使用公制或相同的小数分隔符。

## 5. 规范依据 (Authority)

- [Structural markup and right-to-left text in HTML](https://www.w3.org/International/questions/qa-html-dir)
- [Inline markup and bidirectional text in HTML](https://www.w3.org/International/articles/inline-bidi-markup/index.en.html)
- [CSS Logical Properties and Values Level 1](https://www.w3.org/TR/css-logical-1/)
- [ECMAScript Internationalization API (ECMA-402)](https://tc39.es/ecma402/)
- [统一来源基线](./UX_AUTHORITY_BASELINE.md)

---
*审校: 2026-03-21*
