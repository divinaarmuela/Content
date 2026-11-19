/**
 * HOW THE WRITTEN REPORT LOOKS (the owner, 19 Nov 2026, with the Basfoods report as the reference: "this is how the
 * report should look like … where's the colours and the headers"). One look, in one place, for every place the report
 * is read: the Reports page, its editor, the PDF and the client's portal — so they can never drift apart again.
 *
 * The look: a section heading is large with a blue rule under it; sub-headings are blue; a table has a blue header row
 * with white words. The blue is the reference's own (read off its pixels: rgb 30, 129, 253).
 */
export const REPORT_BLUE = '#1E81FD'
/** the pale tint behind a figure tile in the PDF (the reference's rgb 214, 221, 232, lightened for paper) */
export const REPORT_TILE = '#E6ECF5'

/** the report's own styles, for whichever class holds it */
export function reportProseCss(s: string): string {
  return `
${s} h2{font-size:24px;font-weight:700;line-height:1.2;letter-spacing:-.01em;margin:30px 0 12px;padding-bottom:7px;border-bottom:3px solid ${REPORT_BLUE}}
${s} > h2:first-child{margin-top:0}
${s} h3{font-size:17px;font-weight:700;line-height:1.3;color:${REPORT_BLUE};margin:20px 0 6px}
${s} h4{font-size:15px;font-weight:700;line-height:1.3;color:${REPORT_BLUE};margin:16px 0 4px}
${s} p{font-size:14px;line-height:1.65;margin:0 0 10px}
${s} ul,${s} ol{margin:0 0 12px;padding-left:22px;font-size:14px;line-height:1.6}
${s} ul{list-style:disc}${s} ol{list-style:decimal}
${s} li{margin:3px 0}
${s} strong{font-weight:700}
${s} table{width:100%;border-collapse:collapse;margin:10px 0 16px;font-size:13px}
${s} th{background:${REPORT_BLUE};color:#fff;font-weight:700;text-align:left;padding:7px 9px;border:1px solid ${REPORT_BLUE};-webkit-print-color-adjust:exact;print-color-adjust:exact}
${s} td{border:1px solid hsl(var(--border));padding:7px 9px;text-align:left;vertical-align:top}
${s} th p,${s} td p{margin:0;font-size:13px;line-height:1.45}
${s} a{color:${REPORT_BLUE};text-decoration:underline;text-underline-offset:3px}
${s} th a{color:#fff}
@media (max-width:640px){${s} h2{font-size:20px}${s} table{font-size:12px}${s} th,${s} td{padding:6px}}
`
}
