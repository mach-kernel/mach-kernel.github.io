---
title: "Baby's first Rust with extra steps (private APIs, launchd, and FFI)!"
published: true
layout: post
categories: macos rust ffi xpc ncurses
date: 2021-01-02T21:47:44-05:00
---

A few months ago I [read a comment](https://news.ycombinator.com/item?id=2565458) on a HN post about GNOME/systemd (part of someone's "zomg systemd is ruining everything" campaign in a chatroom). I learned a cool tidbit of information: apparently systemd was inspired by Apple's launchd. Having subsequently fallen into a wiki-hole about init systems, I began to play with `launchctl` on my local machine. Turns out that launchd does some pretty cool things: the `*.plist` describing a job can do more than just specify its arguments! For example, the `QueueDirectories` key lets you spawn jobs when files are added to a directory (how useful!). I was oblivious to this having interacted with launchd the past years mostly via `brew services`.

[soma-zone's LaunchControl](https://www.soma-zone.com/LaunchControl/) and [launchd.info](https://www.launchd.info/) companion site are great resources for learning about the supported plist keys and trying out changes quickly. I wondered if there was a similar tool that could run in a terminal: on Linux I've used [chkservice](https://github.com/linuxenko/chkservice) to debug things like a botched `pg_upgrade` (funny enough, brew [now helps](https://github.com/Homebrew/homebrew-core/pull/21244/files) you with this) across restarts and found it useful to leave in a tmux pane. Not having found a similar tool for macOS, and with the inertia one only has at 1 AM -- I thought "heeeeey, maybe we can make one!". It would also be a good excuse to learn Rust, [loved `n+1` years in a row](https://www.reddit.com/r/rust/comments/nksce4/) by the SO developer survey.

Several months later I ended up with [launchk](https://github.com/mach-kernel/launchk). The rest of this post will go over: getting started, interfacing with `launchd`, a lot of macOS IPC bits, getting stuck, and a bunch of probably questionable Rust FFI stuff.

#### Hello world?

To start, we somehow need to get a list of services.

While reading from `popen("/bin/launchctl", ..)` is a viable strategy, it wouldn't teach us much about the innards of how `launchctl` talks to `launchd`. We could look at the symbols used in the `launchctl` binary, but why not start from [the launchd source code](https://opensource.apple.com/tarballs/launchd/)? `launchctl.c` -> `list_cmd` seemingly has all we need and all of this stuff is available to us by including `launch.h`!

Trying to reproduce the call for listing services does not work. Error is `void *` and to be used with `vproc_strerror(vproc_err_t)` which I can't find in headers or symbols.

```c
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

Answering those questions was the first significant hurdle. This is broad and detailed topic, so I will do my best to summarize as needed. To begin with terminology: XPC and Mach ports are both used for IPC. XPC is implemented atop Mach ports and provides a nice high level connections API ([`NSXPCConnection`](https://developer.apple.com/documentation/foundation/nsxpcconnection?language=objc)). launchd can also start XPC services on-demand (lazily, when messages are sent to that service) and spin them down if the system experiences load and the service is idle. It's recommended (for convenience, security) to use XPC if possible. And, as we saw above in the `XPC Objects` API docs, `xpc_object_t` can be a reference to an array, dictonary, string, etc.

On macOS, creating a new UNIX process spawns a new Mach task with a thread. A task is an execution context for one or more threads, most importantly providing paged & protected virtual memory, and access to other system resources via Mach ports. Ports are handles to kernel-managed secure IPC data structures (usually a message queue or synchronization primitive). The kernel enforces port access through rights: a send right allows you to queue a message, a receive right allows you to dequeue a message. A port has a single receiver (only one task may hold a receive right), but many tasks may hold send rights for the same port. A port is analogous to a UNIX pipe or a unidirectional channel.

Some of the special ports a new task has send rights to:

- `mach_task_self` - Manage current task virtual memory and scheduling priority
- `mach_thread_self` - Manage thread (suspend/resume/scheduling/etc)
- `mach_host_self` - Host/kernel information
- `bootstrap_port` - Bootstrap server (launchd) / "name server"

A task can only get a port by creating it or transfering send/recv rights to another task. To make things easier, in addition to its init duties, `launchd` also maintains a registry of names to Mach ports. A server can use the bootstrap port to register: `bootstrap_register(bootstrap_port, "com.foo.something", port_send)`, then subsequently another task can retrieve that send right via `bootstrap_look_up(bootstrap_port, "com.foo.something", &retrieved_send)`. To make things more confusing, `bootstrap_register` was deprecated requiring developers to implement the ["port swap dance"](https://stackoverflow.com/a/35447525/1516373) workaround: the parent task creates a new port and overrides the child task's bootstrap port, then the child task creates a new port and passes the send right to the parent, finally the parent sends the actual bootstrap port to the child (i.e. over the newly established communication channel) so it may set the bootstrap port back to its correct value. 

So, back to the question: what's an XPC pipe? From the launchctl symbols we listed above, there is a `xpc_pipe_create_from_port`. Some online digging revealed headers with the function definition and example usages in [Chromium sandbox code](https://chromium.googlesource.com/experimental/chromium/src/+/refs/wip/bajones/webvr/sandbox/mac/pre_exec_delegate.cc). So, an XPC pipe can be made from a Mach port. I am unsure how to describe them: it looks to be a way to say "this Mach port can serde XPC objects"? At any rate, let's break on it:

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

Conveniently, `port` and `flags` retain the same values across runs. 1799 is the same value seen earlier for `domain-port`. If we log the `bootstrap_port` extern (`mach_init.h`), it is also 1799! Cool!

```c
// bootstrap_port: 1799
printf("bootstrap_port: %i\n", bootstrap_port);
```

Putting everything together, we see a reply that is the similar to the one inspected in the debugger earlier, plus now there are no deprecation warnings (ha):

```c
// Full: https://gist.github.com/mach-kernel/f05dcab3293f8c1c1ec218637f16ff73
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

There is more to be discussed regarding `xpc_pipe_routine` and MIG (edit: probably another post, this one is already huge), but at this point we've collected enough info to move on. We know what C headers and functions need to be used to make queries against `launchd`, and we know how to dump queries made by `launchctl`. 

#### Trying out bindgen

Our goal is to focus on getting our minimal C example into a Rust project. As a newcomer, [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=matklad.rust-analyzer) was tremendously helpful for discovering functions and API surface. Get Rust from [rustup](https://rustup.rs/). Afterwards, make a new directory, `cargo init`, then set up [bindgen](https://rust-lang.github.io/rust-bindgen/). Include the same headers as in the example C program in `wrapper.h` -- they are in the default search path and require no further setup (find where: `xcrun --show-sdk-path`). 

Let's start by including the generated bindings and putting the [type aliases](https://doc.rust-lang.org/reference/items/type-aliases.html) (for the typedef) and function declarations into place:

```rust
include!(concat!(env!("OUT_DIR"), "/bindings.rs"));

extern "C" {
    pub fn xpc_pipe_create_from_port(port: mach_port_t, flags: u64) -> xpc_pipe_t;
    pub fn xpc_pipe_routine_with_flags(
        pipe: xpc_pipe_t,
        msg: xpc_object_t,
        reply: *mut xpc_object_t,
        flags: u64,
    ) -> c_int;

    pub fn xpc_dictionary_set_mach_send(
        object: xpc_object_t,
        name: *const c_char,
        port: mach_port_t,
    );
}

pub type xpc_pipe_t = *mut c_void;
```

Things don't look terribly different. `*mut c_void` and `*const c_char` are equivalent to C `void*` and `const char*`. On to making the XPC bootstrap pipe and empty dictionary:

```rust
let bootstrap_pipe: xpc_pipe_t = unsafe {
		xpc_pipe_create_from_port(bootstrap_port, 0)
};

// pub fn xpc_dictionary_create(
// 		keys: *const *const ::std::os::raw::c_char,
// 		values: *mut xpc_object_t,
// 		count: size_t,
// ) -> xpc_object_t;

let list_request: xpc_object_t = unsafe {
		xpc_dictionary_create(null(), null_mut(), 0)
};
```

All FFI functions are unsafe: Rust can't check for memory safety issues in external libs. We need to use [unsafe Rust](https://doc.rust-lang.org/nomicon/what-unsafe-does.html) to call C functions and dereference raw pointers. `null()` and `null_mut()` give us null `*const T` and `*mut T` pointers respectively. Now, to populate the dictionary:

```rust
// Make me crash by changing to "subsystem\0"
let not_a_cstring: &str = "subsystem";
let cstring: CString = CString::new(not_a_cstring).unwrap();

unsafe {
		xpc_dictionary_set_uint64(list_request, CString::new("subsystem").unwrap().as_ptr(), 3);
}
```

There is some extra work to go from a string [slice](https://doc.rust-lang.org/book/ch04-03-slices.html) to a [`std::ffi::CString`](https://doc.rust-lang.org/std/ffi/struct.CString.html). `new()` automatically null-terminates the string and checks to see that there are no null-bytes in the payload, so it returns a `Result<CString, NulError>` that must explicitly be handled. Afterwards, we can use `as_ptr()` on the CString to get the `const *c_char` expected by `xpc_dictionary_set_uint64`.

Once the dictionary is filled we can attempt the XPC call:

```rust
// Full: https://gist.github.com/mach-kernel/5c0f78e18def295d7251ffd41083920a
let mut reply: xpc_object_t = null_mut();

let err = unsafe {
		xpc_pipe_routine_with_flags(bootstrap_pipe, list_request, &mut reply, 0)
};

if err == 0 {
		let desc = unsafe {
				CStr::from_ptr(xpc_copy_description(reply))
		};

		println!("XPC Response\n{}", desc.to_string_lossy())
} else {
		println!("Error: {}", err)
}
```

#### Trying to make it better

The goal (as I understand it) is to make an API for safe _usages_ of the bindings. A friend of mine and [Jeff Hiner's](https://medium.com/dwelo-r-d/wrapping-unsafe-c-libraries-in-rust-d75aeb283c65) post have invaluable resources (which I will quote to help me). I still have a lot of work to do on FFI etiquette! The first step as suggested by my friend was to make a `*-sys` crate for the bindings: to 

Everything revolves around `xpc_object_t`. I made a struct around it and `xpc_type_t` (get with `xpc_get_type`), to make it more convenient to check whether or not to call `xpc_int64_get_value` vs `xpc_uint64_get_value`, etc. We will talk about `Send` and `Sync` in a little bit.

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct XPCType(pub xpc_type_t);

unsafe impl Send for XPCType {}
unsafe impl Sync for XPCType {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct XPCObject(pub xpc_object_t, pub XPCType);

unsafe impl Send for XPCObject {}
unsafe impl Sync for XPCObject {}
```

I can then make XPC objects by implementing `From<T>`.

```rust
impl From<i64> for XPCObject {
    fn from(value: i64) -> Self {
        unsafe { XPCObject::new_raw(xpc_int64_create(value)) }
    }
}
```

We also want to be able to get values out of the XPC Objects. We check that the pointer is indeed an `Int64`, and only call the function if `check_xpc_type` succeeds (the function returns ``Result<(), XPCError>`, the `?` returns `Err(XPCError)` if there is a mismatch).

```rust
pub trait TryXPCValue<Out> {
    fn xpc_value(&self) -> Result<Out, XPCError>;
}

impl TryXPCValue<i64> for XPCObject {
    fn xpc_value(&self) -> Result<i64, XPCError> {
        check_xpc_type(&self, &xpc_type::Int64)?;
        let XPCObject(obj_pointer, _) = self;
        Ok(unsafe { xpc_int64_get_value(*obj_pointer) })
    }
}
```

Then, a roundtrip test, and one with a wrong type. This hopefully should keep us from hurting ourselves:

```rust
#[test]
fn xpc_value_i64() {
		let xpc_i64 = XPCObject::from(std::i64::MAX);
		let rs_i64: i64 = xpc_i64.xpc_value().unwrap();
		assert_eq!(std::i64::MAX, rs_i64);
}

#[test]
fn xpc_to_rs_with_wrong_type() {
		let xpc_i64 = XPCObject::from(42 as i64);
		let as_u64: Result<u64, XPCError> = xpc_i64.xpc_value();

		assert_eq!(
				as_u64.err().unwrap(),
				ValueError("Cannot get int64 as uint64".to_string())
		);
}
```

At first I marked my structs `Send` and `Sync` for convenience. There are criteria (quoting Jeff's post):

> You can mark your struct Send if the C code dereferencing the pointer never uses thread-local storage or thread-local locking. This happens to be true for many libraries.

> You can mark your struct Sync if all C code able to dereference the pointer always dereferences in a thread-safe manner, i.e. consistent with safe Rust. Most libraries that obey this rule will tell you so in the documentation, and they internally guard every library call with a mutex.

`xpc_type_t` seems safe enough: `xpc_get_type` returns stable pointers that can be checked against externs we can import from our bindings (e.g., this is _the_ `xpc_type_t` for arrays: `(&_xpc_type_array as *const _xpc_type_s)`). `xpc_object_t` is a pointer to a heap allocated value: an integer or string are easier to reason about, but what happens to things like XPC dictionaries?

Herein lies a brutal bug that took me forever to figure out. [`xpc_dictionary_apply`](https://developer.apple.com/documentation/xpc/1505404-xpc_dictionary_apply?language=objc) takes an `xpc_dictionary_applier_t`, which is an Objective-C block (a big thanks to [block](https://crates.io/crates/block)!) that is called for every k-v pair in the dictionary. I used this in order to try to go from an XPC dictionary to `HashMap<String, XPCObject>`. 

I kept segfaulting and could not figure out why. After all, I could log the k-vs from the block! It was frustrating and took days, until I discovered [xpc_retain](https://developer.apple.com/documentation/xpc/1505873-xpc_retain) and [xpc_release](https://developer.apple.com/documentation/xpc/1505851-xpc_release) in Apple's docs. The XPC runtime can retain and free objects. Adding a call to `xpc_retain` in the block stopped the segfaulting!

```rust
let map: Arc<RefCell<HashMap<String, Arc<XPCObject>>>> =
		Arc::new(RefCell::new(HashMap::new()));
let map_block_clone = map.clone()

let block = ConcreteBlock::new(move |key: *const c_char, value: xpc_object_t| {
		unsafe { xpc_retain(value) };
		let str_key = unsafe { CStr::from_ptr(key).to_string_lossy().to_string() };

		let xpc_object: XPCObject = value.into();
		map_block_clone
				.borrow_mut()
				.insert(str_key, xpc_object.into());

		true
});

let block = block.copy();
let ok = unsafe { xpc_dictionary_apply(object.as_ptr(), &*block as *const _ as *mut _) };
```

This is an important moment: things are happening in the system outside of whatever you're doing in lexical eyeshot that merely looks hunky dory. This means that XPCObject isn't always safe to use, because we can't always safely dereference `xpc_object_t`. It is also bad to have calls to `xpc_retain` littered around the code where their purpose isn't obvious, [something I've only recently](https://github.com/mach-kernel/launchk/pull/13) fixed by calling `xpc_retain` every time an `XPCObject` is made. Like this, I can get a better guarantee about the underlying XPCObject living until Rust drops it, where we can add an `xpc_release` call:

```rust
impl Drop for XPCObject {
    fn drop(&mut self) {
        let XPCObject(ptr, _) = self;
        unsafe { xpc_release(*ptr) }
    }
}
```

Not being explicit threw me into another roadblock that also took on the order of days to figure out. This is the same `launchctl list` XPC dictionary we have been using for all of the examples:

```rust
let mut message: HashMap<&str, XPCObject> = HashMap::new();
message.insert("type", XPCObject::from(1));
message.insert("handle", XPCObject::from(0));
message.insert("subsystem", XPCObject::from(3));
message.insert("routine", XPCObject::from(815));
message.insert("legacy", XPCObject::from(true));

let dictionary: XPCObject = XPCObject::from(message);
```

`xpc_pipe_routine` with this dictionary would cause a segfault. I logged both the XPC dictionary made in Rust and the earlier example C program. I checked to make sure that I got the routine and type _numbers_ correct but didn't check the _types_. Mind you, there exists an XPC function to make ints -- so it all worked fine until whatever received the message was unable to deserialize the key correctly.

```rust
message.insert("routine", XPCObject::from(815 as u64));
```

There is not a whole lot more from here on out. An `XPCPipeable` trait handles wrapping `xpc_pipe_routine` and surfacing errors in a `Result<XPCObject, XPCError>`, including those we get in the XPC response (try one of the earlier examples with a dummy name). `xpc_strerror` can be used both for the errno returned by the pipe function and the error codes provided in the dictionary:

```
<dictionary: 0x7fccf0604240> { count = 1, transaction: 0, voucher = 0x0, contents =
        "error" => <int64: 0x46e15ff7d31ff269>: 113
}
```

[`XPCDictionary`](https://github.com/mach-kernel/launchk/blob/master/xpc-sys/src/objects/xpc_dictionary.rs) and [`XPCShmem`](https://github.com/mach-kernel/launchk/blob/master/xpc-sys/src/objects/xpc_shmem.rs) were made for these two 'special' types of XPC objects, and a [`QueryBuilder`](https://github.com/mach-kernel/launchk/blob/master/launchk/src/launchd/query_builder.rs) to avoid repeating code that inserts the same few keys into a dictionary.

```rust
let LIST_SERVICES: XPCDictionary = XPCDictionary::new()
		.entry("subsystem", 3 as u64)
		.entry("handle", 0 as u64)
		.entry("routine", 815 as u64)
		.entry("legacy", true);

let reply: Result<XPCDictionary, XPCError> = XPCDictionary::new()
		.extend(&LIST_SERVICES)
		// Specify the domain type, or fall back on requester domain
		.with_domain_type_or_default(Some(domain_type))
		.entry_if_present("name", Some("com.apple.Spotlight"))
		.pipe_routine_with_error_handling();
```

This looks a lot better than what we started with in the first part. I don't know about "idiomatic", but I can live with it. There remains more work to be done: for example, `pipe_routine_with_error_handling` should ideally be able to take a pipe as an argument instead of blindly using the bootstrap pipe, the `XPC*` structs have public pointer members, and so on. I hope to fix these things in the coming months as I get more free time.

We shall move on, but feel free to look at [xpc-sys](https://github.com/mach-kernel/launchk/tree/master/xpc-sys) to see the end result.

#### What's in a tool?

With the XPC crate in hand we can start building the TUI. I used [Cursive](https://github.com/gyscos/cursive) because the view absractions were very easy to grok and get started with. Much of the visual layout was inspired by another TUI I use for managing Kubernetes clusters: [k9s](https://github.com/derailed/k9s). 

-------

SCRATCH SPACE

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
