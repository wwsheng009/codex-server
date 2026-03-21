# Color Palette Guide (OKLCH System)

## 1. Core Concepts: OKLCH

Codex uses **OKLCH** as its preferred engineering color space for UI tokens. `oklch()` is standardized in CSS Color 4, which makes it suitable for authoring design tokens directly in CSS-compatible formats.

- **L (Lightness)**: perceived brightness.
- **C (Chroma)**: perceived color intensity.
- **H (Hue)**: hue angle.

### Why OKLCH?

Compared with HSL, OKLCH is easier to reason about when you want status colors and layered surfaces to feel closer in perceived weight. This improves token design, but it does **not** remove the need to validate contrast against WCAG 2.2.

## 2. Fundamental Rules

### Semantic Weight Balancing

To keep status colors visually comparable, match or tightly control their **Lightness (L)** bands before tuning hue or chroma.

```oklch
/* Product example, not a standards-defined palette */
--color-success: oklch(0.65 0.18 145);
--color-warning: oklch(0.65 0.18 75);
--color-danger:  oklch(0.65 0.18 25);
```

### Dark Mode: Elevation as Lightness

In dark themes, higher surfaces typically need slightly higher lightness to remain visually distinct.

| Elevation | Token | Lightness (L) | Step |
| :--- | :--- | :--- | :--- |
| Floor | `surface-floor` | `0.12` | Base |
| Base | `surface-base` | `0.17` | +5% |
| Raised | `surface-raised` | `0.22` | +5% |
| Overlay | `surface-overlay` | `0.28` | +6% |

### Chroma Reduction for Dark Mode

High-chroma accents often need to be softened in dark mode to avoid bloom and visual fatigue.

```css
/* Light Mode Brand */
--brand-primary: oklch(0.60 0.22 250);

/* Dark Mode Brand */
--brand-primary: oklch(0.60 0.15 250);
```

### Contrast Stretching

Dark surfaces often need wider lightness steps than light surfaces. This is a practical design rule, not a normative WCAG formula.

## 3. Proportions: The 60-30-10 Rule

Use this only as a composition heuristic, not as an accessibility substitute.

- **60%**: neutral base surfaces.
- **30%**: secondary UI surfaces and supporting text.
- **10%**: accents and high-emphasis actions.

## 4. Intent-Based Naming (Tokens)

Tokens must describe **intent**, not appearance.

| Token Category | Example Token | Usage |
| :--- | :--- | :--- |
| **Surface** | `surface-base` | Primary application background |
| **On-Surface** | `on-surface-strong` | High-contrast text on base |
| **Action** | `action-accent` | Primary actions and interactive emphasis |
| **Boundary** | `boundary-faint` | Subtle dividers and borders |
| **Status** | `status-danger-bg` | Background for error states |

## 5. 规范依据 (Authority)

- [CSS Color Module Level 4](https://www.w3.org/TR/css-color-4/)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [Design Tokens Format Module 2025.10](https://www.designtokens.org/tr/drafts/format/)
- [统一来源基线](./UX_AUTHORITY_BASELINE.md)

---
*审校: 2026-03-21*
