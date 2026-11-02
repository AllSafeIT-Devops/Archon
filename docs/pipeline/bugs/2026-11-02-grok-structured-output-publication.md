# Grok structured output corrupts publication intent

Filing status: pending-filing. GitHub Issues are disabled on AllSafeIT-Devops/Archon; the authenticated issue-list operation confirmed this on 2026-11-02.

Confidence: confirmed.

Observed: the owner-selected codex/grok-4.7 continuation on engine 54dd165b47f0696214ff912f0e9a4043ffe5b8b0 completed implementation, then failed at deliver__rounds.pr__prepare because its final response was invalid JSON. Repository, branch and title strings contained malformed backslashes. PR3376's published head a7cf2e5231fcc44ad75f2f1eeee7cb0318722a9c remained open and mergeable. Native run722e2385037349672e0834abca896997 ended failed, not delivered.

Expected: structured publication intent must retain the real qualified repository/branch/title values, parse as JSON, and satisfy the declared schema before the deterministic publisher acts. A failed node must never be marked delivered merely because a branch was pushed.

Reproduction/evidence: an isolated authenticated CodexProvider.sendQuery request to grok-4.7 used the captured archon-pr prepare schema and a fixed fixture object. Native outputSchema mode shortened every requested string to one character (github.com became g; fixture/grok-json became f). A fresh request to the same model carrying the schema in the prompt, without native outputSchema, returned every exact expected value. The original failed response and both probe results are retained in the quotes recovery evidence; no live resource was written by the probe.

Source locations: packages/providers/src/codex/provider.ts buildOutputSchema, turn/start parameters and completeTurn; packages/providers/src/shared/structured-output.ts augmentPromptForJsonSchema; captured bundled workflows/sdlc/pr/archon-pr.yaml prepare output_format.

Attribution: acceptance-dependency. The generic Codex native schema transport does not preserve the required Grok output in the verified gateway. The earlier Grok binding repair proved native execution and same-run preservation with a marker, but did not certify this rich structured-output seam.

Severity and impact: Important. Blocks publication completion and therefore the approved quotes release. Completed implementation, previous attempts, sessions, cumulative usage and existing PR must be retained.

Release disposition: fix-current as a supporting dependency of owner-authorized Grok substitution. Keep product scope and all slice acceptance unchanged.

Promotion blocker: yes for the quotes release. Clear with behavioral RED/GREEN transport coverage, an authenticated rich-schema probe through the final implementation, a guarded same-run continuation, final whole-head independent admission/provenance reviews, and all ordinary release evidence.

Next action / owner: Codex controller. Use prompt schema delivery only for the verified grok-4.7 transport; retain strict final JSON parsing and engine schema validation. Add a narrowly admitted, verified same-run retry for this exact output-contract failure; retain cap, brake, slot, identity and ambiguity checks. Do not guess missing values, edit saved snapshots/statuses, repeat old triage recovery, or create another run/PR.

Origin: AllSafeIT-Devops/Archon PR1 supporting AllSafeIT-Devops/allsafe-hub PR3376 and work order3397.
