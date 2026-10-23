// `protocol.json` is a verbatim copy of `crates/pk-protocol/protocol.json`
// (the Rust side is the source of truth; a test asserts the two stay equal).
import protocol from './protocol.json' with { type: 'json' }

export default protocol
export const { ops, events, buttons, animatableProps, easings, screen, nodes, kinds } = protocol
