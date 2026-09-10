// What the body around the screenshot should look like, per device.
//
// The frame used to be one rounded rectangle for every phone, which is why a
// Galaxy S25 and an iPhone SE were indistinguishable. These are stylised
// likenesses, not photographs: the proportions, corner radius, camera cutout
// and button layout are what make a handset recognisable at this size, and
// they are drawn from the profile's own id so a frame can never claim to be a
// device the run did not use.
//
// Two deliberate inaccuracies, both to avoid lying about the page:
//   · The cutout sits in the top bezel. On the real hardware it is inside the
//     display — drawn there it would cover the top of the captured page, and
//     the capture starts at the page, not below a status bar.
//   · Nothing carries a maker's logo, because the front of these devices does
//     not either. Shape, camera and buttons do the identifying.

import type { Shape } from "@/lib/layout-checks/devices-view";

export type Cutout = "island" | "hole" | "hole-left" | "earpiece" | "none";

/** A side button, as fractions of the body's height so it scales with the frame. */
export type SideButton = { side: "left" | "right"; top: number; height: number };

export type Skin = {
  /** Body padding around the screen, in CSS px of the drawn frame. */
  bezelX: number;
  bezelTop: number;
  bezelBottom: number;
  /** Outer body radius and the screen's own radius. */
  radius: number;
  screenRadius: number;
  cutout: Cutout;
  buttons: SideButton[];
  /** iPhone SE: a home button in the chin. */
  home: boolean;
};

const IPHONE_MODERN: Skin = {
  bezelX: 10, bezelTop: 14, bezelBottom: 14, radius: 46, screenRadius: 34,
  cutout: "island", home: false,
  buttons: [
    { side: "left", top: 0.115, height: 0.035 },   // Action button
    { side: "left", top: 0.185, height: 0.075 },   // Volume up
    { side: "left", top: 0.275, height: 0.075 },   // Volume down
    { side: "right", top: 0.225, height: 0.105 },  // Side button
    { side: "right", top: 0.385, height: 0.055 },  // Camera Control
  ],
};

// The last iPhone with a chin: thick top and bottom, square-ish corners, and a
// home button — the one handset here nobody could mistake for a modern phone.
const IPHONE_SE: Skin = {
  bezelX: 11, bezelTop: 46, bezelBottom: 54, radius: 22, screenRadius: 3,
  cutout: "earpiece", home: true,
  buttons: [
    { side: "left", top: 0.175, height: 0.055 },
    { side: "left", top: 0.245, height: 0.055 },
    { side: "right", top: 0.185, height: 0.085 },
  ],
};

// Flat sides, a centred punch-hole, and both buttons on the right — the
// Android arrangement, and the opposite side to an iPhone.
const ANDROID_PHONE: Skin = {
  bezelX: 8, bezelTop: 11, bezelBottom: 11, radius: 36, screenRadius: 28,
  cutout: "hole", home: false,
  buttons: [
    { side: "right", top: 0.165, height: 0.105 },  // Volume rocker
    { side: "right", top: 0.295, height: 0.06 },   // Power
  ],
};

const TABLET: Skin = {
  bezelX: 14, bezelTop: 14, bezelBottom: 14, radius: 28, screenRadius: 14,
  cutout: "none", home: false,
  buttons: [
    { side: "right", top: 0.055, height: 0.05 },
    { side: "right", top: 0.125, height: 0.05 },
  ],
};

const DESKTOP: Skin = {
  bezelX: 0, bezelTop: 0, bezelBottom: 0, radius: 12, screenRadius: 0,
  cutout: "none", home: false, buttons: [],
};

const GENERIC_PHONE: Skin = {
  bezelX: 12, bezelTop: 30, bezelBottom: 30, radius: 40, screenRadius: 24,
  cutout: "none", home: false, buttons: [],
};

const BY_SHAPE: Record<Shape, Skin> = {
  phone: GENERIC_PHONE, tablet: TABLET, desktop: DESKTOP,
};

// Keyed on the profile id the run actually used. A device missing here falls
// back to its shape, so a new profile is plain rather than wrong.
const BY_ID: Record<string, Skin> = {
  "iphone-16-pro-max": IPHONE_MODERN,
  "iphone-16-pro": IPHONE_MODERN,
  "iphone-16": IPHONE_MODERN,
  "iphone-se-3": IPHONE_SE,
  "ipad-pro-13": TABLET,
  "ipad-air-11": TABLET,
  "galaxy-s25": ANDROID_PHONE,
  // The Ultra is the boxy one in the range; squarer corners are the tell.
  "galaxy-s25-ultra": { ...ANDROID_PHONE, radius: 24, screenRadius: 18 },
  "xiaomi-15": ANDROID_PHONE,
  "galaxy-z-flip-open": { ...ANDROID_PHONE, radius: 38, screenRadius: 30 },
  // The cover screen: a small pane with the cameras beside it, not above.
  "galaxy-z-flip-cover": {
    bezelX: 10, bezelTop: 10, bezelBottom: 10, radius: 22, screenRadius: 14,
    cutout: "hole-left", home: false,
    buttons: [{ side: "right", top: 0.28, height: 0.16 }],
  },
  "galaxy-tab-s10-plus": { ...TABLET, radius: 22, screenRadius: 10, cutout: "hole" },
};

/** The body to draw. `deviceId` is a profile id; widths have none and get a
 *  plain frame for their shape. */
export function skinFor(deviceId: string | null | undefined, shape: Shape): Skin {
  if (deviceId && BY_ID[deviceId]) return BY_ID[deviceId];
  return BY_SHAPE[shape];
}

/** The cutout's box in CSS px, given the drawn screen width and the room the
 *  top bezel has. Null when there is nothing to draw or nowhere to draw it. */
export function cutoutBox(skin: Skin, screenW: number): { width: number; height: number } | null {
  const room = skin.bezelTop - 4;
  if (skin.cutout === "none" || room < 3 || screenW <= 0) return null;
  if (skin.cutout === "island") {
    return { width: Math.round(screenW * 0.3), height: Math.min(room, Math.round(screenW * 0.075)) };
  }
  if (skin.cutout === "earpiece") {
    return { width: Math.round(screenW * 0.26), height: Math.min(room, 5) };
  }
  const d = Math.min(room, Math.max(4, Math.round(screenW * 0.035)));
  return { width: d, height: d };
}
