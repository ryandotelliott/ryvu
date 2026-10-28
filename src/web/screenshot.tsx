import { useEffect, useState, type ComponentProps } from 'react';
import { readScreenshot } from '../screenshots.functions';
import { isGithubScreenshot } from '../screenshots';

type LoadedImage = { url: string; status: 'ready'; src: string } | { url: string; status: 'error' };
export function Screenshot({ src, alt, width, height }: Pick<ComponentProps<'img'>, 'src' | 'alt' | 'width' | 'height'>) {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const authenticated = Boolean(src && isGithubScreenshot(src));
  useEffect(() => {
    if (!src || !authenticated) return;
    let active = true;
    void readScreenshot({ data: { url: src } }).then(
      value => { if (active) setImage({ url: src, status: 'ready', src: value }); },
      () => { if (active) setImage({ url: src, status: 'error' }); }
    );
    return () => { active = false; };
  }, [src, authenticated]);
  if (!src) return <span>{alt || 'Screenshot'}</span>;
  if (image?.url === src && image.status === 'error') return <a href={src} target="_blank" rel="noreferrer">{alt || 'Screenshot'} · Open image</a>;
  if (authenticated && !(image?.url === src && image.status === 'ready')) return <span role="status">Loading screenshot…</span>;
  const loaded = authenticated && image?.status === 'ready' && image.url === src ? image.src : src;
  return <img className="markdown-image" src={loaded} alt={alt || 'Screenshot'} width={width} height={height} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setImage({ url: src, status: 'error' })} />;
}
