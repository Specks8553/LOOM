import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import Lightbox from "./Lightbox";

interface InlineImageProps {
  assetPath: string;
  alt?: string;
}

export default function InlineImage({ assetPath, alt = "Image" }: InlineImageProps) {
  const [showLightbox, setShowLightbox] = useState(false);
  const src = convertFileSrc(assetPath);

  return (
    <>
      <img
        src={src}
        alt={alt}
        className="max-w-full max-h-[400px] w-auto h-auto rounded-md cursor-pointer
                   object-contain transition-opacity hover:opacity-90"
        onClick={() => setShowLightbox(true)}
      />
      {showLightbox && (
        <Lightbox src={src} alt={alt} onClose={() => setShowLightbox(false)} />
      )}
    </>
  );
}
