---
title: "Baby's first Rust...with FFI and launchd?!"
published: true
layout: post
categories: macos rust ffi xpc ncurses
date: 2021-01-02T21:47:44-05:00
---

A few months ago I [read a comment](https://news.ycombinator.com/item?id=2565458) on a HN post about GNOME/systemd (part of someone's "zomg systemd is ruining everything" campaign in a chatroom). I learned a cool tidbit of information: apparently systemd was inspired by Apple's launchd. Having subsequently fallen into a wiki-hole about init systems, I began to play with `launchctl` on my local machine. Turns out that launchd does some pretty cool things: the `*.plist` describing a job can do more than just specify its arguments! For example, the `QueueDirectories` key lets you spawn jobs when files are added to a directory (how useful!). I was oblivious to this having interacted with launchd the past years mostly via `brew services`.

[soma-zone's LaunchControl](https://www.soma-zone.com/LaunchControl/) and [launchd.info](https://www.launchd.info/) companion site are great resources for learning about the supported plist keys and trying out changes quickly. I wondered if there was a similar tool that could run in a terminal: on Linux I've used [chkservice](https://github.com/linuxenko/chkservice) to debug things like a botched `pg_upgrade` (funny enough, brew [now helps](https://github.com/Homebrew/homebrew-core/pull/21244/files) you with this) across restarts and found it useful to leave in a tmux pane. Not having found a similar tool for macOS, and with the inertia one only has at 1 AM -- I thought "heeeeey, maybe we can make one!". It would also be a good excuse to learn Rust, [loved `n+1` years in a row](https://www.reddit.com/r/rust/comments/nksce4/) by the SO developer survey.

Several months of work later (and after almost giving up a few times), I ended up with [launchk](https://github.com/mach-kernel/launchk). The rest of this post will go over: getting started, interfacing with `launchd`, a lot of macOS IPC bits, getting stuck, and a bunch of questionable Rust FFI stuff.

#### Hello world?

To start, we somehow need to get a list of services.

While reading from `popen("/bin/launchctl", ..)` is a viable strategy, it wouldn't teach us much about the innards of how `launchctl` talks to `launchd`. We could look at the symbols used in the `launchctl` binary, but why not start from [the launchd source code](https://opensource.apple.com/tarballs/launchd/)? `launchctl.c` -> `list_cmd` seemingly has all we need and all of this stuff is available to us by including `launch.h`!

Trying to reproduce the call for listing services does not work. Error is `void *` and to be used with `vproc_strerror(vproc_err_t)`, which I don't have in my `vproc.h`:
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
// Run full file: https://gist.github.com/mach-kernel/f25e11caf8b0601465c1215b01498292
launch_data_t msg, resp = NULL;
msg = launch_data_alloc(LAUNCH_DATA_DICTIONARY);
launch_data_dict_insert(msg, launch_data_new_string("com.apple.Spotlight"), LAUNCH_KEY_GETJOB);
resp = launch_msg(msg);
// Loop over dictionary
launch_data_dict_iterate(resp, print_job, NULL);    
```

```bash
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

After some more reading I learned that the new releases of launchd depend on Apple's closed-source `libxpc`. [Jonathan Levin's post](http://newosxbook.com/articles/jlaunchctl.html) outlines a method for reading XPC calls: we have to attach and break on `xpc_pipe_routine` from where we can subsequently inspect the messages being sent. [New hardened runtime requirements](https://lapcatsoftware.com/articles/debugging-mojave.html) look at codesign entitlements -- if there is no `get-task-allow`, SIP must be enabled or the debugger won't be able to attach:

```
error: MachTask::TaskPortForProcessID task_for_pid failed: ::task_for_pid ( target_tport = 0x0103, pid = 66905, &task ) => err = 0x00000005 ((os/kern) failure)
macOSTaskPolicy: (com.apple.debugserver) may not get the taskport of (launchctl) (pid: 66905): (launchctl) is hardened, (launchctl) doesn't have get-task-allow, (com.apple.debugserver) is a declared debugger
```

Afterwards, I was able to attach, but never hit `xpc_pipe_routine`. Looking at symbols `launchctl` uses, it seems that there is a (new?) function:

```bash
$ nm -u /bin/launchctl | grep xpc_pipe
_xpc_pipe_create_from_port
_xpc_pipe_routine_with_flags
```

Breaking on `xpc_pipe_routine_with_flags` succeeds! [x86_64 calling convention](https://github.com/cirosantilli/x86-assembly-cheat/blob/master/x86-64/calling-convention.md) in a nutshell: first 6 args go into `%rdi %rsi %rdx %rcx %r8 %r9`, and then on the stack (see link for various edge cases like varadic functions). From the `launjctl` post above, we can use `xpc_copy_description` to get human-readable strings re what is inside an XPC object. [Some searching](https://grep.app/search?q=xpc_pipe_routine_with_flags) also found us the function signature!

```c
int xpc_pipe_routine_with_flags(xpc_pipe_t pipe, xpc_object_t request, xpc_object_t *reply, uint32_t flags);
```

```
(lldb) b xpc_pipe_routine_with_flags
(lldb) run list com.apple.Spotlight
* thread #1, queue = 'com.apple.main-thread', stop reason = breakpoint 1.2
    frame #0: 0x00007fff2005e841 libxpc.dylib`xpc_pipe_routine_with_flags
libxpc.dylib`xpc_pipe_routine_with_flags:
->  0x7fff2005e841 <+0>: pushq  %rbp
(lldb) p (void *) $rdi
(OS_xpc_pipe *) $3 = 0x00000001002054b0
(lldb) p (void *) $rsi
(OS_xpc_dictionary *) $4 = 0x0000000100205df0
(lldb) p (void *) *((void **) $rdx)
(void *) $6 = 0x0000000000000000
(lldb) p $rcx
(unsigned long) $8 = 0
(lldb) p printf("%s",(char*)  xpc_copy_description($rsi))
}<dictionary: 0x100205dd0> { count = 7, transaction: 0, voucher = 0x0, contents =
	"subsystem" => <uint64: 0x473e37446dfc3ead>: 3
	"handle" => <uint64: 0x473e37446dfc0ead>: 0
	"routine" => <uint64: 0x473e37446dcefead>: 815
	"name" => <string: 0x100205c80> { length = 19, contents = "com.apple.Spotlight" }
	"type" => <uint64: 0x473e37446dfc7ead>: 7
	"legacy" => <bool: 0x7fff800120b0>: true
	"domain-port" => <mach send right: 0x100205e30> { name = 1799, right = send, urefs = 5 }
```

Not shown above are 4 continues: the prior messages likely do some other setup, but we want this object as it has our argument of `com.apple.Spotlight`. We are also interested in `xpc_object_t* reply`, which is in `$rdx` above. We can define a LLDB variable to keep track of the reply pointer while we step through:

```
(lldb) expr void** $my_reply = (void **) $rdx
(lldb) p $my_reply
(void *) $my_reply = 0x0000000000000000
```

Keep stepping if it's still null. Eventually it will point to an XPC object that we can inspect:

```
(lldb) p printf("%s",(char*)  xpc_copy_description(*((void **) $my_reply)))
<dictionary: 0x1007043f0> { count = 1, transaction: 0, voucher = 0x0, contents =
	"service" => <dictionary: 0x1007044e0> { count = 9, transaction: 0, voucher = 0x0, contents =
		"LimitLoadToSessionType" => <string: 0x1007046c0> { length = 4, contents = "Aqua" }
		"MachServices" => <dictionary: 0x100704540> { count = 2, transaction: 0, voucher = 0x0, contents =
			"com.apple.private.spotlight.mdwrite" => <mach send right: 0x1007045a0> { name = 0, right = send, urefs = 1 }
			"com.apple.Spotlight" => <mach send right: 0x100704610> { name = 0, right = send, urefs = 1 }
		}
		"Label" => <string: 0x100704750> { length = 19, contents = "com.apple.Spotlight" }
		"OnDemand" => <bool: 0x7fff800120b0>: true
		"LastExitStatus" => <int64: 0x1a74b81b7404f909>: 0
		"PID" => <int64: 0x1a74b81b741be909>: 497
		"Program" => <string: 0x100704b00> { length = 67, contents = "/System/Library/CoreServices/Spotlight.app/Contents/MacOS/Spotlight" }
		"ProgramArguments" => <array: 0x1007049b0> { count = 1, capacity = 1, contents =
			0: <string: 0x100704a40> { length = 67, contents = "/System/Library/CoreServices/Spotlight.app/Contents/MacOS/Spotlight" }
		}
		"PerJobMachServices" => <dictionary: 0x1007047f0> { count = 3, transaction: 0, voucher = 0x0, contents =
			"com.apple.tsm.portname" => <mach send right: 0x100704850> { name = 0, right = send, urefs = 1 }
			"com.apple.coredrag" => <mach send right: 0x100704910> { name = 0, right = send, urefs = 1 }
			"com.apple.axserver" => <mach send right: 0x1007048b0> { name = 0, right = send, urefs = 1 }
		}
	}
```

Looks like some of the same keys we saw from the `launch_msg` example! Better yet, we can manipulate `xpc_object_t` by importing `xpc.h` as described by [Apple's XPC Objects](https://developer.apple.com/documentation/xpc/xpc_objects?language=objc) documentation. For example, we can try to read the "ProgramArguments" key:

```
(lldb) p (void *) xpc_dictionary_get_dictionary(*((void**) $my_reply), "service");
(OS_xpc_dictionary *) $30 = 0x00000001007044e0
(lldb) expr void * $service = (void *) 0x00000001007044e0;
(lldb) p printf("%s",(char*) xpc_copy_description((void *) xpc_dictionary_get_array((void *) $service, "ProgramArguments")))
}<array: 0x1007049b0> { count = 1, capacity = 1, contents =
	0: <string: 0x100704a40> { length = 67, contents = "/System/Library/CoreServices/Spotlight.app/Contents/MacOS/Spotlight" }
```

We can create a dictionary with `xpc_dictionary_create` and populate it `xpc_dictionary_set_*`. We can read & interact with the reply. Two pieces remain:

- `xpc_pipe_routine_with_flags` requires a `xpc_pipe_t` -- how do we get one?
- What is `"domain-port" => <mach send right: 0x100205e30> { name = 1799, right = send, urefs = 5 }`? The XPC Objects docs do not mention anything about `mach send`.

PS: This procedure was used to dump several launchctl commands I wanted to use in `launchk`: [you can find them here](https://github.com/mach-kernel/launchk/blob/master/doc/launchctl_messages.md).

#### macOS IPC

Answering those questions was the first significant hurdle. This is broad and detailed topic, so I will do my best to summarize as needed. To begin with terminology: XPC and Mach ports are both IPC mechanisms. XPC is implemented atop Mach ports and provides a nice high level connections API ([`NSXPCConnection`](https://developer.apple.com/documentation/foundation/nsxpcconnection?language=objc)). launchd can also start XPC services on-demand (lazily, when messages are sent to that service) and spin them down if the system experiences load and the service is idle. It's recommended (for convenience, security) to use XPC if possible. And, as we saw above in the `XPC Objects` API docs, `xpc_object_t` can be a reference to an array, dictonary, string, etc.

On macOS, creating a new UNIX process spawns a new Mach task with a thread. A task is an execution context for one or more threads, most importantly providing paged & protected virtual memory, and access to other system resources via Mach ports. Ports are handles to kernel-managed secure IPC data structures (usually a message queue or synchronization primitive). The kernel enforces port access through rights: a send right allows you to queue a message, a receive right allows you to dequeue a message. A port has a single receiver (only one task may hold a receive right), but many tasks may hold send rights for the same port. A port is analogous to a UNIX pipe or a unidirectional channel.

Some of the special ports a new task has send rights to:

- `mach_task_self` - Manage current task virtual memory and scheduling priority
- `mach_thread_self` - Manage thread (suspend/resume/scheduling/etc)
- `mach_host_self` - Host/kernel information
- `bootstrap_port` - Bootstrap server (launchd) / "name server"

A task can only get a port by creating it or transfering send/recv rights to another task. To make things easier, in addition to its init duties, `launchd` also maintains a registry of names to Mach ports. A server can use the bootstrap port to register: `bootstrap_register(bootstrap_port, "com.foo.something", port_send)`, then subsequently another task can retrieve that send right via `bootstrap_look_up(bootstrap_port, "com.foo.something", &retrieved_send)`. To make things more confusing, `bootstrap_register` was deprecated requiring developers to implement the ["port swap dance"](https://stackoverflow.com/a/35447525/1516373) workaround: the parent task creates a new port and overrides the child task's bootstrap port, then the child task creates a new port and passes the send right to the parent, finally the parent sends the actual bootstrap port to the child (i.e. over the newly established communication channel) so it may set the bootstrap port back to its correct value. 

So, back to the question: what's an XPC pipe? From the launchctl symbols we listed above, there is a `xpc_pipe_create_from_port`. Some online digging revealed headers with the function definition and example usages in [Chromium sandbox code](https://chromium.googlesource.com/experimental/chromium/src/+/refs/wip/bajones/webvr/sandbox/mac/pre_exec_delegate.cc). So, an XPC pipe can be made from a Mach port. I am unsure how to semantically describe them: it looks to be a way to say "this Mach port can serialize XPC objects" (hopefully someone with a more meaningful explanation will let us know). At any rate, let's break on it:

```c
xpc_pipe_t xpc_pipe_create_from_port(mach_port_t port, int flags);
```

```
* thread #1, queue = 'com.apple.main-thread', stop reason = breakpoint 2.6
    frame #0: 0x00007fff2005a542 libxpc.dylib`xpc_pipe_create_from_port
libxpc.dylib`xpc_pipe_create_from_port:
->  0x7fff2005a542 <+0>: movq   %rsi, %rdx
    0x7fff2005a545 <+3>: movl   %edi, %esi
    0x7fff2005a547 <+5>: xorl   %edi, %edi
    0x7fff2005a549 <+7>: jmp    0x7fff2006f896            ; _xpc_pipe_create
(lldb) p $rdi
(unsigned long) $52 = 1799
(lldb) p $rsi
(unsigned long) $58 = 4
(lldb) p/t $rsi
(unsigned long) $57 = 0b0000000000000000000000000000000000000000000000000000000000000100
```

Conveniently, `port` and `flags` retain the same values across runs. Furthermore, the `domain-port` key sent in the dictionary for the `launchctl list` command matches the `1799` value, which represents a Mach port send right -- but to what? Trying out various odds and ends, we discover that it's the `bootstrap_port` (import `mach_init.h`), which represents a send right to launchd!

```c
// bootstrap_port: 1799
printf("bootstrap_port: %i\n", bootstrap_port);
```

Having put everything together -- success!  We see a reply that is the similar to the one we inspected in the debugger earlier, and the compiler is not screaming deprecation warnings at us anymore. Using private APIs likely isn't any better, but at least we are doing things the canonical way and having fun with it too:

```c
// Run full file: https://gist.github.com/mach-kernel/f05dcab3293f8c1c1ec218637f16ff73
xpc_pipe_t bootstrap_pipe = xpc_pipe_create_from_port(bootstrap_port, 4);
xpc_object_t list_request = xpc_dictionary_create(NULL, NULL, 0);

// Populate params
xpc_dictionary_set_uint64(list_request, "subsystem", 3);
xpc_dictionary_set_uint64(list_request, "handle", 0);
xpc_dictionary_set_uint64(list_request, "routine", 815);
xpc_dictionary_set_string(list_request, "name", "com.apple.Spotlight");
xpc_dictionary_set_uint64(list_request, "type", 7);
xpc_dictionary_set_bool(list_request, "legacy", true);
xpc_dictionary_set_mach_send(list_request, "domain-port", bootstrap_port);

xpc_object_t reply = NULL;
int err = xpc_pipe_routine_with_flags(bootstrap_pipe, list_request, &reply, 0);
```

```
bootstrap_port: 1799
XPC Response:

<dictionary: 0x7f837dd044f0> { count = 1, transaction: 0, voucher = 0x0, contents =
	"service" => <dictionary: 0x7f837dd045e0> { count = 9, transaction: 0, voucher = 0x0, contents =
		"LimitLoadToSessionType" => <string: 0x7f837dd047c0> { length = 4, contents = "Aqua" }
...
```

There is more to be discussed regarding `xpc_pipe_routine` and MIG, but at this point we have enough to build the program. We know what C headers and functions need to be used to make queries against `launchd`, and we know how to dump commands we wish to know the queries for.

#### Getting started with Rust FFI

TODO

-------

SCRATCH

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

