---
symbol: SKHY
companyName: SK hynix Inc.
category: Semiconductors / DRAM, HBM & NAND memory
domain: skhynix.com
title: "SK hynix (SKHY) Bottlenecks: Who SK hynix Depends On"
date: 2026-08-15
summary: >
  SK hynix is the world's leading supplier of high-bandwidth memory, the
  stacked DRAM that sits alongside every serious AI accelerator, and it
  listed American Depositary Shares on Nasdaq in July 2026 while keeping
  its primary listing on the Korea Exchange. Its supply chain is a
  concentrated set of lithography, deposition and packaging-equipment
  vendors it cannot substitute — plus, unusually, a dependence on TSMC for
  the logic base die underneath HBM4 and on a single private Japanese
  chemicals firm for the molding compound that makes its MR-MUF stacking
  process work. On the demand side it discloses genuinely concentrated
  revenue, with its largest customer at 23.9% of 2025 revenue, but has
  never named a single customer in any filing.
supplyChainNote: >
  SK hynix does not disclose a supplier list or any supplier spend
  breakdown. Its Nasdaq listing prospectus says only that it depends on
  "a limited number of manufacturers in the Netherlands, the United States
  and Japan for our key equipment," and states it is not dependent on any
  one supplier for a substantial share of raw materials. The weights below
  are therefore an editorial ranking by how badly production would be
  disrupted if a vendor were unavailable, not by dollars spent — and every
  named relationship is one SK hynix or the supplier has publicly
  confirmed.
customersNote: >
  SK hynix discloses how concentrated its revenue is but has never named a
  customer. Its Nasdaq prospectus states that its largest customer
  represented 23.9% of total revenue in 2025, and that its two largest
  represented 14.8% and 12.4% of revenue in the first quarter of 2026; its
  August 2026 semiannual report put the top two at roughly 13.4% and 13.0%
  of first-half revenue. The identification of NVIDIA as the largest of
  these is press attribution, corroborated by matching revenue figures, not
  company disclosure — and the second-largest customer has never been
  identified at all. Note also that NVIDIA's falling percentage reflects a
  tripling of SK hynix's total revenue, not a shrinking relationship: in
  absolute terms that customer's spend rose about 62% year on year. The
  companies below are the buyers with the strongest public evidence; the
  percentages are editorial estimates except where a filed figure is cited.
disclaimer: >
  The percentages shown are editorial estimates based on public research
  (company disclosures, earnings commentary, and industry reporting) meant
  to illustrate relative reliance, not precise or audited figures. Companies
  without a proper, reliably tradable ticker on this site are shown without
  stock/earnings links. This is not financial advice.
supplyChain:
  - name: ASML
    ticker: ASML
    pct: 24
    blurb: >
      ASML is the only company on earth that makes EUV lithography systems,
      so there is no second source at any price. SK hynix disclosed an order
      worth roughly KRW 11.9 trillion for around 30 EUV scanners in March
      2026, for delivery through the end of 2027 into its M15X Cheongju HBM
      fab and the new Yongin cluster, and in September 2025 it became the
      first memory maker to install a High-NA EUV system, ASML's
      TWINSCAN EXE:5200B, for production use at M16 in Icheon.
  - name: Applied Materials
    ticker: AMAT
    pct: 13
    blurb: >
      Applied Materials supplies the deposition, CMP and epitaxy steps that
      build up every DRAM and NAND layer SK hynix produces. In March 2026
      the two signed a long-term R&D collaboration at Applied's EPIC Center
      covering memory materials, process integration and 3D advanced
      packaging, and Applied's CMP and plasma modules form half of the
      hybrid-bonding system SK hynix ordered for its development line.
  - name: TSMC
    ticker: TSM
    pct: 12
    blurb: >
      This is SK hynix's most unusual dependency: TSMC manufactures the
      logic base die that sits underneath its HBM4 stacks, under a
      partnership announced in April 2024 and now in mass production as of
      the second quarter of 2026. SK hynix has no leading-edge logic foundry
      of its own, so unlike Samsung — which makes its own base die in-house
      — it must buy this piece from an outside supplier it does not control.
  - name: Lam Research
    ticker: LRCX
    pct: 12
    blurb: >
      Lam dominates the deep-silicon etch that cuts the through-silicon vias
      running vertically through an HBM stack, and the high-aspect-ratio
      channel etch that makes 300-plus-layer NAND possible. SK hynix was
      named among Lam's most significant customers in Lam's own FY2020-2022
      filings, and requalifying these steps on another vendor's tools is a
      multi-year exercise most fabs never attempt.
  - name: Tokyo Electron
    ticker: null
    pct: 9
    blurb: >
      Tokyo Electron holds an overwhelming share of the coater/developer
      "track" tools that feed wafers through a lithography scanner, which
      makes it the quieter chokepoint sitting next to ASML — in practice
      every EUV scanner SK hynix installs pulls a Tokyo Electron track along
      with it. It also supplies etch, deposition and wafer-clean tools.
      Listed on the Tokyo Stock Exchange, and in the US only as a thin OTC
      ADR with no proper US-listed ticker.
  - name: KLA Corporation
    ticker: KLAC
    pct: 7
    blurb: >
      KLA holds roughly 70% of the process-control market, and HBM yield is
      fundamentally an inspection-and-metrology problem — finding the defect
      in one die before it is bonded into a twelve-high stack and ruins the
      whole part. There is no comparable alternative at the leading edge,
      though SK hynix sits below KLA's 10%-of-revenue naming threshold.
  - name: SK Siltron
    ticker: null
    pct: 7
    blurb: >
      The world's third-largest silicon wafer maker and, until recently,
      SK hynix's affiliated in-house wafer supplier. That changed in July
      2026, when SK Inc. approved the sale of a controlling stake to Doosan
      for KRW 2.3 trillion, turning a captive sister company into an
      arm's-length vendor. A private company with no public ticker.
  - name: Hanmi Semiconductor
    ticker: null
    pct: 6
    blurb: >
      Hanmi builds the thermal-compression bonders that physically stack HBM
      dies, and was SK hynix's exclusive TC bonder supplier until 2024, when
      SK hynix added Hanwha Semitech as a second source and the relationship
      broke down — Hanmi withdrew around 60 seconded engineers in April 2025
      in protest. The two reconciled over 2026, culminating in a KRW 44.2
      billion order in June 2026 for Hanmi's first HBM4-generation bonder.
      Listed on the Korea Exchange, with no proper US-listed ticker.
  - name: ASMPT
    ticker: null
    pct: 5
    blurb: >
      ASMPT was brought in as a third TC bonder source for HBM3E in late
      2024 and scaled quickly: by December 2025 SK hynix was running roughly
      50 TC bonders for HBM4, about half of them ASMPT machines. Its
      fluxless bonders place dies to sub-micron accuracy, a tolerance only a
      handful of vendors can hold. Listed in Hong Kong, and in the US only
      as a thin OTC ADR with no proper US-listed ticker.
  - name: Namics Corporation
    ticker: null
    pct: 5
    blurb: >
      A small Japanese chemicals firm that is arguably SK hynix's single
      most concentrated dependency. Namics supplies, under an exclusive
      contract, the molding compound behind MR-MUF — the stacking process
      that is SK hynix's core technical advantage over Samsung's and
      Micron's TC-NCF approach, and which SK hynix has confirmed it will
      keep using through HBM4 and HBM4E. A private company with no public
      ticker.
customers:
  - name: NVIDIA
    ticker: NVDA
    pct: 22
    blurb: >
      SK hynix's largest customer, disclosed in its Nasdaq prospectus at
      23.9% of 2025 revenue without being named; press reporting matching
      the quarterly won figures identifies it as NVIDIA. SK hynix has been
      the primary HBM3E source for NVIDIA's data-center GPUs and moved into
      HBM4 for the Vera Rubin generation, and the two announced a multiyear
      technology partnership in June 2026.
  - name: Microsoft
    ticker: MSFT
    pct: 13
    blurb: >
      Microsoft buys SK hynix HBM3E for its in-house Maia accelerators and
      was reported in 2026 to have signed a three-year DDR5 long-term
      agreement worth tens of trillions of won. SK hynix confirmed on its
      Q2 2026 call that it had finalised long-term agreements with around
      ten customers, typically running about five years.
  - name: Alphabet (Google)
    ticker: GOOGL
    pct: 11
    blurb: >
      Google is a major buyer of both commodity DRAM and the HBM stacked
      onto its Ironwood-generation TPUs, and was reported in 2026 to have
      signed a five-year DRAM long-term agreement with an extension option
      tied to HBM supply. Samsung is reported as the larger TPU HBM
      supplier, so SK hynix is a second source here rather than the primary.
  - name: Xiaomi & China's smartphone makers
    ticker: null
    pct: 10
    blurb: >
      Chinese buyers accounted for 24.6% of SK hynix's first-half 2026
      revenue, more than quadrupling year on year. Xiaomi is the launch
      partner for SK hynix's LPDDR6 mobile memory entering mass production
      in the second half of 2026, alongside Oppo, Vivo and Honor as mobile
      DRAM and NAND buyers. None of these has a proper US-listed ticker.
  - name: Amazon
    ticker: AMZN
    pct: 8
    blurb: >
      AWS is one of the largest server-memory buyers in the world and a
      buyer of SK hynix DRAM and enterprise SSDs for its data-center fleet.
      SK hynix does not disclose AWS as a named customer, so the weighting
      here is an editorial estimate based on hyperscaler infrastructure
      spend rather than a filed figure.
  - name: Dell Technologies
    ticker: DELL
    pct: 7
    blurb: >
      Dell is a long-standing server and PC memory customer, and in April
      2026 became the first customer for SK hynix's 321-layer QLC client
      SSD, shipped in Dell's AI PC line — one of the few SK hynix customer
      relationships confirmed by name in public reporting.
  - name: Meta Platforms
    ticker: META
    pct: 7
    blurb: >
      Meta's AI infrastructure build-out makes it a substantial buyer of
      server DRAM, HBM and high-capacity enterprise storage, the last of
      these through SK hynix's Solidigm subsidiary. As with the other
      hyperscalers, SK hynix does not name Meta, so this weighting is an
      editorial estimate.
  - name: OpenAI
    ticker: null
    pct: 7
    blurb: >
      OpenAI named SK hynix in its own October 2025 announcement of the
      Stargate memory partnership, under which SK hynix and Samsung
      together target around 900,000 DRAM wafer starts per month for
      OpenAI's data centres. The arrangement is at letter-of-intent stage
      rather than a binding purchase contract. A private company with no
      public ticker.
  - name: Tesla
    ticker: TSLA
    pct: 5
    blurb: >
      Package images from Tesla's AI5 chip tapeout in 2026 showed SK hynix
      DRAM on the module, with Samsung supplying LPDDR5X alongside it —
      making Tesla's in-house autonomy silicon a visible, if small, SK hynix
      design win outside the data centre.
  - name: Enterprise server & storage OEMs
    ticker: null
    pct: 10
    blurb: >
      Beyond the named hyperscalers, SK hynix sells DRAM modules and
      enterprise SSDs into the broader server and storage channel — HPE,
      Lenovo, Supermicro and the ODM builders that assemble racks for
      cloud operators. SK hynix does not break out this channel, and it is
      not a single company.
---
