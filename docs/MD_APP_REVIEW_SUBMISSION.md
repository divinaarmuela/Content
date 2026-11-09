# MD App — Meta App Review submission text

Written 9 Nov 2026. Paste each block into the matching box in developers.facebook.com → MD App → App Review.
Clip numbers refer to `docs/MD_APP_REVIEW_SCRIPT.md`. Replace `[mm:ss]` with the second the feature appears once
the clips are recorded.

## App Verification Details (reviewer instructions)

```
MD Media is a social media agency in Melbourne, Australia. MD App is our internal dashboard: our team manages each
client's Facebook Page, Instagram account and ads from one place, after the client connects them with Facebook
Login for Business.

1. Go to https://app.mdmmarketing.com.au/sign-in
2. Email: mdmedia.metareview@gmail.com   Password: [PASSWORD]
   No two-factor step. If a verification code is ever requested, email mdmedia.metareview@gmail.com and we reply
   the same day.
3. You land on our test client "100 Hundred Million Group" → Social tab → the "Meta: Facebook, Instagram & Ads"
   card. Our test Facebook Page "MD Media Test", Instagram "@testbusinessaccount2026" and ad account
   "MDM Marketing" are already connected through Facebook Login for Business.
4. To test the login yourself, press "Connect again" and sign in with your Meta test account. Your own Page,
   Instagram account and test ad accounts then appear in the same tabs.
5. Where each permission is used (each matches the screen recording of the same name):
   - Inbox tab: Instagram and Facebook comments (read, reply, hide, delete); Instagram DMs and Messenger
     (read, reply within 24 hours); each person's name and profile picture.
   - Publish tab: publish to Instagram and the Page; edit and delete Page posts.
   - Insights tab: Instagram and Page results; the Pages on the connection.
   - Leads tab: leads from the Page's instant forms.
   - Ads tab: ad results; create and delete a paused test campaign (no budget, never spends).
   - "Live updates" switch: subscribes the Page to our webhooks.
```

## Permission descriptions

Each answers: what we use it for, how it helps the client, where it is in the app, which clip shows it.

**instagram_basic**
We read the client's Instagram professional account profile (username, profile picture, followers, number of posts) and their media so our team can see what has been published, pick a post to manage its comments, and show the account in reports. Shown in the Insights tab (Instagram card) and the Inbox post list. Clip 1 at [mm:ss].

**instagram_content_publish**
Our team publishes photos to the client's Instagram account from the Publish tab, on the client's behalf, as part of the content we produce for them. The person adds the photo and caption, sees a preview and presses Publish now; the post appears on Instagram. Clip 2 at [mm:ss].

**instagram_manage_comments**
We read comments on the client's Instagram posts in the Inbox tab so our team can answer customers quickly, and hide or delete spam and abusive comments. The reply appears under the post on Instagram. Clip 3 at [mm:ss].

**instagram_manage_messages**
We read the client's Instagram direct messages in the Inbox tab and our team answers customers within Meta's 24-hour standard messaging window. Replies are written by a person; we do not send promotional messages. The reply appears in the customer's Instagram inbox. Clip 4 at [mm:ss].

**instagram_manage_insights**
We read account-level and post-level insights (accounts reached, views, profile visits, interactions; per-post reach, likes, comments, saves, shares) to show the client how their content performs and to build their monthly report. Shown in the Insights tab. Clip 5 at [mm:ss].

**pages_show_list**
We list the Pages the client shared during Facebook Login for Business so the right Page is linked to the right client. Shown on the permission screen and in the Insights tab under "Facebook Pages on this connection". Clip 6 at [mm:ss].

**pages_read_engagement**
We read the client's Page posts (text, picture, link, comment count) so our team can see what is published and open a post's comments. Shown in the Inbox post list and the Publish tab's recent posts. Clip 7 at [mm:ss].

**pages_manage_posts**
Our team publishes, edits and deletes posts on the client's Facebook Page from the Publish tab, on the client's behalf. The change is visible on the Page. Clip 8 at [mm:ss].

**pages_read_user_content**
We read comments people leave on the client's Page posts, with the commenter's name and picture, so our team can respond to customers. Shown in the Inbox tab (Comments → Facebook). Clip 9 at [mm:ss].

**pages_manage_engagement**
Our team replies to, hides and shows comments on the client's Page posts from the Inbox tab, as the Page. The reply appears under the post on Facebook. Clip 10 at [mm:ss].

**pages_messaging**
We read the client's Messenger conversations and our team answers customers within the 24-hour standard messaging window, from the Inbox tab (Messages → Facebook). Replies are written by a person; no promotional or tagged messages. Clip 11 at [mm:ss].

**read_insights**
We read Page insights (views, people reached, post engagements, Page visits, new followers) to report the client's Facebook results. Shown in the Insights tab. Clip 12 at [mm:ss].

**pages_manage_metadata**
The "Live updates" switch subscribes the client's Page to our app's webhooks so new comments, messages and leads reach our team as they happen, without polling. Clip 13 shows the switch on and a new comment arriving at [mm:ss].

**leads_retrieval**
When someone submits the client's instant form, we retrieve the lead (name, email, phone and answers) so our team can follow up for the client. Shown in the Leads tab. Clip 14 at [mm:ss].

**pages_manage_ads**
Required with leads_retrieval to read leads from instant forms linked to the client's Page and their lead ads. Shown with the Leads tab in clip 14 at [mm:ss].

**ads_read**
We read the client's ad account results by month (impressions, reach, clicks, spend, conversions, per campaign) for the client's report. Shown in the Ads tab. Clip 15 at [mm:ss].

**ads_management**
Our team creates and manages campaigns for clients. In the Ads tab a campaign is created (paused, with no budget, so it never runs or spends) and can be deleted; it also appears in Ads Manager. Clip 16 at [mm:ss].

**Business Asset User Profile Access (feature)**
In the Inbox we show the name and profile picture of the person who commented or sent a message, so our team knows who they are answering. Clip 17 at [mm:ss].

## Data handling questions (suggested answers — confirm before submitting)

- **Do you share Platform Data with third parties?** No. Data is used only to provide our services to the client who connected their accounts.
- **Where is it stored?** Our own database (Google Firebase), access limited to MD Media staff on that client. Access tokens are encrypted and never shown in the app.
- **Data processors / service providers:** Google Firebase (database), Vercel (hosting), Cloudflare R2 (uploaded media for posts). [Confirm list]
- **Retention / deletion:** When a client disconnects or asks, their tokens and stored data are deleted. Data deletion requests: https://www.mdmmarketing.com.au/data-deletion (callback endpoint configured in the app).
- **Responsible entity:** MD MEDIA MARKETING PTY LTD (verified business). Privacy policy: https://www.mdmmarketing.com.au/privacy
- **Requests from public authorities:** none received; policy is to review each request for legality and disclose only what is legally required. [Confirm with owner]
