---
title: What are you working on?
published: true
layout: post
categories: PaaS
date: 2017-10-13T23:48:53.000Z
---

I haven't been writing a lot lately. I've been really busy doing some cool things behind the scenes over at [Catalyst](https://getcatalyst.io). Today I'm going to share some things that I learned the past month that might be a good fit for both fledgling software teams and more mature cross-functional digs. 

### Well?

This is an important question, and one many teams can't answer. Rather, I think that they don't understand it. Ask your co-worker, or your team before your next standup or scrum. More often than not, a reply will be either "I'm writing an endpoint/service/whatever" or some such similar technical thing. But what are you really _doing_? A lot of complex software asks can tunnel vision developers; they think of their task purely as a technical implementation and lose sight about the tangibles that their work facilitates. Engineers often think that their job is done when they finish writing their code. 

In programming circles, there is often debate about how to write unit tests. Writing sloppy tests is one of the first telling signs that a software engineer is slowly burning out or losing their mind. For example, an engineer might write a test for which they know one set of data that will automatically pass the object test, mainly because it was the example they played with in their console as they built it. In these scenarios, it's also usually likely that this small piece of test coverage also does not cover the way an object is usually used. Or maybe it does, but there is some data mapping happening with different kinds of parameters. You can think of a million hypotheticals. In this same manner, the software engineer that is only focused on the behavior of software in _their world_ without knowing the user value it delivers is still falling into this false assertion fallacy, regardless of how functionally pure & honest their tests are. 

### What we shouldn't work on

After a few months of working with my team at Catalyst, I noticed that we were spending a fair amount of time trying to groom our AWS ElasticBeanstalk environment. We are a quickly moving startup, and as a result we try (and occassionally discard) a lot of our ideas as they pertain to architecture. To make a long story short, our `staging` environment kept breaking. Broken is the wrong word; most of these things were _always_ solved in 10 minutes with a small configuration change. But is that something that we should be _working on_? That time adds up. In addition to small config changes, we also needed to maintain it. This meant rolling over certs. This meant we weren't able to use the latest version of Ruby. A lot of small frustrations.

ElasticBeanstalk, for the most part, is really just a bad CLI utility paired with some build scripts for common stacks (read: Rails, Django, Play!, whatever.js, etc.). They make assumptions about your build process that is only ever good enough for deploying a copy of the tutorial app that ships with every framework, and as a result you need to do some customization. Maybe lots of it. The aforementioned scripts are also written in a disposable fashion -- you can see that Amazon intended for you to use this as "EC2 with webhooks and stuff". I don't mean to rag on AWS. I'd just deploy Kubernetes to EC2 and call it a day, though. 

### PaaS is a workflow tool

To the consumer, it should be no surprise that Heroku does not do anything exceptionally crazy in the space that they are in. They put your app in containers, then run it on EC2. Once it is up, it is literally exactly the same like everything else that is out there. The difference, however, is in the "journey to production". 

Out of the box, it can connect to your GitHub account, and subscribe itself to webhooks for the branch of your choosing. It can also detect if your GitHub account uses one of the 999 CI solutions (all of the ones I've used before, they support). Start writing code, and it consumes those events and deploys your app once the build passes. Most importantly, it also does not promote the next version of your app indiscriminately. If you break `HEAD`, Heroku will not deploy it, even if the tests pass -- if it cannot build and stand itself, you will always have an old version to fall back on. Lastly, and our favorite, it can make review apps for specific branches when they end up in a pull request or QA queue. There are assumptions made on your behalf, but they can also be turned off and extended in a reasonable way. Rolling your own Heroku buildpack is far preferable to making a bunch of poor script edits and praying. 

All of this aforementioned stuff is possible with AWS! But why should _you_ do it? All of these things are a pain in the ass to think about, test, and implement _reliably_. In this case, _reliably_ is guaranteed because _that's what people pay for_. Large organizations can really benefit from super custom and granular CI/CD pipelines, but small startups are still testing their thesis (to [quote a friend](mattrothenberg.com)). I will even accept the argument for teams that really do _super_ custom things (i.e. you have a lot of native extensions, interface with hardware, etc.). If your product is a webapp it only makes sense to marry process and platform when you can guarantee that they can both grow together. Startups are still testing their thesis. They need to _move fast_. 

### A party trick

A software team can succeed when engineers can show laymen what it is that they are working on. The Heroku review app is a great facility for helping catalyze this kind of collaboration. If I can show my product designer _the real data_ and ask "hey, is this what you had in mind" and send more than a screenshot, then that process sets us both up for success by creating the ideal setting for collecting feedback. I can send them _the real thing_. They can interact with it, and that's important because you should only be so lucky that your end user wants to do more than just look at your product. Let's talk about a platform orchestration related thing _you should be working on_.

Heroku allows you to customize your review app deployment. They provide an environment variable called `HEROKU_APP_NAME`. This sounds useless, but they all follow the format of `/^your-app-name-[0-9]*$/`. With your shiny new regex, you can do something like this. We use a `rake` task, but you can also do a plain jane shell script, or whatever your heart desires:

```ruby
desc 'Bootstrap the thing'
task :bootstrap do
  if (ENV['HEROKU_APP_NAME'].match(/^your-app-name-[0-9]*$/))
  end
end
```

It might also be worth mentioning that [there is an API for Heroku itself](https://devcenter.heroku.com/articles/platform-api-reference). Dump the key into your environment variables, and then have a build process that is _literally_ context aware of QA, without doing any hard work. One script. 


### Parting words

My advice to the ambitious software teams out there:

Write some _realistic_ fixture data.
Write software that adds user value.
Make process that allows feedback concurrently _as a solution grows_.
Share and evaluate that software _in motion_. 
