---
title: Homelab in a box
published: true
layout: post
categories: homelab esxi kubernetes
date: 2022-12-03T20:07:08Z
---

A homelab is born in one of two ways: either you are a Reddit user posting several architecture diagrams and photos of an elaborate artisianal rack setup, or you started 5-10 years ago with a NAS that went from being convenient to problematic. I am in the latter bucket: one Linux host that started out as a DLNA server + seedbox slowly grew into a file server, web server, and more. Fortunately, after years of trial and error I think I landed on the perfect "small" home setup. To lay down some constraints:

- It must be able to run as a single host (and scale if desired)
  - If I move, I plug WAN into one NIC, and the rest into switches -- and it all works as it did
- It must handle all layer 3 networking
- It can run anything

There are some compromises here, namely -- dedicated network hardware is nice -- but not having to worry about more than one thing is nice (especially considering this thing started its life out in an apartment). Let's get started.

#### Build your host

Find some cheap commodity hardware. It's OK if it's old. I recommend either going with something rackmount, or an old Lenovo, HP, Dell, etc enterprise EATX workstation with a huge case. This machine was once my desktop workstation, and was a perfect candidate (though, is now up for replacement due to power consumption):

**Lenovo D20 Workstation**:
- Intel 5520 Server Board (notable: 2x Broadcom GBE NICs)
- 2x Xeon X5680 Westmere [(Intel ARK)](https://ark.intel.com/content/www/us/en/ark/products/47916/intel-xeon-processor-x5680-12m-cache-3-33-ghz-6-40-gts-intel-qpi.html) (~20 USD/ea)
- 96GB PC3-10600R (~100 USD/set -- you can choose a box that uses cheap unbuffered RAM)
- LSI SAS9211-8i SATA HBA (~30 USD w/cables)
- Intel 1340 Quad Port GBE PCIe NIC (~30 USD)
- Literally any commodity GPU (~50 USD)
- ESXI install target: a flash disk at least 4 GB in size (FREE -- the ones that Micro Center give out in the quarterly circular)

The nice part about this setup is that it's easy to move to a new machine. Yank the flash disk and the PCIe cards, move them to the new box, and everything should work as expected. You can make more performant choices (NVME, SFP), but for my needs platter drives and GBE are fine.

#### Start with the basics

A firewall and a VM host are the first things that need to be sorted. I have been a user of [pfSense](https://www.pfsense.org/) and [ESXI](https://www.vmware.com/products/esxi-and-esx.html) for some time, and chose them for their familiarity. Proxmox and OPNSense are probably great choices too. Start with a small diagram of how you want things to be hooked up:

![Untitled-2022-12-03-1537](https://user-images.githubusercontent.com/396039/205463194-02206c5e-ac44-4d9f-bc2f-45baaa782cee.png)

From there, start creating your vSwitches and the subsequent port groups you will use to lay out the trunks for your network:

| vSwitch | Port Groups   |
|---------|---------------|
| LAN     | LAN, K8S, IOT |
| iSCSI   | iSCSI         |
| WAN     | WAN           |

A lot of the configuration is [explained nicely in this article](https://www.virtualizationhowto.com/2022/03/pfsense-vlan-to-vlan-routing-in-vmware-esxi/). In short, we attach one interface per port group we want to connect to pfSense (option #2 in the article). You can also trunk from pfSense (to get around the 10 NIC limit per VM / option #3) -- but IMO is overkill for something the size of a home network. Get a nice L3 switch if you need more.

Also probably obvious, but worth mentioning: there are more ESXI port groups than physical stuff from the initial diagram. All of my physical hosts are things like my XBOX, a Sonos, TVs, etc -- but for things like a Kubernetes cluster, those are virtual fleets running in ESXI. This is what makes this vSwitch/port group setup awesome: I can compose the physical and virtual pieces of my network and still be able to make some kind of order out of it.

Some time is probably going to be spent here, getting everything right. It's a good point in time to begin layering in things such as [pfBlocker-NG](https://docs.netgate.com/pfsense/en/latest/packages/pfblocker.html), OpenVPN, and other desired goodies. Make sure to take care of placing your pfSense configuration backups somewhere safe. After getting these pieces right, you'll rarely have to touch them again in the future.

#### Add layer: storage


