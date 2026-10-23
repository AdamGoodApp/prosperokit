//! Example custom module. Call it from TypeScript:
//!
//! ```ts
//! import * as native from '@prosperokit/native/client'
//! const { sum } = await native.custom.example.add({ a: 2, b: 3 })
//! ```

use std::sync::Arc;

use pk_js::{ModuleRegistry, NativeError};
use pk_protocol::Value;

/// Called by the generated `.prosperokit/user-modules` crate at startup.
pub fn register(reg: &mut ModuleRegistry) {
    reg.add_async(
        "example",
        "add",
        Arc::new(|args: Value| -> Result<Value, NativeError> {
            let a = args
                .get_f64("a")
                .ok_or_else(|| NativeError::new("EINVAL", "example.add: `a` must be a number"))?;
            let b = args
                .get_f64("b")
                .ok_or_else(|| NativeError::new("EINVAL", "example.add: `b` must be a number"))?;
            Ok(Value::obj([("sum", Value::from(a + b))]))
        }),
    );
}
