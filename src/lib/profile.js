// ════════════════════════════════════════════════════════════
//  PROFILE — Whether a user has the info required to offer rides.
//  Required to drive: a face photo, a vehicle photo, a driver's license
//  photo, the license plate (state & number), the vehicle year/make/model
//  and a Lightning address (so riders can pay).
//  Optional: gender (riders may prefer to see drivers of one gender first).
//
//  driveGaps(user) lists what is still missing, by section, so the app can
//  tell the driver exactly what to finish.
// ════════════════════════════════════════════════════════════

// [{ id, title, missing }] for every required section that is not complete.
// `missing` names the specific fields (empty when the whole section is missing).
export function driveGaps(user) {
  const v = user?.vehicle || {};
  const gaps = [];
  if (!user?.picture) gaps.push({ id: "photo", title: "Profile photo", missing: [] });

  const car = [["year", v.year], ["make", v.make], ["model", v.model]].filter(([, x]) => !x).map(([n]) => n);
  if (car.length) gaps.push({ id: "vehicle", title: "Vehicle", missing: car });

  if (!v.picture) gaps.push({ id: "vehiclePhoto", title: "Vehicle photo", missing: [] });

  const plate = [["state", v.plateState], ["number", v.plateNumber]].filter(([, x]) => !x).map(([n]) => n);
  if (plate.length) gaps.push({ id: "plate", title: "License plate", missing: plate });

  if (!user?.license) gaps.push({ id: "license", title: "Driver's license photo", missing: [] });
  if (!user?.lud16) gaps.push({ id: "lightning", title: "Lightning address", missing: [] });
  return gaps;
}

// "Vehicle (year, model), Vehicle photo and Lightning address"
export function gapsText(gaps) {
  const parts = gaps.map((g) => (g.missing.length ? `${g.title} (${g.missing.join(", ")})` : g.title));
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function isDriveReady(user) {
  return driveGaps(user).length === 0;
}
