---
title: Getting started
description: What Publira is, who runs it, and where to start reading.
published: 2026-10-04
---

Publira is a digital distribution platform for manga and novels that a publisher runs under its own brand. Publishers and editors register the works they receive from authors, and readers buy and read them on the web or in the mobile app. It is open source and built to run on ordinary infrastructure, so an install is not tied to one cloud provider.

## Who these pages are for

These pages are written for the people who run a Publira install: the operator who deploys it and keeps it running, and the publisher's staff who configure a site from its console. Each page answers one task or one question, in the order you are likely to meet it.

If you want to change Publira itself, start from the repository instead. [CONTRIBUTING.md](https://github.com/publira/publira/blob/main/CONTRIBUTING.md) describes the repository layout, the toolchain, and how a pull request is reviewed.

## What a Publira install serves

A single install serves one or more publishers, each called a tenant. Every tenant gets:

- A public site on its own domain, where readers browse the catalog, sign in, and read.
- A console on a second host name, where the publisher's staff manage works, episodes, readers, and the site's settings.

An optional Platform Console lets the operator manage every tenant from a browser. Without it, the operator manages the install from the `publiractl` command line.

## Where to go next

- [Deployments](./2-deployments/index.md) covers what an install is made of and how to bring one into service.
