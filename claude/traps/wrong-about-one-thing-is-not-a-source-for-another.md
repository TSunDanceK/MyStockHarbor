# A file shown wrong about one thing is not a source for another thing in it

Found 2026-09-12, in the same afternoon that established
`lib/server/redisBandwidth.ts:5` has the billing model backwards.

Having demonstrated that file wrong about which meter bills, its header prose was
then used as the authority for a different claim in the same file: that the three
plays builders *"read ~700 symbols each, one at a time."* That sentence supplied
the **~700 multiplier** on which the whole instrumentation estimate rested, and
it was never verified.

The shape of the claim turned out to be right — all three builders do call the
singular `getDailyHistory` per symbol, confirmed in code and independently
corroborated by `claude/fmp-history-payload-audit-2026-08-30.md`. **The count
still is not verified.** The estimate was lucky, not sound.

The pull is specific and worth naming: having just disproved a file, it feels
*already audited*. The opposite is true — a file with one demonstrated defect has
shown that its comments were not being maintained against reality, which is
weaker evidence for every other comment in it, not stronger.

- **Discrediting one claim in a file does not partition it into a bad half and a
  trustworthy half.** Comment rot is a property of the file's upkeep.
- **The multiplier deserves the same scrutiny as the thing multiplied.** Six
  writes per read was verified from code in minutes; the ~700 it was multiplied
  by came from prose and was not.
- **Corroboration must come from a different file.** The plays read shape was
  only settled once it was read out of the three builders and cross-checked
  against a document that is not `redisBandwidth.ts`.
