use std::fmt;

use minicbor::{CborLen, Decode, Encode};

pub const MAX_REFERENCE_BYTES: usize = 240;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Payer,
    Payee,
    Arbiter,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Encode, Decode, CborLen)]
#[cbor(index_only)]
pub enum Status {
    #[n(0)]
    Pending,
    #[n(1)]
    Submitted,
    #[n(2)]
    Disputed,
    #[n(3)]
    Released,
    #[n(4)]
    Refunded,
}

pub enum Action {
    Submit(String),
    Approve,
    Dispute,
    Resolve { release_to_payee: bool },
    ClaimRefund,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Error {
    InvalidCount,
    InvalidAmount,
    InvalidTotal,
    InvalidDeadline,
    InvalidRole,
    AlreadyFunded,
    NotFunded,
    InvalidMilestone,
    InvalidState { expected: Status, actual: Status },
    NotExpired,
    Expired,
    InvalidReference,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidCount => f.write_str("Specify two or three milestones"),
            Self::InvalidAmount => f.write_str("Amounts must be positive"),
            Self::InvalidTotal => f.write_str("Amounts must sum to the escrow total exactly"),
            Self::InvalidDeadline => f.write_str("All deadlines must be in the future"),
            Self::InvalidRole => f.write_str("This role cannot perform that action"),
            Self::AlreadyFunded => f.write_str("Escrow is already funded"),
            Self::NotFunded => f.write_str("Fund the escrow first"),
            Self::InvalidMilestone => f.write_str("That milestone does not exist"),
            Self::InvalidState { expected, actual } => {
                write!(f, "Milestone is {actual:?}; expected {expected:?}")
            }
            Self::NotExpired => f.write_str("The deadline has not passed"),
            Self::Expired => f.write_str("The deadline has been reached"),
            Self::InvalidReference => f.write_str("Provide a work reference of 1–240 bytes"),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Encode, Decode, CborLen)]
pub struct Milestone {
    #[n(0)]
    pub amount: u64,
    #[n(1)]
    pub deadline: u64,
    #[n(2)]
    pub status: Status,
    #[n(3)]
    pub reference: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Encode, Decode, CborLen)]
pub struct Escrow {
    #[n(0)]
    total: u64,
    #[n(1)]
    funded: bool,
    #[n(2)]
    milestones: Vec<Milestone>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Settlement {
    pub recipient: Role,
    pub amount: u64,
}

impl Escrow {
    pub fn new(total: u64, terms: Vec<(u64, u64)>, now: u64) -> Result<Self, Error> {
        if !(2..=3).contains(&terms.len()) {
            return Err(Error::InvalidCount);
        }
        if total == 0 || terms.iter().any(|&(amount, _)| amount == 0) {
            return Err(Error::InvalidAmount);
        }
        if terms
            .iter()
            .try_fold(0u64, |sum, &(amount, _)| sum.checked_add(amount))
            != Some(total)
        {
            return Err(Error::InvalidTotal);
        }
        if terms.iter().any(|&(_, deadline)| deadline <= now) {
            return Err(Error::InvalidDeadline);
        }
        let milestones = terms
            .into_iter()
            .map(|(amount, deadline)| Milestone {
                amount,
                deadline,
                status: Status::Pending,
                reference: None,
            })
            .collect();
        Ok(Self {
            total,
            funded: false,
            milestones,
        })
    }

    pub fn total(&self) -> u64 {
        self.total
    }

    pub fn is_funded(&self) -> bool {
        self.funded
    }

    pub fn milestones(&self) -> &[Milestone] {
        &self.milestones
    }

    pub fn fund(&mut self, role: Role, amount: u64, now: u64) -> Result<(), Error> {
        if role != Role::Payer {
            return Err(Error::InvalidRole);
        }
        if self.funded {
            return Err(Error::AlreadyFunded);
        }
        if amount != self.total {
            return Err(Error::InvalidTotal);
        }
        if self.milestones.iter().any(|m| now >= m.deadline) {
            return Err(Error::Expired);
        }
        self.funded = true;
        Ok(())
    }

    pub fn apply(
        &mut self,
        role: Role,
        index: usize,
        action: Action,
        now: u64,
    ) -> Result<Option<Settlement>, Error> {
        let (required_role, expected) = match &action {
            Action::Submit(_) => (Role::Payee, Status::Pending),
            Action::Approve | Action::Dispute => (Role::Payer, Status::Submitted),
            Action::Resolve { .. } => (Role::Arbiter, Status::Disputed),
            Action::ClaimRefund => (Role::Payer, Status::Pending),
        };
        if role != required_role {
            return Err(Error::InvalidRole);
        }
        if !self.funded {
            return Err(Error::NotFunded);
        }
        let milestone = self
            .milestones
            .get_mut(index)
            .ok_or(Error::InvalidMilestone)?;
        if milestone.status != expected {
            return Err(Error::InvalidState {
                expected,
                actual: milestone.status,
            });
        }
        let (next, recipient) = match action {
            Action::Submit(reference) => {
                if now >= milestone.deadline {
                    return Err(Error::Expired);
                }
                if reference.trim().is_empty() || reference.len() > MAX_REFERENCE_BYTES {
                    return Err(Error::InvalidReference);
                }
                milestone.reference = Some(reference);
                (Status::Submitted, None)
            }
            Action::Dispute => (Status::Disputed, None),
            Action::Approve
            | Action::Resolve {
                release_to_payee: true,
            } => (Status::Released, Some(Role::Payee)),
            Action::Resolve {
                release_to_payee: false,
            } => (Status::Refunded, Some(Role::Payer)),
            Action::ClaimRefund => {
                if now < milestone.deadline {
                    return Err(Error::NotExpired);
                }
                (Status::Refunded, Some(Role::Payer))
            }
        };
        milestone.status = next;
        Ok(recipient.map(|recipient| Settlement {
            recipient,
            amount: milestone.amount,
        }))
    }
}
