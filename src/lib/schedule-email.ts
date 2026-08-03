// src/lib/schedule-email.ts

export interface ScheduleAlbum {
  artist: string
  album: string
  why?: string
}

export interface ScheduleDay {
  day: string
  theme?: string
  note?: string
  albums: ScheduleAlbum[]
}

export interface Schedule {
  intro?: string
  days: ScheduleDay[]
}

export function escapeHtml(s: string | undefined | null): string {
  if (!s) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Email clients ignore most modern CSS — inline styles, tables, web-safe fonts only.
const cream = '#ede5d8'
const rust = '#c45e3a'
const bg = '#0f0f0f'
const panel = '#161616'
const muted = 'rgba(237,229,216,0.55)'
const faint = 'rgba(237,229,216,0.3)'

export function buildScheduleEmailHtml(schedule: Schedule, eligibleCount: number, monthsLookback: number): string {
  const dayBlocks = (schedule.days ?? []).map(day => {
    const albums = (day.albums ?? []).map(a => `
      <tr>
        <td style="padding:6px 0;vertical-align:top;">
          <div style="font-size:15px;color:${cream};font-style:italic;">${escapeHtml(a.album)}</div>
          <div style="font-size:13px;color:${muted};">${escapeHtml(a.artist)}</div>
          ${a.why ? `<div style="font-size:12px;color:${faint};padding-top:2px;">${escapeHtml(a.why)}</div>` : ''}
        </td>
      </tr>
    `).join('')

    return `
      <table width="100%" cellpadding="0" cellspacing="0" style="background:${panel};margin-bottom:16px;border-left:2px solid ${rust};">
        <tr>
          <td style="padding:16px 20px;">
            <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${rust};font-family:Helvetica,Arial,sans-serif;">
              ${escapeHtml(day.day)}
            </div>
            <div style="font-size:17px;color:${cream};padding-top:4px;font-family:Georgia,serif;">
              ${escapeHtml(day.theme)}
            </div>
            ${day.note ? `<div style="font-size:13px;color:${muted};padding-top:6px;line-height:1.5;">${escapeHtml(day.note)}</div>` : ''}
            <table width="100%" cellpadding="0" cellspacing="0" style="padding-top:10px;">
              ${albums}
            </table>
          </td>
        </tr>
      </table>
    `
  }).join('')

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${bg};">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${bg};padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:Helvetica,Arial,sans-serif;">

          <tr>
            <td style="padding-bottom:8px;border-bottom:1px solid rgba(237,229,216,0.15);">
              <div style="font-size:24px;letter-spacing:4px;text-transform:uppercase;color:${cream};">The Crate</div>
              <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${faint};padding-top:6px;">
                Your week in records
              </div>
            </td>
          </tr>

          ${schedule.intro ? `
          <tr>
            <td style="padding:20px 0;font-size:14px;line-height:1.7;color:${muted};">
              ${escapeHtml(schedule.intro)}
            </td>
          </tr>` : '<tr><td style="height:20px;"></td></tr>'}

          <tr><td>${dayBlocks}</td></tr>

          <tr>
            <td style="padding-top:16px;border-top:1px solid rgba(237,229,216,0.1);font-size:11px;color:${faint};line-height:1.6;">
              Chosen from ${eligibleCount} album${eligibleCount === 1 ? '' : 's'} you haven't played in ${monthsLookback} months.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
