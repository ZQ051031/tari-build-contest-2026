pub mod escrow;

use tari_template_lib::{prelude::*, template::BuiltinTemplate};

use crate::escrow::{Action, Escrow, Role};

#[template]
mod milestone_escrow {
    use super::*;

    pub struct MilestoneEscrow {
        agreement: Escrow,
        vault: Vault,
        payer_account: ComponentAddress,
        payee_account: Option<ComponentAddress>,
    }

    impl MilestoneEscrow {
        pub fn create(
            payer: RistrettoPublicKeyBytes,
            payee: RistrettoPublicKeyBytes,
            arbiter: RistrettoPublicKeyBytes,
            payer_account: ComponentAddress,
            total: u64,
            amounts: Vec<u64>,
            deadlines: Vec<u64>,
        ) -> Component<Self> {
            CallerContext::assert_badge_in_scope(&NonFungibleAddress::from_public_key(payer));
            assert!(
                payer != payee && payer != arbiter && payee != arbiter,
                "Roles must be distinct"
            );
            Self::require_account(payer_account);
            assert_eq!(
                amounts.len(),
                deadlines.len(),
                "Give every milestone a deadline"
            );
            let terms = amounts.into_iter().zip(deadlines).collect();
            let agreement = Escrow::new(total, terms, Consensus::current_epoch())
                .unwrap_or_else(|error| panic!("{error}"));

            Component::new(Self {
                agreement,
                vault: Vault::new_empty(TARI_TOKEN),
                payer_account,
                payee_account: None,
            })
            .with_owner_rule(OwnerRule::None)
            .with_access_rules(
                AccessRules::new()
                    .method("fund", rule!(public_key(payer)))
                    .method("submit", rule!(public_key(payee)))
                    .method("approve", rule!(public_key(payer)))
                    .method("dispute", rule!(public_key(payer)))
                    .method("resolve", rule!(public_key(arbiter)))
                    .method("claim_refund", rule!(public_key(payer)))
                    .method("status", rule!(allow_all))
                    .method("reference", rule!(allow_all))
                    .method("locked_balance", rule!(allow_all))
                    .default(rule!(deny_all)),
            )
            .create()
        }

        pub fn fund(&mut self, payment: Bucket) {
            assert_eq!(
                payment.resource_address(),
                TARI_TOKEN,
                "Use native Ootle TARI"
            );
            payment.assert_contains_no_confidential_funds();
            let total = self.agreement.total();
            assert_eq!(
                payment.amount(),
                Amount::from_u64(total),
                "Fund the exact total"
            );
            self.agreement
                .fund(Role::Payer, total, Consensus::current_epoch())
                .unwrap_or_else(|error| panic!("{error}"));
            self.vault.deposit(payment);
        }

        pub fn submit(
            &mut self,
            milestone: u32,
            reference: String,
            payee_account: ComponentAddress,
        ) {
            assert_ne!(
                self.payer_account, payee_account,
                "Settlement accounts must be distinct"
            );
            if let Some(saved) = self.payee_account {
                assert_eq!(
                    saved, payee_account,
                    "Use the payee account set on first delivery"
                );
            } else {
                Self::require_account(payee_account);
            }
            self.apply(Role::Payee, milestone, Action::Submit(reference));
            self.payee_account = Some(payee_account);
        }

        pub fn approve(&mut self, milestone: u32) {
            self.apply(Role::Payer, milestone, Action::Approve);
        }

        pub fn dispute(&mut self, milestone: u32) {
            self.apply(Role::Payer, milestone, Action::Dispute);
        }

        pub fn resolve(&mut self, milestone: u32, release_to_payee: bool) {
            self.apply(
                Role::Arbiter,
                milestone,
                Action::Resolve { release_to_payee },
            );
        }

        pub fn claim_refund(&mut self, milestone: u32) {
            self.apply(Role::Payer, milestone, Action::ClaimRefund);
        }

        pub fn status(&self, milestone: u32) -> String {
            format!(
                "{:?}",
                self.agreement.milestones()[milestone as usize].status
            )
        }

        pub fn reference(&self, milestone: u32) -> Option<String> {
            self.agreement.milestones()[milestone as usize]
                .reference
                .clone()
        }

        pub fn locked_balance(&self) -> Amount {
            self.vault.balance()
        }

        fn require_account(account: ComponentAddress) {
            assert_eq!(
                ComponentManager::get(account).get_template_address(),
                BuiltinTemplate::Account.address(),
                "Settlement destinations must be built-in accounts"
            );
        }

        fn apply(&mut self, role: Role, milestone: u32, action: Action) {
            if let Some(settlement) = self
                .agreement
                .apply(role, milestone as usize, action, Consensus::current_epoch())
                .unwrap_or_else(|error| panic!("{error}"))
            {
                let destination = match settlement.recipient {
                    Role::Payer => self.payer_account,
                    Role::Payee => self
                        .payee_account
                        .expect("Submission fixes the payee account"),
                    Role::Arbiter => unreachable!("The arbiter never receives funds"),
                };
                let bucket = self.vault.withdraw(Amount::from_u64(settlement.amount));
                ComponentManager::get(destination).invoke("deposit", args![bucket]);
            }
        }
    }
}
