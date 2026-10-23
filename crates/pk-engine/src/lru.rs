//! A tiny byte-budgeted LRU map used by the glyph, measure, shadow and image
//! caches. Recency is a monotonically increasing stamp; eviction sorts by stamp
//! (it only runs when a budget is exceeded, never on the hot lookup path).

use crate::hash::FxMap;
use std::hash::Hash;

struct Entry<V> {
    value: V,
    stamp: u64,
    cost: usize,
}

pub struct Lru<K, V> {
    map: FxMap<K, Entry<V>>,
    clock: u64,
    total: usize,
}

impl<K: Hash + Eq + Clone, V> Default for Lru<K, V> {
    fn default() -> Self {
        Lru {
            map: FxMap::default(),
            clock: 0,
            total: 0,
        }
    }
}

impl<K: Hash + Eq + Clone, V> Lru<K, V> {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }

    pub fn total_cost(&self) -> usize {
        self.total
    }

    pub fn get(&mut self, key: &K) -> Option<&V> {
        self.clock += 1;
        let clock = self.clock;
        self.map.get_mut(key).map(|e| {
            e.stamp = clock;
            &e.value
        })
    }

    pub fn peek(&self, key: &K) -> Option<&V> {
        self.map.get(key).map(|e| &e.value)
    }

    pub fn contains(&self, key: &K) -> bool {
        self.map.contains_key(key)
    }

    pub fn insert(&mut self, key: K, value: V, cost: usize) {
        self.clock += 1;
        if let Some(old) = self.map.insert(
            key,
            Entry {
                value,
                stamp: self.clock,
                cost,
            },
        ) {
            self.total -= old.cost;
        }
        self.total += cost;
    }

    pub fn remove(&mut self, key: &K) -> Option<V> {
        let e = self.map.remove(key)?;
        self.total -= e.cost;
        Some(e.value)
    }

    pub fn clear(&mut self) {
        self.map.clear();
        self.total = 0;
    }

    /// Evict least-recently-used entries until `total_cost() <= budget` and
    /// `len() <= max_entries`. The most recently touched entry is never evicted.
    pub fn trim(&mut self, budget: usize, max_entries: usize) {
        if self.total <= budget && self.map.len() <= max_entries {
            return;
        }
        let mut order: Vec<(u64, K)> = self.map.iter().map(|(k, e)| (e.stamp, k.clone())).collect();
        order.sort_unstable_by_key(|(s, _)| *s);
        // Evict down to 3/4 of the limits so the sort is amortised.
        let target_cost = budget / 4 * 3;
        let target_len = max_entries / 4 * 3;
        let keep_last = order.len().saturating_sub(1);
        for (_, key) in order.into_iter().take(keep_last) {
            if self.total <= target_cost && self.map.len() <= target_len.max(1) {
                break;
            }
            self.remove(&key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evicts_oldest_first() {
        let mut l: Lru<u32, u32> = Lru::new();
        for i in 0..8 {
            l.insert(i, i, 10);
        }
        l.get(&0);
        l.trim(40, 100);
        assert!(l.contains(&0));
        assert!(!l.contains(&1));
        assert!(l.total_cost() <= 30);
    }
}
