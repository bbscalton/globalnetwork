export type StaffRole = "pending" | "desk" | "support" | "admin";

export function parseRole(value: unknown): StaffRole {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  if (v === "admin") return "admin";
  if (v === "support") return "support";
  if (v === "pending") return "pending";
  if (v === "desk" || v === "staff") return "desk";
  return "pending";
}

export function parseAssignableRole(value: unknown): Exclude<StaffRole, "pending"> {
  const role = parseRole(value);
  if (role === "pending") return "desk";
  return role;
}

export function isAssignedRole(role: StaffRole): boolean {
  return role === "admin" || role === "desk" || role === "support";
}
