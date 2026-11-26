---
title: Page plugin types
description: The TypeScript contract a page plugin implements, printed from engine/page/plugins.ts.
---

Local type declarations exported by the [page plugin registry](https://github.com/voxelwright/voxelwright/blob/main/engine/page/plugins.ts). See [Drawing from a page plugin](/render-passes) for a render pass example.

```ts
export interface PagePlugin {
    state?(v: unknown): void;
    once?(v: unknown): void;
    close?(): void;
}

export interface Plugins {
    readonly loaded: Record<string, string>;
    readonly took: Record<string, number>;
    readonly errors: Record<string, string>;
    of(name: string): PagePlugin | null;
}

export type Pass = (encoder: GPUCommandEncoder, to: Target, view: View, time: number) => void;

export interface Passes {
    add(name: string, draw: Pass): void;
    remove(name: string): void;
    draw(encoder: GPUCommandEncoder, to: Target, view: View, time: number): void;
    readonly names: string[];
}
```
