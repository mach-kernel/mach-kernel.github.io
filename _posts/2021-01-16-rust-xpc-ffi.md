---
title: "A convoluted Hello World involving Rust, FFI, and Apple launchd"
published: true
layout: post
categories: retrocomputing
date: 2021-01-02T21:47:44-05:00
---

[chkservice](https://github.com/linuxenko/chkservice) is neat ncurses TUI for fiddling with systemd units. The closest we get on Macs is [launch-control](https://www.soma-zone.com/LaunchControl/), otherwise it is `launchctl` or bust. Impressed by _[Ferris'](https://rustacean.net/)_ acting range, I figured it was time to try out some Rust; let's try and build a tool like this that queries Apple `launchd` for its daemons.

#### What do we want to accomplish?

`launchctl list` gives us a list of all loaded daemons:

```bash
$ launchctl list | head -4
PID	Status	Label
-	0	com.apple.SafariHistoryServiceAgent
555	0	com.apple.progressd
-	0	com.apple.cloudphotod
```

Providing a daemon name gives us information about it:

```bash
$ launchctl list com.apple.Spotlight
{
	"LimitLoadToSessionType" = "Aqua";
	"MachServices" = {
		"com.apple.private.spotlight.mdwrite" = mach-port-object;
		"com.apple.Spotlight" = mach-port-object;
	};
	"Label" = "com.apple.Spotlight";
	"OnDemand" = true;
	"LastExitStatus" = 0;
	"PID" = 431;
	"Program" = "/System/Library/CoreServices/Spotlight.app/Contents/MacOS/Spotlight";
	"ProgramArguments" = (
		"/System/Library/CoreServices/Spotlight.app/Contents/MacOS/Spotlight";
	);
	"PerJobMachServices" = {
		"com.apple.tsm.portname" = mach-port-object;
		"com.apple.coredrag" = mach-port-object;
		"com.apple.axserver" = mach-port-object;
	};
};
```

We can display the list of daemons in an ncurses pager, and pop up a dialog with the extra information if someone selects a daemon with enter. That should give us a sufficient amount of stuff to do while keeping the demo nice and sweet. Before we can write any code we first have to do some homework.


#### How does launchctl do it?

Knowing nothing about the guts of `launchd`, a first step may be seeing what the actual `launchctl` tool is linked to.

It would be useful to know what we get for a simple hello world:

```
$ echo 'int main(int argc, char**argv) { printf("Hello world!\\n"); return 0; }' | clang -o testbin -v -xc -
$ otool -L testbin
testbin:
	/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1292.60.1)
```

Seems that `libSystem` has libc. And now for `launchctl`:

```
$ otool -L $(which launchctl)
/bin/launchctl:
	/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1292.60.1)
	/usr/lib/libobjc.A.dylib (compatibility version 1.0.0, current version 228.0.0)
	/usr/lib/libbsm.0.dylib (compatibility version 1.0.0, current version 1.0.0)
```

`libbsm` has to do with [OpenBSM support since 10.6x](https://derflounder.wordpress.com/2012/01/30/openbsm-auditing-on-mac-os-x/), and `libobjc` is the [objc runtime](https://developer.apple.com/documentation/objectivec/objective-c_runtime). Communication between `launchctl` and `launchd` is likely using an IPC API available in `libSystem`.

Naively, I thought we can maybe get more info by poking around:

```
$ lldb $(which launchctl)
(lldb) target create "/bin/launchctl"
Current executable set to '/bin/launchctl' (x86_64).
(lldb) run list
error: process exited with status -1 (attach failed (Not allowed to attach to process.  Look in the console messages (Console.app), near the debugserver entries when the attached failed.  The subsystem that denied the attach permission will likely have logged an informative message about why it was denied.))
```

Console events for `com.apple.dt.lldb`:

```
error: MachTask::TaskPortForProcessID task_for_pid failed: ::task_for_pid ( target_tport = 0x0103, pid = 66905, &task ) => err = 0x00000005 ((os/kern) failure)
macOSTaskPolicy: (com.apple.debugserver) may not get the taskport of (launchctl) (pid: 66905): (launchctl) is hardened, (launchctl) doesn't have get-task-allow, (com.apple.debugserver) is a declared debugger
```

Hardened runtime was introduced in 10.13.6. According to [this article about debugging on Mojave](https://lapcatsoftware.com/articles/debugging-mojave.html):

>What happens on Mojave if you try to debug an app compiled with the hardened runtime? If System Integrity Protection is disabled, then nothing changes; it's the same as I described in the first section of this blog post. So the hardened runtime is enforced by SIP. With SIP enabled, you can still debug your app if it's compiled with the com.apple.security.get-task-allow entitlement. If an app doesn't have that entitlement, however, then you can't debug it at all.

`dtruss` doesn't show anything interesting ([trace here](https://gist.github.com/mach-kernel/047b0bb51d66fca83ffdcbe07ca93eb0)). If all you get are probe errors, then you [likely have to run](https://stackoverflow.com/a/36760408) `csrutil enable --without dtrace` from your recovery partition. Bummer. It seems that disabling SIP is the only way.