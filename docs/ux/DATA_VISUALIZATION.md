# 数据可视化指南 (Data Visualization Guide)

本页优先参考官方数据可视化指导，而不是把某一套图库的默认风格写成“标准”。图表的首要目标是**准确、快速、可比较地传达信息**。

## 1. 核心视觉原则 (Core Visual Principles)

### 1.1 先选信息关系，再选图表

- 先明确是在展示比较、变化、分布、组成还是关联。
- 如果表格比图表更清楚，就不要为了“可视化”硬上图。

### 1.2 默认使用 2D

- 避免 3D 柱图、3D 饼图等会扭曲感知比例的样式。
- 坐标轴、刻度和数据标签应服务于比较，而不是制造装饰感。

### 1.3 颜色必须有语义

- 颜色用于表达类别、状态或强调，不只是“让图更丰富”。
- 关键系列优先直接标注或保持稳定配色，不要让用户靠图例来回对应。

## 2. 无障碍与包容性 (Accessibility and Inclusivity)

### 2.1 冗余编码 (Redundant Encoding)

不要只依赖颜色区分系列或状态。

- 折线图可结合线型、点型和直接标签。
- 散点或分类图可结合形状、纹理和位置。
- 图表结论应能通过标题、摘要或旁侧说明被读出。

### 2.2 深浅主题下的可读性

- 深色背景下高饱和色更容易产生眩光，应控制饱和度和明度差。
- 需要时通过轮廓线、直接标签或背景衬底提高可辨性，而不是只加更多颜色。

## 3. 性能与加载 (Performance and Loading)

### 3.1 延迟加载

- 图表进入视口后再初始化，可减少初始渲染开销。
- 大图表和高频更新图表优先关注数据量、抽样和增量更新，而不是只优化动画。

### 3.2 骨架与占位

- 加载阶段优先使用结构相近的骨架，占住最终布局。
- 避免用通用 spinner 替代图表空间，否则会让用户误判页面结构。

## 4. 交互式洞察 (Interactive Insights)

### 4.1 Tooltips

- tooltip 应补充细节，而不是承载全部含义。
- 鼠标悬停与键盘聚焦都应能访问等价信息。
- 若一张图必须频繁依赖 tooltip 才能读懂，通常说明直接标注或图表选型不够好。

### 4.2 Brush / Zoom

- 时间序列和长范围数据适合提供缩放或区间选择，但不是所有图都必须有 minimap。
- 缩放后要保留清晰的重置入口与当前范围提示。

## 5. 规范依据 (Authority)

- [Government Analysis Function: Data visualisation - charts](https://analysisfunction.civilservice.gov.uk/policy-store/data-visualisation-charts/)
- [Government Analysis Function: Data visualisation - colours](https://analysisfunction.civilservice.gov.uk/policy-store/data-visualisation-colours-in-charts/)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [统一来源基线](./UX_AUTHORITY_BASELINE.md)

---
*审校: 2026-03-21*
