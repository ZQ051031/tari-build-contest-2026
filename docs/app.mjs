import { createEscrow, fund, transition } from "./escrow.mjs";

const $ = (id) => document.getElementById(id);
const form = $("create-form");
const fields = form.elements;
const sample = [
  ["Discovery", 150, 3],
  ["Prototype", 200, 6],
  ["Handoff", 250, 9],
];
const labels = {
  submit: "Submit work", approve: "Approve & release", dispute: "Dispute",
  release: "Resolve: release", refund: "Resolve: refund", claim: "Claim expiry refund",
};
const buttons = {
  Pending: ["submit", "claim"],
  Submitted: ["approve", "dispute"],
  Disputed: ["release", "refund"],
  Released: ["approve"],
  Refunded: [],
};
let escrow, role, epoch, guideIndex, drafts, termDrafts;
const amount = (value) => value.toLocaleString("en-US");
const xtm = (value) => `${amount(value)} XTM`;

function el(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  if (className) node.className = className;
  return node;
}

function report(message, rejected = false) {
  const line = el("li");
  line.append(
    el("small", `EPOCH ${epoch} · ${role.toUpperCase()} · ${rejected ? "REJECTED" : "ACCEPTED"}`),
    el("span", message, rejected ? "rejected" : undefined),
  );
  $("ledger").prepend(line);
  $("log-empty").hidden = true;
  $("notice").textContent = message;
}

function renderTerms() {
  $("terms").replaceChildren(...termDrafts.slice(0, Number(fields.count.value)).map(([name, amount, deadline], i) => {
    const row = el("div", undefined, "term");
    row.append(el("strong", `${i + 1}. ${name}`));
    for (const [caption, value, offset] of [["Amount", amount, 1], ["Deadline epoch", deadline, 2]]) {
      const label = el("label", caption);
      const input = el("input");
      Object.assign(input, { type: "number", min: "1", step: "1", value, required: true });
      input.setAttribute("aria-label", `${name} ${caption.toLowerCase()}`);
      input.addEventListener("input", () => { termDrafts[i][offset] = input.value; });
      label.append(input);
      row.append(label);
    }
    return row;
  }));
}

function renderContract() {
  form.hidden = Boolean(escrow);
  $("active").hidden = !escrow;
  if (!escrow) {
    $("contract-state").textContent = "Draft";
    return;
  }
  $("contract-state").textContent = !escrow.funded ? "Unfunded" : escrow.locked === 0 ? "Settled" : "Funded";
  for (const key of ["locked", "paid", "refunded"]) $(key).textContent = xtm(escrow[key]);
  $("contract-summary").textContent =
    `Total: ${xtm(escrow.total)} · ${escrow.milestones.length} milestones · simulated funds`;
  $("role").replaceChildren(...Object.entries(escrow.parties).map(([kind, name]) => {
    const option = el("option", `${kind[0].toUpperCase()}${kind.slice(1)} · ${name}`);
    option.value = kind;
    return option;
  }));
  $("role").value = role;
  $("epoch").textContent = `Epoch ${epoch}`;
  $("fund").hidden = escrow.funded;
  $("milestones").replaceChildren(...escrow.milestones.map((milestone, i) => {
    const { name, amount, deadline, status, reference } = milestone;
    const card = el("section", undefined, "milestone");
    const header = el("header");
    const title = el("h3", `${i + 1}. ${name}`);
    title.id = `milestone-${i}`;
    title.tabIndex = -1;
    header.append(title, el("span", status, `chip ${status.toLowerCase()}`));
    card.append(header, el("p", `${xtm(amount)} · deadline epoch ${deadline}`, "muted"));
    if (reference) card.append(el("p", `Work: ${reference}`, "reference"));
    if (status === "Pending" && escrow.funded) {
      const label = el("label", "Work reference");
      const input = el("input");
      input.value = drafts[i] ?? "";
      input.placeholder = "e.g. artifact:review";
      input.addEventListener("input", () => { drafts[i] = input.value; });
      label.append(input);
      card.append(label);
    }
    if (escrow.funded) {
      const actions = el("div", undefined, "actions");
      for (const action of buttons[status]) {
        const button = el("button", status === "Released" ? "Retry release" : labels[action]);
        button.type = "button";
        button.dataset.action = action;
        button.addEventListener("click", () => {
          useManual();
          if (run(() => act(i, action))) $(title.id).focus();
        });
        actions.append(button);
      }
      card.append(actions);
    }
    return card;
  }));
}

function create(terms, parties, total) {
  escrow = createEscrow({ parties, total, milestones: terms, epoch });
  report(`Created an agreement for ${xtm(escrow.total)}.`);
}

function fromTerms(terms) {
  return terms.map(([name, value, deadline]) => ({ name, amount: Number(value), deadline: Number(deadline) }));
}

function lock() {
  fund(escrow, role, escrow.total, epoch);
  report(`Locked ${xtm(escrow.total)} in the simulated vault.`);
}

function act(i, action, reference) {
  const payout = transition(escrow, role, i, action, epoch, reference ?? drafts[i]);
  const { name, status } = escrow.milestones[i];
  report(payout
    ? `${name} → ${status}: ${xtm(payout.amount)} to ${escrow.parties[payout.recipient]}.`
    : `${name} → ${status}.`);
}

function advance(next) {
  epoch = next;
  report(`Advanced the simulated clock to epoch ${epoch}.`);
}

const steps = [
  ["payer", "Create the sample agreement", "Three milestones, three roles, and 600 simulated XTM.",
    () => create(fromTerms(sample), { payer: "Northstar Studio", payee: "Mika Chen", arbiter: "Neutral Review" }, 600)],
  ["payer", "Lock the budget", "The payer funds the exact escrow total.", lock],
  ["payee", "Deliver Discovery", "The payee attaches a work reference before its deadline.",
    () => act(0, "submit", "artifact:discovery-notes")],
  ["payer", "Approve & release Discovery", "Pay the first 150 simulated XTM to the payee.", () => act(0, "approve")],
  ["payer", "Try a double release", "Repeat the approval. The first payment is final; the ledger should reject this.",
    () => act(0, "approve"), /Milestone is Released/],
  ["payee", "Deliver Prototype", "The payee submits the second milestone.", () => act(1, "submit", "artifact:prototype-v1")],
  ["payer", "Dispute Prototype", "The payer moves the submitted milestone into arbitration.", () => act(1, "dispute")],
  ["arbiter", "Resolve the dispute", "The arbiter refunds the disputed 200 simulated XTM to the payer.", () => act(1, "refund")],
  ["payer", "Reach the final deadline", "Move to epoch 9 without submitting Handoff.", () => advance(9)],
  ["payer", "Claim the expiry refund", "The payer reclaims the undelivered 250 simulated XTM.", () => act(2, "claim")],
];

function renderGuide() {
  const step = steps[guideIndex];
  $("guide-next").textContent = step ? "Run step ↗" : "Restart guide ↗";
  $("guide-progress").textContent = step
    ? `GUIDED DEMO · ${String(guideIndex + 1).padStart(2, "0")} / ${steps.length}`
    : guideIndex === steps.length ? "GUIDED DEMO · COMPLETE" : "MANUAL WORKBENCH";
  $("guide-title").textContent = step?.[1] ?? (guideIndex === steps.length ? "All funds accounted for" : "You're driving");
  $("guide-detail").textContent = step?.[2] ?? (guideIndex === steps.length
    ? "150 XTM paid, 450 XTM refunded, 0 XTM locked. All simulated."
    : "Keep trying your own actions below. Restarting the guide clears this agreement.");
}

function useManual() {
  guideIndex = -1;
  renderGuide();
}

function run(operation) {
  try {
    operation();
    renderContract();
    return true;
  } catch (error) {
    report(error.message, true);
    return false;
  }
}

function reset() {
  escrow = null;
  role = "payer";
  epoch = 1;
  guideIndex = 0;
  drafts = [];
  termDrafts = sample.map((terms) => [...terms]);
  form.reset();
  $("ledger").replaceChildren();
  $("log-empty").hidden = false;
  $("notice").textContent = "";
  renderTerms();
  renderContract();
  renderGuide();
}

$("guide-next").addEventListener("click", () => {
  const step = steps[guideIndex];
  if (!step) {
    reset();
    return;
  }
  const [actor, , , operation, rejection] = step;
  role = actor;
  let didRun = false;
  try {
    operation();
    didRun = !rejection;
    if (rejection) report("The expected rejection did not occur.", true);
  } catch (error) {
    report(error.message, true);
    didRun = Boolean(rejection?.test(error.message));
  }
  if (didRun) guideIndex += 1;
  renderContract();
  renderGuide();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  useManual();
  run(() => create(
    fromTerms(termDrafts.slice(0, Number(fields.count.value))),
    { payer: fields.payer.value, payee: fields.payee.value, arbiter: fields.arbiter.value },
    Number(fields.total.value),
  ));
});
fields.count.addEventListener("change", renderTerms);
$("role").addEventListener("change", (event) => { useManual(); role = event.target.value; });
$("fund").addEventListener("click", () => { useManual(); run(lock); });
$("advance").addEventListener("click", () => { useManual(); run(() => advance(epoch + 1)); });
$("reset").addEventListener("click", reset);
reset();
