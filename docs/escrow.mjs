const roles = ["payer", "payee", "arbiter"];
const required = {
  submit: ["payee", "Pending"],
  approve: ["payer", "Submitted"],
  dispute: ["payer", "Submitted"],
  release: ["arbiter", "Disputed"],
  refund: ["arbiter", "Disputed"],
  claim: ["payer", "Pending"],
};
const positive = (n) => Number.isSafeInteger(n) && n > 0;

export function createEscrow({ parties, total, milestones, epoch }) {
  if (milestones.length < 2 || milestones.length > 3) throw Error("Specify two or three milestones.");
  const names = roles.map((role) => parties[role].trim());
  if (names.some((name) => !name) || new Set(names.map((name) => name.toLowerCase())).size !== 3) {
    throw Error("Give payer, payee and arbiter distinct names.");
  }
  if (!positive(total) || milestones.some(({ amount }) => !positive(amount))) {
    throw Error("Amounts must be positive whole simulated XTM.");
  }
  if (milestones.reduce((sum, { amount }) => sum + amount, 0) !== total) {
    throw Error("Milestone amounts must sum to the escrow total exactly.");
  }
  if (milestones.some(({ deadline }) => !positive(deadline) || deadline <= epoch)) {
    throw Error("Every deadline must be a future epoch.");
  }
  return {
    parties: Object.fromEntries(roles.map((role, i) => [role, names[i]])),
    total, funded: false, locked: 0, paid: 0, refunded: 0,
    milestones: milestones.map(({ amount, deadline, name }) => ({
      name, amount, deadline, status: "Pending", reference: null,
    })),
  };
}

export function fund(escrow, role, amount, epoch) {
  if (role !== "payer") throw Error("Only the payer can fund escrow.");
  if (escrow.funded) throw Error("Escrow is already funded.");
  if (amount !== escrow.total) throw Error("Fund the exact total.");
  if (escrow.milestones.some(({ deadline }) => epoch >= deadline)) {
    throw Error("A deadline has been reached. Create a new agreement to fund it.");
  }
  escrow.funded = true;
  escrow.locked = amount;
}

export function transition(escrow, role, index, action, epoch, reference = "") {
  if (!Object.hasOwn(required, action)) throw Error("Unknown action.");
  const [actor, expected] = required[action];
  if (role !== actor) throw Error(`Only the ${actor} can do that.`);
  if (!escrow.funded) throw Error("Fund the escrow first.");
  const m = escrow.milestones[index];
  if (!Number.isInteger(index) || !m) throw Error("That milestone does not exist.");
  if (m.status !== expected) throw Error(`Milestone is ${m.status}; expected ${expected}.`);
  switch (action) {
    case "submit":
      if (epoch >= m.deadline) throw Error("The deadline has been reached.");
      if (!reference.trim() || new TextEncoder().encode(reference).length > 240) {
        throw Error("Provide a work reference of 1–240 bytes.");
      }
      m.reference = reference;
      m.status = "Submitted";
      return;
    case "dispute":
      m.status = "Disputed";
      return;
    case "claim":
      if (epoch < m.deadline) throw Error("The deadline has not passed.");
      break;
  }
  const release = action === "approve" || action === "release";
  m.status = release ? "Released" : "Refunded";
  escrow.locked -= m.amount;
  escrow[release ? "paid" : "refunded"] += m.amount;
  return { amount: m.amount, recipient: release ? "payee" : "payer" };
}
