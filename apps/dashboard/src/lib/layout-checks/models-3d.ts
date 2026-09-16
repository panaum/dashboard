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
  /** Degrees to turn the model so its screen faces the reader. Models are
   *  exported facing either way; this is the one thing that differs. */
  turn?: number;
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
  {
    device: "iphone-16",
    file: "iphone-16",
    credit: {
      title: "iPhone 16 Teal (Free)",
      author: "EV_car2013",
      profile: "https://sketchfab.com/EV_car2013",
      licence: "CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)",
      source: "https://sketchfab.com/3d-models/iphone-16-teal-free-c7f900aa7ac547a487f1ba3082dac96a",
    },
    // Apple's logo is NOT stripped here, unlike the Galaxy's wordmark: it fills
    // a logo-shaped hole in the back panel, and removing it leaves a recessed
    // black logo. ADR-004 records that decision and why the rule is unchanged.
    stripped: "Apple's wallpaper. Screen UVs projected (the download's are all zero); "
      + "textures re-encoded and capped at 512px; simplified and quantized, "
      + "60,986 → 21,789 triangles. The Apple logo stays — see ADR-004.",
    turn: 180,
  },
  {
    device: "iphone-13-pro-max",
    file: "iphone-13-pro-max",
    credit: {
      title: "Apple iPhone 13 Pro Max",
      author: "DatSketch",
      profile: "https://sketchfab.com/DatSketch",
      licence: "CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)",
      source: "https://sketchfab.com/3d-models/apple-iphone-13-pro-max-4328dea00e47497dbeac73c556121bc9",
    },
    // The notch is cut into the bezel that hangs in front of the display, so
    // that mesh is never simplified. Apple's logo stays (ADR-004); here it is
    // its own mesh on an unbroken back, so it could have gone either way.
    stripped: "Apple's wallpaper. Screen UVs re-projected; textures re-encoded and capped at "
      + "512px; simplified and quantized, 28,063 → 18,527 triangles. The Apple logo stays — see ADR-004.",
    turn: 180,
  },
  {
    device: "iphone-17-pro-max",
    file: "iphone-17-pro-max",
    credit: {
      title: "iPhone 17 Pro Max",
      author: "MG990",
      profile: "https://sketchfab.com/MG990",
      licence: "CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)",
      source: "https://sketchfab.com/3d-models/iphone-17-pro-max-87fc1df741384124a8ce0226d2b2058d",
    },
    // This one carries no Apple logo at all, so there was nothing to decide.
    stripped: "Apple's wallpaper (2048 x 4096, 2.5 MB of the 3.9 MB download). Screen UVs "
      + "re-projected; simplified and quantized, 29,544 → 17,943 triangles.",
    turn: 90,
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
