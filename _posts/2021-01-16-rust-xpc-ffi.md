---
title: "Baby's first Rust...with FFI and launchd?!"
published: true
layout: post
categories: macos rust ffi xpc ncurses
date: 2021-01-02T21:47:44-05:00
---

A few months ago I [read a comment](https://news.ycombinator.com/item?id=2565458) on a HN post about GNOME/systemd (part of someone's "zomg systemd is ruining everything" campaign in a chatroom). I learned a cool tidbit of information: apparently systemd was inspired by Apple's launchd. Having subsequently fallen into a wiki-hole about init systems, I began to play with `launchctl` on my local machine. Turns out that launchd does some pretty cool things: the `*.plist` describing a job can do more than just specify its arguments! For example, the `QueueDirectories` key lets you spawn jobs when files are added to a directory (how useful!). I was oblivious to this having interacted with launchd the past years mostly via `brew services`.

[soma-zone's LaunchControl](https://www.soma-zone.com/LaunchControl/) and [launchd.info](https://www.launchd.info/) companion site are great resources for learning about the supported plist keys and trying out changes quickly. I wondered if there was a similar tool that could run in a terminal: on Linux I've used [chkservice](https://github.com/linuxenko/chkservice) to debug things like a botched major PostgreSQL version update (funny enough, brew [now helps](https://github.com/Homebrew/homebrew-core/pull/21244/files) you with this) across restarts and found it useful to leave in a tmux pane. Not having found a similar tool for macOS, and with the inertia one only has at 1 AM -- I thought "heeeeey, maybe we can make one!". It would also be a good excuse to learn Rust, [loved `n+1` years in a row](https://www.reddit.com/r/rust/comments/nksce4/) by the SO developer survey.

Several months of work later (and after almost giving up a few times), I ended up with [launchk](https://github.com/mach-kernel/launchk). The rest of this post will go over: getting started, interfacing with `launchd`, and a bunch of questionable Rust FFI stuff.

#### Hello world?

To start, we somehow need to get a list of services.

While reading from `popen("/bin/launchctl", ..)` is a viable strategy, it wouldn't teach us much about the innards of how `launchctl` talks to `launchd`. We could look at the symbols used in the `launchctl` binary, but why not start from [the launchd source code](https://opensource.apple.com/tarballs/launchd/)? `launchctl.c` -> `list_cmd` seemingly has all we need and all of this stuff is available to us by including `launch.h`!

Trying to reproduce the call for listing services does not work. Error is `void *` and to be used with `vproc_strerror(vproc_err_t)`, which I don't have available in my `vproc.h`:
```c
launch_data_t list = NULL;
vproc_err_t error = vproc_swap_complex(NULL, VPROC_GSK_ALLJOBS, NULL, &resp);
if (error == NULL) {
		fprintf(stdout, "PID\tStatus\tLabel\n");
		launch_data_dict_iterate(resp, print_jobs, NULL);
}
```
```
(lldb) p error
(vproc_err_t) $0 = 0x00007fff6df967d1
```

A different API call is used if one provides a label after `launchctl list`.

```c
// Run: https://gist.github.com/mach-kernel/f25e11caf8b0601465c1215b01498292
launch_data_t msg, resp = NULL;
msg = launch_data_alloc(LAUNCH_DATA_DICTIONARY);
launch_data_dict_insert(msg, launch_data_new_string("com.apple.Spotlight"), LAUNCH_KEY_GETJOB);
resp = launch_msg(msg);
// Loop over dictionary
launch_data_dict_iterate(resp, print_job, NULL);    
```

```
$ ./launch_key_getjob_test com.apple.Spotlight
LimitLoadToSessionType: Aqua
MachServices: (cba) 0x7fbfbb504700
Label: com.apple.Spotlight
OnDemand: (cba) 0x7fff9464d490
LastExitStatus: 0
PID: 562
Program: /System/Library/CoreServices/Spotlight.app/Contents/MacOS/Spotlight
ProgramArguments: (cba) 0x7fbfbb504b70
PerJobMachServices: (cba) 0x7fbfbb5049b0
```

This looks to be what we want but there is a problem: the API is deprecated (and apparently has been so since macOS 10.9). From the header and the launchd Wikipedia page:

> There are currently no replacements for other uses of the {@link launch_msg} API, including submitting, removing, starting, stopping and listing jobs.

> The last Wayback Machine capture of the Mac OS Forge area for launchd was in June 2012,[9] and the most recent open source version from Apple was 842.92.1 in code for OS X 10.9.5. 


#### Surely there is a non-deprecated route

After some research I learned that the new releases of launchd depend on Apple's closed-source `libxpc`. [This page](http://newosxbook.com/articles/jlaunchctl.html) by the author of the Mac OS X/iOS internals book outlines a method for reading XPC calls: we have to attach and break on `xpc_pipe_routine` from where we can subsequently inspect the messages being sent. [New hardened runtime requirements](https://lapcatsoftware.com/articles/debugging-mojave.html) look at codesign entitlements -- if there is no `get-task-allow`, SIP must be enabled or the debugger won't be able to attach:

```
error: MachTask::TaskPortForProcessID task_for_pid failed: ::task_for_pid ( target_tport = 0x0103, pid = 66905, &task ) => err = 0x00000005 ((os/kern) failure)
macOSTaskPolicy: (com.apple.debugserver) may not get the taskport of (launchctl) (pid: 66905): (launchctl) is hardened, (launchctl) doesn't have get-task-allow, (com.apple.debugserver) is a declared debugger
```

Afterwards, I was able to attach, but never hit `xpc_pipe_routine`. Looking at symbols `launchctl` uses, it seems that there is a (new?) function:

```
$ nm -u /bin/launchctl | grep xpc_pipe
_xpc_pipe_create_from_port
_xpc_pipe_routine_with_flags
```

Breaking here succeeds! [x86_64 calling convention](https://github.com/cirosantilli/x86-assembly-cheat/blob/master/x86-64/calling-convention.md) in a nutshell: first 6 args go into `%rdi %rsi %rdx %rcx %r8 %r9`, and then on the stack.

```
```


[Refer to this comprehensive XPC overview](https://www.objc.io/issues/14-mac/xpc)

[Apple official XPC developer documentation](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingXPCServices.html#//apple_ref/doc/uid/10000172i-SW6-SW1)

##### Decoding the XPC Message

It's time to admit this is probably cheating and reading the docs is better, but install radare2 and go spelunking:

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

I've omitted a bunch of functions for sake of readability, but the idea looks to be the same. The majority of these helpers provide an API for building XPC data and send/recv messages. Truth is, I tried [the method outlined here](http://newosxbook.com/articles/jlaunchctl.html) re logging the XPC messages but was not able to get it working:

>Start launchctl with no arguments under lldb
>Set a breakpoint on xpc_pipe_routine
>Run with whatever request argument you want to test
>When the breakpoint hits, set another breakpoint on mach_msg
>continue on the first two hits of mach_msg - these are the setup messages of the XPC pipe
>mem read $rdi to see the content of the third message

`xpc_pipe_routine` (see pg. 11 [here](http://newosxbook.com/files/HITSB.pdf)) appears to be the boundary through which XPC messages pass. I unfortunately was not able to break at `xpc_pipe_routine`. Looking at functions in radare, there appears to be no symbol for `xpc_pipe_routine` -- only for  `xpc_pipe_routine_with_flags` -- which seems to explain what I observed. Trying that again:

```
$ lldb launchctl
(lldb) b xpc_pipe_routine_with_flags
Breakpoint 1: where = libxpc.dylib`xpc_pipe_routine_with_flags, address = 0x00007fff2008d841
(lldb) run list com.apple.Spotlight
Process 77861 launched: '/bin/launchctl' (x86_64)
* thread #1, queue = 'com.apple.main-thread', stop reason = breakpoint 1.4
    frame #0: 0x00007fff2008d841 libxpc.dylib`xpc_pipe_routine_with_flags

### a bunch of continues, for messages going to
### com.apple.logd, com.apple.system.notification_center, etc

libxpc.dylib`xpc_pipe_routine_with_flags:
->  0x7fff2008d841 <+0>: pushq  %rbp
    0x7fff2008d842 <+1>: movq   %rsp, %rbp
    0x7fff2008d845 <+4>: pushq  %r15
    0x7fff2008d847 <+6>: pushq  %r14
(lldb) p (void *) $rdi
(OS_xpc_pipe *) $14 = 0x00000001002054b0
(lldb) p (void *) $rsi
(OS_xpc_dictionary *) $15 = 0x00000001006040c0
```

`fr v` shows nothing, so we can't easily see local frame variables. x86_64 [calling convention](https://github.com/cirosantilli/x86-assembly-cheat/blob/master/x86-64/calling-convention.md) stipulates that the first 6 arguments are loaded the registers (in order): `%rdi %rsi %rdx %rcx %r8 %r9` (if there are more, they go on the stack). Going through the argument list, `lldb` shows us pointer types which are likely `xpc_pipe_t` and [`xpc_object_t` dictionary](https://developer.apple.com/documentation/xpc/xpc_object_t?language=objc).

[Thanks to this post](https://geosn0w.github.io/A-Long-Evening-With-macOS%27s-Sandbox/) for the `xpc_copy_description` trick! We are now looking at the contents of the XPC dictionary:
```
(lldb) 	
}<dictionary: 0x1005044e0> { count = 7, transaction: 0, voucher = 0x0, contents =
	"subsystem" => <uint64: 0x4bf4eb077acd526d>: 3
	"handle" => <uint64: 0x4bf4eb077acd626d>: 0
	"routine" => <uint64: 0x4bf4eb077aff926d>: 815
	"name" => <string: 0x100504590> { length = 19, contents = "com.apple.Spotlight" }
	"type" => <uint64: 0x4bf4eb077acd126d>: 7
	"legacy" => <bool: 0x7fff800410b0>: true
	"domain-port" => <mach send right: 0x100504100> { name = 1799, right = send, urefs = 5 }
```

In addition, we can access any xpc header function [documented here](https://developer.apple.com/documentation/xpc/1505740-xpc_main?language=objc) from this breakpoint.

[This presentation](https://saelo.github.io/presentations/bits_of_launchd.pdf) explains `launchd` messages have fields that work kind of like syscalls, where you give it a number that corresponds to the routine for some desired effect:

| Key       | Desc                                                       |
|-----------|------------------------------------------------------------|
| type      | [int] Domain type (see below)                              |
| handle    | ???   Handle to ???                                        |
| subsystem | [int] Function that should handle request                  |
| routine   | [int] Routine (sub-fn) that should handle request          |
| name      | [string]                                                   |
| flags     | ???                                                        |

| Domain | Desc                     |
|---|-------------------------------|
| 1 | System (1 instance / system)  |
| 2 | User (1 / login)              |
| 3 | User-login (1 / login)        |	
| 4 | Session (???)                 |
| 5 | PID (1 / process)             |
| 6 | User domain for requestor UID |
| 7 | Requestor domain              |

In theory we should be able to copy this message, send it, then wait for an XPC response with information about `com.apple.Spotlight` as demo'd at the start of the post. It's finally time for the Rust part!

#### Really, really going spelunking

IDA Free:

```
± % launchctl dumpstate uid/501 | head -10                                                                                    !10437
com.apple.xpc.launchd.domain.system = {
	type = system
	handle = 0
	active count = 659
	on-demand count = 0
	service count = 370
	active service count = 162
	activity ratio = 0.44
	maximum allowed shutdown time = 65 s
	service stats = 0
```

Search for `on-demand count = %d`
Xrefs
Xrefs
Giant switch spaghettini

## Find the right message

```
lldb launchctl
run dumpstate
b xpc_pipe_routine_with_flags
(lldb) p printf("%s",(char*)  xpc_copy_description($rsi))
<dictionary: 0x100604410> { count = 5, transaction: 0, voucher = 0x0, contents =
	"subsystem" => <uint64: 0x91e45079d2a3988d>: 3
	"handle" => <uint64: 0x91e45079d2a3a88d>: 0
	"shmem" => <shmem: 0x100604630>: 20971520 bytes (5121 pages)
	"routine" => <uint64: 0x91e45079d297888d>: 834
	"type" => <uint64: 0x91e45079d2a3b88d>: 1
expr void * $my_shmem = ((void *) xpc_dictionary_get_value($rsi, "shmem"));
```
## Continue until you see this in your frame:

```
frame #0: 0x000000010000a25f launchctl`___lldb_unnamed_symbol62$$launchctl + 331
launchctl`___lldb_unnamed_symbol62$$launchctl:
->  0x10000a25f <+331>: movq   %r15, %rdi
    0x10000a262 <+334>: movq   %rax, %rdx
    0x10000a265 <+337>: callq  0x10000ddae               ; symbol stub for: fwrite
    0x10000a26a <+342>: movq   (%rbx), %rdi
expr void * $my_region = 0; 
expr size_t $my_shsize = (size_t) xpc_shmem_map($my_shmem, &$my_region);
(lldb) p $my_shsize
(size_t) $my_shsize = 20971520
(lldb) mem read $my_region $my_region+250
0x103800000: 63 6f 6d 2e 61 70 70 6c 65 2e 78 70 63 2e 6c 61  com.apple.xpc.la
0x103800010: 75 6e 63 68 64 2e 64 6f 6d 61 69 6e 2e 73 79 73  unchd.domain.sys
0x103800020: 74 65 6d 20 3d 20 7b 0a 09 74 79 70 65 20 3d 20  tem = {..type =
0x103800030: 73 79 73 74 65 6d 0a 09 68 61 6e 64 6c 65 20 3d  system..handle =
0x103800040: 20 30 0a 09 61 63 74 69 76 65 20 63 6f 75 6e 74   0..active count
0x103800050: 20 3d 20 35 38 33 0a 09 6f 6e 2d 64 65 6d 61 6e   = 583..on-deman
0x103800060: 64 20 63 6f 75 6e 74 20 3d 20 30 0a 09 73 65 72  d count = 0..ser
0x103800070: 76 69 63 65 20 63 6f 75 6e 74 20 3d 20 33 36 39  vice count = 369
0x103800080: 0a 09 61 63 74 69 76 65 20 73 65 72 76 69 63 65  ..active service
0x103800090: 20 63 6f 75 6e 74 20 3d 20 31 35 30 0a 09 61 63   count = 150..ac
0x1038000a0: 74 69 76 69 74 79 20 72 61 74 69 6f 20 3d 20 30  tivity ratio = 0
0x1038000b0: 2e 34 31 0a 09 6d 61 78 69 6d 75 6d 20 61 6c 6c  .41..maximum all
0x1038000c0: 6f 77 65 64 20 73 68 75 74 64 6f 77 6e 20 74 69  owed shutdown ti
0x1038000d0: 6d 65 20 3d 20 36 35 20 73 0a 09 73 65 72 76 69  me = 65 s..servi
0x1038000e0: 63 65 20 73 74 61 74 73 20 3d 20 30 0a 09 63 72  ce stats = 0..cr
0x1038000f0: 65 61 74 6f 72 20 3d 20 6c 61                    eator = la
```

Found the routine matchup in the launchd binary:

```
1000256c8          if (rbx_1 == 0x22)
1000256c8              var_478 = nullptr
1000256d3              r13_1 = 0x7d
1000256d9              if (*data_10005a750 == r12_1)
1000256f1                  r13_1 = 0x16
1000256f7                  if (_xpc_dictionary_expects_reply(arg3) != 0)
100025724                      uint32_t rax_94 = *(*(r12_1 + 0x60) + 0x68)(r12_1, 4, 0, *(r12_1 + 0x68), data_10005b6e0, 0, 0)
100025727                      int64_t r14_8
100025727                      if (rax_94 != 0)
100025740                          sub_100022477(r12_1, data_10005b6e0, rax_94)
100025745                          r14_8 = 0
```

Assuming this message sent for `dumpstate`:

```
<dictionary: 0x100205620> { count = 5, transaction: 0, voucher = 0x0, contents =
	"subsystem" => <uint64: 0x920e46233afc7be9>: 3
	"handle" => <uint64: 0x920e46233afc4be9>: 0
	"shmem" => <shmem: 0x100205470>: 20971520 bytes (5121 pages)
	"routine" => <uint64: 0x920e46233ac86be9>: 834
	"type" => <uint64: 0x920e46233afc5be9>: 1
```

- The `834` corresponds to the `0x22`!

Caller from this method goes up to a function that looks like this:

```
int64_t sub_10002487b()

10002489b  *data_10005a750 = sub_100022e1c(data_10005a130, 0, 0, nullptr, 0, data_10005a820)
1000248ae  sub_1000384e8(3, sub_100024920)
1000248bf  sub_1000384e8(5, sub_1000283c4)
1000248d0  sub_1000384e8(7, sub_100028af8)
1000248e1  sub_100038628(sub_10003d56f, 0x830)
1000248f2  sub_100038628(sub_10003d5dc, 0x2c)
10002490c  int64_t rax_2 = _host_set_special_port(zx.q(_mach_host_self()), 0x16, zx.q(*data_10005a768), data_10005a768)
100024911  if (rax_2.d != 0)
100024919      rax_2 = sub_10003f04a(rax_2.d)
100024916  return rax_2

```

`3,5,7` subroutines?

#### Obtaining a connection

According to the Apple docs, our workflow would look something like this:

- [`dispatch_queue_create`](https://developer.apple.com/documentation/dispatch/1453030-dispatch_queue_create?language=occ) to make a new queue for our event handler to consume.
- [`xpc_connection_create_mach_service`](https://developer.apple.com/documentation/xpc/xpc_connection_mach_service_privileged?language=objc) to register a Mach service and our new queue.
- [`xpc_connection_set_event_handler`](https://developer.apple.com/documentation/xpc/1448805-xpc_connection_set_event_handler?language=objc) to bind a block you want to invoke for every message.

Unfortunately, the small prototype we made didn't work as expected:
```
$ cargo run
Adding legacy <bool: 0x7fff800410b0>: true
Adding subsystem <int64: 0xfc650c92f304f85d>: 3
Adding handle <int64: 0xfc650c92f304c85d>: 0
Adding type <int64: 0xfc650c92f304b85d>: 7
Adding routine <int64: 0xfc650c92f336385d>: 815
Adding name <string: 0x7ffd38d045c0> { length = 19, contents = "com.apple.Spotlight" }
Sending <dictionary: 0x7ffd38d04840> { count = 6, transaction: 0, voucher = 0x0, contents =
	"handle" => <int64: 0xfc650c92f304c85d>: 0
	"subsystem" => <int64: 0xfc650c92f304f85d>: 3
	"routine" => <int64: 0xfc650c92f336385d>: 815
	"name" => <string: 0x7ffd38d045c0> { length = 19, contents = "com.apple.Spotlight" }
	"type" => <int64: 0xfc650c92f304b85d>: 7
	"legacy" => <bool: 0x7fff800410b0>: true
}
Received message! <dictionary: 0x7fff800415e0> { count = 1, transaction: 0, voucher = 0x0, contents =
	"XPCErrorDescription" => <string: 0x7fff80041748> { length = 18, contents = "Connection invalid" }
}
```

The message is _almost_ the same, but it is missing one piece: `"domain-port" => <mach send right: 0x100504100>`. Attempting to break on any of the 3 aforementioned functions does not work. Searching didn't yield an awful lot of information, so let's do the only thing we can. What if we set breakpoints on all of the `xpc_*` functions?

Bingo!

```
* thread #1, queue = 'com.apple.main-thread', stop reason = breakpoint 3.3
    frame #0: 0x00007fff20089542 libxpc.dylib`xpc_pipe_create_from_port
libxpc.dylib`xpc_pipe_create_from_port:
->  0x7fff20089542 <+0>: movq   %rsi, %rdx
    0x7fff20089545 <+3>: movl   %edi, %esi
    0x7fff20089547 <+5>: xorl   %edi, %edi
    0x7fff20089549 <+7>: jmp    0x7fff2009e896            ; _xpc_pipe_create
(lldb) p $rdi
(unsigned long) $27 = 1799
(lldb) p $rsi
(unsigned long) $28 = 4

* thread #1, queue = 'com.apple.main-thread', stop reason = breakpoint 6.2
    frame #0: 0x00007fff2008fa85 libxpc.dylib`xpc_dictionary_set_mach_send
libxpc.dylib`xpc_dictionary_set_mach_send:
->  0x7fff2008fa85 <+0>: pushq  %rbp
    0x7fff2008fa86 <+1>: movq   %rsp, %rbp
    0x7fff2008fa89 <+4>: pushq  %r15
    0x7fff2008fa8b <+6>: pushq  %r14
(lldb) p printf("%s",(char*)  xpc_copy_description($rdi))
}<dictionary: 0x1004042f0> { count = 2, transaction: 0, voucher = 0x0, contents =
	"handle" => <uint64: 0x74500d8f5837cc29>: 0
	"type" => <uint64: 0x74500d8f5837bc29>: 7
(lldb) p (char *) $rsi
(char *) $35 = 0x00007fff200b2018 "domain-port"
(lldb) p $rdx
(unsigned long) $6 = 1799
```

After searching for these functions, I oddly landed in the [Chromium sandbox sources](https://chromium.googlesource.com/chromium/src/+/refs/tags/61.0.3159.2/sandbox/mac/pre_exec_delegate.cc) and an [iOS CVE](https://github.com/bazad/blanket/blob/master/blanket_payload/bootstrap_port.c). After some digging, `bootstrap.h` brings with it an `extern mach_port_t bootstrap_port`: which has a value of `1799` that matches that of the XPC dictionary in the breakpoint above for `xpc_dictionary_set_mach_send`! The Chrome sources include some [private externs](https://chromium.googlesource.com/chromium/src/+/refs/tags/61.0.3159.2/sandbox/mac/xpc.h) too, giving us more API documentation:

```c
void xpc_dictionary_set_mach_send(xpc_object_t dictionary,
                                  const char* name,
                                  mach_port_t port);
```

#### Figuring out the EIO

- b `_xpc_pipe_routine` in the Rust program
	 - xpc_get_type
	 - mig_get_reply_port
	 - thread_get_special_reply_port
	 - _xpc_pipe_pack_message
	 - _xpc_serializer_get_mach_message_header
	 - voucher_mach_msg_set
	 - _xpc_serializer_get_mach_message_length
	   - 176, so it gets serialized
	 - _xpc_pipe_mach_msg
	   - 0, so pipe OK?
	 - 

#### Hello world from Rust

Now, to put all the pieces together!

##### FFI Plumbing

[bindgen](https://rust-lang.github.io/rust-bindgen/) can take C headers and generate Rust bindings. According to the manual (and a friend), the bindings should best go in their own crate. Our project setup is going to be a Rust workspace with two packages: `launchk` and `xpc-bindgen`.

The docs recommend making a `wrapper.h` file that imports the desired headers (which are then used by bindgen). Crate [xcrun](https://crates.io/crates/xcrun) has some nice sugar for getting macOS SDK paths, so instead we can reference `xpc.h` directly in our `build.rs`:

```rust
static MACOS_INCLUDE_PATH: &str = "/usr/include";

fn main() {
    let sdk_path = xcrun::find_sdk(SDK::macOS(None))
        .and_then(|pb| pb.to_str().map(String::from))
        .and_then(|p| p.strip_suffix("\n").map(String::from))
        .expect("macOS SDK Required");

		// xpc methods
		let xpc_path = format!("{}{}/xpc/xpc.h", sdk_path, MACOS_INCLUDE_PATH);
		// bootstrap_port
    let bootstrap_path = format!("{}{}/bootstrap.h", sdk_path, MACOS_INCLUDE_PATH);

    let bindings = bindgen::Builder::default()
        .header(xpc_path)
        .header(bootstrap_path)
        .parse_callbacks(Box::new(bindgen::CargoCallbacks))
        .generate()
        .expect("Unable to generate bindings");

    let out_path = PathBuf::from(env::var("OUT_DIR").unwrap());
    bindings
        .write_to_file(out_path.join("bindings.rs"))
        .expect("Couldn't write bindings!");
}
```

`lib.rs` should only need:

```rust
include!(concat!(env!("OUT_DIR"), "/bindings.rs"));
```

In our other crate's `Cargo.toml` we add it as a dependency:

```
xpc-bindgen = { path="../xpc-bindgen" }
```

If you did everything correctly, you should now have all of the xpc symbols available in Rust:

![](https://i.imgur.com/gA0ObCLl.png)


##### XPC Plumbing

##### XPC Plumbing Failed

TODO: figure out

The first two pieces are fairly straightforward:

```rust
static APP_ID: &str = "com.dstancu.fun";

fn main() {
    let app_id_cstr = CString::new(APP_ID)
        .unwrap()
        .into_boxed_c_str()
        .as_ptr();

    let queue = unsafe {
        dispatch_queue_create(app_id_cstr, null_mut())
    };

    let connection: xpc_connection_t = unsafe {
        xpc_connection_create_mach_service(
						app_id_cstr,
						queue,
						XPC_CONNECTION_MACH_SERVICE_PRIVILEGED as u64
        )
    };
}
```

Earlier we noted that `xpc_connection_set_event_handler` takes a block; the FFI manual recommends pulling in [`block`](https://crates.io/crates/block) crate. I wonder if there is a way to get a pointer to a Rust block, considering `bindgen` uses `*mut c_void` (i.e. `void*`) as the type:

It was a considerable struggle to figure out how to get the tricky `handler` cast to work, but managed to fish a working example out of [the tests](https://github.com/SSheldon/rust-block/blob/master/src/test_utils.rs). 

```rust
pub type xpc_handler_t = *mut ::std::os::raw::c_void;

let handler = ConcreteBlock::new(move |obj: xpc_object_t| {
		println!("Received message!");
		unsafe {
				let raw_desc: *mut c_char = xpc_copy_description(obj);
				println!("{}", CString::from_raw(raw_desc).to_str().unwrap());
		}
});
let handler = handler.copy();
	
// Register handler
unsafe {
		xpc_connection_set_event_handler(connection, &*handler as *const _ as *mut _);
}
```

Running our program so far doesn't cause any errors! Time to move on to sending the message. We need to create an XPC dictionary using [`xpc_dictionary_create`](https://developer.apple.com/documentation/xpc/1505363-xpc_dictionary_create?language=objc), which expects all k/v up-front:

```
```

