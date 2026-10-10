// ════════════════════════════════════════════════════════════
//  PROFILE — Whether a user has the info required to offer rides.
//  Required to drive: a face photo + license plate (state & number)
//  + vehicle year/make/model + a Lightning address (so riders can pay).
//  Vehicle photo is optional.
// ════════════════════════════════════════════════════════════

export function isDriveReady(user) {
  const v = user?.vehicle || {};
  return !!(user?.picture && user?.lud16 && v.plateState && v.plateNumber && v.year && v.make && v.model);
}
