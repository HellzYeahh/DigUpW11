//! When a folder's big first pass (the backfill) may run, as the Mac app's PowerPolicy: not in the system's energy
//! saver (the Mac's Low Power Mode), and on a charger when "Index on battery power" is off (it's on by default). New
//! files always go in right away (the index helper reads up to 50 of them whatever the power source); what waits is
//! the rest, and it starts again on the charger. The power source is Windows' (GetSystemPowerStatus, told of changes
//! by system.rs), or Linux's /sys/class/power_supply, looked at every few seconds.

/// Where the power comes from now.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Power {
    pub on_battery: bool,
    /// Windows' energy saver (battery saver before 24H2) is on.
    pub saver: bool,
}

/// Why the backfill has to wait, in the words the status line puts after "306 files waiting · ", or None.
pub fn blocker(index_on_battery: bool, power: Power) -> Option<String> {
    if power.saver {
        return Some("energy saver".into());
    }
    if !index_on_battery && power.on_battery {
        return Some("on battery".into());
    }
    None
}

#[cfg(windows)]
pub fn now() -> Power {
    use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    let mut status = SYSTEM_POWER_STATUS::default();
    // SAFETY: the struct is the size the call writes.
    if unsafe { GetSystemPowerStatus(&mut status) } == 0 {
        return Power::default();
    }
    // ACLineStatus: 0 offline, 1 online, 255 unknown (a desktop without a battery says online).
    Power { on_battery: status.ACLineStatus == 0, saver: status.SystemStatusFlag == 1 }
}

#[cfg(target_os = "linux")]
pub fn now() -> Power {
    let supplies = std::fs::read_dir("/sys/class/power_supply").into_iter().flatten().flatten()
        .map(|entry| {
            let read = |name: &str| std::fs::read_to_string(entry.path().join(name)).unwrap_or_default().trim().to_string();
            (read("type"), read("online"), read("status"), read("scope"))
        })
        .collect::<Vec<_>>();
    Power { on_battery: on_battery(&supplies), saver: false }
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn now() -> Power {
    Power::default()
}

/// From each power supply's type, online, status and scope (sysfs): on battery when a system battery discharges and no
/// charger is plugged in. No battery (a desktop): on mains.
#[cfg_attr(not(any(target_os = "linux", test)), allow(dead_code))]
fn on_battery(supplies: &[(String, String, String, String)]) -> bool {
    let charger = supplies.iter().any(|(kind, online, _, _)| kind != "Battery" && online == "1");
    // A mouse's or a headset's battery says scope "Device": it isn't what runs the computer.
    let discharging = supplies.iter().any(|(kind, _, status, scope)| {
        kind == "Battery" && scope != "Device" && status == "Discharging"
    });
    discharging && !charger
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_makes_the_backfill_wait() {
        let mains = Power { on_battery: false, saver: false };
        let battery = Power { on_battery: true, saver: false };
        // On by default: the battery doesn't matter.
        assert_eq!(blocker(true, battery), None);
        assert_eq!(blocker(false, mains), None);
        assert_eq!(blocker(false, battery).as_deref(), Some("on battery"));
        // The energy saver makes it wait either way, as Low Power Mode does on a Mac.
        assert_eq!(blocker(true, Power { on_battery: true, saver: true }).as_deref(), Some("energy saver"));
        assert_eq!(blocker(false, Power { on_battery: true, saver: true }).as_deref(), Some("energy saver"));
    }

    #[test]
    fn linux_power_supplies() {
        let supply = |kind: &str, online: &str, status: &str, scope: &str| {
            (kind.to_string(), online.to_string(), status.to_string(), scope.to_string())
        };
        assert!(!on_battery(&[]));
        assert!(on_battery(&[supply("Mains", "0", "", ""), supply("Battery", "", "Discharging", "")]));
        assert!(!on_battery(&[supply("Mains", "1", "", ""), supply("Battery", "", "Charging", "")]));
        assert!(!on_battery(&[supply("USB", "1", "", ""), supply("Battery", "", "Discharging", "")]));
        assert!(!on_battery(&[supply("Mains", "1", "", ""), supply("Battery", "", "Discharging", "Device")]));
        assert!(!on_battery(&[supply("Battery", "", "Discharging", "Device")]));
        assert!(!on_battery(&[supply("Battery", "", "Full", "")]));
    }
}
