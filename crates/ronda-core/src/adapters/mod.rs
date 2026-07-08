pub mod group_a;
pub mod group_b;
pub mod group_c;

use crate::AgentAdapter;

pub fn all() -> Vec<Box<dyn AgentAdapter>> {
    let mut adapters = group_a::adapters();
    adapters.extend(group_b::adapters());
    adapters.extend(group_c::adapters());
    adapters
}
