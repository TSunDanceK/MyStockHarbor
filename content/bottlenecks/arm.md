---
symbol: ARM
companyName: Arm Holdings plc
category: Semiconductor IP licensing (chip architecture & royalties)
domain: arm.com
title: "Arm Holdings (ARM) Bottlenecks: Who Arm Depends On"
date: 2026-07-10
summary: >
  Arm Holdings designs and licenses the chip architecture used in the vast
  majority of the world's smartphones and a growing share of AI and cloud
  infrastructure, but it owns no factories and manufactures nothing itself —
  so its real dependencies run through the software and infrastructure its
  engineers need to design and verify IP, not a physical parts supply chain.
  On the technology side, Arm leans heavily on a small number of EDA software
  vendors, leading-edge foundry capacity, and cloud computing to produce and
  validate new cores. On the revenue side, Arm's business is genuinely
  concentrated: its own SEC filings disclose that its five largest customers
  — led by its China joint venture and rounded out by giants like Apple,
  Qualcomm, Samsung, and MediaTek — make up more than half of total revenue.
supplyChainNote: >
  Arm licenses chip designs — it doesn't manufacture anything, so a
  conventional parts-and-materials supply chain doesn't apply here. This
  chart instead reframes "supply chain" around the critical technology
  infrastructure Arm's own engineers depend on to design, verify, and prove
  out the IP it sells: electronic design automation (EDA) software, cloud
  computing for compute-intensive verification workloads, and leading-edge
  chip manufacturing capacity to validate its reference designs.
disclaimer: >
  The percentages shown are editorial estimates based on public research
  (company disclosures, earnings commentary, and industry reporting) meant
  to illustrate relative reliance, not precise or audited figures. Companies
  without a proper, reliably tradable ticker on this site are shown without
  stock/earnings links. This is not financial advice.
supplyChain:
  - name: Synopsys
    ticker: SNPS
    pct: 30
    blurb: >
      Arm's chip designers rely on Synopsys' electronic design automation
      (EDA) software — design compilers, simulation, and verification tools
      — to build and validate every CPU, GPU, and NPU core before it's
      released to licensees. Without licensed EDA tooling of this caliber,
      Arm's engineers simply cannot tape out or verify new IP.
  - name: Cadence Design Systems
    ticker: CDNS
    pct: 25
    blurb: >
      The other half of the EDA duopoly Arm depends on, supplying
      complementary verification IP and simulation tools used alongside
      Synopsys throughout the chip design process. Together the two vendors
      control the software stack Arm's engineers use daily, with no viable
      third alternative at the leading edge.
  - name: Taiwan Semiconductor Manufacturing Company
    ticker: TSM
    pct: 25
    blurb: >
      As Arm pushes deeper into silicon with reference platforms like
      Neoverse Compute Subsystems and the Arm Total Design ecosystem, it
      depends on access to TSMC's leading-edge process nodes to prove those
      designs are manufacturable and performant before partners commit to
      building on them.
  - name: Amazon (AWS)
    ticker: AMZN
    pct: 20
    blurb: >
      Arm migrated its compute-intensive EDA verification workloads to AWS
      in 2016 and now runs tens of millions of parallel simulation jobs a
      week on AWS Batch and EC2. A prolonged cloud outage or vendor
      disruption would slow the core engineering pipeline that produces
      Arm's IP.
customers:
  - name: Arm China
    ticker: null
    pct: 18
    blurb: >
      A separately managed joint venture, majority owned by Chinese
      investors, that holds the exclusive right to license Arm's IP to
      customers in mainland China. It is consistently disclosed as Arm's
      single largest customer — around a quarter of total revenue near its
      2023 IPO, still in the high teens as a share of revenue in its most
      recent fiscal year. A private company with no public ticker.
  - name: Apple
    ticker: AAPL
    pct: 11
    blurb: >
      Holds a broad Architecture License Agreement letting it design fully
      custom Arm-based cores for the iPhone, iPad, and Mac lines. Named in
      Arm's IPO prospectus among its largest licensees and one of the few
      single customers large enough to move Arm's royalty line on its own.
  - name: Qualcomm
    ticker: QCOM
    pct: 11
    blurb: >
      One of Arm's largest licensees for Android smartphone chipsets
      (Snapdragon) and increasingly for Arm-based PC processors, using both
      off-the-shelf and custom-core technology. Regularly cited among the
      handful of customers that together account for the majority of Arm's
      concentrated revenue base.
  - name: Samsung Electronics
    ticker: null
    pct: 9
    blurb: >
      Licenses Arm cores across its Exynos mobile chipsets, memory
      products, and foundry business, making it one of Arm's longest-
      standing and most diversified licensees. Trades on the Korea Exchange
      as a thin, illiquid US OTC ADR, with no proper US-listed ticker.
  - name: MediaTek
    ticker: null
    pct: 7
    blurb: >
      Ships more Arm Cortex-based smartphone application processors by unit
      volume than almost any other licensee, largely using off-the-shelf
      core designs across budget and mid-range Android phones. Trades on
      the Taiwan Stock Exchange, with no proper US-listed ticker.
  - name: Nvidia
    ticker: NVDA
    pct: 8
    blurb: >
      Licenses the Arm architecture for its Grace CPU and Grace Hopper/
      Blackwell superchips used in AI data centers — a fast-growing royalty
      stream that followed Nvidia's own abandoned 2020-2022 attempt to
      acquire Arm outright.
  - name: Amazon (AWS)
    ticker: AMZN
    pct: 6
    blurb: >
      Licenses Arm's architecture to design its custom Graviton server
      processors, which now power a large and growing share of new AWS
      compute capacity — making Amazon both one of Arm's key cloud
      infrastructure providers and one of its fastest-growing chip
      licensees.
  - name: All other licensees
    ticker: null
    pct: 30
    blurb: >
      Hundreds of additional licensees across automotive (ADAS and
      infotainment chipmakers), networking equipment, IoT, gaming consoles,
      and other smartphone and PC OEMs make up the remainder of Arm's
      royalty and licensing base, none individually large enough to rank
      among its disclosed top five customers. Not a single company.
---
