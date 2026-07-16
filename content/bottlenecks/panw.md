---
symbol: PANW
companyName: Palo Alto Networks, Inc.
category: Cybersecurity (Network & Cloud Security)
domain: paloaltonetworks.com
title: "Palo Alto Networks (PANW) Bottlenecks: Who Palo Alto Networks Depends On"
date: 2026-07-16
summary: >
  Palo Alto Networks builds next-generation firewall appliances alongside
  cloud-delivered security software such as Prisma Cloud and Cortex/XSIAM,
  which gives it two distinct dependency stories. Its hardware runs through
  a single named contract manufacturer plus a small set of processor and
  hyperscaler-cloud suppliers, while its revenue flows overwhelmingly through
  wholesale distributors rather than a concentrated set of named end
  customers. Palo Alto Networks' own annual report discloses that three
  distributors together accounted for 44.2% of total revenue, making channel
  concentration - not a handful of big enterprise buyers - the honest
  "customer" bottleneck story here.
customersNote: >
  Palo Alto Networks sells almost entirely through channel partners rather
  than directly to end customers, so a chart of named enterprise buyers
  would misrepresent where its real customer concentration sits. Its own
  annual report discloses that three distributors, not individually named
  in the filing, together accounted for 44.2% of total revenue. This chart
  shows the specific distributors publicly known to be Palo Alto Networks'
  largest partners, with the remainder attributed to its broader reseller
  and systems-integrator channel.
disclaimer: >
  The percentages shown are editorial estimates based on public research
  (company disclosures, earnings commentary, and industry reporting) meant
  to illustrate relative reliance, not precise or audited figures. Companies
  without a proper, reliably tradable ticker on this site are shown without
  stock/earnings links. This is not financial advice.
supplyChain:
  - name: Flex Ltd.
    ticker: FLEX
    pct: 22
    blurb: >
      Flex is Palo Alto Networks' electronics manufacturing services
      partner, named in Palo Alto Networks' SEC filings as the company that
      procures components for and assembles, tests, and packages its
      PA-Series next-generation firewall appliances. Because Palo Alto
      Networks doesn't own factories, a disruption at Flex would directly
      delay hardware shipments.
  - name: Marvell Technology, Inc.
    ticker: MRVL
    pct: 17
    blurb: >
      Palo Alto Networks' firewall appliances are built around Cavium (now
      part of Marvell) OCTEON multi-core processors that handle high-speed
      packet inspection on the data plane. These specialized processors are
      difficult to swap for a different chip family without re-engineering
      the appliance line.
  - name: Intel Corporation
    ticker: INTC
    pct: 9
    blurb: >
      Management-plane functions on many Palo Alto Networks appliances,
      ranging from lower-power chips on entry-level models to server-grade
      Xeon processors on high-end ones, run on Intel silicon, adding a
      second layer of chip-supply dependency alongside the specialized
      data-plane processors.
  - name: Alphabet Inc. (Google Cloud)
    ticker: GOOGL
    pct: 19
    blurb: >
      Cortex Data Lake, the pipeline that ingests and processes security
      telemetry for Palo Alto Networks' Cortex XDR and XSIAM security
      operations products, is hosted on Google Cloud Platform, making a
      single hyperscaler central to Palo Alto Networks' fastest-growing
      product line.
  - name: Amazon.com, Inc. (AWS)
    ticker: AMZN
    pct: 15
    blurb: >
      Palo Alto Networks runs its VM-Series virtual firewalls and
      integrates Prisma Cloud natively with Amazon Web Services, and the
      AWS Marketplace is a major channel through which customers deploy and
      pay for its products, making AWS both infrastructure and
      distribution surface.
  - name: Microsoft Corporation (Azure)
    ticker: MSFT
    pct: 10
    blurb: >
      Microsoft Azure hosts a meaningful share of Palo Alto Networks'
      cloud-delivered Prisma Cloud and VM-Series workloads, and the Azure
      Marketplace serves as a direct sales channel for its virtualized
      security products.
  - name: Limited-source hardware component suppliers
    ticker: null
    pct: 8
    blurb: >
      Not a single company. Palo Alto Networks' own annual report warns
      that its hardware products contain key components sourced from a
      limited number of suppliers, some located outside the United States,
      exposing appliance production to shortages, price swings, and
      geopolitical disruption.
customers:
  - name: Ingram Micro Holding Corporation
    ticker: INGM
    pct: 19
    blurb: >
      Ingram Micro has been named Palo Alto Networks' Global Distribution
      Partner of the Year and is an authorized Palo Alto Networks
      distributor across multiple regions, including North America, Hong
      Kong, and the Middle East. It is one of the largest single wholesale
      channels moving Palo Alto Networks' hardware and subscriptions out to
      resellers worldwide.
  - name: TD SYNNEX Corporation
    ticker: SNX
    pct: 13
    blurb: >
      TD SYNNEX is an authorized global distributor for Palo Alto Networks,
      aggregating orders from a large base of resellers and managed service
      providers and extending Palo Alto Networks' reach into markets and
      mid-sized customers it doesn't sell to directly.
  - name: Arrow Electronics, Inc.
    ticker: ARW
    pct: 9
    blurb: >
      Through its Arrow ECS enterprise computing solutions division, Arrow
      Electronics distributes Palo Alto Networks products and runs
      partner-enablement programs across North America, the UK, and other
      markets, forming another major link in Palo Alto Networks'
      channel-first go-to-market model.
  - name: Broader reseller & systems-integrator channel
    ticker: null
    pct: 59
    blurb: >
      Not a single company. Beyond its largest named distributors, Palo
      Alto Networks reaches the market through thousands of additional
      resellers, managed security service providers, and systems
      integrators worldwide, with almost no direct end-customer sales -
      collectively a bigger factor in Palo Alto Networks' revenue than any
      single named enterprise customer.
---
