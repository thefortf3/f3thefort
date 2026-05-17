# STATE — LLM-Powered Dynamic Newsletter

## Current Status
**Phase: Build — 7 of 7 tasks complete**

### Completed
- [x] Add `@ai-sdk/openai-compatible` dependency (npm installed)
- [x] Add LLM env vars to `.env` (LLM_BASE_URL, LLM_MODEL, LLM_TEMPERATURE)
- [x] Create `generate-variety.mjs` (LLM call → variety-plan.json)
- [x] Create `newsletter-email.html` (email-safe template with placeholders)
- [x] Modify `newsletter.html` (web preview — added hero, quote, minimal, story card CSS + examples)
- [x] Rewrite `generate-newsletter.mjs` (CLI workflow + dual HTML output + LLM integration)
- [x] Test: `--preview`, `--render`, `--no-llm`, error handling

### Not Started
- [ ] Run `npx drizzle-kit push` if schema changes needed (none planned)

---

## What Needs to Happen Next

### 1. Rewrite `generate-newsletter.mjs`
The current file is a static HTML generator. It needs to become:

**CLI commands:**
| Command | Behavior |
|---------|----------|
| `node generate-newsletter.mjs` | Default: LLM → generate previews → interactive prompt → render both HTMLs |
| `node generate-newsletter.mjs --preview` | Generate variety plan + previews only, no final render |
| `node generate-newsletter.mjs --render` | Render both HTMLs from existing variety-plan.json |
| `node generate-newsletter.mjs --regenerate` | Regenerate via LLM from scratch |
| `node generate-newsletter.mjs --no-llm` | Static mode (current behavior, no LLM) |
| `node generate-newsletter.mjs --plan variety-plan.json` | Use existing plan file |

**Interactive CLI workflow (default mode):**
```
1. LLM generates variety-plan.json + newsletter-preview.html + newsletter-email.html
2. Opens preview in browser
3. Prompts: "Accept (A), Edit (E), Regenerate (R)?"
   - A: Accept → write final files
   - E: Open variety-plan.json in $EDITOR → after save, re-render both HTMLs, return to prompt
   - R: Call LLM again → new plan
4. On LLM error: "LLM unavailable. Fix and run: node generate-newsletter.mjs"
```

**Key functions to add/modify:**
- `readVarietyPlan(path)` — load variety-plan.json
- `buildWebHTML(staticData, submissions, fngStats, varietyPlan)` — render web preview with varied card types
- `buildEmailHTML(staticData, submissions, fngStats, varietyPlan)` — render email-safe table-based HTML
- `interactivePrompt()` — readline accept/edit/regenerate loop
- CLI flag parsing for --preview, --render, --no-llm, --regenerate, --plan

### 2. HTML Template Rendering Logic

**Web preview (`newsletter-preview.html`):**
- Uses existing CSS classes: `.event-card--hero`, `.event-card--quote`, `.event-card--minimal`, `.event-card--story`
- Includes section intros (italic paragraphs above section headers)
- Includes narrative bridges between sections
- FNG tracker section with progress bar + new FNGs list

**Email version (`newsletter-email.html`):**
- Uses `newsletter-email.html` as base template
- Fills placeholders: `{{TITLE}}`, `{{EYEBROW}}`, `{{SUBTITLE}}`, `{{ISSUE_BAR}}`, `{{SECTIONS}}`, `{{FOOTER}}`
- Each card type is a different table structure with inline styles:
  - `hero`: nested table, accent border, "Featured" badge span, larger padding/fonts
  - `standard`: simple table, current padding, subtle border
  - `quote`: single-cell centered table, large italic font, no header row
  - `minimal`: no table, just inline text with spacing
  - `story`: table with wider content cell, left accent border
- Google fonts via `<link>` in `<head>`
- Max width 600px, table-based layout, all inline styles

### 3. Card Format Mapping

The variety-plan.json `events` array has `format` field:
- `hero` → exactly one event (the featured one)
- `standard` → default for most events
- `quote` → AARs, memorable descriptions
- `minimal` → quick-list items (volunteer drives, recurring events)
- `story` → community events, multi-part events

### 4. File Reference Points

**generate-newsletter.mjs current structure:**
- Lines 1-31: CLI args, DB path, static data path
- Lines 36-93: Data loading functions (loadStaticData, getSubmissions, getFngStats, formatDate, getIssueDate)
- Lines 215-857: `buildHTML()` function — generates single HTML string
- Lines 859-932: Helpers + main execution

**generate-variety.mjs:**
- Already complete — queries DB, calls LLM, outputs variety-plan.json
- Uses `@ai-sdk/openai-compatible` with `generateObject()` and Zod schema
- LLM endpoint: `http://aibot:13305/v1`

**newsletter-email.html:**
- Template with placeholders: `{{TITLE}}`, `{{EYEBROW}}`, `{{SUBTITLE}}`, `{{ISSUE_BAR}}`, `{{SECTIONS}}`, `{{FOOTER}}`
- Needs rendering logic to fill these placeholders with varied card content

**newsletter.html:**
- Web preview template — already updated with new card CSS
- Needs rendering logic to generate dynamic HTML from variety-plan.json

---

## Key Decisions (from earlier planning)

1. **LLM API:** Local Qwen at `http://aibot:13305/v1`, model `user.Qwen3.6-35B-A3B-MOE-Thinking`
2. **LLM outputs JSON plan, not HTML** — renderer handles both web and email HTML from same plan
3. **Description rewriting:** LLM rewrites with F3 voice, keeps all facts, fixes mistakes
4. **No DB schema changes** — variety plan stored as JSON file
5. **Two HTML outputs:** `newsletter-preview.html` (web) + `newsletter-email.html` (email)
6. **Mailchimp constraints:** table layout, inline styles, no flexbox/grid, no CSS classes for cards, max 600px
7. **Google fonts OK** for email version
8. **HTML only** (no plain-text fallback)
9. **F3 jargon section names** kept as-is
10. **Error handling:** clear error message, wait for manual retry

---

## Environment Variables

```
LLM_BASE_URL=http://aibot:13305/v1
LLM_MODEL=user.Qwen3.6-35B-A3B-MOE-Thinking
LLM_TEMPERATURE=0.7
```

## Dependencies

```
@ai-sdk/openai-compatible  (installed)
```

## Next Immediate Step

All build tasks complete. The rewritten `generate-newsletter.mjs` supports:

**CLI commands:**
- `node generate-newsletter.mjs` — Default: LLM → generate previews → interactive prompt → render
- `node generate-newsletter.mjs --preview` — Generate variety plan + previews only
- `node generate-newsletter.mjs --render` — Render both HTMLs from existing variety-plan.json
- `node generate-newsletter.mjs --regenerate` — Regenerate via LLM from scratch
- `node generate-newsletter.mjs --no-llm` — Static mode (current behavior, no LLM)
- `node generate-newsletter.mjs --plan FILE` — Use existing plan file

**Outputs:**
- `newsletter-preview.html` — Web preview with varied card types (hero, standard, quote, minimal, story)
- `newsletter-email-rendered.html` — Email-safe table-based HTML with inline styles

**Interactive loop:**
- Accept (A), Edit (E), Regenerate (R), or Quit (Q)
- Edit opens `$EDITOR` on variety-plan.json, then re-renders both HTMLs
