---
symbol: ALAB
companyName: Astera Labs, Inc.
category: Semiconductors / AI data-center connectivity (retimers, fabric switches, smart cable modules)
domain: asteralabs.com
title: "Astera Labs (ALAB) Bottlenecks: Who Astera Labs Depends On"
date: 2026-08-05
summary: >
  Astera Labs designs the connectivity silicon that moves data between AI
  accelerators, CPUs and memory inside cloud data centers — PCIe/CXL Aries
  retimers, Scorpio fabric switches, Taurus smart cable modules, and the
  COSMOS software layer that manages them. It is fully fabless, so on the
  supply side it depends on a single foundry (TSMC) for every chip it ships,
  on ASE and Amkor for assembly and test, and on the EDA and IP vendors whose
  tools its high-speed SerDes designs are built in. On the customer side the
  concentration is extreme even by AI-semiconductor standards: Astera's own
  10-K discloses that one end customer was more than 70% of 2025 revenue and
  the top three were roughly 86%, on total revenue of $852.5 million.
supplyChainNote: >
  Astera Labs names only three manufacturing partners directly in its filings
  — TSMC for wafer fabrication and ASE and Amkor for assembly, packaging and
  test — and refers to everything else as "a small, limited number of other
  manufacturing partners" and unnamed EDA tool providers. The remaining
  entries below reflect the concentrated upstream vendor base a fabless
  high-speed SerDes designer necessarily sits on top of, rather than
  relationships Astera itself has named.
customersNote: >
  Astera Labs discloses how concentrated its revenue is but not who the
  customers are: its 2025 10-K states that one end customer represented more
  than 70% of revenue and the top three represented approximately 86%,
  identifying them only as "hyperscalers" and "System OEMs." The chart below
  maps those disclosed tiers onto the relationships that are publicly
  reported — Amazon Web Services is widely understood to be the largest
  account, on the back of its Trainium custom-accelerator programme — so the
  shape of the concentration is Astera's own disclosure, while the names
  attached to it are editorial attribution.
disclaimer: >
  The percentages shown are editorial estimates based on public research
  (company disclosures, earnings commentary, and industry reporting) meant
  to illustrate relative reliance, not precise or audited figures. Companies
  without a proper, reliably tradable ticker on this site are shown without
  stock/earnings links. This is not financial advice.
supplyChain:
  - name: Taiwan Semiconductor Manufacturing Company
    ticker: TSM
    pct: 34
    blurb: >
      Astera Labs' 10-K is unusually blunt about this: "We use a fabless
      manufacturing model and partner with TSMC to fabricate all of our ICs."
      Every Aries retimer, Scorpio switch and Taurus cable-module chip Astera
      ships starts as a TSMC wafer, with no second-source foundry qualified.
      Requalifying leading-edge SerDes designs on another process would take
      years, which makes TSMC capacity allocation — and Taiwan geopolitical
      risk — Astera's single largest supply-side exposure.
  - name: Amkor Technology
    ticker: AMKR
    pct: 15
    blurb: >
      Amkor is one of only two assembly, packaging and test partners Astera
      names in its filings. High-speed retimer and switch packages have to
      hold signal integrity at 100G-plus per lane, so the packaging step is
      not a commodity finishing operation — it is part of whether the product
      meets spec at all. Amkor's expanding US packaging capacity built around
      TSMC's domestic fabs also matters for customers who want an onshore
      supply path.
  - name: ASE Technology Holding
    ticker: ASX
    pct: 15
    blurb: >
      ASE, the world's largest outsourced semiconductor assembly and test
      provider, is the other named packaging and test partner in Astera's
      10-K. Between ASE and Amkor, essentially all of Astera's back-end
      capacity sits with two vendors, both heavily booked by the same AI
      customers competing for advanced packaging slots.
  - name: Synopsys
    ticker: SNPS
    pct: 12
    blurb: >
      Synopsys is Astera's longest-standing named design partner — its design
      and verification tools were used to build the industry's first PCIe 5.0
      retimer SoC, and Astera runs physical design flows on Synopsys Cloud.
      For a company whose entire product is high-speed serial links, the EDA
      toolchain and the verification IP that proves interoperability are as
      load-bearing as any physical supplier.
  - name: Cadence Design Systems
    ticker: CDNS
    pct: 7
    blurb: >
      Astera's filings refer to "EDA tool providers" in the plural without
      naming them all, and in practice no chip company of this kind operates
      on a single vendor's flow. Cadence sits alongside Synopsys in an
      effectively two-firm market for the simulation, verification and
      high-speed interface IP that PCIe, CXL and Ethernet designs depend on,
      making the pair jointly unavoidable.
  - name: ASML Holding
    ticker: ASML
    pct: 5
    blurb: >
      Astera never buys a machine from ASML, but every leading-edge wafer it
      orders from TSMC is patterned on one. ASML is the sole supplier of EUV
      lithography systems worldwide, so any constraint on its output
      propagates down through TSMC's advanced nodes to fabless customers like
      Astera as capacity scarcity and pricing pressure.
  - name: Teradyne
    ticker: TER
    pct: 4
    blurb: >
      Astera's 10-K stresses "high production test coverage and full product
      traceability" on parts that must meet JEDEC and PCI-SIG timing specs.
      Testing multi-lane high-speed SerDes at production volume requires
      automated test equipment from a very short list of vendors, with
      Teradyne among the principal suppliers of that capacity to the OSATs
      doing Astera's back-end work.
  - name: Ibiden
    ticker: null
    pct: 4
    blurb: >
      Astera discloses that it relies on "a small, limited number of other
      manufacturing partners" for its IC substrates without naming them.
      ABF substrate supply — the laminate the die is mounted on — is
      concentrated among a handful of Japanese and Taiwanese producers led by
      Ibiden, and has repeatedly been the binding constraint on advanced
      package output during AI demand spikes. Ibiden trades primarily on the
      Tokyo Stock Exchange with no proper US-listed ticker.
  - name: Module, board & cable assembly partners
    ticker: null
    pct: 4
    blurb: >
      Beyond bare silicon, Astera ships finished Taurus smart cable modules
      and evaluation boards, which its 10-K says depend on a small, limited
      set of unnamed manufacturing partners for modules and boards. Not a
      single company — this entry stands for that narrow contract-manufacturing
      base rather than one identified supplier.
customers:
  - name: Amazon (AWS)
    ticker: AMZN
    pct: 70
    blurb: >
      Astera's 10-K discloses that one end customer was more than 70% of 2025
      revenue without naming it; Amazon Web Services is the account widely
      reported to sit behind that figure, having been Astera's first major
      cloud customer and now the primary deployment vehicle for its Scorpio X
      scale-up fabric switches inside the Trainium accelerator programme.
      That dependency cuts both ways: AWS's move to put NVLink Fusion into
      Trainium 4 puts a visible clock on the current arrangement.
  - name: NVIDIA
    ticker: NVDA
    pct: 10
    blurb: >
      Astera's retimers and fabric silicon already ship inside NVIDIA HGX,
      MGX and NVL72 platforms, and the two companies expanded their
      collaboration so Astera can build NVLink Fusion connectivity into its
      platform. NVIDIA functions less as a conventional buyer than as the
      gatekeeper whose reference designs and ecosystem specifications decide
      whether Astera's parts get designed into the racks hyperscalers order.
  - name: Microsoft
    ticker: MSFT
    pct: 6
    blurb: >
      Microsoft is one of the hyperscalers whose Azure AI buildout pulls
      PCIe/CXL retimer and smart-cable content at volume, and is a plausible
      constituent of the roughly 86% of 2025 revenue Astera attributes to its
      top three end customers. Azure's scale means design-win decisions there
      move Astera's revenue in steps rather than increments.
  - name: Meta Platforms
    ticker: META
    pct: 4
    blurb: >
      Meta's AI infrastructure spending and its open rack and MTIA
      accelerator work make it a natural consumer of third-party connectivity
      silicon, and Astera has positioned its Scorpio P-Series scale-out
      switches at exactly this class of hyperscaler design win.
  - name: Alphabet (Google)
    ticker: GOOGL
    pct: 3
    blurb: >
      Google's TPU racks are more vertically integrated than most, which
      limits how much connectivity content it buys outside, but it remains
      one of the small number of hyperscalers capable of moving Astera's
      volumes if a design win lands.
  - name: Advanced Micro Devices
    ticker: AMD
    pct: 3
    blurb: >
      AMD's Instinct accelerator platforms and its push behind open scale-up
      standards make it the most credible non-NVIDIA accelerator ecosystem
      for Astera's switches and retimers to attach to, giving Astera a hedge
      against any single accelerator vendor's roadmap.
  - name: Dell Technologies
    ticker: DELL
    pct: 2
    blurb: >
      Dell is among the system OEMs Astera's 10-K cites as a customer
      category alongside hyperscalers. OEM AI server platforms carry Astera
      retimer content, though at far smaller volumes than the direct
      hyperscaler business.
  - name: Hewlett Packard Enterprise
    ticker: HPE
    pct: 1
    blurb: >
      HPE's AI and HPC server lines are part of the same System OEM channel,
      where Astera's PCIe/CXL signal-integrity parts are designed into
      platforms sold onward to enterprise and government buyers.
  - name: Super Micro Computer
    ticker: SMCI
    pct: 1
    blurb: >
      Supermicro builds AI server and rack systems at high volume around
      NVIDIA and AMD platforms, making it another OEM route through which
      Astera's connectivity silicon reaches end users indirectly.
---
