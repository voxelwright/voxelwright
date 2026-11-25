# Page plugin types

Local type declarations exported by the [page plugin registry](../engine/page/plugins.ts). See [Drawing from a page plugin](render-passes.md) for a render pass example.

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

<!-- docs-verified 00420ce4a7390b907c04f07adcd84a232f5ae4d1 {"engine/page/plugins.ts":"1a490851e31a3b2d179d96047a544054"} -->
