import assert from "node:assert/strict";
import test from "node:test";
import { createEscrow, fund, transition } from "../docs/escrow.mjs";

const parties = { payer: "A", payee: "B", arbiter: "C" };
const terms = [150, 200, 250].map((amount, i) => ({ name: `M${i}`, amount, deadline: (i + 1) * 3 }));
const create = (overrides = {}) => createEscrow({ parties, total: 600, epoch: 1, milestones: terms, ...overrides });
const funded = () => {
  const escrow = create();
  fund(escrow, "payer", 600, 1);
  return escrow;
};

test("validates the terms, identities, count and integer units", () => {
  assert.equal(create({ total: 350, milestones: terms.slice(0, 2) }).milestones.length, 2);
  assert.throws(() => create({ parties: { ...parties, arbiter: " a " } }), /distinct/);
  assert.throws(() => create({ milestones: terms.slice(0, 1) }), /two or three/);
  assert.throws(() => create({ milestones: [...terms, terms[0]] }), /two or three/);
  assert.throws(() => create({ total: 601 }), /sum/);
  assert.throws(() => create({ total: 600.5 }), /positive whole/);
  assert.throws(() => create({ total: Number.MAX_SAFE_INTEGER + 1 }), /positive whole/);
  assert.throws(() => create({ epoch: 3 }), /future epoch/);
});

test("only payer can lock the exact amount, once and before the deadline", () => {
  const escrow = create();
  assert.throws(() => fund(escrow, "payee", 600, 1), /Only the payer/);
  assert.throws(() => fund(escrow, "payer", 599, 1), /exact total/);
  assert.throws(() => fund(escrow, "payer", 600, 3), /deadline/);
  assert.throws(() => transition(escrow, "payee", 0, "submit", 1, "notes"), /Fund the escrow first/);
  fund(escrow, "payer", 600, 2);
  assert.throws(() => fund(escrow, "payer", 600, 2), /already funded/);
});

test("walkthrough conserves balances and rejects double-release", () => {
  const escrow = funded();
  const act = (role, i, action, epoch, work) => transition(escrow, role, i, action, epoch, work);
  assert.throws(() => act("payer", 0, "approve", 1), /Pending; expected Submitted/);
  act("payee", 0, "submit", 1, "notes");
  assert.deepEqual(act("payer", 0, "approve", 1), { amount: 150, recipient: "payee" });
  assert.throws(() => act("payer", 0, "approve", 1), /Released; expected Submitted/);
  act("payee", 1, "submit", 1, "prototype");
  act("payer", 1, "dispute", 1);
  assert.deepEqual(act("arbiter", 1, "refund", 1), { amount: 200, recipient: "payer" });
  assert.deepEqual(act("payer", 2, "claim", 9), { amount: 250, recipient: "payer" });
  assert.deepEqual([escrow.locked, escrow.paid, escrow.refunded], [0, 150, 450]);
});

test("only the arbiter resolves a dispute and may release to the payee", () => {
  const escrow = funded();
  assert.throws(() => transition(escrow, "arbiter", 1, "release", 1), /Pending; expected Disputed/);
  transition(escrow, "payee", 1, "submit", 2, "prototype");
  transition(escrow, "payer", 1, "dispute", 2);
  assert.throws(() => transition(escrow, "payer", 1, "release", 2), /Only the arbiter/);
  assert.deepEqual(transition(escrow, "arbiter", 1, "release", 9), { amount: 200, recipient: "payee" });
  assert.throws(() => transition(escrow, "arbiter", 1, "refund", 9), /Released; expected Disputed/);
});

test("delivery and expiry do not overlap; submitted work cannot be reclaimed", () => {
  const escrow = funded();
  assert.throws(() => transition(escrow, "payer", 0, "submit", 2, "notes"), /Only the payee/);
  assert.throws(() => transition(escrow, "payee", 0, "submit", 2, "é".repeat(121)), /240 bytes/);
  assert.throws(() => transition(escrow, "payee", 0, "submit", 3, "notes"), /deadline/);
  assert.throws(() => transition(escrow, "payer", 0, "claim", 2), /has not passed/);
  transition(escrow, "payee", 1, "submit", 2, "notes");
  assert.throws(() => transition(escrow, "payer", 1, "claim", 9), /Submitted; expected Pending/);
  assert.throws(() => transition(escrow, "payer", 3, "claim", 9), /does not exist/);
});
