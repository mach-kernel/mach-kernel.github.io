---
title: skemata, a JSON-LD DSL
published: true
layout: post
categories: foss
date: 2017-04-17T19:16:52.000Z
blurb: Without going into too much detail, a lot of how my employer makes money is related to their SEO rankings. Placing [schema.org dichotomies](https://schema.org/docs/full.html) in your page allows search engines to crawl and recognize data that you are presenting. 
---
## I made a JSON LD builder thing

Without going into too much detail, a lot of how my employer makes money is related to their SEO rankings. Placing [schema.org dichotomies](https://schema.org/docs/full.html) in your page allows search engines to crawl and recognize data that you are presenting. For example, [this credit card review](https://www.mybanktracker.com/credit-cards/expert-reviews/fidelity-rewards-visa-signature-card-review-254403) on our site can now be understood by Google, so our search engine listings display as...

![Screen Shot 2017-04-17 at 14.53.50.png]({{site.baseurl}}/_posts/Screen Shot 2017-04-17 at 14.53.50.png)

### Skemata

This is a quick little Hash-builder DSL that I made for creating schema.org types. Our code had far too many inline'd hashes that were cluttered with null-checks and conditional waterfall spaghetti; if `skemata` doesn't find a value it will just display `null` for that key. 

[You can find the library here](https://github.com/mybanktracker/skemata)

#### Usage
Let's make a schema.org object for a book. It doesn't have to be complete. 

_Obvious note that you would probably use some kind of repository record not in blog-post land._

<script src="https://gist.github.com/mach-kernel/5f71dfb2f73e7fad4b8e0cbdb5e1a463.js"></script>

#### Not done yet

I decided to roll this into a library because other JSON-LD related libraries in Ruby lack one thing: ability to be explicit if desired. I love Ruby, but I hate that a lot of software packages try to mimic Rails' "magic" for everything. That being said, I want to build some other features too:

- Validations (this is a tough one, because there are so many easy traps to fall into)
- Entity style mapping for types

I don't know where I'm going with this, really, but maybe it'll be cool. Or it can just remain an ordinary Hash builder. I'm OK with that too! :)
