---
published: true
layout: post
title: 'G4 MDD: Debian Sid!'
categories: retrolust
date: 2017-01-21T01:16:22.000Z
---
I'm installing Debian on my FW 800 MDD PowerMac G4, and I'm going to talk about it here so you too can convince yourself that your Friday night, is in fact, probably better. 

## Things needed

- The [weekly-built sid ISO](http://cdimage.debian.org/cdimage/weekly-builds/), for the `powerpc` architecture
	- You're going to want `sid` so that packages which are regularly 4 years old may now potentially at best be 10 months old. Congratulations!
	- Get the `netinstall` variant unless you have nothing better to do than wait to download obsolete packages
- A USB flash disk that is at least `512MB`
	- Install `pv` with your package manager ("pipe viewer", you'll see in approximately 1 second)
    - `dd if=/path/to/iso | pv | of=/dev/whatever`
    	- (this would be a great time to take a coffee break)
        
## Booting

"I'm not an idiot, if this thing can boot from USB, it'll take me like two seconds get started" I said before eating shit and spending the greater part of 30 minutes getting the machine to start. 

- Print out your entire device tree with `dev / ls` 
	- Identify your USB disk. There should be a USB hub that has something similar to `disk@1`. Be patient. There is a lot of text!
- Once you've identified that place, _start at the top of the tree_ and record the entire path to your disk
- Provided you dd this to USB, you can now do something that should look roughly like this `boot /pci@f2000000/pci@whatever/usb@1/disk@1:,\install\yaboot`
- It will then load the `yaboot` elf file, which will in turn load the kernel and RAMdisk. 

What an exercise.

## Partitioning

This is the section where you should *read everything carefully* if you have any existing things on your disk. Or not -- I'm not your mother.

Remember the best practice guidelines of making your swap partition 2x your RAM, or roughly the size of your RAM if around 4GB. Generally, your swap size should be at least the size of RAM so that doing things like hibernating can be successful (e.g. dumping everything onto the disk and then subsequently reseeding RAM on boot).

Additionally, *you will need a special boot partition*, to save you time, make a `NewWorld Boot Partition` of size `819200b`

## Everything else

For some reason, I never got a full package listing, so after installing a base system I have been pretty much left alone without any other useful packages. Reboot when it prompts you to, and then if you successfully installed, do this to fix your `sources.list`.

```
rm /etc/apt/sources.list
cp /usr/share/doc/apt/examples/sources.list /etc/apt/sources.list
```

Update and play!