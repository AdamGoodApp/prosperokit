//! `rquickjs::Value` ⇄ `pk_protocol::Value`.

use pk_protocol::Value;
use rquickjs::{ArrayBuffer, Ctx, Object, Result, Type, TypedArray, Value as JsValue};

const MAX_DEPTH: usize = 64;

/// Copies the bytes of a `Uint8Array` (any typed array / DataView / `Buffer`
/// view) or `ArrayBuffer`.
pub fn bytes_of(obj: &Object<'_>) -> Option<Vec<u8>> {
    if let Some(ta) = obj.as_typed_array::<u8>() {
        // SAFETY: copied immediately, no JS runs while the slice is alive.
        return Some(
            unsafe { ta.as_bytes() }
                .map(<[u8]>::to_vec)
                .unwrap_or_default(),
        );
    }
    if let Some(ab) = ArrayBuffer::from_object(obj.clone()) {
        // SAFETY: as above.
        return Some(
            unsafe { ab.as_bytes() }
                .map(<[u8]>::to_vec)
                .unwrap_or_default(),
        );
    }
    // Other views (Uint16Array, DataView, …): buffer + byteOffset + byteLength.
    let buffer: Option<Object<'_>> = obj.get("buffer").ok();
    let ab = buffer.and_then(ArrayBuffer::from_object)?;
    let off: usize = obj.get::<_, f64>("byteOffset").ok()? as usize;
    let len: usize = obj.get::<_, f64>("byteLength").ok()? as usize;
    // SAFETY: as above.
    let all = unsafe { ab.as_bytes() }.unwrap_or_default();
    Some(
        all.get(off..off.checked_add(len)?)
            .map(<[u8]>::to_vec)
            .unwrap_or_default(),
    )
}

pub fn from_js(v: &JsValue<'_>) -> Value {
    from_js_depth(v, 0)
}

fn from_js_depth(v: &JsValue<'_>, depth: usize) -> Value {
    match v.type_of() {
        Type::Bool => Value::Bool(v.as_bool().unwrap_or(false)),
        Type::Int => Value::Num(v.as_int().map(f64::from).unwrap_or(0.0)),
        Type::Float => Value::Num(v.as_float().unwrap_or(0.0)),
        Type::BigInt => Value::Null,
        Type::String => Value::Str(
            v.as_string()
                .and_then(|s| s.to_string().ok())
                .unwrap_or_default(),
        ),
        Type::Array => {
            if depth >= MAX_DEPTH {
                return Value::Null;
            }
            let Some(arr) = v.as_array() else {
                return Value::Null;
            };
            let mut out = Vec::with_capacity(arr.len());
            for i in 0..arr.len() {
                match arr.get::<JsValue<'_>>(i) {
                    Ok(item) => out.push(from_js_depth(&item, depth + 1)),
                    Err(_) => out.push(Value::Null),
                }
            }
            Value::Arr(out)
        }
        Type::Object | Type::Exception | Type::Proxy => {
            let Some(obj) = v.as_object() else {
                return Value::Null;
            };
            if let Some(bytes) = bytes_of(obj) {
                return Value::Bytes(bytes);
            }
            if depth >= MAX_DEPTH {
                return Value::Null;
            }
            let mut out = Vec::new();
            for prop in obj.props::<String, JsValue<'_>>() {
                let Ok((k, val)) = prop else { continue };
                if val.is_undefined() || val.is_function() || val.is_symbol() {
                    continue;
                }
                out.push((k, from_js_depth(&val, depth + 1)));
            }
            Value::Obj(out)
        }
        // undefined, null, functions, symbols
        _ => Value::Null,
    }
}

pub fn to_js<'js>(ctx: &Ctx<'js>, v: &Value) -> Result<JsValue<'js>> {
    Ok(match v {
        Value::Null => JsValue::new_null(ctx.clone()),
        Value::Bool(b) => JsValue::new_bool(ctx.clone(), *b),
        Value::Num(n) => {
            if n.fract() == 0.0 && n.abs() < 2_147_483_648.0 && !(*n == 0.0 && n.is_sign_negative())
            {
                JsValue::new_int(ctx.clone(), *n as i32)
            } else {
                JsValue::new_float(ctx.clone(), *n)
            }
        }
        Value::Str(s) => rquickjs::String::from_str(ctx.clone(), s)?.into_value(),
        Value::Bytes(b) => TypedArray::<u8>::new(ctx.clone(), b.clone())?.into_value(),
        Value::Arr(items) => {
            let arr = rquickjs::Array::new(ctx.clone())?;
            for (i, item) in items.iter().enumerate() {
                arr.set(i, to_js(ctx, item)?)?;
            }
            arr.into_value()
        }
        Value::Obj(entries) => {
            let obj = Object::new(ctx.clone())?;
            for (k, item) in entries {
                obj.set(k.as_str(), to_js(ctx, item)?)?;
            }
            obj.into_value()
        }
    })
}

/// `[[name, value], …]` or `{ name: value }` → pairs.
pub fn headers_from_value(v: &Value) -> Vec<(String, String)> {
    let stringify = |v: &Value| match v {
        Value::Str(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    };
    match v {
        Value::Arr(items) => items
            .iter()
            .filter_map(|p| Some((p.at(0)?.as_str()?.to_string(), stringify(p.at(1)?))))
            .collect(),
        Value::Obj(entries) => entries
            .iter()
            .map(|(k, v)| (k.clone(), stringify(v)))
            .collect(),
        _ => Vec::new(),
    }
}

pub fn headers_to_value(headers: &[(String, String)]) -> Value {
    Value::Arr(
        headers
            .iter()
            .map(|(k, v)| Value::Arr(vec![Value::Str(k.clone()), Value::Str(v.clone())]))
            .collect(),
    )
}

/// Body argument: bytes, string (UTF-8) or absent.
pub fn body_from_value(v: Option<&Value>) -> Vec<u8> {
    match v {
        Some(Value::Bytes(b)) => b.clone(),
        Some(Value::Str(s)) => s.clone().into_bytes(),
        _ => Vec::new(),
    }
}
