---
title: "Baby's first Rust with extra steps (XPC, launchd, and FFI)!"
published: true
layout: post
categories: macos rust ffi xpc ncurses
date: 2021-06-15T09:47:15+0000
---

During an ongoing argument in a chatroom between some folks about how "zomg systemd is ruining everything", I decided to look at some init system history. I learned a cool tidbit of information from a HN comment[^1]: apparently systemd's design was inspired by Apple's launchd. Embarassingly, I knew little to nothing about launchd, even as a lifelong Mac user. I began to play with `launchctl` on my local machine. Turns out that launchd does some pretty cool things: the `*.plist` describing a job can do more than just specify its arguments. For example, the `QueueDirectories` key lets you spawn jobs when files are added to a directory (how useful!). I was oblivious to this having interacted with launchd the past years mostly via `brew services`. With the help of [soma-zone's LaunchControl](https://www.soma-zone.com/LaunchControl/) and [launchd.info](https://www.launchd.info/) companion site, I was able to fiddle and figure out what various plist keys did. 

[^1]: [https://news.ycombinator.com/item?id=2565458](https://news.ycombinator.com/item?id=2565458)

I wondered if there was something similar to LaunchControl that could run in a terminal. I've used [chkservice](https://github.com/linuxenko/chkservice) on Linux, but there seems to be no macOS equivalent. I've been dying for an excuse to learn a little bit of Rust (loved `n+1` years in a row by the SO developer survey[^2]) -- so this was my chance. Several months later I ended up with [launchk](https://github.com/mach-kernel/launchk). The rest of this post will go over: getting started, interfacing with `launchd`, a lot of macOS IPC bits, getting stuck, and a bunch of probably questionable Rust FFI stuff.

[^2]: [https://www.reddit.com/r/rust/comments/nksce4/](https://www.reddit.com/r/rust/comments/nksce4/)


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

After some more reading I learned that the new releases of launchd depend on Apple's closed-source `libxpc`. Jonathan Levin's post[^3] outlines a method for reading XPC calls: we have to attach and break on `xpc_pipe_routine` from where we can subsequently inspect the messages being sent. New hardened runtime requirements[^4] look at codesign entitlements -- if there is no `get-task-allow`, SIP must be enabled or the debugger won't be able to attach:

[^3]: [http://newosxbook.com/articles/jlaunchctl.html](http://newosxbook.com/articles/jlaunchctl.html)
[^4]: [https://lapcatsoftware.com/articles/debugging-mojave.html](https://lapcatsoftware.com/articles/debugging-mojave.html)


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

Breaking on `xpc_pipe_routine_with_flags` succeeds! x86-64 calling convention[^5] in a nutshell: first 6 args go into `%rdi %rsi %rdx %rcx %r8 %r9`, and then on the stack in reverse order (see link for various edge cases like varadic functions). From the `launjctl` post above, we can use `xpc_copy_description` to get human-readable strings re what is inside an XPC object. Some searching[^6] also found us the function signature!

[^5]: [https://github.com/cirosantilli/x86-assembly-cheat/blob/master/x86-64/calling-convention.md](https://github.com/cirosantilli/x86-assembly-cheat/blob/master/x86-64/calling-convention.md)
[^6]: [https://grep.app/search?q=xpc_pipe_routine_with_flags](https://grep.app/search?q=xpc_pipe_routine_with_flags)

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

Looks like some of the same keys we saw from the `launch_msg` example! Better yet, we can manipulate `xpc_object_t` by importing `xpc.h` as described by Apple's XPC Objects documentation[^7]. For example, we can try to read the "ProgramArguments" key:

[^7]: [https://developer.apple.com/documentation/xpc/xpc_objects?language=objc](https://developer.apple.com/documentation/xpc/xpc_objects?language=objc)

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

#### macOS IPC [^8] [^9] [^10]

[^8]: [https://docs.darlinghq.org/internals/macos-specifics/mach-ports.html](https://docs.darlinghq.org/internals/macos-specifics/mach-ports.html)
[^9]: [https://developer.apple.com/library/archive/documentation/Darwin/Conceptual/KernelProgramming/Mach/Mach.html](https://developer.apple.com/library/archive/documentation/Darwin/Conceptual/KernelProgramming/Mach/Mach.html)
[^10]: [https://fdiv.net/category/apple/mach-ports](https://fdiv.net/category/apple/mach-ports)

Answering those questions was the first significant hurdle. This is broad and detailed topic, so I will do my best to summarize as needed. To begin with terminology: XPC and Mach ports are both used for IPC. XPC is implemented atop Mach ports and provides a nice high level connections API ([`NSXPCConnection`](https://developer.apple.com/documentation/foundation/nsxpcconnection?language=objc)). launchd can also start XPC services on-demand (lazily, when messages are sent to that service) and spin them down if the system experiences load and the service is idle. It's recommended (for convenience, security) to use XPC if possible. And, as we saw above in the XPC Objects API docs, `xpc_object_t` can be a reference to an array, dictonary, string, etc.

On macOS, creating a process spawns a new Mach task with a thread. A task is an execution context for one or more threads, most importantly providing paged & protected virtual memory, and access to other system resources via Mach ports. Ports are handles to kernel-managed secure IPC data structures (usually a message queue or synchronization primitive). The kernel enforces port access through rights: a send right allows you to queue a message, a receive right allows you to dequeue a message. A port has a single receiver (only one task may hold a receive right), but many tasks may hold send rights for the same port. A port is analogous to a UNIX pipe or a unidirectional channel.

Some of the special ports a new task has send rights to:

- `mach_task_self` - Manage current task virtual memory and scheduling priority
- `mach_thread_self` - Manage thread (suspend/resume/scheduling/etc)
- `mach_host_self` - Host/kernel information
- `bootstrap_port` - Bootstrap server (launchd) / "name server"

A task can only get a port by creating it or transfering send/recv rights to another task. To make things easier, in addition to its init duties, `launchd` also maintains a registry of names to Mach ports. A server can use the bootstrap port to register: `bootstrap_register(bootstrap_port, "com.foo.something", port_send)`, then subsequently another task can retrieve that send right via `bootstrap_look_up(bootstrap_port, "com.foo.something", &retrieved_send)`. To make things more confusing, `bootstrap_register` was deprecated requiring developers to implement the ["port swap dance"](https://stackoverflow.com/a/35447525/1516373) workaround: the parent task creates a new port and overrides the child task's bootstrap port, then the child task creates a new port and passes the send right to the parent, finally the parent sends the actual bootstrap port to the child (i.e. over the newly established communication channel) so it may set the bootstrap port back to its correct value. 

So, back to the question: what's an XPC pipe? From the launchctl symbols we listed above, there is a `xpc_pipe_create_from_port`. Some online digging revealed headers with the function definition and example usages in [Chromium sandbox code](https://chromium.googlesource.com/experimental/chromium/src/+/refs/wip/bajones/webvr/sandbox/mac/pre_exec_delegate.cc). So, an XPC pipe can be made from a Mach port. I am unsure how to describe them: it looks to be a way to say "this Mach port can serialize XPC objects"? At any rate, let's break on it:

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

Let's start by including the generated bindings and putting the type aliases[^11] (for the typedef) and function declarations into place:

[^11]: [https://doc.rust-lang.org/reference/items/type-aliases.html](https://doc.rust-lang.org/reference/items/type-aliases.html)

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

// Make an empty dictionary (no keys, no values)
let list_request: xpc_object_t = unsafe {
    xpc_dictionary_create(null(), null_mut(), 0)
};
```

All FFI functions are unsafe: Rust can't check for memory safety issues in external libs. We need to use unsafe Rust[^12] to call C functions and dereference raw pointers. `null()` and `null_mut()` give us null `*const T` and `*mut T` pointers respectively. Now, to populate the dictionary:

[^12]: [https://doc.rust-lang.org/nomicon/what-unsafe-does.html](https://doc.rust-lang.org/nomicon/what-unsafe-does.html)

```rust
// Make me crash by changing to "subsystem\0"
let not_a_cstring: &str = "subsystem";
let key: CString = CString::new(not_a_cstring).unwrap();

unsafe {
    xpc_dictionary_set_uint64(list_request, key.as_ptr(), 3);
}
```

There is some extra work to go from a string slice[^13] to a [`std::ffi::CString`](https://doc.rust-lang.org/std/ffi/struct.CString.html). `new()` automatically null-terminates the string and checks to see that there are no null-bytes in the payload, so it returns a `Result<CString, NulError>` that must explicitly be handled. Afterwards, we can use `as_ptr()` on the CString to get the `const *c_char` expected by `xpc_dictionary_set_uint64`.

[^13]: [https://doc.rust-lang.org/book/ch04-03-slices.html](https://doc.rust-lang.org/book/ch04-03-slices.html)

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

The goal (as I understand it) is to make an API for safe _usages_ of the bindings. Advice from a friend of mine, and Jeff Hiner's post[^14] have been invaluable resources. I still have a lot of work to do on FFI etiquette! It was suggested to me to move all the bindings to a `*-sys` crate, so I started with that.

[^14]: [https://medium.com/dwelo-r-d/wrapping-unsafe-c-libraries-in-rust-d75aeb283c65](https://medium.com/dwelo-r-d/wrapping-unsafe-c-libraries-in-rust-d75aeb283c65)

Everything revolves around `xpc_object_t`. I made a struct around it and `xpc_type_t` (get with `xpc_get_type`) to make it more convenient to check whether or not to call `xpc_int64_get_value` vs `xpc_uint64_get_value`, etc.

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

We also want to be able to get values out of the XPC Objects. We check that the pointer is indeed an XPC int64, and only call the function if `check_xpc_type` succeeds (the function returns `Result<(), XPCError>`, the `?` returns `Err(XPCError)` if there is a mismatch).

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

To be honest, I marked the structs `Send` and `Sync` out of convenience, but there are criteria (quoting Jeff's post):

> You can mark your struct Send if the C code dereferencing the pointer never uses thread-local storage or thread-local locking. This happens to be true for many libraries.

> You can mark your struct Sync if all C code able to dereference the pointer always dereferences in a thread-safe manner, i.e. consistent with safe Rust. Most libraries that obey this rule will tell you so in the documentation, and they internally guard every library call with a mutex.

`xpc_type_t` seems safe enough: `xpc_get_type` returns stable pointers that can be checked against externs we can import from our bindings (e.g., this is _the_ `xpc_type_t` for arrays: `(&_xpc_type_array as *const _xpc_type_s)`). `xpc_object_t` is a pointer to a heap allocated value: an integer or string are easier to reason about, but what happens to things like XPC dictionaries?

Herein lies a brutal segfault that took a while to figure out. [`xpc_dictionary_apply`](https://developer.apple.com/documentation/xpc/1505404-xpc_dictionary_apply?language=objc) takes an `xpc_dictionary_applier_t`, which is an Objective-C block (a big thanks to the block[^15] crate!) that is called for every k-v pair in the dictionary. I used this in order to try to go from an XPC dictionary to `HashMap<String, XPCObject>`. 

[^15]: [https://crates.io/crates/block](https://crates.io/crates/block)

The `xpc_dictionary_apply` and related manpages[^16] [^17] made mention of retain and release, which led to these two functions: [xpc_retain](https://developer.apple.com/documentation/xpc/1505873-xpc_retain), [xpc_release](https://developer.apple.com/documentation/xpc/1505851-xpc_release). They increase/decrease the reference count of the XPC object (in a manner similar to Rust's Arc). I tested calling `xpc_retain` before inserting into the map, thinking the value did not live long enough:

[^16]: [https://www.manpagez.com/man/3/xpc_dictionary_create/](https://www.manpagez.com/man/3/xpc_dictionary_create/)
[^17]: [https://www.manpagez.com/man/3/xpc_object/](https://www.manpagez.com/man/3/xpc_object/)

```rust
let block = ConcreteBlock::new(move |key: *const c_char, value: xpc_object_t| {
    unsafe { xpc_retain(value) };
    let str_key = unsafe { CStr::from_ptr(key).to_string_lossy().to_string() };

    let xpc_object: XPCObject = value.into();
    map_refcell
        .borrow_mut()
        .insert(str_key, xpc_object.into());

    true
});

// https://github.com/SSheldon/rust-block#creating-blocks
let block = block.copy();
let ok = unsafe { xpc_dictionary_apply(object.as_ptr(), &*block as *const _ as *mut _) };
```

This fixed the segfault! Aftewards, it made sense to also implement `Drop` to clean up after objects we no longer need:

```rust
impl Drop for XPCObject {
    fn drop(&mut self) {
        let XPCObject(ptr, _) = self;
        unsafe { xpc_release(*ptr) }
    }
}
```

All felt very motivating but missed the mark. I [littered unsafe code](https://github.com/mach-kernel/launchk/blob/e7da7809c93f72f0b4f0702a8651d27b910a4bee/launchk/src/launchd/query.rs#L150) in application logic thinking I was "fixing segfaults" but was approaching the problem incorrectly (and -- just because it ran 🤦). Our goal is to provide a safe API: the `XPCObject` wrapper is not always safe to use (nor the `xpc_object_t` it carries safe to dereference). There was another problem too:

![](https://i.imgur.com/3ywkEFYh.png)

There's a memory leak, or better yet, about 5k new leaks every 10 seconds. The solution was to be as explicit as possible about which ways XPC object pointers make it into `XPCObject`. It is probably not wise to play with reference counts for objects we did not make -- so the new strategy was to use [`xpc_copy`](https://developer.apple.com/documentation/xpc/1505584-xpc_copy?language=objc) to get deep copies of XPC objects we wanted to place in Rust structs. A second way in would be via `xpc_etc_create` functions. Knowing where these places are allows us to do some logging (ps: thanks for ref count offsets Fortinet [^18]):

[^18]: [https://www.fortinet.com/blog/threat-research/a-look-into-xpc-internals--reverse-engineering-the-xpc-objects](https://www.fortinet.com/blog/threat-research/a-look-into-xpc-internals--reverse-engineering-the-xpc-objects)

```
[INFO  xpc_sys::objects::xpc_object] XPCObject new (0x7f804f60ea10, string, refs 1 xrefs 0)
[INFO  xpc_sys::objects::xpc_object] XPCObject new (0x6ba154c65adfac3d, int64, refs ???)
[INFO  xpc_sys::objects::xpc_object] XPCObject drop (0x7f804f60ea10, string, refs 1 xrefs 0)
[INFO  xpc_sys::objects::xpc_object] XPCObject drop (0x6ba154c65adfac3d, int64, refs ???)
[INFO  xpc_sys::objects::xpc_object] XPCObject drop (0x7f804f60e7b0, string, refs 1 xrefs 0)
```

With this, we can figure out if our create/drop counts match:
```bash
$ grep 'XPCObject new' log.txt | wc -l
  193472
$ grep 'XPCObject drop' log.txt | wc -l
  193448
```

Close enough (24) -- there were probably some live objects before exiting (?). Nice and flat, that's what we want to see! And much more significantly -- no more `unsafe` in application code.

![](https://i.imgur.com/AzVABxih.png)


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

`xpc_pipe_routine` with this dictionary would cause a segfault. I logged both the XPC dictionary made in Rust and the earlier example C program. I checked to make sure that I got the routine and type _numbers_ correct but didn't check the _types_. Mind you, there exists an XPC function to make ints -- so it all worked fine until whatever received the message was unable to deserialize the key correctly. Adding `as u64` to get a `uint64` XPC object was the fix:

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

This looks a lot better than what we started with in the first part. I don't know about idiomatic, but I can live with it. There remains more work to be done: for example, `pipe_routine_with_error_handling` should ideally be able to take a pipe as an argument instead of blindly using the bootstrap pipe, the `XPC*` structs have public pointer members, and you can still make an `XPCObject` from any `xpc_object_t`. I hope to fix these things in the coming months as I get more free time and learn how to do so properly.

We shall move on, but feel free to look at [xpc-sys](https://github.com/mach-kernel/launchk/tree/master/xpc-sys) to see the end result.

#### Making a TUI

I used [Cursive](https://github.com/gyscos/cursive) because the view absractions were very easy to grok and get started with. Much of the visual layout was inspired by another TUI I use for managing Kubernetes clusters: [k9s](https://github.com/derailed/k9s). I like the omnibox-style interface. It seems reasonable to encode all of the tricky-key-combos bits into one component, then have it send semantically meaningful updates (e.g. a command was submitted). `View`s can implement `OmniboxSubscriber`, and `OmniboxSubscribedView` is kind of a hack so I can go from `&mut dyn View` to `&mut OmniboxSubscribedView` (to have `on_omnibox` available):

```rust
pub trait OmniboxSubscriber: View {
    fn on_omnibox(&mut self, cmd: OmniboxEvent) -> OmniboxResult;
}

// This is here so we can do view.as_any_mut().downcast_mut::<OmniboxSubscribedView>()
pub trait Subscribable: View + OmniboxSubscriber {
    fn subscribable(self) -> OmniboxSubscribedView
    where
        Self: Sized,
    {
        OmniboxSubscribedView::new(self)
    }
}
```

I chose a [`LinearLayout`](https://docs.rs/cursive/0.8.1/cursive/views/struct.LinearLayout.html) as my root container. Only one child can be focused at a time in a `LinearLayout` which seems reasonable: we invoke `on_omnibox` for only that child. [tokio](https://github.com/tokio-rs/tokio) futures with an interval were used to keep polling the XPC endpoint that returned the list of services (so we can see things as they pop on or off).

Past this point the rest of the challenges were related to `launchd`. For example, the `type` key in the XPC message changes with the desired target domain for a given service. The `type` key is required when both starting and stopping a service. bits of launchd[^19] was useful and helped clarify what domains each of the types mapped to. To find services, it was easy to query for every `type` key and return the first match. However, when they are not running, how do we know which one to choose? I was not able to figure this out and settled on a prompt:

[^19]: [https://saelo.github.io/presentations/bits_of_launchd.pdf](https://saelo.github.io/presentations/bits_of_launchd.pdf)

![](https://i.imgur.com/UApPbOpm.png)

Similarly, it would be nice to filter out services that are enabled and disabled. `launchctl dumpstate` includes this information, so I thought it would be easy to do the same as before (grab the info out of an XPC dictionary). The dumpstate endpoint takes an [XPC shmem](https://developer.apple.com/documentation/xpc/1505369-xpc_shmem_map?language=objc) object that will be populated with the reply after the call. It took me a little while to understand how to work with shmems, only to finally look inside and find: a giant string. The same one you see when running `launchctl dumpstate`. Fun!

```
(lldb) b xpc_pipe_routine_with_flags
(lldb) p printf("%s",(char*)  xpc_copy_description($rsi))
<dictionary: 0x100604410> { count = 5, transaction: 0, voucher = 0x0, contents =
	"subsystem" => <uint64: 0x91e45079d2a3988d>: 3
	"handle" => <uint64: 0x91e45079d2a3a88d>: 0
	"shmem" => <shmem: 0x100604630>: 20971520 bytes (5121 pages)
	"routine" => <uint64: 0x91e45079d297888d>: 834
	"type" => <uint64: 0x91e45079d2a3b88d>: 1
(lldb) expr void * $my_shmem = ((void *) xpc_dictionary_get_value($rsi, "shmem"));
(lldb) expr void * $my_region = 0; 
(lldb) expr size_t $my_shsize = (size_t) xpc_shmem_map($my_shmem, &$my_region);
(lldb) p $my_shsize
(size_t) $my_shsize = 20971520
(lldb) mem read $my_region $my_region+250
0x103800000: 63 6f 6d 2e 61 70 70 6c 65 2e 78 70 63 2e 6c 61  com.apple.xpc.la
0x103800010: 75 6e 63 68 64 2e 64 6f 6d 61 69 6e 2e 73 79 73  unchd.domain.sys
0x103800020: 74 65 6d 20 3d 20 7b 0a 09 74 79 70 65 20 3d 20  tem = {..type =
0x103800030: 73 79 73 74 65 6d 0a 09 68 61 6e 64 6c 65 20 3d  system..handle =
0x103800040: 20 30 0a 09 61 63 74 69 76 65 20 63 6f 75 6e 74   0..active count
0x103800050: 20 3d 20 35 38 33 0a 09 6f 6e 2d 64 65 6d 61 6e   = 583..on-deman
```

Some other XPC endpoints (`dumpjpcategory`) take UNIX fds and are used in a similar manner. Not really knowing how to safely parse the string, or if I can get structured data out in any other way, I decided to forward the output to a `$PAGER`. Most if not all other requests have responses with useful keys inside an XPC dictionary, so this is far from a complaint! :)

Other 'weirdness' circles around error semantics. For example, on Catalina, I get the following err invoking `xpc_pipe_routine` (the dialog calls `xpc_strerror` for human-readable messages) as a part of the `reload` command:

![](https://i.imgur.com/wthF2Chm.png)

On Big Sur, there is no err response unless the failure is critical. I wonder if it's configurable. From here on out was feature work: I tried to focus on stuff I wanted like search and filtering. I made some TUI components, a `TableView` out of a [`SelectView`](https://docs.rs/cursive/0.8.2/cursive/views/struct.SelectView.html), and the little `[sguadl]` filter inside the omnibox. 

#### A great way to spend a few months

At work, most of my day is spent on web services. My C is terrible; I live for the nursery. To have gotten to a place where everything works feels great! And fights with the borrow checker were all good opportunities to learn how to write better code. I mean it: I am not great at paying attention. It feels so much more accessible to get build errors instead of undefined behavior that can go unnoticed. And honestly, with stuff in `std::sync` you don't have to be a genius to attempt a quick fix. Thanks very much to the work done by others in links scattered throughout this post, it made this possible for me to try on my own! I hope to keep rhythm with learning to write better Rust code. There is one resounding message, though: the hype is real! :)
