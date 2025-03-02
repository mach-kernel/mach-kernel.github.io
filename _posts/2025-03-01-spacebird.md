---
title: "I made a 13h game 3 years ago"
published: true
layout: post
categories: project dos
date: 2025-03-01T17:41:31-05:00
---

Every year during winter break I try to pick an ambitious-but-doable project, with the intent to write about it after. Sometimes I finish them, but rarely is break long enough to get to this point. I figure that late is better than never, before they fall out of my head!

------

On a whim, I bought a _really nice_ Toshiba Libretto 50CT off of eBay. It had its dock, manuals, original accessories, yet somehow was priced reasonably and not "omg vtuber old PC rare". Sometimes they really do find you, plus with Apple and SGI stuff slowly approaching rent prices, maybe it was time to play with some Win9x wares. The 50CT in a nutshell: Pentium 75, 16MB RAM, 800MB platter, 6.1" TFT screen. I bought an IDE->CF adapter, loaded up Windows 95 and some games, then spent a good month reliving my childhood all from the comfort of my couch. One of the key pieces of nostalgia was this screensaver:

Everybody has seen this. Even people that don't care for computers have seen this. 3D pipes was [written with](https://devblogs.microsoft.com/oldnewthing/20240611-00/?p=109881) OpenGL. I have little experience doing graphics programming outside of the likes of Unity. I spent a few hours drawing a rotating cube in OpenGL, but found it intimidating and didn't follow through. I set myself a goal to try writing "2D pipes", which effectively boils down to drawing some random lines on the screen. I should be able to do that in VGA mode 13h (320x200). The "API" is pretty neat, you just DMA a color palette index into the buffer at `0xA0000..0x19A00` representing each pixel sequentially. However this is all you get. Take a moment to appreciate the amount of thought and effort that goes in to writing a game like [Descent](https://en.wikipedia.org/wiki/Descent_(video_game)).

