---
name: sleep
version: "1.0.0"
description: "Ritsu nightly self-evolution engine. Reviews ctx logs, proposes Skill improvements."
author: "3kaiu"
license: "MIT"
homepage: "https://github.com/3kaiu/Ritsu"
tags: ["meta-loop", "self-evolution", "skillopt"]
when_to_use: "Scheduled trigger (daily 23:00) or manual /r-sleep"
total_steps: 5
---

# Sleep: Skill Self-Evolution Engine

This skill implements Microsoft SkillOpt-Sleep nightly self-evolution plugin to optimize static Ritsu skills based on historical traces.

## Pipeline Steps

### 1. Experience Mining
- Scan today's \`ctx-YYYY-MM.jsonl\` files.
- Group entries by skill and identify all execution success/failure traces.
- Skip analysis if the number of traces is less than \`minSampleSize\`.

### 2. Pattern Consolidation
- Aggregate errors and failure messages.
- Identify high-frequency failures (e.g. if the same rule violation or test timeout happens >3 times).

### 3. Bounded Edit Proposal
- Load current \`SKILL.md\` files for target skills.
- Use \`proposeSkillOptimization\` to generate a new candidate version.
- Restrict modifications to \`textualLearningRate\` edit operations (adds/deletes/replacements) to avoid negative transfer.

### 4. Offline Replay & Validation
- Run validation check \`validateSkillProposal\` comparing old and new skill versions against historical failure logs.
- If the new version fails validation, save the candidate to the rejected edits buffer so we don't repeat the proposal.

### 5. Stage for Review
- For proposals passing the validation gate, write them as PRs or stage them in \`.ritsu/skill-optimizer/proposals/\` for human review.
- Await developer approval before modifying source skill files.
