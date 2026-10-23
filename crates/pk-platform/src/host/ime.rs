//! Desktop IME: collects the text typed in the window while open. `Enter`
//! finishes with the text, `Escape` cancels; the runtime reads the live text
//! through `HostFrameHost::ime_live_text` to draw its overlay.

use crate::{Ime, ImeKind, ImePoll, ImeRequest, PlatformError};

/// One key press while the IME is open, already decoded from the window event.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ImeKey<'a> {
    Enter,
    Escape,
    Backspace,
    Text(&'a str),
}

enum State {
    Closed,
    Open {
        text: String,
        max_len: usize,
        kind: ImeKind,
    },
    Done(Option<String>),
}

pub struct HostIme {
    state: State,
}

impl HostIme {
    pub(crate) fn new() -> HostIme {
        HostIme {
            state: State::Closed,
        }
    }

    pub(crate) fn is_open(&self) -> bool {
        matches!(self.state, State::Open { .. })
    }

    /// The text typed so far while the dialog is open.
    pub fn live_text(&self) -> Option<&str> {
        match &self.state {
            State::Open { text, .. } => Some(text),
            _ => None,
        }
    }

    pub(crate) fn input(&mut self, key: ImeKey<'_>) {
        let State::Open {
            text,
            max_len,
            kind,
        } = &mut self.state
        else {
            return;
        };
        match key {
            ImeKey::Enter => {
                let done = std::mem::take(text);
                self.state = State::Done(Some(done));
            }
            ImeKey::Escape => self.state = State::Done(None),
            ImeKey::Backspace => {
                text.pop();
            }
            ImeKey::Text(typed) => {
                for ch in typed.chars() {
                    if ch.is_control() || text.chars().count() >= *max_len {
                        continue;
                    }
                    if *kind == ImeKind::Number
                        && !(ch.is_ascii_digit() || matches!(ch, '.' | '-' | '+'))
                    {
                        continue;
                    }
                    text.push(ch);
                }
            }
        }
    }
}

impl Ime for HostIme {
    fn open(&mut self, req: ImeRequest) -> Result<(), PlatformError> {
        if !matches!(self.state, State::Closed) {
            return Err(PlatformError::Busy);
        }
        let max_len = req.max_len.clamp(1, 512) as usize;
        let text: String = req.initial.chars().take(max_len).collect();
        self.state = State::Open {
            text,
            max_len,
            kind: req.kind,
        };
        Ok(())
    }

    fn poll(&mut self) -> ImePoll {
        match &self.state {
            State::Closed => ImePoll::Closed,
            State::Open { .. } => ImePoll::Open,
            State::Done(_) => match std::mem::replace(&mut self.state, State::Closed) {
                State::Done(result) => ImePoll::Done(result),
                _ => ImePoll::Closed,
            },
        }
    }

    fn live_text(&self) -> Option<String> {
        HostIme::live_text(self).map(str::to_string)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(initial: &str, max_len: u32, kind: ImeKind) -> ImeRequest {
        ImeRequest {
            title: "t".into(),
            placeholder: String::new(),
            initial: initial.into(),
            max_len,
            kind,
        }
    }

    #[test]
    fn typing_then_enter_finishes_with_the_text() {
        let mut ime = HostIme::new();
        assert_eq!(ime.poll(), ImePoll::Closed);
        ime.open(request("ab", 8, ImeKind::Text)).unwrap();
        assert_eq!(
            ime.open(request("", 8, ImeKind::Text)),
            Err(PlatformError::Busy)
        );
        ime.input(ImeKey::Text("cd"));
        ime.input(ImeKey::Backspace);
        ime.input(ImeKey::Text("é"));
        assert_eq!(ime.live_text(), Some("abcé"));
        assert_eq!(ime.poll(), ImePoll::Open);
        ime.input(ImeKey::Enter);
        assert_eq!(ime.poll(), ImePoll::Done(Some("abcé".into())));
        assert_eq!(ime.poll(), ImePoll::Closed);
    }

    #[test]
    fn escape_cancels() {
        let mut ime = HostIme::new();
        ime.open(request("x", 8, ImeKind::Text)).unwrap();
        ime.input(ImeKey::Escape);
        assert_eq!(ime.poll(), ImePoll::Done(None));
    }

    #[test]
    fn max_len_and_number_filter() {
        let mut ime = HostIme::new();
        ime.open(request("", 3, ImeKind::Number)).unwrap();
        ime.input(ImeKey::Text("1a2b3456"));
        assert_eq!(ime.live_text(), Some("123"));
        ime.input(ImeKey::Escape);
        ime.poll();
        ime.open(request("abcdef", 0, ImeKind::Text)).unwrap(); // max_len clamps to 1
        assert_eq!(ime.live_text(), Some("a"));
    }

    #[test]
    fn keys_are_ignored_while_closed() {
        let mut ime = HostIme::new();
        ime.input(ImeKey::Text("zzz"));
        ime.input(ImeKey::Enter);
        assert_eq!(ime.poll(), ImePoll::Closed);
    }
}
