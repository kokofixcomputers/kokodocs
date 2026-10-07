import { useState } from 'react'
import { ExternalLink, ImageOff, VideoOff } from 'lucide-react'
import type { FormItem } from './model'
import { safeUrl, videoSource } from './media'

/** An image or video block as people filling the form see it. */
export function MediaView({ it }: { it: FormItem }) {
  const [broken, setBroken] = useState(false)
  const size = it.size ?? 'medium'
  const isVideo = it.media === 'video'
  const url = safeUrl(it.src)
  const video = isVideo ? videoSource(it.src) : null
  let body: React.ReactNode
  if (!url) body = <div className="fm-media-empty">{isVideo ? <VideoOff size={26} /> : <ImageOff size={26} />}<span>{isVideo ? 'No video link yet' : 'No image yet'}</span></div>
  else if (isVideo && video?.kind === 'iframe') body = <div className="fm-video"><iframe src={video.src} title={it.title || `${video.provider} video`} loading="lazy" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
    allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups" /></div>
  else if (isVideo && video?.kind === 'file') body = <video className="fm-video-file" src={video.src} controls preload="metadata" playsInline onError={() => setBroken(true)} />
  else if (isVideo) body = <a className="fm-media-empty link" href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={22} /><span>Open the video in a new tab</span></a>
  else body = <img className="fm-img" src={url} alt={it.title || ''} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
  if (broken) body = <div className="fm-media-empty">{isVideo ? <VideoOff size={26} /> : <ImageOff size={26} />}<span>This {isVideo ? 'video' : 'image'} couldn’t be loaded</span></div>
  return (
    <figure className={`fm-card fm-media sz-${size}`}>
      {body}
      {it.title && <figcaption>{it.title}</figcaption>}
    </figure>
  )
}
