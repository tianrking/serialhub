//! Per-user login services. No elevation, shell interpolation or silent fallback
//! to a different port. System-wide boot services remain an administrator task.
use anyhow::{Context, Result};
use clap::Subcommand;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    fs::{File, OpenOptions},
    net::SocketAddr,
    path::{Path, PathBuf},
    process::Command,
};

#[derive(Subcommand, Debug)]
pub enum Action {
    /// Install and enable a headless service for the current user's login.
    Install {
        #[arg(long, default_value = "127.0.0.1:8787")]
        bind: SocketAddr,
        /// Print the native configuration without writing files or starting it.
        #[arg(long)]
        dry_run: bool,
    },
    /// Start the installed service.
    Start,
    /// Gracefully stop the service and release all serial devices.
    Stop,
    /// Show the native service manager's status (nonzero if stopped).
    Status,
    /// Show recent service logs.
    Logs,
    /// Stop and remove the login service; preserve application data.
    Uninstall,
}

#[derive(Serialize, Deserialize)]
struct Installed {
    format: String,
    identity: String,
    binary: PathBuf,
    bind: SocketAddr,
}

fn root() -> Result<PathBuf> {
    Ok(dirs::config_dir()
        .context("No user configuration directory")?
        .join("SerialHub/service"))
}
fn management_lock(root: &Path) -> Result<File> {
    std::fs::create_dir_all(root)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(root, std::fs::Permissions::from_mode(0o700))?;
    }
    let mut options = OpenOptions::new();
    options.create(true).read(true).write(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let lock = options.open(root.join("management.lock"))?;
    FileExt::try_lock_exclusive(&lock)
        .context("Another service management command is in progress; retry after it finishes")?;
    Ok(lock)
}
fn checked(value: &str) -> Result<&str> {
    anyhow::ensure!(
        !value.chars().any(|c| c.is_control()),
        "Service paths must not contain control characters"
    );
    Ok(value)
}
fn systemd_quote(path: &str) -> Result<String> {
    Ok(format!(
        "\"{}\"",
        checked(path)?
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('%', "%%")
            .replace('$', "$$")
    ))
}
fn xml(value: &str) -> Result<String> {
    Ok(checked(value)?
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;"))
}
fn ps_quote(value: &str) -> Result<String> {
    Ok(format!("'{}'", checked(value)?.replace('\'', "''")))
}
fn unit(binary: &Path, bind: SocketAddr) -> Result<String> {
    Ok(format!("[Unit]\nDescription=SerialHub headless serial workbench\n\n[Service]\nType=simple\nExecStart={} serve --bind {bind}\nRestart=on-failure\nRestartSec=3\nTimeoutStopSec=30\nKillSignal=SIGTERM\nUMask=0077\n\n[Install]\nWantedBy=default.target\n", systemd_quote(binary.to_str().context("Non-Unicode executable path")?)?))
}
fn plist(binary: &Path, bind: SocketAddr, logs: &Path) -> Result<String> {
    Ok(format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict>\n<key>Label</key><string>io.serialhub.agent</string>\n<key>ProgramArguments</key><array><string>{}</string><string>serve</string><string>--bind</string><string>{bind}</string></array>\n<key>RunAtLoad</key><true/>\n<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>\n<key>ExitTimeOut</key><integer>30</integer>\n<key>StandardOutPath</key><string>{}</string>\n<key>StandardErrorPath</key><string>{}</string>\n</dict></plist>\n", xml(binary.to_str().context("Non-Unicode executable path")?)?, xml(logs.to_str().context("Non-Unicode log path")?)?, xml(logs.to_str().context("Non-Unicode log path")?)?))
}
fn windows_script(binary: &Path, bind: SocketAddr, log: &Path) -> Result<String> {
    // The task owns PowerShell and waits for its native child. Normal web/CLI
    // shutdown returns success, so Task Scheduler does not restart a user quit.
    Ok(format!("$ErrorActionPreference = 'Stop'\n$log = {}\nif ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 4194304) {{ Move-Item -LiteralPath $log -Destination ($log + '.previous') -Force }}\n$process = Start-Process -FilePath {} -ArgumentList @('serve', '--bind', '{bind}') -NoNewWindow -Wait -PassThru -RedirectStandardOutput ($log + '.stdout') -RedirectStandardError $log\nexit $process.ExitCode\n", ps_quote(log.to_str().context("Non-Unicode log path")?)?, ps_quote(binary.to_str().context("Non-Unicode executable path")?)?))
}
#[cfg(target_os = "linux")]
fn definition() -> Result<PathBuf> {
    Ok(dirs::config_dir()
        .context("No user configuration directory")?
        .join("systemd/user/serialhub.service"))
}
#[cfg(target_os = "macos")]
fn definition() -> Result<PathBuf> {
    Ok(dirs::home_dir()
        .context("No home directory")?
        .join("Library/LaunchAgents/io.serialhub.agent.plist"))
}
#[cfg(windows)]
fn definition() -> Result<PathBuf> {
    Ok(root()?.join("run.ps1"))
}

fn execute(program: &str, args: &[&str]) -> Result<()> {
    let status = Command::new(program).args(args).status().with_context(|| {
        format!("Could not run {program}; use a supported user service session")
    })?;
    anyhow::ensure!(
        status.success(),
        "{program} failed ({status}); the service was not reported as successfully configured"
    );
    Ok(())
}
#[cfg(target_os = "macos")]
fn launch_domain() -> String {
    format!("gui/{}", nix::unistd::getuid())
}
#[cfg(target_os = "macos")]
fn mac_loaded() -> Result<bool> {
    Ok(Command::new("launchctl")
        .args(["print", &format!("{}/io.serialhub.agent", launch_domain())])
        .output()?
        .status
        .success())
}
#[cfg(windows)]
fn powershell(script: &str) -> Result<()> {
    use base64::Engine;
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    execute(
        "powershell.exe",
        &[
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            &base64::engine::general_purpose::STANDARD.encode(bytes),
        ],
    )
}
#[cfg(windows)]
fn task_name() -> Result<String> {
    // A SID scopes the task across local/domain accounts with the same name
    // and works with Unicode or apostrophes in the interactive user's name.
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
        ])
        .output()?;
    anyhow::ensure!(
        output.status.success(),
        "Could not determine the current user's SID"
    );
    let sid = String::from_utf8(output.stdout)?.trim().to_string();
    anyhow::ensure!(
        sid.starts_with("S-1-")
            && sid
                .chars()
                .all(|c| c.is_ascii_digit() || c == 'S' || c == '-'),
        "Invalid user SID"
    );
    Ok(format!("SerialHub-{sid}"))
}

fn wait_ready(bind: SocketAddr) -> Result<()> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    while !crate::launcher::headless_running(bind) {
        anyhow::ensure!(
            std::time::Instant::now() < deadline,
            "Service did not become ready; use `serialhub service logs` to inspect startup errors"
        );
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    Ok(())
}

pub fn run(action: Action) -> Result<()> {
    let root = root()?;
    let record = root.join("installed.json");
    if let Action::Install { bind, dry_run } = action {
        anyhow::ensure!(
            bind.ip().is_loopback() && bind.port() != 0,
            "A service requires a fixed nonzero loopback port"
        );
        let binary = std::env::current_exe()?
            .with_file_name(if cfg!(windows) {
                "serialhub.exe"
            } else {
                "serialhub"
            })
            .canonicalize()
            .context("The service requires the sibling serialhub core executable")?;
        let file = definition()?;
        let log = root.join("service.log");
        let content = if cfg!(target_os = "linux") {
            unit(&binary, bind)?
        } else if cfg!(target_os = "macos") {
            plist(&binary, bind, &log)?
        } else {
            windows_script(&binary, bind, &log)?
        };
        if dry_run {
            println!("{}\n{content}", file.display());
            return Ok(());
        }
        let _management = management_lock(&root)?;
        anyhow::ensure!(std::env::var_os("SERIALHUB_STATE_DIR").is_none(), "Login services use the standard per-user state directory; unset SERIALHUB_STATE_DIR or supervise `serialhub serve` with your own service definition");
        anyhow::ensure!(!file.exists() || record.exists(), "A service definition already exists without SerialHub's install record; inspect it before replacing it");
        if record.exists() {
            anyhow::bail!("A login service is already installed. Run `serialhub service uninstall` before reinstalling or moving its executable");
        }
        anyhow::ensure!(
            crate::launcher::running_address(bind)?.is_none(),
            "A manager already owns this address; stop it before installing a service"
        );
        let identity = uuid::Uuid::new_v4().to_string();
        #[cfg(target_os = "linux")]
        execute(
            "systemctl",
            &["--user", "show", "--property=Version", "--value"],
        )?;
        #[cfg(target_os = "macos")]
        anyhow::ensure!(
            !Command::new("launchctl")
                .args(["print", &format!("{}/io.serialhub.agent", launch_domain())])
                .output()?
                .status
                .success(),
            "A launch agent already uses io.serialhub.agent; inspect it first"
        );
        #[cfg(windows)]
        powershell(&format!("$ErrorActionPreference='Stop'; if(Get-ScheduledTask -TaskName {} -ErrorAction SilentlyContinue){{throw 'Task already exists; refusing to replace it'}}", ps_quote(&task_name()?)?))?;
        std::fs::create_dir_all(&root)?;
        std::fs::create_dir_all(file.parent().context("Invalid service path")?)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))?;
        }
        std::fs::write(&file, content)?;
        std::fs::write(
            &record,
            serde_json::to_vec_pretty(&Installed {
                format: "serialhub.user-service.v1".into(),
                identity: identity.clone(),
                binary,
                bind,
            })?,
        )?;
        // Retain the install record on an OS-manager failure: status/uninstall
        // can explain or remove partial installation rather than losing ownership.
        #[cfg(target_os = "linux")]
        {
            execute("systemctl", &["--user", "daemon-reload"])?;
            execute(
                "systemctl",
                &["--user", "enable", "--now", "serialhub.service"],
            )?;
        }
        #[cfg(target_os = "macos")]
        execute(
            "launchctl",
            &[
                "bootstrap",
                &launch_domain(),
                file.to_str().context("Non-Unicode service path")?,
            ],
        )?;
        #[cfg(windows)]
        {
            let task = ps_quote(&task_name()?)?;
            use base64::Engine;
            let script = std::fs::read_to_string(&file)?;
            let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
            let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
            powershell(&format!("$ErrorActionPreference='Stop'; $name={task}; if(Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue){{throw 'Task already exists; refusing to replace it'}}; $a=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand {encoded}'; $t=New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name); $p=New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited; $s=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries; Register-ScheduledTask -Description 'SerialHub {identity}' -TaskName $name -Action $a -Trigger $t -Principal $p -Settings $s | Out-Null; Start-ScheduledTask -TaskName $name"))?;
        }
        wait_ready(bind)?;
        println!("Installed headless login service at http://{bind}/. Keep the executable at its current path. Use `serialhub service status` and `serialhub service logs`.");
        return Ok(());
    }
    let _management = management_lock(&root)?;
    let installed: Installed = serde_json::from_slice(
        &std::fs::read(&record)
            .context("No user service installed; run `serialhub service install` first")?,
    )?;
    anyhow::ensure!(
        installed.format == "serialhub.user-service.v1",
        "Unknown service record format"
    );
    #[cfg(target_os = "linux")]
    match action {
        Action::Start => {
            execute("systemctl", &["--user", "start", "serialhub.service"])?;
            wait_ready(installed.bind)
        }
        Action::Stop => execute("systemctl", &["--user", "stop", "serialhub.service"]),
        Action::Status => {
            execute(
                "systemctl",
                &["--user", "status", "--no-pager", "serialhub.service"],
            )?;
            anyhow::ensure!(
                crate::launcher::headless_running(installed.bind),
                "Headless workbench is not running"
            );
            Ok(())
        }
        Action::Logs => execute(
            "journalctl",
            &[
                "--user",
                "-u",
                "serialhub.service",
                "-n",
                "100",
                "--no-pager",
            ],
        ),
        Action::Uninstall => {
            execute(
                "systemctl",
                &["--user", "disable", "--now", "serialhub.service"],
            )?;
            std::fs::remove_file(definition()?)?;
            std::fs::remove_file(record)?;
            execute("systemctl", &["--user", "daemon-reload"])
        }
        Action::Install { .. } => unreachable!(),
    }
    #[cfg(target_os = "macos")]
    match action {
        Action::Start => {
            if crate::launcher::headless_running(installed.bind) {
                return Ok(());
            }
            if mac_loaded()? {
                execute(
                    "launchctl",
                    &[
                        "bootout",
                        &format!("{}/io.serialhub.agent", launch_domain()),
                    ],
                )?;
            }
            execute(
                "launchctl",
                &[
                    "bootstrap",
                    &launch_domain(),
                    definition()?.to_str().context("Non-Unicode service path")?,
                ],
            )?;
            wait_ready(installed.bind)
        }
        Action::Stop => {
            crate::launcher::stop(installed.bind)?;
            if mac_loaded()? {
                execute(
                    "launchctl",
                    &[
                        "bootout",
                        &format!("{}/io.serialhub.agent", launch_domain()),
                    ],
                )?;
            }
            Ok(())
        }
        Action::Status => {
            execute(
                "launchctl",
                &["print", &format!("{}/io.serialhub.agent", launch_domain())],
            )?;
            anyhow::ensure!(
                crate::launcher::headless_running(installed.bind),
                "Service is stopped"
            );
            Ok(())
        }
        Action::Logs => execute(
            "tail",
            &[
                "-n",
                "100",
                root.join("service.log")
                    .to_str()
                    .context("Non-Unicode log path")?,
            ],
        ),
        Action::Uninstall => {
            crate::launcher::stop(installed.bind)?;
            if mac_loaded()? {
                execute(
                    "launchctl",
                    &[
                        "bootout",
                        &format!("{}/io.serialhub.agent", launch_domain()),
                    ],
                )?;
            }
            std::fs::remove_file(definition()?)?;
            std::fs::remove_file(record)?;
            Ok(())
        }
        Action::Install { .. } => unreachable!(),
    }
    #[cfg(windows)]
    {
        let task = ps_quote(&task_name()?)?;
        let expected = ps_quote(&format!("SerialHub {}", installed.identity))?;
        let missing_allowed = if matches!(action, Action::Uninstall) {
            "$true"
        } else {
            "$false"
        };
        powershell(&format!("$ErrorActionPreference='Stop'; $t=Get-ScheduledTask -TaskName {task} -ErrorAction SilentlyContinue; if($null -eq $t){{if({missing_allowed}){{exit 0}}; throw 'No login task is registered'}}; if($t.Description -ne {expected}){{throw 'Task ownership differs; refusing to manage it'}}"))?;
        match action {
            Action::Start => {
                powershell(&format!(
                    "$ErrorActionPreference='Stop'; Start-ScheduledTask -TaskName {task}"
                ))?;
                wait_ready(installed.bind)
            }
            Action::Stop => {
                crate::launcher::stop(installed.bind)?;
                powershell(&format!("$ErrorActionPreference='Stop'; $end=[DateTime]::UtcNow.AddSeconds(15); while((Get-ScheduledTask -TaskName {task}).State -eq 'Running'){{if([DateTime]::UtcNow -gt $end){{throw 'Task did not stop after native shutdown'}}; Start-Sleep -Milliseconds 100}}"))
            }
            Action::Status => {
                powershell(&format!("$ErrorActionPreference='Stop'; $t=Get-ScheduledTask -TaskName {task}; $t | Format-List TaskName,State; if($t.State -ne 'Running'){{exit 1}}"))?;
                anyhow::ensure!(
                    crate::launcher::headless_running(installed.bind),
                    "Headless workbench is not running"
                );
                Ok(())
            }
            Action::Logs => powershell(&format!(
                "Get-Content -LiteralPath @({}, {}) -Tail 100 -ErrorAction Stop",
                ps_quote(
                    root.join("service.log")
                        .to_str()
                        .context("Non-Unicode log path")?
                )?,
                ps_quote(
                    root.join("service.log.stdout")
                        .to_str()
                        .context("Non-Unicode log path")?
                )?
            )),
            Action::Uninstall => {
                crate::launcher::stop(installed.bind)?;
                powershell(&format!("$ErrorActionPreference='Stop'; if(Get-ScheduledTask -TaskName {task} -ErrorAction SilentlyContinue){{Unregister-ScheduledTask -TaskName {task} -Confirm:$false}}"))?;
                std::fs::remove_file(definition()?)?;
                std::fs::remove_file(record)?;
                Ok(())
            }
            Action::Install { .. } => unreachable!(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn concurrent_service_management_cannot_replace_the_install_record() {
        let root = tempfile::tempdir().unwrap();
        let first = management_lock(root.path()).unwrap();
        assert!(management_lock(root.path()).is_err());
        drop(first);
        assert!(management_lock(root.path()).is_ok());
    }
    #[test]
    fn service_paths_are_escaped_for_the_native_parser() {
        let bind = "127.0.0.1:8787".parse().unwrap();
        let systemd = unit(Path::new("/home/A B/$x%q/serialhub"), bind).unwrap();
        assert!(systemd.contains("\"/home/A B/$$x%%q/serialhub\" serve"));
        assert!(!systemd.contains("sh -c"));
        let launch = plist(
            Path::new("/home/A&B/serialhub"),
            bind,
            Path::new("/tmp/log"),
        )
        .unwrap();
        assert!(launch.contains("A&amp;B"));
        assert!(launch.contains("<string>serve</string>"));
        let windows = windows_script(
            Path::new("C:\\O'Brien\\serialhub.exe"),
            bind,
            Path::new("C:\\log"),
        )
        .unwrap();
        assert!(windows.contains("O''Brien"));
        assert!(unit(Path::new("/tmp/a\nb"), bind).is_err());
    }
}
