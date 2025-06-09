---
title: "Dev diaries: I made a 13h game 3 years ago"
published: true
layout: post
categories: project dos
date: 2025-03-01T17:41:31-05:00
---

Every year during winter break I try to pick an ambitious-but-doable project, with the intent to write about it after. Sometimes I finish them, but rarely is break long enough to get to this point. I figure that late is better than never, before they fall out of my head!

------

On a whim, I bought a _really nice_ Toshiba Libretto 50CT off of eBay. It had its dock, manuals, original accessories, yet somehow was priced reasonably and not "omg vtuber old PC rare". Sometimes they really do find you, plus with Apple and SGI stuff slowly approaching rent prices, maybe it was time to play with some Win9x wares. The 50CT in a nutshell: Pentium 75, 16MB RAM, 800MB platter, 6.1" TFT screen. I bought an IDE->CF adapter, loaded up Windows 95 and some games, then spent a good month reliving my childhood all from the comfort of my couch. One of the key pieces of nostalgia was this screensaver:

![image](https://github.com/user-attachments/assets/3fc2d4af-01de-458e-b739-a19c686319ce)

Everybody has seen this. Even people that don't care for computers have seen this. 3D pipes was [written with](https://devblogs.microsoft.com/oldnewthing/20240611-00/?p=109881) OpenGL. I have little experience doing graphics programming outside of the likes of Unity. I spent a few hours drawing a rotating cube in OpenGL, but found it intimidating and didn't follow through. But I wanted to try writing something like it, so I set a goal of doing a "2D" version (yes, which is just some lines on the screen).

I wanted to write this for DOS mode 13H (320x200). The challenge is cool because you really have to build everything yourself. The "API" is... you DMA a color palette index into the buffer at `0xA0000..0x19A00` (for all 64k pixels). That's it.

I _also_ wanted do the work on the Libretto itself. I installed [OpenWatcom](https://github.com/open-watcom/open-watcom-v2) and started to use the IDE from Win95. This was a good time, especially because of the [great libc docs](https://open-watcom.github.io/open-watcom-v2-wikidocs/clib.html) which were integrated into the winhelp tomes that ship with OW. It felt like [Dash](https://kapeli.com/dash).

Despite the great tools, the measly hello world below took me a couple of hours. When you have to trigger interrupts to modeset, and do DMA to draw things, especially on DOS/Win9x, mistakes can bring down the machine. And so after several restarts, I quickly realized: I don't need Windows, or even really the `libc` docs at the moment..., and OW ships with a `vi` clone. After reducing the "mistake penalty" we had a result:

https://github.com/user-attachments/assets/21cc18b7-68a0-4cdc-9148-9af0e2bf8d05

While I was having fun, I understood that if I ever wanted to do anything in 3D in 13H, I should probably see through a small 2D game first. Tons of 2D DOS games are great fun, and there are still many challenges: sprite engine, scene management, and so on. 

The next goal was to make a flappy bird clone. A spec for that can look like:

- Procedurally generated pipes (i.e. easy scene management)
- Birdie sprite
- Easy state/input management:
  - Birdie (x,y)
  - Pipes (x,y)
  - Score = num pipes passed
  - Space = jump

#### Basic Scene

To implement scrolling pipes, we need some kind of clock (to interpolate movement), state telling us where our pipes are at any given time, and a rudimentary event loop. I have `wlink` set to emit a dos4g compatible executable that comes prefixed with the OW DOS/4G stub. This gives us a simple linear memory model with 32-bit pointers, and avoids having us think about the 640k memory issue (albeit, this game is so small, that shouldn't be a problem). This means that `near` and `far` pointers are all just simply `far` pointers. So I can `malloc` and `calloc` stuff without worrying about where it's going. I opted to store all of my state in a heap-allocated singleton struct:

```c
#define NUM_PIPES 6
#define MAX_PIPE_Y 100   // pixels
#define MAX_PIPE_X 40    // pixels
#define G 2              // ~36 px/sec

typedef struct flapstate {
    // [x, y]
	int pipes[NUM_PIPES][2];
    // where [y(input),y(bird)]
	int birdie[2];
} flapstate;

static flapstate *STATE = NULL;
```

We also included some state for mocking up our birdie. The bird remains in a fixed `x` position, but moves up and down `y` as the player jumps. Since the bird falls without input (causing the player to lose on collision), we must also define a gravity constant. I used the DOS `0x1C` timer (18.2hz) as the hook for moving the pipes and birdie along:

```c
void __interrupt __far timer_game_tick();

// ...

prev_timer = _dos_getvect(0x1C);
_dos_setvect(0x1C, timer_game_tick);
```

https://github.com/user-attachments/assets/03847f27-abb9-497f-895e-6be71c08b523


#### Sprites

Time to replace the dot with [this really cute bird sprite](https://ma9ici4n.itch.io/pixel-art-bird-16x16). Most DOS games of the era used [PCX](https://en.wikipedia.org/wiki/PCX) as their asset format (mostly due to its simplicity: it's a bitmap). A 128 byte header has some metadata about the image, followed by run-length encoded scanlines. Our image is 8 bpp * 3 color planes (24-bit color), so for example, to read a 16 pixel row (without RLE), we'd read 48 bytes (16px R/G/B). We want to read the spritesheet and store it in memory un-RLE'd while also binning the 24-bit colors into 8-bit pixels ("color quantization"). As mentioned earlier, the video buffer expects a VGA color palette index for each pixel (and not a byte representing an RGB value). To draw the bird, we have to do the following:

- Read the active VGA palette colors into memory
- Read the uncompressed PCX into memory
- As we read the PCX, find the color with the closest abs value to the 24-bit color, and assign the spritesheet pixel that palette index

I'm not sure this is the most efficient or correct way to do these things, but it got us a result:
![IMG_5134](https://github.com/user-attachments/assets/ad69f538-eddb-494f-ae98-16c016978b5e)


The spritesheet shows birdie as it flaps its wings up and down, so to make birdie come to life, we have to flip between the tiles. We also have to consider layers/clipping: the bird should be the topmost layer and should be drawn without its white background showing. I edited the asset to make the PCX background color the same as that of my scene. Then, if drawing the sprite and encountering my `BG_COLOR`, I could skip writing to the video buffer. I made some changes to keep track of the current sprite frame in the state singleton, and after some tweaking, birdie was flying:


https://github.com/user-attachments/assets/8de8015e-055d-4794-bf96-fb1b72e5878e

