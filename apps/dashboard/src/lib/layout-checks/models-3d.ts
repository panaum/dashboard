// Which handsets have a 3D model, and what came with each one.
//
// One entry per device profile. Adding a handset is an entry here plus its
// optimised .glb in assets/models — not another component. What the models are
// for, why they are internal only, and what would take them out are in
// docs/decisions/ADR-004-3d-galaxy-s25-internal-only.md.

/** CC BY requires the credit to travel with the file. It is also in the .glb
 *  itself (asset.copyright / asset.extras) and in the component's header. */
export type ModelCredit = {
  title: string;
  author: string;
  profile: string;
  licence: string;
  source: string;
};

export type DeviceModel = {
  /** The device profile this model stands in for. */
  device: string;
  /** assets/models/<file>.glb, served by /api/models/<file> to signed-in users. */
  file: string;
  credit: ModelCredit;
  /** What scripts/optimise-handset-model.mjs removed, so nobody re-imports the
   *  untouched download thinking it is the same file. */
  stripped: string;
};

/** Every model's screen material is renamed to this by the optimiser, so the
 *  component looks for one name whatever the handset. */
export const SCREEN_MATERIAL = "Screen";

export const DEVICE_MODELS: readonly DeviceModel[] = [
  {
    device: "galaxy-s25",
    file: "galaxy-s25",
    credit: {
      title: "SAMSUNG S25",
      author: "Yassine24",
      profile: "https://sketchfab.com/Yassine24",
      licence: "CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)",
      source: "https://sketchfab.com/3d-models/samsung-s25-3ea821af958f4e9d99aaba1eb32b423f",
    },
    stripped: "SAMSUNG wordmark mesh; Samsung's wallpaper; glass transmission. "
      + "Screen UVs re-projected; simplified and quantized, 108,208 → 21,574 triangles.",
  },
];

export function modelFor(device: string | null | undefined): DeviceModel | null {
  if (!device) return null;
  return DEVICE_MODELS.find((m) => m.device === device) ?? null;
}

export function modelUrl(model: DeviceModel): string {
  return `/api/models/${model.file}`;
}

/**
 * The allow-list the route reads: a name from a request is only ever matched
 * against the registry, never joined into a path. Anything else is not found.
 */
export function modelFile(name: string): string | null {
  const model = DEVICE_MODELS.find((m) => m.file === name);
  return model ? model.file : null;
}
