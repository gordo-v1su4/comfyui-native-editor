#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DragMode { Move, TrimStart, TrimEnd }

#[derive(Clone, Copy, Debug)]
pub struct DragState {
    pub track: usize,
    pub item: usize,
    pub mode: DragMode,
    pub start_mouse_x: f32,
    pub orig_from: i64,
    pub orig_dur: i64,
}

