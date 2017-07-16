---
title: Breaking API change, except in C apparently
published: true
layout: post
categories: foss
date: 2017-07-16T14:21:37Z
blurb: If anyone other than this reads my page, they'll know that I rarely have time to make blog entries. Every time I do have something neat to write about, I always feel discouraged by the theme that I'm using because of CSS glitches or ridiculously large background textures (although, this is my fault too). I decided that since I'm still technically on vacation up until today, that I might build my own page. 
---

Today I finally got some time to do maintenance work on one of my side-projects, but immediately was greeted with this while trying to do something locally...

```bash
FFI::NotFoundError: Function 'err_set_debug_level' not found in [libsphinxbase.dylib] /Users/mach/.rbenv/versions/2.4.0/lib/ruby/gems/2.4.0/gems/ffi-1.9.18/lib/ffi/library.rb:275:in `attach_function' /Users/mach/Workspace/pocketsphinx-ruby/lib/pocketsphinx/api/sphinxbase.rb:22:in `<module:Sphinxbase>'
```

API changes are not something I immediately consider when working on C libraries that are [implementing something from the late 70s, with libraries that began to be authored in the early 2000s](https://en.wikipedia.org/wiki/CMU_Sphinx). Generally, one would get this kind of error when they install an old version (e.g. the FFI tries to bind to some interface element that does not exist), so I spent 40 minutes attempting to fix my installation because I installed an old version from `brew` initially before installing the correct one. I thought I had caught on by unlinking and installing the correct version, but I go through this procedure again because maybe I forgot something. Built it from source and got the same result. 

OK -- time to trace through and see what's going on over here. Here's a copy of `sphinxbase.rb`:

```ruby
module Pocketsphinx
  module API
    module Sphinxbase
      extend FFI::Library
      ffi_lib "libsphinxbase"

      class Argument < FFI::Struct
        layout :name, :string,
          :type, :int,
          :deflt, :string,
          :doc, :string
      end

      # TODO: Document on ruby side?
      attach_function :cmd_ln_parse_r, [:pointer, :pointer, :int32, :pointer, :int], :pointer
      attach_function :cmd_ln_float_r, [:pointer, :string], :double
      attach_function :cmd_ln_set_float_r, [:pointer, :string, :double], :void
      attach_function :cmd_ln_int_r, [:pointer, :string], :int
      attach_function :cmd_ln_set_int_r, [:pointer, :string, :int], :void
      attach_function :cmd_ln_str_r, [:pointer, :string], :string
      attach_function :cmd_ln_set_str_r, [:pointer, :string, :string], :void
      # L22: attach_function :err_set_debug_level, [:int], :int
      attach_function :err_set_logfile, [:string], :int
      attach_function :err_set_logfp, [:pointer], :void
    end
  end
end
```

L22 shows that we're supposed to bind to `err_set_debug_level(int)`. Time to head over to the GitHub repo for `sphinxbase`. The first thing I notice, [is this commit](https://github.com/cmusphinx/sphinxbase/commit/69c473ca648b8e2f8e453f27a405107a245bbcdd):

![bingo](http://i.imgur.com/8Mgn4Ce.png)

[Pull request is open here](https://github.com/watsonbox/pocketsphinx-ruby/pull/28) to fix the issue. Time to point my project at my local branch and get back to it. 
