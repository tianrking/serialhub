//! Native tray/menu-bar host. KSNI avoids GTK/AppIndicator dependencies on Linux.
//! Only this main-thread module touches AppKit or the Windows message queue.
use crate::desktop::DesktopControl;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tokio_util::sync::CancellationToken;
use tray_icon::{
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    Icon, TrayIconBuilder, TrayIconEvent,
};

fn labels(locale: &str) -> [&'static str; 5] {
    match locale {
        "zh-Hant" => [
            "開啟工作台",
            "開啟診斷記錄",
            "結束 SerialHub",
            "正在背景執行",
            "正在結束…",
        ],
        "zh-Hans" => [
            "打开工作台",
            "打开诊断日志",
            "退出 SerialHub",
            "正在后台运行",
            "正在退出…",
        ],
        "es" => [
            "Abrir espacio de trabajo",
            "Abrir diagnósticos",
            "Salir de SerialHub",
            "En segundo plano",
            "Cerrando…",
        ],
        "fr" => [
            "Ouvrir l’espace de travail",
            "Ouvrir les diagnostics",
            "Quitter SerialHub",
            "Actif en arrière-plan",
            "Arrêt en cours…",
        ],
        "ar" => [
            "فتح مساحة العمل",
            "فتح سجل التشخيص",
            "إنهاء SerialHub",
            "يعمل في الخلفية",
            "جارٍ الإنهاء…",
        ],
        _ => [
            "Open workspace",
            "Open diagnostics",
            "Quit SerialHub",
            "Running in background",
            "Stopping…",
        ],
    }
}
fn icon() -> anyhow::Result<Icon> {
    let bytes = if cfg!(target_os = "macos") {
        include_bytes!("../assets/brand/serialhub-tray-template.rgba").to_vec()
    } else {
        include_bytes!("../assets/brand/serialhub-tray.rgba").to_vec()
    };
    Ok(Icon::from_rgba(bytes, 32, 32)?)
}
pub fn run(
    url: &str,
    control: Arc<DesktopControl>,
    stop: CancellationToken,
    done: Arc<AtomicBool>,
) -> anyhow::Result<()> {
    #[cfg(target_os = "macos")]
    {
        objc2::rc::autoreleasepool(|_| run_inner(url, control, stop, done))
    }
    #[cfg(not(target_os = "macos"))]
    {
        run_inner(url, control, stop, done)
    }
}
fn run_inner(
    url: &str,
    control: Arc<DesktopControl>,
    stop: CancellationToken,
    done: Arc<AtomicBool>,
) -> anyhow::Result<()> {
    #[cfg(target_os = "macos")]
    let (application, delegate) = {
        use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
        let marker = objc2::MainThreadMarker::new()
            .ok_or_else(|| anyhow::anyhow!("The desktop launcher must run on the main thread"))?;
        let app = NSApplication::sharedApplication(marker);
        app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
        let delegate = mac_reopen::Delegate::new(marker, url.to_owned());
        app.setDelegate(Some(objc2::runtime::ProtocolObject::from_ref(&*delegate)));
        app.finishLaunching();
        (app, delegate)
    };
    let menu = Menu::new();
    let title = MenuItem::new(
        format!("SerialHub v{}", env!("CARGO_PKG_VERSION")),
        false,
        None,
    );
    let status = MenuItem::new(labels("")[3], false, None);
    let open = MenuItem::new(labels("")[0], true, None);
    let logs = MenuItem::new(labels("")[1], true, None);
    let quit = MenuItem::new(labels("")[2], true, None);
    menu.append(&title)?;
    menu.append(&status)?;
    menu.append(&PredefinedMenuItem::separator())?;
    menu.append(&open)?;
    menu.append(&logs)?;
    menu.append(&PredefinedMenuItem::separator())?;
    menu.append(&quit)?;
    let builder = TrayIconBuilder::new()
        .with_id("io.serialhub.SerialHub")
        .with_autosave_name("io.serialhub.desktop")
        .with_menu(Box::new(menu))
        .with_tooltip("SerialHub — running in background")
        .with_menu_on_left_click(cfg!(target_os = "macos"));
    #[cfg(target_os = "linux")]
    let builder = builder.with_title("SerialHub");
    #[cfg(target_os = "macos")]
    let builder = builder.with_icon_templated(icon()?);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.with_icon(icon()?);
    let tray = builder.build();
    let tray = match tray {
        Ok(tray) => {
            control.tray.store(true, Ordering::Release);
            Some(tray)
        }
        Err(e) => {
            eprintln!("System tray unavailable ({e}); reopen the launcher or use the web app menu / --quit to control SerialHub");
            None
        }
    };
    let mut previous = String::new();
    let mut stopping = false;
    while !done.load(Ordering::Acquire) {
        #[cfg(windows)]
        unsafe {
            use windows_sys::Win32::UI::WindowsAndMessaging::*;
            let mut message = std::mem::zeroed();
            while PeekMessageW(&mut message, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
                if message.message == WM_QUIT {
                    stop.cancel();
                }
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
        #[cfg(target_os = "macos")]
        objc2::rc::autoreleasepool(|_| {
            use objc2_app_kit::NSEventMask;
            use objc2_foundation::{NSDate, NSDefaultRunLoopMode};
            let until = NSDate::dateWithTimeIntervalSinceNow(0.1);
            // AppKit's exported run-loop mode is immutable for the process lifetime.
            if let Some(event) = application.nextEventMatchingMask_untilDate_inMode_dequeue(
                NSEventMask::Any,
                Some(&until),
                unsafe { NSDefaultRunLoopMode },
                true,
            ) {
                application.sendEvent(&event);
            }
        });
        let locale = control.locale.read().clone();
        if locale != previous {
            let text = labels(&locale);
            open.set_text(text[0]);
            logs.set_text(text[1]);
            quit.set_text(text[2]);
            status.set_text(text[3]);
            if let Some(tray) = &tray {
                let _ = tray.set_tooltip(Some(format!("SerialHub — {}", text[3])));
            }
            previous = locale;
        }
        if stop.is_cancelled() && !stopping {
            stopping = true;
            open.set_enabled(false);
            quit.set_enabled(false);
            status.set_text(labels(&previous)[4]);
        }
        while let Ok(event) = MenuEvent::receiver().try_recv() {
            if event.id == quit.id() {
                stop.cancel();
            } else if event.id == open.id() && !stopping {
                open_url(url.to_owned());
            } else if event.id == logs.id() {
                if let Some(path) = control.log.read().clone() {
                    std::thread::spawn(move || {
                        if let Err(e) = opener::open(path) {
                            eprintln!("Could not open diagnostics: {e}");
                        }
                    });
                }
            }
        }
        while let Ok(event) = TrayIconEvent::receiver().try_recv() {
            let activate = matches!(
                event,
                TrayIconEvent::DoubleClick {
                    button: tray_icon::MouseButton::Left,
                    ..
                }
            ) || (cfg!(target_os = "linux")
                && matches!(
                    event,
                    TrayIconEvent::Click {
                        button: tray_icon::MouseButton::Left,
                        button_state: tray_icon::MouseButtonState::Up,
                        ..
                    }
                ));
            if activate && !stopping {
                open_url(url.to_owned());
            }
        }
        #[cfg(not(target_os = "macos"))]
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    control.tray.store(false, Ordering::Release);
    drop(tray);
    #[cfg(target_os = "macos")]
    {
        application.setDelegate(None);
        drop(delegate);
    }
    Ok(())
}
fn open_url(url: String) {
    std::thread::spawn(move || {
        if let Err(e) = opener::open(url) {
            eprintln!("Could not open the workspace: {e}");
        }
    });
}

#[cfg(target_os = "macos")]
mod mac_reopen {
    use objc2::rc::Retained;
    use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSApplication, NSApplicationDelegate};
    use objc2_foundation::{NSObject, NSObjectProtocol};
    // NSApplication keeps a weak delegate; run_inner retains this for the entire
    // event loop so Finder reopen events always open the existing workspace.
    define_class!(
        #[unsafe(super=NSObject)]
        #[thread_kind=MainThreadOnly]
        #[ivars=String]
        pub struct Delegate;
        unsafe impl NSObjectProtocol for Delegate {}
        unsafe impl NSApplicationDelegate for Delegate {
            #[unsafe(method(applicationShouldHandleReopen:hasVisibleWindows:))]
            fn reopen(&self, _app: &NSApplication, _visible: bool) -> bool {
                super::open_url(self.ivars().clone());
                false
            }
        }
    );
    impl Delegate {
        pub fn new(marker: MainThreadMarker, url: String) -> Retained<Self> {
            let object = Self::alloc(marker).set_ivars(url);
            // NSObject has no additional initialization requirements.
            unsafe { msg_send![super(object), init] }
        }
    }
}
