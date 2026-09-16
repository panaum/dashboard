// Type declarations for the parts of three.js this app uses — and only those.
//
// three ships no types, and @types/three brings six more packages with it
// (a physics engine's among them) for addons this app never loads. So the
// surface is declared here by hand, member by member, against three 0.186.
// If code needs something that is not below, add it here after reading
// three's source for the pinned version (node_modules/three/src), not a guess.
//
// Used by src/components/layout-checks/handset-3d.tsx.

declare module "three" {
  export const SRGBColorSpace: "srgb";
  export const ACESFilmicToneMapping: 4;

  export class Vector3 {
    constructor(x?: number, y?: number, z?: number);
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): this;
    sub(v: Vector3): this;
  }

  export class Euler {
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number, order?: "XYZ" | "YXZ" | "ZXY" | "ZYX" | "YZX" | "XZY"): this;
  }

  export class Object3D {
    position: Vector3;
    rotation: Euler;
    add(...objects: Object3D[]): this;
    traverse(callback: (object: Object3D) => void): void;
    lookAt(x: number, y: number, z: number): void;
  }

  export class Group extends Object3D {}

  export class Scene extends Object3D {
    environment: Texture | null;
    environmentIntensity: number;
  }

  export class Color {
    setHex(hex: number): this;
  }

  export class Texture {
    readonly isTexture: true;
    colorSpace: string;
    flipY: boolean;
    anisotropy: number;
    needsUpdate: boolean;
    dispose(): void;
  }

  export class CanvasTexture extends Texture {
    constructor(canvas: HTMLCanvasElement);
  }

  export class BufferGeometry {
    dispose(): void;
  }

  export class PlaneGeometry extends BufferGeometry {
    constructor(width?: number, height?: number);
  }

  export class Material {
    name: string;
    /** Write-only in three: set it after changing what the shader depends on. */
    set needsUpdate(value: boolean);
    dispose(): void;
  }

  export class MeshBasicMaterial extends Material {
    map: Texture | null;
    color: Color;
    constructor(parameters?: {
      color?: number;
      map?: Texture | null;
      transparent?: boolean;
      depthWrite?: boolean;
      toneMapped?: boolean;
    });
  }

  export class Mesh extends Object3D {
    constructor(geometry?: BufferGeometry, material?: Material);
    readonly isMesh: true;
    geometry: BufferGeometry;
    material: Material | Material[];
  }

  export class DirectionalLight extends Object3D {
    constructor(color?: number, intensity?: number);
  }

  export class PerspectiveCamera extends Object3D {
    constructor(fov?: number, aspect?: number, near?: number, far?: number);
    aspect: number;
    updateProjectionMatrix(): void;
  }

  export class Box3 {
    setFromObject(object: Object3D): this;
    getSize(target: Vector3): Vector3;
    getCenter(target: Vector3): Vector3;
  }

  export class WebGLRenderTarget {
    texture: Texture;
    dispose(): void;
  }

  export class WebGLRenderer {
    constructor(parameters?: {
      canvas?: HTMLCanvasElement;
      antialias?: boolean;
      alpha?: boolean;
      powerPreference?: "default" | "high-performance" | "low-power";
    });
    outputColorSpace: string;
    toneMapping: number;
    readonly capabilities: { readonly maxTextureSize: number; getMaxAnisotropy(): number };
    setPixelRatio(value: number): void;
    setClearColor(color: number, alpha?: number): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    render(scene: Object3D, camera: PerspectiveCamera): void;
    dispose(): void;
    forceContextLoss(): void;
  }

  export class PMREMGenerator {
    constructor(renderer: WebGLRenderer);
    fromScene(scene: Scene, sigma?: number): WebGLRenderTarget;
    dispose(): void;
  }
}

declare module "three/addons/loaders/GLTFLoader.js" {
  import type { Group } from "three";
  export interface GLTF {
    scene: Group;
  }
  export class GLTFLoader {
    loadAsync(url: string): Promise<GLTF>;
  }
}

declare module "three/addons/environments/RoomEnvironment.js" {
  import type { Scene } from "three";
  export class RoomEnvironment extends Scene {
    dispose(): void;
  }
}
