//! Engine tests. Time is driven explicitly through `tick(now_ms)` — no sleeps.

use pk_platform::PadSnapshot;
use pk_protocol::events::{EventKind, UiEvent};
use pk_protocol::ops::{Op, parse_commit};
use pk_protocol::style::{Easing, Overflow};
use pk_protocol::{NodeId, Rect, SCREEN_HEIGHT, SCREEN_WIDTH, TileSet, Value};

use crate::{DecodedImage, Engine, EngineConfig, FrameOutput, SoundCue};

const CROSS: u32 = 0x4000;
const CIRCLE: u32 = 0x2000;
const RIGHT: u32 = 0x0020;
const DOWN: u32 = 0x0040;
const TRIANGLE: u32 = 0x1000;

fn ops(json: &str) -> Vec<Op> {
    let v: serde_json::Value = serde_json::from_str(json).expect("test json");
    parse_commit(&Value::from_json(&v)).expect("test ops")
}

fn engine() -> Engine {
    Engine::new(EngineConfig {
        ui_sounds: true,
        ..EngineConfig::default()
    })
}

fn commit(e: &mut Engine, json: &str) {
    let warnings = e.apply_commit(&ops(json));
    assert!(warnings.is_empty(), "warnings: {warnings:?}");
}

fn pad(buttons: u32) -> PadSnapshot {
    PadSnapshot {
        buttons,
        connected: true,
        ..PadSnapshot::default()
    }
}

fn tick(e: &mut Engine, t: f64) -> FrameOutput {
    e.tick(&pad(0), t)
}

fn frame() -> Vec<u32> {
    vec![0u32; (SCREEN_WIDTH * SCREEN_HEIGHT) as usize]
}

fn rect(e: &Engine, id: NodeId) -> Rect {
    e.node_rect(id).expect("node exists")
}

fn events_of(out: &FrameOutput, kind: EventKind) -> Vec<&UiEvent> {
    out.events.iter().filter(|e| e.kind == kind).collect()
}

/// A 3×3 grid of 100×100 focusable cells (ids 10..=18) with 10 px gaps.
fn grid_commit(disabled: Option<u32>) -> String {
    let mut ops = vec![r#"[1,2,"view",{"style":{"flexDirection":"row","flexWrap":"wrap","gap":10,"width":320,"height":320}}]"#.to_string()];
    for i in 0..9u32 {
        let dis = if disabled == Some(10 + i) {
            r#","disabled":true"#
        } else {
            ""
        };
        ops.push(format!(
            r#"[1,{},"view",{{"focusable":true,"style":{{"width":100,"height":100}}{dis}}}]"#,
            10 + i
        ));
        ops.push(format!("[3,2,{}]", 10 + i));
    }
    ops.push("[3,0,2]".to_string());
    format!("[{}]", ops.join(","))
}

#[test]
fn three_child_flex_row_with_gaps_has_exact_rects() {
    let mut e = engine();
    commit(
        &mut e,
        r#"[[1,2,"view",{"style":{"flexDirection":"row","gap":10,"width":400,"height":100}}],
            [1,3,"view",{"style":{"width":100,"height":50}}],[1,4,"view",{"style":{"width":100,"height":50}}],[1,5,"view",{"style":{"width":100,"height":50}}],
            [3,2,3],[3,2,4],[3,2,5],[3,0,2]]"#,
    );
    tick(&mut e, 0.0);
    assert_eq!(rect(&e, 2), Rect::new(0.0, 0.0, 400.0, 100.0));
    assert_eq!(rect(&e, 3), Rect::new(0.0, 0.0, 100.0, 50.0));
    assert_eq!(rect(&e, 4), Rect::new(110.0, 0.0, 100.0, 50.0));
    assert_eq!(rect(&e, 5), Rect::new(220.0, 0.0, 100.0, 50.0));
}

#[test]
fn root_and_overlay_exist_and_fill_the_screen() {
    let mut e = engine();
    tick(&mut e, 0.0);
    assert_eq!(rect(&e, 0), Rect::new(0.0, 0.0, 1920.0, 1080.0));
    assert_eq!(rect(&e, 1), Rect::new(0.0, 0.0, 1920.0, 1080.0));
}

#[test]
fn classes_merge_under_explicit_style() {
    let mut e = engine();
    e.set_style_table(pk_protocol::StyleTable::parse_json(r#"{"tokens":{"w":0,"h":1},"styles":[{"base":{"width":50,"height":60}},{"base":{"height":70}}]}"#).expect("table"));
    commit(
        &mut e,
        r#"[[1,2,"view",{"classes":[0,1],"style":{"width":80}}],[3,0,2]]"#,
    );
    tick(&mut e, 0.0);
    // explicit width wins, later class wins for height
    assert_eq!(rect(&e, 2), Rect::new(0.0, 0.0, 80.0, 70.0));
}

#[test]
fn grid_navigation_skips_a_disabled_cell() {
    let mut e = engine();
    commit(&mut e, &grid_commit(Some(14)));
    tick(&mut e, 0.0);
    assert_eq!(
        e.focused(),
        Some(10),
        "initial focus is the first focusable"
    );
    let mut seq = Vec::new();
    for (i, d) in [DOWN, RIGHT, DOWN].iter().enumerate() {
        // release between presses
        e.tick(&pad(*d), 100.0 + i as f64 * 100.0);
        seq.push(e.focused());
        e.tick(&pad(0), 150.0 + i as f64 * 100.0);
    }
    assert_eq!(
        seq,
        vec![Some(13), Some(15), Some(18)],
        "down, right (skipping disabled 14), down"
    );
    e.tick(&pad(0x0080), 1000.0); // left
    assert_eq!(e.focused(), Some(17));
    e.tick(&pad(0), 1050.0);
    e.tick(&pad(0x0010), 1100.0); // up: 14 is disabled so 11
    assert_eq!(e.focused(), Some(11));
    assert!(e.find_by_test_id("none").is_none());
}

#[test]
fn full_grid_walk_without_disabled_cells() {
    let mut e = engine();
    commit(&mut e, &grid_commit(None));
    tick(&mut e, 0.0);
    let mut t = 100.0;
    let mut visited = vec![e.focused().unwrap()];
    for d in [RIGHT, RIGHT, DOWN, 0x0080, 0x0080, DOWN, RIGHT, 0x0010] {
        e.tick(&pad(d), t);
        visited.push(e.focused().unwrap());
        e.tick(&pad(0), t + 20.0);
        t += 100.0;
    }
    assert_eq!(visited, vec![10, 11, 12, 15, 14, 13, 16, 17, 14]);
}

#[test]
fn nav_repeats_after_350ms_then_every_80ms() {
    let mut e = engine();
    // A row of ten focusable cells.
    let mut ops = vec![
        r#"[1,2,"view",{"style":{"flexDirection":"row","width":1000,"height":100}}]"#.to_string(),
    ];
    for i in 0..10u32 {
        ops.push(format!(
            r#"[1,{},"view",{{"focusable":true,"style":{{"width":100,"height":100}}}}]"#,
            10 + i
        ));
        ops.push(format!("[3,2,{}]", 10 + i));
    }
    ops.push("[3,0,2]".into());
    commit(&mut e, &format!("[{}]", ops.join(",")));
    tick(&mut e, 0.0);
    let mut moved_at = Vec::new();
    let mut last = e.focused().unwrap();
    for t in (0..=600).step_by(10) {
        e.tick(&pad(RIGHT), 1000.0 + t as f64);
        let f = e.focused().unwrap();
        if f != last {
            moved_at.push(t);
            last = f;
        }
    }
    assert_eq!(moved_at, vec![0, 350, 430, 510, 590]);
}

#[test]
fn explicit_next_focus_overrides_the_search() {
    let mut e = engine();
    commit(
        &mut e,
        r#"[[1,2,"view",{"focusable":true,"nextFocusRight":4,"style":{"width":100,"height":100}}],
            [1,3,"view",{"focusable":true,"style":{"width":100,"height":100}}],
            [1,4,"view",{"focusable":true,"style":{"width":100,"height":100,"position":"absolute","top":500,"left":900}}],
            [3,0,2],[3,0,3],[3,0,4]]"#,
    );
    tick(&mut e, 0.0);
    assert_eq!(e.focused(), Some(2));
    e.tick(&pad(RIGHT), 10.0);
    assert_eq!(e.focused(), Some(4));
}

#[test]
fn focus_trap_blocks_navigation_fires_boundary_and_restores_focus() {
    let mut e = engine();
    commit(
        &mut e,
        r#"[[1,10,"view",{"focusable":true,"style":{"width":100,"height":100}}],
            [1,11,"view",{"focusable":true,"style":{"width":100,"height":100}}],[3,0,10],[3,0,11]]"#,
    );
    tick(&mut e, 0.0);
    e.tick(&pad(DOWN), 10.0);
    assert_eq!(e.focused(), Some(11));
    e.tick(&pad(0), 20.0);
    // Open a modal scope to the right of the page content.
    commit(
        &mut e,
        r#"[[1,20,"view",{"focusScope":{"trap":true,"restore":true},"events":32768,"style":{"position":"absolute","left":500,"top":0,"width":300,"height":100,"flexDirection":"row"}}],
            [1,21,"view",{"focusable":true,"style":{"width":100,"height":100}}],[1,22,"view",{"focusable":true,"style":{"width":100,"height":100}}],
            [3,20,21],[3,20,22],[3,0,20]]"#,
    );
    tick(&mut e, 30.0);
    assert_eq!(e.focused(), Some(21), "focus moves into the trap");
    // Left has nothing inside the scope: focus stays, boundary fires with an error cue.
    let out = e.tick(&pad(0x0080), 40.0);
    assert_eq!(e.focused(), Some(21));
    let boundary = events_of(&out, EventKind::FocusBoundary);
    assert_eq!(boundary.len(), 1);
    assert_eq!(boundary[0].target, 20);
    assert_eq!(boundary[0].payload.get_str("direction"), Some("left"));
    assert!(out.sounds.contains(&SoundCue::Error));
    e.tick(&pad(0), 50.0);
    e.tick(&pad(RIGHT), 60.0);
    assert_eq!(e.focused(), Some(22));
    e.tick(&pad(0), 70.0);
    // Closing the modal restores the focus held before it opened.
    commit(&mut e, "[[5,0,20]]");
    tick(&mut e, 80.0);
    assert_eq!(e.focused(), Some(11));
}

#[test]
fn removed_focused_node_falls_back_to_the_first_focusable() {
    let mut e = engine();
    commit(
        &mut e,
        r#"[[1,2,"view",{"focusable":true,"style":{"width":100,"height":100}}],[1,3,"view",{"focusable":true,"style":{"width":100,"height":100}}],[3,0,2],[3,0,3]]"#,
    );
    tick(&mut e, 0.0);
    assert_eq!(e.focused(), Some(2));
    commit(&mut e, "[[5,0,2]]");
    tick(&mut e, 10.0);
    assert_eq!(e.focused(), Some(3));
}

#[test]
fn auto_focus_wins_over_tree_order() {
    let mut e = engine();
    commit(
        &mut e,
        r#"[[1,2,"view",{"focusable":true,"style":{"width":100,"height":100}}],[1,3,"view",{"focusable":true,"autoFocus":true,"style":{"width":100,"height":100}}],[3,0,2],[3,0,3]]"#,
    );
    tick(&mut e, 0.0);
    assert_eq!(e.focused(), Some(3));
}

#[test]
fn moving_a_node_keeps_it_alive_and_reorders() {
    let mut e = engine();
    commit(
        &mut e,
        r#"[[1,2,"view",{}],[1,3,"view",{"style":{"width":10,"height":10}}],[3,2,3],[3,0,2],[1,4,"view",{}],[3,0,4]]"#,
    );
    tick(&mut e, 0.0);
    commit(&mut e, "[[3,4,3]]"); // append of an attached child moves it
    tick(&mut e, 1.0);
    assert_eq!(e.tree.get(3).and_then(|n| n.parent), Some(4));
    assert!(e.tree.get(2).is_some_and(|n| n.children.is_empty()));
}

#[test]
fn dirty_tiles_of_a_10px_move_are_old_union_new() {
    let mut e = engine();
    let node = |left: i32| {
        format!(
            r##"[[2,2,{{"style":{{"position":"absolute","left":{left},"top":300,"width":100,"height":100,"backgroundColor":"#ff0000"}}}}]]"##
        )
    };
    commit(
        &mut e,
        r##"[[1,2,"view",{"style":{"position":"absolute","left":118,"top":300,"width":100,"height":100,"backgroundColor":"#ff0000"}}],[3,0,2]]"##,
    );
    tick(&mut e, 0.0);
    let mut f = frame();
    let first = e.render(&mut f);
    assert!(first.count() > 100, "first frame paints the whole screen");
    // Idle.
    assert!(!tick(&mut e, 16.0).needs_render);
    assert!(e.render(&mut f).is_empty());
    // Move by 10 px.
    commit(&mut e, &node(128));
    let out = tick(&mut e, 32.0);
    assert!(out.needs_render);
    let dirty = e.render(&mut f);
    let mut expected = TileSet::empty();
    expected.insert_rect(&Rect::new(118.0, 300.0, 100.0, 100.0));
    expected.insert_rect(&Rect::new(128.0, 300.0, 100.0, 100.0));
    assert_eq!(dirty, expected);
    // Old tile set spans two columns, the new rect only one, so union != new alone.
    let mut only_new = TileSet::empty();
    only_new.insert_rect(&Rect::new(128.0, 300.0, 100.0, 100.0));
    assert_ne!(dirty, only_new);
    // The pixels moved.
    let px = |x: usize, y: usize| f[y * 1920 + x];
    assert_eq!(
        px(120, 350),
        0xff17_0f0b,
        "old column uncovered (opaque root background)"
    );
    assert_eq!(
        px(200, 350),
        0xff00_00ff,
        "node painted at its new place (bytes R,G,B,A)"
    );
}

#[test]
fn transition_value_at_half_time_follows_ease_out() {
    let mut e = engine();
    commit(
        &mut e,
        r##"[[1,2,"view",{"style":{"width":100,"height":100,"opacity":1,"backgroundColor":"#ffffff"},"transition":{"duration":200,"easing":"ease-out"}}],[3,0,2]]"##,
    );
    tick(&mut e, 0.0);
    commit(
        &mut e,
        r##"[[2,2,{"style":{"width":100,"height":100,"opacity":0.2,"backgroundColor":"#ffffff"}}]]"##,
    );
    tick(&mut e, 1000.0);
    tick(&mut e, 1100.0);
    let v = e.tree.get(2).and_then(|n| n.cur.opacity).expect("opacity");
    let expected = 1.0 + (0.2 - 1.0) * Easing::EaseOut.apply(0.5);
    assert!((v - expected).abs() < 1e-3, "{v} vs {expected}");
    assert!(
        v < 0.6 && v > 0.2,
        "ease-out is past the linear midpoint: {v}"
    );
    tick(&mut e, 1200.0);
    assert_eq!(e.tree.get(2).and_then(|n| n.cur.opacity), Some(0.2));
}

#[test]
fn focus_transition_animates_the_focus_style() {
    let mut e = engine();
    commit(
        &mut e,
        r##"[[1,2,"view",{"focusable":true,"style":{"width":100,"height":100,"opacity":1},"styleFocus":{"opacity":0.5},"transition":{"duration":100,"easing":"linear"}}],[3,0,2]]"##,
    );
    tick(&mut e, 0.0); // initial focus starts the run
    tick(&mut e, 50.0);
    let v = e.tree.get(2).and_then(|n| n.cur.opacity).expect("opacity");
    assert!((v - 0.75).abs() < 1e-3, "{v}");
}

#[test]
fn imperative_animate_fires_animation_end_with_the_callback() {
    let mut e = engine();
    commit(
        &mut e,
        r#"[[1,2,"view",{"style":{"width":100,"height":100}}],[3,0,2],[9,2,"opacity",0.25,100,"linear",77]]"#,
    );
    tick(&mut e, 0.0);
    let mid = tick(&mut e, 50.0);
    assert!(events_of(&mid, EventKind::AnimationEnd).is_empty());
    let v = e.tree.get(2).and_then(|n| n.cur.opacity).expect("opacity");
    assert!((v - 0.625).abs() < 1e-3, "{v}");
    let end = tick(&mut e, 120.0);
    let ev = events_of(&end, EventKind::AnimationEnd);
    assert_eq!(ev.len(), 1, "always delivered, no mask bit needed");
    assert_eq!(
        (ev[0].target, ev[0].payload.get_f64("callback")),
        (2, Some(77.0))
    );
    assert_eq!(
        e.tree.get(2).and_then(|n| n.cur.opacity),
        Some(0.25),
        "imperative values persist"
    );
}

fn scroll_list(n: u32) -> String {
    let mut ops =
        vec![r#"[1,2,"scroll",{"events":256,"style":{"width":400,"height":600}}]"#.to_string()];
    for i in 0..n {
        ops.push(format!(
            r#"[1,{},"view",{{"focusable":true,"style":{{"width":380,"height":100}}}}]"#,
            10 + i
        ));
        ops.push(format!("[3,2,{}]", 10 + i));
    }
    ops.push("[3,0,2]".into());
    format!("[{}]", ops.join(","))
}

#[test]
fn focus_scrolls_the_item_into_view_with_48px_padding() {
    let mut e = engine();
    commit(&mut e, &scroll_list(20));
    tick(&mut e, 0.0);
    assert_eq!(e.tree.get(2).map(|n| n.content), Some((400.0, 2000.0)));
    // Focus item #10 (y = 1000..1100) directly.
    commit(&mut e, "[[8,20]]");
    tick(&mut e, 100.0); // starts the 150 ms animation
    tick(&mut e, 175.0); // halfway, eased
    let mid = e.tree.get(2).map(|n| n.scroll.1).expect("scroll");
    assert!(mid > 0.0 && mid < 548.0, "{mid}");
    let out = tick(&mut e, 400.0);
    let y = e.tree.get(2).map(|n| n.scroll.1).expect("scroll");
    assert_eq!(y, 1000.0 + 100.0 + 48.0 - 600.0);
    assert_eq!(rect(&e, 20).y, 1000.0 - 548.0);
    // onScroll fired once with the final offsets.
    let scrolls = events_of(&out, EventKind::Scroll);
    assert!(scrolls.len() <= 1);
    // Scrolling back up reveals with padding at the top: item 0 is above the viewport.
    commit(&mut e, "[[8,10]]");
    tick(&mut e, 500.0);
    tick(&mut e, 800.0);
    assert_eq!(
        e.tree.get(2).map(|n| n.scroll.1),
        Some(0.0),
        "clamped at the top"
    );
}

#[test]
fn scroll_events_fire_at_most_once_per_frame() {
    let mut e = engine();
    commit(&mut e, &scroll_list(20));
    tick(&mut e, 0.0);
    commit(&mut e, "[[7,2,0,300,false]]");
    let out = tick(&mut e, 16.0);
    let scrolls = events_of(&out, EventKind::Scroll);
    assert_eq!(scrolls.len(), 1);
    let p = &scrolls[0].payload;
    assert_eq!(
        (
            p.get_f64("y"),
            p.get_f64("contentH"),
            p.get_f64("viewportH")
        ),
        (Some(300.0), Some(2000.0), Some(600.0))
    );
    assert!(events_of(&tick(&mut e, 32.0), EventKind::Scroll).is_empty());
    // Out-of-range targets clamp.
    commit(&mut e, "[[7,2,0,99999,false]]");
    tick(&mut e, 48.0);
    assert_eq!(e.tree.get(2).map(|n| n.scroll.1), Some(1400.0));
}

#[test]
fn right_stick_scrolls_at_1400_px_per_second() {
    let mut e = engine();
    commit(&mut e, &scroll_list(20));
    tick(&mut e, 0.0);
    let snap = PadSnapshot {
        ry: 127,
        connected: true,
        ..PadSnapshot::default()
    };
    e.tick(&pad(0), 1000.0);
    e.tick(&snap, 1100.0); // dt = 100 ms (the clamp) → 140 px
    let y = e.tree.get(2).map(|n| n.scroll.1).expect("scroll");
    assert!((y - 140.0).abs() < 0.5, "{y}");
}

#[test]
fn cross_press_long_press_and_masks() {
    let mut e = engine();
    // mask: press 4 | pressIn 8 | pressOut 16 | longPress 32
    commit(
        &mut e,
        r#"[[1,2,"view",{"focusable":true,"events":60,"style":{"width":100,"height":100}}],[3,0,2]]"#,
    );
    tick(&mut e, 0.0);
    let down = e.tick(&pad(CROSS), 100.0);
    assert_eq!(events_of(&down, EventKind::PressIn).len(), 1);
    assert!(e.tree.get(2).is_some_and(|n| n.state.pressed));
    let up = e.tick(&pad(0), 200.0);
    let kinds: Vec<EventKind> = up.events.iter().map(|ev| ev.kind).collect();
    assert_eq!(kinds, vec![EventKind::Press, EventKind::PressOut]);
    assert!(up.sounds.contains(&SoundCue::Select));
    // Long press: fires once after 500 ms; a node that handles longPress does not also get press.
    e.tick(&pad(CROSS), 1000.0);
    let mid = e.tick(&pad(CROSS), 1499.0);
    assert!(events_of(&mid, EventKind::LongPress).is_empty());
    let long = e.tick(&pad(CROSS), 1500.0);
    assert_eq!(events_of(&long, EventKind::LongPress).len(), 1);
    assert!(events_of(&e.tick(&pad(CROSS), 1700.0), EventKind::LongPress).is_empty());
    let rel = e.tick(&pad(0), 1800.0);
    assert!(events_of(&rel, EventKind::Press).is_empty());
    assert_eq!(events_of(&rel, EventKind::PressOut).len(), 1);
}

#[test]
fn events_require_the_subscription_bit() {
    let mut e = engine();
    commit(
        &mut e,
        r#"[[1,2,"view",{"focusable":true,"style":{"width":100,"height":100}}],[3,0,2]]"#,
    );
    tick(&mut e, 0.0);
    e.tick(&pad(CROSS), 100.0);
    let up = e.tick(&pad(0), 200.0);
    assert!(up.events.is_empty());
}

#[test]
fn back_and_key_are_always_delivered_to_the_focused_node_or_the_root() {
    let mut e = engine();
    // Nothing subscribes: JS still needs them (it bubbles and runs the default handler).
    commit(
        &mut e,
        r#"[[1,2,"view",{"focusable":true,"style":{"width":100,"height":100}}],[3,0,2]]"#,
    );
    tick(&mut e, 0.0);
    let back = e.tick(&pad(CIRCLE), 100.0);
    let b = events_of(&back, EventKind::Back);
    assert_eq!((b.len(), b[0].target), (1, 2));
    assert!(back.sounds.contains(&SoundCue::Back));
    e.tick(&pad(0), 120.0);
    let key = e.tick(&pad(TRIANGLE), 200.0);
    let k = events_of(&key, EventKind::Key);
    assert_eq!(k.len(), 1);
    assert_eq!(
        (
            k[0].target,
            k[0].payload.get_str("button"),
            k[0].payload.get_str("phase")
        ),
        (2, Some("triangle"), Some("down"))
    );
    let key_up = e.tick(&pad(0), 300.0);
    assert_eq!(
        events_of(&key_up, EventKind::Key)[0]
            .payload
            .get_str("phase"),
        Some("up")
    );
    // With nothing focused the root receives them.
    commit(&mut e, "[[5,0,2]]");
    tick(&mut e, 400.0);
    assert_eq!(e.focused(), None);
    let back = e.tick(&pad(CIRCLE), 500.0);
    assert_eq!(events_of(&back, EventKind::Back)[0].target, 0);
}

#[test]
fn direction_presses_also_emit_key_events_including_repeats() {
    let mut e = engine();
    commit(
        &mut e,
        r#"[[1,2,"view",{"focusable":true,"style":{"width":100,"height":100}}],[1,3,"view",{"focusable":true,"style":{"width":100,"height":100}}],[3,0,2],[3,0,3]]"#,
    );
    tick(&mut e, 0.0);
    let keys = |out: &FrameOutput| -> Vec<(NodeId, String, String)> {
        events_of(out, EventKind::Key)
            .iter()
            .map(|ev| {
                (
                    ev.target,
                    ev.payload.get_str("button").unwrap_or("").to_string(),
                    ev.payload.get_str("phase").unwrap_or("").to_string(),
                )
            })
            .collect()
    };
    // Down: the key event targets the node that had focus when it was pressed; focus then moves.
    let down = e.tick(&pad(DOWN), 100.0);
    assert_eq!(keys(&down), vec![(2, "down".into(), "down".into())]);
    assert_eq!(e.focused(), Some(3));
    // Held: nothing until the first repeat after 350 ms, then a key down per repeat.
    assert!(keys(&e.tick(&pad(DOWN), 300.0)).is_empty());
    let rep = e.tick(&pad(DOWN), 450.0);
    assert_eq!(keys(&rep), vec![(3, "down".into(), "down".into())]);
    let up = e.tick(&pad(0), 500.0);
    assert_eq!(keys(&up), vec![(3, "down".into(), "up".into())]);
}

#[test]
fn next_focus_pointing_at_itself_pins_focus_silently() {
    let mut e = engine();
    commit(
        &mut e,
        r#"[[1,2,"view",{"focusable":true,"nextFocusRight":2,"style":{"width":100,"height":100}}],[1,3,"view",{"focusable":true,"style":{"width":100,"height":100,"position":"absolute","left":300}}],[3,0,2],[3,0,3]]"#,
    );
    tick(&mut e, 0.0);
    let out = e.tick(&pad(RIGHT), 10.0);
    assert_eq!(e.focused(), Some(2));
    assert!(!out.sounds.contains(&SoundCue::Navigate));
    assert!(events_of(&out, EventKind::FocusBoundary).is_empty());
}

#[test]
fn auto_focus_takes_focus_on_any_commit_and_scopes_hand_it_to_a_descendant() {
    let mut e = engine();
    commit(
        &mut e,
        r#"[[1,2,"view",{"focusable":true,"style":{"width":100,"height":100}}],[3,0,2]]"#,
    );
    tick(&mut e, 0.0);
    assert_eq!(e.focused(), Some(2));
    // A later commit mounts an autoFocus node: it takes focus.
    commit(
        &mut e,
        r#"[[1,3,"view",{"focusable":true,"autoFocus":true,"style":{"width":100,"height":100}}],[3,0,3]]"#,
    );
    tick(&mut e, 10.0);
    assert_eq!(e.focused(), Some(3));
    // A dialog scope with autoFocus (no autoFocus child) focuses its first focusable descendant.
    commit(
        &mut e,
        r#"[[1,20,"view",{"focusScope":{"trap":true,"restore":true},"autoFocus":true,"style":{"position":"absolute","left":500,"width":300,"height":100,"flexDirection":"row"}}],
            [1,21,"view",{"focusable":true,"style":{"width":100,"height":100}}],[1,22,"view",{"focusable":true,"style":{"width":100,"height":100}}],
            [3,20,21],[3,20,22],[3,0,20]]"#,
    );
    tick(&mut e, 20.0);
    assert_eq!(e.focused(), Some(21));
    // ... unless an autoFocus node is inside it.
    commit(&mut e, "[[5,0,20]]");
    tick(&mut e, 30.0);
    assert_eq!(e.focused(), Some(3), "restored");
    commit(
        &mut e,
        r#"[[1,30,"view",{"focusScope":{"trap":true},"autoFocus":true,"style":{"position":"absolute","left":500,"width":300,"height":100,"flexDirection":"row"}}],
            [1,31,"view",{"focusable":true,"style":{"width":100,"height":100}}],[1,32,"view",{"focusable":true,"autoFocus":true,"style":{"width":100,"height":100}}],
            [3,30,31],[3,30,32],[3,0,30]]"#,
    );
    tick(&mut e, 40.0);
    assert_eq!(e.focused(), Some(32));
}

#[test]
fn intercepted_pad_suspends_input_without_stuck_buttons() {
    let mut e = engine();
    commit(
        &mut e,
        r#"[[1,2,"view",{"focusable":true,"events":60,"style":{"width":100,"height":100}}],[3,0,2]]"#,
    );
    tick(&mut e, 0.0);
    e.tick(&pad(CROSS), 100.0);
    assert!(e.tree.get(2).is_some_and(|n| n.state.pressed));
    let snap = PadSnapshot {
        intercepted: true,
        buttons: CROSS,
        connected: true,
        ..PadSnapshot::default()
    };
    let out = e.tick(&snap, 200.0);
    assert!(
        events_of(&out, EventKind::Press).is_empty(),
        "no press from an interrupted hold"
    );
    assert!(e.tree.get(2).is_some_and(|n| !n.state.pressed));
    // Still holding Cross when the system hands the pad back: ignored until released.
    let back = e.tick(&pad(CROSS), 300.0);
    assert!(events_of(&back, EventKind::PressIn).is_empty());
    let rel = e.tick(&pad(0), 400.0);
    assert!(rel.events.is_empty());
}

#[test]
fn layout_events_and_measure_replies() {
    let mut e = engine();
    commit(
        &mut e,
        r#"[[1,2,"view",{"events":512,"style":{"marginLeft":30,"marginTop":40,"width":200,"height":120}}],[3,0,2],[10,2,5]]"#,
    );
    let out = tick(&mut e, 0.0);
    let l = events_of(&out, EventKind::Layout);
    assert_eq!(l.len(), 1);
    assert_eq!(
        (l[0].payload.get_f64("x"), l[0].payload.get_f64("width")),
        (Some(30.0), Some(200.0))
    );
    assert_eq!(out.measures, vec![(5, Rect::new(30.0, 40.0, 200.0, 120.0))]);
    assert!(events_of(&tick(&mut e, 16.0), EventKind::Layout).is_empty());
}

#[test]
fn text_nodes_measure_and_wrap() {
    let mut e = engine();
    commit(
        &mut e,
        r#"[[1,2,"view",{"style":{"width":300}}],[1,3,"text",{}],[1,4,"rawtext",{}],[6,4,"Hello"],[3,3,4],[3,2,3],[3,0,2]]"#,
    );
    tick(&mut e, 0.0);
    let r = rect(&e, 3);
    assert_eq!(r.h, 30.0, "one line of 24px Inter at line height 30");
    assert!(r.w > 40.0 && r.w <= 300.0);
    // Longer text wraps within the 300 px parent.
    commit(
        &mut e,
        r#"[[6,4,"the quick brown fox jumps over the lazy dog and keeps running"]]"#,
    );
    tick(&mut e, 16.0);
    let r2 = rect(&e, 3);
    assert_eq!(r2.w, 300.0);
    assert!(r2.h >= 60.0, "{r2:?}");
    // numberOfLines truncates with an ellipsis.
    commit(&mut e, r#"[[2,3,{"numberOfLines":1}]]"#);
    tick(&mut e, 32.0);
    assert_eq!(rect(&e, 3).h, 30.0);
}

#[test]
fn text_style_comes_from_the_node_and_monospace_is_selectable() {
    let mut e = engine();
    commit(
        &mut e,
        r#"[[1,3,"text",{"style":{"fontFamily":"JetBrains Mono","fontSize":20,"fontWeight":"500"}}],[1,4,"rawtext",{}],[6,4,"iiii"],[3,3,4],[3,0,3],
            [1,5,"text",{"style":{"fontFamily":"JetBrains Mono","fontSize":20,"fontWeight":"500"}}],[1,6,"rawtext",{}],[6,6,"WWWW"],[3,5,6],[3,0,5]]"#,
    );
    tick(&mut e, 0.0);
    assert_eq!(rect(&e, 3).w, rect(&e, 5).w);
    assert_eq!(rect(&e, 3).h, 25.0);
}

#[test]
fn input_renders_value_placeholder_and_bullets_for_secure() {
    let mut e = engine();
    commit(
        &mut e,
        r#"[[1,2,"input",{"focusable":true,"placeholder":"Name","style":{"width":300,"height":60}}],[3,0,2]]"#,
    );
    tick(&mut e, 0.0);
    let mut f = frame();
    e.render(&mut f);
    let placeholder_pixels = lit_pixels(&f, Rect::new(0.0, 0.0, 300.0, 60.0));
    assert!(placeholder_pixels > 20, "placeholder is drawn");
    commit(&mut e, r#"[[2,2,{"value":"abc","secure":true}]]"#);
    tick(&mut e, 16.0);
    e.render(&mut f);
    let secure = e
        .tree
        .get(2)
        .map(crate::layout::input_display)
        .expect("input");
    assert_eq!(secure.0, "•••");
    assert!(lit_pixels(&f, Rect::new(0.0, 0.0, 300.0, 60.0)) > 20);
    // press on an input is an ordinary press (the keyboard is opened by JS)
    commit(&mut e, r#"[[2,2,{"events":4}]]"#);
    tick(&mut e, 32.0);
    e.tick(&pad(CROSS), 100.0);
    let up = e.tick(&pad(0), 150.0);
    assert_eq!(events_of(&up, EventKind::Press).len(), 1);
}

/// Pixels brighter than the root background inside `r`.
fn lit_pixels(f: &[u32], r: Rect) -> usize {
    let mut n = 0;
    for y in r.y as usize..r.bottom() as usize {
        for x in r.x as usize..r.right() as usize {
            let p = f[y * 1920 + x];
            if (p & 0xff) > 0x40 {
                n += 1;
            }
        }
    }
    n
}

#[test]
fn icon_draws_scaled_paths_in_the_color_prop() {
    let mut e = engine();
    commit(
        &mut e,
        r##"[[1,2,"icon",{"viewBox":[24,24],"size":48,"color":"#00ff00","paths":[{"d":"M0 0h24v24H0z","fill":"currentColor"}]}],[3,0,2]]"##,
    );
    tick(&mut e, 0.0);
    let mut f = frame();
    e.render(&mut f);
    assert_eq!(rect(&e, 2), Rect::new(0.0, 0.0, 48.0, 48.0));
    assert_eq!(f[24 * 1920 + 24], 0xff00_ff00, "scaled 2x, solid green");
    assert_eq!(f[60 * 1920 + 60], 0xff17_0f0b);
}

#[test]
fn images_queue_requests_and_draw_after_load() {
    let mut e = engine();
    commit(
        &mut e,
        r#"[[1,2,"image",{"src":"/logo.png","events":12288,"style":{"width":64,"height":64}}],[3,0,2]]"#,
    );
    tick(&mut e, 0.0);
    assert_eq!(e.take_image_requests(), vec!["/logo.png".to_string()]);
    assert!(e.take_image_requests().is_empty(), "requested once");
    let rgba: Vec<u8> = (0..8 * 8).flat_map(|_| [255u8, 0, 0, 255]).collect();
    e.image_loaded(
        "/logo.png",
        Ok(DecodedImage {
            width: 8,
            height: 8,
            rgba,
        }),
    );
    let out = tick(&mut e, 16.0);
    assert_eq!(events_of(&out, EventKind::Load).len(), 1);
    let mut f = frame();
    e.render(&mut f);
    assert_eq!(f[32 * 1920 + 32], 0xff00_00ff);
    // failure reports an error event
    commit(
        &mut e,
        r#"[[1,3,"image",{"src":"/bad.png","events":8192,"style":{"width":8,"height":8}}],[3,0,3]]"#,
    );
    tick(&mut e, 32.0);
    e.image_loaded("/bad.png", Err("decode failed".into()));
    let out = tick(&mut e, 48.0);
    assert_eq!(events_of(&out, EventKind::Error).len(), 1);
}

#[test]
fn image_cache_evicts_least_recently_used_over_budget() {
    let mut store = crate::images::ImageStore::new();
    store.set_budget(3 * 64 * 64 * 4);
    for i in 0..5 {
        let uri = format!("/{i}.png");
        store.request(&uri);
        store
            .loaded(
                &uri,
                Ok(DecodedImage {
                    width: 64,
                    height: 64,
                    rgba: vec![255; 64 * 64 * 4],
                }),
            )
            .expect("loads");
    }
    assert!(store.resident_bytes() <= 3 * 64 * 64 * 4);
    assert!(store.size("/4.png").is_some(), "newest survives");
    assert!(store.size("/0.png").is_none(), "oldest is evicted");
}

#[test]
fn overlays_draw_and_clear() {
    let mut e = engine();
    tick(&mut e, 0.0);
    let mut f = frame();
    e.render(&mut f);
    e.set_error_overlay(Some("TypeError: boom is not a function".into()));
    let out = tick(&mut e, 16.0);
    assert!(out.needs_render);
    e.render(&mut f);
    assert_eq!(
        f[4 * 1920 + 4],
        0xff0d_0d3a,
        "error panel background #3a0d0d (bytes R,G,B,A)"
    );
    e.set_error_overlay(None);
    tick(&mut e, 32.0);
    e.render(&mut f);
    assert_eq!(f[4 * 1920 + 4], 0xff17_0f0b);
    // toast expires by itself
    e.toast("Saved", 500.0);
    assert!(tick(&mut e, 40.0).needs_render);
    e.render(&mut f);
    assert!(tick(&mut e, 600.0).needs_render, "expiry repaints");
    e.render(&mut f);
    assert!(!tick(&mut e, 700.0).needs_render);
    e.set_stats_overlay(Some(crate::FrameStats {
        frame_ms: 3.2,
        raster_ms: 1.1,
        dirty_tiles: 4,
        js_commit_ms: 0.4,
    }));
    assert!(tick(&mut e, 716.0).needs_render);
    e.set_ime_overlay(Some(crate::ImeOverlay {
        title: "Name".into(),
        text: "ab".into(),
        placeholder: String::new(),
        secure: false,
    }));
    assert!(tick(&mut e, 732.0).needs_render);
    e.set_ime_overlay(None);
    e.set_stats_overlay(None);
    tick(&mut e, 748.0);
    e.render(&mut f);
    assert_eq!(f[500 * 1920 + 900], 0xff17_0f0b, "overlays gone");
}

#[test]
fn smoke_commit_json_ticks_renders_then_goes_idle() {
    let mut e = engine();
    let json = r##"[[1,2,"view",{"style":{"padding":24,"gap":12,"backgroundColor":"#1d2433","borderRadius":16,"width":600}}],
        [1,3,"text",{"style":{"fontSize":32,"fontWeight":"700"}}],[1,4,"rawtext",null],[6,4,"ProsperoKit"],[3,3,4],
        [1,5,"view",{"focusable":true,"events":4,"style":{"height":64,"backgroundColor":"#3b82f6","borderRadius":12},"styleFocus":{"outlineWidth":4,"outlineColor":"#ffffff","outlineOffset":4}}],
        [3,2,3],[3,2,5],[3,0,2]]"##;
    commit(&mut e, json);
    let out = tick(&mut e, 0.0);
    assert!(out.needs_render);
    let mut f = frame();
    let tiles = e.render(&mut f);
    assert!(!tiles.is_empty());
    assert_eq!(e.focused(), Some(5));
    let idle = tick(&mut e, 16.0);
    assert!(!idle.needs_render);
    assert!(e.render(&mut f).is_empty());
}

#[test]
fn reset_clears_the_tree_and_repaints() {
    let mut e = engine();
    commit(
        &mut e,
        r#"[[1,2,"view",{"focusable":true,"style":{"width":100,"height":100}}],[3,0,2]]"#,
    );
    tick(&mut e, 0.0);
    assert_eq!(e.focused(), Some(2));
    e.reset();
    let out = tick(&mut e, 16.0);
    assert!(out.needs_render);
    assert_eq!(e.focused(), None);
    assert!(e.tree.get(2).is_none());
    assert!(e.tree.get(0).is_some() && e.tree.get(1).is_some());
}

#[test]
fn overflow_hidden_clips_children_and_opacity_groups_composite() {
    let mut e = engine();
    commit(
        &mut e,
        r##"[[1,2,"view",{"style":{"position":"absolute","left":100,"top":100,"width":100,"height":100,"overflow":"hidden","backgroundColor":"#000000"}}],
            [1,3,"view",{"style":{"position":"absolute","left":50,"top":50,"width":200,"height":200,"backgroundColor":"#ff0000"}}],[3,2,3],[3,0,2],
            [1,4,"view",{"style":{"position":"absolute","left":400,"top":100,"width":100,"height":100,"opacity":0.5,"backgroundColor":"#0000ff"}}],
            [1,5,"view",{"style":{"width":100,"height":100,"backgroundColor":"#ff0000"}}],[3,4,5],[3,0,4]]"##,
    );
    tick(&mut e, 0.0);
    let mut f = frame();
    e.render(&mut f);
    assert_eq!(f[175 * 1920 + 175], 0xff00_00ff, "inside the clip");
    assert_eq!(f[220 * 1920 + 220], 0xff17_0f0b, "outside the clip");
    // The group: red child covers the blue parent, then the pair is composited at 50 %.
    let p = f[150 * 1920 + 450];
    let (r, g, b) = (p & 0xff, (p >> 8) & 0xff, (p >> 16) & 0xff);
    assert!(
        (r as i32 - (0xff / 2 + 0x0b / 2)).abs() <= 3 && b < 0x20 && g < 0x20,
        "{r:x} {g:x} {b:x}"
    );
    let _ = Overflow::Hidden;
}

#[test]
fn full_screen_render_and_focus_move_timings_are_reasonable() {
    // Correctness smoke for a busy screen (timings are reported by the release-mode bench in the report).
    let mut e = engine();
    let mut ops = vec![r#"[1,2,"view",{"style":{"flexDirection":"row","flexWrap":"wrap","gap":16,"width":1920,"padding":24}}]"#.to_string()];
    for i in 0..60u32 {
        ops.push(format!(
            r##"[1,{id},"view",{{"focusable":true,"style":{{"width":280,"height":180,"borderRadius":24,"backgroundColor":"#1d2433","shadowColor":"#000000","shadowOpacity":0.5,"shadowRadius":16,"shadowOffset":{{"width":0,"height":8}}}},"styleFocus":{{"outlineWidth":4,"outlineColor":"#ffffff","outlineOffset":4}}}}]"##,
            id = 100 + i * 3
        ));
        ops.push(format!(r#"[1,{},"text",{{}}]"#, 101 + i * 3));
        ops.push(format!(r#"[1,{},"rawtext",{{}}]"#, 102 + i * 3));
        ops.push(format!(r#"[6,{},"Card number {}"]"#, 102 + i * 3, i));
        ops.push(format!("[3,{},{}]", 101 + i * 3, 102 + i * 3));
        ops.push(format!("[3,{},{}]", 100 + i * 3, 101 + i * 3));
        ops.push(format!("[3,2,{}]", 100 + i * 3));
    }
    ops.push("[3,0,2]".into());
    commit(&mut e, &format!("[{}]", ops.join(",")));
    tick(&mut e, 0.0);
    let mut f = frame();
    let t = e.render(&mut f);
    assert_eq!(t.count(), TileSet::COUNT);
    e.tick(&pad(RIGHT), 50.0);
    e.tick(&pad(0), 60.0);
    let moved = e.render(&mut f);
    assert!(
        moved.count() > 0 && moved.count() < TileSet::COUNT / 2,
        "focus move repaints only nearby tiles: {}",
        moved.count()
    );
}

const GOLDEN_W: usize = 480;
const GOLDEN_H: usize = 300;

fn crop(f: &[u32], w: usize, h: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(w * h * 4);
    for y in 0..h {
        for x in 0..w {
            out.extend_from_slice(&f[y * 1920 + x].to_ne_bytes());
        }
    }
    out
}

fn golden_path(name: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/golden")
        .join(name)
}

/// Compare against `tests/golden/<name>` (written when `UPDATE_GOLDEN=1`): at most 1 % of pixels may differ.
fn assert_golden(name: &str, rgba: &[u8], w: usize, h: usize) {
    let path = golden_path(name);
    if std::env::var_os("UPDATE_GOLDEN").is_some() || !path.exists() {
        assert!(
            std::env::var_os("UPDATE_GOLDEN").is_some(),
            "missing golden {path:?}: regenerate with UPDATE_GOLDEN=1"
        );
        let file = std::fs::File::create(&path).expect("create golden");
        let mut enc = png::Encoder::new(std::io::BufWriter::new(file), w as u32, h as u32);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().expect("png header");
        writer.write_image_data(rgba).expect("png data");
        return;
    }
    let decoder = png::Decoder::new(std::io::BufReader::new(
        std::fs::File::open(&path).expect("open golden"),
    ));
    let mut reader = decoder.read_info().expect("png info");
    let mut buf = vec![0u8; reader.output_buffer_size().expect("png size")];
    let info = reader.next_frame(&mut buf).expect("png frame");
    assert_eq!(
        (info.width as usize, info.height as usize, info.color_type),
        (w, h, png::ColorType::Rgba),
        "golden dimensions"
    );
    let differing = rgba
        .chunks_exact(4)
        .zip(buf.chunks_exact(4))
        .filter(|(a, b)| a.iter().zip(b.iter()).any(|(x, y)| x.abs_diff(*y) > 8))
        .count();
    let allowed = w * h / 100;
    assert!(
        differing <= allowed,
        "{differing} of {} pixels differ from {path:?} (allowed {allowed})",
        w * h
    );
}

#[test]
fn golden_card_with_rounded_border_text_and_focus_ring() {
    let mut e = engine();
    commit(
        &mut e,
        r##"[[1,2,"view",{"focusable":true,"style":{"position":"absolute","left":40,"top":40,"width":400,"height":200,"padding":24,"gap":12,
                "backgroundColor":"#1d2433","borderRadius":24,"borderWidth":2,"borderColor":"#3b82f6",
                "shadowColor":"#000000","shadowOpacity":0.6,"shadowRadius":20,"shadowOffset":{"width":0,"height":10}},
              "styleFocus":{"outlineWidth":4,"outlineColor":"#ffffff","outlineOffset":4}}],
            [1,3,"text",{"style":{"fontSize":32,"fontWeight":"700","color":"#ffffff"}}],[1,4,"rawtext",{}],[6,4,"Card title"],[3,3,4],
            [1,5,"text",{"style":{"fontSize":20,"color":"#9ca3af"}}],[1,6,"rawtext",{}],[6,6,"Rounded border, shadow and focus ring"],[3,5,6],
            [1,7,"view",{"style":{"height":16,"borderRadius":8,"backgroundGradient":{"angle":90,"stops":[[0,"#3b82f6"],[1,"#22d3ee"]]}}}],
            [3,2,3],[3,2,5],[3,2,7],[3,0,2]]"##,
    );
    tick(&mut e, 0.0);
    assert_eq!(e.focused(), Some(2));
    tick(&mut e, 16.0);
    let mut f = frame();
    e.render(&mut f);
    assert_golden(
        "card.png",
        &crop(&f, GOLDEN_W, GOLDEN_H),
        GOLDEN_W,
        GOLDEN_H,
    );
}

/// Release-mode timings of the plan's performance targets:
/// `cargo test -p pk-engine --release -- --ignored --nocapture timings`.
#[test]
#[ignore = "timing report; run in release mode"]
fn timings() {
    use std::time::Instant;
    let mut e = engine();
    // A full-screen scrolling grid of cards: shadow, rounded border, gradient, two text lines each.
    let mut ops = vec![r#"[1,2,"scroll",{"events":256,"style":{"width":1920,"height":1080}}]"#.to_string(), r#"[1,3,"view",{"style":{"flexDirection":"row","flexWrap":"wrap","gap":24,"padding":48,"width":1920}}]"#.to_string()];
    for i in 0..60u32 {
        let id = 100 + i * 6;
        ops.push(format!(
            r##"[1,{id},"view",{{"focusable":true,"style":{{"width":400,"height":260,"padding":20,"gap":8,"borderRadius":24,"borderWidth":2,"borderColor":"#33415588","backgroundColor":"#1d2433","shadowColor":"#000000","shadowOpacity":0.5,"shadowRadius":16,"shadowOffset":{{"width":0,"height":8}}}},"styleFocus":{{"outlineWidth":4,"outlineColor":"#ffffff","outlineOffset":4}}}}]"##,
        ));
        ops.push(format!(
            r#"[1,{},"text",{{"style":{{"fontSize":28,"fontWeight":"700"}}}}]"#,
            id + 1
        ));
        ops.push(format!(r#"[1,{},"rawtext",{{}}]"#, id + 2));
        ops.push(format!(r#"[6,{},"Card number {}"]"#, id + 2, i));
        ops.push(format!(
            r##"[1,{},"text",{{"numberOfLines":3,"style":{{"fontSize":20,"color":"#9ca3af"}}}}]"##,
            id + 3
        ));
        ops.push(format!(r#"[1,{},"rawtext",{{}}]"#, id + 4));
        ops.push(format!(r#"[6,{},"The quick brown fox jumps over the lazy dog, again and again until the line wraps twice or more."]"#, id + 4));
        ops.push(format!("[3,{},{}]", id + 1, id + 2));
        ops.push(format!("[3,{},{}]", id + 3, id + 4));
        ops.push(format!("[3,{id},{}]", id + 1));
        ops.push(format!("[3,{id},{}]", id + 3));
        ops.push(format!("[3,3,{id}]"));
    }
    ops.push("[3,2,3],[3,0,2]".into());
    commit(&mut e, &format!("[{}]", ops.join(",")));
    let mut f = frame();
    let t0 = Instant::now();
    tick(&mut e, 0.0);
    let t_layout = t0.elapsed();
    let t1 = Instant::now();
    let tiles = e.render(&mut f);
    let t_full = t1.elapsed();
    println!(
        "first frame: layout+scene {t_layout:?}, full-screen render {t_full:?} ({} tiles)",
        tiles.count()
    );
    // Full-screen scroll: every tile changes each frame.
    let mut worst = std::time::Duration::ZERO;
    let mut total = std::time::Duration::ZERO;
    for i in 1..=30 {
        commit(&mut e, &format!("[[7,2,0,{},false]]", i * 37));
        let t = Instant::now();
        e.tick(&pad(0), i as f64 * 16.0);
        let tiles = e.render(&mut f);
        let d = t.elapsed();
        worst = worst.max(d);
        total += d;
        assert!(tiles.count() > 100);
    }
    println!(
        "full-screen scroll frame (tick+render): avg {:?}, worst {worst:?}",
        total / 30
    );
    e.rasterizer.set_parallel(false);
    let mut serial = std::time::Duration::ZERO;
    for i in 31..=60 {
        commit(&mut e, &format!("[[7,2,0,{},false]]", i * 37 % 1400));
        let t = Instant::now();
        e.tick(&pad(0), i as f64 * 16.0);
        e.render(&mut f);
        serial += t.elapsed();
    }
    println!(
        "full-screen scroll frame, single-threaded raster: avg {:?}",
        serial / 30
    );
    e.rasterizer.set_parallel(true);
    // Focus move between two neighbouring cards.
    commit(&mut e, "[[7,2,0,0,false]]");
    tick(&mut e, 2000.0);
    e.render(&mut f);
    let mut worst = std::time::Duration::ZERO;
    let mut total = std::time::Duration::ZERO;
    let mut t_now = 3000.0;
    for i in 0..4 {
        let snap = pad(if i % 2 == 0 { RIGHT } else { 0x0080 });
        let t = Instant::now();
        e.tick(&snap, t_now);
        let tiles = e.render(&mut f);
        let d = t.elapsed();
        e.tick(&pad(0), t_now + 30.0);
        e.render(&mut f);
        t_now += 500.0;
        println!("focus move {i}: {d:?} ({} tiles)", tiles.count());
        worst = worst.max(d);
        total += d;
    }
    println!("focus move avg {:?}, worst {worst:?}", total / 4);
}

#[test]
fn parallel_raster_matches_the_single_threaded_output() {
    let build = || {
        let mut e = engine();
        let mut ops = vec![r##"[1,2,"view",{"style":{"flexDirection":"row","flexWrap":"wrap","gap":16,"width":1920,"padding":24}}]"##.to_string()];
        for i in 0..40u32 {
            let id = 100 + i * 3;
            ops.push(format!(
                r##"[1,{id},"view",{{"style":{{"width":280,"height":180,"borderRadius":24,"backgroundColor":"#1d2433","opacity":0.9,"shadowColor":"#000000","shadowOpacity":0.5,"shadowRadius":16,"shadowOffset":{{"width":0,"height":8}}}}}}]"##
            ));
            ops.push(format!(r#"[1,{},"text",{{}}]"#, id + 1));
            ops.push(format!(r#"[1,{},"rawtext",{{}}]"#, id + 2));
            ops.push(format!(r#"[6,{},"Card {}"]"#, id + 2, i));
            ops.push(format!("[3,{},{}]", id + 1, id + 2));
            ops.push(format!("[3,{id},{}]", id + 1));
            ops.push(format!("[3,2,{id}]"));
        }
        ops.push("[3,0,2]".into());
        commit(&mut e, &format!("[{}]", ops.join(",")));
        tick(&mut e, 0.0);
        e
    };
    let (mut a, mut b) = (build(), build());
    a.rasterizer.set_parallel(true);
    b.rasterizer.set_parallel(false);
    let (mut fa, mut fb) = (frame(), frame());
    assert_eq!(a.render(&mut fa), b.render(&mut fb));
    assert!(
        fa == fb,
        "threaded and serial raster must be pixel-identical"
    );
}

/// Pixels that are clearly the span's red (R high, G and B low).
fn red_pixels(f: &[u32]) -> usize {
    f.iter()
        .filter(|px| {
            let (r, g, b) = (**px & 0xff, (**px >> 8) & 0xff, (**px >> 16) & 0xff);
            r > 180 && g < 90 && b < 90
        })
        .count()
}

/// A white run with a red nested span, optionally inside a scaled view (the
/// focused-card case: a uniform scale re-rasterises the text).
fn nested_span_frame(transform: &str) -> Vec<u32> {
    let mut e = engine();
    commit(
        &mut e,
        &format!(
            r##"[[1,2,"view",{{"style":{{"padding":40{transform}}}}}],
            [1,3,"text",{{"style":{{"color":"#ffffff","fontSize":40}}}}],
            [1,4,"rawtext",null],[6,4,"plain "],
            [1,5,"text",{{"style":{{"color":"#ff0000"}}}}],
            [1,6,"rawtext",null],[6,6,"RED SPAN"],
            [3,5,6],[3,3,4],[3,3,5],[3,2,3],[3,0,2]]"##
        ),
    );
    tick(&mut e, 0.0);
    let mut f = frame();
    e.render(&mut f);
    f
}

#[test]
fn nested_span_colours_survive_a_uniform_scale() {
    let plain = red_pixels(&nested_span_frame(""));
    let scaled = red_pixels(&nested_span_frame(r#","transform":[{"scale":1.08}]"#));
    assert!(plain > 100, "the unscaled span renders red ({plain} px)");
    assert!(scaled > 100, "the scaled span keeps its red ({scaled} px)");
}

/// Taffy hoists absolutely positioned boxes into their containing block's
/// `hoisted_children`, and removing a node does not clean those lists. Closing
/// a Select (an absolute panel in the overlay) used to crash the next layout.
#[test]
fn removing_an_absolute_subtree_from_the_overlay_keeps_layout_alive() {
    let mut e = engine();
    commit(
        &mut e,
        r#"[[1,2,"view",{"style":{"width":400,"height":200}}],[3,0,2],
            [1,10,"view",{"style":{"position":"absolute","top":40,"left":40,"width":300,"height":200}}],
            [1,11,"view",{"style":{"position":"absolute","top":4,"left":4,"width":20,"height":20}}],
            [3,10,11],[3,1,10]]"#,
    );
    tick(&mut e, 0.0);
    let mut f = frame();
    e.render(&mut f);
    // Close the panel and change something else in the same commit.
    commit(&mut e, r#"[[5,1,10],[2,2,{"style":{"width":420}}]]"#);
    tick(&mut e, 16.0);
    e.render(&mut f);
    assert_eq!(rect(&e, 2).w, 420.0);
    // Re-open a new panel afterwards: the overlay still lays out.
    commit(
        &mut e,
        r#"[[1,20,"view",{"style":{"position":"absolute","top":10,"left":10,"width":50,"height":50}}],[3,1,20]]"#,
    );
    tick(&mut e, 32.0);
    e.render(&mut f);
    assert_eq!(rect(&e, 20).w, 50.0);
}
