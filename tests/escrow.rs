use tari_milestone_escrow::escrow::{Action, Error, Escrow, Role, Settlement, Status};

fn agreement() -> Escrow {
    Escrow::new(600, vec![(150, 3), (200, 6), (250, 9)], 0).unwrap()
}

fn funded() -> Escrow {
    let mut escrow = agreement();
    escrow.fund(Role::Payer, 600, 0).unwrap();
    escrow
}

fn submit(escrow: &mut Escrow, i: usize) {
    assert_eq!(
        escrow.apply(Role::Payee, i, Action::Submit("artifact:review".into()), 2),
        Ok(None)
    );
}

#[test]
fn accepts_two_milestones_but_rejects_bad_terms_and_overflow() {
    assert!(Escrow::new(9, vec![(4, 6), (5, 3)], 0).is_ok());
    for (total, terms, error) in [
        (600, vec![], Error::InvalidCount),
        (4, vec![(1, 4); 4], Error::InvalidCount),
        (3, vec![(0, 3), (3, 3)], Error::InvalidAmount),
        (0, vec![(1, 3), (1, 3)], Error::InvalidAmount),
        (4, vec![(1, 3), (2, 3)], Error::InvalidTotal),
        (u64::MAX, vec![(u64::MAX, 3), (2, 3)], Error::InvalidTotal),
        (3, vec![(1, 0), (2, 3)], Error::InvalidDeadline),
    ] {
        assert_eq!(Escrow::new(total, terms, 0), Err(error));
    }
}

#[test]
fn funds_once_for_the_exact_total_before_the_first_deadline() {
    let mut escrow = agreement();
    assert_eq!(escrow.fund(Role::Payee, 600, 0), Err(Error::InvalidRole));
    assert_eq!(escrow.fund(Role::Payer, 601, 0), Err(Error::InvalidTotal));
    assert_eq!(escrow.fund(Role::Payer, 600, 3), Err(Error::Expired));
    assert!(!escrow.is_funded());
    assert_eq!(escrow.fund(Role::Payer, 600, 2), Ok(()));
    assert_eq!(escrow.fund(Role::Payer, 600, 2), Err(Error::AlreadyFunded));
}

#[test]
fn approves_submitted_work_once_and_leaves_other_milestones_untouched() {
    let mut escrow = funded();
    assert_eq!(
        escrow.apply(Role::Payer, 0, Action::Approve, 0),
        Err(Error::InvalidState {
            expected: Status::Submitted,
            actual: Status::Pending
        })
    );
    submit(&mut escrow, 0);
    assert_eq!(
        escrow.apply(Role::Payer, 0, Action::Approve, 4),
        Ok(Some(Settlement {
            recipient: Role::Payee,
            amount: 150
        }))
    );
    assert_eq!(
        escrow.apply(Role::Payer, 0, Action::Approve, 4),
        Err(Error::InvalidState {
            expected: Status::Submitted,
            actual: Status::Released
        })
    );
    assert_eq!(
        escrow.milestones()[0].reference.as_deref(),
        Some("artifact:review")
    );
    assert_eq!(escrow.milestones()[1].status, Status::Pending);
}

#[test]
fn arbiter_alone_can_release_or_refund_and_cannot_resolve_twice() {
    for (release_to_payee, recipient, status) in [
        (true, Role::Payee, Status::Released),
        (false, Role::Payer, Status::Refunded),
    ] {
        let mut escrow = funded();
        let resolve = || Action::Resolve { release_to_payee };
        assert_eq!(
            escrow.apply(Role::Arbiter, 1, resolve(), 0),
            Err(Error::InvalidState {
                expected: Status::Disputed,
                actual: Status::Pending
            })
        );
        submit(&mut escrow, 1);
        assert_eq!(escrow.apply(Role::Payer, 1, Action::Dispute, 2), Ok(None));
        assert_eq!(
            escrow.apply(Role::Payer, 1, Action::Approve, 2),
            Err(Error::InvalidState {
                expected: Status::Submitted,
                actual: Status::Disputed
            })
        );
        assert_eq!(
            escrow.apply(Role::Arbiter, 1, resolve(), 10),
            Ok(Some(Settlement {
                recipient,
                amount: 200
            }))
        );
        assert!(matches!(
            escrow.apply(Role::Arbiter, 1, resolve(), 10),
            Err(Error::InvalidState { actual, .. }) if actual == status
        ));
        assert!(matches!(
            escrow.apply(Role::Payer, 1, Action::Approve, 10),
            Err(Error::InvalidState { actual, .. }) if actual == status
        ));
    }
}

#[test]
fn expiry_refunds_only_pending_milestones_at_or_after_the_deadline() {
    let mut escrow = funded();
    submit(&mut escrow, 0);
    assert_eq!(
        escrow.apply(Role::Payer, 2, Action::ClaimRefund, 8),
        Err(Error::NotExpired)
    );
    assert_eq!(
        escrow.apply(Role::Payee, 2, Action::Submit("late".into()), 9),
        Err(Error::Expired)
    );
    assert_eq!(
        escrow.apply(Role::Payer, 2, Action::ClaimRefund, 9),
        Ok(Some(Settlement {
            recipient: Role::Payer,
            amount: 250
        }))
    );
    for (index, actual) in [(0, Status::Submitted), (2, Status::Refunded)] {
        assert_eq!(
            escrow.apply(Role::Payer, index, Action::ClaimRefund, 10),
            Err(Error::InvalidState {
                expected: Status::Pending,
                actual
            })
        );
    }
}

#[test]
fn rejects_both_wrong_roles_for_every_action_without_mutating_state() {
    let mut escrow = funded();
    let before = escrow.clone();
    for role in [Role::Payer, Role::Payee, Role::Arbiter] {
        for (action, required) in [
            (Action::Submit("work".into()), Role::Payee),
            (Action::Approve, Role::Payer),
            (Action::Dispute, Role::Payer),
            (
                Action::Resolve {
                    release_to_payee: false,
                },
                Role::Arbiter,
            ),
            (Action::ClaimRefund, Role::Payer),
        ] {
            if role != required {
                assert_eq!(escrow.apply(role, 0, action, 0), Err(Error::InvalidRole));
            }
        }
    }
    assert_eq!(escrow, before);
}

#[test]
fn rejects_unfunded_actions_bad_indexes_and_invalid_work_references() {
    let mut escrow = agreement();
    assert_eq!(
        escrow.apply(Role::Payee, 0, Action::Submit("work".into()), 0),
        Err(Error::NotFunded)
    );
    escrow.fund(Role::Payer, 600, 0).unwrap();
    assert_eq!(
        escrow.apply(Role::Payer, 3, Action::Approve, 0),
        Err(Error::InvalidMilestone)
    );
    for reference in [" \u{00a0}\n".into(), "é".repeat(121)] {
        assert_eq!(
            escrow.apply(Role::Payee, 0, Action::Submit(reference), 0),
            Err(Error::InvalidReference)
        );
    }
    assert_eq!(escrow.milestones()[0].status, Status::Pending);
}

#[test]
fn funded_component_state_round_trips_through_cbor() {
    let mut escrow = funded();
    submit(&mut escrow, 0);
    let bytes = minicbor::to_vec(&escrow).unwrap();
    assert_eq!(minicbor::decode::<Escrow>(&bytes).unwrap(), escrow);
}
