import { REPORT_BLUE, REPORT_TILE, reportProseCss } from './report-look'

/**
 * THE SHEET'S LOOK, ON SCREEN AND ON PAPER (19 Nov 2026). These rules used to live inside `@media print`, so the only
 * way to see the PDF was to print it. They are the sheet's own now: the preview draws the very same sheet.
 *
 * THE EMPTY PAGES (the owner, 19 Nov 2026: "look at how many empty pages"). Print used to HIDE the rest of the page
 * (`visibility:hidden`), and a hidden thing still takes its room: the whole Reports page — figures, posts, the editor —
 * was printed as blank paper after the report. The sheet now sits straight under <body> (a portal) and print takes
 * everything else OFF the page (`display:none`), so the PDF is the report and nothing after it.
 */
export const PRINT_CSS = `${reportProseCss('.report-prose')}
.report-sheet{color:#0a0a0a;background:#fff;font-family:inherit}
.report-sheet a{color:${REPORT_BLUE};text-decoration:underline;text-underline-offset:3px}
.report-sheet .report-prose h2,.report-sheet .report-prose h3,.report-sheet .report-prose h4{color:inherit;break-after:avoid}
.report-sheet .report-prose h3,.report-sheet .report-prose h4{color:${REPORT_BLUE}}
.report-sheet .report-prose tr,.report-sheet .report-prose img,.report-sheet .pr-post,.report-sheet .pr-posts{break-inside:avoid}
.report-sheet .pr-block > h2,.report-sheet .pr-block > h3{break-after:avoid}
.report-sheet .pr-cover{text-align:center;padding:26px 0 22px;margin-bottom:8px}
.report-sheet .pr-kicker{font-size:19px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${REPORT_BLUE};margin:0}
.report-sheet .pr-cover h1{font-size:44px;font-weight:800;letter-spacing:.01em;text-transform:uppercase;margin:16px 0 10px;line-height:1.1}
.report-sheet .pr-sub{font-size:19px;font-weight:700;margin:0 0 12px}
.report-sheet .pr-month{font-size:15px;color:#666;margin:0 0 22px}
.report-sheet .pr-by{font-size:14px;margin:0 0 10px}
.report-sheet .pr-conf{font-size:12px;color:#777;margin:0}
.report-sheet .pr-block > h2{font-size:22px;font-weight:700;margin:0 0 10px;padding-bottom:6px;border-bottom:3px solid ${REPORT_BLUE}}
.report-sheet .pr-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:3px;margin:0 0 6px}
.report-sheet .pr-tile{background:${REPORT_TILE};padding:11px 6px 9px;text-align:center;break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.report-sheet .pr-tile b{display:block;font-size:21px;font-weight:700;line-height:1.15;color:${REPORT_BLUE}}
.report-sheet .pr-tile span{display:block;font-size:9px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#555;margin-top:2px}
.report-sheet .pr-tile i{display:block;font-size:9px;font-style:normal;color:#777;margin-top:2px}
.report-sheet .pr-note{font-size:11px;font-style:italic;color:#666;margin:4px 0 0}
.report-sheet .pr-logo{width:84px;height:84px;border-radius:50%;object-fit:cover;margin:0 auto 16px;display:block;border:1px solid #e5e5e5}
.report-sheet .pr-plat{display:flex;align-items:center;gap:9px}
.report-sheet .pr-plat span[role=img]{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.report-sheet .pr-plat > span:not([role=img]){font-weight:400;color:#666}
.report-sheet .pr-charts{display:grid;grid-template-columns:1fr 1fr;gap:22px;align-items:start}
.report-sheet .pr-chart{break-inside:avoid;margin-top:6px}
.report-sheet .pr-chart svg{max-width:100%;height:auto}
.report-sheet .pr-chart h3{font-size:12px;font-weight:700;color:#1b1b1b;margin:12px 0 6px}
.report-sheet .report-prose td{border-color:#d9d9d9}
.report-sheet .pr-block{margin:0 0 22px}
/* a figure is a block of the report (20 Nov 2026): close to its neighbours, with air above an account's heading */
.report-sheet .pr-block.pr-fig{margin:0 0 8px}
.report-sheet .pr-block.pr-fig-platform,.report-sheet .pr-block.pr-fig-audience{margin-top:24px}
.report-sheet .pr-block.pr-fig-summary{margin-bottom:22px}
.report-sheet .pr-block.report-prose{margin-top:18px}
.report-sheet .pr-fig .report-prose table{margin:0}
.report-sheet .pr-block > h3{font-size:14px;font-weight:700;color:${REPORT_BLUE};margin:14px 0 6px}
.report-sheet .pr-posts{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
.report-sheet .pr-post img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:6px}
.report-sheet .pr-post p{margin:4px 0 0;font-size:11px}
.report-sheet .pr-small{font-size:11px;color:#555}
#report-print{display:none}
@media print{
  @page{size:A4;margin:16mm}
  html,body{background:#fff !important;height:auto !important}
  body > *:not(#report-print){display:none !important}
  #report-print{display:block !important}
}
/* the preview: the sheet as a page on the screen */
.report-sheet-screen{width:210mm;max-width:100%;margin:0 auto;padding:16mm;box-shadow:0 1px 3px rgba(0,0,0,.12),0 8px 30px rgba(0,0,0,.10);border-radius:4px}
@media (max-width:640px){.report-sheet-screen{padding:18px}.report-sheet .pr-tiles{grid-template-columns:repeat(2,1fr)}.report-sheet .pr-charts{grid-template-columns:1fr}.report-sheet .pr-posts{grid-template-columns:repeat(3,1fr)}.report-sheet .pr-cover h1{font-size:30px}}
`
