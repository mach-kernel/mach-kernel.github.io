---
title: "A convoluted Hello World involving Rust, FFI, and Apple launchd?!"
published: true
layout: post
categories: macos rust
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


#### How did launchctl do it?

Apple has historically released XNU + other pieces as OSS, so it would be easiest to start by reading [the launchd source code](https://opensource.apple.com/tarballs/launchd/). Problem is that this code is [a bit out of date](https://en.wikipedia.org/wiki/Launchd), launchd is now closed source (probably due to security hardening) and uses libxpc instead:

>The last Wayback Machine capture of the Mac OS Forge area for launchd was in June 2012,[9] and the most recent open source version from Apple was 842.92.1 in code for OS X 10.9.5. 

Still, this is much better than nothing. After looking at the source, `launchctl list com.apple.Spotlight` ends up as a new `launch_data_t` which is a linked list of the `GetJob` -> `com.apple.Spotlight`:

###### launchctl.c

```c
msg = launch_data_alloc(LAUNCH_DATA_DICTIONARY);
launch_data_dict_insert(msg, launch_data_new_string(label), LAUNCH_KEY_GETJOB);

resp = launch_msg(msg);
launch_data_free(msg);
```

`launch_msg` is provided in `launch.h`. Hey! I have XCode installed, surely something is there:

```
$ find $(xcrun --show-sdk-path) -type f -name 'launch.h'
/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk/usr/include/launch.h
```

It looks like they don't want us to use it:

```c
/* launch_msg()
 *
 * Use this API to check in. Nothing else.
 */
__ld_normal
launch_data_t
launch_msg(const launch_data_t);
```

At all!

```
/*!
 * @header
 * These interfaces were only ever documented for the purpose of allowing a
 * launchd job to obtain file descriptors associated with the sockets it
 * advertised in its launchd.plist(5). That functionality is now available in a
 * much more straightforward fashion through the {@link launch_activate_socket}
 * API.
 *
 * There are currently no replacements for other uses of the {@link launch_msg}
 * API, including submitting, removing, starting, stopping and listing jobs.
 */
```

PS: The APIs do work for unsanctioned purposes, but that would ruin the fun we're about to have!

#### How does launchctl do it now?

[Refer to this comprehensive XPC overview](https://www.objc.io/issues/14-mac/xpc)

[Apple official XPC developer documentation](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingXPCServices.html#//apple_ref/doc/uid/10000172i-SW6-SW1)

Before starting, if you want to follow along you'll probably need to disable SIP. Otherwise, you won't be able to debug the `launchctl` binary due to Apple's [new hardened runtime requirements](https://lapcatsoftware.com/articles/debugging-mojave.html) and will be greeted by this in the console:

```
error: MachTask::TaskPortForProcessID task_for_pid failed: ::task_for_pid ( target_tport = 0x0103, pid = 66905, &task ) => err = 0x00000005 ((os/kern) failure)
macOSTaskPolicy: (com.apple.debugserver) may not get the taskport of (launchctl) (pid: 66905): (launchctl) is hardened, (launchctl) doesn't have get-task-allow, (com.apple.debugserver) is a declared debugger
```

Now that we're moving on, it's time to admit this is probably cheating and reading the docs is better, but install radare2 and go spelunking:

```
$ r2 ./launchctl
-- THE CAKE IS A PIE
[0x100004457]> aa
[0x100004457]> afl ~xpc
0x10000dfca    1 6            sym.imp.xpc_array_apply_f
0x10000dfd0    1 6            sym.imp.xpc_array_create
0x10000e01e    1 6            sym.imp.xpc_dictionary_create
0x10000e042    1 6            sym.imp.xpc_dictionary_get_string
0x10000e048    1 6            sym.imp.xpc_dictionary_get_uint64
0x10000e06c    1 6            sym.imp.xpc_dictionary_set_string
0x10000e072    1 6            sym.imp.xpc_dictionary_set_uint64
0x10000e084    1 6            sym.imp.xpc_get_type
0x10000e08a    1 6            sym.imp.xpc_int64_create
0x10000e090    1 6            sym.imp.xpc_int64_get_value
0x10000e096    1 6            sym.imp.xpc_null_create
0x10000e09c    1 6            sym.imp.xpc_pipe_create_from_port
0x10000e0a2    1 6            sym.imp.xpc_pipe_routine_with_flags
0x10000e0a8    1 6            sym.imp.xpc_release
0x10000e0b4    1 6            sym.imp.xpc_strerror
0x10000e0ba    1 6            sym.imp.xpc_string_create
0x10000e0c0    1 6            sym.imp.xpc_string_get_string_ptr
```

I've omitted a bunch of functions, but the idea looks to be the same. The majority of these helpers provide an API for building XPC data and then somehow a message is sent. Truth is, I tried [the method outlined here](http://newosxbook.com/articles/jlaunchctl.html) re logging the XPC messages but was not able to get it working:

>Start launchctl with no arguments under lldb
>Set a breakpoint on xpc_pipe_routine
>Run with whatever request argument you want to test
>When the breakpoint hits, set another breakpoint on mach_msg
>continue on the first two hits of mach_msg - these are the setup messages of the XPC pipe
>mem read $rdi to see the content of the third message

`xpc_pipe_routine` (see pg. 11 [here](http://newosxbook.com/files/HITSB.pdf)) appears to be the boundary through which XPC messages pass. I'm sure security researchers can explain it better. I unfortunately was not able to break at `xpc_pipe_routine`. Looking at functions in radare, there appears to be no symbol for `xpc_pipe_routine` -- only for  `xpc_pipe_routine_with_flags` -- which seems to explain what I observed. Trying that again:

```
$ lldb launchctl
(lldb) b xpc_pipe_routine_with_flags
Breakpoint 1: where = libxpc.dylib`xpc_pipe_routine_with_flags, address = 0x00007fff2008d841
(lldb) run list com.apple.Spotlight
Process 77861 launched: '/bin/launchctl' (x86_64)
* thread #1, queue = 'com.apple.main-thread', stop reason = breakpoint 1.4
    frame #0: 0x00007fff2008d841 libxpc.dylib`xpc_pipe_routine_with_flags

### a bunch of continues, for messages going to com.apple.logd and others ### 

libxpc.dylib`xpc_pipe_routine_with_flags:
->  0x7fff2008d841 <+0>: pushq  %rbp
    0x7fff2008d842 <+1>: movq   %rsp, %rbp
    0x7fff2008d845 <+4>: pushq  %r15
    0x7fff2008d847 <+6>: pushq  %r14
(lldb) p (char *) xpc_copy_description($rsi)
(char *) $8 = 0x0000000100205af0 "<dictionary: 0x1006040c0> { count = 7, transaction: 0, voucher = 0x0, contents =\n\t\"subsystem\" => <uint64: 0xc2e26cce006963a7>: 3\n\t\"handle\" => <uint64: 0xc2e26cce006953a7>: 0\n\t\"routine\" => <uint64: 0xc2e26cce005ba3a7>: 815\n\t\"name\" => <string: 0x1006046d0> { length = 19, contents = \"com.apple.Spotlight\" }\n\t\"type\" => <uint64: 0xc2e26cce006923a7>: 7\n\t\"legacy\" => <bool: 0x7fff800410b0>: true\n\t\"domain-port\" => <mach send right: 0x100604530> { name = 1799, right = send, urefs = 5 }\n}
```

[Thanks to this post](https://geosn0w.github.io/A-Long-Evening-With-macOS%27s-Sandbox/) for the `xpc_copy_description` trick! `fr v` shows nothing, so we can't easily see local frame variables. x86_64 [calling convention](https://github.com/cirosantilli/x86-assembly-cheat/blob/master/x86-64/calling-convention.md) stipulates (at least on *nix machines) that the first 6 arguments are loaded the registers (in order): `%rdi %rsi %rdx %rcx %r8 %r9` (if there are more, they go on the stack). `lldb` is also awesome and shows us the pointer types:

```
(lldb) p (void *) $rdi
(OS_xpc_pipe *) $14 = 0x00000001002054b0
(lldb) p (void *) $rsi
(OS_xpc_dictionary *) $15 = 0x00000001006040c0
```

`OS_xpc_dictionary` is referenced in [Apple's official xpc.h objc docs](https://developer.apple.com/documentation/xpc/xpc_services_xpc_h?language=objc)! This is a list of functions that we can call from the debugger!! It sounds like `$rsi` could be an `xpc_object_t`:

```
# https://developer.apple.com/documentation/xpc/xpc_object_t?language=objc
xpc_type_t xpc_get_type(xpc_object_t object);

# void* since it is a pointer
(lldb) p (void *) xpc_get_type($rsi)
(OS_xpc_dictionary *) $20 = 0x00007fff889b3bf0
```

#### Decoding the XPC Messages


#### Rust piece


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