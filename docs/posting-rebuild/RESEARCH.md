# Post approval and client portal: what other tools do, and what MD Media should build

*Research date: 29 Sep 2026. Everything here comes from the vendor pages listed in section 5. Where a claim comes only from a marketing page, a blog or a search snippet, it is marked. "Not found" means the researchers looked and could not confirm it. It does not mean the feature is missing.*

---

## Summary

- **Freezing what the client saw is rare.** No tool was found that freezes the exact version sent to the client and shows the client what changed. Planable has an optional lock. Agorapulse makes approved posts read-only, but an edit does not reset approval. MD Media's plan to freeze versions at send would put it ahead of all of them.
- **Tools choose one of three rules for a post still waiting at posting time:**
  - Hold it and say so: Sprout, Hootsuite, Loomly, Agorapulse.
  - Post it anyway: Later always does this. SocialPilot does it if you turn on Auto-Approve.
  - Publish it as soon as someone approves late: Sendible.

  The safe tools make the missed time a visible state, such as "Expired" or "Passed".
- **Zernio publishes straight away if it is given a posting time that has already passed.** Its docs say so. So a post approved late and re-booked at its old time goes out at once. The app must check for this itself.
- **Instagram's API allows 10 carousel items. The Instagram app allows 20.** Every tool read caps at 10. Only Planable makes the user choose, rather than cutting quietly. Zernio does not document what it does with more than 10 items.
- **No tool was found with comments pinned to one carousel slide or one spot on a social post image.** Gain, Frame.io and Filestage do this for files and video. This is a gap.

---

## 1. Comparison table

| Tool | Stages | Client experience | Feedback | Versions | Deadlines and reminders | After approval |
|---|---|---|---|---|---|---|
| **Planable** | Workflow per workspace: None, Optional, Required, Multi-level (Enterprise only). Draft → Pending → Approved → Scheduled. No "changes requested" state found. | Client needs an account (approver accounts are free). Public links let clients view and comment but **cannot approve**. Has a mobile app and a grid preview. | Threaded comments, @mentions, resolve. Text annotations and caption suggestions the creator accepts or declines. Yellow internal notes. Caption text only, no image pins. | Version history with restore. Optional "Lock content after approval": to edit, you must unapprove. | Reminders are off by default: one 48h after the request, one 24h before posting. They only fire if the post was booked at least 2 days out. No deadline field. | Optional auto-schedule on approval. |
| **Gain** | Drafts, Pending Approval, Revision Requested, Ready for Next Round, Approved, Scheduled, Pending Manual Publishing, Live. Rounds can be "everyone" or "any one" approver. | Magic link with no password (one use or 24h). A private queue per stakeholder. Bulk approve. Previews of carousels and the grid. | Request Changes with a comment. Drag-to-highlight on images and PDFs. Team-only activity feed with tasks. | Keeps the old file version with its annotations. Admins can edit until the post is scheduled. Re-approval after an edit "can be" sent: not confirmed as automatic. | Reminders at 6, 12, 24, 48 and 72h. The client can turn them off. One email per batch. No deadline. | Auto or manual publish per round. The team can approve for the client, with a required reason that is logged. |
| **Kontentino** | Separate internal and client statuses (Pending Internal Approval, Internal Rework, Pending Client Approval, Client Rework, Approved by Client…). Colour-coded. | Client logs in and takes a seat (help centre). Magic link since May 2026. The marketing page claims no-login links with no seat: this contradicts the help centre. Clients never see drafts. | Internal and Client comment tabs per post. Pinned messages. A system message for each approval request. | Versions are kept once a post is sent to the client. Editing anything except the time on a booked post takes it off the queue. No lock after client approval. | No reminders or deadlines in the help centre (claimed only on the blog). Booking is locked while the client is deciding. | Does not book itself. An admin or manager books it. |
| **Later** | Approval is only a flag on a post: Approve or Request changes. | No-login review link that expires in 7 days. Instagram-only calendar share that expires in 48h. Desktop only. | Whole-post comments with no email notifications. | Not found. | None. **Unapproved posts still publish at their time.** | No effect. Approval does not control booking. |
| **Loomly** | Choose per calendar: Zero, Lite or Original workflow. Custom workflows add State Guards (with "Overrideable By") and Assignment Triggers. A post not Scheduled by its time becomes **Passed** and does not go out. | Client needs an account. No no-login link found. Mobile app. Grid preview. | Whole-post comments, @mentions, pins, and a Private setting (can be the default). Changing a status alone notifies nobody. | Caption changes are logged. Asset versions are claimed on the marketing page only. | No deadline or reminders. "Passed" is the result. | Original workflow needs a separate Schedule click. Lite makes approving the same as booking. |
| **Sprout Social** | Draft → Needs Approval → named steps ("Any" or "All" approvers, "X of Y approved") → Approved → Sent. Plus Rejected, Expired approval, and auto-reject after 90 days. | External approvers need no account (top plan only, maximum 3). One batched email, about 5 minutes after the last post is assigned, opens one list of everything waiting. Shows a network preview. | Internal and External comment tabs. Reject with a note. Guide: comment rather than reject. | Approvers can edit after approval. Approvals cannot be revoked. No freeze found. The history disappears after final approval. | Must be approved 5 minutes before posting time or the approval expires: not posted, the author is told. Daily digest and hourly nudges. The client is warned 24h and 1h before. | Approval books the post automatically. Admins can let some users skip a step. |
| **Hootsuite** | Pending → Approved, Rejected, Expired. Up to 3 levels per social account. Automated compliance check first (Enterprise). | No way found for a client to approve without an account. "Document external approvals" records an approval given elsewhere. | Rejection and approval notes. No comment threads found. | The blog says approved posts are locked and edits go back through approval. The help centre does not say this. | A post not approved by its time moves to the Expired queue. Approve 5 minutes before (15 for video). | Approved posts are booked at once. "Mark as Approved (Bypass)" is logged. |
| **SocialPilot** | Pending Review → Approve / Send for Client Approval / Send back → Queued. | No-login portal link per client, valid until the agency refreshes it, plus emailed links. Product page mentions PC and tablet only. | Public comments (client sees) and Team comments (client never sees). @mentions. System events appear in the thread. | No version history. Schedulers cannot edit approved posts, but managers and clients can. | Optional Auto-Approve per client: posts 1h before the time if the client is silent. | Auto-queued. |
| **Sendible** | Approval is a task: For Me, For Others, Done. "Mark as Done" does not mean approved. | Client logs in with a password. No link found. | Comments on the task. A comment on a Done task does not reopen it and gets missed. | Not found. | No reminders. Past-due tasks show "Received on". **Approving one publishes it at once.** | Publishes at the booked time. |
| **ContentStudio** | In Review → Accepted, Rejected → Scheduled. "Anyone" or "Everyone" rule. | Magic link. Share link for chosen posts, with an optional password; these reviewers can approve. The calendar link is a frozen copy that goes stale. | Comments, @mentions, internal notes. | An activity log only (product page). | No reminders. The team can "force publish" or rebook. | Scheduled. |
| **Agorapulse** | To Approve → Approved → Scheduled, or Rejected. Workflows with several steps; the client step is its own step. | Shared Calendar via a magic-link email, valid 60 days. **Desktop only.** Client emails are off by default. | Internal and external comments. A rejection goes back to the sender automatically. | Approved posts become read-only, but an admin edit does not reset approval. | An unapproved post does not publish (5-minute grace). No reminders. | Scheduled. |

---

## 2. Ten ideas worth copying

1. **Approval belongs to one exact version.** Freeze the post when it is sent. Any edit clears the approval and needs a clear unapprove.
   - Planable: "Lock content after approval" covers text, media, time, image order and link.
   - Metricool: "The previous review is reset."
   - Ziflow keeps a record of the exact version that was approved.
   - Sources: Planable Unapprove / Approvals articles; help.metricool.com; ziflow.com/blog/online-proofing-faq-llm-first
2. **Approving for the client is its own logged result.** Only certain roles can do it, and they must give a reason.
   - Gain: "Mark Approved", limited to owner, admin or publisher, with a required reason.
   - Hootsuite: "Document external approvals" and "Mark as Approved (Bypass)", both in the history and the CSV export.
   - Sources: help.gainapp.com/article/133; hootsuite.com/whats-new/document-external-approvals
3. **A missed approval time becomes a loud state, not a quiet "queued".**
   - Sprout: "expired approval". The post is not published and the author is told.
   - Hootsuite: Expired queue.
   - Loomly: "Passed".
   - Sources: Sprout Message Approval Workflows; help.hootsuite.com approve-posts; Loomly "Why is my post in the Passed status"
4. **Reminders timed from the posting time, not only from when the post was sent.**
   - Sprout: tells external approvers 24h and 1h before posting.
   - Planable: 24h before posting.
   - Ziflow: before, on and after the due date.
   - Sources: Sprout External Approvers; Planable Automated reminders
5. **One personal client link that lists everything waiting on them**, not one link per post.
   - Sprout: a single list of every post waiting.
   - Gain: a private queue showing network, account, type and posting date.
   - Also Metricool and Sked.
   - Sources: Sprout External Approvers; help.gainapp.com/article/141; help.metricool.com
6. **Batched notifications.** Send one email per batch, not one per post.
   - Gain: no new email while earlier items are still waiting.
   - Sprout: one email about 5 minutes after the last post is assigned.
   - Sources: help.gainapp.com/article/133; Sprout External Approvers
7. **Internal and client notes kept apart on the same post, so the client cannot see team notes.**
   - Kontentino: Internal and Client tabs.
   - Sprout: Internal and External comments.
   - SocialPilot: Public and Team comments.
   - Loomly: Private comments, and Private can be the default.
   - Sources: help.kontentino.com/en/articles/8825336; help.socialpilot.co/article/658
8. **Notes go to one named person automatically.**
   - Agorapulse: a rejection goes back to the sender automatically.
   - Loomly: moving a post into a status assigns the next person.
   - Frame.io: an @mention notifies one person.
   - Sources: support.agorapulse.com/en/articles/10353571; Loomly collaboration workflows
9. **Editing a booked post takes it off the queue.**
   - Kontentino: changing only the time keeps it booked. Changing the text or media sets it back to "Approved by client" and it must be booked again.
   - Source: help.kontentino.com/en/articles/6243643
10. **Check each network's limits before QC or the client sees the post, and make the user choose rather than trimming quietly.**
    - Planable: with more than 10 slides, you either publish all 20 by phone or trim to 10.
    - Sendible checks posts during approval as well as when editing.
    - Zernio has a dry-run check, `/v1/tools/validate/post`.
    - Sources: headwayapp.co/planable-updates/…319176; sendible.com/changelog/12-august-2025; docs.zernio.com

---

## 3. Recommendations for the rebuild

These fit the decisions already made:
- One stage per post.
- Versions are frozen when sent.
- Client approval is optional per post, and the team may approve for the client.
- A quality checker reviews every post.
- Schedulers book, move and cancel.
- Post approval and Schedule are separate pages.

The problems they answer:
- **P1** Labels and columns disagree between pages.
- **P2** The client sees files that changed after sending.
- **P3** Popups that lead nowhere.
- **P4** Missed posting times while waiting on the client.
- **P5** Notes do not reach the right person.
- **P6** Instagram carousels cut to 10 without warning.

### Must have

| # | What | Problem | Based on |
|---|---|---|---|
| M1 | **One list of stage names in one place.** Both pages read their labels, colours and columns from it. Name client stages separately from internal ones, so "Waiting on client" never means "Waiting on QC". | P1 | Kontentino's separate internal and client statuses. Gain's distinct "Ready for Next Round". |
| M2 | **Freeze a snapshot at send**: media files, caption, networks, slide order and posting time. The QC pass and the client decision point at that snapshot. Any edit makes a new version and clears the earlier approvals. The client only ever sees a frozen version. | P2 | Planable lock plus unapprove. Metricool reset. Ziflow version record. No tool found does all of this, so it is MD Media's edge. |
| M3 | **Block Instagram carousels over 10** in the composer, at the QC hand-off and on the approval card. Offer a clear choice: drop slides, split into two posts, or post by hand. Let LinkedIn (20 images) and TikTok (35 photos) keep more, using Zernio's per-network `customMedia`. **Test on a test account what Zernio does with more than 10**: its docs are silent. | P6 | Meta API limit of 10. Planable's choice screen. Zernio per-network overrides. |
| M4 | **An "approve by" time on every post that needs the client, and a stated rule for what happens at posting time.** Default: hold the post, move it to a visible **Missed / Expired** state, and tell the scheduler. Never pass Zernio a posting time that has already passed (Zernio publishes those at once). A late approval sends the post back to Schedule to be booked again. It must not go out on its own. | P4 | Sprout "expired approval", Hootsuite Expired queue, Loomly Passed. Zernio post-lifecycle docs. Sendible's "approve = publish now" trap. |
| M5 | **"Approved for the client by [team member]" as its own result**, never shown as "Client approved". It needs a reason and how the client agreed (call, email, WhatsApp). Only some roles can do it, and it is logged. | P4, P1 | Gain override with a reason. Hootsuite "Document external approvals". |
| M6 | **Two note threads per post: Team and Client.** Team is the default, and the visibility is shown plainly (lock icon or colour). Every "changes requested" goes to a named person: the author, or the scheduler for timing changes. That person gets a notification. | P5 | Kontentino tabs, Sprout internal and external, Loomly Private default, Agorapulse auto-return. Loomly's trap: a status change alone notified nobody. |

### Should have

| # | What | Problem | Based on |
|---|---|---|---|
| S1 | **Decide in place.** Approve, request changes and comment from the post view itself. Use a popup only to cancel a booked post, and then show everything needed in it. Every popup needs a way forward. | P3 | NN/g on modal dialogs. Planable approves from the feed. |
| S2 | **Reminders timed from the "approve by" time**: for example, 24h before and 1h before, sent during business hours. The team cannot let a post near its deadline go silent. | P4 | Sprout 24h and 1h warnings. Filestage business-hours sending. Planable's 24h-before reminder. |
| S3 | **One client link that stays open until the agency revokes it.** It shows everything waiting on that client in one list: network, account, type and posting time on each row. Network-accurate previews, including every slide cropped to slide 1's shape. Works on a phone. Approve one post or all of them. Ask for the reviewer's name or email once, so every decision has a name on it. | P4, P2 | SocialPilot portal link, Gain queue, Sprout single list, Cloud Campaign phone-first approval, Meta rule that slides crop to slide 1. |
| S4 | **One batched email per client per round**, with the team's note inside it. | P5 | Gain, Sprout. |
| S5 | **When a re-sent version reaches the client, show what changed** since the version they last saw. | P2 | Filestage and Ziflow side-by-side comparison (on files). No social tool found does this. |
| S6 | **Editing the content of a booked post takes it off the queue** and sends it back through QC or the client. Moving only the time keeps it booked. | P2 | Kontentino. |
| S7 | **Run Zernio's `validate/post` dry-run when a post goes to QC**, not only when it is booked. | P6 | Zernio docs, Sendible. |

### Later

| # | What | Problem | Based on |
|---|---|---|---|
| L1 | Comments tied to one carousel slide or one spot on an image. Caption edits the author accepts or declines. | P5 | Gain annotations (files only), Planable suggestions (caption only). No social tool found pins to a slide. |
| L2 | A per-client default for "what happens if silent": hold, a grace period (Metricool: 3h), move to the next slot (Kontentino blog), or post anyway for low-risk content if the contract allows. Keep "hold" as the default. | P4 | Metricool, SocialPilot Auto-Approve, Swydo guide. |
| L3 | Approval reports per client: time to approve, revision rounds, how often the team approved for the client, posts missed while waiting. | P4 | Filestage insights, Hootsuite and Ziflow blogs. |
| L4 | An exportable record per post: the approved version, who decided, when, and the notes. | P2 | Ziflow evidence report, Hootsuite CSV, Gain download. |
| L5 | A named backup approver, and escalation when a deadline is missed. | P4 | Ziflow, Cloud Campaign. |

---

## 4. Traps to avoid

- **Approval that does not control publishing.** At Later, unapproved and rejected posts still go out at their time.
- **Approving a late post publishes it at once.** Sendible does this, and Zernio does the same with a posting time in the past. Always send a late approval back to Schedule.
- **A lock you can switch off**, or edits that do not reset approval: Planable with the lock off, Agorapulse, Sprout and Kontentino. The client approves one version and a different one goes out.
- **Status changes that notify nobody.** In Loomly, a status change alone emails no one. At Later, comments send no email.
- **Two actions that look like approval.** Sendible's "Mark as Done" is not "Approve", and comments on done tasks get missed.
- **A manual override that is not logged.** Kontentino's fix for a slow client is a hand-set status, labelled only as a bypass.
- **Reminders that ignore the posting time.** Gain's fixed 6–72h schedule, Planable's rule that skips posts booked less than 2 days out, and Gain letting clients switch reminders off entirely.
- **Client links that cannot approve** (Planable public links), **links that only work on a desktop** (Agorapulse, Later), and **links that expire fast** (Gain: one use or 24h; Later: 48h to 7 days) without a "send me a new link" button.
- **Freezing the whole list instead of the post.** ContentStudio's calendar link is a frozen copy, so new posts never appear on it. Freeze each post's version, and keep the client's list live.
- **History that disappears.** Sprout hides the approval history once a post is approved. Posts also get stuck when an approver leaves the account.
- **Trusting documentation over a test.** Zernio and Meta disagree on the maximum Reel length (90 s vs 15 min) and the allowed feed image shapes. Buffer says custom Reel covers are impossible, while Meta documents them. Check each on a test account.
- **Carousels trimmed without warning.** Every tool read caps Instagram at 10 through the API. None was found to warn when there are more, and Zernio's behaviour is undocumented.

---

## 5. Sources

**Planable:**
- help.planable.io/hc/en-us/articles/…
  - 21715462785180 (Approvals and workflows)
  - 21715417710876 (Multi-level)
  - 21715207498652 (Requesting approval)
  - 27486527769500 (Reminders)
  - 28555055158044 (My approvals)
  - 28043963146140 (Approving content)
  - 22581435847324 (Client approval)
  - 21715458842652 (Sharing with external collaborators)
  - 21715470688284 (Review links)
  - 21715398237212 (Internal and external collaboration)
  - 21715366240668 (Team or client membership)
  - 22072063868444 (Permissions)
  - 21799230221980 (Leaving feedback)
  - 21799103758108 (Suggestions)
  - 21799152349852 (Annotations)
  - 21715209111836 (Internal notes)
  - 21715262758300 (Resolve comments)
  - 21715515108764 (Edit a post)
  - 21715307378204 (Auto-schedule on approval)
  - 21715231605788 (Unapprove)
  - 21715343755804 (Invite link)
  - 21715228636444 (Orange dot)
  - 21715388565276 (Photo and caption limits)
  - 21715295163292 (Multi-image post)
- https://planable.io/guides/content-approvals-in-planable/
- https://headwayapp.co/planable-updates/instagram-carousel-up-to-20-images-support-319176

**Gain:**
- help.gainapp.com/article/134, 133, 54, 135, 141, 125, 69, 89, 142, 220, 136, 127
- https://gainapp.com/features/approving
- https://blog.gainapp.com/guide-gain-notifications-approvers/

**Kontentino:**
- help.kontentino.com/en/articles/12525413, 9556227, 9556245, 13318660, 12622637, 12542666, 8825336, 9857555, 7066930, 15517299, 14128505, 6243643, 14114880, 14087799, 14140304, 6243655, 7995045, 4656758, 8680435
- https://www.kontentino.com/features/
- https://www.kontentino.com/client-approvals
- https://www.kontentino.com/blog/social-media-client-approval/
- https://www.kontentino.com/blog/kontentino-vs-planable/

**Later:**
- help.later.com/hc/en-us/articles/40954654500375, 360042743434, 360043244233, 360042773934, 36919457087639, 360042609854
- https://later.com/social-media-approval-workflow/

**Loomly:**
- loomly.zendesk.com/hc/en-us/articles/39019477164187, 39019482026395, 39019140485403, 39081998474267, 39019855278107, 39019223591323, 39256542800027, 38970687455131, 39019606494363, 39019573743643, 39082040100635, 38832352341531, 39256380503323, 38818394484635, 38858159797275
- https://www.loomly.com/features/collaboration-approvals

**Sprout Social:**
- support.sproutsocial.com/hc/en-us/articles/205974715, 9385327882125, 360042108512
- https://media.sproutsocial.com/uploads/Sprout-Social-Message-Approval-Product-Guide.pdf
- https://sproutsocial.com/insights/strengthen-agency-client-relationships/
- https://sproutsocial.com/insights/social-media-approval/
- https://sproutsocial.com/insights/social-approval-process-agency/

**Hootsuite:**
- https://help.hootsuite.com/s/article/set-up-approvals?language=en_US
- https://help.hootsuite.com/s/article/approve-posts?language=en_US
- help.hootsuite.com/hc/en-us/articles/4414603447323, 1260804251730, 1260804249750
- https://help.hootsuite.com/s/article/overview-teams-orgs-permissions?language=en_US
- https://help.hootsuite.com/s/article/bulk-schedule?language=en_US
- https://www.hootsuite.com/whats-new/document-external-approvals
- https://www.hootsuite.com/whats-new/enhanced-flexible-approvals
- https://www.hootsuite.com/platform/social-media-approval-tool
- https://www.hootsuite.com/industries/agencies
- https://blog.hootsuite.com/social-media-approval-workflow/

**SocialPilot:**
- help.socialpilot.co/article/339, 658, 343, 576, 573, 630, 444
- https://www.socialpilot.co/features/approvals-on-the-go
- https://www.socialpilot.co/product-update/share-socialpilot-calendar

**Sendible:**
- support.sendible.com/hc/en-us/articles/208052076, 208052616, 208052686, 360014576251, 115000122783, 37106656204317, 217099066
- https://www.sendible.com/insights/task-approvals-managing-clients-content
- https://www.sendible.com/features/client-connect
- https://www.sendible.com/features/social-media-dashboard/white-label-software
- https://www.sendible.com/pricing
- https://www.sendible.com/features/social-media-collaboration/
- https://www.sendible.com/changelog/12-august-2025

**ContentStudio:**
- docs.contentstudio.io/article/717, 877, 1072, 1054
- https://docs.contentstudio.io/articles/how-to-approve-reject-a-post-d7d878b4
- https://changelog.contentstudio.io/approval-workflow-133811
- https://changelog.contentstudio.io/shareable-planner-first-comment-via-csv-upload-and-much-more-249254
- https://contentstudio.io/social-media-approval-workflow
- https://contentstudio.io/pricing

**Agorapulse:**
- https://support.agorapulse.com/en/collections/7505360-collaboration-content-approval
- support.agorapulse.com/en/articles/10346598, 10353571, 8773562, 12010367, 9979006
- https://www.agorapulse.com/pricing/
- https://www.agorapulse.com/features/shared-social-media-calendar/

**Best-practice sources:**
- https://help.skedsocial.com/difference-approvals-addons
- https://skedsocial.com/features/approvals
- https://help.metricool.com/how-to-approve-or-reject-a-scheduled-post-in-metricool-ku1nw
- help.filestage.io/en/articles/9112521, 3161155, 3161157, 7033846
- https://filestage.io/blog/social-media-approval-process/
- https://support.frame.io/en/articles/1161479-review-links-explained-for-clients-legacy
- help.frame.io/en/articles/9105232, 9105251
- https://www.ziflow.com/blog/online-proofing-faq-llm-first
- https://www.ziflow.com/blog/content-approval-workflow
- https://www.cloudcampaign.com/smm-tips/mobile-content-approval-platforms-marketing-agencies
- https://www.cloudcampaign.com/blog/client-approval-system-for-social-media-management-agencies
- https://www.swydo.com/blog/social-media-approval-process/
- https://www.nngroup.com/articles/modal-nonmodal-dialog/

**Platforms and Zernio:**
- https://developers.facebook.com/docs/instagram-platform/content-publishing/
- https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
- https://developers.facebook.com/docs/pages-api/posts/
- https://petapixel.com/2024/08/09/instagram-users-can-now-share-20-photos-videos-in-a-post-carousel-photodump/
- https://www.socialmediatoday.com/news/instagram-expands-carousels-to-20-frames/723792/
- https://developers.tiktok.com/doc/content-posting-api-reference-photo-post
- https://developers.tiktok.com/doc/content-sharing-guidelines
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/multiimage-post-api
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/documents-api
- https://docs.zernio.com/platforms/instagram
- https://docs.zernio.com/platforms/tiktok
- https://docs.zernio.com/guides/post-lifecycle
- https://support.buffer.com/article/657-scheduling-instagram-posts-and-reels

### Limits of this research

- Several help centres blocked direct fetching: Planable, Later, Loomly, Sprout, Sendible and Ziflow. Most were read through each vendor's public Zendesk article API instead.
- Some Hootsuite help pages returned 401 and were not opened.
- Two ContentStudio articles would not load.
- These claims come only from marketing, blogs or search snippets and are unconfirmed:
  - Hootsuite's lock after approval.
  - Kontentino's no-login links and reminders.
  - Loomly's asset version history.
  - ContentStudio's "Missed review" status.
  - How long Planable keeps versions on each plan.
- Zernio's handling of Instagram carousels with more than 10 items was not found and needs a test on a test account.