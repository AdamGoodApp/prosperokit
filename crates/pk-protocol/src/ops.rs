//! Mutation ops (Phase 4 §4). A commit is a JS array of op arrays:
//! `[[1, id, kind, props], [3, parent, child], …]`.

use crate::color::Color;
use crate::props::{NodeId, PropsParse, parse_props};
use crate::style::Easing;
use crate::value::Value;

pub const OP_CREATE: u32 = 1;
pub const OP_UPDATE: u32 = 2;
pub const OP_APPEND: u32 = 3;
pub const OP_INSERT_BEFORE: u32 = 4;
pub const OP_REMOVE: u32 = 5;
pub const OP_SET_TEXT: u32 = 6;
pub const OP_SCROLL_TO: u32 = 7;
pub const OP_FOCUS: u32 = 8;
pub const OP_ANIMATE: u32 = 9;
pub const OP_MEASURE: u32 = 10;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum NodeKind {
    View,
    Text,
    RawText,
    Image,
    Scroll,
    Input,
    Icon,
}

impl NodeKind {
    pub fn parse(s: &str) -> Option<NodeKind> {
        Some(match s {
            "view" => NodeKind::View,
            "text" => NodeKind::Text,
            "rawtext" => NodeKind::RawText,
            "image" => NodeKind::Image,
            "scroll" => NodeKind::Scroll,
            "input" => NodeKind::Input,
            "icon" => NodeKind::Icon,
            _ => return None,
        })
    }
    pub fn as_str(self) -> &'static str {
        match self {
            NodeKind::View => "view",
            NodeKind::Text => "text",
            NodeKind::RawText => "rawtext",
            NodeKind::Image => "image",
            NodeKind::Scroll => "scroll",
            NodeKind::Input => "input",
            NodeKind::Icon => "icon",
        }
    }
}

/// Properties that can be animated (`protocol.json` `animatableProps`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum AnimProp {
    Opacity,
    TranslateX,
    TranslateY,
    Scale,
    ScaleX,
    ScaleY,
    Rotate,
    BackgroundColor,
    BorderColor,
    Color,
    Width,
    Height,
    Top,
    Left,
    ScrollX,
    ScrollY,
}

impl AnimProp {
    pub fn parse(s: &str) -> Option<AnimProp> {
        Some(match s {
            "opacity" => AnimProp::Opacity,
            "translateX" => AnimProp::TranslateX,
            "translateY" => AnimProp::TranslateY,
            "scale" => AnimProp::Scale,
            "scaleX" => AnimProp::ScaleX,
            "scaleY" => AnimProp::ScaleY,
            "rotate" => AnimProp::Rotate,
            "backgroundColor" => AnimProp::BackgroundColor,
            "borderColor" => AnimProp::BorderColor,
            "color" => AnimProp::Color,
            "width" => AnimProp::Width,
            "height" => AnimProp::Height,
            "top" => AnimProp::Top,
            "left" => AnimProp::Left,
            "scrollX" => AnimProp::ScrollX,
            "scrollY" => AnimProp::ScrollY,
            _ => return None,
        })
    }

    pub fn as_str(self) -> &'static str {
        match self {
            AnimProp::Opacity => "opacity",
            AnimProp::TranslateX => "translateX",
            AnimProp::TranslateY => "translateY",
            AnimProp::Scale => "scale",
            AnimProp::ScaleX => "scaleX",
            AnimProp::ScaleY => "scaleY",
            AnimProp::Rotate => "rotate",
            AnimProp::BackgroundColor => "backgroundColor",
            AnimProp::BorderColor => "borderColor",
            AnimProp::Color => "color",
            AnimProp::Width => "width",
            AnimProp::Height => "height",
            AnimProp::Top => "top",
            AnimProp::Left => "left",
            AnimProp::ScrollX => "scrollX",
            AnimProp::ScrollY => "scrollY",
        }
    }

    pub fn is_color(self) -> bool {
        matches!(
            self,
            AnimProp::BackgroundColor | AnimProp::BorderColor | AnimProp::Color
        )
    }

    pub fn affects_layout(self) -> bool {
        matches!(
            self,
            AnimProp::Width | AnimProp::Height | AnimProp::Top | AnimProp::Left
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum AnimValue {
    Num(f32),
    Color(Color),
}

#[derive(Clone, Debug, PartialEq)]
pub enum Op {
    Create {
        id: NodeId,
        kind: NodeKind,
        props: PropsParse,
    },
    Update {
        id: NodeId,
        props: PropsParse,
    },
    Append {
        parent: NodeId,
        child: NodeId,
    },
    InsertBefore {
        parent: NodeId,
        child: NodeId,
        before: NodeId,
    },
    Remove {
        parent: NodeId,
        child: NodeId,
    },
    SetText {
        id: NodeId,
        text: String,
    },
    ScrollTo {
        id: NodeId,
        x: f32,
        y: f32,
        animated: bool,
    },
    Focus {
        id: NodeId,
    },
    Animate {
        id: NodeId,
        prop: AnimProp,
        to: AnimValue,
        duration_ms: f32,
        easing: Easing,
        callback: u32,
    },
    Measure {
        id: NodeId,
        callback: u32,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OpError {
    NotAnArray,
    OpNotAnArray {
        index: usize,
    },
    UnknownCode {
        index: usize,
        code: i64,
    },
    BadArg {
        index: usize,
        code: u32,
        arg: usize,
        reason: String,
    },
}

impl std::fmt::Display for OpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OpError::NotAnArray => write!(f, "commit is not an array"),
            OpError::OpNotAnArray { index } => write!(f, "op #{index} is not an array"),
            OpError::UnknownCode { index, code } => {
                write!(f, "op #{index} has an unknown code {code}")
            }
            OpError::BadArg {
                index,
                code,
                arg,
                reason,
            } => {
                write!(f, "op #{index} (code {code}): bad argument {arg}: {reason}")
            }
        }
    }
}

impl std::error::Error for OpError {}

fn arg_u32(op: &[Value], index: usize, code: u32, arg: usize) -> Result<u32, OpError> {
    op.get(arg)
        .and_then(Value::as_u32)
        .ok_or_else(|| OpError::BadArg {
            index,
            code,
            arg,
            reason: "expected a non-negative integer".into(),
        })
}

fn arg_f32(op: &[Value], index: usize, code: u32, arg: usize) -> Result<f32, OpError> {
    op.get(arg)
        .and_then(Value::as_f64)
        .map(|n| n as f32)
        .ok_or_else(|| OpError::BadArg {
            index,
            code,
            arg,
            reason: "expected a number".into(),
        })
}

fn arg_str(op: &[Value], index: usize, code: u32, arg: usize) -> Result<&str, OpError> {
    op.get(arg)
        .and_then(Value::as_str)
        .ok_or_else(|| OpError::BadArg {
            index,
            code,
            arg,
            reason: "expected a string".into(),
        })
}

/// Parse one commit. Unknown prop keys do not fail the commit; they are kept
/// in each op's `PropsParse::unknown` for the caller to log.
pub fn parse_commit(v: &Value) -> Result<Vec<Op>, OpError> {
    let items = v.as_arr().ok_or(OpError::NotAnArray)?;
    let mut ops = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let op = item.as_arr().ok_or(OpError::OpNotAnArray { index })?;
        let code_raw = op
            .first()
            .and_then(Value::as_i64)
            .ok_or(OpError::OpNotAnArray { index })?;
        let code = u32::try_from(code_raw).map_err(|_| OpError::UnknownCode {
            index,
            code: code_raw,
        })?;
        let parsed = match code {
            OP_CREATE => {
                let id = arg_u32(op, index, code, 1)?;
                let kind_s = arg_str(op, index, code, 2)?;
                let kind = NodeKind::parse(kind_s).ok_or_else(|| OpError::BadArg {
                    index,
                    code,
                    arg: 2,
                    reason: format!("unknown node kind \"{kind_s}\""),
                })?;
                let props = parse_props(op.get(3).unwrap_or(&Value::Null));
                Op::Create { id, kind, props }
            }
            OP_UPDATE => Op::Update {
                id: arg_u32(op, index, code, 1)?,
                props: parse_props(op.get(2).unwrap_or(&Value::Null)),
            },
            OP_APPEND => Op::Append {
                parent: arg_u32(op, index, code, 1)?,
                child: arg_u32(op, index, code, 2)?,
            },
            OP_INSERT_BEFORE => Op::InsertBefore {
                parent: arg_u32(op, index, code, 1)?,
                child: arg_u32(op, index, code, 2)?,
                before: arg_u32(op, index, code, 3)?,
            },
            OP_REMOVE => Op::Remove {
                parent: arg_u32(op, index, code, 1)?,
                child: arg_u32(op, index, code, 2)?,
            },
            OP_SET_TEXT => Op::SetText {
                id: arg_u32(op, index, code, 1)?,
                text: match op.get(2) {
                    Some(Value::Str(s)) => s.clone(),
                    Some(Value::Num(n)) => n.to_string(),
                    Some(Value::Null) | None => String::new(),
                    Some(other) => other.to_string(),
                },
            },
            OP_SCROLL_TO => Op::ScrollTo {
                id: arg_u32(op, index, code, 1)?,
                x: arg_f32(op, index, code, 2)?,
                y: arg_f32(op, index, code, 3)?,
                animated: op.get(4).and_then(Value::as_bool).unwrap_or(false),
            },
            OP_FOCUS => Op::Focus {
                id: arg_u32(op, index, code, 1)?,
            },
            OP_ANIMATE => {
                let id = arg_u32(op, index, code, 1)?;
                let prop_s = arg_str(op, index, code, 2)?;
                let prop = AnimProp::parse(prop_s).ok_or_else(|| OpError::BadArg {
                    index,
                    code,
                    arg: 2,
                    reason: format!("\"{prop_s}\" is not animatable"),
                })?;
                let to_v = op.get(3).unwrap_or(&Value::Null);
                let to = if prop.is_color() {
                    AnimValue::Color(Color::from_value(to_v).ok_or_else(|| OpError::BadArg {
                        index,
                        code,
                        arg: 3,
                        reason: "expected a colour".into(),
                    })?)
                } else {
                    AnimValue::Num(arg_f32(op, index, code, 3)?)
                };
                let duration_ms = arg_f32(op, index, code, 4)?;
                let easing = match op.get(5) {
                    None | Some(Value::Null) => Easing::Ease,
                    Some(e) => Easing::parse(e).ok_or_else(|| OpError::BadArg {
                        index,
                        code,
                        arg: 5,
                        reason: "unknown easing".into(),
                    })?,
                };
                let callback = op.get(6).and_then(Value::as_u32).unwrap_or(0);
                Op::Animate {
                    id,
                    prop,
                    to,
                    duration_ms,
                    easing,
                    callback,
                }
            }
            OP_MEASURE => Op::Measure {
                id: arg_u32(op, index, code, 1)?,
                callback: arg_u32(op, index, code, 2)?,
            },
            other => {
                return Err(OpError::UnknownCode {
                    index,
                    code: other as i64,
                });
            }
        };
        ops.push(parsed);
    }
    Ok(ops)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(json: &str) -> Value {
        Value::from_json(&serde_json::from_str(json).unwrap())
    }

    #[test]
    fn parses_a_commit() {
        let ops = parse_commit(&v(r#"[[1,2,"view",{"focusable":true}],[1,3,"text",{}],[1,4,"rawtext",null],
            [6,4,"Hi"],[3,3,4],[3,2,3],[3,0,2],[2,2,{"disabled":null}],[7,2,0,100,true],[8,2],
            [9,2,"opacity",0.5,200,"ease-out",11],[9,2,"backgroundColor",4278190335,100,null,0],[10,2,12],[5,0,2]]"#))
        .unwrap();
        assert_eq!(ops.len(), 14);
        assert!(matches!(
            ops[0],
            Op::Create {
                id: 2,
                kind: NodeKind::View,
                ..
            }
        ));
        assert!(matches!(&ops[3], Op::SetText { id: 4, text } if text == "Hi"));
        assert!(matches!(
            ops[6],
            Op::Append {
                parent: 0,
                child: 2
            }
        ));
        assert!(matches!(ops[8], Op::ScrollTo { id: 2, x, y: 100.0, animated: true } if x == 0.0));
        assert!(matches!(
            ops[10],
            Op::Animate {
                prop: AnimProp::Opacity,
                to: AnimValue::Num(0.5),
                duration_ms: 200.0,
                easing: Easing::EaseOut,
                callback: 11,
                ..
            }
        ));
        assert!(matches!(
            ops[11],
            Op::Animate {
                prop: AnimProp::BackgroundColor,
                to: AnimValue::Color(_),
                easing: Easing::Ease,
                ..
            }
        ));
        assert!(matches!(
            ops[12],
            Op::Measure {
                id: 2,
                callback: 12
            }
        ));
    }

    #[test]
    fn rejects_bad_ops() {
        assert_eq!(parse_commit(&v("5")), Err(OpError::NotAnArray));
        assert_eq!(
            parse_commit(&v("[[99]]")),
            Err(OpError::UnknownCode { index: 0, code: 99 })
        );
        assert!(matches!(
            parse_commit(&v(r#"[[1,2,"blob",{}]]"#)),
            Err(OpError::BadArg { arg: 2, .. })
        ));
        assert!(matches!(
            parse_commit(&v(r#"[[9,2,"width","x",1,null,0]]"#)),
            Err(OpError::BadArg { arg: 3, .. })
        ));
    }
}
