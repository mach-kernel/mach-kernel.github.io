---
title: A VCS push that requires Node.JS, because 2017
published: true
layout: post
categories: foss, heroku, docker, nodejs
date: 2017-07-26T20:02:09Z
---

One of my favorite side-projects to work on is TalkBirdy, a data silo for [Dr. Byun](http://steinhardt.nyu.edu/faculty/Tara_McAllister_Byun) and her team. To make a very long story short, the API also has [some actors](http://steinhardt.nyu.edu/faculty/Tara_McAllister_Byun) that it fires off which use [CMU PocketSphinx](https://en.wikipedia.org/wiki/CMU_Sphinx#PocketSphinx) to parse audio samples they use in their research. We _have_ to use Docker since most PaaS providers either use insanely old LTS Linux images or make it impossible to set up that distribution's variant of `build-essential` so we can build PocketSphinx on every deploy. Not a big deal, and if anything we took a step in the right direction for moving to any PaaS without having to tear everything up. 


### When all of your tools complement each other's suck

ELB and Heroku have rolled Docker support. Amazon's is admittedly better, however Heroku [has a much better free tier, which really works for us](https://www.youtube.com/watch?v=sztf4hcGrB4) as our staging environment costs us literally nothing. Like Amazon, however, their Docker support is half-assed. For example, the "deploy button" in the Heroku dashboard does not work -- and deploying from CircleCI does not work either because they too use an ages old Ubuntu LTS image. Fantastic! Now you can have an old OS image with outdated dependencies everywhere. CircleCI finally replaced its fisher-price inspired config schema [with a more modern and capable concept](https://circleci.com/docs/2.0/migrating-from-1-2/), likely after receiving countless e-mails describing the same clusterfuck I'm making you aware of today. The big value add? We can now [specify a Docker container](https://circleci.com/docs/2.0/custom-images/) to run our entire CI process in.

### Making a Docker image (again)

The last time I built a container for the app was to deploy it to Heroku with the `*sphinx` libraries already installed and linked. The issue, however, remained that this image was somewhere north of 2 GB (maybe even 3?) for essentially a Ruby runtime with some C libraries and Python. Since this would have to be used for tests also, a small container was necessary and I could no longer `FROM ubuntu:latest` all my problems away. 

An hour or so later, I built the container and was satisfied with the new <500mb size, thanks to the [Alpine Linux](https://hub.docker.com/_/alpine/). It ran great. I wish I could stop writing here -- but I can't. Recall Heroku's inability to deploy your Dockerized project in the same automagical fashion that it does everything else. Recall also that this container is now what CircleCI invokes everything from, so transitively, I would have to invoke the deploy of the container from within it. With my metas at full rustle, I set off to figure this last step out. 

### Heroku + CircleCI Deployment

Before we jump into this, I'd like you to mentally guess whether or not the rest of this post involves JavaScript. At any rate, the whole deploy process is easy and looks like this. We add this to our `circle.yml` file:

```yaml
steps:
  - checkout
  ...
  - run:
      name: Deploy to Heroku
      command: |
        docker build --no-cache -t registry.heroku.com/talkbirdy-myna/worker .;
        heroku plugins:install heroku-container-registry;
        # I think I'm funny, but that's actually the API key
        docker login --email=_ --username=_ --password=${NOT_DOCKER_HEROKU_API_KEY} registry.heroku.com;
        heroku container:push worker -a talkbirdy-myna;
```

Now, before I can get this working, I need to install the [Heroku CLI tool](https://devcenter.heroku.com/articles/heroku-cli#standalone). Of course there's a Debian/Ubuntu `apt-get` sugar way into this that I can't use, but at this point it's just me being bitter about not having nice things. Since it seems that the only other way to get this thing running is to install a full Node.JS distribution. The actors that depend upon `pocketsphinx` are not a Rails app, so they do not need an ExecJS runtime, nor does anything else in that container. In short: woooooo! No node!

### Actually, yes Node

Installing the CLI tool however has taught me differently. Let's fast forward to 9:40 PM David, with a fresh container, and the fully installed Heroku CLI tool, ready for a final test before I go push and shower and turn everything in for the night:

```bash
# heroku
/usr/local/bin/heroku: line 23: /usr/local/lib/heroku/bin/node: No such file or directory
```

No way. I've used `tar` a lot and generally consider myself to not be an idiot. I was right about one thing, but it was the former. Listing through the directories shows that the tarball we downloaded from Heroku is an 800kb or so CLI tool, bundled with a ~40mb `node` binary. Why won't it work? Alpine does not use `glibc` and uses [musl](https://www.musl-libc.org/faq.html) instead. To make another excruciatingly long story short, `musl` is built using slightly more modern software practices that try to account for security holes and size -- but everybody uses `glibc`. You won't get your awesome nVidia drivers to build against `musl`, and since everybody uses `glibc` Heroku just gave us that variant. No note on their website, nothing. `musl` and `glibc` are for the most part **not** easy swap-outs for one another (although this is the goal), especially when building something as insane as V8. 

### What now

I don't remember being this angry in a long time. At any rate, no big deal, we can just use [Alpine's version of node](https://pkgs.alpinelinux.org/package/edge/main/x86_64/nodejs). After installing and rebuilding the container, `heroku-cli` greets me with its presence, only to inform me that I'm not using `node > 8.x` and that I should likely proceed with fucking myself. Apparently Heroku believes that a bunch of REST bindings need bleeding edge JavaScript optimizations, because you obviously know some product guy put up 30 user post-its in an attempt to empathize with _me_. At this point, out of desparation, I go to Docker Hub to see if there are any `alpine` based images with Heroku CLI. I notice [this guy's attempt](https://hub.docker.com/r/wingrunr21/alpine-heroku-cli/), which involves building it from source. Wondering if he too broke everything within arms reach in a fit of rage, I assemble my final container image:

```dockerfile
FROM alpine:latest
RUN apk update
RUN apk add [mostly pocketsphinx dependencies]

# Install Node from source, for Heroku, apparently
RUN git clone https://github.com/nodejs/node.git
RUN cd node && ./configure && make -j4 && make install

# Install Heroku via docs
RUN mkdir heroku
RUN mkdir -p /usr/local/lib /usr/local/bin
RUN wget https://cli-assets.heroku.com/heroku-cli/channels/stable/heroku-cli-linux-x64.tar.gz -O heroku.tar.gz
RUN tar -xvzf heroku.tar.gz
RUN mkdir -p /usr/local/lib /usr/local/bin
RUN mv heroku-cli-* /usr/local/lib/heroku
RUN ln -s /usr/local/lib/heroku/bin/heroku /usr/local/bin/heroku
RUN rm -rf /usr/local/lib/heroku/bin/node
RUN ln -s /usr/local/bin/node /usr/local/lib/heroku/bin/node
```

Since when did our desire to use cool new tools outweigh the _their entire fucking purpose as tools_? This is something people depend on! And at this point, I didn't even start building `libsphinx`. At least we're _webscale_ now, though.
