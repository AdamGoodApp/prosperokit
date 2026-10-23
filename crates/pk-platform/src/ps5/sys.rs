//! Hand-declared `extern "C"` surface of the PS5 system libraries.
//!
//! Every function here is exported by a stub in `$PS5_PAYLOAD_SDK/target/lib`
//! (checked with `llvm-nm -D`); the signatures follow the plan's "Verified
//! platform facts" (the starter's `screen.cpp`, `pad.cpp`, `keyboard.cpp`,
//! `sound.cpp`) and, for libSceHttp/libSceNet/libSceSsl and the pad
//! light-bar/vibration calls, the PS4 headers (unverified on hardware).
//!
//! No bindgen: the SDK headers are FreeBSD 11 C headers and a hand-written list
//! keeps the used surface explicit.

#![allow(non_snake_case, dead_code)]

use std::ffi::{c_char, c_int, c_void};

pub use super::layout::Stat;

// ── Kernel (libkernel) ──

/// FreeBSD open flags used by the backend.
pub const O_RDONLY: c_int = 0x0000;
pub const O_WRONLY: c_int = 0x0001;
pub const O_APPEND: c_int = 0x0008;
pub const O_CREAT: c_int = 0x0200;
pub const O_TRUNC: c_int = 0x0400;

pub const SEEK_SET: c_int = 0;
pub const SEEK_END: c_int = 2;

pub const MEMORY_TYPE_WC_GARLIC: c_int = 3;
pub const MAP_PROT_CPU_RW_GPU_RW: c_int = 0x33;

unsafe extern "C" {
    pub fn sceKernelOpen(path: *const c_char, flags: c_int, mode: u32) -> c_int;
    pub fn sceKernelRead(fd: c_int, buf: *mut c_void, nbytes: usize) -> isize;
    pub fn sceKernelWrite(fd: c_int, buf: *const c_void, nbytes: usize) -> isize;
    pub fn sceKernelClose(fd: c_int) -> c_int;
    pub fn sceKernelLseek(fd: c_int, offset: i64, whence: c_int) -> i64;
    pub fn sceKernelStat(path: *const c_char, out: *mut Stat) -> c_int;
    pub fn sceKernelFstat(fd: c_int, out: *mut Stat) -> c_int;
    pub fn sceKernelMkdir(path: *const c_char, mode: u32) -> c_int;
    pub fn sceKernelUnlink(path: *const c_char) -> c_int;
    pub fn sceKernelRmdir(path: *const c_char) -> c_int;
    pub fn sceKernelRename(from: *const c_char, to: *const c_char) -> c_int;
    pub fn sceKernelGetdents(fd: c_int, buf: *mut c_char, nbytes: c_int) -> c_int;
    pub fn sceKernelUsleep(microseconds: u32) -> c_int;
    pub fn sceKernelSendNotificationRequest(
        device: u32,
        request: *mut c_void,
        size: usize,
        blocking: c_int,
    ) -> c_int;
    pub fn sceKernelGetDirectMemorySize() -> usize;
    pub fn sceKernelAllocateDirectMemory(
        search_start: i64,
        search_end: i64,
        length: usize,
        alignment: usize,
        memory_type: c_int,
        physical_address: *mut i64,
    ) -> c_int;
    pub fn sceKernelMapDirectMemory(
        address: *mut *mut c_void,
        length: usize,
        protection: c_int,
        flags: c_int,
        physical_address: i64,
        alignment: usize,
    ) -> c_int;
}

/// The notification request (`reserved[45]` + message).
#[repr(C)]
pub struct NotificationRequest {
    pub reserved: [u8; 45],
    pub message: [u8; 3075],
}

// ── VideoOut ──

#[repr(C)]
#[derive(Clone, Copy)]
pub struct VideoBuffer {
    pub data: *mut c_void,
    pub metadata: *mut c_void,
    pub reserved0: *mut c_void,
    pub reserved1: *mut c_void,
}

#[repr(C)]
pub struct VideoAttribute {
    pub reserved: [u8; 80],
}

pub const PIXEL_FORMAT_RGBA8_SRGB: u64 = 0x8000_0000_2200_0000;

unsafe extern "C" {
    pub fn sceVideoOutOpen(user_id: i32, bus_type: i32, index: i32, param: *const c_void) -> i32;
    pub fn sceVideoOutSetFlipRate(handle: i32, rate: i32) -> i32;
    pub fn sceVideoOutSetBufferAttribute2(
        attribute: *mut VideoAttribute,
        pixel_format: u64,
        tiling_mode: u32,
        width: u32,
        height: u32,
        option: u64,
        dcc_control: u32,
        dcc_clear_color: u64,
    );
    pub fn sceVideoOutRegisterBuffers2(
        handle: i32,
        set_index: i32,
        buffer_index_start: i32,
        buffers: *const VideoBuffer,
        buffer_count: i32,
        attribute: *const VideoAttribute,
        category: i32,
        option: *mut c_void,
    ) -> i32;
    pub fn sceVideoOutSubmitFlip(
        handle: i32,
        buffer_index: i32,
        flip_mode: u32,
        flip_argument: i64,
    ) -> i32;
    pub fn sceVideoOutWaitVblank(handle: i32) -> i32;
}

// ── Pad / UserService ──

/// One `ScePadData` sample is 120 bytes.
pub const PAD_SAMPLE_SIZE: usize = 120;

#[repr(C)]
pub struct PadLightBar {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub reserved: u8,
}

#[repr(C)]
pub struct PadVibration {
    pub large_motor: u8,
    pub small_motor: u8,
}

unsafe extern "C" {
    pub fn sceUserServiceInitialize(params: *const c_void) -> i32;
    pub fn sceUserServiceGetInitialUser(user_id: *mut i32) -> i32;
    pub fn sceUserServiceGetForegroundUser(user_id: *mut i32) -> i32;
    pub fn scePadInit() -> i32;
    pub fn scePadOpen(user_id: i32, pad_type: i32, index: i32, param: *const c_void) -> i32;
    pub fn scePadGetHandle(user_id: i32, pad_type: i32, index: i32) -> i32;
    pub fn scePadRead(handle: i32, data: *mut c_void, count: i32) -> i32;
    pub fn scePadGetControllerInformation(handle: i32, info: *mut c_void) -> i32;
    pub fn scePadSetLightBar(handle: i32, param: *const PadLightBar) -> i32;
    pub fn scePadSetVibration(handle: i32, param: *const PadVibration) -> i32;
}

// ── IME dialog / CommonDialog / Sysmodule ──

/// What `sceImeDialogInit` takes; the layout must match the system's to the byte.
#[repr(C)]
pub struct ImeParam {
    pub user_id: i32,
    pub kind: i32,
    pub supported_languages: u64,
    pub enter_label: i32,
    pub input_method: i32,
    pub filter: *mut c_void,
    pub option: u32,
    pub max_text_length: u32,
    pub input_text_buffer: *mut u16,
    pub pos_x: f32,
    pub pos_y: f32,
    pub horizontal_alignment: i32,
    pub vertical_alignment: i32,
    pub placeholder: *const u16,
    pub title: *const u16,
    pub reserved: [i8; 16],
}

#[repr(C)]
#[derive(Default)]
pub struct ImeResult {
    pub outcome: i32,
    pub reserved: [i8; 12],
}

const _: () = assert!(size_of::<ImeParam>() == 96);
const _: () = assert!(std::mem::offset_of!(ImeParam, input_text_buffer) == 40);
const _: () = assert!(std::mem::offset_of!(ImeParam, title) == 72);
const _: () = assert!(size_of::<ImeResult>() == 16);

pub const SYSMODULE_IME_DIALOG: u16 = 0x0096;
pub const IME_ALREADY_INITIALIZED: u32 = 0x80b8_0002;
pub const IME_STATUS_RUNNING: i32 = 1;
pub const IME_STATUS_FINISHED: i32 = 2;

unsafe extern "C" {
    /// Not exported by an SDK stub: the app links a one-function stub library
    /// (`libSceCommonDialog.so`) so the loader binds the real one.
    pub fn sceCommonDialogInitialize() -> i32;
    pub fn sceSysmoduleLoadModule(id: u16) -> i32;
    pub fn sceImeDialogInit(param: *const ImeParam, extended: *const c_void) -> i32;
    pub fn sceImeDialogGetStatus() -> i32;
    pub fn sceImeDialogGetResult(result: *mut ImeResult) -> i32;
    pub fn sceImeDialogTerm() -> i32;
}

// ── AudioOut ──

pub const AUDIO_ALREADY_INITIALIZED: u32 = 0x8026_000e;

unsafe extern "C" {
    pub fn sceAudioOutInit() -> i32;
    pub fn sceAudioOutOpen(
        user_id: i32,
        port_type: i32,
        index: i32,
        grain: u32,
        rate: u32,
        format: u32,
    ) -> i32;
    pub fn sceAudioOutOutput(handle: i32, samples: *const c_void) -> i32;
}

// ── System service ──

unsafe extern "C" {
    pub fn sceSystemServiceHideSplashScreen() -> i32;
    pub fn sceSystemServiceLoadExec(path: *const c_char, argv: *const *const c_char) -> i32;
}

// ── Net / Ssl / Http (PS4 signatures) ──

unsafe extern "C" {
    pub fn sceNetInit() -> i32;
    pub fn sceNetPoolCreate(name: *const c_char, size: c_int, flags: c_int) -> i32;
    pub fn sceSslInit(pool_size: usize) -> i32;
    pub fn sceHttpInit(net_mem_id: i32, ssl_ctx_id: i32, pool_size: usize) -> i32;
    pub fn sceHttpCreateTemplate(
        http_ctx: i32,
        user_agent: *const c_char,
        http_version: i32,
        auto_proxy: i32,
    ) -> i32;
    pub fn sceHttpCreateConnectionWithURL(
        template: i32,
        url: *const c_char,
        keep_alive: i32,
    ) -> i32;
    pub fn sceHttpCreateRequestWithURL(
        connection: i32,
        method: i32,
        url: *const c_char,
        content_length: u64,
    ) -> i32;
    pub fn sceHttpAddRequestHeader(
        id: i32,
        name: *const c_char,
        value: *const c_char,
        mode: u32,
    ) -> i32;
    pub fn sceHttpSendRequest(request: i32, post_data: *const c_void, size: usize) -> i32;
    pub fn sceHttpGetStatusCode(request: i32, status: *mut i32) -> i32;
    pub fn sceHttpGetAllResponseHeaders(
        request: i32,
        headers: *mut *mut c_char,
        size: *mut usize,
    ) -> i32;
    pub fn sceHttpReadData(request: i32, data: *mut c_void, size: usize) -> i32;
    pub fn sceHttpSetResolveTimeOut(id: i32, microseconds: u32) -> i32;
    pub fn sceHttpSetConnectTimeOut(id: i32, microseconds: u32) -> i32;
    pub fn sceHttpSetSendTimeOut(id: i32, microseconds: u32) -> i32;
    pub fn sceHttpSetRecvTimeOut(id: i32, microseconds: u32) -> i32;
    pub fn sceHttpSetAutoRedirect(id: i32, enable: i32) -> i32;
    pub fn sceHttpDeleteRequest(request: i32) -> i32;
    pub fn sceHttpDeleteConnection(connection: i32) -> i32;
}

// ── Random ──

unsafe extern "C" {
    pub fn sceRandomGetRandomNumber(buf: *mut c_void, len: usize) -> i32;
}
