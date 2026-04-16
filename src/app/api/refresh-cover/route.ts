import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { artist, album, skipMbids = [], skipUrls = [] } = await req.json()
    if (!artist || !album) {
      return NextResponse.json({ cover_url: null, mbid: null, cover_source: null }, { status: 400 })
    }

    // Try MusicBrainz with more candidates
    try {
      const query = `artist:"${artist}" AND releasegroup:"${album}"`
      const mbUrl = `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=10`
      const mbRes = await fetch(mbUrl, {
        headers: { 'User-Agent': 'TheCrate/1.0 (hello@macadamia.com.au)' },
      })
      const mbData = await mbRes.json()

      if (mbData['release-groups']) {
        for (const rg of mbData['release-groups']) {
          if (skipMbids.includes(rg.id)) continue

          const coverUrl = `https://coverartarchive.org/release-group/${rg.id}/front-500`
          if (skipUrls.includes(coverUrl)) continue

          try {
            const coverRes = await fetch(coverUrl, { method: 'HEAD', redirect: 'follow' })
            if (coverRes.ok) {
              return NextResponse.json({
                cover_url: coverUrl,
                mbid: rg.id,
                cover_source: 'musicbrainz',
              })
            }
          } catch { /* try next */ }
        }
      }
    } catch { /* fall through to Discogs */ }

    // Try iTunes
    try {
      const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(artist + ' ' + album)}&entity=album&limit=5`
      const itRes = await fetch(itunesUrl)
      const itData = await itRes.json()
      if (itData.results) {
        for (const r of itData.results) {
          const url = r.artworkUrl100?.replace('100x100', '600x600')
          if (url && !skipUrls.includes(url)) {
            return NextResponse.json({
              cover_url: url,
              mbid: null,
              cover_source: 'itunes',
            })
          }
        }
      }
    } catch { /* fall through */ }

    // Try Discogs
    const token = process.env.DISCOGS_TOKEN
    if (token) {
      try {
        const discogsUrl = `https://api.discogs.com/database/search?artist=${encodeURIComponent(artist)}&release_title=${encodeURIComponent(album)}&type=release&per_page=10`
        const dRes = await fetch(discogsUrl, {
          headers: {
            'Authorization': `Discogs token=${token}`,
            'User-Agent': 'TheCrate/1.0',
          },
        })
        const dData = await dRes.json()

        if (dData.results) {
          for (const r of dData.results) {
            if (r.cover_image && !r.cover_image.includes('spacer.gif') && !skipUrls.includes(r.cover_image)) {
              return NextResponse.json({
                cover_url: r.cover_image,
                mbid: null,
                cover_source: 'discogs',
              })
            }
          }
        }
      } catch { /* no results */ }
    }

    return NextResponse.json({ cover_url: null, mbid: null, cover_source: null })
  } catch (error) {
    console.error('/api/refresh-cover error:', error)
    return NextResponse.json({ cover_url: null, mbid: null, cover_source: null }, { status: 500 })
  }
}
