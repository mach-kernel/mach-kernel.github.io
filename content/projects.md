---
title: Projects
type: projects
projects:
  - name: Storage
    repos:
      - repo: mach-kernel/clj-rabin
        description: No dependency Clojure implementation of Rabin-Karp CDC chunker
  - name: macOS
    repos:
      - repo: mach-kernel/launchk
        description: |
          TUI for managing launchd agents and daemons on macOS, using the private
          XPC API. Includes a companion library `xpc-sys` for XPC FFI calls.
  - name: Retrocomputing
    repos:
      - repo: mach-kernel/barriernine
        description: A carbonized Barrier client for (classic) Mac OS 8.6+
      - repo: mach-kernel/mrbuffer
        description: Simple 40-char buffer editor for Apple IIgs
      - repo: mach-kernel/spcbrd
        description: |
          DOS 13h flappy bird style game that I wrote on my Libretto over Christmas
          break
      - repo: sgidevnet/sgug-rse
        description: |
          Core contributor for GNU RPM software environment for SGI IRIX. I run 
          our cloud infrastructure: forums and yum mirrors. Ported the `tdnf` package
          manager and dozens of others. Integrated `update-desktop-database` hooks to
          natively add programs to the Indigo Magic desktop toolbox.
      - repo: sgidevnet/svg2fti
        description: Quick and dirty SVG -> FTI icon conversion script
  - name: Experiments
    repos:
      - repo: mach-kernel/databricks-kube-operator
        description: |
          GitOps style deploys of Databricks jobs and secrets. Used in production by
          Barracuda Networks until advent of `crossplane/upjet` generated providers.
      - repo: mach-kernel/fts-actors
        description: BST full-text search index actors, tested against Gutenberg texts
      - repo: mach-kernel/vertx-ext-spa-ssr
        description: |
          Parallelized single-page app rendering pipeline using Java Nashorn, beating
          Node/Next by 5-20x in request throughput
---

<div class="mb-8">
<h1 class="text-4xl font-bold mb-4 text-primary">Projects</h1>
<p class="text-lg text-base-content/80 leading-relaxed">
Here are some of my projects and things that I like hacking on.
</p>
</div>