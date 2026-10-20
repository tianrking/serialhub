//! Explicit inheritance prevents captured launcher pipes from remaining open in
//! a detached worker. Stable std::Command inherits every inheritable handle on
//! Windows, even when its standard streams have been redirected to a log.
use anyhow::{Context, Result};
use std::{
    fs::File,
    net::SocketAddr,
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    },
};
use windows_sys::Win32::{
    Foundation::{SetHandleInformation, HANDLE_FLAG_INHERIT},
    System::Threading::{
        CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess,
        InitializeProcThreadAttributeList, UpdateProcThreadAttribute, CREATE_NEW_PROCESS_GROUP,
        CREATE_NO_WINDOW, EXTENDED_STARTUPINFO_PRESENT, LPPROC_THREAD_ATTRIBUTE_LIST,
        PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, STARTF_USESTDHANDLES,
        STARTUPINFOEXW,
    },
};

pub(super) struct Child(OwnedHandle);
impl Child {
    pub(super) fn try_wait(&mut self) -> Result<Option<bool>> {
        let mut code = 0;
        // SAFETY: the owned process handle remains live for this call.
        if unsafe { GetExitCodeProcess(self.0.as_raw_handle(), &mut code) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok((code != 259).then_some(code == 0)) // STILL_ACTIVE
    }
}

struct Attributes {
    // usize storage gives Windows' opaque attribute list pointer alignment.
    _storage: Vec<usize>,
    pointer: LPPROC_THREAD_ATTRIBUTE_LIST,
}
impl Drop for Attributes {
    fn drop(&mut self) {
        // SAFETY: pointer was initialized in the storage retained by this guard.
        unsafe { DeleteProcThreadAttributeList(self.pointer) };
    }
}

pub(super) fn spawn(bind: SocketAddr, log: File) -> Result<Child> {
    let input = File::open("NUL")?;
    let handles = [input.as_raw_handle(), log.as_raw_handle()];
    // These are newly opened, private handles. No parent standard handle flags
    // are changed, so concurrent logging/callers retain their original behavior.
    for handle in handles {
        // SAFETY: both File owners remain live through CreateProcessW.
        if unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
    }
    let mut bytes = 0;
    // SAFETY: the first call only queries the required allocation size.
    unsafe { InitializeProcThreadAttributeList(std::ptr::null_mut(), 1, 0, &mut bytes) };
    anyhow::ensure!(bytes > 0, "Could not size Windows process attributes");
    let mut storage = vec![0usize; bytes.div_ceil(std::mem::size_of::<usize>())];
    let pointer = storage.as_mut_ptr().cast();
    // SAFETY: storage is aligned, initialized and large enough for the list.
    if unsafe { InitializeProcThreadAttributeList(pointer, 1, 0, &mut bytes) } == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let attributes = Attributes {
        _storage: storage,
        pointer,
    };
    // SAFETY: handle array and initialized list remain live through process creation.
    if unsafe {
        UpdateProcThreadAttribute(
            attributes.pointer,
            0,
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
            handles.as_ptr().cast(),
            std::mem::size_of_val(&handles),
            std::ptr::null_mut(),
            std::ptr::null(),
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().into());
    }
    let executable: Vec<u16> = std::env::current_exe()?
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    // lpApplicationName carries the exact executable path, including UTF-16
    // filenames. A fixed argv[0] avoids re-quoting an arbitrary portable path.
    let mut command: Vec<u16> = format!("serialhub --desktop-worker {bind}\0")
        .encode_utf16()
        .collect();
    // SAFETY: these C structs permit zero initialization; every required field
    // is populated before CreateProcessW. Windows copies the argument storage.
    let mut startup: STARTUPINFOEXW = unsafe { std::mem::zeroed() };
    startup.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = handles[0];
    startup.StartupInfo.hStdOutput = handles[1];
    startup.StartupInfo.hStdError = handles[1];
    startup.lpAttributeList = attributes.pointer;
    let mut process: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
    // SAFETY: all pointers reference live, properly sized data. Inheritance is
    // restricted to the two declared handles; the OS inherits the environment.
    let created = unsafe {
        CreateProcessW(
            executable.as_ptr(),
            command.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
            CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | EXTENDED_STARTUPINFO_PRESENT,
            std::ptr::null(),
            std::ptr::null(),
            &startup.StartupInfo,
            &mut process,
        )
    };
    if created == 0 {
        return Err(std::io::Error::last_os_error())
            .context("Could not launch the isolated Windows worker");
    }
    // SAFETY: successful creation transferred two unique, valid kernel handles
    // to this caller. Close the initial thread handle and retain the process.
    let thread = unsafe { OwnedHandle::from_raw_handle(process.hThread) };
    drop(thread);
    Ok(Child(unsafe {
        OwnedHandle::from_raw_handle(process.hProcess)
    }))
}
