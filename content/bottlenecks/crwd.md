---
symbol: CRWD
companyName: CrowdStrike Holdings, Inc.
category: Cybersecurity (Endpoint & Cloud Security)
domain: crowdstrike.com
title: "CrowdStrike (CRWD) Bottlenecks: Who CrowdStrike Depends On"
date: 2026-07-17
summary: >
  CrowdStrike is a pure cloud-security software company, so its real
  supply-chain dependency runs through infrastructure rather than
  physical components: its own 10-K names Amazon Web Services as the
  primary third-party data-center host for its Falcon platform, while
  Falcon's endpoint sensor runs as a kernel-level driver on Microsoft
  Windows - the exact architecture responsible for the July 2024 global
  outage that crashed roughly 8.5 million Windows devices. CrowdStrike's
  own filings state its business "is not dependent on any particular end
  customer," so rather than force a misleading revenue-concentration
  chart, this page's customer side instead shows the cloud marketplaces
  and channel partners that actually move its sales - led by AWS
  Marketplace, where CrowdStrike became the first cloud-native
  cybersecurity vendor to top $1 billion in annual sales.
customersNote: >
  CrowdStrike's own 10-K states plainly that its business "is not
  dependent on any particular end customer," reflecting a broadly
  diversified enterprise and government subscriber base with no material
  concentration. Rather than force a misleading chart of named accounts,
  this shows the distribution channels CrowdStrike itself has disclosed
  as concentrated points of leverage - cloud marketplaces, led by AWS
  Marketplace, where CrowdStrike topped $1 billion in sales in calendar
  2024, and its broader partner-first channel network.
disclaimer: >
  The percentages shown are editorial estimates based on public research
  (company disclosures, earnings commentary, and industry reporting) meant
  to illustrate relative reliance, not precise or audited figures. Companies
  without a proper, reliably tradable ticker on this site are shown without
  stock/earnings links. This is not financial advice.
supplyChain:
  - name: Amazon.com, Inc. (AWS)
    ticker: AMZN
    pct: 45
    blurb: >
      CrowdStrike's own 10-K names AWS as a primary third-party data
      center it relies on to host and operate the Falcon platform,
      warning that any disruption to this infrastructure could affect the
      platform's performance and reliability.
  - name: Microsoft Corporation
    ticker: MSFT
    pct: 30
    blurb: >
      Falcon's endpoint sensor runs as a kernel-level driver on Microsoft
      Windows - the exact architectural dependency behind the July 2024
      global outage, when a bad Falcon content update crashed roughly 8.5
      million Windows devices, per Microsoft's own figure.
  - name: NVIDIA Corporation
    ticker: NVDA
    pct: 15
    blurb: >
      CrowdStrike's Charlotte AI agentic-security features run on NVIDIA
      infrastructure and Nemotron models under a publicly announced
      partnership between the two companies.
  - name: Third-party colocation facility providers
    ticker: null
    pct: 10
    blurb: >
      Not a single company. CrowdStrike's own 10-K discloses reliance on
      third-party colocation data centers alongside AWS to host and
      operate the Falcon platform.
customers:
  - name: Amazon.com, Inc. (AWS Marketplace)
    ticker: AMZN
    pct: 45
    blurb: >
      CrowdStrike became the first cloud-native cybersecurity ISV to
      exceed $1 billion in sales through AWS Marketplace in calendar
      2024, with deals transacted through the marketplace running about
      4x larger on average and 91% year-over-year growth, per
      CrowdStrike's own announcement.
  - name: Microsoft Corporation (Azure Marketplace)
    ticker: MSFT
    pct: 20
    blurb: >
      CrowdStrike lists Falcon on Azure Marketplace as a secondary
      cloud-marketplace sales channel, though without a disclosed dollar
      figure comparable to its AWS Marketplace milestone.
  - name: Alphabet Inc. (Google Cloud Marketplace)
    ticker: GOOGL
    pct: 15
    blurb: >
      Falcon Cloud Security is also listed on Google Cloud Marketplace,
      the smallest and most recent of CrowdStrike's three hyperscaler
      marketplace channels.
  - name: Channel partner & systems-integrator network
    ticker: null
    pct: 20
    blurb: >
      Not a single company. CrowdStrike describes a "partner-first"
      go-to-market strategy built on a broad network of resellers,
      managed security service providers, and systems integrators rather
      than concentrated direct sales to a handful of named accounts.
---
